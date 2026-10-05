/**
 * Wat de eventmotor teruggeeft.
 *
 * Bewust losgekoppeld van Prisma: de detectors zijn pure functies die met deze
 * typen werken, zodat elke regel ("een prijsdaling van minder dan een half
 * procent is ruis") te testen is met twee objecten en zonder database.
 */

export type DetectedEventType =
  | 'NEW_LISTING'
  | 'FSBO_DETECTED'
  | 'PRICE_DROP'
  | 'PRICE_INCREASE'
  | 'STALE_30'
  | 'STALE_60'
  | 'STALE_90'
  | 'LISTING_REMOVED'
  | 'RELISTED'
  | 'AGENCY_TO_PRIVATE'
  | 'PRIVATE_TO_AGENCY'

/**
 * De stale-drempels zijn aparte eventtypen en geen parameter op één `STALE`.
 *
 * Dat is geen cosmetiek: "staat 90 dagen online" is commercieel een ander
 * gesprek dan "staat 30 dagen online", de scoring weegt ze verschillend, en het
 * dashboard moet erop kunnen filteren. Een drempel die niet in deze tabel staat
 * levert geen event op — liever niets melden dan een event met een type dat de
 * rest van het systeem niet kent.
 */
export const STALE_EVENT_TYPES: Readonly<Record<number, DetectedEventType>> = {
  30: 'STALE_30',
  60: 'STALE_60',
  90: 'STALE_90',
}

/** Bij welke dagdrempel hoort dit event? Null voor niet-stale events. */
export function staleThresholdOf(type: DetectedEventType): number | null {
  switch (type) {
    case 'STALE_30':
      return 30
    case 'STALE_60':
      return 60
    case 'STALE_90':
      return 90
    default:
      return null
  }
}

export type SellerTypeValue = 'private' | 'professional' | 'unknown'

export interface DetectedEvent {
  type: DetectedEventType
  /** Wanneer het gebeurde volgens de data — niet wanneer wij het zagen. */
  occurredAt: Date

  oldPrice?: number
  newPrice?: number
  absoluteDrop?: number
  percentageDrop?: number

  daysOnMarket?: number

  oldSellerType?: SellerTypeValue
  newSellerType?: SellerTypeValue

  detail?: string

  /**
   * Maakt het event idempotent. De unique-index op deze sleutel zorgt ervoor dat
   * dezelfde prijsdaling niet twee keer wordt vastgelegd, ook niet wanneer twee
   * workers tegelijk dezelfde advertentie verwerken of een run opnieuw draait.
   */
  dedupeKey: string
}

/** De toestand van een advertentie zoals de detectors hem nodig hebben. */
export interface ListingStateForEvents {
  id: string
  price: number | null
  initialPrice: number | null
  sellerType: SellerTypeValue
  firstSeenAt: Date
  lastSeenAt: Date
  publishedAt: Date | null
  /** Op welke stale-drempels al gemeld is. */
  staleDaysReported: number[]
  priceDropCount: number
  missedRuns: number
}

/** De nieuwe waarneming waartegen de vorige toestand wordt afgezet. */
export interface ObservationForEvents {
  price: number | null
  sellerType: SellerTypeValue
  observedAt: Date
}
