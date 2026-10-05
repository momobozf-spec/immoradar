import type { RawListing } from '@/domain/types'
import { ParseError } from '@/lib/errors'

import { extractJsonLd, pickNumber, pickString, selectByType } from '../base/jsonld'
import type { CollectorContext, CollectorDefinition, CollectorResult } from '../types'

/**
 * Referentie-implementatie voor een échte bron die JSON-LD publiceert.
 *
 * ─── WAAROM DEZE COLLECTOR ER IS TERWIJL HIJ UIT STAAT ───────────────────────
 *
 * De opdracht is duidelijk: alleen bronnen integreren waarvoor geautomatiseerde
 * toegang technisch én contractueel is toegestaan, en anders met fixtures
 * werken. Er is voor deze MVP geen Belgische vastgoedsite waarvan wij hier
 * kunnen vaststellen dat aan beide voorwaarden voldaan is — dus staat er geen
 * enkele echte bron aan.
 *
 * Wat wél kan, is het werk klaarzetten zodat het aanzetten van een goedgekeurde
 * bron een kwestie van configuratie is in plaats van een nieuw project. Deze
 * collector is dat werk: hij leest de gestructureerde data die een site zelf
 * publiceert voor zoekmachines, via de HttpClient die robots.txt afdwingt en de
 * rate limiting regelt.
 *
 * ─── WAT HIJ NIET DOET ───────────────────────────────────────────────────────
 *
 * Geen loginwalls, geen CAPTCHA's, geen headless browser, geen omzeiling van
 * wat dan ook. Weigert de site, dan is dat het antwoord: de bron gaat in
 * cooldown en het dashboard toont waarom.
 *
 * Zie docs/ADDING-A-SOURCE.md voor het volledige recept, inclusief de vragen
 * die vóór het aanzetten beantwoord moeten zijn.
 */

export interface JsonLdFeedConfig {
  key: string
  name: string
  /** Origin van de bron, bv. "https://voorbeeld.be". */
  baseUrl: string
  /**
   * Pagina met links naar advertenties. Leeg laten om de sitemaps te gebruiken
   * die robots.txt aanwijst — de nettere route, want die wijst de site zelf aan.
   */
  indexPath?: string
  /** Welke links advertentiepagina's zijn. */
  listingUrlPattern: RegExp
  /** Verplichte verantwoording; komt in het dashboard te staan. */
  accessNotes: string
  defaultPollIntervalSeconds?: number
  defaultRateLimitPerMinute?: number
  /** Hoeveel detailpagina's per run maximaal opgehaald worden. */
  maxDetailPages?: number
}

/** schema.org-typen waarin vastgoedadvertenties zich presenteren. */
const LISTING_TYPES = [
  'RealEstateListing',
  'Residence',
  'SingleFamilyResidence',
  'Apartment',
  'House',
  'Offer',
  'Product',
]

const HREF = /href\s*=\s*["']([^"']+)["']/gi

export function createJsonLdFeedCollector(config: JsonLdFeedConfig): CollectorDefinition {
  return {
    source: config.key,
    name: config.name,
    accessMethod: 'STRUCTURED_DATA',
    baseUrl: config.baseUrl,
    defaultPollIntervalSeconds: config.defaultPollIntervalSeconds ?? 900,
    defaultRateLimitPerMinute: config.defaultRateLimitPerMinute ?? 10,
    accessNotes: config.accessNotes,
    requiresBrowser: false,

    async collect(context: CollectorContext): Promise<CollectorResult> {
      const warnings: string[] = []
      const maxDetailPages = Math.min(config.maxDetailPages ?? 50, context.maxItems)

      const indexUrls = await resolveIndexUrls(config, context)
      if (indexUrls.length === 0) {
        return { listings: [], warnings: ['Geen index- of sitemap-URL gevonden voor deze bron'] }
      }

      // 1. Advertentie-URL's verzamelen uit de indexpagina's.
      const listingUrls = new Set<string>()

      for (const indexUrl of indexUrls) {
        if (context.signal.aborted) break

        try {
          const response = await context.http.get(indexUrl, { signal: context.signal })
          for (const url of extractLinks(response.body, config)) {
            listingUrls.add(url)
            if (listingUrls.size >= maxDetailPages) break
          }
        } catch (error) {
          // Eén stukke indexpagina mag de run niet slopen; de bron wordt PARTIAL.
          warnings.push(`Indexpagina ${indexUrl} mislukte: ${messageOf(error)}`)
        }

        if (listingUrls.size >= maxDetailPages) break
      }

      // 2. Per advertentiepagina de gestructureerde data lezen.
      const listings: RawListing[] = []

      for (const url of listingUrls) {
        if (context.signal.aborted) break

        try {
          const response = await context.http.get(url, { signal: context.signal })
          const listing = parseListingPage(response.body, response.url, config.key)

          if (listing) listings.push(listing)
          else warnings.push(`Geen bruikbare JSON-LD op ${url}`)
        } catch (error) {
          warnings.push(`Detailpagina ${url} mislukte: ${messageOf(error)}`)
        }
      }

      context.logger.info('JSON-LD-bron gelezen', {
        source: config.key,
        indexPages: indexUrls.length,
        detailPages: listingUrls.size,
        listings: listings.length,
      })

      return { listings, warnings }
    },
  }
}

async function resolveIndexUrls(
  config: JsonLdFeedConfig,
  context: CollectorContext,
): Promise<string[]> {
  if (config.indexPath) {
    return [new URL(config.indexPath, config.baseUrl).toString()]
  }

  // Geen expliciete indexpagina: vraag robots.txt welke sitemaps er zijn. Dat is
  // het startpunt dat de site zelf aanwijst voor geautomatiseerde lezers.
  try {
    const sitemaps = await context.http.sitemapsFor(new URL(config.baseUrl).origin)
    return sitemaps.slice(0, 5)
  } catch {
    return []
  }
}

function extractLinks(html: string, config: JsonLdFeedConfig): string[] {
  const found: string[] = []

  for (const match of html.matchAll(HREF)) {
    const href = match[1]
    if (!href) continue

    let absolute: string
    try {
      absolute = new URL(href, config.baseUrl).toString()
    } catch {
      continue
    }

    // Alleen binnen de eigen host blijven: een externe link is niet van deze
    // bron, en hem toch ophalen zou een site raken waar we niets te zoeken hebben.
    if (!absolute.startsWith(new URL(config.baseUrl).origin)) continue
    if (!config.listingUrlPattern.test(absolute)) continue

    found.push(absolute)
  }

  return found
}

/**
 * Eén advertentiepagina → `RawListing`.
 *
 * Geeft `null` wanneer er geen bruikbare gestructureerde data staat. Dat is geen
 * fout: niet elke pagina achter een matchende URL is een advertentie.
 */
export function parseListingPage(
  html: string,
  url: string,
  source: string,
): RawListing | null {
  const nodes = extractJsonLd(html)
  if (nodes.length === 0) return null

  const candidates = selectByType(nodes, ...LISTING_TYPES)
  const node = candidates[0]
  if (!node) return null

  const price =
    pickNumber(node, 'offers', 'price') ??
    pickNumber(node, 'price') ??
    pickNumber(node, 'offers', 'lowPrice')

  const sourceListingId =
    pickString(node, 'sku') ??
    pickString(node, 'identifier') ??
    pickString(node, '@id') ??
    lastPathSegment(url)

  if (!sourceListingId) {
    throw new ParseError('Advertentie zonder herleidbaar bron-id', { url })
  }

  const streetAddress = pickString(node, 'address', 'streetAddress')
  const postalCode = pickString(node, 'address', 'postalCode')
  const city = pickString(node, 'address', 'addressLocality')

  return {
    source,
    sourceListingId,
    url,
    title: pickString(node, 'name'),
    description: pickString(node, 'description'),
    price,
    currency: pickString(node, 'offers', 'priceCurrency') ?? 'EUR',
    listingType: 'sale',
    propertyType: pickString(node, 'additionalType') ?? pickString(node, '@type'),
    address: [streetAddress, [postalCode, city].filter(Boolean).join(' ')]
      .filter((part) => part && part.length > 0)
      .join(', '),
    postalCode,
    city,
    bedrooms: pickNumber(node, 'numberOfBedrooms') ?? pickNumber(node, 'numberOfRooms'),
    surfaceArea: pickNumber(node, 'floorSize', 'value'),
    sellerName: pickString(node, 'offers', 'seller', 'name') ?? pickString(node, 'seller', 'name'),
    sellerPhone:
      pickString(node, 'offers', 'seller', 'telephone') ?? pickString(node, 'telephone'),
    // Bewust geen hint: schema.org kent geen betrouwbaar veld voor "particulier
    // of kantoor". Liever geen signaal dan een verzonnen signaal.
    sellerTypeHint: 'unknown',
    publishedAt: parseDate(pickString(node, 'datePosted') ?? pickString(node, 'datePublished')),
    scrapedAt: new Date(),
    raw: node,
  }
}

function lastPathSegment(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    return segments[segments.length - 1]
  } catch {
    return undefined
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
