import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { RawListing } from '@/domain/types'
import { safeJsonParse } from '@/lib/json'

import type { CollectorContext, CollectorDefinition, CollectorResult } from '../types'

/**
 * De fixture-collector: leest advertenties uit een JSON-bestand op schijf.
 *
 * ─── WAAROM DIT DE STANDAARDBRON IS ──────────────────────────────────────────
 *
 * Het systeem moet volledig te demonstreren zijn zonder ook maar één externe
 * site aan te raken. Deze collector maakt dat waar: hij is deterministisch,
 * hij heeft geen netwerk nodig, en hij levert precies de scenario's waarop de
 * pijplijn getest hoort te worden (particulier, professioneel, twijfelgeval,
 * dubbele advertentie voor hetzelfde pand).
 *
 * Hij is óók het referentievoorbeeld voor een echte bron: de vorm van wat je
 * teruggeeft is identiek, alleen de herkomst verschilt.
 */
const FIXTURE_PATH = path.resolve(process.cwd(), 'fixtures', 'listings.json')

/** Wat er in het JSON-bestand staat: een RawListing zonder `source`/`scrapedAt`. */
type FixtureEntry = Omit<RawListing, 'source' | 'scrapedAt' | 'publishedAt'> & {
  publishedAt?: string
}

export const fixtureCollector: CollectorDefinition = {
  source: 'fixture-be',
  name: 'Fixture (lokaal bestand)',
  accessMethod: 'FIXTURE',
  baseUrl: null,
  defaultPollIntervalSeconds: 300,
  defaultRateLimitPerMinute: 60,
  accessNotes:
    'Leest fixtures/listings.json van de lokale schijf. Raakt geen enkele externe dienst en heeft daarom geen toestemming nodig.',
  requiresBrowser: false,

  async collect(context: CollectorContext): Promise<CollectorResult> {
    const warnings: string[] = []

    let content: string
    try {
      content = await readFile(FIXTURE_PATH, 'utf8')
    } catch {
      // Geen fixtures is geen crash: de bron rapporteert dat hij niets heeft.
      return {
        listings: [],
        warnings: [`Fixturebestand niet gevonden op ${FIXTURE_PATH}`],
      }
    }

    const parsed = safeJsonParse<FixtureEntry[]>(content)
    if (!Array.isArray(parsed)) {
      return { listings: [], warnings: ['Fixturebestand bevat geen JSON-array'] }
    }

    const scrapedAt = new Date()
    const listings: RawListing[] = []

    for (const entry of parsed.slice(0, context.maxItems)) {
      if (!entry.sourceListingId || !entry.url) {
        warnings.push('Fixture-item zonder sourceListingId of url overgeslagen')
        continue
      }

      listings.push({
        ...entry,
        source: fixtureCollector.source,
        scrapedAt,
        publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : undefined,
        raw: entry,
      })
    }

    if (parsed.length > context.maxItems) {
      warnings.push(
        `Fixturebestand bevat ${parsed.length} items; afgekapt op ${context.maxItems}.`,
      )
    }

    context.logger.debug('Fixtures gelezen', { count: listings.length })
    return { listings, warnings }
  },
}
