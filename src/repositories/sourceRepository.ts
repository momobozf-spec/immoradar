import type { CollectorRun, Prisma, Source } from '@/generated/prisma/client'

import { allCollectors } from '@/collectors/registry'
import { getEnv } from '@/lib/env'
import { randomToken } from '@/lib/hash'

import { prisma } from './prisma'

/**
 * Bronnen: registratie, planning en gezondheid.
 *
 * De collectors staan in de code (`src/collectors/registry.ts`), hun instellingen
 * in de database. `syncSources` brengt die twee bij elkaar: nieuwe collectors
 * krijgen een rij met hun standaardinstellingen, bestaande houden wat de
 * beheerder in het dashboard heeft ingesteld.
 *
 * Dat onderscheid is bewust. Zou de code de instellingen elke start
 * overschrijven, dan zou een deploy stilletjes een bron die iemand op pauze
 * zette weer aanzetten.
 */

export async function syncSources(): Promise<void> {
  for (const collector of allCollectors()) {
    await prisma.source.upsert({
      where: { key: collector.source },
      // Alleen velden die uit de code komen bijwerken. Interval, rate limit en
      // de aan/uit-knop blijven van de beheerder.
      update: {
        name: collector.name,
        accessMethod: collector.accessMethod,
        baseUrl: collector.baseUrl,
        accessNotes: collector.accessNotes,
      },
      create: {
        key: collector.source,
        name: collector.name,
        accessMethod: collector.accessMethod,
        baseUrl: collector.baseUrl,
        accessNotes: collector.accessNotes,
        enabled: true,
        pollIntervalSeconds: collector.defaultPollIntervalSeconds,
        rateLimitPerMinute: collector.defaultRateLimitPerMinute,
        timeoutMs: getEnv().COLLECTOR_HTTP_TIMEOUT_MS,
      },
    })
  }
}

export async function listSources(): Promise<Source[]> {
  return prisma.source.findMany({ orderBy: { key: 'asc' } })
}

export async function findSourceByKey(key: string): Promise<Source | null> {
  return prisma.source.findUnique({ where: { key } })
}

/**
 * Claimt de bronnen die aan de beurt zijn.
 *
 * ─── WAAROM EEN LOCK EN GEEN SIMPELE QUERY ───────────────────────────────────
 *
 * Draaien er twee workers (of één worker plus een cron-aanroep), dan zouden
 * beide dezelfde bron oppakken en dezelfde advertenties tegelijk verwerken. Dat
 * levert geen dubbele data op — de unique-indexen vangen dat — maar wel dubbel
 * verkeer naar de bron, en dat is precies wat we een bron niet willen aandoen.
 *
 * De claim is een `lockedUntil` in de toekomst, gezet in een conditionele update.
 * Wint een tweede worker de race niet, dan raakt zijn update nul rijen en slaat
 * hij de bron over.
 */
export async function claimDueSources(
  workerId: string,
  limit: number,
  now: Date = new Date(),
): Promise<Source[]> {
  const enabledByEnv = getEnv().COLLECTOR_ENABLED_SOURCES
  if (enabledByEnv.length === 0) return []

  const candidates = await prisma.source.findMany({
    where: {
      key: { in: enabledByEnv },
      enabled: true,
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
      AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }],
    },
    orderBy: { lastRunAt: { sort: 'asc', nulls: 'first' } },
    take: limit * 2,
  })

  const due = candidates.filter((source) => isDue(source, now)).slice(0, limit)
  const claimed: Source[] = []

  for (const source of due) {
    // De lock loopt ruim langer dan een run mag duren, zodat een gecrashte
    // worker de bron niet voor altijd vasthoudt maar ook niet te vroeg loslaat.
    const lockedUntil = new Date(now.getTime() + Math.max(source.timeoutMs * 4, 120_000))

    const result = await prisma.source.updateMany({
      where: {
        id: source.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { lockedUntil, lockedBy: workerId },
    })

    if (result.count === 1) claimed.push({ ...source, lockedUntil, lockedBy: workerId })
  }

  return claimed
}

function isDue(source: Source, now: Date): boolean {
  if (!source.lastRunAt) return true
  return now.getTime() - source.lastRunAt.getTime() >= source.pollIntervalSeconds * 1000
}

export async function releaseSource(sourceId: string): Promise<void> {
  await prisma.source.update({
    where: { id: sourceId },
    data: { lockedUntil: null, lockedBy: null },
  })
}

export async function startRun(sourceId: string): Promise<CollectorRun> {
  return prisma.collectorRun.create({ data: { sourceId, status: 'RUNNING' } })
}

export interface RunOutcome {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
  itemsFetched: number
  itemsNew: number
  itemsUpdated: number
  itemsUnchanged: number
  itemsRejected: number
  eventsDetected: number
  opportunities: number
  alertsSent: number
  warnings: string[]
  errorKind?: string
  error?: string
}

/**
 * Sluit een run af en werkt de gezondheid van de bron bij.
 *
 * De cooldown na herhaald falen is het failure-isolation-mechanisme: een bron
 * die blijft mislukken zet zichzelf tijdelijk uit in plaats van elke cyclus de
 * worker te bezetten en de logs te vullen.
 */
export async function finishRun(
  runId: string,
  sourceId: string,
  outcome: RunOutcome,
  startedAt: Date,
): Promise<void> {
  const finishedAt = new Date()
  const failed = outcome.status === 'FAILED'

  await prisma.collectorRun.update({
    where: { id: runId },
    data: {
      status: outcome.status,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      itemsFetched: outcome.itemsFetched,
      itemsNew: outcome.itemsNew,
      itemsUpdated: outcome.itemsUpdated,
      itemsUnchanged: outcome.itemsUnchanged,
      itemsRejected: outcome.itemsRejected,
      eventsDetected: outcome.eventsDetected,
      opportunities: outcome.opportunities,
      alertsSent: outcome.alertsSent,
      warnings: outcome.warnings.slice(0, 50),
      errorKind: outcome.errorKind ?? null,
      error: outcome.error?.slice(0, 1000) ?? null,
    },
  })

  const source = await prisma.source.findUnique({ where: { id: sourceId } })
  if (!source) return

  const consecutiveFailures = failed ? source.consecutiveFailures + 1 : 0
  const cooldownMinutes = getEnv().COLLECTOR_COOLDOWN_MINUTES

  const data: Prisma.SourceUpdateInput = {
    lastRunAt: finishedAt,
    consecutiveFailures,
    lockedUntil: null,
    lockedBy: null,
    health: healthFor(outcome, consecutiveFailures),
  }

  if (failed) {
    data.lastFailureAt = finishedAt
    data.lastError = outcome.error?.slice(0, 500) ?? outcome.errorKind ?? 'Onbekende fout'
    // Exponentieel oplopende cooldown, begrensd op een uur. Drie keer mislukken
    // is een storing; twintig keer is een bron die ons niet wil.
    if (consecutiveFailures >= 3) {
      const factor = Math.min(2 ** (consecutiveFailures - 3), 4)
      data.cooldownUntil = new Date(finishedAt.getTime() + cooldownMinutes * 60_000 * factor)
    }
  } else {
    data.lastSuccessAt = finishedAt
    data.lastError = null
    data.cooldownUntil = null
  }

  await prisma.source.update({ where: { id: sourceId }, data })
}

function healthFor(
  outcome: RunOutcome,
  consecutiveFailures: number,
): 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'BLOCKED' {
  if (outcome.errorKind === 'ROBOTS_DISALLOWED' || outcome.errorKind === 'ACCESS_BLOCKED') {
    return 'BLOCKED'
  }
  if (consecutiveFailures >= 3) return 'FAILING'
  if (consecutiveFailures > 0 || outcome.status === 'PARTIAL') return 'DEGRADED'
  return 'HEALTHY'
}

export async function recentRuns(limit = 20): Promise<(CollectorRun & { source: Source })[]> {
  return prisma.collectorRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { source: true },
  })
}

export function newWorkerId(): string {
  return `worker-${randomToken(6)}`
}
