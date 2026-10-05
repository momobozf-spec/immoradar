import type { Listing, Prisma } from '@/generated/prisma/client'

import type { ClassifiedListing } from '@/domain/types'
import { toJsonValue } from '@/lib/json'
import {
  toPrismaListingType,
  toPrismaPropertyType,
  toPrismaSellerType,
} from '@/normalization/normalizeListing'

import { prisma } from './prisma'

/**
 * Advertenties en hun geschiedenis.
 *
 * ─── DE SNAPSHOT-REGEL ───────────────────────────────────────────────────────
 *
 * Er wordt een snapshot geschreven bij de eerste waarneming, en daarna alleen
 * wanneer de `contentHash` verschilt. Elke run een rij zou de tabel honderd keer
 * zo groot maken zonder één extra feit toe te voegen: de collector draait elke
 * paar minuten, en een advertentie verandert hooguit een paar keer per maand.
 *
 * De snapshots zijn de bron van waarheid. `Listing.currentPrice`,
 * `initialPrice` en `priceDropCount` zijn afgeleid en staan er alleen om de
 * dashboardquery's en de alertteksten snel te houden — ze zijn altijd uit de
 * snapshots te herbouwen.
 */

export interface ListingWithSeller extends Listing {
  seller: { id: string; phoneE164: string | null; displayName: string | null } | null
}

export async function findBySourceListingId(
  sourceId: string,
  sourceListingId: string,
): Promise<ListingWithSeller | null> {
  return prisma.listing.findUnique({
    where: { sourceId_sourceListingId: { sourceId, sourceListingId } },
    include: { seller: { select: { id: true, phoneE164: true, displayName: true } } },
  })
}

export interface CreateListingInput {
  propertyId: string
  sourceId: string
  sellerId: string | null
  listing: ClassifiedListing
  now: Date
  /** Gevuld wanneer dit een herplaatsing van een eerdere advertentie is. */
  previousListingId?: string
}

export async function createListing(input: CreateListingInput): Promise<Listing> {
  const { listing, now } = input

  const created = await prisma.listing.create({
    data: {
      propertyId: input.propertyId,
      sourceId: input.sourceId,
      sourceListingId: listing.sourceListingId,
      sourceUrl: listing.url,

      listingType: toPrismaListingType(listing.listingType),
      propertyType: toPrismaPropertyType(listing.propertyType),

      title: listing.title,
      description: listing.description,

      currentPrice: listing.price,
      initialPrice: listing.price,
      currency: listing.currency,

      sellerId: input.sellerId,
      sellerType: toPrismaSellerType(listing.classification.type),
      sellerConfidence: listing.classification.confidence,
      classificationReasons: listing.classification.reasons.slice(0, 10),

      status: 'ACTIVE',
      contentHash: listing.contentHash,

      publishedAt: listing.publishedAt,
      firstSeenAt: now,
      lastSeenAt: now,

      previousListingId: input.previousListingId,
    },
  })

  await writeSnapshot(created.id, listing, 'ACTIVE', now)
  return created
}

/**
 * Werkt een bestaande advertentie bij na een nieuwe waarneming.
 *
 * `priceDropped` komt van de eventmotor en niet uit een vergelijking hier: de
 * teller mag alleen oplopen bij een daling die de ruisdrempel haalde, anders
 * telt een afrondingsverschil van 100 euro mee als "de verkoper beweegt".
 */
export async function applyObservation(input: {
  listingId: string
  listing: ClassifiedListing
  sellerId: string | null
  changed: boolean
  priceDropped: boolean
  now: Date
}): Promise<Listing> {
  const { listing, now } = input

  const data: Prisma.ListingUpdateInput = {
    lastSeenAt: now,
    status: 'ACTIVE',
    missedRuns: 0,
    removedAt: null,
    sellerType: toPrismaSellerType(listing.classification.type),
    sellerConfidence: listing.classification.confidence,
    classificationReasons: listing.classification.reasons.slice(0, 10),
  }

  if (input.changed) {
    data.title = listing.title
    data.description = listing.description
    data.currentPrice = listing.price
    data.currency = listing.currency
    data.contentHash = listing.contentHash
    data.sourceUrl = listing.url
    if (input.sellerId) data.seller = { connect: { id: input.sellerId } }
    if (input.priceDropped) data.priceDropCount = { increment: 1 }
  }

  const updated = await prisma.listing.update({ where: { id: input.listingId }, data })

  if (input.changed) {
    await writeSnapshot(input.listingId, listing, 'ACTIVE', now)
  }

  return updated
}

export async function writeSnapshot(
  listingId: string,
  listing: ClassifiedListing,
  status: 'ACTIVE' | 'MISSING' | 'REMOVED',
  capturedAt: Date,
): Promise<void> {
  await prisma.listingSnapshot.create({
    data: {
      listingId,
      capturedAt,
      price: listing.price,
      title: listing.title,
      description: listing.description,
      sellerName: listing.sellerName,
      sellerPhone: listing.sellerPhoneE164,
      status,
      contentHash: listing.contentHash,
      rawData: listing.raw === null ? undefined : toJsonValue(listing.raw),
    },
  })
}

/**
 * Advertenties die deze run niet gezien zijn.
 *
 * Verhoogt `missedRuns` en geeft terug welke daarmee de verwijderdrempel
 * bereiken. De statuswijziging naar REMOVED gebeurt pas nadat het event
 * daadwerkelijk is vastgelegd — zo kan een crash tussen beide stappen niet
 * leiden tot een advertentie die stilletjes verdwijnt zonder dat er ooit een
 * LISTING_REMOVED in de timeline staat.
 */
export async function markMissing(
  sourceId: string,
  seenSourceListingIds: readonly string[],
  threshold: number,
): Promise<Listing[]> {
  await prisma.listing.updateMany({
    where: {
      sourceId,
      status: { in: ['ACTIVE', 'MISSING'] },
      sourceListingId: { notIn: [...seenSourceListingIds] },
    },
    data: { missedRuns: { increment: 1 }, status: 'MISSING' },
  })

  return prisma.listing.findMany({
    where: {
      sourceId,
      status: 'MISSING',
      missedRuns: { gte: threshold },
      sourceListingId: { notIn: [...seenSourceListingIds] },
    },
  })
}

export async function markRemoved(listingId: string, now: Date): Promise<void> {
  await prisma.listing.update({
    where: { id: listingId },
    data: { status: 'REMOVED', removedAt: now },
  })
}

/** Advertenties waarvoor de stale-detectie moet draaien. */
export async function activeListingsForStaleCheck(
  sourceId: string,
  minimumAgeDays: number,
  now: Date,
): Promise<Listing[]> {
  const cutoff = new Date(now.getTime() - minimumAgeDays * 86_400_000)

  return prisma.listing.findMany({
    where: { sourceId, status: 'ACTIVE', firstSeenAt: { lte: cutoff } },
    orderBy: { firstSeenAt: 'asc' },
    take: 1000,
  })
}

export async function recordStaleThreshold(
  listingId: string,
  thresholds: readonly number[],
): Promise<void> {
  await prisma.listing.update({
    where: { id: listingId },
    data: { staleDaysReported: [...thresholds] },
  })
}

/**
 * De laatst verwijderde advertentie voor dit pand.
 *
 * Dit is de kandidaat waar een nieuwe advertentie een herplaatsing van kan zijn.
 * `DUPLICATE` telt niet mee: dat is een advertentie die we al als kopie van een
 * andere hebben afgeschreven, en die opnieuw laten opduiken zou een verzonnen
 * herplaatsing opleveren.
 */
export async function findRemovedListingForProperty(
  propertyId: string,
  excludeListingId: string | null,
): Promise<Listing | null> {
  return prisma.listing.findFirst({
    where: {
      propertyId,
      status: { in: ['REMOVED', 'MISSING'] },
      id: excludeListingId ? { not: excludeListingId } : undefined,
      // Nog niet aan een opvolger gekoppeld: één advertentie kan maar één keer
      // herplaatst worden.
      relistedAs: null,
    },
    orderBy: [{ removedAt: 'desc' }, { lastSeenAt: 'desc' }],
  })
}

/** De volledige geschiedenis van een pand, voor de timeline in het dashboard. */
export async function listingsForProperty(propertyId: string) {
  return prisma.listing.findMany({
    where: { propertyId },
    orderBy: { firstSeenAt: 'asc' },
    include: {
      source: { select: { key: true, name: true } },
      seller: { select: { displayName: true, phoneE164: true, classification: true } },
      snapshots: { orderBy: { capturedAt: 'asc' }, take: 200 },
    },
  })
}
