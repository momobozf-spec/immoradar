import { allCollectors, isSourceAllowedByEnv } from '@/collectors/registry'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { requirePlatformAdmin } from '@/lib/session'
import * as sourceRepository from '@/repositories/sourceRepository'

import { Badge, Card, CardHeader, PageHeader, StatTile } from '../../_components/primitives'

export const metadata = { title: 'Bronnen' }

const HEALTH_TONES: Record<string, 'neutral' | 'positive' | 'warning' | 'danger'> = {
  HEALTHY: 'positive',
  DEGRADED: 'warning',
  FAILING: 'danger',
  BLOCKED: 'danger',
  DISABLED: 'neutral',
  UNKNOWN: 'neutral',
}

const RUN_TONES: Record<string, 'neutral' | 'positive' | 'warning' | 'danger'> = {
  SUCCESS: 'positive',
  PARTIAL: 'warning',
  FAILED: 'danger',
  RUNNING: 'neutral',
  SKIPPED: 'neutral',
}

/**
 * Bronbeheer en collectorgezondheid.
 *
 * ─── DE TWEE SLOTEN, ZICHTBAAR GEMAAKT ───────────────────────────────────────
 *
 * Een bron draait alleen als hij én in de database `enabled` staat, én in
 * `COLLECTOR_ENABLED_SOURCES` genoemd wordt. Die tweede is niet vanuit dit
 * scherm te wijzigen, en dat is precies de bedoeling: een bron aanzetten kost
 * twee bewuste handelingen door twee verschillende sleutelhouders. Dit scherm
 * toont beide statussen naast elkaar, zodat "hij staat aan maar draait niet"
 * geen raadsel is.
 *
 * De kolom met de toegangsverantwoording staat er om dezelfde reden: een bron
 * zonder uitleg waarom hij geautomatiseerd benaderd mag worden, hoort niet in
 * productie te staan — en dat moet zichtbaar zijn zonder in de code te kijken.
 */
export default async function SourcesPage() {
  await requirePlatformAdmin()

  const [sources, runs] = await Promise.all([
    sourceRepository.listSources(),
    sourceRepository.recentRuns(25),
  ])

  const definitions = new Map(allCollectors().map((collector) => [collector.source, collector]))

  const healthy = sources.filter((source) => source.health === 'HEALTHY').length
  const enabled = sources.filter((source) => source.enabled).length

  return (
    <>
      <PageHeader
        title="Bronnen"
        description="Waar de marktdata vandaan komt, en of het nog werkt."
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Bronnen" value={sources.length} />
        <StatTile label="Ingeschakeld" value={enabled} />
        <StatTile label="Gezond" value={healthy} />
        <StatTile label="Runs getoond" value={runs.length} />
      </dl>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Geregistreerde bronnen" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs tracking-wide text-ink-600 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Bron</th>
                  <th className="px-4 py-2 font-medium">Toegang</th>
                  <th className="px-4 py-2 font-medium">In database</th>
                  <th className="px-4 py-2 font-medium">In omgeving</th>
                  <th className="px-4 py-2 font-medium">Gezondheid</th>
                  <th className="px-4 py-2 font-medium">Laatste succes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {sources.map((source) => {
                  const allowedByEnv = isSourceAllowedByEnv(source.key)
                  const definition = definitions.get(source.key)

                  return (
                    <tr key={source.id} className="align-top">
                      <td className="px-4 py-2">
                        <p className="font-medium text-ink-900">{source.name}</p>
                        <p className="text-xs text-ink-600">{source.key}</p>
                      </td>
                      <td className="max-w-sm px-4 py-2">
                        <Badge>{source.accessMethod}</Badge>
                        <p className="mt-1 text-xs text-ink-600">
                          {source.accessNotes ?? definition?.accessNotes ?? (
                            <span className="text-danger">Geen verantwoording vastgelegd</span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={source.enabled ? 'positive' : 'neutral'}>
                          {source.enabled ? 'aan' : 'uit'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={allowedByEnv ? 'positive' : 'neutral'}>
                          {allowedByEnv ? 'toegestaan' : 'niet toegestaan'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={HEALTH_TONES[source.health] ?? 'neutral'}>
                          {source.health}
                        </Badge>
                        {source.consecutiveFailures > 0 && (
                          <p className="mt-1 text-xs text-danger">
                            {source.consecutiveFailures} opeenvolgende fouten
                          </p>
                        )}
                        {source.lastError && (
                          <p className="mt-1 max-w-xs truncate text-xs text-ink-600">
                            {source.lastError}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink-700">
                        {source.lastSuccessAt ? formatRelative(source.lastSuccessAt) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recente runs" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs tracking-wide text-ink-600 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Gestart</th>
                  <th className="px-4 py-2 font-medium">Bron</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Opgehaald</th>
                  <th className="px-4 py-2 text-right font-medium">Nieuw</th>
                  <th className="px-4 py-2 text-right font-medium">Events</th>
                  <th className="px-4 py-2 text-right font-medium">Kansen</th>
                  <th className="px-4 py-2 text-right font-medium">Duur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-2 text-ink-700">{formatDateTime(run.startedAt)}</td>
                    <td className="px-4 py-2 text-ink-800">{run.source.name}</td>
                    <td className="px-4 py-2">
                      <Badge tone={RUN_TONES[run.status] ?? 'neutral'}>{run.status}</Badge>
                    </td>
                    <td className="tnum px-4 py-2 text-right">{run.itemsFetched}</td>
                    <td className="tnum px-4 py-2 text-right">{run.itemsNew}</td>
                    <td className="tnum px-4 py-2 text-right">{run.eventsDetected}</td>
                    <td className="tnum px-4 py-2 text-right">{run.opportunities}</td>
                    <td className="tnum px-4 py-2 text-right text-ink-600">
                      {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}
