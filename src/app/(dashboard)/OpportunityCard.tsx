import Link from 'next/link'

import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'
import { formatRelative } from '@/lib/dates'
import type { OpportunityListItem } from '@/repositories/opportunityRepository'

import {
  Badge,
  CrmMatchBadge,
  formatEuro,
  ScoreBadge,
} from '../_components/primitives'
import { OpportunityActions } from './OpportunityActions'

/**
 * De kaart waar het hele product op neerkomt.
 *
 * ─── DE LEESVOLGORDE ─────────────────────────────────────────────────────────
 *
 * Een makelaar scant deze lijst 's ochtends in dertig seconden. De volgorde
 * waarin hij informatie tegenkomt is daarom niet vrij:
 *
 *   1. de score        — mag ik dit overslaan?
 *   2. de relatie      — ken ik deze mensen?      ← het onderscheidende gegeven
 *   3. plaats en prijs — is dit mijn soort werk?
 *   4. de reden        — waarom komt dit vandaag boven?
 *   5. de knoppen      — wat doe ik ermee?
 *
 * De CRM-badge staat bewust vóór het adres. Dat een woning in Gent 625.000 euro
 * kost is marktinformatie die iedereen kan kopen; dat de verkoper de man is aan
 * wie dit kantoor in 2019 dat huis verkocht, kan alleen dit kantoor weten. Wat
 * het product uniek maakt, hoort het eerst gelezen te worden.
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

export function OpportunityCard({
  opportunity,
  showActions = true,
}: {
  readonly opportunity: OpportunityListItem
  readonly showActions?: boolean
}) {
  const { property, listing, crmContact } = opportunity

  const place =
    [property?.city, property?.postalCode].filter(Boolean).join(' ') ||
    crmContact?.displayName ||
    'Onbekende locatie'

  const typeLabel =
    OPPORTUNITY_TYPE_LABELS[opportunity.type as OpportunityTypeValue] ?? opportunity.type

  const isCross = opportunity.origin === 'CROSS'
  const isLeadRevive = opportunity.origin === 'LEADREVIVE'

  return (
    <article
      className={`rounded-xl border bg-white transition-shadow hover:shadow-sm ${
        isCross ? 'border-brand-500' : 'border-ink-200'
      }`}
    >
      <div className="flex gap-4 p-4">
        <ScoreBadge score={opportunity.score} />

        <div className="min-w-0 flex-1">
          {/* Regel 1 — waar gaat dit over, en ken ik ze? */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isCross ? 'brand' : isLeadRevive ? 'neutral' : 'neutral'}>
              {typeLabel}
            </Badge>

            {opportunity.crmContactId && (
              <CrmMatchBadge
                name={crmContact?.displayName ?? null}
                confidence={opportunity.crmMatchConfidence}
                confirmed={isCross}
              />
            )}

            {opportunity.status !== 'NEW' && (
              <Badge tone="neutral">{STATUS_LABELS[opportunity.status] ?? opportunity.status}</Badge>
            )}
          </div>

          {/* Regel 2 — plaats en prijs, groot genoeg om te scannen */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-ink-950">
              <Link href={`/opportunities/${opportunity.id}`} className="hover:text-brand-700">
                {place}
              </Link>
            </h3>
            {listing?.currentPrice != null && (
              <span className="tnum text-base font-medium text-ink-800">
                {formatEuro(listing.currentPrice)}
              </span>
            )}
            {property?.address && (
              <span className="truncate text-sm text-ink-600">{property.address}</span>
            )}
          </div>

          {/* Regel 3 — de herkomst van het signaal */}
          <p className="mt-1 text-xs text-ink-600">
            {isLeadRevive
              ? 'Uit het eigen klantenbestand'
              : `Gedetecteerd ${formatRelative(opportunity.createdAt)}`}
            {opportunity.matchedTerritoryName && ` · ${opportunity.matchedTerritoryName}`}
            {opportunity.assignedUser && ` · ${opportunity.assignedUser.name ?? 'toegewezen'}`}
          </p>

          {/* Regel 4 — waarom komt dit boven? Drie redenen is genoeg om te beslissen. */}
          {opportunity.reasons.length > 0 && (
            <ul className="mt-3 space-y-1">
              {opportunity.reasons.slice(0, 3).map((reason) => (
                <li key={reason.id} className="flex gap-2 text-sm text-ink-700">
                  <span aria-hidden className="text-positive">
                    +
                  </span>
                  <span>{reason.label}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Regel 5 — wat doe ik ermee? */}
          {showActions && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <OpportunityActions opportunityId={opportunity.id} status={opportunity.status} />
              <Link
                href={`/opportunities/${opportunity.id}`}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Openen →
              </Link>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
