/**
 * Demodata: een Belgische vastgoedmarkt van een paar maanden oud, plus vijf
 * kantoren met hun eigen klantenbestand.
 *
 * ─── DE OPZET ────────────────────────────────────────────────────────────────
 *
 * De seed schrijft *geschiedenis*, geen eindtoestand. Een pand krijgt niet
 * "prijs 465.000 en twee verlagingen" mee als kolomwaarde; het krijgt een reeks
 * snapshots en events die samen die toestand opleveren. Dat verschil is het hele
 * punt van dit product — de timeline moet echt zijn, niet nagebootst.
 *
 * Om dezelfde reden worden de opportunities *niet* geschreven maar afgeleid: de
 * seed roept aan het eind de echte `createOpportunitiesForEvents` en
 * `runLeadReviveForAllAgencies` aan. Wat je in het dashboard ziet is dus door de
 * scoringmotor bepaald en niet door mij verzonnen. Verandert de weging, dan
 * verandert de demo mee — precies zoals in productie.
 *
 * ─── DETERMINISME ────────────────────────────────────────────────────────────
 *
 * Geen `Math.random()`. Een seed die elke keer iets anders oplevert maakt een
 * screenshot in de documentatie meteen onjuist, en een bugrapport
 * onreproduceerbaar. De PRNG hieronder is een mulberry32 met een vaste start.
 *
 * ─── DE VIJF SCENARIO'S ──────────────────────────────────────────────────────
 *
 *   A  Verse FSBO, geen CRM-relatie
 *   B  Verse FSBO, bestaande relatie (koper uit 2019)  ← het vlaggenschip
 *   C  Particulier, 67 dagen online, twee prijsverlagingen
 *   D  Slapende schattingsaanvraag, geen extern signaal
 *   E  Herplaatst pand bij een bestaande relatie
 *
 * Ze staan onderaan expliciet, na de generieke vulling, zodat ze niet in de ruis
 * verdwijnen en in het dashboard herkenbaar zijn.
 */
import 'dotenv/config'

import {
  type ListingEvent,
  type ListingEventType,
  type PropertyType,
  type SellerType,
} from '@/generated/prisma/client'

import { prisma } from '../src/repositories/prisma'
import { buildMatchKey } from '../src/domain/geo/address'
import { cityForPostalCode, provinceForPostalCode } from '../src/domain/geo/provinces'
import { stableHash } from '../src/lib/hash'
import { hashPassword } from '../src/lib/password'
import { normalizeBelgianPhone } from '../src/lib/phone'
import { normalizeText } from '../src/lib/text'
import { createOpportunitiesForEvents } from '../src/services/opportunityService'
import { runLeadReviveForAllAgencies } from '../src/services/leadReviveService'

// Dezelfde client als de app: één plek die de verbinding en de pool bepaalt.

// ─────────────────────────────────────────────────────────────────────────────
// Determinisme
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — klein, snel, en met een vaste start volledig reproduceerbaar. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = makeRandom(20260816)

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('pick() op een lege lijst')
  return item
}

function intBetween(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min
}

const DAY = 86_400_000

/** "Nu" staat vast zodat de seed reproduceerbaar is binnen één run. */
const NOW = new Date()

function daysAgo(days: number, hours = 9): Date {
  const date = new Date(NOW.getTime() - days * DAY)
  date.setHours(hours, intBetween(0, 59), 0, 0)
  return date
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

// ─────────────────────────────────────────────────────────────────────────────
// Belgische bouwstenen
// ─────────────────────────────────────────────────────────────────────────────

/** Postcodes die in `provinces.ts` een gemeente hebben, zodat afleiding klopt. */
const POSTAL_CODES = [
  '9000', '9030', '9040', '9050', '9100', '9200', '9300', '9700', '9800',
  '2000', '2018', '2600', '2800', '2900',
  '8000', '8200', '8500', '8800', '8400',
  '3000', '3500', '3800',
  '1000', '1030', '1180',
] as const

const STREETS = [
  'Kerkstraat', 'Dorpsstraat', 'Stationsstraat', 'Molenstraat', 'Nieuwstraat',
  'Schoolstraat', 'Veldstraat', 'Bruggestraat', 'Lindelaan', 'Beukenlaan',
  'Populierendreef', 'Kasteeldreef', 'Vaartstraat', 'Hoogstraat', 'Zandstraat',
  'Gentsesteenweg', 'Brusselsesteenweg', 'Antwerpsesteenweg', 'Meersstraat',
  'Kapelstraat', 'Bergstraat', 'Wijngaardstraat', 'Rozenlaan', 'Eikenlaan',
] as const

const FIRST_NAMES = [
  'Pieter', 'Jan', 'Marc', 'Koen', 'Bart', 'Tom', 'Wim', 'Luc', 'Kris', 'Dirk',
  'An', 'Els', 'Katrien', 'Sofie', 'Leen', 'Nele', 'Inge', 'Veerle', 'Ann', 'Greet',
  'Mohamed', 'Youssef', 'Fatima', 'Sarah', 'David', 'Thomas', 'Lieve', 'Hilde',
] as const

const LAST_NAMES = [
  'Janssens', 'Peeters', 'Maes', 'Jacobs', 'Willems', 'Claes', 'Goossens',
  'Wouters', 'De Smet', 'Dubois', 'Mertens', 'De Vos', 'Hermans', 'Van Damme',
  'De Clercq', 'Segers', 'Michiels', 'Van den Broeck', 'Verhoeven', 'Lemmens',
  'Declercq', 'Vermeulen', 'Coppens', 'Aerts', 'Cools', 'Bogaert',
] as const

const AGENCY_BRANDS = [
  'Immo De Meyer', 'Vastgoed Vandenberghe', 'Century Vlaanderen', 'Immo Lievens',
  'ERA Van Hoecke', 'Immopoint Gent', 'Dewaele Vastgoed', 'Heylen Vastgoed',
] as const

const HOUSE_TITLES = [
  'Instapklare woning met tuin',
  'Ruime gezinswoning',
  'Gerenoveerde rijwoning',
  'Karaktervolle burgerwoning',
  'Energiezuinige nieuwbouwwoning',
  'Charmante hoekwoning',
] as const

const APARTMENT_TITLES = [
  'Lichtrijk appartement met terras',
  'Modern appartement nabij centrum',
  'Ruim hoekappartement',
  'Gerenoveerd appartement met lift',
  'Penthouse met zicht op de stad',
] as const

const PRIVATE_PHRASES = [
  'Verkoop door eigenaar, zonder makelaar.',
  'Particuliere verkoop — geen immokantoren aub.',
  'Wij verkopen zelf onze woning.',
  'Rechtstreeks van particulier aan particulier.',
] as const

const PROFESSIONAL_PHRASES = [
  'Neem contact op met ons kantoor voor een bezoek.',
  'Vraag vrijblijvend een bezichtiging aan bij onze makelaar.',
  'Ons kantoor begeleidt u van bod tot akte.',
] as const

function personName(): { first: string; last: string; full: string } {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  return { first, last, full: `${first} ${last}` }
}

/**
 * Belgische gsm-nummers: +32 4XX XX XX XX — negen cijfers na de landcode.
 *
 * ─── WAAROM DE NAMESPACE ─────────────────────────────────────────────────────
 *
 * Marktverkopers en CRM-contacten krijgen nummers uit gescheiden reeksen. Zonder
 * die scheiding botsen ze: dan matcht de CRM-koppeling een willekeurige
 * "Marc Willems" uit een advertentie aan een willekeurige "Thomas Lemmens" uit
 * het klantenbestand, puur omdat de generator toevallig hetzelfde nummer gaf.
 * De matcher doet dan precies wat hij hoort te doen — een exact telefoonnummer
 * is een hard signaal — maar de demo laat een koppeling zien die inhoudelijk
 * onzin is, en dat ondermijnt vertrouwen in juist de functie die het product
 * verkoopt.
 *
 * Kruisverbanden in de demo horen ontworpen te zijn (de scenario's), niet
 * toevallig.
 */
function mobileNumber(namespace: 'seller' | 'crm', index: number): string {
  // 45x–49x is het mobiele bereik; per namespace een eigen honderdtal zodat de
  // reeksen elkaar niet kunnen raken.
  const series = namespace === 'seller' ? 460 : 480
  const subscriber = String((index * 7919) % 1_000_000).padStart(6, '0')
  return `+32${series}${subscriber}`.slice(0, 12)
}

/** Vaste nummers voor kantoren: 09 = Gent, negen cijfers in totaal. */
function landlineNumber(index: number): string {
  return `+329${String(2_000_000 + ((index * 613) % 999_999)).padStart(7, '0')}`.slice(0, 12)
}

// ─────────────────────────────────────────────────────────────────────────────
// Bronnen
// ─────────────────────────────────────────────────────────────────────────────

async function seedSources(): Promise<{ fixtureId: string; demoId: string }> {
  const fixture = await prisma.source.upsert({
    where: { key: 'fixture-be' },
    update: {},
    create: {
      key: 'fixture-be',
      name: 'Fixture (lokaal bestand)',
      accessMethod: 'FIXTURE',
      enabled: true,
      health: 'HEALTHY',
      pollIntervalSeconds: 300,
      rateLimitPerMinute: 60,
      accessNotes:
        'Leest fixtures/listings.json van de lokale schijf. Raakt geen enkele externe dienst.',
      lastSuccessAt: minutesAgo(4),
      lastRunAt: minutesAgo(4),
    },
  })

  const demo = await prisma.source.upsert({
    where: { key: 'demo-be' },
    update: {},
    create: {
      key: 'demo-be',
      name: 'Demomarkt (synthetisch)',
      accessMethod: 'SYNTHETIC',
      enabled: true,
      health: 'HEALTHY',
      pollIntervalSeconds: 300,
      rateLimitPerMinute: 60,
      accessNotes:
        'Genereert een synthetische Belgische markt. Geen externe verzoeken, geen toestemming nodig.',
      lastSuccessAt: minutesAgo(2),
      lastRunAt: minutesAgo(2),
    },
  })

  // Een paar afgeronde runs, zodat het bronnendashboard geschiedenis toont.
  for (let index = 0; index < 6; index += 1) {
    const startedAt = minutesAgo((index + 1) * 5)
    await prisma.collectorRun.create({
      data: {
        sourceId: index % 2 === 0 ? fixture.id : demo.id,
        status: 'SUCCESS',
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 2_400),
        durationMs: 2_400,
        itemsFetched: intBetween(18, 45),
        itemsNew: intBetween(0, 4),
        itemsUpdated: intBetween(1, 7),
        itemsUnchanged: intBetween(10, 30),
        eventsDetected: intBetween(0, 5),
      },
    })
  }

  return { fixtureId: fixture.id, demoId: demo.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kantoren, gebruikers, gebieden
// ─────────────────────────────────────────────────────────────────────────────

interface SeededAgency {
  id: string
  name: string
  slug: string
  postalCodes: string[]
  users: { id: string; name: string; email: string }[]
}

const AGENCY_DEFINITIONS = [
  {
    name: 'Immo Example Gent',
    slug: 'immo-example-gent',
    postalCodes: ['9000', '9030', '9040', '9050'],
    agents: ['Thomas Peeters', 'Sofie Maes', 'Bart Declercq'],
  },
  {
    name: 'Vastgoed Antwerpen Noord',
    slug: 'vastgoed-antwerpen-noord',
    postalCodes: ['2000', '2018', '2600'],
    agents: ['Koen Willems', 'An Jacobs', 'Youssef Amrani'],
  },
  {
    name: 'Immo Brugge & Kust',
    slug: 'immo-brugge-kust',
    postalCodes: ['8000', '8200', '8400'],
    agents: ['Nele Vermeulen', 'Dirk Coppens'],
  },
  {
    name: 'Leuven Wonen',
    slug: 'leuven-wonen',
    postalCodes: ['3000', '3500'],
    agents: ['Els Hermans', 'Wim Aerts'],
  },
  {
    name: 'Brussel Vastgoedpartners',
    slug: 'brussel-vastgoedpartners',
    postalCodes: ['1000', '1030', '1180'],
    agents: ['Fatima Bensaïd', 'David Lemmens'],
  },
] as const

async function seedAgencies(): Promise<SeededAgency[]> {
  const password = await hashPassword('immoradar')
  const seeded: SeededAgency[] = []

  // Platformbeheerder: hoort bij geen enkel kantoor, precies zoals session.ts eist.
  await prisma.user.upsert({
    where: { email: 'admin@immoradar.be' },
    update: {},
    create: {
      email: 'admin@immoradar.be',
      passwordHash: password,
      name: 'Platformbeheer',
      role: 'PLATFORM_ADMIN',
      agencyId: null,
    },
  })

  for (const definition of AGENCY_DEFINITIONS) {
    const agency = await prisma.agency.upsert({
      where: { slug: definition.slug },
      update: {},
      create: {
        name: definition.name,
        slug: definition.slug,
        contactEmail: `info@${definition.slug}.be`,
        // Een chat-id zodat de alertlaag iets heeft om naartoe te schrijven.
        // Zonder TELEGRAM_BOT_TOKEN blijft het bij SUPPRESSED_DRY_RUN.
        telegramChatId: `-100${1_000_000 + seeded.length}`,
        active: true,
        subscription: {
          create: { plan: 'starter', status: 'ACTIVE', maxOpportunitiesPerDay: 50 },
        },
      },
    })

    const users: SeededAgency['users'] = []

    // De eerste medewerker is kantoorbeheerder; de rest is makelaar.
    for (const [index, agentName] of definition.agents.entries()) {
      const email = `${normalizeText(agentName).split(' ')[0]}@${definition.slug}.be`
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          passwordHash: password,
          name: agentName,
          role: index === 0 ? 'AGENCY_ADMIN' : 'AGENT',
          agencyId: agency.id,
          lastLoginAt: daysAgo(intBetween(0, 5)),
        },
      })
      users.push({ id: user.id, name: agentName, email })
    }

    // Gebieden: één postcodegebied per kantoor plus losse postcodes, samen 25.
    await prisma.territory.create({
      data: {
        agencyId: agency.id,
        name: `${definition.name.split(' ').slice(-1)[0]} — kerngebied`,
        kind: 'POSTAL_CODE',
        postalCodes: [...definition.postalCodes],
        active: true,
      },
    })

    for (const postalCode of definition.postalCodes) {
      await prisma.territory.create({
        data: {
          agencyId: agency.id,
          name: `${postalCode} ${cityForPostalCode(postalCode) ?? ''}`.trim(),
          kind: 'POSTAL_CODE',
          postalCodes: [postalCode],
          active: true,
        },
      })
    }

    // Alertregels: één realtime met een hoge drempel, één ochtenddigest.
    await prisma.alertRule.create({
      data: {
        agencyId: agency.id,
        name: 'Hete kansen',
        kind: 'REALTIME',
        enabled: true,
        minScore: 75,
        requireCrmMatch: false,
        quietHoursStart: 22,
        quietHoursEnd: 7,
      },
    })

    await prisma.alertRule.create({
      data: {
        agencyId: agency.id,
        name: 'Ochtendbriefing',
        kind: 'DIGEST',
        enabled: true,
        minScore: 50,
        digestHour: 7,
      },
    })

    seeded.push({
      id: agency.id,
      name: definition.name,
      slug: definition.slug,
      postalCodes: [...definition.postalCodes],
      users,
    })
  }

  return seeded
}

// ─────────────────────────────────────────────────────────────────────────────
// De markt: panden, advertenties, snapshots, events
// ─────────────────────────────────────────────────────────────────────────────

interface ListingPlan {
  postalCode: string
  street: string
  houseNumber: string
  propertyType: PropertyType
  bedrooms: number
  surfaceArea: number
  /** Prijs bij de eerste waarneming. */
  initialPrice: number
  /** Elke prijsverlaging: hoeveel dagen na de start, en de nieuwe prijs. */
  priceChanges: { dayOffset: number; price: number }[]
  sellerType: SellerType
  sellerName: string | null
  sellerPhone: string | null
  /** Hoeveel dagen geleden de advertentie voor het eerst gezien is. */
  ageDays: number
  /** Ageless variant: minuten in plaats van dagen, voor verse advertenties. */
  ageMinutes?: number
  removedAfterDays?: number
  title: string
  description: string
  sourceId: string
}

const createdEvents: ListingEvent[] = []

/** Schrijft één event weg en onthoudt het voor de opportunity-afleiding. */
async function addEvent(input: {
  listingId: string
  propertyId: string
  type: ListingEventType
  occurredAt: Date
  dedupeKey: string
  detail: string
  oldPrice?: number
  newPrice?: number
  daysOnMarket?: number
  oldSellerType?: SellerType
  newSellerType?: SellerType
}): Promise<void> {
  const absoluteDrop =
    input.oldPrice !== undefined && input.newPrice !== undefined
      ? input.oldPrice - input.newPrice
      : undefined

  const event = await prisma.listingEvent.create({
    data: {
      listingId: input.listingId,
      propertyId: input.propertyId,
      type: input.type,
      occurredAt: input.occurredAt,
      detectedAt: input.occurredAt,
      oldPrice: input.oldPrice ?? null,
      newPrice: input.newPrice ?? null,
      absoluteDrop: absoluteDrop ?? null,
      percentageDrop:
        absoluteDrop !== undefined && input.oldPrice
          ? Number(((absoluteDrop / input.oldPrice) * 100).toFixed(2))
          : null,
      daysOnMarket: input.daysOnMarket ?? null,
      oldSellerType: input.oldSellerType ?? null,
      newSellerType: input.newSellerType ?? null,
      detail: input.detail,
      dedupeKey: input.dedupeKey,
    },
  })

  createdEvents.push(event)
}

/**
 * Maakt pand + advertentie + volledige snapshotgeschiedenis + events.
 *
 * Geeft de id's terug zodat scenario's er daarna nog iets aan kunnen hangen
 * (een herplaatsing, een CRM-relatie).
 */
async function createListingWithHistory(
  plan: ListingPlan,
  options: { propertyId?: string; previousListingId?: string; isRelist?: boolean } = {},
): Promise<{ propertyId: string; listingId: string; sellerId: string | null }> {
  const city = cityForPostalCode(plan.postalCode) ?? 'Onbekend'
  const province = provinceForPostalCode(plan.postalCode)
  const address = `${plan.street} ${plan.houseNumber}, ${plan.postalCode} ${city}`
  const matchKey = buildMatchKey(plan.postalCode, plan.street, plan.houseNumber)

  const firstSeenAt =
    plan.ageMinutes !== undefined ? minutesAgo(plan.ageMinutes) : daysAgo(plan.ageDays)

  const propertyId =
    options.propertyId ??
    (
      await prisma.property.create({
        data: {
          address,
          streetName: plan.street,
          houseNumber: plan.houseNumber,
          postalCode: plan.postalCode,
          city,
          province,
          propertyType: plan.propertyType,
          bedrooms: plan.bedrooms,
          surfaceArea: plan.surfaceArea,
          matchKey,
          listingCycles: options.isRelist ? 2 : 1,
          firstSeenAt,
          lastSeenAt: NOW,
        },
      })
    ).id

  // Verkoper: één rij per telefoonnummer, zodat twee advertenties van dezelfde
  // particulier tot één verkoper leiden.
  let sellerId: string | null = null
  if (plan.sellerName) {
    const phoneE164 = plan.sellerPhone ? normalizeBelgianPhone(plan.sellerPhone)?.e164 ?? null : null

    const existing = phoneE164
      ? await prisma.sellerIdentity.findUnique({ where: { phoneE164 } })
      : null

    const seller =
      existing ??
      (await prisma.sellerIdentity.create({
        data: {
          displayName: plan.sellerName,
          phoneE164,
          normalizedName: normalizeText(plan.sellerName),
          classification: plan.sellerType,
          confidence: plan.sellerType === 'PRIVATE' ? 0.94 : 0.91,
          reasons:
            plan.sellerType === 'PRIVATE'
              ? ['Expliciete particuliere verkoopmelding', 'Geen kantooridentiteit herkend']
              : ['Kantoornaam herkend', 'Meerdere gelijktijdige advertenties'],
          activeListingCount: plan.sellerType === 'PROFESSIONAL' ? intBetween(5, 22) : 1,
          firstSeenAt,
          lastSeenAt: NOW,
        },
      }))

    sellerId = seller.id
  }

  const finalPrice =
    plan.priceChanges.length > 0
      ? (plan.priceChanges[plan.priceChanges.length - 1]?.price ?? plan.initialPrice)
      : plan.initialPrice

  const removedAfterDays = plan.removedAfterDays
  const removed = removedAfterDays !== undefined
  const removedAt = removed ? daysAgo(plan.ageDays - removedAfterDays) : null

  const contentHash = stableHash({
    price: finalPrice,
    title: plan.title,
    address,
    postalCode: plan.postalCode,
  })

  const listing = await prisma.listing.create({
    data: {
      propertyId,
      sourceId: plan.sourceId,
      sourceListingId: `seed-${matchKey ?? plan.street}-${intBetween(100_000, 999_999)}`,
      sourceUrl: `https://demo.immoradar.local/listing/${encodeURIComponent(
        `${plan.postalCode}-${normalizeText(plan.street).replace(/\s+/g, '-')}-${plan.houseNumber}`,
      )}`,
      listingType: 'SALE',
      propertyType: plan.propertyType,
      title: plan.title,
      description: plan.description,
      currentPrice: finalPrice,
      initialPrice: plan.initialPrice,
      priceDropCount: plan.priceChanges.length,
      sellerId,
      sellerType: plan.sellerType,
      sellerConfidence: plan.sellerType === 'PRIVATE' ? 0.94 : 0.91,
      classificationReasons:
        plan.sellerType === 'PRIVATE'
          ? ['Expliciete particuliere verkoopmelding', 'Geen kantooridentiteit herkend']
          : ['Kantoornaam herkend in de advertentie'],
      status: removed ? 'REMOVED' : 'ACTIVE',
      removedAt,
      previousListingId: options.previousListingId ?? null,
      contentHash,
      publishedAt: firstSeenAt,
      firstSeenAt,
      lastSeenAt: removed ? (removedAt ?? NOW) : NOW,
      staleDaysReported: [30, 60, 90].filter((threshold) => plan.ageDays >= threshold),
    },
  })

  // ── Snapshots: de eerste waarneming plus één per wijziging ────────────────
  await prisma.listingSnapshot.create({
    data: {
      listingId: listing.id,
      capturedAt: firstSeenAt,
      price: plan.initialPrice,
      title: plan.title,
      description: plan.description,
      sellerName: plan.sellerName,
      sellerPhone: plan.sellerPhone,
      status: 'ACTIVE',
      contentHash: stableHash({ price: plan.initialPrice, title: plan.title }),
    },
  })

  await addEvent({
    listingId: listing.id,
    propertyId,
    type: 'NEW_LISTING',
    occurredAt: firstSeenAt,
    dedupeKey: `${listing.id}:NEW_LISTING`,
    detail: 'Advertentie voor het eerst waargenomen',
    newSellerType: plan.sellerType,
  })

  if (plan.sellerType === 'PRIVATE') {
    await addEvent({
      listingId: listing.id,
      propertyId,
      type: 'FSBO_DETECTED',
      occurredAt: firstSeenAt,
      dedupeKey: `${listing.id}:FSBO_DETECTED`,
      detail: 'Nieuwe advertentie van een particuliere verkoper',
      newSellerType: 'PRIVATE',
    })
  }

  // ── Tekstwijzigingen ──────────────────────────────────────────────────────
  //
  // Verkopers herschrijven hun advertentie: een zin erbij, "prijs bespreekbaar",
  // een nieuwe foto-omschrijving. Dat verandert de contentHash en verdient dus
  // een snapshot, maar levert geen event op — er is niets gebeurd dat een
  // makelaar moet weten. Ze staan hier omdat een timeline zonder deze ruis te
  // schoon is om representatief te zijn voor wat de matcher later te zien krijgt.
  const editCount = plan.ageDays >= 14 ? intBetween(0, 3) : 0
  for (let edit = 0; edit < editCount; edit += 1) {
    const capturedAt = new Date(
      firstSeenAt.getTime() + Math.round(((edit + 1) * plan.ageDays * DAY) / (editCount + 1)),
    )
    if (capturedAt >= NOW) continue

    const revisedDescription = `${plan.description} ${pick([
      'Bezichtiging enkel op afspraak.',
      'Prijs bespreekbaar bij snelle beslissing.',
      'EPC-attest beschikbaar.',
      'Nieuwe foto\'s toegevoegd.',
    ])}`

    await prisma.listingSnapshot.create({
      data: {
        listingId: listing.id,
        capturedAt,
        price: plan.initialPrice,
        title: plan.title,
        description: revisedDescription,
        sellerName: plan.sellerName,
        sellerPhone: plan.sellerPhone,
        status: 'ACTIVE',
        contentHash: stableHash({ description: revisedDescription, edit }),
      },
    })
  }

  let previousPrice = plan.initialPrice
  for (const change of plan.priceChanges) {
    const occurredAt = new Date(firstSeenAt.getTime() + change.dayOffset * DAY)

    await prisma.listingSnapshot.create({
      data: {
        listingId: listing.id,
        capturedAt: occurredAt,
        price: change.price,
        title: plan.title,
        description: plan.description,
        sellerName: plan.sellerName,
        sellerPhone: plan.sellerPhone,
        status: 'ACTIVE',
        contentHash: stableHash({ price: change.price, title: plan.title }),
      },
    })

    await addEvent({
      listingId: listing.id,
      propertyId,
      type: change.price < previousPrice ? 'PRICE_DROP' : 'PRICE_INCREASE',
      occurredAt,
      dedupeKey: `${listing.id}:PRICE_${change.dayOffset}`,
      detail:
        change.price < previousPrice
          ? `Vraagprijs verlaagd van € ${previousPrice.toLocaleString('nl-BE')} naar € ${change.price.toLocaleString('nl-BE')}`
          : `Vraagprijs verhoogd naar € ${change.price.toLocaleString('nl-BE')}`,
      oldPrice: previousPrice,
      newPrice: change.price,
      daysOnMarket: change.dayOffset,
    })

    previousPrice = change.price
  }

  // ── Stale-events op de gepasseerde drempels ───────────────────────────────
  for (const threshold of [30, 60, 90] as const) {
    if (plan.ageDays < threshold) continue

    await addEvent({
      listingId: listing.id,
      propertyId,
      type: `STALE_${threshold}` as ListingEventType,
      occurredAt: new Date(firstSeenAt.getTime() + threshold * DAY),
      dedupeKey: `${listing.id}:STALE_${threshold}`,
      detail: `Advertentie staat ${plan.ageDays} dagen online (drempel ${threshold} dagen)`,
      daysOnMarket: threshold,
    })
  }

  if (removed && removedAt) {
    await prisma.listingSnapshot.create({
      data: {
        listingId: listing.id,
        capturedAt: removedAt,
        price: finalPrice,
        title: plan.title,
        status: 'REMOVED',
        contentHash: stableHash({ price: finalPrice, status: 'REMOVED' }),
      },
    })

    await addEvent({
      listingId: listing.id,
      propertyId,
      type: 'LISTING_REMOVED',
      occurredAt: removedAt,
      dedupeKey: `${listing.id}:LISTING_REMOVED`,
      detail: 'Niet meer aangetroffen in de bron na 3 opeenvolgende runs',
      daysOnMarket: removedAfterDays,
    })
  }

  if (options.isRelist) {
    await addEvent({
      listingId: listing.id,
      propertyId,
      type: 'RELISTED',
      occurredAt: firstSeenAt,
      dedupeKey: `${listing.id}:RELISTED`,
      detail: 'Pand opnieuw aangeboden na een eerdere intrekking',
      newPrice: plan.initialPrice,
    })
  }

  return { propertyId, listingId: listing.id, sellerId }
}

/**
 * De generieke markt.
 *
 * Ongeveer 145 panden krijgen een eerste advertentie; een deel van de oudere
 * panden krijgt daarnaast een tweede advertentie op hetzelfde pand. Dat laatste
 * is niet decoratief: het is precies het geval waar de property matching en de
 * relist-detectie voor bestaan, en zonder die gevallen in de demodata is de
 * belangrijkste eigenschap van het datamodel niet zichtbaar.
 */
async function seedMarket(sources: { fixtureId: string; demoId: string }): Promise<void> {
  const usedAddresses = new Set<string>()
  /** Panden die zich lenen voor een herplaatsing: oud genoeg en ingetrokken. */
  const relistCandidates: { plan: ListingPlan; propertyId: string; listingId: string }[] = []

  for (let index = 0; index < 145; index += 1) {
    const postalCode = pick(POSTAL_CODES)
    const street = pick(STREETS)
    const houseNumber = String(intBetween(1, 180))
    const key = `${postalCode}:${street}:${houseNumber}`

    // Twee panden op hetzelfde adres zou de matcher terecht als één pand zien;
    // in de seed is dat alleen maar verwarrend.
    if (usedAddresses.has(key)) continue
    usedAddresses.add(key)

    const isApartment = random() < 0.38
    const isPrivate = random() < 0.42

    const ageDays = intBetween(1, 130)
    const basePrice = isApartment ? intBetween(185, 420) * 1_000 : intBetween(245, 780) * 1_000

    // Prijsverlagingen komen vaker voor naarmate een advertentie ouder is —
    // dat is precies het patroon dat het product wil kunnen aanwijzen.
    const dropCount = ageDays > 75 ? intBetween(0, 2) : ageDays > 40 ? intBetween(0, 1) : 0
    const priceChanges: { dayOffset: number; price: number }[] = []
    let price = basePrice
    for (let drop = 0; drop < dropCount; drop += 1) {
      price = Math.round((price * (1 - intBetween(3, 8) / 100)) / 1_000) * 1_000
      priceChanges.push({ dayOffset: 25 + drop * 28, price })
    }

    const person = personName()
    const brand = pick(AGENCY_BRANDS)

    // Een deel van de oudere advertenties is intussen ingetrokken.
    const withdrawn = ageDays > 60 && random() < 0.45
    const removedAfterDays = withdrawn ? Math.max(20, ageDays - intBetween(5, 25)) : undefined

    const plan: ListingPlan = {
      postalCode,
      street,
      houseNumber,
      propertyType: isApartment ? 'APARTMENT' : 'HOUSE',
      bedrooms: isApartment ? intBetween(1, 3) : intBetween(2, 5),
      surfaceArea: isApartment ? intBetween(65, 145) : intBetween(110, 280),
      initialPrice: basePrice,
      priceChanges,
      sellerType: isPrivate ? 'PRIVATE' : 'PROFESSIONAL',
      sellerName: isPrivate ? person.full : brand,
      sellerPhone: isPrivate ? mobileNumber('seller', index) : landlineNumber(index),
      ageDays,
      removedAfterDays,
      title: isApartment ? pick(APARTMENT_TITLES) : pick(HOUSE_TITLES),
      description: [
        isApartment ? pick(APARTMENT_TITLES) : pick(HOUSE_TITLES),
        `Gelegen in ${cityForPostalCode(postalCode) ?? 'België'}.`,
        isPrivate ? pick(PRIVATE_PHRASES) : pick(PROFESSIONAL_PHRASES),
        isPrivate ? `Contact: ${mobileNumber('seller', index)}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      sourceId: random() < 0.5 ? sources.fixtureId : sources.demoId,
    }

    const created = await createListingWithHistory(plan)

    if (withdrawn) {
      relistCandidates.push({ plan, propertyId: created.propertyId, listingId: created.listingId })
    }
  }

  // ── Herplaatsingen ────────────────────────────────────────────────────────
  //
  // Hetzelfde pand, een nieuwe advertentie: ander bron-id, andere URL, lagere
  // vraagprijs, herschreven tekst. Precies het geval waarvoor `Property` als
  // ankerpunt bestaat — de geschiedenis loopt door over twee advertenties heen.
  for (const candidate of relistCandidates) {
    const gapDays = intBetween(10, 70)
    const relistAge = Math.max(
      1,
      candidate.plan.ageDays - (candidate.plan.removedAfterDays ?? 0) - gapDays,
    )
    if (relistAge < 1) continue

    // Wie opnieuw probeert, doet dat bijna altijd tegen een lagere prijs.
    const lastPrice =
      candidate.plan.priceChanges[candidate.plan.priceChanges.length - 1]?.price ??
      candidate.plan.initialPrice
    const newPrice = Math.round((lastPrice * (1 - intBetween(2, 7) / 100)) / 1_000) * 1_000

    await createListingWithHistory(
      {
        ...candidate.plan,
        initialPrice: newPrice,
        priceChanges: [],
        ageDays: relistAge,
        removedAfterDays: undefined,
        title: candidate.plan.title,
        description: `Opnieuw beschikbaar. ${candidate.plan.description}`,
        sourceId: candidate.plan.sourceId,
      },
      {
        propertyId: candidate.propertyId,
        previousListingId: candidate.listingId,
        isRelist: true,
      },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Het klantenbestand van elk kantoor
// ─────────────────────────────────────────────────────────────────────────────

const CONTACT_TYPES = [
  'BUYER', 'SELLER', 'VALUATION_LEAD', 'PROSPECT', 'FORMER_CLIENT', 'LANDLORD', 'TENANT',
] as const

async function seedCrm(agencies: SeededAgency[]): Promise<void> {
  let counter = 0

  for (const agency of agencies) {
    // Een afgeronde import, zodat de importgeschiedenis niet leeg is.
    const importRecord = await prisma.crmImport.create({
      data: {
        agencyId: agency.id,
        adapter: 'csv',
        fileName: `export-${agency.slug}.csv`,
        fileHash: stableHash({ agency: agency.slug }),
        status: 'COMPLETED',
        columnMapping: {
          '0': 'externalId',
          '1': 'firstName',
          '2': 'lastName',
          '3': 'email',
          '4': 'phone',
          '5': 'address',
          '6': 'postalCode',
          '7': 'city',
          '8': 'contactType',
          '9': 'status',
          '10': 'assignedAgentName',
          '11': 'sourceCreatedAt',
          '12': 'lastContactAt',
        },
        totalRows: 100,
        createdCount: 100,
        startedAt: daysAgo(9),
        finishedAt: daysAgo(9, 10),
        createdById: agency.users[0]?.id ?? null,
      },
    })

    for (let index = 0; index < 100; index += 1) {
      counter += 1

      const person = personName()
      const postalCode = pick(agency.postalCodes)
      const city = cityForPostalCode(postalCode) ?? 'Onbekend'
      const street = pick(STREETS)
      const houseNumber = String(intBetween(1, 180))
      const contactType = pick(CONTACT_TYPES)
      const agent = pick(agency.users)

      // De leeftijdsverdeling is de kern van LeadRevive: ongeveer de helft van
      // het bestand is meer dan een jaar stil, want zo ziet een echt CRM eruit.
      const createdDaysAgo = intBetween(120, 2_900)
      const silenceDays = random() < 0.55 ? intBetween(400, 1_400) : intBetween(10, 300)
      const lastContactDaysAgo = Math.min(createdDaysAgo, silenceDays)

      // Een deel van de leads is nooit opgevolgd — de goedkoopste categorie.
      const neverContacted = random() < 0.12

      const phone = mobileNumber('crm', counter)
      const email = `${normalizeText(person.first)}.${normalizeText(person.last).replace(/\s+/g, '')}@example.be`

      const contact = await prisma.crmContact.create({
        data: {
          agencyId: agency.id,
          externalId: `CRM-${agency.slug.slice(0, 3).toUpperCase()}-${1_000 + index}`,
          firstName: person.first,
          lastName: person.last,
          displayName: person.full,
          email,
          phone,
          address: `${street} ${houseNumber}`,
          postalCode,
          city,
          province: provinceForPostalCode(postalCode),
          emailNormalized: email.toLowerCase(),
          phoneE164: phone,
          nameNormalized: normalizeText(person.full),
          addressMatchKey: buildMatchKey(postalCode, street, houseNumber),
          contactType,
          status: pick(['ACTIVE', 'LOST', 'WON', 'UNKNOWN'] as const),
          leadType: contactType === 'VALUATION_LEAD' ? 'Schattingsaanvraag website' : null,
          assignedUserId: agent.id,
          assignedAgentName: agent.name,
          sourceCreatedAt: daysAgo(createdDaysAgo),
          lastContactAt: neverContacted ? null : daysAgo(lastContactDaysAgo),
        },
      })

      await prisma.crmImportRow.create({
        data: {
          importId: importRecord.id,
          rowNumber: index + 1,
          status: 'CREATED',
          raw: {
            id: contact.externalId,
            voornaam: person.first,
            achternaam: person.last,
            email,
            telefoon: phone,
          },
          contactId: contact.id,
        },
      })

      // Contactmomenten voor wie ooit gesproken is.
      if (!neverContacted) {
        const interactionCount = intBetween(1, 4)
        for (let step = 0; step < interactionCount; step += 1) {
          await prisma.crmInteraction.create({
            data: {
              agencyId: agency.id,
              contactId: contact.id,
              kind:
                contactType === 'VALUATION_LEAD' && step === 0
                  ? 'VALUATION'
                  : pick(['CALL', 'EMAIL', 'MEETING', 'VISIT', 'NOTE'] as const),
              occurredAt: daysAgo(lastContactDaysAgo + step * intBetween(20, 90)),
              summary:
                contactType === 'VALUATION_LEAD' && step === 0
                  ? 'Schatting uitgevoerd ter plaatse'
                  : 'Contactmoment uit het CRM',
              agentName: agent.name,
            },
          })
        }
      }

      // Wie ooit kocht of verkocht heeft een pandrelatie. Dat is het scharnier
      // waar de CRM↔markt-matching op draait.
      if (contactType === 'BUYER' || contactType === 'SELLER' || contactType === 'FORMER_CLIENT') {
        await prisma.contactPropertyRelationship.create({
          data: {
            agencyId: agency.id,
            contactId: contact.id,
            address: `${street} ${houseNumber}`,
            postalCode,
            city,
            addressMatchKey: buildMatchKey(postalCode, street, houseNumber),
            role: contactType === 'BUYER' ? 'BUYER' : 'FORMER_OWNER',
            since: daysAgo(createdDaysAgo),
          },
        })
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// De vijf scenario's
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zet de scenario's neer waarop de demo leunt.
 *
 * Ze horen allemaal bij het eerste kantoor (Immo Example Gent), zodat één login
 * volstaat om het volledige verhaal te zien.
 */
async function seedScenarios(
  agencies: SeededAgency[],
  sources: { fixtureId: string; demoId: string },
): Promise<void> {
  const agency = agencies[0]
  if (!agency) throw new Error('Geen kantoor om scenario\'s aan te hangen')

  const thomas = agency.users[0]
  if (!thomas) throw new Error('Geen makelaar om scenario\'s aan toe te wijzen')

  // ── Scenario A — verse FSBO zonder CRM-relatie ────────────────────────────
  await createListingWithHistory({
    postalCode: '9030',
    street: 'Brugsevaart',
    houseNumber: '44',
    propertyType: 'HOUSE',
    bedrooms: 3,
    surfaceArea: 168,
    initialPrice: 389_000,
    priceChanges: [],
    sellerType: 'PRIVATE',
    sellerName: 'Katrien Bogaert',
    sellerPhone: '+32475884412',
    ageDays: 0,
    ageMinutes: 34,
    title: 'Instapklare woning met tuin',
    description: [
      'Ruime gezinswoning met zuidgerichte tuin in Mariakerke.',
      'Verkoop door eigenaar, zonder makelaar.',
      'Contact: 0475 88 44 12',
    ].join(' '),
    sourceId: sources.demoId,
  })

  // ── Scenario B — verse FSBO bij een eerdere koper (het vlaggenschip) ──────
  //
  // Pieter kocht in 2019 via het kantoor. Datzelfde huis staat nu als
  // particuliere verkoop online. De CRM-matching hoort hem te vinden op zowel
  // telefoonnummer als pandrelatie.
  const pieterPhone = '+32476112233'
  const pieterStreet = 'Lindelaan'
  const pieterNumber = '17'
  const pieterPostal = '9000'

  const pieter = await prisma.crmContact.create({
    data: {
      agencyId: agency.id,
      externalId: 'CRM-IMM-0001',
      firstName: 'Pieter',
      lastName: 'Janssens',
      displayName: 'Pieter Janssens',
      email: 'pieter.janssens@example.be',
      phone: '0476 11 22 33',
      address: `${pieterStreet} ${pieterNumber}`,
      postalCode: pieterPostal,
      city: 'Gent',
      province: 'oost-vlaanderen',
      emailNormalized: 'pieter.janssens@example.be',
      phoneE164: pieterPhone,
      nameNormalized: normalizeText('Pieter Janssens'),
      addressMatchKey: buildMatchKey(pieterPostal, pieterStreet, pieterNumber),
      contactType: 'BUYER',
      status: 'WON',
      leadType: 'Aankoopdossier',
      assignedUserId: thomas.id,
      assignedAgentName: thomas.name,
      notes: 'Kocht de woning in de Lindelaan via ons kantoor. Vlotte klant.',
      sourceCreatedAt: new Date(Date.UTC(2019, 2, 14)),
      lastContactAt: new Date(Date.UTC(2019, 5, 3)),
    },
  })

  await prisma.crmInteraction.create({
    data: {
      agencyId: agency.id,
      contactId: pieter.id,
      kind: 'MANDATE',
      occurredAt: new Date(Date.UTC(2019, 2, 14)),
      summary: 'Compromis getekend — aankoop Lindelaan 17',
      agentName: thomas.name,
    },
  })

  await prisma.crmInteraction.create({
    data: {
      agencyId: agency.id,
      contactId: pieter.id,
      kind: 'CALL',
      occurredAt: new Date(Date.UTC(2019, 5, 3)),
      summary: 'Nazorg na verhuis',
      agentName: thomas.name,
    },
  })

  const scenarioB = await createListingWithHistory({
    postalCode: pieterPostal,
    street: pieterStreet,
    houseNumber: pieterNumber,
    propertyType: 'HOUSE',
    bedrooms: 4,
    surfaceArea: 196,
    initialPrice: 625_000,
    priceChanges: [],
    sellerType: 'PRIVATE',
    sellerName: 'Pieter Janssens',
    sellerPhone: pieterPhone,
    ageDays: 0,
    ageMinutes: 12,
    title: 'Karaktervolle woning met tuin in Gent',
    description: [
      'Ruime woning met vier slaapkamers, volledig gerenoveerd in 2019.',
      'Particuliere verkoop — geen immokantoren aub.',
      'Contact: 0476 11 22 33',
    ].join(' '),
    sourceId: sources.demoId,
  })

  // De pandrelatie: het kantoor weet uit eigen dossiers dat dit Pieters huis is.
  await prisma.contactPropertyRelationship.create({
    data: {
      agencyId: agency.id,
      contactId: pieter.id,
      propertyId: scenarioB.propertyId,
      address: `${pieterStreet} ${pieterNumber}`,
      postalCode: pieterPostal,
      city: 'Gent',
      addressMatchKey: buildMatchKey(pieterPostal, pieterStreet, pieterNumber),
      role: 'OWNER',
      since: new Date(Date.UTC(2019, 2, 14)),
      note: 'Aangekocht via ons kantoor in maart 2019',
    },
  })

  // ── Scenario C — particulier, 67 dagen online, twee prijsverlagingen ──────
  await createListingWithHistory({
    postalCode: '9040',
    street: 'Kasteeldreef',
    houseNumber: '8',
    propertyType: 'HOUSE',
    bedrooms: 4,
    surfaceArea: 215,
    initialPrice: 510_000,
    priceChanges: [
      { dayOffset: 20, price: 495_000 },
      { dayOffset: 36, price: 475_000 },
    ],
    sellerType: 'PRIVATE',
    sellerName: 'Marc Vermeulen',
    sellerPhone: '+32479556677',
    ageDays: 67,
    title: 'Ruime villa met grote tuin',
    description: [
      'Villa met vier slaapkamers op een perceel van 940 m².',
      'Wij verkopen zelf onze woning.',
      'Contact: 0479 55 66 77',
    ].join(' '),
    sourceId: sources.demoId,
  })

  // ── Scenario D — slapende schattingsaanvraag, geen extern signaal ─────────
  const annStreet = 'Wijngaardstraat'
  const annNumber = '23'

  const ann = await prisma.crmContact.create({
    data: {
      agencyId: agency.id,
      externalId: 'CRM-IMM-0002',
      firstName: 'An',
      lastName: 'De Clercq',
      displayName: 'An De Clercq',
      email: 'an.declercq@example.be',
      phone: '0478 33 44 55',
      address: `${annStreet} ${annNumber}`,
      postalCode: '9050',
      city: 'Gentbrugge',
      province: 'oost-vlaanderen',
      emailNormalized: 'an.declercq@example.be',
      phoneE164: '+32478334455',
      nameNormalized: normalizeText('An De Clercq'),
      addressMatchKey: buildMatchKey('9050', annStreet, annNumber),
      contactType: 'VALUATION_LEAD',
      status: 'LOST',
      leadType: 'Schattingsaanvraag website',
      assignedUserId: thomas.id,
      assignedAgentName: thomas.name,
      notes: 'Schatting uitgevoerd, geen mandaat gevolgd. Wilde eerst de markt bekijken.',
      sourceCreatedAt: daysAgo(760),
      lastContactAt: daysAgo(640),
    },
  })

  await prisma.crmInteraction.create({
    data: {
      agencyId: agency.id,
      contactId: ann.id,
      kind: 'VALUATION',
      occurredAt: daysAgo(760),
      summary: 'Schatting ter plaatse uitgevoerd — richtprijs € 430.000',
      agentName: thomas.name,
    },
  })

  await prisma.contactPropertyRelationship.create({
    data: {
      agencyId: agency.id,
      contactId: ann.id,
      address: `${annStreet} ${annNumber}`,
      postalCode: '9050',
      city: 'Gentbrugge',
      addressMatchKey: buildMatchKey('9050', annStreet, annNumber),
      role: 'VALUATION_SUBJECT',
      since: daysAgo(760),
    },
  })

  // ── Scenario E — herplaatst pand bij een bestaande relatie ────────────────
  const lucStreet = 'Meersstraat'
  const lucNumber = '61'
  const lucPhone = '+32473998877'

  const luc = await prisma.crmContact.create({
    data: {
      agencyId: agency.id,
      externalId: 'CRM-IMM-0003',
      firstName: 'Luc',
      lastName: 'Segers',
      displayName: 'Luc Segers',
      email: 'luc.segers@example.be',
      phone: '0473 99 88 77',
      address: `${lucStreet} ${lucNumber}`,
      postalCode: '9000',
      city: 'Gent',
      province: 'oost-vlaanderen',
      emailNormalized: 'luc.segers@example.be',
      phoneE164: lucPhone,
      nameNormalized: normalizeText('Luc Segers'),
      addressMatchKey: buildMatchKey('9000', lucStreet, lucNumber),
      contactType: 'SELLER',
      status: 'LOST',
      leadType: 'Verkoopdossier',
      assignedUserId: agency.users[1]?.id ?? thomas.id,
      assignedAgentName: agency.users[1]?.name ?? thomas.name,
      notes: 'Mandaatgesprek in 2023, koos uiteindelijk voor zelf verkopen.',
      sourceCreatedAt: daysAgo(900),
      lastContactAt: daysAgo(520),
    },
  })

  // Eerst de ingetrokken advertentie, dan de herplaatsing op hetzelfde pand.
  const firstAttempt = await createListingWithHistory({
    postalCode: '9000',
    street: lucStreet,
    houseNumber: lucNumber,
    propertyType: 'HOUSE',
    bedrooms: 3,
    surfaceArea: 154,
    initialPrice: 495_000,
    priceChanges: [{ dayOffset: 30, price: 479_000 }],
    sellerType: 'PRIVATE',
    sellerName: 'Luc Segers',
    sellerPhone: lucPhone,
    ageDays: 210,
    removedAfterDays: 96,
    title: 'Gerenoveerde rijwoning nabij het centrum',
    description: [
      'Rijwoning met stadstuin, gerenoveerd in 2016.',
      'Rechtstreeks van particulier aan particulier.',
    ].join(' '),
    sourceId: sources.demoId,
  })

  await createListingWithHistory(
    {
      postalCode: '9000',
      street: lucStreet,
      houseNumber: lucNumber,
      propertyType: 'HOUSE',
      bedrooms: 3,
      surfaceArea: 154,
      initialPrice: 465_000,
      priceChanges: [],
      sellerType: 'PRIVATE',
      sellerName: 'Luc Segers',
      sellerPhone: lucPhone,
      ageDays: 2,
      title: 'Gerenoveerde rijwoning met stadstuin',
      description: [
        'Opnieuw beschikbaar: rijwoning met stadstuin in Gent.',
        'Particuliere verkoop, zonder makelaar.',
      ].join(' '),
      sourceId: sources.demoId,
    },
    {
      propertyId: firstAttempt.propertyId,
      previousListingId: firstAttempt.listingId,
      isRelist: true,
    },
  )

  await prisma.contactPropertyRelationship.create({
    data: {
      agencyId: agency.id,
      contactId: luc.id,
      propertyId: firstAttempt.propertyId,
      address: `${lucStreet} ${lucNumber}`,
      postalCode: '9000',
      city: 'Gent',
      addressMatchKey: buildMatchKey('9000', lucStreet, lucNumber),
      role: 'OWNER',
      since: daysAgo(900),
      note: 'Mandaatgesprek 2023 — eigenaar verkocht uiteindelijk zelf',
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Uitvoeren
// ─────────────────────────────────────────────────────────────────────────────

/** Alles weg, in de volgorde die de foreign keys toestaan. */
async function reset(): Promise<void> {
  await prisma.opportunityActivity.deleteMany()
  await prisma.opportunityAssignment.deleteMany()
  await prisma.opportunityScore.deleteMany()
  await prisma.opportunitySignal.deleteMany()
  await prisma.opportunityReason.deleteMany()
  await prisma.alert.deleteMany()
  await prisma.opportunity.deleteMany()
  await prisma.alertRule.deleteMany()

  await prisma.crmImportRow.deleteMany()
  await prisma.crmImport.deleteMany()
  await prisma.crmInteraction.deleteMany()
  await prisma.contactPropertyRelationship.deleteMany()
  await prisma.crmContact.deleteMany()

  await prisma.listingEvent.deleteMany()
  await prisma.listingSnapshot.deleteMany()
  // De relist-keten wijst naar zichzelf; eerst de verwijzing losmaken.
  await prisma.listing.updateMany({ data: { previousListingId: null } })
  await prisma.listing.deleteMany()
  await prisma.property.deleteMany()
  await prisma.sellerIdentity.deleteMany()
  await prisma.agencyIdentity.deleteMany()

  await prisma.collectorRun.deleteMany()
  await prisma.territory.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.user.deleteMany()
  await prisma.agency.deleteMany()
  await prisma.source.deleteMany()
  await prisma.auditLog.deleteMany()
}

async function main(): Promise<void> {
  // De seed begint met álles te wissen. In productie is dat het verlies van
  // elk klantenbestand; daar hoort een expliciete, bewuste vlag bij.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'De demo-seed wist de hele database en draait niet in productie. ' +
        'Gebruik npm run bootstrap:admin voor een eerste beheerder, of zet ALLOW_DEMO_SEED=true ' +
        'als dit écht een wegwerpomgeving is.',
    )
  }

  const log = (message: string): void => {
    process.stdout.write(`${message}\n`)
  }

  log('Bestaande data wissen…')
  await reset()

  log('Bronnen…')
  const sources = await seedSources()

  log('Kantoren, gebruikers en gebieden…')
  const agencies = await seedAgencies()

  log('Markt: panden, advertenties, snapshots en events…')
  await seedMarket(sources)

  log('Klantenbestanden…')
  await seedCrm(agencies)

  log('Scenario\'s A tot en met E…')
  await seedScenarios(agencies, sources)

  // ── De kansen worden afgeleid, niet geschreven ───────────────────────────
  //
  // Dit is de belangrijkste regel van de seed: wat het dashboard toont komt uit
  // dezelfde motor die in productie draait.
  log(`Kansen afleiden uit ${createdEvents.length} marktgebeurtenissen…`)
  const market = await createOpportunitiesForEvents(createdEvents, NOW)

  log('LeadRevive over de klantenbestanden…')
  const revive = await runLeadReviveForAllAgencies(NOW)
  const reviveTotal = revive.reduce((sum, entry) => sum + entry.opportunitiesCreated, 0)

  const counts = {
    agencies: await prisma.agency.count(),
    users: await prisma.user.count(),
    territories: await prisma.territory.count(),
    properties: await prisma.property.count(),
    listings: await prisma.listing.count(),
    snapshots: await prisma.listingSnapshot.count(),
    events: await prisma.listingEvent.count(),
    contacts: await prisma.crmContact.count(),
    interactions: await prisma.crmInteraction.count(),
    opportunities: await prisma.opportunity.count(),
  }

  log('')
  log('  Klaar.')
  log('')
  log(`  Kantoren          ${counts.agencies}`)
  log(`  Gebruikers        ${counts.users}`)
  log(`  Gebieden          ${counts.territories}`)
  log(`  Panden            ${counts.properties}`)
  log(`  Advertenties      ${counts.listings}`)
  log(`  Snapshots         ${counts.snapshots}`)
  log(`  Marktgebeurtenis  ${counts.events}`)
  log(`  CRM-contacten     ${counts.contacts}`)
  log(`  Interacties       ${counts.interactions}`)
  log(`  Kansen            ${counts.opportunities}  (markt ${market.created}, LeadRevive ${reviveTotal})`)
  log('')
  log('  Inloggen op http://localhost:3000')
  log('')
  log('    thomas@immo-example-gent.be   / immoradar    (kantoorbeheerder)')
  log('    sofie@immo-example-gent.be    / immoradar    (makelaar)')
  log('    admin@immoradar.be            / immoradar    (platformbeheerder)')
  log('')
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed mislukt: ${String(error)}\n`)
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
