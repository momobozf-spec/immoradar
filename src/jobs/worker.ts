import 'dotenv/config'

import { assertProductionSecrets, getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/repositories/prisma'
import { dispatchDigests } from '@/services/alertService'
import { runLeadReviveForAllAgencies } from '@/services/leadReviveService'
import { runDueSources } from '@/services/pipelineService'
import { expireOpportunities, runRetention } from '@/services/maintenanceService'

/**
 * De achtergrondworker.
 *
 * ─── DRIE RITMES IN ÉÉN LUS ──────────────────────────────────────────────────
 *
 *   elke tick    bronnen die aan de beurt zijn        (seconden tot minuten)
 *   elk uur      digests, LeadRevive, verlopen kansen (het klantenbestand
 *                                                      verandert niet per minuut)
 *   elke dag     bewaartermijnen opruimen
 *
 * Eén proces met drie tellers in plaats van drie cronjobs: dat scheelt drie
 * deploytargets en maakt `npm run worker` genoeg om het hele systeem te zien
 * draaien. Wie liever externe cron gebruikt kan de HTTP-routes onder
 * /api/cron/* aanroepen; die doen precies hetzelfde werk.
 *
 * ─── WAAROM DE LUS NOOIT OMVALT ──────────────────────────────────────────────
 *
 * Elke tick zit in een try/catch. Een bron die faalt, een database die even weg
 * is, een fout in de scoring — het mag de worker niet stoppen, want dan staat
 * het systeem stil tot iemand het merkt.
 */

const logger = createLogger({ component: 'worker' })

const TICK_MS = 15_000
const HOURLY_MS = 60 * 60 * 1000
const DAILY_MS = 24 * HOURLY_MS

let stopping = false

async function tick(): Promise<void> {
  const results = await runDueSources()

  if (results.length > 0) {
    logger.info('Bronnen verwerkt', {
      sources: results.length,
      opportunities: results.reduce((sum, result) => sum + result.opportunities, 0),
      alertsSent: results.reduce((sum, result) => sum + result.alertsSent, 0),
    })
  }
}

async function hourly(): Promise<void> {
  const digests = await dispatchDigests()
  const revive = await runLeadReviveForAllAgencies()
  const expired = await expireOpportunities()

  logger.info('Uurtaken afgerond', {
    digestsSent: digests.sent,
    reviveOpportunities: revive.reduce((sum, result) => sum + result.opportunitiesCreated, 0),
    expiredOpportunities: expired,
  })
}

async function daily(): Promise<void> {
  const retention = await runRetention()
  logger.info('Dagelijks onderhoud afgerond', { ...retention })
}

async function main(): Promise<void> {
  const env = getEnv()
  assertProductionSecrets(env)

  logger.info('Worker gestart', {
    tickMs: TICK_MS,
    sources: env.COLLECTOR_ENABLED_SOURCES,
    concurrency: env.COLLECTOR_CONCURRENCY,
  })

  if (env.COLLECTOR_ENABLED_SOURCES.length === 0) {
    logger.warn(
      'COLLECTOR_ENABLED_SOURCES is leeg — er draait geen marktbron. Voor een LeadRevive-pilot is dat de bedoeling; lokaal: "fixture-be,demo-be".',
    )
  }

  let lastHourly = 0
  let lastDaily = 0

  while (!stopping) {
    const startedAt = Date.now()

    try {
      await tick()

      if (startedAt - lastHourly >= HOURLY_MS) {
        lastHourly = startedAt
        await hourly()
      }

      if (startedAt - lastDaily >= DAILY_MS) {
        lastDaily = startedAt
        await daily()
      }
    } catch (error) {
      // Doorgaan is hier het juiste gedrag: de volgende tick probeert het
      // opnieuw, en tot die tijd staat er een logregel met de oorzaak.
      logger.error('Tick mislukt', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const elapsed = Date.now() - startedAt
    await sleep(Math.max(1_000, TICK_MS - elapsed))
  }

  await prisma.$disconnect()
  logger.info('Worker gestopt')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(0)
    logger.info('Afsluiten aangevraagd, huidige tick wordt afgemaakt')
    stopping = true
  })
}

main().catch((error: unknown) => {
  logger.error('Worker kon niet starten', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
