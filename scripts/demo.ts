import 'dotenv/config'

import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'
import { formatDate, formatDateTime } from '@/lib/dates'
import { maskPhone } from '@/lib/phone'
import { prisma } from '@/repositories/prisma'
import { runLeadReviveForAllAgencies } from '@/services/leadReviveService'
import { runDueSources } from '@/services/pipelineService'

/**
 * De rondleiding: laat zien dat de hele keten werkt, met echte data.
 *
 * ─── WAT DIT SCRIPT BEWIJST ──────────────────────────────────────────────────
 *
 * Unit tests bewijzen dat elk onderdeel klopt. Dit script bewijst het enige wat
 * daarna nog telt: dat ze aan elkaar geknoopt zitten. Het draait de echte
 * pijplijn tegen de echte database en vertelt daarna wat er gebeurd is, aan de
 * hand van wat er daadwerkelijk in de tabellen staat.
 *
 * Het verzint niets. Elke regel hieronder komt uit een query; breekt de keten
 * ergens, dan blijft het bijbehorende blok leeg en zie je precies waar.
 *
 *   npm run demo
 */

const line = (char = '-'): string => char.repeat(74)

function heading(step: number, title: string): void {
  console.log('')
  console.log(line())
  console.log(`${step}. ${title.toUpperCase()}`)
  console.log(line())
}

function euro(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `EUR ${value.toLocaleString('nl-BE')}`
}

async function main(): Promise<void> {
  console.log('')
  console.log(line('='))
  console.log('  IMMORADAR BELGIUM - RONDLEIDING')
  console.log(line('='))

  // ── 0. Is er iets om mee te werken? ───────────────────────────────────────
  const agencies = await prisma.agency.count()
  if (agencies === 0) {
    console.error('')
    console.error('De database is leeg. Draai eerst:')
    console.error('')
    console.error('    npm run db:seed')
    console.error('')
    process.exitCode = 1
    return
  }

  const before = {
    properties: await prisma.property.count(),
    listings: await prisma.listing.count(),
    events: await prisma.listingEvent.count(),
    opportunities: await prisma.opportunity.count(),
  }

  // ── 1. De pijplijn draaien ────────────────────────────────────────────────
  heading(1, 'De pijplijn draait')
  console.log('collect -> normaliseer -> match pand -> classificeer verkoper')
  console.log('        -> snapshot -> events -> kansen -> meldingen')
  console.log('')

  const results = await runDueSources()

  if (results.length === 0) {
    console.log('Geen bronnen aan de beurt - de pollinterval is nog niet verstreken.')
    console.log('De cijfers hieronder komen uit wat er al stond.')
  }

  for (const result of results) {
    console.log(
      `  ${result.sourceKey.padEnd(12)} ${result.status.padEnd(8)}` +
        `  opgehaald ${String(result.fetched).padStart(3)}` +
        `  nieuw ${String(result.created).padStart(3)}` +
        `  gewijzigd ${String(result.updated).padStart(3)}` +
        `  events ${String(result.events).padStart(3)}` +
        `  kansen ${String(result.opportunities).padStart(3)}`,
    )
    for (const warning of result.warnings.slice(0, 3)) console.log(`    ! ${warning}`)
    if (result.error) console.log(`    x ${result.error}`)
  }

  const revive = await runLeadReviveForAllAgencies()
  console.log(
    `  ${'leadrevive'.padEnd(12)} ${'OK'.padEnd(8)}` +
      `  beoordeeld ${revive.reduce((sum, entry) => sum + entry.contactsAssessed, 0)}` +
      `  kansen ${revive.reduce((sum, entry) => sum + entry.opportunitiesCreated, 0)}`,
  )

  console.log('')
  console.table({
    panden: { voor: before.properties, na: await prisma.property.count() },
    advertenties: { voor: before.listings, na: await prisma.listing.count() },
    events: { voor: before.events, na: await prisma.listingEvent.count() },
    kansen: { voor: before.opportunities, na: await prisma.opportunity.count() },
  })

  // ── 2. Welke gebeurtenissen zag het systeem? ──────────────────────────────
  heading(2, 'Gedetecteerde marktgebeurtenissen')

  const eventCounts = await prisma.listingEvent.groupBy({
    by: ['type'],
    _count: { _all: true },
  })

  if (eventCounts.length === 0) console.log('  Nog geen events.')

  for (const entry of [...eventCounts].sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${entry.type.padEnd(20)} ${entry._count._all}`)
  }

  // ── 3. De beste kans, volledig uitgelegd ──────────────────────────────────
  heading(3, 'De beste kans van dit moment')

  const best = await prisma.opportunity.findFirst({
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    include: {
      agency: true,
      property: true,
      listing: { include: { seller: true, source: true } },
      crmContact: true,
      reasons: { orderBy: { rank: 'asc' } },
      scoreDetail: true,
    },
  })

  if (!best) {
    console.log('  Geen kansen gevonden.')
    console.log('  Controleer of er territories zijn die deze postcodes dekken.')
  } else {
    const type = best.type as OpportunityTypeValue

    console.log(`  Kantoor          ${best.agency.name}`)
    console.log(`  Type             ${OPPORTUNITY_TYPE_LABELS[type]}  (${best.origin})`)
    console.log(`  Score            ${best.score}/100`)
    console.log(`  Gebied           ${best.matchedTerritoryName ?? '-'}`)

    if (best.property) {
      const where = [best.property.postalCode, best.property.city].filter(Boolean).join(' ')
      console.log(`  Pand             ${best.property.address ?? '-'}`)
      console.log(`  Ligging          ${where}`)
      console.log(`  Marktcyclus      ${best.property.listingCycles}e keer te koop`)
    }

    if (best.listing) {
      const listing = best.listing
      const original =
        listing.initialPrice && listing.initialPrice !== listing.currentPrice
          ? `  (oorspronkelijk ${euro(listing.initialPrice)})`
          : ''
      console.log(`  Vraagprijs       ${euro(listing.currentPrice)}${original}`)
      console.log(`  Prijsverlagingen ${listing.priceDropCount}`)
      console.log(
        `  Verkoper         ${listing.sellerType} - ${Math.round(listing.sellerConfidence * 100)}% zeker`,
      )
      if (listing.seller?.phoneE164) {
        console.log(`  Telefoon         ${maskPhone(listing.seller.phoneE164)}  (volledig in het dashboard)`)
      }
      console.log(`  Bron             ${listing.source.name}`)
      console.log(`  Bron-URL         ${listing.sourceUrl}`)
    }

    if (best.crmContact) {
      console.log('')
      console.log('  *** BEKEND IN HET EIGEN KLANTENBESTAND ***')
      console.log(`      ${best.crmContact.displayName ?? '-'} (${best.crmContact.contactType})`)
      console.log(`      Koppeling ${Math.round(best.crmMatchConfidence * 100)}% zeker`)
      for (const reason of best.crmMatchReasons.slice(0, 3)) console.log(`      - ${reason}`)
    }

    if (best.scoreDetail) {
      const detail = best.scoreDetail
      console.log('')
      console.log('  Scoreopbouw')
      console.log(`      intentie     ${String(detail.intent).padStart(3)}/100`)
      console.log(`      relatie      ${String(detail.relationship).padStart(3)}/100`)
      console.log(`      timing       ${String(detail.timing).padStart(3)}/100`)
      console.log(`      gebied       ${String(detail.territory).padStart(3)}/100`)
      console.log(`      zekerheid    ${String(detail.confidence).padStart(3)}/100`)
      console.log('      ---------------------')
      console.log(`      totaal       ${String(detail.total).padStart(3)}/100  (${detail.weightsVersion})`)
    }

    console.log('')
    console.log('  Waarom deze score')
    for (const reason of best.reasons.slice(0, 8)) {
      console.log(`      +${String(reason.points).padStart(3)}  ${reason.label}`)
    }
  }

  // ── 4. De levensloop van een pand ─────────────────────────────────────────
  heading(4, 'Volledige levensloop van een pand')

  // Het pand met de rijkste geschiedenis - daar draait dit product om.
  const richest = await prisma.property.findFirst({
    orderBy: { events: { _count: 'desc' } },
    include: {
      events: { orderBy: { occurredAt: 'asc' } },
      listings: { include: { source: true }, orderBy: { firstSeenAt: 'asc' } },
    },
  })

  if (!richest || richest.events.length === 0) {
    console.log('  Nog geen pand met geschiedenis.')
  } else {
    const where = [richest.postalCode, richest.city].filter(Boolean).join(' ')
    console.log(`  ${richest.address ?? '-'} - ${where}`)
    console.log(
      `  ${richest.listings.length} advertentie(s), ${richest.events.length} gebeurtenis(sen), ${richest.listingCycles}e marktcyclus`,
    )
    console.log('')

    for (const event of richest.events) {
      const when = formatDate(event.occurredAt).padEnd(14)
      const what = event.type.padEnd(18)
      const detail =
        event.oldPrice !== null && event.newPrice !== null
          ? `${euro(event.oldPrice)} -> ${euro(event.newPrice)}`
          : (event.detail ?? '')
      console.log(`  ${when} ${what} ${detail}`)
    }
  }

  // ── 5. Meldingen ──────────────────────────────────────────────────────────
  heading(5, 'Meldingen')

  const alertCounts = await prisma.alert.groupBy({ by: ['status'], _count: { _all: true } })

  if (alertCounts.length === 0) console.log('  Nog geen meldingen.')
  for (const entry of alertCounts) {
    console.log(`  ${entry.status.padEnd(22)} ${entry._count._all}`)
  }

  const latest = await prisma.alert.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { agency: true, alertRule: true },
  })

  if (latest) {
    console.log('')
    console.log(`  Meest recente bericht - ${latest.agency.name} / ${latest.alertRule.name}`)
    console.log(`  ${formatDateTime(latest.createdAt)}`)
    console.log('')
    for (const messageLine of latest.messageText.split('\n')) {
      console.log(`  | ${messageLine}`)
    }
  }

  // ── 6. Waar verder te kijken ──────────────────────────────────────────────
  heading(6, 'Verder kijken in het dashboard')

  const users = await prisma.user.findMany({
    select: { email: true, role: true, agency: { select: { name: true } } },
    orderBy: { role: 'asc' },
    take: 6,
  })

  console.log('  npm run dev   ->  http://localhost:3000')
  console.log('')
  console.log('  Inloggen met:')
  for (const user of users) {
    console.log(`      ${user.email.padEnd(34)} ${user.role.padEnd(15)} ${user.agency?.name ?? '-'}`)
  }
  console.log('')
  console.log('  (het wachtwoord staat in de README en in prisma/seed.ts)')
  console.log('')

  await prisma.$disconnect()
}

main().catch(async (error: unknown) => {
  console.error('')
  console.error('De rondleiding is vastgelopen:')
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  await prisma.$disconnect()
  process.exitCode = 1
})
