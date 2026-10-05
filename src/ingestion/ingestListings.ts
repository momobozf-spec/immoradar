import type { ListingEvent, SellerType, Source } from '@/generated/prisma/client'

import { classifySeller } from '@/domain/classification/sellerClassifier'
import type { ClassifiedListing, RawListing, SellerTypeValue } from '@/domain/types'
import {
  detectNewListing,
  detectRelist,
  detectRemoval,
  detectUpdateEvents,
} from '@/events/detectors'
import { staleThresholdOf } from '@/events/types'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { matchProperty } from '@/matching/propertyMatcher'
import { normalizeListing } from '@/normalization/normalizeListing'
import * as eventRepository from '@/repositories/eventRepository'
import * as listingRepository from '@/repositories/listingRepository'
import * as propertyRepository from '@/repositories/propertyRepository'
import * as sellerRepository from '@/repositories/sellerRepository'
import { attachRelationshipsToProperty } from '@/repositories/crmRepository'

/**
 * De opnamepijplijn: van ruwe advertentie naar pandgeschiedenis en events.
 *
 * ─── DE VOLGORDE IS DE INHOUD ────────────────────────────────────────────────
 *
 *   normaliseren → verkoper herkennen → classificeren → pand koppelen
 *   → advertentie opslaan → snapshot → events afleiden
 *
 * Elke stap hangt van de vorige af, en de belangrijkste is "pand koppelen". Pas
 * daarna kan het systeem zeggen dat deze advertentie over hetzelfde huis gaat
 * als die van vorig jaar, en pas dan bestaat er zoiets als een herplaatsing.
 *
 * ─── FOUTEN ISOLEREN PER ADVERTENTIE ─────────────────────────────────────────
 *
 * Eén onparseerbare advertentie mag een run van driehonderd niet slopen. Elke
 * advertentie loopt daarom in zijn eigen try/catch; wat misgaat wordt geteld als
 * `rejected` en komt als warning in de collectorrun te staan. De bron gaat dan
 * naar PARTIAL — zichtbaar in het dashboard, zonder dat de rest verloren gaat.
 */

const logger = createLogger({ component: 'ingestion' })

export interface IngestionResult {
  fetched: number
  created: number
  updated: number
  unchanged: number
  rejected: number
  /** De nieuw vastgelegde events; hieruit ontstaan de opportunities. */
  events: ListingEvent[]
  warnings: string[]
}

export async function ingestListings(
  source: Source,
  raws: readonly RawListing[],
  now: Date = new Date(),
): Promise<IngestionResult> {
  const env = getEnv()
  const log = logger.child({ source: source.key })

  const result: IngestionResult = {
    fetched: raws.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    events: [],
    warnings: [],
  }

  const seenSourceListingIds: string[] = []

  for (const raw of raws) {
    try {
      const events = await ingestOne(source, raw, now, result)
      result.events.push(...events)
      seenSourceListingIds.push(raw.sourceListingId)
    } catch (error) {
      result.rejected += 1
      const message = error instanceof Error ? error.message : String(error)
      result.warnings.push(`${raw.sourceListingId}: ${message}`)
      log.warn('Advertentie overgeslagen', { sourceListingId: raw.sourceListingId, error: message })
    }
  }

  // ── Verdwenen advertenties ────────────────────────────────────────────────
  //
  // Alleen zinvol als de run daadwerkelijk iets opleverde. Bij een lege run —
  // een bron die hapert, een netwerkstoring — zou élke advertentie als gemist
  // tellen en zou de hele voorraad na drie storingen "verwijderd" heten.
  if (seenSourceListingIds.length > 0) {
    const removalEvents = await processRemovals(source, seenSourceListingIds, now, env)
    result.events.push(...removalEvents)
  } else if (raws.length === 0) {
    result.warnings.push(
      'Run leverde geen advertenties op; verwijderdetectie overgeslagen om valse intrekkingen te voorkomen.',
    )
  }

  return result
}

/** Eén advertentie door de volledige pijplijn. */
async function ingestOne(
  source: Source,
  raw: RawListing,
  now: Date,
  result: IngestionResult,
): Promise<ListingEvent[]> {
  const env = getEnv()

  // 1. Normaliseren. Gooit bij ongeldige invoer; de aanroeper telt dat als rejected.
  const normalized = normalizeListing(raw)

  // 2. Verkoper herkennen.
  const seller = await sellerRepository.resolveSeller(
    { displayName: normalized.sellerName, phoneE164: normalized.sellerPhoneE164 },
    now,
  )

  const activeListingCount = seller ? await sellerRepository.countActiveListings(seller.id) : 0

  // 3. Classificeren. `activeListingCount` komt van buiten zodat de classifier
  //    puur blijft.
  const classification = classifySeller(
    {
      sellerName: normalized.sellerName,
      sellerPhoneE164: normalized.sellerPhoneE164,
      sellerPhoneIsMobile: normalized.sellerPhoneIsMobile,
      title: normalized.title,
      description: normalized.description,
      sourceHint: normalized.sellerTypeHint,
      activeListingCount,
    },
    { professionalListingThreshold: env.PROFESSIONAL_LISTING_COUNT_THRESHOLD },
  )

  const listing: ClassifiedListing = { ...normalized, classification }

  if (seller) {
    await sellerRepository.applyClassification(seller.id, classification, activeListingCount)

    // Professionele verkopers krijgen een marktidentiteit; dat is wat Competitor
    // Radar voedt.
    if (classification.type === 'professional' && classification.agencyName) {
      await sellerRepository.linkAgencyIdentity(
        seller.id,
        classification.agencyName,
        normalized.sellerPhoneE164,
        now,
      )
    }
  }

  const isConfidentPrivate =
    classification.type === 'private' &&
    classification.confidence >= env.PRIVATE_CONFIDENCE_THRESHOLD

  const existing = await listingRepository.findBySourceListingId(
    source.id,
    normalized.sourceListingId,
  )

  // ── Bestaande advertentie ───────────────────────────────────────────────
  if (existing) {
    const changed = existing.contentHash !== normalized.contentHash

    const previousState = {
      id: existing.id,
      price: existing.currentPrice,
      initialPrice: existing.initialPrice,
      sellerType: fromPrismaSellerType(existing.sellerType),
      firstSeenAt: existing.firstSeenAt,
      lastSeenAt: existing.lastSeenAt,
      publishedAt: existing.publishedAt,
      staleDaysReported: existing.staleDaysReported,
      priceDropCount: existing.priceDropCount,
      missedRuns: existing.missedRuns,
    }

    const detected = detectUpdateEvents(
      previousState,
      { price: normalized.price, sellerType: classification.type, observedAt: now },
      {
        minPriceChangePercent: env.PRICE_CHANGE_MIN_PERCENT,
        staleThresholdsDays: env.STALE_THRESHOLD_DAYS,
      },
    )

    const priceDropped = detected.some((event) => event.type === 'PRICE_DROP')

    await listingRepository.applyObservation({
      listingId: existing.id,
      listing,
      sellerId: seller?.id ?? null,
      changed,
      priceDropped,
      now,
    })

    const events = await eventRepository.recordEvents(existing.id, existing.propertyId, detected)

    // Onthouden welke stale-drempels gemeld zijn, zodat de volgende run niet
    // opnieuw "staat 61 dagen online" zegt.
    const reportedThresholds = events
      .map((event) => staleThresholdOf(event.type))
      .filter((threshold): threshold is number => threshold !== null)

    if (reportedThresholds.length > 0) {
      await listingRepository.recordStaleThreshold(existing.id, [
        ...new Set([...existing.staleDaysReported, ...reportedThresholds]),
      ])
    }

    if (changed) result.updated += 1
    else result.unchanged += 1

    return events
  }

  // ── Nieuwe advertentie ──────────────────────────────────────────────────

  // 4. Aan welk pand hoort dit?
  const candidates = await propertyRepository.findCandidates(normalized)
  const match = matchProperty(normalized, candidates, {
    matchThreshold: env.PROPERTY_MATCH_THRESHOLD,
    reviewThreshold: env.PROPERTY_MATCH_REVIEW_THRESHOLD,
  })

  let propertyId: string

  if (match.propertyId) {
    // Bestaand pand: aanvullen met wat deze advertentie toevoegt, nooit
    // overschrijven. Zie `enrichProperty`.
    propertyId = match.propertyId
    await propertyRepository.enrichProperty(propertyId, normalized, now)
  } else {
    const created = await propertyRepository.createProperty(normalized, now)
    propertyId = created.id
  }

  // Losse CRM-adressen die op dit pand wachtten alsnog koppelen. Een kantoor kan
  // "Pieter kocht Kerkstraat 12" al geïmporteerd hebben voordat dat pand hier
  // bestond.
  if (normalized.matchKey) {
    await attachRelationshipsToProperty(propertyId, normalized.matchKey)
  }

  // 5. Is dit een herplaatsing van een eerdere advertentie voor dit pand?
  const previousListing = await listingRepository.findRemovedListingForProperty(propertyId, null)

  const created = await listingRepository.createListing({
    propertyId,
    sourceId: source.id,
    sellerId: seller?.id ?? null,
    listing,
    now,
    previousListingId: previousListing?.id,
  })

  const detected = [
    ...detectNewListing(
      created.id,
      classification.type,
      isConfidentPrivate,
      now,
      normalized.publishedAt,
    ),
  ]

  if (previousListing) {
    detected.push(
      ...detectRelist(
        created.id,
        {
          id: previousListing.id,
          removedAt: previousListing.removedAt,
          lastSeenAt: previousListing.lastSeenAt,
          price: previousListing.currentPrice,
        },
        { price: normalized.price, sellerType: classification.type, observedAt: now },
        env.RELIST_WINDOW_DAYS,
      ),
    )

    // Het pand staat opnieuw op de markt; dat telt mee in de scoring.
    if (detected.some((event) => event.type === 'RELISTED')) {
      await propertyRepository.incrementListingCycles(propertyId)
    }
  }

  result.created += 1
  return eventRepository.recordEvents(created.id, propertyId, detected)
}

/**
 * Advertenties die deze run niet gezien zijn.
 *
 * De statuswijziging naar REMOVED gebeurt pas nadat het event is vastgelegd. Zo
 * kan een crash tussen die twee stappen niet leiden tot een advertentie die
 * stilletjes verdwijnt zonder LISTING_REMOVED in de timeline — de volgende run
 * pakt hem dan gewoon opnieuw op.
 */
async function processRemovals(
  source: Source,
  seenSourceListingIds: readonly string[],
  now: Date,
  env: ReturnType<typeof getEnv>,
): Promise<ListingEvent[]> {
  const crossing = await listingRepository.markMissing(
    source.id,
    seenSourceListingIds,
    env.COLLECTOR_MISSING_RUNS_BEFORE_REMOVED,
  )

  const events: ListingEvent[] = []

  for (const listing of crossing) {
    const detected = detectRemoval(
      {
        id: listing.id,
        price: listing.currentPrice,
        initialPrice: listing.initialPrice,
        sellerType: fromPrismaSellerType(listing.sellerType),
        firstSeenAt: listing.firstSeenAt,
        lastSeenAt: listing.lastSeenAt,
        publishedAt: listing.publishedAt,
        staleDaysReported: listing.staleDaysReported,
        priceDropCount: listing.priceDropCount,
        missedRuns: listing.missedRuns,
      },
      env.COLLECTOR_MISSING_RUNS_BEFORE_REMOVED,
      now,
    )

    const recorded = await eventRepository.recordEvents(listing.id, listing.propertyId, detected)
    events.push(...recorded)

    await listingRepository.markRemoved(listing.id, now)
  }

  return events
}

export function fromPrismaSellerType(value: SellerType): SellerTypeValue {
  switch (value) {
    case 'PRIVATE':
      return 'private'
    case 'PROFESSIONAL':
      return 'professional'
    case 'UNKNOWN':
      return 'unknown'
  }
}
