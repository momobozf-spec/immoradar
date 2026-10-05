import type { ListingStatus, Prisma, Property, SellerType } from '@/generated/prisma/client'

import type { NormalizedListing, PropertyTypeValue } from '@/domain/types'
import type { PropertyCandidate } from '@/matching/propertyMatcher'
import { toPrismaPropertyType } from '@/normalization/normalizeListing'

import { prisma } from './prisma'

/**
 * Panden opzoeken en aanmaken.
 *
 * ─── DE KANDIDAATSELECTIE ────────────────────────────────────────────────────
 *
 * De matcher is nauwkeurig maar duur: hij vergelijkt teksten. Hem loslaten op
 * alle panden in de database zou bij elke advertentie een tafelscan met
 * Levenshtein-berekeningen betekenen.
 *
 * Deze module levert daarom een korte lijst plausibele kandidaten, langs drie
 * wegen die elkaar aanvullen:
 *
 *   1. Exacte adressleutel  — het pand staat er al, één index-lookup.
 *   2. Postcode + type      — zelfde gemeente, zelfde soort woning. Vangt de
 *                             gevallen waar het huisnummer ontbreekt of anders
 *                             geschreven is.
 *   3. Telefoonnummer       — dezelfde verkoper adverteerde eerder. Dit vangt
 *                             precies de herplaatsing waar het bron-id, de URL
 *                             en de tekst allemaal veranderd zijn.
 *
 * Zonder die derde weg mist de relist-detectie haar belangrijkste geval.
 */

const MAX_CANDIDATES = 25

export async function findCandidates(
  listing: NormalizedListing,
  limit = MAX_CANDIDATES,
): Promise<PropertyCandidate[]> {
  const found = new Map<string, PropertyCandidate>()

  // `satisfies` is hier geen stijlkeuze: zonder die controle accepteert
  // TypeScript een `select` met een veld dat niet op het model bestaat (de
  // excess-property-check slaat over wanneer je een variabele doorgeeft in
  // plaats van een letterlijk object), en gooit Prisma pas op de eerste
  // collectorrun in productie.
  const include = {
    listings: {
      orderBy: { lastSeenAt: 'desc' as const },
      take: 5,
      select: {
        title: true,
        description: true,
        currentPrice: true,
        seller: { select: { phoneE164: true } },
      },
    },
  } satisfies Prisma.PropertyInclude

  // 1. Exacte adressleutel.
  if (listing.matchKey) {
    const exact = await prisma.property.findMany({
      where: { matchKey: listing.matchKey },
      include,
      take: limit,
    })
    for (const property of exact) collect(found, property)
  }

  // 2. Zelfde postcode en woningtype.
  if (found.size < limit && listing.postalCode) {
    const nearby = await prisma.property.findMany({
      where: {
        postalCode: listing.postalCode,
        propertyType: toPrismaPropertyType(listing.propertyType),
        id: { notIn: [...found.keys()] },
      },
      orderBy: { lastSeenAt: 'desc' },
      include,
      take: limit - found.size,
    })
    for (const property of nearby) collect(found, property)
  }

  // 3. Panden waarvoor deze verkoper eerder adverteerde.
  if (found.size < limit && listing.sellerPhoneE164) {
    const byPhone = await prisma.property.findMany({
      where: {
        id: { notIn: [...found.keys()] },
        listings: { some: { seller: { phoneE164: listing.sellerPhoneE164 } } },
      },
      orderBy: { lastSeenAt: 'desc' },
      include,
      take: limit - found.size,
    })
    for (const property of byPhone) collect(found, property)
  }

  return [...found.values()]
}

type PropertyWithListings = Property & {
  listings: {
    title: string | null
    description: string | null
    currentPrice: number | null
    seller: { phoneE164: string | null } | null
  }[]
}

function collect(target: Map<string, PropertyCandidate>, property: PropertyWithListings): void {
  target.set(property.id, {
    id: property.id,
    matchKey: property.matchKey,
    streetName: property.streetName,
    houseNumber: property.houseNumber,
    postalCode: property.postalCode,
    city: property.city,
    propertyType: fromPrismaPropertyType(property.propertyType),
    bedrooms: property.bedrooms,
    surfaceArea: property.surfaceArea,
    listings: property.listings.map((listing) => ({
      title: listing.title,
      description: listing.description,
      price: listing.currentPrice,
      sellerPhoneE164: listing.seller?.phoneE164 ?? null,
    })),
  })
}

export async function createProperty(listing: NormalizedListing, now: Date): Promise<Property> {
  return prisma.property.create({
    data: {
      address: listing.address,
      streetName: listing.streetName,
      houseNumber: listing.houseNumber,
      postalCode: listing.postalCode,
      city: listing.city,
      province: listing.province,
      propertyType: toPrismaPropertyType(listing.propertyType),
      bedrooms: listing.bedrooms,
      surfaceArea: listing.surfaceArea,
      matchKey: listing.matchKey,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  })
}

/**
 * Werkt een bestaand pand bij met wat de nieuwe advertentie toevoegt.
 *
 * Alleen lége velden invullen, nooit overschrijven. Een advertentie zonder
 * oppervlakte mag de oppervlakte die we uit een eerdere advertentie kennen niet
 * wissen — dan zou de kwaliteit van een pand achteruit kunnen gaan naarmate we
 * er meer over te weten komen.
 */
export async function enrichProperty(
  propertyId: string,
  listing: NormalizedListing,
  now: Date,
): Promise<Property | null> {
  const property = await prisma.property.findUnique({ where: { id: propertyId } })
  if (!property) return null

  return prisma.property.update({
    where: { id: property.id },
    data: {
      lastSeenAt: now,
      address: property.address ?? listing.address,
      streetName: property.streetName ?? listing.streetName,
      houseNumber: property.houseNumber ?? listing.houseNumber,
      postalCode: property.postalCode ?? listing.postalCode,
      city: property.city ?? listing.city,
      province: property.province ?? listing.province,
      bedrooms: property.bedrooms ?? listing.bedrooms,
      surfaceArea: property.surfaceArea ?? listing.surfaceArea,
      matchKey: property.matchKey ?? listing.matchKey,
    },
  })
}

/** Bij een herplaatsing: het pand is opnieuw op de markt. */
export async function incrementListingCycles(propertyId: string): Promise<void> {
  await prisma.property.update({
    where: { id: propertyId },
    data: { listingCycles: { increment: 1 } },
  })
}

function fromPrismaPropertyType(value: Property['propertyType']): PropertyTypeValue {
  switch (value) {
    case 'HOUSE':
      return 'house'
    case 'APARTMENT':
      return 'apartment'
    case 'LAND':
      return 'land'
    case 'COMMERCIAL':
      return 'commercial'
    case 'GARAGE':
      return 'garage'
    case 'OTHER':
      return 'other'
  }
}

export const PROPERTY_PAGE_SIZE = 30

/**
 * De pandenlijst van één kantoor.
 *
 * ─── WAAROM DIT OP POSTCODE FILTERT EN NIET OP agencyId ──────────────────────
 *
 * Panden zijn marktdata: ze horen bij niemand. De begrenzing hier is dus geen
 * tenantgrens maar een relevantiegrens — het kantoor krijgt de panden in zijn
 * eigen werkgebied te zien. Dat is een wezenlijk ander soort filter dan bij
 * `Opportunity` of `CrmContact`, waar het weglaten van `agencyId` een datalek
 * zou zijn. Hier levert het hooguit een te lange lijst op.
 *
 * Een lege postcodelijst geeft daarom bewust géén resultaten: een kantoor zonder
 * gebieden hoort een lege lijst met uitleg te zien, niet heel België.
 */
export async function listProperties(options: {
  postalCodes: readonly string[]
  query?: string
  page?: number
}): Promise<{
  items: (Property & {
    listings: {
      id: string
      currentPrice: number | null
      sellerType: SellerType
      status: ListingStatus
      firstSeenAt: Date
    }[]
  })[]
  total: number
}> {
  const page = Math.max(1, options.page ?? 1)

  if (options.postalCodes.length === 0) return { items: [], total: 0 }

  const where: Prisma.PropertyWhereInput = {
    postalCode: { in: [...options.postalCodes] },
  }

  const query = options.query?.trim()
  if (query) {
    where.OR = [
      { address: { contains: query, mode: 'insensitive' } },
      { streetName: { contains: query, mode: 'insensitive' } },
      { city: { contains: query, mode: 'insensitive' } },
      { postalCode: { startsWith: query } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: (page - 1) * PROPERTY_PAGE_SIZE,
      take: PROPERTY_PAGE_SIZE,
      include: {
        listings: {
          orderBy: { firstSeenAt: 'desc' },
          take: 1,
          select: {
            id: true,
            currentPrice: true,
            sellerType: true,
            status: true,
            firstSeenAt: true,
          },
        },
      },
    }),
    prisma.property.count({ where }),
  ])

  return { items, total }
}

/** Eén pand met alles eraan: advertenties, snapshots en gebeurtenissen. */
export async function findPropertyDetail(propertyId: string) {
  return prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      listings: {
        orderBy: { firstSeenAt: 'desc' },
        include: {
          source: { select: { key: true, name: true } },
          seller: { select: { displayName: true, phoneE164: true, classification: true } },
          snapshots: { orderBy: { capturedAt: 'asc' }, take: 200 },
        },
      },
      events: { orderBy: { occurredAt: 'desc' } },
    },
  })
}

export { fromPrismaPropertyType }
