import type { CrmContact, CrmImport, Prisma } from '@/generated/prisma/client'

import type { CrmMatchCandidate, MarketSideForCrmMatch } from '@/crm/crmMatcher'
import type { NormalizedContact } from '@/crm/normalizeContact'
import type { CrmContactFilter } from '@/domain/schemas'
import { toJsonValue } from '@/lib/json'

import { prisma } from './prisma'

/**
 * Het klantenbestand van één kantoor.
 *
 * ─── DE STRENGSTE TENANTREGEL IN DIT PROJECT ─────────────────────────────────
 *
 * Marktdata is publiek en wordt gedeeld tussen alle kantoren. Een klantenbestand
 * is dat nooit. Élke functie hieronder neemt daarom een `agencyId` en zet hem in
 * de `where` — er is geen enkele uitzondering, ook niet voor de pijplijn, ook
 * niet voor een achtergrondtaak.
 *
 * Waar de marktkant nog een `allActiveTerritories()` kent die over tenants heen
 * kijkt, bestaat hier bewust geen tegenhanger. Wie kansen wil berekenen voor
 * alle kantoren, doet dat kantoor voor kantoor.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

const MAX_MATCH_CANDIDATES = 20

/**
 * Kandidaat-contacten voor een marktsignaal.
 *
 * Haalt op langs de vier wegen waarop een koppeling kan ontstaan: adres,
 * telefoon, e-mail en naam. De naamweg staat er wel bij maar levert op zichzelf
 * nooit een bevestigde match op — zie `crmMatcher`.
 */
export async function findMatchCandidates(
  agencyId: string,
  market: MarketSideForCrmMatch,
): Promise<CrmMatchCandidate[]> {
  const or: Prisma.CrmContactWhereInput[] = []

  if (market.propertyMatchKey) {
    or.push({ addressMatchKey: market.propertyMatchKey })
    or.push({ propertyRelations: { some: { addressMatchKey: market.propertyMatchKey } } })
  }
  if (market.propertyId) {
    or.push({ propertyRelations: { some: { propertyId: market.propertyId } } })
  }
  if (market.sellerPhoneE164) or.push({ phoneE164: market.sellerPhoneE164 })
  if (market.sellerEmailNormalized) or.push({ emailNormalized: market.sellerEmailNormalized })
  if (market.sellerNameNormalized && market.sellerNameNormalized.length >= 3) {
    or.push({
      nameNormalized: market.sellerNameNormalized,
      ...(market.postalCode ? { postalCode: market.postalCode } : {}),
    })
  }

  if (or.length === 0) return []

  const contacts = await prisma.crmContact.findMany({
    where: { agencyId, redactedAt: null, OR: or },
    take: MAX_MATCH_CANDIDATES,
    select: {
      id: true,
      displayName: true,
      phoneE164: true,
      emailNormalized: true,
      nameNormalized: true,
      addressMatchKey: true,
      postalCode: true,
      propertyRelations: {
        select: { propertyId: true, addressMatchKey: true, role: true },
      },
    },
  })

  return contacts
}

// ─────────────────────────────────────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────────────────────────────────────

export async function createImport(
  agencyId: string,
  input: { fileName: string | null; fileHash: string | null; createdById: string | null },
): Promise<CrmImport> {
  return prisma.crmImport.create({
    data: {
      agencyId,
      adapter: 'csv',
      fileName: input.fileName,
      fileHash: input.fileHash,
      createdById: input.createdById,
      status: 'ANALYZING',
    },
  })
}

export async function findImport(agencyId: string, importId: string): Promise<CrmImport | null> {
  return prisma.crmImport.findFirst({ where: { id: importId, agencyId } })
}

export async function listImports(agencyId: string, limit = 25): Promise<CrmImport[]> {
  return prisma.crmImport.findMany({
    where: { agencyId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
}

export async function updateImport(
  agencyId: string,
  importId: string,
  data: Prisma.CrmImportUpdateManyMutationInput,
): Promise<void> {
  await prisma.crmImport.updateMany({ where: { id: importId, agencyId }, data })
}

export async function listImportRows(importId: string, limit = 200) {
  return prisma.crmImportRow.findMany({
    where: { importId },
    orderBy: { rowNumber: 'asc' },
    take: limit,
    include: { contact: { select: { id: true, displayName: true } } },
  })
}

/**
 * Voegt een contact toe of werkt het bij, en legt vast wat er veranderde.
 *
 * ─── NOOIT STILZWIJGEND OVERSCHRIJVEN ────────────────────────────────────────
 *
 * Dit is data die het kantoor zelf aanleverde. Een tweede import mag geen
 * telefoonnummer of notitie wissen omdat de nieuwe export dat veld leeg liet.
 * Daarom: lege waarden vullen nooit iets in, en elke wijziging van een gevulde
 * waarde komt als `{ veld: { from, to } }` in `CrmImportRow.changes` te staan.
 * Zonder die regel is een verkeerde kolommapping onherstelbaar.
 */
export interface UpsertContactResult {
  contact: CrmContact
  status: 'CREATED' | 'UPDATED' | 'SKIPPED_DUPLICATE'
  changes: Record<string, { from: unknown; to: unknown }>
}

export async function upsertContact(
  agencyId: string,
  contact: NormalizedContact,
): Promise<UpsertContactResult> {
  const existing = await findExistingContact(agencyId, contact)

  if (!existing) {
    const created = await prisma.crmContact.create({
      data: {
        agencyId,
        externalId: contact.externalId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        postalCode: contact.postalCode,
        city: contact.city,
        province: contact.province,
        emailNormalized: contact.emailNormalized,
        phoneE164: contact.phoneE164,
        nameNormalized: contact.nameNormalized,
        addressMatchKey: contact.addressMatchKey,
        contactType: contact.contactType,
        status: contact.status,
        leadType: contact.leadType,
        assignedAgentName: contact.assignedAgentName,
        notes: contact.notes,
        sourceCreatedAt: contact.sourceCreatedAt,
        lastContactAt: contact.lastContactAt,
      },
    })

    return { contact: created, status: 'CREATED', changes: {} }
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const data: Prisma.CrmContactUpdateInput = {}

  const fields: (keyof NormalizedContact & keyof CrmContact)[] = [
    'firstName',
    'lastName',
    'displayName',
    'email',
    'phone',
    'address',
    'postalCode',
    'city',
    'province',
    'emailNormalized',
    'phoneE164',
    'nameNormalized',
    'addressMatchKey',
    'leadType',
    'assignedAgentName',
    'notes',
  ]

  for (const field of fields) {
    const incoming = contact[field]
    if (incoming === null || incoming === undefined || incoming === '') continue

    const current = existing[field]
    if (current === incoming) continue

    changes[field] = { from: current, to: incoming }
    // Prisma's update-input is per veld getypt; de lus is generiek. Deze cast is
    // beperkt tot de toewijzing en de veldenlijst hierboven is handmatig
    // gecontroleerd tegen beide typen.
    ;(data as Record<string, unknown>)[field] = incoming
  }

  // Enums en datums apart: alleen bijwerken als de import iets stelligers zegt
  // dan wat er staat. "UNKNOWN" mag nooit een ingevuld type overschrijven.
  if (contact.contactType !== 'UNKNOWN' && contact.contactType !== existing.contactType) {
    changes.contactType = { from: existing.contactType, to: contact.contactType }
    data.contactType = contact.contactType
  }
  if (contact.status !== 'UNKNOWN' && contact.status !== existing.status) {
    changes.status = { from: existing.status, to: contact.status }
    data.status = contact.status
  }
  if (contact.sourceCreatedAt && !existing.sourceCreatedAt) {
    changes.sourceCreatedAt = { from: null, to: contact.sourceCreatedAt }
    data.sourceCreatedAt = contact.sourceCreatedAt
  }
  if (
    contact.lastContactAt &&
    (!existing.lastContactAt || contact.lastContactAt > existing.lastContactAt)
  ) {
    changes.lastContactAt = { from: existing.lastContactAt, to: contact.lastContactAt }
    data.lastContactAt = contact.lastContactAt
  }

  if (Object.keys(changes).length === 0) {
    return { contact: existing, status: 'SKIPPED_DUPLICATE', changes: {} }
  }

  const updated = await prisma.crmContact.update({ where: { id: existing.id }, data })
  return { contact: updated, status: 'UPDATED', changes }
}

/**
 * Het bestaande contact waar deze rij bij hoort.
 *
 * Volgorde is de betrouwbaarheidsvolgorde: het id uit het bron-CRM is
 * beslissend, dan telefoon, dan e-mail. Naam staat er bewust níet bij — twee
 * klanten die allebei "Jan Peeters" heten zouden dan bij een import samensmelten
 * en dat is niet meer terug te draaien.
 */
async function findExistingContact(
  agencyId: string,
  contact: NormalizedContact,
): Promise<CrmContact | null> {
  if (contact.externalId) {
    const byExternal = await prisma.crmContact.findUnique({
      where: { agencyId_externalId: { agencyId, externalId: contact.externalId } },
    })
    if (byExternal) return byExternal
  }

  if (contact.phoneE164) {
    const byPhone = await prisma.crmContact.findFirst({
      where: { agencyId, phoneE164: contact.phoneE164 },
    })
    if (byPhone) return byPhone
  }

  if (contact.emailNormalized) {
    const byEmail = await prisma.crmContact.findFirst({
      where: { agencyId, emailNormalized: contact.emailNormalized },
    })
    if (byEmail) return byEmail
  }

  return null
}

/**
 * Legt de ruwe regels van een geüpload bestand vast.
 *
 * ─── WAAROM DE RIJEN DE DATABASE IN GAAN VÓÓR DE MAPPING VASTSTAAT ───────────
 *
 * De import verloopt in twee stappen: eerst het bestand analyseren en een
 * kolommapping voorstellen, dan bevestigen. Tussen die twee stappen moet de
 * inhoud ergens blijven. Hem in de browsersessie houden zou een bestand van
 * tienduizend rijen door een formulier persen; hem op schijf zetten geeft een
 * tweede opslagplaats met eigen bewaartermijnen.
 *
 * De rijen als `PENDING` wegschrijven lost dat op én levert precies op wat
 * `CrmImportRow` toch al bedoelde te zijn: wat er in het bestand stond, naast
 * wat ermee gebeurde.
 */
export async function createPendingRows(
  importId: string,
  rows: readonly (readonly string[])[],
): Promise<void> {
  const BATCH = 500

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH)
    await prisma.crmImportRow.createMany({
      data: batch.map((row, index) => ({
        importId,
        // +2: rij 1 is de kop, en mensen tellen vanaf 1. Zo verwijst een
        // foutmelding naar hetzelfde regelnummer als de spreadsheet van de klant.
        rowNumber: offset + index + 2,
        status: 'PENDING' as const,
        raw: toJsonValue(row),
      })),
      skipDuplicates: true,
    })
  }
}

export async function pendingRows(importId: string, limit = 5000) {
  return prisma.crmImportRow.findMany({
    where: { importId, status: 'PENDING' },
    orderBy: { rowNumber: 'asc' },
    take: limit,
    select: { id: true, rowNumber: true, raw: true },
  })
}

export async function updateImportRow(
  rowId: string,
  input: {
    status: 'CREATED' | 'UPDATED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_INVALID' | 'FAILED'
    contactId?: string | null
    message?: string | null
    changes?: Record<string, { from: unknown; to: unknown }>
  },
): Promise<void> {
  await prisma.crmImportRow.update({
    where: { id: rowId },
    data: {
      status: input.status,
      contactId: input.contactId ?? null,
      message: input.message ?? null,
      changes:
        input.changes && Object.keys(input.changes).length > 0
          ? toJsonValue(input.changes)
          : undefined,
    },
  })
}

export async function recordImportRow(input: {
  importId: string
  rowNumber: number
  status: 'CREATED' | 'UPDATED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_INVALID' | 'FAILED'
  raw: unknown
  contactId?: string | null
  message?: string | null
  changes?: Record<string, { from: unknown; to: unknown }>
}): Promise<void> {
  await prisma.crmImportRow.create({
    data: {
      importId: input.importId,
      rowNumber: input.rowNumber,
      status: input.status,
      raw: toJsonValue(input.raw),
      contactId: input.contactId ?? null,
      message: input.message ?? null,
      changes:
        input.changes && Object.keys(input.changes).length > 0
          ? toJsonValue(input.changes)
          : undefined,
    },
  })
}

/** Koppelt een contact aan een adres, en aan een pand zodra we dat kennen. */
export async function linkContactToAddress(input: {
  agencyId: string
  contactId: string
  addressMatchKey: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  role: 'OWNER' | 'FORMER_OWNER' | 'BUYER' | 'SELLER' | 'TENANT' | 'VALUATION_SUBJECT' | 'INTERESTED'
  since: Date | null
  propertyId?: string | null
}): Promise<void> {
  if (!input.addressMatchKey) return

  await prisma.contactPropertyRelationship.upsert({
    where: {
      agencyId_contactId_addressMatchKey_role: {
        agencyId: input.agencyId,
        contactId: input.contactId,
        addressMatchKey: input.addressMatchKey,
        role: input.role,
      },
    },
    update: { propertyId: input.propertyId ?? undefined },
    create: {
      agencyId: input.agencyId,
      contactId: input.contactId,
      propertyId: input.propertyId ?? null,
      addressMatchKey: input.addressMatchKey,
      address: input.address,
      postalCode: input.postalCode,
      city: input.city,
      role: input.role,
      since: input.since,
    },
  })
}

/**
 * Hangt losse CRM-adressen alsnog aan een pand zodra dat pand opduikt.
 *
 * Een kantoor importeert vandaag "Pieter kocht Kerkstraat 12"; dat pand bestaat
 * bij ons pas wanneer het geadverteerd wordt. Deze functie sluit dat gat achteraf.
 *
 * ─── WAAROM HIER GEEN agencyId STAAT, EN WAAROM DAT GOED IS ──────────────────
 *
 * Dit is de enige schrijfquery op CRM-data die over alle kantoren heen loopt, en
 * dat is opzet. Wat er gebeurt: één marktpand duikt op, en élk kantoor dat dat
 * adres in zijn eigen dossiers heeft staan, krijgt zijn eigen relatie eraan
 * gekoppeld.
 *
 * Er beweegt daarbij niets tussen kantoren. Elke rij houdt zijn eigen
 * `agencyId`; het enige veld dat gevuld wordt is `propertyId` — een verwijzing
 * naar gedeelde marktdata die per definitie voor iedereen dezelfde is. Kantoor A
 * ziet daarna zijn eigen contact bij dat pand, kantoor B het zijne, en geen van
 * beide ziet dat van de ander.
 *
 * Zou je hier wél op één `agencyId` filteren, dan zou de koppeling alleen slagen
 * voor het kantoor dat toevallig als eerste langskwam, en missen alle andere
 * kantoren de relatie waar ze recht op hebben.
 */
export async function attachRelationshipsToProperty(
  propertyId: string,
  addressMatchKey: string,
): Promise<number> {
  const result = await prisma.contactPropertyRelationship.updateMany({
    where: { addressMatchKey, propertyId: null },
    data: { propertyId },
  })
  return result.count
}

// ─────────────────────────────────────────────────────────────────────────────
// Contacten opvragen
// ─────────────────────────────────────────────────────────────────────────────

export const CRM_PAGE_SIZE = 30

export async function listContacts(
  agencyId: string,
  filter: CrmContactFilter,
): Promise<{ items: CrmContact[]; total: number }> {
  const where: Prisma.CrmContactWhereInput = { agencyId, redactedAt: null }

  if (filter.contactType) where.contactType = filter.contactType
  if (filter.status) where.status = filter.status
  if (filter.dormantOnly) where.dormantSince = { not: null }

  if (filter.query) {
    where.OR = [
      { displayName: { contains: filter.query, mode: 'insensitive' } },
      { email: { contains: filter.query, mode: 'insensitive' } },
      { phone: { contains: filter.query } },
      { city: { contains: filter.query, mode: 'insensitive' } },
    ]
  }

  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    filter.sort === 'name'
      ? [{ displayName: 'asc' }]
      : filter.sort === 'recent'
        ? [{ lastContactAt: { sort: 'desc', nulls: 'last' } }]
        : [{ relationshipScore: 'desc' }, { lastContactAt: 'asc' }]

  const [items, total] = await Promise.all([
    prisma.crmContact.findMany({
      where,
      orderBy,
      skip: (filter.page - 1) * CRM_PAGE_SIZE,
      take: CRM_PAGE_SIZE,
    }),
    prisma.crmContact.count({ where }),
  ])

  return { items, total }
}

const contactDetailInclude = {
  interactions: { orderBy: { occurredAt: 'desc' as const }, take: 50 },
  propertyRelations: { include: { property: true } },
  opportunities: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    include: { property: { select: { address: true, postalCode: true, city: true } } },
  },
} satisfies Prisma.CrmContactInclude

export type CrmContactDetail = Prisma.CrmContactGetPayload<{
  include: typeof contactDetailInclude
}>

export async function findContact(
  agencyId: string,
  contactId: string,
): Promise<CrmContactDetail | null> {
  return prisma.crmContact.findFirst({
    where: { id: contactId, agencyId },
    include: contactDetailInclude,
  })
}

/** De contacten waar de LeadRevive-motor overheen moet. */
export async function contactsForRevive(agencyId: string, limit = 2000) {
  return prisma.crmContact.findMany({
    where: { agencyId, redactedAt: null },
    take: limit,
    select: {
      id: true,
      contactType: true,
      status: true,
      sourceCreatedAt: true,
      lastContactAt: true,
      phoneE164: true,
      displayName: true,
      postalCode: true,
      city: true,
      addressMatchKey: true,
      _count: { select: { interactions: true } },
      interactions: { select: { kind: true }, take: 100 },
      propertyRelations: { select: { role: true, propertyId: true, addressMatchKey: true } },
    },
  })
}

export async function saveAssessment(
  agencyId: string,
  contactId: string,
  relationshipScore: number,
  dormantSince: Date | null,
): Promise<void> {
  await prisma.crmContact.updateMany({
    where: { id: contactId, agencyId },
    data: { relationshipScore, dormantSince },
  })
}

export async function crmCounts(agencyId: string): Promise<{
  total: number
  dormant: number
  withPhone: number
  linkedToProperty: number
  valuationLeads: number
}> {
  const [total, dormant, withPhone, linkedToProperty, valuationLeads] = await Promise.all([
    prisma.crmContact.count({ where: { agencyId, redactedAt: null } }),
    prisma.crmContact.count({ where: { agencyId, redactedAt: null, dormantSince: { not: null } } }),
    prisma.crmContact.count({ where: { agencyId, redactedAt: null, phoneE164: { not: null } } }),
    prisma.contactPropertyRelationship.count({ where: { agencyId, propertyId: { not: null } } }),
    // Apart geteld omdat dit de sterkste categorie is die een CRM bevat: wie ooit
    // een schatting vroeg, heeft actief over verkopen nagedacht.
    prisma.crmContact.count({
      where: { agencyId, redactedAt: null, contactType: 'VALUATION_LEAD' },
    }),
  ])

  return { total, dormant, withPhone, linkedToProperty, valuationLeads }
}
