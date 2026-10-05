import { headers } from 'next/headers'

import { forwardedChain, pickClientIp } from '@/lib/clientIp'
import { getEnv, isSessionSecretConfigured } from '@/lib/env'
import { formatDateTime } from '@/lib/dates'
import { requirePlatformAdmin } from '@/lib/session'
import { prisma } from '@/repositories/prisma'
import { recentAudit } from '@/services/auditService'

import { Badge, Card, CardHeader, PageHeader, StatTile } from '../../_components/primitives'

export const metadata = { title: 'Systeem' }

/**
 * Systeemgezondheid: staat alles aan wat aan hoort te staan?
 *
 * ─── WAAROM DE CONTROLES HIER GEEN WAARDEN TONEN ─────────────────────────────
 *
 * Er staat "ingesteld" of "ontbreekt", nooit het geheim zelf. Een beheerscherm
 * dat tokens toont, is een tweede plek waar ze kunnen weglekken — via een
 * screenshot, een scherm dat meekijkt, of een browserextensie. Of iets is
 * ingesteld, is alles wat een beheerder hoeft te weten.
 */
export default async function HealthPage() {
  await requirePlatformAdmin()

  const env = getEnv()

  const [counts, latestRun, latestOpportunity, latestAlert, audit] = await Promise.all([
    Promise.all([
      prisma.property.count(),
      prisma.listing.count(),
      prisma.listingSnapshot.count(),
      prisma.listingEvent.count(),
      prisma.opportunity.count(),
      prisma.crmContact.count(),
    ]),
    prisma.collectorRun.findFirst({ orderBy: { startedAt: 'desc' }, include: { source: true } }),
    prisma.opportunity.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.alert.findFirst({ orderBy: { createdAt: 'desc' } }),
    recentAudit(null, 25),
  ])

  const [properties, listings, snapshots, events, opportunities, contacts] = counts

  // Proxy-diagnose: alleen het eigen verzoek van de beheerder.
  const forwardedFor = (await headers()).get('x-forwarded-for')
  const chain = forwardedChain(forwardedFor)
  const pickedIp = pickClientIp(forwardedFor, env.TRUSTED_PROXY_HOPS)

  const checks = [
    {
      label: 'Sessiegeheim',
      ok: isSessionSecretConfigured(env),
      detail: isSessionSecretConfigured(env)
        ? 'Ingesteld'
        : 'Ontbreekt — er wordt een vast ontwikkelgeheim gebruikt. Niet geschikt voor productie.',
    },
    {
      label: 'Telegram',
      ok: env.TELEGRAM_BOT_TOKEN.length > 0,
      detail:
        env.TELEGRAM_BOT_TOKEN.length > 0
          ? 'Ingesteld — meldingen worden verstuurd'
          : 'Niet ingesteld — meldingen worden aangemaakt maar niet verstuurd',
    },
    {
      label: 'Cron-geheim',
      ok: env.CRON_SECRET.length > 0,
      detail:
        env.CRON_SECRET.length > 0
          ? 'Ingesteld — de cron-routes zijn bereikbaar'
          : 'Niet ingesteld — de cron-routes staan uit',
    },
    {
      label: 'Toegestane bronnen',
      ok: env.COLLECTOR_ENABLED_SOURCES.length > 0,
      detail:
        env.COLLECTOR_ENABLED_SOURCES.length > 0
          ? env.COLLECTOR_ENABLED_SOURCES.join(', ')
          : 'Leeg — geen enkele bron draait',
    },
  ]

  return (
    <>
      <PageHeader title="Systeem" description="Wat draait er, en wat staat er klaar." />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Panden" value={properties} />
        <StatTile label="Advertenties" value={listings} />
        <StatTile label="Snapshots" value={snapshots} />
        <StatTile label="Gebeurtenissen" value={events} />
        <StatTile label="Kansen" value={opportunities} />
        <StatTile label="CRM-contacten" value={contacts} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Configuratie" />
          <ul className="divide-y divide-ink-200">
            {checks.map((check) => (
              <li key={check.label} className="flex items-start justify-between gap-4 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{check.label}</p>
                  <p className="text-xs text-ink-600">{check.detail}</p>
                </div>
                <Badge tone={check.ok ? 'positive' : 'warning'}>{check.ok ? 'ok' : 'let op'}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Laatste activiteit" />
          <dl className="space-y-2 p-5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Laatste collectorrun</dt>
              <dd className="text-right font-medium text-ink-900">
                {latestRun
                  ? `${latestRun.source.name} — ${formatDateTime(latestRun.startedAt)}`
                  : 'nog nooit'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Laatste kans</dt>
              <dd className="text-right font-medium text-ink-900">
                {latestOpportunity ? formatDateTime(latestOpportunity.createdAt) : 'nog geen'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Laatste melding</dt>
              <dd className="text-right font-medium text-ink-900">
                {latestAlert ? formatDateTime(latestAlert.createdAt) : 'nog geen'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Proxy-diagnose"
            description="Welk IP-adres de inloglimiet voor jouw eigen verzoek ziet"
          />
          <dl className="space-y-2 p-5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">X-Forwarded-For (links → rechts)</dt>
              <dd className="text-right font-mono text-ink-900">{chain.length > 0 ? chain.join(' , ') : 'leeg'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">TRUSTED_PROXY_HOPS</dt>
              <dd className="text-right font-mono text-ink-900">{env.TRUSTED_PROXY_HOPS}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Gekozen bezoekers-IP</dt>
              <dd className="text-right font-mono font-medium text-ink-900">{pickedIp}</dd>
            </div>
          </dl>
          <p className="px-5 pb-5 text-xs text-ink-600">
            Het gekozen adres moet jouw eigen publieke IP zijn (zoek &quot;wat is mijn IP&quot;). Staat er
            een intern adres (10.x, 172.16–31.x, 192.168.x), verhoog dan TRUSTED_PROXY_HOPS tot het klopt.
            Staat het verkeerd, dan delen alle bezoekers één inloglimiet.
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Audittrail" description="De laatste handelingen op het platform" />
          {audit.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-600">Nog niets vastgelegd.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-600 uppercase">
                <tr>
                  <th className="px-5 py-2 font-medium">Wanneer</th>
                  <th className="px-3 py-2 font-medium">Wie</th>
                  <th className="px-3 py-2 font-medium">Wat</th>
                  <th className="px-5 py-2 font-medium">Object</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-2 text-ink-700">{formatDateTime(entry.createdAt)}</td>
                    <td className="max-w-40 truncate px-3 py-2 text-ink-700">{entry.actor}</td>
                    <td className="px-3 py-2 text-ink-900">{entry.action}</td>
                    <td className="px-5 py-2 text-ink-600">
                      {entry.entityType ? `${entry.entityType}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}
