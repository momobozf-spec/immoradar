import 'dotenv/config'

import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/repositories/prisma'
import { dispatchDigests, dispatchRealtimeAlerts } from '@/services/alertService'
import { runLeadReviveForAllAgencies } from '@/services/leadReviveService'
import { expireOpportunities } from '@/services/maintenanceService'
import { runDueSources } from '@/services/pipelineService'

/**
 * De pijplijn één keer draaien, vanaf de commandoregel.
 *
 * ─── WAAROM DIT NAAST DE WORKER BESTAAT ──────────────────────────────────────
 *
 * `npm run worker` draait eeuwig en is bedoeld voor productie. Voor een demo,
 * een test of een externe scheduler (cron, Render Job, GitHub Action) wil je
 * juist het tegenovergestelde: één ronde, een leesbare samenvatting, en dan een
 * exitcode waar een scheduler iets mee kan.
 *
 *   npm run pipeline              collectors + kansen + realtime meldingen
 *   npm run pipeline -- --all     idem, plus LeadRevive, digests en opruiming
 *   npm run pipeline -- --revive  alleen LeadRevive
 *
 * De exitcode is 1 zodra één bron faalde. Zonder dat zou een cronjob die elke
 * vijf minuten stukloopt er in de scheduler nog steeds groen uitzien.
 */

const logger = createLogger({ component: 'cli' })

interface Options {
  all: boolean
  reviveOnly: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const flags = new Set(argv.slice(2))
  return {
    all: flags.has('--all'),
    reviveOnly: flags.has('--revive'),
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv)
  const env = getEnv()
  const now = new Date()

  let failed = 0

  if (!options.reviveOnly) {
    if (env.COLLECTOR_ENABLED_SOURCES.length === 0) {
      logger.warn(
        'COLLECTOR_ENABLED_SOURCES is leeg — er draait geen enkele bron. Zet bijvoorbeeld "fixture-be,demo-be" in .env.',
      )
    }

    const results = await runDueSources(now)

    if (results.length === 0) {
      console.log('Geen bronnen aan de beurt. Alle intervallen zijn nog niet verstreken.')
    }

    for (const result of results) {
      if (result.status === 'FAILED') failed += 1

      console.log(
        [
          `${result.sourceKey.padEnd(12)} ${result.status.padEnd(8)}`,
          `opgehaald ${result.fetched}`,
          `nieuw ${result.created}`,
          `gewijzigd ${result.updated}`,
          `events ${result.events}`,
          `kansen ${result.opportunities}`,
          `meldingen ${result.alertsSent}`,
        ].join('  '),
      )

      for (const warning of result.warnings.slice(0, 5)) {
        console.log(`  ⚠ ${warning}`)
      }
      if (result.error) console.log(`  ✖ ${result.error}`)
    }
  }

  if (options.all || options.reviveOnly) {
    const revive = await runLeadReviveForAllAgencies(now)
    const created = revive.reduce((sum, entry) => sum + entry.opportunitiesCreated, 0)
    const assessed = revive.reduce((sum, entry) => sum + entry.contactsAssessed, 0)
    console.log(`leadrevive   beoordeeld ${assessed}  kansen ${created}`)
  }

  if (options.all) {
    // Realtime meldingen draaien al mee in de pijplijn; hier gaat het om de
    // digests en het opruimen van verlopen kansen.
    const alerts = await dispatchRealtimeAlerts(now)
    const digests = await dispatchDigests(now)
    const expired = await expireOpportunities(now)

    console.log(
      `meldingen    verstuurd ${alerts.sent + digests.sent}  onderdrukt ${alerts.suppressed + digests.suppressed}  mislukt ${alerts.failed + digests.failed}`,
    )
    console.log(`opruiming    verlopen kansen ${expired}`)
  }

  await prisma.$disconnect()

  if (failed > 0) {
    console.error(`\n${failed} bron(nen) mislukt.`)
    process.exitCode = 1
  }
}

main().catch(async (error: unknown) => {
  logger.error('Pijplijn mislukt', {
    error: error instanceof Error ? error.message : String(error),
  })
  await prisma.$disconnect()
  process.exitCode = 1
})
