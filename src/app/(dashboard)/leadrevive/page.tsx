import Link from 'next/link'

import { DORMANT_CATEGORY_LABELS, DORMANT_CATEGORY_ORDER } from '@/crm/dormant'
import { opportunityFilterSchema } from '@/domain/schemas'
import type { LeadReviveOpportunityType } from '@/events/opportunityRules'
import { requireAgencyScope } from '@/lib/session'
import * as crmRepository from '@/repositories/crmRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'

import {
  Badge,
  EmptyState,
  PageHeader,
  StatTile,
  buttonStyles,
} from '../../_components/primitives'
import { OpportunityCard } from '../OpportunityCard'

export const metadata = { title: 'LeadRevive' }

/**
 * LeadRevive: de kansen die al in het eigen bestand zaten.
 *
 * ─── DE TOON VAN DEZE PAGINA ─────────────────────────────────────────────────
 *
 * Alles hier is een *signaal*, geen vaststelling. Dat iemand in 2024 een
 * schatting vroeg en sindsdien zweeg, betekent niet dat hij nu wil verkopen — het
 * betekent dat er ooit een aanleiding was en dat niemand er sindsdien naar
 * gevraagd heeft. De koptekst zegt dat met zoveel woorden, en elke categorie
 * draagt de reden waarom hij bovenkomt.
 *
 * Die voorzichtigheid is niet juridisch maar commercieel: een makelaar die deze
 * lijst leest als "verkopers" belt met de verkeerde verwachting, en verbrandt
 * precies de relatie die het product wilde benutten.
 */
export default async function LeadRevivePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const scope = await requireAgencyScope()
  const params = await searchParams

  const filter = opportunityFilterSchema.parse({
    ...params,
    origin: 'LEADREVIVE',
    status: params.status ?? 'OPEN',
    sort: params.sort ?? 'score',
  })

  const [{ items, total }, counts] = await Promise.all([
    opportunityRepository.listOpportunities(scope.agencyId, filter),
    crmRepository.crmCounts(scope.agencyId),
  ])

  const activeType = typeof params.type === 'string' ? params.type : undefined

  // Per categorie tellen, zodat de makelaar kan kiezen wát voor gesprek hij
  // vandaag wil voeren in plaats van door één ongesorteerde lijst te scrollen.
  const byCategory = new Map<string, number>()
  for (const item of items) {
    byCategory.set(item.type, (byCategory.get(item.type) ?? 0) + 1)
  }

  return (
    <>
      <PageHeader
        title="LeadRevive"
        description={
          'Contacten uit het eigen klantenbestand met een aanleiding om ze opnieuw te spreken. ' +
          'Dit zijn signalen, geen verkopers: er is ooit een reden geweest, en niemand heeft er sindsdien naar gevraagd.'
        }
        action={
          <Link href="/imports" className={buttonStyles.secondary}>
            CRM importeren
          </Link>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Contacten" value={counts.total} />
        <StatTile label="Slapend" value={counts.dormant} hint="Langer dan een jaar stil" />
        <StatTile label="Schattingsleads" value={counts.valuationLeads} />
        <StatTile label="Open kansen" value={total} />
      </dl>

      <nav className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/leadrevive"
          className={!activeType ? buttonStyles.primary : buttonStyles.secondary}
        >
          Alle categorieën
        </Link>
        {DORMANT_CATEGORY_ORDER.map((category: LeadReviveOpportunityType) => (
          <Link
            key={category}
            href={`/leadrevive?type=${category}`}
            className={activeType === category ? buttonStyles.primary : buttonStyles.secondary}
          >
            {DORMANT_CATEGORY_LABELS[category]}
            {byCategory.has(category) && (
              <span className="tnum ml-1 opacity-70">{byCategory.get(category)}</span>
            )}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          title="Geen slapende relaties gevonden"
          description={
            counts.total === 0
              ? 'Er is nog geen klantenbestand geïmporteerd. Zonder CRM-data kan LeadRevive niets vinden.'
              : 'Alle relaties zijn recent gesproken of vallen buiten de ingestelde drempels.'
          }
          action={
            counts.total === 0 ? (
              <Link href="/imports" className={buttonStyles.primary}>
                CSV importeren
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="mt-6 text-sm text-ink-600">
          <Badge>Let op</Badge>{' '}
          Een hoge relatiescore zegt dat het gesprek kansrijk is, niet dat deze persoon wil
          verkopen.
        </p>
      )}
    </>
  )
}
