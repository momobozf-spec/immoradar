import { daysBetween } from '@/lib/dates'

import {
  STALE_EVENT_TYPES,
  type DetectedEvent,
  type ListingStateForEvents,
  type ObservationForEvents,
  type SellerTypeValue,
} from './types'

/**
 * De eventmotor: waar data verandering wordt, en verandering een marktsignaal.
 *
 * ─── WAAROM ALLES HIER PUUR IS ───────────────────────────────────────────────
 *
 * Elke detector is een functie van (vorige toestand, nieuwe waarneming) naar
 * events. Geen database, geen klok uit het niets — `now` komt altijd als
 * argument binnen. Dat maakt de regels waar dit product op drijft testbaar met
 * twee objecten: "prijs van 475.000 naar 449.000 op dag 64" moet één PRICE_DROP
 * opleveren met precies die percentages, en dat mag niet afhangen van wat er
 * toevallig in de database staat.
 *
 * ─── IDEMPOTENTIE ────────────────────────────────────────────────────────────
 *
 * Elke detector geeft een `dedupeKey` mee. De collector draait elke paar
 * minuten; zonder die sleutel zou een advertentie die 64 dagen oud is bij élke
 * run opnieuw "staat 60+ dagen online" melden, en zou de makelaar per dag
 * driehonderd keer dezelfde melding krijgen. De unique-index in de database
 * maakt het dubbel onmogelijk.
 */

/** Datumdeel voor dedupe-sleutels: twee identieke wijzigingen op één dag zijn er één. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Een advertentie die we voor het eerst zien.
 *
 * Levert altijd NEW_LISTING op, en daarnaast FSBO wanneer de verkoper met
 * voldoende zekerheid particulier is. Die twee zijn apart omdat ze verschillende
 * vragen beantwoorden: "wat is er nieuw in mijn gebied" en "waar kan ik een
 * mandaat winnen".
 */
export function detectNewListing(
  listingId: string,
  sellerType: SellerTypeValue,
  isConfidentPrivate: boolean,
  observedAt: Date,
  publishedAt: Date | null,
): DetectedEvent[] {
  const occurredAt = publishedAt && publishedAt <= observedAt ? publishedAt : observedAt

  const events: DetectedEvent[] = [
    {
      type: 'NEW_LISTING',
      occurredAt,
      newSellerType: sellerType,
      dedupeKey: `${listingId}:NEW_LISTING`,
      detail: 'Advertentie voor het eerst waargenomen',
    },
  ]

  if (isConfidentPrivate) {
    events.push({
      type: 'FSBO_DETECTED',
      occurredAt,
      newSellerType: 'private',
      dedupeKey: `${listingId}:FSBO_DETECTED`,
      detail: 'Nieuwe advertentie van een particuliere verkoper',
    })
  }

  return events
}

/**
 * Prijswijziging tussen twee waarnemingen.
 *
 * `minChangePercent` filtert ruis weg: bronnen ronden af, corrigeren typefouten
 * en wisselen soms tussen "vanaf"-prijs en vraagprijs. Een wijziging van 200
 * euro op 495.000 is geen marktsignaal en hoort geen makelaar wakker te maken.
 */
export function detectPriceChange(
  previous: ListingStateForEvents,
  observation: ObservationForEvents,
  minChangePercent: number,
): DetectedEvent[] {
  const oldPrice = previous.price
  const newPrice = observation.price

  if (oldPrice === null || newPrice === null) return []
  if (oldPrice <= 0 || newPrice <= 0) return []
  if (oldPrice === newPrice) return []

  const absolute = Math.abs(oldPrice - newPrice)
  const percentage = (absolute / oldPrice) * 100

  if (percentage < minChangePercent) return []

  const isDrop = newPrice < oldPrice
  const occurredAt = observation.observedAt

  return [
    {
      type: isDrop ? 'PRICE_DROP' : 'PRICE_INCREASE',
      occurredAt,
      oldPrice,
      newPrice,
      absoluteDrop: isDrop ? absolute : -absolute,
      percentageDrop: Number((isDrop ? percentage : -percentage).toFixed(2)),
      daysOnMarket: daysBetween(previous.firstSeenAt, occurredAt),
      dedupeKey: `${previous.id}:${isDrop ? 'PRICE_DROP' : 'PRICE_INCREASE'}:${oldPrice}:${newPrice}:${dayKey(occurredAt)}`,
      detail: isDrop
        ? `Vraagprijs verlaagd van € ${oldPrice.toLocaleString('nl-BE')} naar € ${newPrice.toLocaleString('nl-BE')}`
        : `Vraagprijs verhoogd van € ${oldPrice.toLocaleString('nl-BE')} naar € ${newPrice.toLocaleString('nl-BE')}`,
    },
  ]
}

/**
 * Een woning die van kantoor naar particulier gaat, of omgekeerd.
 *
 * AGENCY_TO_PRIVATE is commercieel het interessantst: het mandaat is afgelopen
 * of opgezegd en de eigenaar probeert het nu zelf. Dat is het moment waarop een
 * makelaar met een goed verhaal kans maakt.
 *
 * `unknown` telt aan geen van beide kanten mee. Een advertentie waarvan we het
 * verkopertype eerst niet konden bepalen en nu wel, is geen overstap — dat is
 * ons die beter is gaan kijken, en daar mag geen melding uit volgen.
 */
export function detectSellerTransition(
  previous: ListingStateForEvents,
  observation: ObservationForEvents,
): DetectedEvent[] {
  const from = previous.sellerType
  const to = observation.sellerType

  if (from === to) return []
  if (from === 'unknown' || to === 'unknown') return []

  const isToPrivate = to === 'private'

  return [
    {
      type: isToPrivate ? 'AGENCY_TO_PRIVATE' : 'PRIVATE_TO_AGENCY',
      occurredAt: observation.observedAt,
      oldSellerType: from,
      newSellerType: to,
      daysOnMarket: daysBetween(previous.firstSeenAt, observation.observedAt),
      dedupeKey: `${previous.id}:${isToPrivate ? 'AGENCY_TO_PRIVATE' : 'PRIVATE_TO_AGENCY'}:${dayKey(observation.observedAt)}`,
      detail: isToPrivate
        ? 'Woning werd eerst professioneel aangeboden en staat nu bij een particulier'
        : 'Woning stond bij een particulier en wordt nu professioneel aangeboden',
    },
  ]
}

/**
 * Advertenties die te lang blijven staan.
 *
 * Per drempel maximaal één event, bijgehouden in `staleDaysReported`. Wordt een
 * advertentie 95 dagen oud terwijl er nog niets gemeld is — bijvoorbeeld omdat
 * het systeem een tijd uit stond — dan komen 30, 60 én 90 alsnog, in die
 * volgorde. Dat is beter dan alleen de hoogste: de timeline van het pand hoort
 * te kloppen, ook achteraf.
 *
 * Drempels waarvoor geen eventtype bestaat worden overgeslagen. Zo kan iemand
 * `STALE_THRESHOLD_DAYS="30,45,60"` instellen zonder dat er een event ontstaat
 * dat de rest van het systeem niet kan verwerken.
 */
export function detectStaleListing(
  listing: ListingStateForEvents,
  now: Date,
  thresholdsDays: readonly number[],
): DetectedEvent[] {
  const age = daysBetween(listing.firstSeenAt, now)
  const reported = new Set(listing.staleDaysReported)

  const events: DetectedEvent[] = []

  for (const threshold of [...thresholdsDays].sort((a, b) => a - b)) {
    if (age < threshold || reported.has(threshold)) continue

    const type = STALE_EVENT_TYPES[threshold]
    if (!type) continue

    events.push({
      type,
      occurredAt: now,
      daysOnMarket: age,
      dedupeKey: `${listing.id}:${type}`,
      detail: `Advertentie staat ${age} dagen online (drempel ${threshold} dagen)`,
    })
  }

  return events
}

/**
 * Een advertentie die uit de bron verdwenen is.
 *
 * ─── WAAROM NIET NA ÉÉN GEMISTE RUN ──────────────────────────────────────────
 *
 * Bronnen paginëren, haperen, doen onderhoud en filteren soms tijdelijk anders.
 * Eén run zonder waarneming betekent zelden dat de woning van de markt is. Zou
 * je er meteen LISTING_REMOVED van maken, dan volgt bij de volgende run een
 * RELISTED — en heeft de makelaar een melding gekregen over een herplaatsing die
 * nooit gebeurd is.
 *
 * De advertentie gaat daarom eerst naar MISSING en pas na
 * `missingRunsBeforeRemoved` opeenvolgende runs naar REMOVED.
 */
export function detectRemoval(
  listing: ListingStateForEvents,
  missingRunsBeforeRemoved: number,
  now: Date,
): DetectedEvent[] {
  if (listing.missedRuns < missingRunsBeforeRemoved) return []

  return [
    {
      type: 'LISTING_REMOVED',
      occurredAt: now,
      daysOnMarket: daysBetween(listing.firstSeenAt, now),
      dedupeKey: `${listing.id}:LISTING_REMOVED`,
      detail: `Niet meer aangetroffen in de bron na ${listing.missedRuns} opeenvolgende runs`,
    },
  ]
}

/**
 * Een woning die eerder werd ingetrokken en nu opnieuw wordt aangeboden.
 *
 * Dit is het event dat de property matching verdient: het werkt ook wanneer het
 * bron-id, de URL, de prijs, de tekst en zelfs de bron veranderd zijn, omdat het
 * over het *pand* gaat en niet over de advertentie.
 *
 * Buiten het venster (`windowDays`) geen event: een woning die vijf jaar geleden
 * te koop stond en nu weer, is geen herplaatsing maar een nieuwe verkoop.
 */
export function detectRelist(
  newListingId: string,
  previous: {
    id: string
    removedAt: Date | null
    lastSeenAt: Date
    price: number | null
  },
  observation: ObservationForEvents,
  windowDays: number,
): DetectedEvent[] {
  const goneSince = previous.removedAt ?? previous.lastSeenAt
  const gapDays = daysBetween(goneSince, observation.observedAt)

  if (gapDays > windowDays) return []

  const oldPrice = previous.price
  const newPrice = observation.price

  const priceNote =
    oldPrice !== null && newPrice !== null && oldPrice !== newPrice
      ? ` Nieuwe vraagprijs € ${newPrice.toLocaleString('nl-BE')} (was € ${oldPrice.toLocaleString('nl-BE')}).`
      : ''

  return [
    {
      type: 'RELISTED',
      occurredAt: observation.observedAt,
      oldPrice: oldPrice ?? undefined,
      newPrice: newPrice ?? undefined,
      dedupeKey: `${newListingId}:RELISTED:${previous.id}`,
      detail: `Pand opnieuw aangeboden na ${gapDays} dagen van de markt.${priceNote}`,
    },
  ]
}

/**
 * Alle detectors voor een bestaande advertentie in één aanroep.
 *
 * De volgorde is de leesvolgorde van een timeline: eerst wat er met de prijs
 * gebeurde, dan met de verkoper, dan hoe lang het al duurt.
 */
export function detectUpdateEvents(
  previous: ListingStateForEvents,
  observation: ObservationForEvents,
  options: { minPriceChangePercent: number; staleThresholdsDays: readonly number[] },
): DetectedEvent[] {
  return [
    ...detectPriceChange(previous, observation, options.minPriceChangePercent),
    ...detectSellerTransition(previous, observation),
    ...detectStaleListing(previous, observation.observedAt, options.staleThresholdsDays),
  ]
}
