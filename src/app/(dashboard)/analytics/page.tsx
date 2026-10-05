import { requireAgencyScope } from '@/lib/session'
import { agencyAnalytics } from '@/services/analyticsService'

import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  formatPercent,
} from '../../_components/primitives'

export const metadata = { title: 'Analyse' }

/**
 * De cijfers voor de kantoorleiding.
 *
 * De belangrijkste zin op deze pagina staat onderaan: dit zijn registraties uit
 * de opvolging, geen bewijs dat ImmoRadar die mandaten heeft opgeleverd. Zonder
 * die zin is elk getal hierboven een claim die we niet kunnen dragen.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const days = Number(typeof params.days === 'string' ? params.days : '90') || 90
  const analytics = await agencyAnalytics(scope.agencyId, days)

  const maxFunnel = Math.max(...analytics.funnel.map((stage) => stage.count), 1)

  return (
    <>
      <PageHeader
        title="Analyse"
        description={`Wat er de laatste ${days} dagen in de opvolging is vastgelegd.`}
      />

      {analytics.totals.detected === 0 ? (
        <EmptyState
          title="Nog geen cijfers"
          description="Er zijn in deze periode geen kansen aangemaakt, dus valt er niets te vergelijken."
        />
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Gedetecteerd" value={analytics.totals.detected} />
            <StatTile label="Gecontacteerd" value={analytics.totals.contacted} />
            <StatTile label="Schattingen gepland" value={analytics.totals.valuations} />
            <StatTile
              label="Mandaten gewonnen"
              value={analytics.totals.mandatesWon}
              hint={`${formatPercent(analytics.totals.conversionRate, 0)} van de afgeronde kansen`}
            />
          </dl>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Trechter"
                description="Van gedetecteerd tot gewonnen mandaat"
              />
              <div className="space-y-3 p-5">
                {analytics.funnel.map((stage) => (
                  <div key={stage.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-ink-700">{stage.label}</span>
                      <span className="tnum font-medium text-ink-900">{stage.count}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-200">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${(stage.count / maxFunnel) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Per soort signaal"
                description="Welk type kans wordt daadwerkelijk opgevolgd"
              />
              <table className="w-full text-sm">
                <thead className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-600 uppercase">
                  <tr>
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Totaal</th>
                    <th className="px-3 py-2 text-right font-medium">Gebeld</th>
                    <th className="px-5 py-2 text-right font-medium">Gewonnen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200">
                  {analytics.byType.map((row) => (
                    <tr key={row.type}>
                      <td className="px-5 py-2 text-ink-800">{row.label}</td>
                      <td className="tnum px-3 py-2 text-right text-ink-900">{row.total}</td>
                      <td className="tnum px-3 py-2 text-right text-ink-700">{row.contacted}</td>
                      <td className="tnum px-5 py-2 text-right text-ink-900">{row.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Per medewerker" description="Toegewezen, gebeld, gewonnen" />
              {analytics.byAgent.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-600">
                  Nog geen kansen toegewezen in deze periode.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-600 uppercase">
                    <tr>
                      <th className="px-5 py-2 font-medium">Medewerker</th>
                      <th className="px-3 py-2 text-right font-medium">Toegewezen</th>
                      <th className="px-3 py-2 text-right font-medium">Gebeld</th>
                      <th className="px-5 py-2 text-right font-medium">Gewonnen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-200">
                    {analytics.byAgent.map((row) => (
                      <tr key={row.userId}>
                        <td className="px-5 py-2 text-ink-800">{row.name}</td>
                        <td className="tnum px-3 py-2 text-right text-ink-900">{row.assigned}</td>
                        <td className="tnum px-3 py-2 text-right text-ink-700">{row.contacted}</td>
                        <td className="tnum px-5 py-2 text-right text-ink-900">{row.won}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {analytics.totals.mandatesWon > 0 && (
            <p className="mt-6 text-sm text-ink-700">
              Van de gewonnen mandaten had{' '}
              <strong>{formatPercent(analytics.totals.crossShareOfWins, 0)}</strong> een bestaande
              CRM-relatie.
            </p>
          )}
        </>
      )}

      <p className="mt-8 border-t border-ink-200 pt-4 text-xs text-ink-600">
        Deze cijfers tellen wat in de opvolging is geregistreerd. Ze zeggen niet dat ImmoRadar
        deze mandaten heeft opgeleverd — dat verband is met deze gegevens niet vast te stellen.
      </p>
    </>
  )
}
