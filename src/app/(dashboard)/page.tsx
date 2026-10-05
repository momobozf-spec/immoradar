import Link from 'next/link'

import { opportunityFilterSchema } from '@/domain/schemas'
import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'
import { requireAgencyScope } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'

import { Badge, EmptyState, PageHeader, StatTile, buttonStyles } from '../_components/primitives'
import { OpportunityCard } from './OpportunityCard'

export const metadata = { title: "Vandaag" }

/**
 * De startpagina: wie moet dit kantoor vandaag bellen?
 *
 * ─── WAAROM HIER GEEN ANALYTICS STAAT ────────────────────────────────────────
 *
 * De verleiding bij elk B2B-product is om de homepage vol te zetten met
 * grafieken. Dat voelt volwassen en het is precies verkeerd: een makelaar opent
 * dit scherm om te weten wat hij nú moet doen, niet om te zien hoe het vorige
 * kwartaal ging. De cijfers bovenaan zijn daarom tellers die naar werk leiden —
 * "vier met een bestaande relatie" is een filter, geen rapport. De echte
 * analyse staat op /analytics, waar de kantoorleider hem zoekt.
 */

/** De ochtendgroet. Klein detail, maar het zet de toon van "jouw werklijst". */
function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('nl-BE', {
      timeZone: 'Europe/Brussels',
      hour: 'numeric',
      hour12: false,
    }).format(now),
  )

  if (hour < 6) return 'Goedenacht'
  if (hour < 12) return 'Goedemorgen'
  if (hour < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

export default async function TodayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const filter = opportunityFilterSchema.parse({
    ...params,
    // De startpagina toont wat nog werk vraagt. Wie de rest wil ziet, gaat naar
    // Opvolging — daar is de volledige pijplijn de bedoeling.
    status: params.status ?? 'OPEN',
    sort: params.sort ?? 'score',
  })

  const [{ items, total }, user, crossCount, leadReviveCount, freshCount] = await Promise.all([
    opportunityRepository.listOpportunities(scope.agencyId, filter),
    agencyRepository.findUser(scope.userId),
    opportunityRepository.countOpportunities(scope.agencyId, { origin: 'CROSS', open: true }),
    opportunityRepository.countOpportunities(scope.agencyId, { origin: 'LEADREVIVE', open: true }),
    opportunityRepository.countOpportunities(scope.agencyId, { open: true, sinceHours: 24 }),
  ])

  const firstName = (user?.name ?? '').split(' ')[0] ?? ''

  // De samenstelling van de lijst, zodat de makelaar in één blik ziet wát er
  // ligt in plaats van alleen hoevéél.
  const byType = new Map<string, number>()
  for (const item of items) {
    byType.set(item.type, (byType.get(item.type) ?? 0) + 1)
  }

  return (
    <>
      <PageHeader
        title={`${greeting(new Date())}${firstName ? `, ${firstName}` : ''}`}
        description={
          total === 0
            ? 'Er staat vandaag niets open.'
            : `${total} ${total === 1 ? 'kans vraagt' : 'kansen vragen'} aandacht.`
        }
        action={
          <Link href="/pipeline" className={buttonStyles.secondary}>
            Volledige opvolging
          </Link>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open kansen" value={total} href="/pipeline" />
        <StatTile
          label="Met bekende relatie"
          value={crossCount}
          hint="Marktsignaal bij een eigen contact"
          href="/?origin=CROSS"
        />
        <StatTile
          label="Uit LeadRevive"
          value={leadReviveCount}
          hint="Slapend in het eigen bestand"
          href="/leadrevive"
        />
        <StatTile label="Nieuw vandaag" value={freshCount} hint="Laatste 24 uur" />
      </dl>

      {byType.size > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {[...byType.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <Badge key={type}>
                {count}× {OPPORTUNITY_TYPE_LABELS[type as OpportunityTypeValue] ?? type}
              </Badge>
            ))}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Geen openstaande kansen"
          description={
            'Dat kan drie dingen betekenen: alles is opgevolgd, er zijn nog geen gebieden ' +
            'ingesteld, of de collector heeft nog niet gedraaid. Controleer je gebieden als ' +
            'dit langer dan een dag duurt.'
          }
          action={
            <Link href="/territories" className={buttonStyles.secondary}>
              Gebieden bekijken
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}

      {total > items.length && (
        <p className="mt-6 text-center text-sm text-ink-600">
          {items.length} van {total} getoond.{' '}
          <Link href="/pipeline" className="font-medium text-brand-700 hover:underline">
            Bekijk alles in Opvolging
          </Link>
        </p>
      )}
    </>
  )
}
