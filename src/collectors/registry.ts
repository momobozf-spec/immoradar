import { getEnv } from '@/lib/env'

import { demoMarketCollector } from './demo/demoMarketCollector'
import { fixtureCollector } from './fixture/fixtureCollector'
import type { CollectorDefinition } from './types'

/**
 * Alle collectors die dit systeem kent.
 *
 * ─── TWEE SLOTEN OP ELKE BRON ────────────────────────────────────────────────
 *
 * Een bron draait alleen als hij (1) in de database `enabled` staat én (2) in
 * `COLLECTOR_ENABLED_SOURCES` genoemd wordt. Twee sloten met verschillende
 * sleutelhouders: het dashboard beheert het eerste, de omgeving het tweede.
 * Zo kan niemand per ongeluk — via een migratie, een seed of een verkeerde klik
 * — een bron laten lopen die op deze omgeving niet hoort te lopen.
 *
 * ─── WAAROM HIER GEEN ECHTE BRONNEN STAAN ────────────────────────────────────
 *
 * Alleen bronnen waarvoor geautomatiseerde toegang technisch én contractueel
 * vaststaat horen hierin. Voor deze MVP is dat voor geen enkele Belgische
 * vastgoedsite hier vast te stellen, dus staan er twee lokale bronnen in en een
 * kant-en-klare bouwsteen (`createJsonLdFeedCollector`) voor zodra er wél een
 * goedgekeurde bron is. Zie docs/ADDING-A-SOURCE.md.
 */
const REGISTRY: readonly CollectorDefinition[] = [fixtureCollector, demoMarketCollector]

export function allCollectors(): readonly CollectorDefinition[] {
  return REGISTRY
}

export function findCollector(key: string): CollectorDefinition | null {
  return REGISTRY.find((collector) => collector.source === key) ?? null
}

/**
 * Staat deze bron in de env-allowlist?
 *
 * Een lege allowlist betekent "geen enkele bron", niet "alle bronnen". Dat is de
 * veilige kant op: een vergeten variabele levert dan een stille worker op in
 * plaats van onbedoeld verkeer naar externe sites.
 */
export function isSourceAllowedByEnv(key: string): boolean {
  return getEnv().COLLECTOR_ENABLED_SOURCES.includes(key)
}

/** De collectors die op deze omgeving überhaupt mogen draaien. */
export function allowedCollectors(): CollectorDefinition[] {
  return REGISTRY.filter((collector) => isSourceAllowedByEnv(collector.source))
}
