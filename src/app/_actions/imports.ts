'use server'

import { revalidatePath } from 'next/cache'

import { CRM_IMPORT_FIELDS, type CrmImportField } from '@/domain/schemas'
import { requireAgencyScope } from '@/lib/session'
import { analyzeCsv, confirmImport, type AnalyzeResult } from '@/services/crmImportService'
import { runLeadRevive } from '@/services/leadReviveService'
import { recordAudit } from '@/services/auditService'

/**
 * De twee stappen van een CRM-import.
 *
 * ─── WAAROM TWEE STAPPEN EN GEEN ÉÉN ─────────────────────────────────────────
 *
 * Een import raakt het klantenbestand van het kantoor — de gevoeligste data in
 * dit systeem, en data die wij niet kunnen herstellen als hij verkeerd landt.
 * Eén knop "upload en verwerk" zou betekenen dat een verkeerd geraden kolom
 * duizend contacten met de verkeerde naam of datum wegschrijft voordat iemand
 * het ziet.
 *
 * Daarom: eerst analyseren en tonen wat we van het bestand begrijpen, dan pas
 * schrijven — en alleen op wat de gebruiker heeft bevestigd. De mapping die
 * uiteindelijk gebruikt is, komt op `CrmImport.columnMapping` te staan.
 */

// 8 MB. Ruim genoeg voor tienduizenden contacten; groot genoeg om een
// per-ongeluk-geüploade databasedump te weigeren voordat hij in het geheugen zit.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

export interface AnalyzeState {
  error: string | null
  result: AnalyzeResult | null
}

export async function analyzeUpload(
  _state: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  const scope = await requireAgencyScope()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Kies een CSV-bestand.', result: null }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `Het bestand is te groot (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
      result: null,
    }
  }

  const content = await file.text()

  try {
    const result = await analyzeCsv({
      agencyId: scope.agencyId,
      userId: scope.userId,
      fileName: file.name,
      content,
    })

    await recordAudit({
      actor: scope.userId,
      agencyId: scope.agencyId,
      action: 'crm.import.analyzed',
      entityType: 'CrmImport',
      entityId: result.importId,
      // Het aantal rijen wél, de inhoud niet: een audittrail hoort geen
      // persoonsgegevens te dupliceren.
      metadata: { fileName: file.name, rows: result.totalRows },
    })

    revalidatePath('/imports')
    return { error: null, result }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Het bestand kon niet gelezen worden.',
      result: null,
    }
  }
}

export interface ConfirmState {
  error: string | null
  summary: string | null
}

/** Leest de mapping terug uit het formulier: één select per kolom. */
function readMapping(formData: FormData, header: readonly string[]): Record<string, CrmImportField> {
  const mapping: Record<string, CrmImportField> = {}

  header.forEach((_column, index) => {
    const raw = formData.get(`column-${index}`)
    const value = typeof raw === 'string' ? raw : 'ignore'
    mapping[String(index)] = (CRM_IMPORT_FIELDS as readonly string[]).includes(value)
      ? (value as CrmImportField)
      : 'ignore'
  })

  return mapping
}

export async function confirmUpload(
  _state: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const scope = await requireAgencyScope()

  const importId = formData.get('importId')
  const headerRaw = formData.get('header')

  if (typeof importId !== 'string' || typeof headerRaw !== 'string') {
    return { error: 'De import kon niet worden teruggevonden.', summary: null }
  }

  let header: string[]
  try {
    header = JSON.parse(headerRaw) as string[]
  } catch {
    return { error: 'De kolominformatie was onleesbaar.', summary: null }
  }

  const mapping = readMapping(formData, header)

  try {
    const result = await confirmImport({
      agencyId: scope.agencyId,
      importId,
      mapping,
      header,
    })

    // Nieuwe contacten kunnen meteen slapende relaties opleveren. Direct
    // doorrekenen, zodat het LeadRevive-scherm niet leeg blijft tot de nachtrun.
    await runLeadRevive(scope.agencyId)

    await recordAudit({
      actor: scope.userId,
      agencyId: scope.agencyId,
      action: 'crm.import.confirmed',
      entityType: 'CrmImport',
      entityId: importId,
      metadata: { ...result },
    })

    revalidatePath('/imports')
    revalidatePath('/leadrevive')

    return {
      error: null,
      summary:
        `${result.created} nieuw, ${result.updated} bijgewerkt, ` +
        `${result.duplicates} duplicaat, ${result.invalid} onbruikbaar` +
        (result.failed > 0 ? `, ${result.failed} mislukt` : ''),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'De import kon niet worden verwerkt.',
      summary: null,
    }
  }
}
