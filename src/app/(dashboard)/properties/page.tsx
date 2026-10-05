import Link from 'next/link'

import { requireAgencyScope } from '@/lib/session'
import * as propertyRepository from '@/repositories/propertyRepository'
import * as agencyRepository from '@/repositories/agencyRepository'

import { Badge, EmptyState, PageHeader, formatEuro } from '../../_components/primitives'

export const metadata = { title: 'Panden' }

/**
 * De pandenlijst: alles wat in het werkgebied van dit kantoor te koop staat of
 * stond.
 *
 * ─── WAAROM DIT NAAST "VANDAAG" BESTAAT ──────────────────────────────────────
 *
 * "Vandaag" toont wat er te doen is. Deze lijst toont wat er ís — inclusief de
 * professioneel aangeboden woningen waar geen mandaat te winnen valt. Dat lijkt
 * overbodig tot een makelaar een adres hoort en wil weten wat wij erover weten.
 * Zonder deze pagina is de opgebouwde geschiedenis alleen bereikbaar via een
 * kans, en dus onzichtbaar zodra die kans is afgehandeld.
 */
export default async function PropertiesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const query = typeof params.q === 'string' ? params.q : undefined
  const page = Number(typeof params.page === 'string' ? params.page : '1') || 1

  const territories = await agencyRepository.listTerritories(scope.agencyId)
  const postalCodes = [
    ...new Set(territories.filter((t) => t.active).flatMap((t) => t.postalCodes)),
  ]

  const { items, total } = await propertyRepository.listProperties({
    postalCodes,
    query,
    page,
  })

  return (
    <>
      <PageHeader
        title="Panden"
        description="Elk pand dat we in jouw gebied hebben waargenomen, met zijn volledige geschiedenis."
      />

      <form method="get" className="mb-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ''}
          placeholder="Zoek op adres, straat of gemeente"
          className="w-full max-w-md rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-ink-50"
        >
          Zoeken
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="Geen panden gevonden"
          description={
            postalCodes.length === 0
              ? 'Er zijn nog geen gebieden ingesteld, dus er is niets om te tonen.'
              : 'Geen enkel waargenomen pand komt overeen met deze zoekopdracht.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left">
              <tr className="text-xs tracking-wide text-ink-600 uppercase">
                <th className="px-4 py-2 font-medium">Adres</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Vraagprijs</th>
                <th className="px-4 py-2 text-right font-medium">Cycli</th>
                <th className="px-4 py-2 font-medium">Verkoper</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {items.map((property) => {
                const latest = property.listings[0]
                return (
                  <tr key={property.id} className="hover:bg-ink-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/properties/${property.id}`}
                        className="font-medium text-ink-900 hover:text-brand-700"
                      >
                        {property.address ?? '—'}
                      </Link>
                      <span className="block text-xs text-ink-600">
                        {[property.postalCode, property.city].filter(Boolean).join(' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-700">{property.propertyType}</td>
                    <td className="tnum px-4 py-2 text-right text-ink-900">
                      {formatEuro(latest?.currentPrice ?? null)}
                    </td>
                    <td className="tnum px-4 py-2 text-right text-ink-700">
                      {property.listingCycles}
                    </td>
                    <td className="px-4 py-2">
                      {latest && (
                        <Badge tone={latest.sellerType === 'PRIVATE' ? 'positive' : 'neutral'}>
                          {latest.sellerType === 'PRIVATE'
                            ? 'Particulier'
                            : latest.sellerType === 'PROFESSIONAL'
                              ? 'Kantoor'
                              : 'Onbekend'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-700">{latest?.status ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > items.length && (
        <nav className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`/properties?page=${page - 1}${query ? `&q=${encodeURIComponent(query)}` : ''}`}
              className="text-brand-700 hover:underline"
            >
              ← Vorige
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-600">
            {items.length} van {total}
          </span>
          <Link
            href={`/properties?page=${page + 1}${query ? `&q=${encodeURIComponent(query)}` : ''}`}
            className="text-brand-700 hover:underline"
          >
            Volgende →
          </Link>
        </nav>
      )}
    </>
  )
}
