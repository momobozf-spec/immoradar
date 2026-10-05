import { daysBetween, formatRelative } from '@/lib/dates'
import { prisma } from '@/repositories/prisma'

/**
 * De marktcijfers achter de Marktradar.
 *
 * ─── WAAROM MEDIANEN EN GEEN GEMIDDELDEN ─────────────────────────────────────
 *
 * Eén villa van 2,4 miljoen tussen veertig rijwoningen tilt het gemiddelde
 * dertig procent omhoog en maakt het cijfer onbruikbaar voor de vraag waar het
 * om gaat: "wat is hier normaal". De mediaan negeert die uitschieter, en
 * vastgoedmarkten zitten er vol mee.
 *
 * ─── WAAROM DIT NIET OP agencyId FILTERT ─────────────────────────────────────
 *
 * Marktdata is publiek en gedeeld. De begrenzing loopt via de postcodes van het
 * kantoor: dat is een relevantiefilter, geen tenantgrens. Zou hier een lege
 * postcodelijst tot "heel België" leiden, dan kreeg een kantoor zonder gebieden
 * cijfers over markten waar het niets doet — verwarrend, maar geen datalek. Het
 * levert daarom bewust een leeg resultaat.
 */

export interface LocalityRow {
  postalCode: string
  city: string | null
  active: number
  private: number
  medianPrice: number | null
}

export interface MarketEventRow {
  id: string
  label: string
  place: string
  province: string | null
  when: string
}

export interface MarketOverview {
  activeListings: number
  privateListings: number
  privateShare: number
  medianPrice: number | null
  medianDaysOnMarket: number
  byLocality: LocalityRow[]
  recentEvents: MarketEventRow[]
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) return sorted[middle] ?? null

  const low = sorted[middle - 1]
  const high = sorted[middle]
  if (low === undefined || high === undefined) return null
  return Math.round((low + high) / 2)
}

const EVENT_LABELS: Record<string, string> = {
  NEW_LISTING: 'Nieuwe advertentie',
  FSBO_DETECTED: 'Particuliere verkoper herkend',
  PRICE_DROP: 'Prijs verlaagd',
  PRICE_INCREASE: 'Prijs verhoogd',
  STALE_30: '30 dagen online',
  STALE_60: '60 dagen online',
  STALE_90: '90 dagen online',
  LISTING_REMOVED: 'Advertentie ingetrokken',
  RELISTED: 'Opnieuw aangeboden',
  AGENCY_TO_PRIVATE: 'Van kantoor naar particulier',
  PRIVATE_TO_AGENCY: 'Van particulier naar kantoor',
}

export async function marketOverview(options: {
  postalCodes: readonly string[]
  days: number
}): Promise<MarketOverview> {
  const empty: MarketOverview = {
    activeListings: 0,
    privateListings: 0,
    privateShare: 0,
    medianPrice: null,
    medianDaysOnMarket: 0,
    byLocality: [],
    recentEvents: [],
  }

  if (options.postalCodes.length === 0) return empty

  const postalCodes = [...options.postalCodes]
  const since = new Date(Date.now() - options.days * 86_400_000)

  const [listings, events] = await Promise.all([
    prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        property: { postalCode: { in: postalCodes } },
      },
      select: {
        id: true,
        currentPrice: true,
        sellerType: true,
        firstSeenAt: true,
        property: { select: { postalCode: true, city: true } },
      },
    }),
    prisma.listingEvent.findMany({
      where: {
        occurredAt: { gte: since },
        property: { postalCode: { in: postalCodes } },
        // De gebeurtenissen die iets over de markt zeggen. Een stale-drempel is
        // hier ruis: hij zegt dat de tijd verstreek, niet dat er iets gebeurde.
        type: {
          in: ['PRICE_DROP', 'PRICE_INCREASE', 'LISTING_REMOVED', 'RELISTED', 'AGENCY_TO_PRIVATE'],
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 25,
      include: {
        property: { select: { address: true, city: true, postalCode: true, province: true } },
      },
    }),
  ])

  const now = new Date()
  const prices = listings
    .map((listing) => listing.currentPrice)
    .filter((price): price is number => price !== null && price > 0)

  const ages = listings.map((listing) => daysBetween(listing.firstSeenAt, now))

  const privateListings = listings.filter((listing) => listing.sellerType === 'PRIVATE').length

  // Per postcode groeperen. In geheugen en niet in SQL, omdat de mediaan per
  // groep anders een window function vraagt die Prisma niet aanbiedt — en de
  // dataset per kantoor is klein genoeg dat het verschil niet merkbaar is.
  const localities = new Map<string, { city: string | null; prices: number[]; private: number; active: number }>()

  for (const listing of listings) {
    const postalCode = listing.property.postalCode
    if (!postalCode) continue

    const entry = localities.get(postalCode) ?? {
      city: listing.property.city,
      prices: [],
      private: 0,
      active: 0,
    }

    entry.active += 1
    if (listing.sellerType === 'PRIVATE') entry.private += 1
    if (listing.currentPrice && listing.currentPrice > 0) entry.prices.push(listing.currentPrice)

    localities.set(postalCode, entry)
  }

  return {
    activeListings: listings.length,
    privateListings,
    privateShare: listings.length === 0 ? 0 : (privateListings / listings.length) * 100,
    medianPrice: median(prices),
    medianDaysOnMarket: median(ages) ?? 0,

    byLocality: [...localities.entries()]
      .map(([postalCode, entry]) => ({
        postalCode,
        city: entry.city,
        active: entry.active,
        private: entry.private,
        medianPrice: median(entry.prices),
      }))
      .sort((a, b) => b.active - a.active),

    recentEvents: events.map((event) => ({
      id: event.id,
      label: EVENT_LABELS[event.type] ?? event.type,
      place:
        event.property.address ??
        [event.property.postalCode, event.property.city].filter(Boolean).join(' '),
      province: event.property.province,
      when: formatRelative(event.occurredAt),
    })),
  }
}
