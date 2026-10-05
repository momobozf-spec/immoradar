import { marketFilterSchema } from '@/domain/schemas'
import { provinceLabel } from '@/domain/geo/provinces'
import { requireAgencyScope } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import { marketOverview } from '@/services/marketService'

import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  formatEuro,
  formatPercent,
} from '../../_components/primitives'

export const metadata = { title: 'Marktradar' }

/**
 * De marktradar: wat er in het werkgebied van dit kantoor gebeurt.
 *
 * ─── WAAROM DIT GEEN OPPORTUNITY-LIJST IS ────────────────────────────────────
 *
 * Hier staat álles, ook de woningen die bij een collega-kantoor liggen en waar
 * dus niets te winnen valt. Dat is bewust: een makelaar wil kunnen zien hoe zijn
 * gemeente ervoor staat — hoeveel er te koop staat, welk aandeel particulier is,
 * hoe lang dingen blijven hangen — en dat is marktkennis, geen werklijst. De
 * werklijst staat op "Vandaag".
 */
export default async function MarketPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const filter = marketFilterSchema.parse(params)

  const territories = await agencyRepository.listTerritories(scope.agencyId)
  const postalCodes = [
    ...new Set(territories.filter((territory) => territory.active).flatMap((t) => t.postalCodes)),
  ]

  const overview = await marketOverview({ postalCodes, days: filter.days })

  return (
    <>
      <PageHeader
        title="Marktradar"
        description={`Wat er in jouw gebied speelt, over de laatste ${filter.days} dagen.`}
      />

      {postalCodes.length === 0 ? (
        <EmptyState
          title="Geen gebieden ingesteld"
          description="Zonder werkgebied weet ImmoRadar niet welke markt voor jou relevant is."
        />
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Actieve advertenties" value={overview.activeListings} />
            <StatTile
              label="Particulier aangeboden"
              value={overview.privateListings}
              hint={formatPercent(overview.privateShare, 0)}
            />
            <StatTile
              label="Mediaan vraagprijs"
              value={formatEuro(overview.medianPrice)}
              hint="Actieve advertenties"
            />
            <StatTile
              label="Mediaan dagen online"
              value={overview.medianDaysOnMarket}
              hint="Hoe lang panden blijven staan"
            />
          </dl>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Per gemeente" description="Actieve advertenties in jouw gebied" />
              {overview.byLocality.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-600">Nog niets waargenomen.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-600 uppercase">
                    <tr>
                      <th className="px-5 py-2 font-medium">Gemeente</th>
                      <th className="px-3 py-2 text-right font-medium">Actief</th>
                      <th className="px-3 py-2 text-right font-medium">Particulier</th>
                      <th className="px-5 py-2 text-right font-medium">Mediaanprijs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-200">
                    {overview.byLocality.map((row) => (
                      <tr key={row.postalCode}>
                        <td className="px-5 py-2 text-ink-800">
                          {row.postalCode} {row.city ?? ''}
                        </td>
                        <td className="tnum px-3 py-2 text-right text-ink-900">{row.active}</td>
                        <td className="tnum px-3 py-2 text-right text-ink-700">{row.private}</td>
                        <td className="tnum px-5 py-2 text-right text-ink-900">
                          {formatEuro(row.medianPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Recente marktbewegingen"
                description="Prijsverlagingen, intrekkingen en herplaatsingen"
              />
              {overview.recentEvents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-600">
                  Geen bewegingen in deze periode.
                </p>
              ) : (
                <ul className="divide-y divide-ink-200 text-sm">
                  {overview.recentEvents.map((event) => (
                    <li key={event.id} className="px-5 py-2.5">
                      <div className="flex justify-between gap-3">
                        <span className="text-ink-800">{event.label}</span>
                        <span className="shrink-0 text-xs text-ink-600">{event.when}</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        {event.place}
                        {event.province ? ` · ${provinceLabel(event.province)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  )
}
