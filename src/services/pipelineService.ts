import type { Source } from '@/generated/prisma/client'

import { HttpClient } from '@/collectors/base/httpClient'
import { findCollector, isSourceAllowedByEnv } from '@/collectors/registry'
import type { CollectorContext } from '@/collectors/types'
import { errorKindOf, messageOf } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { ingestListings } from '@/ingestion/ingestListings'
import * as sourceRepository from '@/repositories/sourceRepository'
import type { RunOutcome } from '@/repositories/sourceRepository'

import { dispatchRealtimeAlerts } from './alertService'
import { createOpportunitiesForEvents } from './opportunityService'

/**
 * Eén bron, van ophalen tot melding.
 *
 * ─── DE KETEN ────────────────────────────────────────────────────────────────
 *
 *   collect → ingest → events → opportunities → alerts
 *
 * Elke schakel kan leeg zijn zonder de volgende te breken: een run zonder
 * nieuwe advertenties levert geen events, dus geen kansen, dus geen meldingen.
 * Dat is de normale gang van zaken bij een bron die elke vijf minuten draait.
 *
 * ─── WAAROM DE RUN ALTIJD WORDT AFGESLOTEN ───────────────────────────────────
 *
 * Wat er ook misgaat, `finishRun` draait in het `finally`. Zonder dat blijft een
 * gecrashte run eeuwig op RUNNING staan, houdt de bron zijn lock, en ziet het
 * dashboard een systeem dat werkt terwijl er niets gebeurt. Een zichtbare
 * mislukking is oneindig veel beter dan een onzichtbare.
 */

const logger = createLogger({ component: 'pipeline' })

export interface PipelineResult {
  sourceKey: string
  status: RunOutcome['status']
  fetched: number
  created: number
  updated: number
  events: number
  opportunities: number
  alertsSent: number
  warnings: string[]
  error?: string
}

export async function runSource(source: Source, now: Date = new Date()): Promise<PipelineResult> {
  const env = getEnv()
  const log = logger.child({ source: source.key })

  const result: PipelineResult = {
    sourceKey: source.key,
    status: 'SKIPPED',
    fetched: 0,
    created: 0,
    updated: 0,
    events: 0,
    opportunities: 0,
    alertsSent: 0,
    warnings: [],
  }

  // Twee sloten: de database zegt `enabled`, de omgeving moet het ook toestaan.
  if (!isSourceAllowedByEnv(source.key)) {
    result.warnings.push('Bron staat niet in COLLECTOR_ENABLED_SOURCES')
    return result
  }

  const collector = findCollector(source.key)
  if (!collector) {
    result.status = 'FAILED'
    result.error = `Geen collector geregistreerd voor "${source.key}"`
    return result
  }

  const run = await sourceRepository.startRun(source.id)
  const startedAt = new Date()

  // Harde bovengrens op de looptijd van één bron. Zonder deze kan een trage bron
  // de hele worker vasthouden en komen de andere bronnen nooit aan de beurt.
  const controller = new AbortController()
  const deadline = setTimeout(
    () => controller.abort(),
    Math.max(source.timeoutMs * 10, 60_000),
  )

  const outcome: RunOutcome = {
    status: 'SUCCESS',
    itemsFetched: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsRejected: 0,
    eventsDetected: 0,
    opportunities: 0,
    alertsSent: 0,
    warnings: [],
  }

  try {
    const http = new HttpClient({
      userAgent: env.COLLECTOR_USER_AGENT,
      maxRequestsPerMinute: Math.min(
        source.rateLimitPerMinute,
        env.COLLECTOR_MAX_REQUESTS_PER_MINUTE,
      ),
      timeoutMs: source.timeoutMs,
      maxRetries: source.maxRetries,
      logger: log,
    })

    const context: CollectorContext = {
      http,
      logger: log,
      lastSuccessAt: source.lastSuccessAt,
      maxItems: env.COLLECTOR_MAX_ITEMS_PER_RUN,
      signal: controller.signal,
    }

    // 1. Ophalen.
    const collected = await collector.collect(context)
    outcome.itemsFetched = collected.listings.length
    outcome.warnings.push(...collected.warnings)
    result.fetched = collected.listings.length

    // 2. Opnemen: normaliseren, matchen, opslaan, events afleiden.
    const ingestion = await ingestListings(source, collected.listings, now)

    outcome.itemsNew = ingestion.created
    outcome.itemsUpdated = ingestion.updated
    outcome.itemsUnchanged = ingestion.unchanged
    outcome.itemsRejected = ingestion.rejected
    outcome.eventsDetected = ingestion.events.length
    outcome.warnings.push(...ingestion.warnings)

    result.created = ingestion.created
    result.updated = ingestion.updated
    result.events = ingestion.events.length

    // 3. Kansen afleiden voor de kantoren die hier werken.
    const opportunities = await createOpportunitiesForEvents(ingestion.events, now)
    outcome.opportunities = opportunities.created
    result.opportunities = opportunities.created

    // 4. Melden. Alleen als er iets te melden valt — anders draaien we de
    //    alertquery's voor niets bij elke run van elke bron.
    if (opportunities.created > 0) {
      const alerts = await dispatchRealtimeAlerts(now)
      outcome.alertsSent = alerts.sent
      result.alertsSent = alerts.sent
    }

    outcome.status = outcome.warnings.length > 0 || ingestion.rejected > 0 ? 'PARTIAL' : 'SUCCESS'
    result.status = outcome.status
    result.warnings = outcome.warnings

    log.info('Bron verwerkt', {
      fetched: result.fetched,
      created: result.created,
      updated: result.updated,
      events: result.events,
      opportunities: result.opportunities,
      alertsSent: result.alertsSent,
    })
  } catch (error) {
    outcome.status = 'FAILED'
    outcome.errorKind = errorKindOf(error)
    outcome.error = messageOf(error)

    result.status = 'FAILED'
    result.error = outcome.error

    log.error('Bron mislukt', { errorKind: outcome.errorKind, error: outcome.error })
  } finally {
    clearTimeout(deadline)
    await sourceRepository.finishRun(run.id, source.id, outcome, startedAt)
  }

  return result
}

/** Alle bronnen die aan de beurt zijn, met een begrensd aantal tegelijk. */
export async function runDueSources(now: Date = new Date()): Promise<PipelineResult[]> {
  const env = getEnv()
  const workerId = sourceRepository.newWorkerId()

  await sourceRepository.syncSources()

  const sources = await sourceRepository.claimDueSources(
    workerId,
    env.COLLECTOR_CONCURRENCY,
    now,
  )

  if (sources.length === 0) return []

  // Bewust sequentieel. De collectors delen een rate limiter per host, en het
  // werk zit in de database, niet in het netwerk; parallel draaien zou vooral
  // meer gelijktijdige transacties opleveren zonder de run sneller te maken.
  const results: PipelineResult[] = []
  for (const source of sources) {
    try {
      results.push(await runSource(source, now))
    } finally {
      await sourceRepository.releaseSource(source.id)
    }
  }

  return results
}
