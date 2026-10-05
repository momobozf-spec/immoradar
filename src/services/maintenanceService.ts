import { Prisma } from '@/generated/prisma/client'

import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { expireStaleOpportunities } from '@/repositories/opportunityRepository'
import { prisma } from '@/repositories/prisma'

/**
 * Onderhoud: bewaartermijnen en verlopen kansen.
 *
 * ─── DATAMINIMALISATIE IS EEN ROUTINE, GEEN BELOFTE ──────────────────────────
 *
 * "We bewaren niet meer dan nodig" betekent niets zonder een taak die het
 * daadwerkelijk opruimt. Deze module is die taak. Ze doet drie dingen, in
 * volgorde van hoe gevoelig de data is:
 *
 *   1. Verkoperscontactgegevens uit oude snapshots en van stille verkopers.
 *      Een telefoonnummer van een advertentie van twee jaar geleden heeft geen
 *      enkele functie meer.
 *   2. Ruwe bronpayloads. Die dienen alleen om parsingfouten na te kijken; na
 *      twee weken kijkt niemand ze meer na.
 *   3. Advertenties die lang geleden verdwenen zijn.
 *
 * Panden en events blijven — dat is de historische levensloop waar dit product
 * op draait, en er staan geen persoonsgegevens in.
 *
 * Elke termijn is instelbaar en `0` zet de betreffende opruiming uit.
 */

const logger = createLogger({ component: 'maintenance' })

export interface RetentionResult {
  snapshotsRedacted: number
  payloadsCleared: number
  sellersRedacted: number
  listingsDeleted: number
  importRowsCleared: number
  crmContactsRedacted: number
}

export async function runRetention(now: Date = new Date()): Promise<RetentionResult> {
  const env = getEnv()
  const result: RetentionResult = {
    snapshotsRedacted: 0,
    payloadsCleared: 0,
    sellersRedacted: 0,
    listingsDeleted: 0,
    importRowsCleared: 0,
    crmContactsRedacted: 0,
  }

  // 1. Contactgegevens in oude snapshots.
  if (env.RETENTION_SELLER_CONTACT_DAYS > 0) {
    const cutoff = daysAgo(now, env.RETENTION_SELLER_CONTACT_DAYS)

    const snapshots = await prisma.listingSnapshot.updateMany({
      where: { capturedAt: { lt: cutoff }, sellerPhone: { not: null } },
      data: { sellerPhone: null },
    })
    result.snapshotsRedacted = snapshots.count

    // Verkopers die we al die tijd niet meer gezien hebben: naam en nummer weg,
    // rij bewaard zodat listings hun relatie — en dus de geschiedenis van het
    // pand — niet verliezen.
    const sellers = await prisma.sellerIdentity.updateMany({
      where: { lastSeenAt: { lt: cutoff }, redactedAt: null },
      data: { phoneE164: null, displayName: null, normalizedName: null, redactedAt: now },
    })
    result.sellersRedacted = sellers.count
  }

  // 2. Ruwe payloads.
  if (env.RETENTION_RAW_PAYLOAD_DAYS > 0) {
    const cutoff = daysAgo(now, env.RETENTION_RAW_PAYLOAD_DAYS)
    // `Prisma.JsonNull` is de sentinel voor een echte SQL NULL in een
    // Json-kolom; een gewone `null` zou Prisma als "geen wijziging" lezen.
    const payloads = await prisma.listingSnapshot.updateMany({
      where: { capturedAt: { lt: cutoff }, rawData: { not: Prisma.JsonNull } },
      data: { rawData: Prisma.JsonNull },
    })
    result.payloadsCleared = payloads.count
  }

  // 3. Advertenties die lang geleden van de markt gingen.
  if (env.RETENTION_REMOVED_LISTING_DAYS > 0) {
    const cutoff = daysAgo(now, env.RETENTION_REMOVED_LISTING_DAYS)
    const listings = await prisma.listing.deleteMany({
      where: { status: 'REMOVED', removedAt: { lt: cutoff } },
    })
    result.listingsDeleted = listings.count
  }

  // 4. Ruwe importregels. Ze bestaan om een import achteraf te kunnen nakijken;
  // na de termijn blijven alleen status en melding over, zonder de kolommen
  // (namen, telefoons) zoals ze in het bestand stonden.
  if (env.RETENTION_IMPORT_ROWS_DAYS > 0) {
    const cutoff = daysAgo(now, env.RETENTION_IMPORT_ROWS_DAYS)
    const rows = await prisma.crmImportRow.updateMany({
      where: { createdAt: { lt: cutoff }, rawClearedAt: null },
      data: { raw: {}, changes: Prisma.JsonNull, rawClearedAt: now },
    })
    result.importRowsCleared = rows.count
  }

  // 5. CRM-contacten zonder enige activiteit sinds de termijn. "Activiteit" is
  // het laatste contact volgens het kantoor of een interactie; ontbreken die,
  // dan de aanmaakdatum in het bron-CRM, en anders die van de import. Bewust
  // niet `updatedAt`: de LeadRevive-motor schrijft scores bij en zou zo elk
  // contact eeuwig jong houden.
  if (env.RETENTION_CRM_CONTACT_DAYS > 0) {
    const cutoff = daysAgo(now, env.RETENTION_CRM_CONTACT_DAYS)
    for (;;) {
      const stale = await prisma.crmContact.findMany({
        where: {
          redactedAt: null,
          OR: [
            { lastContactAt: { lt: cutoff } },
            { lastContactAt: null, sourceCreatedAt: { lt: cutoff } },
            { lastContactAt: null, sourceCreatedAt: null, createdAt: { lt: cutoff } },
          ],
          interactions: { none: { occurredAt: { gte: cutoff } } },
        },
        select: { id: true, agencyId: true },
        take: 200,
      })
      if (stale.length === 0) break
      for (const contact of stale) {
        if (await redactCrmContact(contact.agencyId, contact.id, now)) {
          result.crmContactsRedacted += 1
        }
      }
    }
  }

  logger.info('Bewaartermijnen toegepast', { ...result })
  return result
}

/**
 * Verwijdert alle persoonsgegevens rond één verkoper.
 *
 * Dit is de knop achter een verwijderverzoek. De verkoper blijft als rij bestaan
 * — anders vallen de advertenties en daarmee de pandgeschiedenis om — maar alles
 * wat naar een persoon herleidt is weg, ook uit de snapshots.
 */
export async function redactSeller(sellerId: string, now: Date = new Date()): Promise<void> {
  const listings = await prisma.listing.findMany({
    where: { sellerId },
    select: { id: true },
  })

  await prisma.listingSnapshot.updateMany({
    where: { listingId: { in: listings.map((listing) => listing.id) } },
    data: { sellerPhone: null, sellerName: null },
  })

  await prisma.listing.updateMany({
    where: { sellerId },
    data: { redactedAt: now },
  })

  await prisma.sellerIdentity.update({
    where: { id: sellerId },
    data: {
      displayName: null,
      normalizedName: null,
      phoneE164: null,
      reasons: [],
      redactedAt: now,
    },
  })

  logger.info('Verkoper geanonimiseerd', { sellerId, listings: listings.length })
}

/** Hetzelfde voor een CRM-contact, binnen één kantoor. */
export async function redactCrmContact(
  agencyId: string,
  contactId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await prisma.crmContact.updateMany({
    where: { id: contactId, agencyId },
    data: {
      firstName: null,
      lastName: null,
      displayName: null,
      email: null,
      phone: null,
      emailNormalized: null,
      phoneE164: null,
      nameNormalized: null,
      address: null,
      notes: null,
      redactedAt: now,
    },
  })

  if (result.count === 0) return false

  await prisma.crmInteraction.updateMany({
    where: { contactId, agencyId },
    data: { summary: null, agentName: null },
  })

  // De importregels houden de kolommen zoals ze in het bestand stonden (naam,
  // telefoon): zonder dit bleef de persoon via de importgeschiedenis herleidbaar.
  await prisma.crmImportRow.updateMany({
    where: { contactId, import: { agencyId } },
    data: { raw: {}, changes: Prisma.JsonNull, rawClearedAt: now },
  })

  // Vrije notities van makelaars bij kansen over dit contact.
  await prisma.opportunity.updateMany({
    where: { agencyId, crmContactId: contactId },
    data: { note: null },
  })
  await prisma.opportunityActivity.updateMany({
    where: { opportunity: { agencyId, crmContactId: contactId } },
    data: { note: null },
  })

  // Verzonden meldingen over kansen bij dit contact noemden zijn naam.
  await prisma.alert.updateMany({
    where: { agencyId, opportunity: { crmContactId: contactId } },
    data: { messageText: '[gewist op verzoek]' },
  })

  logger.info('CRM-contact geanonimiseerd', { agencyId, contactId })
  return true
}

export async function expireOpportunities(now: Date = new Date()): Promise<number> {
  return expireStaleOpportunities(now)
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

export interface AgencyPurgeResult {
  agencyId: string
  users: number
  contacts: number
  opportunities: number
  auditEntriesRedacted: number
}

/**
 * Wist een kantoor met al zijn gegevens: klantenbestand, imports, kansen,
 * meldingen, gebieden, abonnement en gebruikers.
 *
 * Dit is de belofte uit de verwerkersovereenkomst bij het einde van een pilot
 * of contract. Anders dan `redactCrmContact` blijft hier niets van over: het
 * kantoor bestaat niet meer, dus er is geen geschiedenis om te bewaren. Alles
 * hangt via `onDelete: Cascade` aan `Agency`; één `delete` neemt het mee, in
 * één transactie met het auditlog.
 *
 * Het auditlog heeft geen relatie met `Agency` (het moet een gewist kantoor
 * overleven). De regels van dit kantoor blijven, maar zonder wie (`actor`),
 * vanwaar (`ip`) en zonder `metadata`: dat zijn de velden die naar personen
 * kunnen herleiden.
 */
export async function purgeAgency(agencyId: string): Promise<AgencyPurgeResult | null> {
  return prisma.$transaction(async (tx) => {
    const agency = await tx.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        _count: { select: { users: true, crmContacts: true, opportunities: true } },
      },
    })
    if (!agency) return null

    await tx.agency.delete({ where: { id: agencyId } })

    const audit = await tx.auditLog.updateMany({
      where: { agencyId },
      data: { actor: 'gewist', ip: null, metadata: Prisma.JsonNull },
    })

    await tx.auditLog.create({
      data: { actor: 'cli', agencyId, action: 'agency.purged', entityType: 'Agency', entityId: agencyId },
    })

    logger.info('Kantoor gewist', { agencyId })

    return {
      agencyId,
      users: agency._count.users,
      contacts: agency._count.crmContacts,
      opportunities: agency._count.opportunities,
      auditEntriesRedacted: audit.count,
    }
  })
}
