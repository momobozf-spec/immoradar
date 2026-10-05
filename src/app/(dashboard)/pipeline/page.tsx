import Link from 'next/link'

import { OPPORTUNITY_STATUSES, opportunityFilterSchema } from '@/domain/schemas'
import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'
import { formatRelative } from '@/lib/dates'
import { requireAgencyScope } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'

import {
  Badge,
  EmptyState,
  PageHeader,
  ScoreBadge,
  buttonStyles,
  formatEuro,
} from '../../_components/primitives'

export const metadata = { title: 'Opvolging' }

/**
 * De volledige acquisitiepijplijn.
 *
 * ─── WAAROM DIT EEN TABEL IS EN GEEN KANBAN ──────────────────────────────────
 *
 * Een kanban ziet er beter uit en werkt hier slechter. De lijst is gesorteerd op
 * score — dat is de kern van het product — en een kolommenbord vernietigt die
 * ordening: binnen "Gecontacteerd" staat een 94 dan naast een 51 zonder dat het
 * oog het verschil ziet. Bovendien werken makelaars deze lijst van boven naar
 * beneden af, niet door kaartjes te verslepen.
 *
 * Dit vervangt het CRM van het kantoor niet. Het houdt bij hoever déze kans
 * staat, meer niet — zie docs/opportunity-engine.md.
 */

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Nieuw',
  ASSIGNED: 'Toegewezen',
  TO_CONTACT: 'Te bellen',
  CONTACTED: 'Gecontacteerd',
  INTERESTED: 'Interesse',
  VALUATION_BOOKED: 'Schatting gepland',
  MANDATE_PROPOSED: 'Mandaat voorgesteld',
  MANDATE_WON: 'Mandaat gewonnen',
  LOST: 'Verloren',
  DISMISSED: 'Weggelegd',
  SNOOZED: 'Sluimerend',
}

export default async function PipelinePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const filter = opportunityFilterSchema.parse({
    ...params,
    status: params.status ?? 'OPEN',
    sort: params.sort ?? 'score',
  })

  const [{ items, total }, users] = await Promise.all([
    opportunityRepository.listOpportunities(scope.agencyId, filter),
    agencyRepository.listUsers(scope.agencyId),
  ])

  const activeStatus = filter.status

  return (
    <>
      <PageHeader
        title="Opvolging"
        description="Elke kans en hoever ze staat. Gesorteerd op score, want dat is de volgorde waarin bellen loont."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {(['OPEN', 'ALL', ...OPPORTUNITY_STATUSES] as const).map((status) => (
          <Link
            key={status}
            href={`/pipeline?status=${status}`}
            className={activeStatus === status ? buttonStyles.primary : buttonStyles.secondary}
          >
            {status === 'OPEN' ? 'Open' : status === 'ALL' ? 'Alles' : STATUS_LABELS[status]}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Niets in deze fase"
          description="Er staan geen kansen met deze status. Kies een andere fase of bekijk alles."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-4xl text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left">
              <tr className="text-xs tracking-wide text-ink-600 uppercase">
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Kans</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Prijs</th>
                <th className="px-4 py-2 font-medium">Relatie</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Toegewezen</th>
                <th className="px-4 py-2 font-medium">Ontdekt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-ink-50">
                  <td className="px-4 py-2">
                    <ScoreBadge score={item.score} size="sm" />
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/opportunities/${item.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700"
                    >
                      {[item.property?.city, item.property?.postalCode].filter(Boolean).join(' ') ||
                        item.crmContact?.displayName ||
                        'Kans'}
                    </Link>
                    {item.property?.address && (
                      <span className="block max-w-xs truncate text-xs text-ink-600">
                        {item.property.address}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-700">
                    {OPPORTUNITY_TYPE_LABELS[item.type as OpportunityTypeValue] ?? item.type}
                  </td>
                  <td className="tnum px-4 py-2 text-right text-ink-900">
                    {formatEuro(item.listing?.currentPrice ?? null)}
                  </td>
                  <td className="px-4 py-2">
                    {item.crmContact ? (
                      <Badge tone="brand">{item.crmContact.displayName ?? 'bekend'}</Badge>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{STATUS_LABELS[item.status] ?? item.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-ink-700">
                    {item.assignedUser?.name ?? <span className="text-ink-500">—</span>}
                  </td>
                  <td className="px-4 py-2 text-ink-600">{formatRelative(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-sm text-ink-600">
        {items.length} van {total} · {users.length} medewerkers
      </p>
    </>
  )
}
