import { NextResponse, type NextRequest } from 'next/server'

import { getEnv } from '@/lib/env'
import { safeEquals } from '@/lib/hash'
import { createLogger } from '@/lib/logger'
import { dispatchDigests, dispatchRealtimeAlerts } from '@/services/alertService'
import { runLeadReviveForAllAgencies } from '@/services/leadReviveService'
import { expireOpportunities, runRetention } from '@/services/maintenanceService'
import { runDueSources } from '@/services/pipelineService'
import { recordAudit } from '@/services/auditService'

/**
 * De cron-ingang. Eén route, één taak per aanroep.
 *
 * ─── DE BEVEILIGING ──────────────────────────────────────────────────────────
 *
 * Zonder `CRON_SECRET` staan deze routes uit. Niet "open voor iedereen" maar
 * uit — dat is het verschil tussen een vergeten variabele en een publiek
 * eindpunt waarmee iedereen de pijplijn kan laten draaien of alerts kan
 * uitlokken.
 *
 * De vergelijking gebruikt `safeEquals`, dus constante tijd. Een gewone `===`
 * op een geheim lekt via de looptijd hoeveel tekens klopten.
 *
 * ─── WAAROM POST EN GEEN GET ─────────────────────────────────────────────────
 *
 * Deze routes veranderen data en versturen berichten. Een GET is voor
 * browsers, crawlers en preview-mechanismen aanleiding om hem "even op te
 * halen" — en dan draait de pijplijn omdat iemand een link in een chat plakte.
 */

const logger = createLogger({ component: 'cron' })

const JOBS = ['collect', 'leadrevive', 'alerts', 'digest', 'maintenance'] as const
type Job = (typeof JOBS)[number]

function isJob(value: string): value is Job {
  return (JOBS as readonly string[]).includes(value)
}

/**
 * Haalt het geheim uit de header of de querystring.
 *
 * De header heeft de voorkeur; de querystring staat er omdat sommige
 * cron-diensten geen headers kunnen meesturen. Dat is een bewuste concessie met
 * een prijs — een URL belandt in logbestanden — en daarom staat de header
 * vooraan in de documentatie.
 */
function providedSecret(request: NextRequest): string {
  const header = request.headers.get('authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7)

  const headerSecret = request.headers.get('x-cron-secret')
  if (headerSecret) return headerSecret

  return request.nextUrl.searchParams.get('secret') ?? ''
}

async function runJob(job: Job): Promise<Record<string, unknown>> {
  switch (job) {
    case 'collect': {
      const result = await runDueSources()
      return { ...result }
    }

    case 'leadrevive': {
      const results = await runLeadReviveForAllAgencies()
      return {
        agencies: results.length,
        assessed: results.reduce((sum, entry) => sum + entry.contactsAssessed, 0),
        created: results.reduce((sum, entry) => sum + entry.opportunitiesCreated, 0),
      }
    }

    case 'alerts': {
      const result = await dispatchRealtimeAlerts()
      return { ...result }
    }

    case 'digest': {
      const result = await dispatchDigests()
      return { ...result }
    }

    case 'maintenance': {
      const [retention, expired] = await Promise.all([runRetention(), expireOpportunities()])
      return { retention, expired }
    }
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  const env = getEnv()
  const { job } = await context.params

  if (env.CRON_SECRET.length === 0) {
    logger.warn('Cron-route aangeroepen terwijl CRON_SECRET niet is ingesteld', { job })
    return NextResponse.json({ error: 'Cron staat uit' }, { status: 503 })
  }

  if (!safeEquals(providedSecret(request), env.CRON_SECRET)) {
    // Geen detail in het antwoord: wie het geheim niet heeft, hoort ook niet te
    // weten of de taaknaam bestaat.
    logger.warn('Cron-aanroep met onjuist geheim', { job })
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  }

  if (!isJob(job)) {
    return NextResponse.json({ error: 'Onbekende taak' }, { status: 404 })
  }

  const startedAt = Date.now()

  try {
    const result = await runJob(job)
    const durationMs = Date.now() - startedAt

    logger.info('Cron-taak afgerond', { job, durationMs, ...result })
    await recordAudit({ actor: 'cron', action: `cron.${job}`, metadata: { durationMs, ...result } })

    return NextResponse.json({ job, durationMs, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Cron-taak mislukt', { job, error: message })

    return NextResponse.json({ job, error: message }, { status: 500 })
  }
}
