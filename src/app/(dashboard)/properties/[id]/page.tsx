import Link from 'next/link'
import { notFound } from 'next/navigation'

import { daysBetween, formatDate } from '@/lib/dates'
import { requireAgencyScope } from '@/lib/session'
import * as propertyRepository from '@/repositories/propertyRepository'

import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  formatEuro,
} from '../../../_components/primitives'
import { PropertyTimeline } from '../PropertyTimeline'

export const metadata = { title: 'Pand' }

/**
 * Alles wat we over één pand weten.
 *
 * De advertenties staan onder elkaar, nieuwste eerst, met hun eigen
 * prijsgeschiedenis. Dat een pand meerdere advertenties heeft is hier geen
 * randgeval maar het interessante geval: twee advertenties met een gat ertussen
 * betekent dat een eerdere verkooppoging is mislukt, en dat is het beste
 * argument dat een makelaar aan de telefoon kan hebben.
 */
export default async function PropertyDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  // De sessie is hier een toegangscontrole, geen filter: panden zijn marktdata
  // en horen niet bij één kantoor. Zie propertyRepository.listProperties.
  await requireAgencyScope()

  const { id } = await params
  const property = await propertyRepository.findPropertyDetail(id)
  if (!property) notFound()

  return (
    <>
      <div className="mb-4">
        <Link href="/properties" className="text-sm text-ink-600 hover:text-ink-900">
          ← Terug naar panden
        </Link>
      </div>

      <PageHeader
        title={property.address ?? 'Pand'}
        description={[property.postalCode, property.city].filter(Boolean).join(' ')}
        action={
          property.listingCycles > 1 ? (
            <Badge tone="warning">{property.listingCycles}× op de markt geweest</Badge>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Tijdlijn"
              description="Alle gebeurtenissen, over advertenties heen"
            />
            <div className="p-5">
              <PropertyTimeline events={property.events} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title={`Advertenties (${property.listings.length})`}
              description="Nieuwste eerst"
            />
            <ul className="divide-y divide-ink-200">
              {property.listings.map((listing) => (
                <li key={listing.id} className="p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink-900">{listing.title ?? 'Zonder titel'}</p>
                    <span className="tnum font-medium text-ink-900">
                      {formatEuro(listing.currentPrice)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-600">
                    <Badge tone={listing.sellerType === 'PRIVATE' ? 'positive' : 'neutral'}>
                      {listing.sellerType === 'PRIVATE' ? 'Particulier' : 'Kantoor'}
                    </Badge>
                    <span>{listing.source.name}</span>
                    <span>
                      {formatDate(listing.firstSeenAt)} —{' '}
                      {listing.removedAt ? formatDate(listing.removedAt) : 'nu'}
                    </span>
                    <span>
                      {daysBetween(listing.firstSeenAt, listing.removedAt ?? new Date())} dagen
                    </span>
                    <span>{listing.status}</span>
                  </div>

                  {listing.initialPrice != null &&
                    listing.initialPrice !== listing.currentPrice && (
                      <p className="tnum mt-1 text-sm text-ink-700">
                        Gestart op {formatEuro(listing.initialPrice)} ·{' '}
                        {listing.priceDropCount} verlaging
                        {listing.priceDropCount === 1 ? '' : 'en'}
                      </p>
                    )}

                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 inline-block text-sm text-brand-700 hover:underline"
                  >
                    Originele advertentie →
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Kenmerken" />
            <dl className="space-y-1 p-5 text-sm">
              {[
                ['Type', property.propertyType],
                ['Slaapkamers', property.bedrooms ?? '—'],
                ['Oppervlakte', property.surfaceArea ? `${property.surfaceArea} m²` : '—'],
                ['Provincie', property.province ?? '—'],
                ['Eerst gezien', formatDate(property.firstSeenAt)],
                ['Laatst gezien', formatDate(property.lastSeenAt)],
                ['Advertenties', property.listings.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-ink-600">{label}</dt>
                  <dd className="font-medium text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  )
}
