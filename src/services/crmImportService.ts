import { applyMapping, parseCsv, suggestMapping } from '@/crm/csv'
import { isUsableContact, normalizeContact, type RawContactInput } from '@/crm/normalizeContact'
import type { CrmImportField } from '@/domain/schemas'
import { sha256Hex } from '@/lib/hash'
import { toJsonValue } from '@/lib/json'
import { createLogger } from '@/lib/logger'
import { messageOf } from '@/lib/errors'
import * as crmRepository from '@/repositories/crmRepository'
import { prisma } from '@/repositories/prisma'

/**
 * CSV-import van een klantenbestand, in twee stappen.
 *
 * ─── WAAROM TWEE STAPPEN ─────────────────────────────────────────────────────
 *
 *   1. analyseren  — bestand lezen, kolommen herkennen, voorstel tonen
 *   2. bevestigen  — mapping vastleggen, contacten aanmaken of bijwerken
 *
 * De tussenstap bestaat omdat een verkeerde kolommapping het klantenbestand van
 * een kantoor beschadigt, en dat is de ene fout die je niet met een knop
 * terugdraait. "Telefoon" op de kolom met klantnummers leggen levert duizend
 * contacten met een onbruikbaar nummer op. Eén scherm waarin de makelaar ziet
 * wat er waar terechtkomt, met de eerste rijen als voorbeeld, voorkomt dat.
 *
 * ─── WAT DE IMPORT NOOIT DOET ────────────────────────────────────────────────
 *
 * Gevulde velden leegmaken. Zie `upsertContact`: een lege waarde in het bestand
 * wist nooit iets dat er al stond, en elke wijziging van een gevulde waarde komt
 * met oude én nieuwe waarde in `CrmImportRow.changes` te staan. Dat logboek is
 * het enige dat een verkeerde import achteraf verklaarbaar maakt.
 */

const logger = createLogger({ component: 'crm-import' })

/** Bovengrens per bestand. Beschermt tegen een export van een half miljoen rijen. */
const MAX_ROWS = 20_000

export interface AnalyzeResult {
  importId: string
  header: string[]
  suggestedMapping: Record<string, CrmImportField>
  /** De eerste rijen, om de mapping mee te controleren. */
  preview: string[][]
  totalRows: number
  warnings: string[]
}

export async function analyzeCsv(input: {
  agencyId: string
  userId: string | null
  fileName: string
  content: string
}): Promise<AnalyzeResult> {
  const parsed = parseCsv(input.content)
  const warnings: string[] = []

  if (parsed.header.length === 0) {
    throw new Error('Het bestand bevat geen kolomkoppen.')
  }
  if (parsed.rows.length === 0) {
    throw new Error('Het bestand bevat geen rijen onder de kop.')
  }

  if (parsed.malformedRows.length > 0) {
    warnings.push(
      `${parsed.malformedRows.length} rij(en) hadden een afwijkend aantal kolommen (bv. rij ${parsed.malformedRows.slice(0, 5).join(', ')}). Ze worden meegenomen, maar controleer de mapping.`,
    )
  }

  const rows = parsed.rows.slice(0, MAX_ROWS)
  if (parsed.rows.length > MAX_ROWS) {
    warnings.push(`Bestand bevat ${parsed.rows.length} rijen; alleen de eerste ${MAX_ROWS} worden verwerkt.`)
  }

  const record = await crmRepository.createImport(input.agencyId, {
    fileName: input.fileName,
    // Hash over de inhoud: twee keer hetzelfde bestand uploaden is dan zichtbaar
    // in plaats van stilzwijgend dubbel werk.
    fileHash: sha256Hex(input.content),
    createdById: input.userId,
  })

  await crmRepository.createPendingRows(record.id, rows)

  const suggestedMapping = suggestMapping(parsed.header)

  await crmRepository.updateImport(input.agencyId, record.id, {
    status: 'READY',
    totalRows: rows.length,
    columnMapping: toJsonValue({ header: parsed.header, mapping: suggestedMapping }),
  })

  logger.info('Importbestand geanalyseerd', {
    agencyId: input.agencyId,
    importId: record.id,
    rows: rows.length,
    delimiter: parsed.delimiter,
  })

  return {
    importId: record.id,
    header: parsed.header,
    suggestedMapping,
    preview: rows.slice(0, 5),
    totalRows: rows.length,
    warnings,
  }
}

export interface ImportRunResult {
  created: number
  updated: number
  duplicates: number
  invalid: number
  failed: number
}

export async function confirmImport(input: {
  agencyId: string
  importId: string
  mapping: Record<string, CrmImportField>
  header: string[]
}): Promise<ImportRunResult> {
  const record = await crmRepository.findImport(input.agencyId, input.importId)
  if (!record) throw new Error('Import niet gevonden')
  if (record.status === 'COMPLETED') throw new Error('Deze import is al verwerkt')

  await crmRepository.updateImport(input.agencyId, input.importId, {
    status: 'IMPORTING',
    columnMapping: toJsonValue({ header: input.header, mapping: input.mapping }),
  })

  const result: ImportRunResult = { created: 0, updated: 0, duplicates: 0, invalid: 0, failed: 0 }

  try {
    const rows = await crmRepository.pendingRows(input.importId, MAX_ROWS)

    for (const row of rows) {
      const values = Array.isArray(row.raw) ? (row.raw as unknown[]).map(String) : []

      try {
        const mapped = applyMapping(values, input.mapping) as RawContactInput
        const contact = normalizeContact(mapped)

        if (!isUsableContact(contact)) {
          result.invalid += 1
          await crmRepository.updateImportRow(row.id, {
            status: 'SKIPPED_INVALID',
            message: 'Geen naam, telefoonnummer of e-mailadres — niet te identificeren contact.',
          })
          continue
        }

        const upserted = await crmRepository.upsertContact(input.agencyId, contact)

        // Een adres in het CRM is het scherpste CRM↔markt-signaal dat er is:
        // hiermee kan een advertentie later aan een bekende eigenaar hangen.
        if (contact.addressMatchKey) {
          await crmRepository.linkContactToAddress({
            agencyId: input.agencyId,
            contactId: upserted.contact.id,
            addressMatchKey: contact.addressMatchKey,
            address: contact.address,
            postalCode: contact.postalCode,
            city: contact.city,
            role: roleForContactType(contact.contactType),
            since: contact.sourceCreatedAt,
          })
        }

        if (upserted.status === 'CREATED') result.created += 1
        else if (upserted.status === 'UPDATED') result.updated += 1
        else result.duplicates += 1

        await crmRepository.updateImportRow(row.id, {
          status: upserted.status,
          contactId: upserted.contact.id,
          changes: upserted.changes,
          message:
            upserted.status === 'SKIPPED_DUPLICATE'
              ? 'Bestaand contact, geen nieuwe informatie in deze rij.'
              : null,
        })
      } catch (error) {
        result.failed += 1
        await crmRepository.updateImportRow(row.id, {
          status: 'FAILED',
          message: messageOf(error).slice(0, 300),
        })
      }
    }

    await crmRepository.updateImport(input.agencyId, input.importId, {
      status: 'COMPLETED',
      finishedAt: new Date(),
      createdCount: result.created,
      updatedCount: result.updated,
      duplicateCount: result.duplicates,
      invalidCount: result.invalid,
      failedCount: result.failed,
    })

    logger.info('Import afgerond', { agencyId: input.agencyId, importId: input.importId, ...result })
  } catch (error) {
    await crmRepository.updateImport(input.agencyId, input.importId, {
      status: 'FAILED',
      finishedAt: new Date(),
      error: messageOf(error).slice(0, 500),
    })
    throw error
  }

  return result
}

/**
 * Welke rol een contact tegenover een adres heeft.
 *
 * Alleen rollen waarvan we het zeker weten. Een `PROSPECT` met een adres is niet
 * per se de eigenaar van dat adres — dat kan net zo goed het adres zijn waar hij
 * naartoe wil verhuizen. `INTERESTED` is dan het eerlijke antwoord, en de
 * CRM-matcher telt die rol bewust niet mee als eigendomssignaal.
 */
function roleForContactType(
  contactType: ReturnType<typeof normalizeContact>['contactType'],
): 'OWNER' | 'FORMER_OWNER' | 'BUYER' | 'SELLER' | 'TENANT' | 'VALUATION_SUBJECT' | 'INTERESTED' {
  switch (contactType) {
    case 'SELLER':
      return 'SELLER'
    case 'VALUATION_LEAD':
      return 'VALUATION_SUBJECT'
    case 'FORMER_CLIENT':
      return 'FORMER_OWNER'
    case 'LANDLORD':
      return 'OWNER'
    case 'TENANT':
      return 'TENANT'
    case 'BUYER':
      return 'BUYER'
    case 'PROSPECT':
    case 'UNKNOWN':
      return 'INTERESTED'
  }
}

/** Interacties bij een contact, voor de LeadRevive-signalen. */
export async function addInteraction(input: {
  agencyId: string
  contactId: string
  kind: 'CALL' | 'EMAIL' | 'MEETING' | 'VISIT' | 'VALUATION' | 'MANDATE' | 'NOTE' | 'OTHER'
  occurredAt: Date
  summary: string | null
  agentName: string | null
}): Promise<void> {
  const contact = await prisma.crmContact.findFirst({
    where: { id: input.contactId, agencyId: input.agencyId },
    select: { id: true, lastContactAt: true },
  })

  if (!contact) throw new Error('Contact niet gevonden')

  await prisma.crmInteraction.create({
    data: {
      agencyId: input.agencyId,
      contactId: input.contactId,
      kind: input.kind,
      occurredAt: input.occurredAt,
      summary: input.summary,
      agentName: input.agentName,
    },
  })

  // `lastContactAt` alleen vooruit zetten: een oude interactie toevoegen mag de
  // dormantieberekening niet omgooien alsof er gisteren nog contact was.
  if (!contact.lastContactAt || input.occurredAt > contact.lastContactAt) {
    await prisma.crmContact.update({
      where: { id: contact.id },
      data: { lastContactAt: input.occurredAt },
    })
  }
}
