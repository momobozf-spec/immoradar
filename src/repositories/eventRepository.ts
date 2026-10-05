import type { ListingEvent, ListingEventType, SellerType } from '@/generated/prisma/client'

import type { DetectedEvent } from '@/events/types'

import { prisma } from './prisma'
import { isUniqueViolation } from './prismaErrors'

/**
 * Events vastleggen — precies één keer.
 *
 * ─── WAAROM DE UNIQUE-INDEX HET ECHTE WERK DOET ──────────────────────────────
 *
 * "Eerst kijken of het event al bestaat, dan aanmaken" is een race: tussen de
 * controle en de insert kan een tweede worker hetzelfde doen. Bij een collector
 * die elke twee minuten draait en een cron die er soms overheen loopt, is dat
 * geen theoretisch geval.
 *
 * Daarom is `dedupeKey` uniek in de database en is een botsing hier geen fout
 * maar het normale antwoord "die had ik al". De functie geeft dan `null` terug,
 * en de aanroeper weet: hier hoeft geen opportunity meer uit te komen. Dat is de
 * hele bescherming tegen dubbele meldingen, en ze zit op de enige plek waar
 * niemand haar per ongeluk kan overslaan.
 */

export async function recordEvent(
  listingId: string,
  propertyId: string,
  event: DetectedEvent,
): Promise<ListingEvent | null> {
  try {
    return await prisma.listingEvent.create({
      data: {
        listingId,
        propertyId,
        type: event.type as ListingEventType,
        occurredAt: event.occurredAt,
        detectedAt: new Date(),
        oldPrice: event.oldPrice,
        newPrice: event.newPrice,
        absoluteDrop: event.absoluteDrop,
        percentageDrop: event.percentageDrop,
        daysOnMarket: event.daysOnMarket,
        oldSellerType: toPrismaSellerType(event.oldSellerType),
        newSellerType: toPrismaSellerType(event.newSellerType),
        detail: event.detail,
        dedupeKey: event.dedupeKey,
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

/** Meerdere events, in volgorde. Geeft alleen de daadwerkelijk nieuwe terug. */
export async function recordEvents(
  listingId: string,
  propertyId: string,
  events: readonly DetectedEvent[],
): Promise<ListingEvent[]> {
  const created: ListingEvent[] = []

  for (const event of events) {
    const record = await recordEvent(listingId, propertyId, event)
    if (record) created.push(record)
  }

  return created
}

/** De timeline van een pand: alle events, oudste eerst. */
export async function eventsForProperty(propertyId: string): Promise<ListingEvent[]> {
  return prisma.listingEvent.findMany({
    where: { propertyId },
    orderBy: { occurredAt: 'asc' },
    take: 500,
  })
}

export async function eventsForListing(listingId: string): Promise<ListingEvent[]> {
  return prisma.listingEvent.findMany({
    where: { listingId },
    orderBy: { occurredAt: 'asc' },
  })
}

function toPrismaSellerType(
  value: 'private' | 'professional' | 'unknown' | undefined,
): SellerType | undefined {
  switch (value) {
    case 'private':
      return 'PRIVATE'
    case 'professional':
      return 'PROFESSIONAL'
    case 'unknown':
      return 'UNKNOWN'
    case undefined:
      return undefined
  }
}
