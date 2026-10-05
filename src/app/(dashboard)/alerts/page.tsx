import { getEnv } from '@/lib/env'
import { formatDateTime } from '@/lib/dates'
import { requireAgencyAdminPage } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as alertRepository from '@/repositories/alertRepository'

import { Badge, Card, CardHeader, PageHeader } from '../../_components/primitives'
import { AlertRuleForm, DeleteRuleButton } from './AlertForms'

export const metadata = { title: 'Meldingen' }

const STATUS_TONES: Record<string, 'neutral' | 'positive' | 'danger' | 'warning'> = {
  SENT: 'positive',
  FAILED: 'danger',
  PENDING: 'warning',
  SUPPRESSED_DRY_RUN: 'neutral',
}

/**
 * Telegram-meldingen: wanneer, waarvoor en aan wie.
 *
 * ─── DE DROOGLOOPMELDING BOVENAAN ────────────────────────────────────────────
 *
 * Zonder `TELEGRAM_BOT_TOKEN` worden alerts wél aangemaakt en bewaard, maar niet
 * verstuurd (`SUPPRESSED_DRY_RUN`). Dat is precies wat je wilt bij een demo of
 * een testomgeving — maar alleen als het zichtbaar is. Een kantoor dat denkt dat
 * de meldingen aanstaan terwijl er niets vertrekt, mist zijn beste leads en
 * ontdekt het pas na weken.
 */
export default async function AlertsPage() {
  const scope = await requireAgencyAdminPage()

  const [rules, alerts, agency] = await Promise.all([
    agencyRepository.listAlertRules(scope.agencyId),
    alertRepository.listAlerts(scope.agencyId, 30),
    agencyRepository.findAgency(scope.agencyId),
  ])

  const telegramConfigured = getEnv().TELEGRAM_BOT_TOKEN.length > 0

  return (
    <>
      <PageHeader
        title="Meldingen"
        description="Wanneer stuurt ImmoRadar een bericht, en waarover."
      />

      {!telegramConfigured && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink-900">
          <strong>Telegram staat uit.</strong> Meldingen worden wel aangemaakt en hieronder
          bewaard, maar niet verstuurd. Zet <code>TELEGRAM_BOT_TOKEN</code> in de omgeving om ze
          echt te laten vertrekken.
        </div>
      )}

      {!agency?.telegramChatId && (
        <div className="mb-6 rounded-lg border border-ink-300 bg-white px-4 py-3 text-sm text-ink-700">
          Dit kantoor heeft nog geen standaard-chat ingesteld. Vul er een in bij{' '}
          <a href="/settings" className="font-medium text-brand-700 hover:underline">
            Instellingen
          </a>
          , of geef per regel een eigen chat op.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={`Regels (${rules.length})`} />
            {rules.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-600">
                Nog geen regels. Zonder regel worden er geen meldingen verstuurd.
              </p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">{rule.name}</p>
                        <Badge tone={rule.kind === 'REALTIME' ? 'brand' : 'neutral'}>
                          {rule.kind === 'REALTIME' ? 'Direct' : `Digest ${rule.digestHour}:00`}
                        </Badge>
                        {!rule.enabled && <Badge tone="danger">uit</Badge>}
                        {rule.requireCrmMatch && <Badge tone="brand">alleen bekende relaties</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-ink-600">
                        Vanaf score {rule.minScore}
                        {rule.types.length > 0 && ` · ${rule.types.length} type(s)`}
                        {rule.quietHoursStart != null &&
                          rule.quietHoursEnd != null &&
                          ` · stil van ${rule.quietHoursStart}:00 tot ${rule.quietHoursEnd}:00`}
                        {rule.lastFiredAt && ` · laatst ${formatDateTime(rule.lastFiredAt)}`}
                      </p>
                    </div>
                    <DeleteRuleButton ruleId={rule.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Verstuurd" description="De laatste 30 meldingen" />
            {alerts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-600">Nog niets verstuurd.</p>
            ) : (
              <ul className="divide-y divide-ink-200 text-sm">
                {alerts.map((alert) => (
                  <li key={alert.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-ink-800">
                        {alert.opportunity
                          ? (alert.opportunity.property?.city ?? 'Kans')
                          : 'Ochtendbriefing'}
                      </p>
                      <p className="text-xs text-ink-600">{formatDateTime(alert.createdAt)}</p>
                    </div>
                    <Badge tone={STATUS_TONES[alert.status] ?? 'neutral'}>
                      {alert.status === 'SUPPRESSED_DRY_RUN' ? 'niet verstuurd' : alert.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <AlertRuleForm />
        </div>
      </div>
    </>
  )
}
