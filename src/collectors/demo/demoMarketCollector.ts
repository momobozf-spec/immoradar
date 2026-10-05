import type { RawListing } from '@/domain/types'
import { getEnv } from '@/lib/env'

import type { CollectorContext, CollectorDefinition, CollectorResult } from '../types'

/**
 * Een synthetische Belgische markt die écht beweegt.
 *
 * ─── WAAROM DIT BESTAAT ──────────────────────────────────────────────────────
 *
 * De fixture-collector geeft elke run hetzelfde terug. Daar is niets mis mee —
 * hij bewijst dat de pijplijn een advertentie kan opnemen — maar hij bewijst
 * níet waar dit product op draait: dat het systeem de *levensloop* van een pand
 * volgt. Prijsdalingen, intrekkingen en herplaatsingen zie je alleen als de
 * bron tussen twee runs verandert.
 *
 * Deze collector doet dat, zonder database en zonder netwerk, door de
 * markttoestand uit de klok af te leiden. Elke `DEMO_TICK_MINUTES` schuift de
 * markt één stap op. Over één volledige cyclus doorloopt elk pand:
 *
 *     tick 0–5    actief, prijs zakt stapsgewijs      → PRICE_DROP
 *     tick 6–9    verdwenen uit de bron               → LISTING_REMOVED
 *     tick 10–11  terug, nieuw bron-id, lagere prijs  → RELISTED
 *
 * Dat is precies het scenario dat een makelaar wil zien en dat een concurrent
 * die alleen naar "wat staat er vandaag online" kijkt per definitie mist.
 *
 * De panden staan bewust op een eigen `.test`-domein: er is geen echte site die
 * hierdoor geraakt wordt.
 */

interface DemoProperty {
  id: string
  title: string
  description: string
  basePrice: number
  /** Hoeveel euro de prijs per tick zakt zolang de advertentie loopt. */
  dropStep: number
  propertyType: string
  address: string
  postalCode: string
  city: string
  bedrooms?: number
  surfaceArea?: number
  sellerName: string
  sellerPhone?: string
  sellerTypeHint: 'private' | 'professional' | 'unknown'
  /**
   * Loopt dit pand de volledige cyclus met intrekking en herplaatsing? Voor een
   * deel van de markt staat dit uit — anders zou élk pand tegelijk verdwijnen
   * en ziet het dashboard er om de zoveel minuten leeg uit.
   */
  cycles: boolean
}

const CYCLE_LENGTH = 12
const ACTIVE_UNTIL = 6
const ABSENT_UNTIL = 10

const CATALOGUE: readonly DemoProperty[] = [
  {
    id: 'demo-gent-1',
    title: 'Gerenoveerde burgerwoning met stadstuin',
    description:
      'Wij verkopen zelf, zonder makelaar. Volledig gerenoveerde burgerwoning met drie slaapkamers en een aangelegde stadstuin. Geen immokantoren gelieve.',
    basePrice: 495000,
    dropStep: 10000,
    propertyType: 'huis',
    address: 'Sint-Amandstraat 41, 9000 Gent',
    postalCode: '9000',
    city: 'Gent',
    bedrooms: 3,
    surfaceArea: 174,
    sellerName: 'Karel Dhondt',
    sellerPhone: '0478 45 12 09',
    sellerTypeHint: 'private',
    cycles: true,
  },
  {
    id: 'demo-hasselt-1',
    title: 'Vrijstaande woning op ruim perceel',
    description:
      'Particuliere verkoop door de eigenaar. Vrijstaande woning met vier slaapkamers, garage en tuin van 12 are. Rustig gelegen nabij het centrum.',
    basePrice: 545000,
    dropStep: 12500,
    propertyType: 'huis',
    address: 'Kempische Steenweg 210, 3500 Hasselt',
    postalCode: '3500',
    city: 'Hasselt',
    bedrooms: 4,
    surfaceArea: 232,
    sellerName: 'Greet Vanhees',
    sellerPhone: '0495 33 22 11',
    sellerTypeHint: 'private',
    cycles: true,
  },
  {
    id: 'demo-antwerpen-1',
    title: 'Loft met dakterras',
    description:
      'Ons kantoor biedt deze uitzonderlijke loft aan. Bezoek onze website voor de plannen. IPI 501.233.',
    basePrice: 620000,
    dropStep: 7500,
    propertyType: 'appartement',
    address: 'Nationalestraat 76, 2000 Antwerpen',
    postalCode: '2000',
    city: 'Antwerpen',
    bedrooms: 2,
    surfaceArea: 145,
    sellerName: 'Metropool Vastgoed NV',
    sellerPhone: '03 232 11 44',
    sellerTypeHint: 'professional',
    cycles: false,
  },
  {
    id: 'demo-brugge-1',
    title: 'Woning met handelsgelijkvloers',
    description:
      'Te koop wegens pensioen. Wij verkopen rechtstreeks, zonder tussenpersoon. Handelsgelijkvloers met woonst erboven, in een drukke winkelstraat.',
    basePrice: 389000,
    dropStep: 9000,
    propertyType: 'handelspand',
    address: 'Langestraat 118, 8000 Brugge',
    postalCode: '8000',
    city: 'Brugge',
    bedrooms: 3,
    surfaceArea: 198,
    sellerName: 'Rita Declercq',
    sellerPhone: '0468 77 41 23',
    sellerTypeHint: 'private',
    cycles: true,
  },
  {
    id: 'demo-leuven-1',
    title: 'Studentenpand met zes kamers',
    description:
      'Investeringspand vlak bij de campus. Onze expert licht het rendement graag toe. Contacteer ons kantoor voor een afspraak.',
    basePrice: 725000,
    dropStep: 5000,
    propertyType: 'huis',
    address: 'Tiensestraat 154, 3000 Leuven',
    postalCode: '3000',
    city: 'Leuven',
    bedrooms: 6,
    surfaceArea: 260,
    sellerName: 'Campus Invest BV',
    sellerPhone: '016 22 88 99',
    sellerTypeHint: 'professional',
    cycles: false,
  },
  {
    id: 'demo-namen-1',
    title: 'Maison de maître à rénover',
    description:
      'Vente de particulier à particulier. Agences s abstenir. Maison de maître à rénover, quatre chambres, jardin clos.',
    basePrice: 340000,
    dropStep: 8000,
    propertyType: 'maison',
    address: 'Rue de Fer 62, 5000 Namur',
    postalCode: '5000',
    city: 'Namen',
    bedrooms: 4,
    surfaceArea: 205,
    sellerName: 'Luc Léonard',
    sellerPhone: '0487 62 15 30',
    sellerTypeHint: 'private',
    cycles: true,
  },
  {
    id: 'demo-kortrijk-1',
    title: 'Instapklaar appartement met zicht op de Leie',
    description:
      'Lichtrijk appartement met twee slaapkamers en een ruim terras. Verkoop door de eigenaars zelf.',
    basePrice: 298000,
    dropStep: 6000,
    propertyType: 'appartement',
    address: 'Handelskaai 12, 8500 Kortrijk',
    postalCode: '8500',
    city: 'Kortrijk',
    bedrooms: 2,
    surfaceArea: 96,
    sellerName: 'Bram Vandewalle',
    sellerPhone: '0479 18 26 44',
    sellerTypeHint: 'private',
    cycles: false,
  },
  {
    id: 'demo-mechelen-1',
    title: 'Rijwoning met zuidgerichte tuin',
    description:
      'Charmante rijwoning met drie slaapkamers. Ons team begeleidt u van bezichtiging tot akte.',
    basePrice: 355000,
    dropStep: 7000,
    propertyType: 'huis',
    address: 'Nekkerspoelstraat 88, 2800 Mechelen',
    postalCode: '2800',
    city: 'Mechelen',
    bedrooms: 3,
    surfaceArea: 158,
    sellerName: 'Dijle Immo BVBA',
    sellerPhone: '015 44 55 66',
    sellerTypeHint: 'professional',
    cycles: false,
  },
]

/**
 * Vast ankerpunt voor de klok. Zonder een vaste epoch zou "tick 0" verschuiven
 * bij elke herstart en zou de markt terugspringen in plaats van vooruit lopen.
 */
const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

interface DemoState {
  present: boolean
  price: number
  /** Loopt op bij elke herplaatsing; zit in het bron-id verwerkt. */
  cycleIndex: number
  tickInCycle: number
}

/**
 * De toestand van één pand op één moment.
 *
 * Geëxporteerd omdat de tests hem rechtstreeks bevragen: zo is te controleren
 * dat de cyclus doet wat de documentatie hierboven belooft, zonder de klok te
 * moeten manipuleren.
 */
export function demoStateAt(property: DemoProperty, now: Date, tickMinutes: number): DemoState {
  const elapsedMinutes = Math.max(0, (now.getTime() - EPOCH_MS) / 60_000)
  const tick = Math.floor(elapsedMinutes / tickMinutes)

  if (!property.cycles) {
    // Panden zonder cyclus zakken langzaam en blijven staan. Ze houden het
    // dashboard gevuld terwijl de andere helft door zijn levensloop loopt.
    const steps = Math.floor(tick / 4) % 6
    return {
      present: true,
      price: property.basePrice - property.dropStep * steps,
      cycleIndex: 0,
      tickInCycle: steps,
    }
  }

  const cycleIndex = Math.floor(tick / CYCLE_LENGTH)
  const tickInCycle = tick % CYCLE_LENGTH

  if (tickInCycle < ACTIVE_UNTIL) {
    return {
      present: true,
      price: property.basePrice - property.dropStep * tickInCycle,
      cycleIndex,
      tickInCycle,
    }
  }

  if (tickInCycle < ABSENT_UNTIL) {
    return { present: false, price: 0, cycleIndex, tickInCycle }
  }

  // Herplaatsing: nieuw bron-id, en een vraagprijs onder de laatste die niet
  // werkte. Zo hoort een herplaatsing er ook echt uit te zien.
  return {
    present: true,
    price: Math.round((property.basePrice - property.dropStep * ACTIVE_UNTIL) / 1000) * 1000,
    cycleIndex,
    tickInCycle,
  }
}

/** Het bron-id voor deze cyclus. Bij een herplaatsing is dat een nieuw id. */
function sourceListingIdFor(property: DemoProperty, state: DemoState): string {
  if (!property.cycles || state.tickInCycle < ACTIVE_UNTIL) {
    return `${property.id}-c${state.cycleIndex}`
  }
  return `${property.id}-c${state.cycleIndex}-relist`
}

export const demoMarketCollector: CollectorDefinition = {
  source: 'demo-be',
  name: 'Demomarkt (synthetisch)',
  accessMethod: 'SYNTHETIC',
  baseUrl: 'https://demo.immoradar.test',
  defaultPollIntervalSeconds: 120,
  defaultRateLimitPerMinute: 60,
  accessNotes:
    'Volledig synthetische data, in de code gegenereerd. Raakt geen enkele externe dienst; het .test-domein bestaat niet en wordt nooit opgehaald.',
  requiresBrowser: false,

  async collect(context: CollectorContext): Promise<CollectorResult> {
    const tickMinutes = getEnv().DEMO_TICK_MINUTES
    const now = new Date()
    const listings: RawListing[] = []

    for (const property of CATALOGUE.slice(0, context.maxItems)) {
      const state = demoStateAt(property, now, tickMinutes)
      if (!state.present) continue

      const sourceListingId = sourceListingIdFor(property, state)
      const isRelist = sourceListingId.endsWith('-relist')

      listings.push({
        source: demoMarketCollector.source,
        sourceListingId,
        url: `https://demo.immoradar.test/te-koop/${sourceListingId}`,
        title: isRelist ? `${property.title} — opnieuw beschikbaar` : property.title,
        description: property.description,
        price: state.price,
        currency: 'EUR',
        listingType: 'sale',
        propertyType: property.propertyType,
        address: property.address,
        postalCode: property.postalCode,
        city: property.city,
        bedrooms: property.bedrooms,
        surfaceArea: property.surfaceArea,
        sellerName: property.sellerName,
        sellerPhone: property.sellerPhone,
        sellerTypeHint: property.sellerTypeHint,
        scrapedAt: now,
        raw: { demo: true, tickInCycle: state.tickInCycle, cycleIndex: state.cycleIndex },
      })
    }

    context.logger.debug('Demomarkt gegenereerd', {
      count: listings.length,
      tickMinutes,
    })

    return { listings, warnings: [] }
  },
}
