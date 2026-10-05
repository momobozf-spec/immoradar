import type { ListingEvent, OpportunityType } from '@/generated/prisma/client'

import { isConfirmedMatch, matchCrmContact, type CrmMatchResult } from '@/crm/crmMatcher'
import { expiryDaysFor, opportunityTypeFor } from '@/events/opportunityRules'
import { fromPrismaSellerType } from '@/ingestion/ingestListings'
import { addDays, daysBetween, minutesBetween, monthsBetween } from '@/lib/dates'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { normalizeText } from '@/lib/text'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as crmRepository from '@/repositories/crmRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'
import { prisma } from '@/repositories/prisma'
import { scoreOpportunity } from '@/scoring/opportunityScore'
import type { ScoringContext } from '@/scoring/config'
import { bestTerritoryPerAgency } from '@/territories/territoryMatch'

/**
 * Van marktgebeurtenis naar kansen, per kantoor.
 *
 * ─── DE VIER VRAGEN PER EVENT ────────────────────────────────────────────────
 *
 *   1. Is dit commercieel iets?          → opportunityTypeFor
 *   2. Wie werkt daar?                   → territory matching
 *   3. Kent dat kantoor deze mensen al?  → CRM matching (per kantoor apart!)
 *   4. Hoe goed is het?                  → scoring
 *
 * Stap 3 is de reden dat dit per kantoor gebeurt en niet één keer centraal: of
 * er een bestaande relatie is, verschilt per kantoor. Hetzelfde huis is voor
 * kantoor A een koude FSBO en voor kantoor B een oud-klant die ze in 2017 nog
 * geholpen hebben — en dat verschil is precies wat dit product verkoopt.
 */

const logger = createLogger({ component: 'opportunities' })

export interface OpportunityCreationResult {
  created: number
  skippedBelowThreshold: number
  skippedNoTerritory: number
}

export async function createOpportunitiesForEvents(
  events: readonly ListingEvent[],
  now: Date = new Date(),
): Promise<OpportunityCreationResult> {
  const result: OpportunityCreationResult = {
    created: 0,
    skippedBelowThreshold: 0,
    skippedNoTerritory: 0,
  }

  if (events.length === 0) return result

  // Één keer ophalen voor de hele batch: dit is de enige query die over
  // kantoren heen kijkt, en hem per event herhalen zou hem honderden keren
  // draaien voor data die binnen een run niet verandert.
  const territories = await agencyRepository.allActiveTerritories()
  if (territories.length === 0) return result

  for (const event of events) {
    try {
      const outcome = await processEvent(event, territories, now)
      result.created += outcome.created
      result.skippedBelowThreshold += outcome.skippedBelowThreshold
      result.skippedNoTerritory += outcome.skippedNoTerritory
    } catch (error) {
      logger.error('Kon geen kans afleiden uit event', {
        eventId: event.id,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

async function processEvent(
  event: ListingEvent,
  territories: Awaited<ReturnType<typeof agencyRepository.allActiveTerritories>>,
  now: Date,
): Promise<OpportunityCreationResult> {
  const env = getEnv()
  const empty: OpportunityCreationResult = {
    created: 0,
    skippedBelowThreshold: 0,
    skippedNoTerritory: 0,
  }

  const listing = await prisma.listing.findUnique({
    where: { id: event.listingId },
    include: { property: true, seller: true },
  })

  if (!listing?.property) return empty

  const sellerType = fromPrismaSellerType(listing.sellerType)
  const isConfidentPrivate =
    sellerType === 'private' && listing.sellerConfidence >= env.PRIVATE_CONFIDENCE_THRESHOLD

  // 1. Levert dit event een kans op?
  const opportunityType = opportunityTypeFor({
    eventType: event.type,
    sellerType,
    isConfidentPrivate,
    priceDropCount: listing.priceDropCount,
  })

  if (!opportunityType) return empty

  // 2. Welke kantoren werken hier?
  const matches = bestTerritoryPerAgency(
    {
      postalCode: listing.property.postalCode,
      city: listing.property.city,
      province: listing.property.province,
    },
    territories,
  )

  if (matches.length === 0) return { ...empty, skippedNoTerritory: 1 }

  const totalPriceDropPercent =
    listing.initialPrice && listing.currentPrice && listing.initialPrice > listing.currentPrice
      ? ((listing.initialPrice - listing.currentPrice) / listing.initialPrice) * 100
      : 0

  const result = { ...empty }

  for (const territoryMatch of matches) {
    // 3. Kent dít kantoor deze verkoper al? Kandidaten komen uitsluitend uit het
    //    eigen klantenbestand — zie crmRepository.
    const crmMatch = await matchAgainstCrm(territoryMatch.agencyId, listing, env)

    const contactState = crmMatch
      ? await loadContactState(territoryMatch.agencyId, crmMatch.contactId, now)
      : null

    const confirmed = isConfirmedMatch(crmMatch, {
      autoThreshold: env.CRM_MATCH_AUTO_THRESHOLD,
      reviewThreshold: env.CRM_MATCH_REVIEW_THRESHOLD,
    })

    const context: ScoringContext = {
      origin: confirmed ? 'CROSS' : 'MARKET',
      type: opportunityType,

      sellerType,
      sellerConfidence: listing.sellerConfidence,
      hasPhone: Boolean(listing.seller?.phoneE164),

      minutesSinceFirstSeen: minutesBetween(listing.firstSeenAt, now),
      daysOnMarket: daysBetween(listing.firstSeenAt, now),

      priceDropCount: listing.priceDropCount,
      totalPriceDropPercent,

      isRelisted: listing.previousListingId !== null,
      listingCycles: listing.property.listingCycles,

      price: listing.currentPrice,
      highValueThreshold: env.HIGH_VALUE_THRESHOLD,

      hasCrmMatch: confirmed,
      crmMatchConfidence: confirmed ? (crmMatch?.confidence ?? 0) : 0,
      isKnownOwnerOfProperty: confirmed && (crmMatch?.isKnownOwner ?? false),
      monthsSinceLastContact: contactState?.monthsSinceLastContact ?? null,
      relationshipAgeMonths: contactState?.relationshipAgeMonths ?? null,
      hadValuation: contactState?.hadValuation ?? false,
      wasClient: contactState?.wasClient ?? false,
      neverContacted: contactState?.neverContacted ?? false,

      territoryMatch: territoryMatch.precision,
    }

    const score = scoreOpportunity(context)

    if (score.score < env.MIN_OPPORTUNITY_SCORE) {
      result.skippedBelowThreshold += 1
      continue
    }

    const payload = {
      agencyId: territoryMatch.agencyId,
      origin: context.origin,
      type: opportunityType as OpportunityType,
      /**
       * Eén open kans per pand per kantoor. Niet per gebeurtenis, en ook niet
       * per type.
       *
       * ─── WAAROM ZO GROF ────────────────────────────────────────────────────
       *
       * Eén woning brengt in de loop van maanden een reeks signalen voort: FSBO
       * gedetecteerd, dertig dagen gepasseerd, prijs omlaag, ingetrokken,
       * opnieuw geplaatst. Elk daarvan is een geldige reden om te bellen, maar
       * het is één keer bellen — naar dezelfde eigenaar, over hetzelfde huis.
       *
       * Per gebeurtenis een kans zou dat huis zes keer in de ochtendlijst
       * zetten. Per type nog altijd vier keer. Beide maken van "Vandaag te
       * bellen" een logboek in plaats van een selectie, en een makelaar die
       * dezelfde woning vier keer ziet, vertrouwt de rangschikking niet meer.
       *
       * Het `type` van de kans is daarom niet "wat er als eerste gebeurde" maar
       * "de sterkste reden die we nu hebben": `refreshOpportunity` schrijft het
       * type mee zodra een zwaarder signaal langskomt. De volledige reeks
       * gebeurtenissen blijft zichtbaar in de tijdlijn van het pand, waar ze
       * hoort — dat is een geschiedenis, geen takenlijst.
       */
      dedupeKey: `property:${listing.propertyId}`,

      propertyId: listing.propertyId,
      listingId: listing.id,
      sourceEventId: event.id,

      crmContactId: crmMatch?.contactId ?? null,
      crmMatchConfidence: crmMatch?.confidence ?? 0,
      crmMatchReasons: crmMatch?.reasons ?? [],

      matchedTerritoryId: territoryMatch.territoryId,
      matchedTerritoryName: territoryMatch.territoryName,

      score,
      expiresAt: addDays(now, expiryDaysFor(opportunityType, env.OPPORTUNITY_TTL_DAYS)),
      signals: buildSignals(context, crmMatch),
    }

    const created = await opportunityRepository.createOpportunity(payload)

    if (created) {
      result.created += 1
      continue
    }

    // De kans bestond al voor dit pand en dit type. Is dit signaal sterker, dan
    // wint het; anders laten we staan wat er stond. Dat is geen fout maar het
    // normale verloop van een woning die maanden op de markt blijft.
    await opportunityRepository.refreshOpportunity(payload)
  }

  return result
}

async function matchAgainstCrm(
  agencyId: string,
  listing: {
    propertyId: string
    property: { matchKey: string | null; postalCode: string | null }
    seller: { displayName: string | null; phoneE164: string | null } | null
  },
  env: ReturnType<typeof getEnv>,
): Promise<CrmMatchResult | null> {
  const market = {
    propertyId: listing.propertyId,
    propertyMatchKey: listing.property.matchKey,
    postalCode: listing.property.postalCode,
    sellerName: listing.seller?.displayName ?? null,
    sellerNameNormalized: listing.seller?.displayName
      ? normalizeText(listing.seller.displayName)
      : null,
    sellerPhoneE164: listing.seller?.phoneE164 ?? null,
    // Advertenties publiceren vrijwel nooit een e-mailadres. Het veld staat in de
    // matcher omdat de CRM-kant het wél heeft en een toekomstige bron het kan
    // leveren; nu is het consequent null in plaats van half ingevuld.
    sellerEmailNormalized: null,
  }

  const candidates = await crmRepository.findMatchCandidates(agencyId, market)
  if (candidates.length === 0) return null

  return matchCrmContact(market, candidates, {
    autoThreshold: env.CRM_MATCH_AUTO_THRESHOLD,
    reviewThreshold: env.CRM_MATCH_REVIEW_THRESHOLD,
  })
}

interface ContactStateSummary {
  monthsSinceLastContact: number | null
  relationshipAgeMonths: number | null
  hadValuation: boolean
  wasClient: boolean
  neverContacted: boolean
}

async function loadContactState(
  agencyId: string,
  contactId: string,
  now: Date,
): Promise<ContactStateSummary | null> {
  const contact = await prisma.crmContact.findFirst({
    where: { id: contactId, agencyId },
    select: {
      contactType: true,
      status: true,
      sourceCreatedAt: true,
      lastContactAt: true,
      _count: { select: { interactions: true } },
      interactions: { select: { kind: true }, take: 100 },
    },
  })

  if (!contact) return null

  return {
    monthsSinceLastContact: contact.lastContactAt
      ? monthsBetween(contact.lastContactAt, now)
      : null,
    relationshipAgeMonths: contact.sourceCreatedAt
      ? monthsBetween(contact.sourceCreatedAt, now)
      : null,
    hadValuation:
      contact.contactType === 'VALUATION_LEAD' ||
      contact.interactions.some((interaction) => interaction.kind === 'VALUATION'),
    wasClient: contact.status === 'WON' || contact.contactType === 'FORMER_CLIENT',
    neverContacted: contact._count.interactions === 0 && contact.lastContactAt === null,
  }
}

/**
 * De ruwe signalen achter de score, bewaard vóór weging.
 *
 * Apart van de redenen: die zijn de uitleg en veranderen mee wanneer de weging
 * verandert. Deze rijen leggen vast wat we destijds waarnamen, zodat een score
 * van vorige maand reconstrueerbaar blijft.
 */
function buildSignals(
  context: ScoringContext,
  crmMatch: CrmMatchResult | null,
): { kind: 'market' | 'crm'; code: string; label: string; strength: number }[] {
  const signals: { kind: 'market' | 'crm'; code: string; label: string; strength: number }[] = [
    {
      kind: 'market',
      code: 'seller_type',
      label: `Verkopertype ${context.sellerType}`,
      strength: context.sellerConfidence,
    },
  ]

  if (context.priceDropCount > 0) {
    signals.push({
      kind: 'market',
      code: 'price_drops',
      label: `${context.priceDropCount} prijsverlaging(en)`,
      strength: Math.min(1, context.priceDropCount / 3),
    })
  }

  if (context.daysOnMarket !== null && context.daysOnMarket >= 30) {
    signals.push({
      kind: 'market',
      code: 'days_on_market',
      label: `${context.daysOnMarket} dagen online`,
      strength: Math.min(1, context.daysOnMarket / 120),
    })
  }

  if (context.isRelisted) {
    signals.push({ kind: 'market', code: 'relisted', label: 'Herplaatsing', strength: 1 })
  }

  if (crmMatch) {
    signals.push({
      kind: 'crm',
      code: 'crm_match',
      label: crmMatch.reasons[0] ?? 'Koppeling met klantenbestand',
      strength: crmMatch.confidence,
    })
  }

  if (context.isKnownOwnerOfProperty) {
    signals.push({
      kind: 'crm',
      code: 'known_owner',
      label: 'Bekend als betrokkene bij dit pand',
      strength: 1,
    })
  }

  return signals
}
