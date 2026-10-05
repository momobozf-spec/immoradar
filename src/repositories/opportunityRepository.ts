import type {
  Opportunity,
  OpportunityOrigin,
  OpportunityStatus,
  OpportunityType,
  Prisma,
} from '@/generated/prisma/client'

import { OPEN_OPPORTUNITY_STATUSES, type OpportunityFilter } from '@/domain/schemas'
import { toJsonValue } from '@/lib/json'
import type { OpportunityScoreResult } from '@/scoring/opportunityScore'

import { prisma } from './prisma'
import { isUniqueViolation } from './prismaErrors'

/**
 * Opportunities: aanmaken, opvragen, opvolgen.
 *
 * ─── DE TENANTGRENS LOOPT HIER ───────────────────────────────────────────────
 *
 * Elke functie in dit bestand neemt een `agencyId` en gebruikt hem in de
 * `where`. Er is geen enkele functie die "een opportunity op id" ophaalt zonder
 * kantoorfilter — ook niet als dat een regel korter zou zijn. Zou zo'n functie
 * bestaan, dan is het een kwestie van tijd voor een pagina hem gebruikt met een
 * id uit de URL, en dan is de tenantscheiding weg.
 *
 * ─── IDEMPOTENTIE ────────────────────────────────────────────────────────────
 *
 * `@@unique([agencyId, dedupeKey])` maakt het onmogelijk om dezelfde kans twee
 * keer aan te maken. De pijplijn mag dus zo vaak draaien als hij wil.
 */

export const AGENCY_SCOPE_REQUIRED = 'agencyId is verplicht op elke opportunity-query'

export interface CreateOpportunityInput {
  agencyId: string
  origin: OpportunityOrigin
  type: OpportunityType
  dedupeKey: string

  propertyId?: string | null
  listingId?: string | null
  sourceEventId?: string | null

  crmContactId?: string | null
  crmMatchConfidence?: number
  crmMatchReasons?: string[]

  matchedTerritoryId?: string | null
  matchedTerritoryName?: string | null

  score: OpportunityScoreResult
  expiresAt: Date | null
  /** Ruwe signalen achter de score, bewaard vóór weging. */
  signals?: { kind: 'market' | 'crm'; code: string; label: string; strength: number }[]
}

/**
 * Maakt een kans aan, inclusief uitleg en scoreopbouw.
 *
 * Geeft `null` wanneer de kans er al was. Dat is geen fout maar het normale
 * antwoord bij een herhaalde run, en het is het signaal voor de aanroeper om
 * geen alert te versturen.
 */
export async function createOpportunity(
  input: CreateOpportunityInput,
): Promise<Opportunity | null> {
  const { score } = input

  try {
    return await prisma.opportunity.create({
      data: {
        agencyId: input.agencyId,
        origin: input.origin,
        type: input.type,
        status: 'NEW',
        dedupeKey: input.dedupeKey,

        propertyId: input.propertyId ?? null,
        listingId: input.listingId ?? null,
        sourceEventId: input.sourceEventId ?? null,

        crmContactId: input.crmContactId ?? null,
        crmMatchConfidence: input.crmMatchConfidence ?? 0,
        crmMatchReasons: input.crmMatchReasons ?? [],

        matchedTerritoryId: input.matchedTerritoryId ?? null,
        matchedTerritoryName: input.matchedTerritoryName ?? null,

        score: score.score,
        intentScore: score.intentScore,
        relationshipScore: score.relationshipScore,

        expiresAt: input.expiresAt,

        reasons: {
          create: score.reasons.map((reason, index) => ({
            code: reason.code,
            label: reason.label,
            points: reason.points,
            dimension: reason.dimension,
            rank: index,
          })),
        },

        signals: {
          create: (input.signals ?? []).map((signal) => ({
            kind: signal.kind,
            code: signal.code,
            label: signal.label,
            strength: signal.strength,
          })),
        },

        scoreDetail: {
          create: {
            intent: score.dimensions.intent,
            relationship: score.dimensions.relationship,
            timing: score.dimensions.timing,
            territory: score.dimensions.territory,
            confidence: score.dimensions.confidence,
            total: score.score,
            weightsVersion: score.weightsVersion,
            breakdown: toJsonValue(score.breakdown),
          },
        },
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

/**
 * Versterkt een bestaande kans met een nieuw, zwaarder signaal.
 *
 * ─── HET PROBLEEM DAT DIT OPLOST ─────────────────────────────────────────────
 *
 * Eén woning brengt in de loop van maanden een reeks gebeurtenissen voort: de
 * FSBO wordt gedetecteerd, hij passeert dertig dagen, dan zestig, dan negentig,
 * de prijs zakt, hij wordt ingetrokken en opnieuw geplaatst. Zou elk daarvan een
 * eigen kans worden, dan staat hetzelfde huis zes keer in de lijst van de
 * makelaar — en dan is "Vandaag te bellen" geen selectie meer maar een logboek.
 * Dat is precies het soort ruis waardoor mensen meldingen uitzetten.
 *
 * De dedupe-sleutel loopt daarom per (pand, type) en niet per gebeurtenis. Een
 * volgend signaal van hetzelfde type op hetzelfde pand komt hier terecht.
 *
 * ─── WAAROM ALLEEN OMHOOG, EN ALLEEN ALS ER NOG NIET GEWERKT IS ──────────────
 *
 * Twee grenzen:
 *
 *  1. Een lagere score overschrijft niets. Een woning die negentig dagen online
 *     staat wordt niet minder interessant doordat er vandaag een zwakker signaal
 *     langskomt; het sterkste beeld dat we ooit hadden blijft staan.
 *
 *  2. Zodra een makelaar de kans heeft opgepakt (CONTACTED en verder) blijft ze
 *     onaangeroerd. De score aanpassen onder iemands handen verandert de
 *     volgorde van zijn lijst terwijl hij aan het bellen is, en overschrijft
 *     bovendien de historie waarop de analytics steunen.
 */
export async function refreshOpportunity(
  input: CreateOpportunityInput,
): Promise<Opportunity | null> {
  const existing = await prisma.opportunity.findUnique({
    where: { agencyId_dedupeKey: { agencyId: input.agencyId, dedupeKey: input.dedupeKey } },
  })

  if (!existing) return null

  const REFRESHABLE: OpportunityStatus[] = ['NEW', 'ASSIGNED', 'TO_CONTACT', 'SNOOZED']
  if (!REFRESHABLE.includes(existing.status)) return null
  if (input.score.score <= existing.score) return null

  const { score } = input

  return prisma.$transaction(async (tx) => {
    // Uitleg en signalen horen bij de score; blijft de oude uitleg staan, dan
    // verklaart ze een getal dat er niet meer is.
    await tx.opportunityReason.deleteMany({ where: { opportunityId: existing.id } })
    await tx.opportunitySignal.deleteMany({ where: { opportunityId: existing.id } })

    return tx.opportunity.update({
      where: { id: existing.id },
      data: {
        // De kans blijft van hetzelfde pand, maar hangt nu aan de nieuwste
        // advertentie en gebeurtenis — dat is wat de makelaar moet openen.
        listingId: input.listingId ?? existing.listingId,
        sourceEventId: input.sourceEventId ?? existing.sourceEventId,
        origin: input.origin,
        // Het type volgt de sterkste reden. Een woning die als verse FSBO begon
        // en inmiddels twee keer in prijs is gezakt, is vandaag een
        // prijsdalingsverhaal — met dat gegeven opent de makelaar het gesprek.
        type: input.type,

        crmContactId: input.crmContactId ?? existing.crmContactId,
        crmMatchConfidence: input.crmMatchConfidence ?? existing.crmMatchConfidence,
        crmMatchReasons: input.crmMatchReasons ?? existing.crmMatchReasons,

        score: score.score,
        intentScore: score.intentScore,
        relationshipScore: score.relationshipScore,
        expiresAt: input.expiresAt,

        reasons: {
          create: score.reasons.map((reason, index) => ({
            code: reason.code,
            label: reason.label,
            points: reason.points,
            dimension: reason.dimension,
            rank: index,
          })),
        },

        signals: {
          create: (input.signals ?? []).map((signal) => ({
            kind: signal.kind,
            code: signal.code,
            label: signal.label,
            strength: signal.strength,
          })),
        },

        scoreDetail: {
          upsert: {
            create: {
              intent: score.dimensions.intent,
              relationship: score.dimensions.relationship,
              timing: score.dimensions.timing,
              territory: score.dimensions.territory,
              confidence: score.dimensions.confidence,
              total: score.score,
              weightsVersion: score.weightsVersion,
              breakdown: toJsonValue(score.breakdown),
            },
            update: {
              intent: score.dimensions.intent,
              relationship: score.dimensions.relationship,
              timing: score.dimensions.timing,
              territory: score.dimensions.territory,
              confidence: score.dimensions.confidence,
              total: score.score,
              weightsVersion: score.weightsVersion,
              breakdown: toJsonValue(score.breakdown),
              computedAt: new Date(),
            },
          },
        },
      },
    })
  })
}

/** Bouwt de `where` uit de filters van het dashboard. Altijd met agencyId. */
function buildWhere(agencyId: string, filter: OpportunityFilter): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = { agencyId }

  if (filter.status === 'OPEN') {
    where.status = { in: [...OPEN_OPPORTUNITY_STATUSES] }
    // Gesnoozede kansen komen vanzelf terug zodra hun wektijd verstreken is.
    where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }]
  } else if (filter.status !== 'ALL') {
    where.status = filter.status as OpportunityStatus
  }

  if (filter.type) where.type = filter.type as OpportunityType
  if (filter.origin) where.origin = filter.origin as OpportunityOrigin
  if (filter.crmOnly) where.crmContactId = { not: null }
  if (filter.assignedUserId) where.assignedUserId = filter.assignedUserId
  if (filter.minScore !== undefined) where.score = { gte: filter.minScore }

  if (filter.maxAgeDays !== undefined) {
    where.createdAt = { gte: new Date(Date.now() - filter.maxAgeDays * 86_400_000) }
  }

  const property: Prisma.PropertyWhereInput = {}
  if (filter.postalCode) property.postalCode = filter.postalCode
  if (filter.city) property.city = { equals: filter.city, mode: 'insensitive' }
  if (filter.propertyType) property.propertyType = filter.propertyType
  if (Object.keys(property).length > 0) where.property = property

  const listing: Prisma.ListingWhereInput = {}
  if (filter.sellerType) listing.sellerType = filter.sellerType
  if (filter.sourceKey) listing.source = { key: filter.sourceKey }
  if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
    listing.currentPrice = {
      ...(filter.minPrice !== undefined ? { gte: filter.minPrice } : {}),
      ...(filter.maxPrice !== undefined ? { lte: filter.maxPrice } : {}),
    }
  }
  if (Object.keys(listing).length > 0) where.listing = listing

  return where
}

function buildOrderBy(sort: OpportunityFilter['sort']): Prisma.OpportunityOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }]
    case 'price':
      return [{ listing: { currentPrice: 'desc' } }, { score: 'desc' }]
    case 'relationship':
      return [{ relationshipScore: 'desc' }, { score: 'desc' }]
    case 'score':
      return [{ score: 'desc' }, { createdAt: 'desc' }]
  }
}

export const OPPORTUNITY_PAGE_SIZE = 25

const listInclude = {
  property: true,
  listing: {
    include: {
      source: { select: { key: true, name: true } },
      seller: { select: { displayName: true, phoneE164: true, classification: true } },
    },
  },
  crmContact: {
    select: { id: true, displayName: true, contactType: true, lastContactAt: true },
  },
  assignedUser: { select: { id: true, name: true, email: true } },
  reasons: { orderBy: { rank: 'asc' as const }, take: 6 },
} satisfies Prisma.OpportunityInclude

export type OpportunityListItem = Prisma.OpportunityGetPayload<{ include: typeof listInclude }>

export async function listOpportunities(
  agencyId: string,
  filter: OpportunityFilter,
): Promise<{ items: OpportunityListItem[]; total: number }> {
  const where = buildWhere(agencyId, filter)

  const [items, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: buildOrderBy(filter.sort),
      skip: (filter.page - 1) * OPPORTUNITY_PAGE_SIZE,
      take: OPPORTUNITY_PAGE_SIZE,
      include: listInclude,
    }),
    prisma.opportunity.count({ where }),
  ])

  return { items, total }
}

/**
 * Tellers voor de kopregel van het dashboard.
 *
 * Aparte functie en geen `listOpportunities().total`: de startpagina wil vier
 * getallen die elk een andere doorsnede beschrijven, en die vier keer de
 * volledige lijst met relaties ophalen om er de lengte van te nemen zou vier
 * joins over honderden rijen kosten voor vier gehele getallen.
 */
export async function countOpportunities(
  agencyId: string,
  options: {
    origin?: OpportunityOrigin
    /** Alleen wat nog werk vraagt. */
    open?: boolean
    /** Alleen kansen die in de laatste N uur zijn ontstaan. */
    sinceHours?: number
    assignedUserId?: string
  } = {},
): Promise<number> {
  const where: Prisma.OpportunityWhereInput = { agencyId }

  if (options.origin) where.origin = options.origin
  if (options.assignedUserId) where.assignedUserId = options.assignedUserId

  if (options.open) {
    where.status = { in: [...OPEN_OPPORTUNITY_STATUSES] }
    where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }]
  }

  if (options.sinceHours !== undefined) {
    where.createdAt = { gte: new Date(Date.now() - options.sinceHours * 3_600_000) }
  }

  return prisma.opportunity.count({ where })
}

const detailInclude = {
  property: {
    include: {
      contactRelations: { include: { contact: true } },
    },
  },
  listing: {
    include: {
      source: true,
      seller: true,
      snapshots: { orderBy: { capturedAt: 'asc' as const }, take: 100 },
    },
  },
  crmContact: {
    include: {
      interactions: { orderBy: { occurredAt: 'desc' as const }, take: 25 },
      propertyRelations: true,
    },
  },
  assignedUser: { select: { id: true, name: true, email: true } },
  reasons: { orderBy: { rank: 'asc' as const } },
  signals: true,
  scoreDetail: true,
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
    include: { user: { select: { name: true, email: true } } },
  },
  alerts: { orderBy: { createdAt: 'desc' as const }, take: 10 },
} satisfies Prisma.OpportunityInclude

export type OpportunityDetail = Prisma.OpportunityGetPayload<{ include: typeof detailInclude }>

/** Eén kans, altijd binnen het eigen kantoor. Null als hij van iemand anders is. */
export async function findOpportunity(
  agencyId: string,
  opportunityId: string,
): Promise<OpportunityDetail | null> {
  return prisma.opportunity.findFirst({
    where: { id: opportunityId, agencyId },
    include: detailInclude,
  })
}

export interface StatusChangeInput {
  agencyId: string
  opportunityId: string
  userId: string
  status?: OpportunityStatus
  snoozedUntil?: Date | null
  assignedUserId?: string | null
  note?: string | null
  kind: 'status_change' | 'note' | 'assigned' | 'snoozed'
}

/**
 * Wijzigt een kans en legt vast wat er gebeurde.
 *
 * De `updateMany` met `agencyId` in de `where` is geen voorzichtigheid maar de
 * beveiliging zelf: raakt hij nul rijen, dan hoorde de kans bij een ander
 * kantoor en gebeurt er niets. Een `update` op id alleen zou wél schrijven.
 */
export async function applyOpportunityAction(input: StatusChangeInput): Promise<boolean> {
  const existing = await prisma.opportunity.findFirst({
    where: { id: input.opportunityId, agencyId: input.agencyId },
    select: { id: true, status: true, assignedUserId: true },
  })

  if (!existing) return false

  const data: Prisma.OpportunityUpdateManyMutationInput = {}

  if (input.status && input.status !== existing.status) {
    data.status = input.status
    data.statusChangedAt = new Date()
    if (input.status === 'CONTACTED') data.contactedAt = new Date()
    // Uit de wacht halen zodra iemand er weer iets mee doet.
    if (input.status !== 'SNOOZED') data.snoozedUntil = null
  }

  if (input.snoozedUntil !== undefined) {
    data.snoozedUntil = input.snoozedUntil
    if (input.snoozedUntil) {
      data.status = 'SNOOZED'
      data.statusChangedAt = new Date()
    }
  }

  if (input.note) data.note = input.note

  const updated = await prisma.opportunity.updateMany({
    where: { id: input.opportunityId, agencyId: input.agencyId },
    data,
  })

  if (updated.count === 0) return false

  if (input.assignedUserId !== undefined) {
    await reassign(input)
  }

  await prisma.opportunityActivity.create({
    data: {
      opportunityId: input.opportunityId,
      userId: input.userId,
      kind: input.kind,
      fromStatus: existing.status,
      toStatus: input.status ?? existing.status,
      note: input.note ?? null,
    },
  })

  return true
}

/**
 * Toewijzing als geschiedenis, niet als kolom.
 *
 * De vorige toewijzing wordt afgesloten (`unassignedAt`) in plaats van
 * overschreven, zodat "deze lead is drie keer doorgegeven" achteraf zichtbaar is.
 */
async function reassign(input: StatusChangeInput): Promise<void> {
  await prisma.opportunityAssignment.updateMany({
    where: { opportunityId: input.opportunityId, unassignedAt: null },
    data: { unassignedAt: new Date() },
  })

  await prisma.opportunity.updateMany({
    where: { id: input.opportunityId, agencyId: input.agencyId },
    data: { assignedUserId: input.assignedUserId ?? null },
  })

  if (input.assignedUserId) {
    await prisma.opportunityAssignment.create({
      data: {
        opportunityId: input.opportunityId,
        assignedToId: input.assignedUserId,
        assignedById: input.userId,
        reason: input.note ?? null,
      },
    })
  }
}

/** Kansen die klaarstaan voor een realtime alert. */
export async function opportunitiesAwaitingAlert(
  agencyId: string,
  minScore: number,
  types: readonly OpportunityType[],
  requireCrmMatch: boolean,
  alertRuleId: string,
  limit = 25,
): Promise<OpportunityListItem[]> {
  return prisma.opportunity.findMany({
    where: {
      agencyId,
      status: 'NEW',
      score: { gte: minScore },
      ...(types.length > 0 ? { type: { in: [...types] } } : {}),
      ...(requireCrmMatch ? { crmContactId: { not: null } } : {}),
      // Nog geen alert voor deze regel. De unique dedupeKey op Alert vangt de
      // race; dit voorkomt het overbodige werk.
      alerts: { none: { alertRuleId } },
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: limit,
    include: listInclude,
  })
}

/** De kansen van vandaag, voor de ochtenddigest. */
export async function opportunitiesForDigest(
  agencyId: string,
  since: Date,
  minScore: number,
  limit = 50,
): Promise<OpportunityListItem[]> {
  return prisma.opportunity.findMany({
    where: { agencyId, createdAt: { gte: since }, score: { gte: minScore } },
    orderBy: [{ score: 'desc' }],
    take: limit,
    include: listInclude,
  })
}

/**
 * Laat verlopen kansen vallen.
 *
 * Alleen wat nog `NEW` is: zodra iemand een kans heeft opgepakt, is het zijn
 * werk en niet aan een achtergrondtaak om die weg te halen.
 */
export async function expireStaleOpportunities(now: Date): Promise<number> {
  const result = await prisma.opportunity.updateMany({
    where: { status: 'NEW', expiresAt: { lt: now } },
    data: { status: 'DISMISSED', statusChangedAt: now },
  })
  return result.count
}
