import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  OPPORTUNITY_TYPE_HINTS,
  OPPORTUNITY_TYPE_LABELS,
  type OpportunityTypeValue,
} from '@/events/opportunityRules'
import { daysBetween, formatDate, formatDateTime, formatRelative } from '@/lib/dates'
import { maskPhone } from '@/lib/phone'
import { DIMENSION_LABELS, type ScoreDimension } from '@/scoring/config'
import { requireAgencyScope } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'
import { eventsForProperty } from '@/repositories/eventRepository'

import {
  Badge,
  Card,
  CardHeader,
  CrmMatchBadge,
  PageHeader,
  ScoreBadge,
  ScoreBar,
  formatEuro,
} from '../../../_components/primitives'
import { OpportunityActions } from '../../OpportunityActions'
import { PropertyTimeline } from '../../properties/PropertyTimeline'
import { AssignPanel } from './AssignPanel'

/**
 * De detailpagina beantwoordt precies één vraag: waarom staat dit hier, en wat
 * weet ik voordat ik bel?
 *
 * ─── DE OPBOUW ───────────────────────────────────────────────────────────────
 *
 * Links het verhaal (relatie, pand, tijdlijn), rechts de verantwoording (score,
 * signalen) en de handelingen. Wie belt leest links; wie het systeem wantrouwt
 * leest rechts. Beide moeten kunnen zonder te scrollen naar het andere.
 *
 * De scoreverantwoording is geen sier. Een makelaar die niet kan zien waarom
 * iets 94 scoort, gaat de rangschikking negeren en de lijst van boven naar
 * beneden afwerken — en dan had het scoren net zo goed achterwege kunnen blijven.
 */

export const metadata = { title: 'Kans' }

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

const CONTACT_TYPE_LABELS: Record<string, string> = {
  BUYER: 'Koper',
  SELLER: 'Verkoper',
  LANDLORD: 'Verhuurder',
  TENANT: 'Huurder',
  VALUATION_LEAD: 'Schattingsaanvraag',
  PROSPECT: 'Prospect',
  FORMER_CLIENT: 'Oud-klant',
  UNKNOWN: 'Onbekend',
}

function DetailRow({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-ink-600">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{children}</dd>
    </div>
  )
}

export default async function OpportunityDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const scope = await requireAgencyScope()
  const { id } = await params

  const opportunity = await opportunityRepository.findOpportunity(scope.agencyId, id)
  // Een kans van een ander kantoor bestaat voor deze gebruiker niet. Bewust 404
  // en geen 403: dat laatste zou bevestigen dát er een kans met dit id is.
  if (!opportunity) notFound()

  const [events, colleagues] = await Promise.all([
    opportunity.propertyId ? eventsForProperty(opportunity.propertyId) : Promise.resolve([]),
    agencyRepository.listUsers(scope.agencyId),
  ])

  const { property, listing, crmContact, scoreDetail } = opportunity
  const typeLabel =
    OPPORTUNITY_TYPE_LABELS[opportunity.type as OpportunityTypeValue] ?? opportunity.type
  const typeHint = OPPORTUNITY_TYPE_HINTS[opportunity.type as OpportunityTypeValue]

  const daysOnMarket = listing ? daysBetween(listing.firstSeenAt, new Date()) : null

  const dimensions: { key: ScoreDimension; value: number }[] = scoreDetail
    ? [
        { key: 'intent', value: scoreDetail.intent },
        { key: 'relationship', value: scoreDetail.relationship },
        { key: 'timing', value: scoreDetail.timing },
        { key: 'territory', value: scoreDetail.territory },
        { key: 'confidence', value: scoreDetail.confidence },
      ]
    : []

  return (
    <>
      <div className="mb-4">
        <Link href="/" className="text-sm text-ink-600 hover:text-ink-900">
          ← Terug naar vandaag
        </Link>
      </div>

      <PageHeader
        title={
          [property?.city, property?.postalCode].filter(Boolean).join(' ') ||
          crmContact?.displayName ||
          'Kans'
        }
        description={typeHint}
        action={<Badge>{STATUS_LABELS[opportunity.status] ?? opportunity.status}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Links: het verhaal ────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* De relatie staat bovenaan: dit is wat het gesprek anders maakt. */}
          {crmContact && (
            <Card className="border-brand-500">
              <CardHeader
                title="Bestaande relatie"
                description="Uit het klantenbestand van dit kantoor"
                action={
                  <CrmMatchBadge
                    name={null}
                    confidence={opportunity.crmMatchConfidence}
                    confirmed={opportunity.origin === 'CROSS'}
                  />
                }
              />
              <div className="grid gap-6 p-5 sm:grid-cols-2">
                <dl>
                  <DetailRow label="Naam">{crmContact.displayName ?? '—'}</DetailRow>
                  <DetailRow label="Type">
                    {CONTACT_TYPE_LABELS[crmContact.contactType] ?? crmContact.contactType}
                  </DetailRow>
                  <DetailRow label="Telefoon">{crmContact.phone ?? '—'}</DetailRow>
                  <DetailRow label="E-mail">{crmContact.email ?? '—'}</DetailRow>
                  <DetailRow label="Dossierbeheerder">
                    {crmContact.assignedAgentName ?? '—'}
                  </DetailRow>
                  <DetailRow label="Laatste contact">
                    {crmContact.lastContactAt ? formatDate(crmContact.lastContactAt) : 'Nooit'}
                  </DetailRow>
                  <DetailRow label="Klant sinds">
                    {crmContact.sourceCreatedAt ? formatDate(crmContact.sourceCreatedAt) : '—'}
                  </DetailRow>
                </dl>

                <div>
                  <p className="text-xs font-medium tracking-wide text-ink-700 uppercase">
                    Waarom wij denken dat dit dezelfde persoon is
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {opportunity.crmMatchReasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span aria-hidden className="text-brand-600">
                          ·
                        </span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>

                  {opportunity.origin !== 'CROSS' && (
                    <p className="mt-3 rounded-md bg-warning/12 px-3 py-2 text-xs text-ink-800">
                      Deze koppeling is niet zeker genoeg om als feit te behandelen. Controleer
                      hem voordat je de relatie in het gesprek gebruikt.
                    </p>
                  )}

                  {crmContact.notes && (
                    <p className="mt-3 rounded-md bg-ink-100 px-3 py-2 text-sm text-ink-700">
                      {crmContact.notes}
                    </p>
                  )}
                </div>
              </div>

              {crmContact.interactions.length > 0 && (
                <div className="border-t border-ink-200 px-5 py-4">
                  <p className="text-xs font-medium tracking-wide text-ink-700 uppercase">
                    Contactgeschiedenis
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {crmContact.interactions.slice(0, 6).map((interaction) => (
                      <li key={interaction.id} className="flex gap-3 text-sm">
                        <span className="tnum w-24 shrink-0 text-ink-600">
                          {formatDate(interaction.occurredAt)}
                        </span>
                        <span className="text-ink-800">
                          {interaction.summary ?? interaction.kind}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Het pand */}
          {property && (
            <Card>
              <CardHeader title="Pand" />
              <div className="grid gap-x-8 p-5 sm:grid-cols-2">
                <dl>
                  <DetailRow label="Adres">{property.address ?? '—'}</DetailRow>
                  <DetailRow label="Gemeente">
                    {[property.postalCode, property.city].filter(Boolean).join(' ') || '—'}
                  </DetailRow>
                  <DetailRow label="Type">{property.propertyType}</DetailRow>
                  <DetailRow label="Slaapkamers">{property.bedrooms ?? '—'}</DetailRow>
                  <DetailRow label="Oppervlakte">
                    {property.surfaceArea ? `${property.surfaceArea} m²` : '—'}
                  </DetailRow>
                </dl>
                <dl>
                  <DetailRow label="Vraagprijs">{formatEuro(listing?.currentPrice)}</DetailRow>
                  {listing?.initialPrice != null &&
                    listing.initialPrice !== listing.currentPrice && (
                      <DetailRow label="Startprijs">{formatEuro(listing.initialPrice)}</DetailRow>
                    )}
                  <DetailRow label="Prijsverlagingen">{listing?.priceDropCount ?? 0}</DetailRow>
                  <DetailRow label="Dagen online">{daysOnMarket ?? '—'}</DetailRow>
                  <DetailRow label="Keer op de markt">{property.listingCycles}</DetailRow>
                </dl>
              </div>
            </Card>
          )}

          {/* De verkoper */}
          {listing && (
            <Card>
              <CardHeader
                title="Verkoper"
                description="Zoals afgeleid uit de publieke advertentie"
              />
              <div className="grid gap-x-8 p-5 sm:grid-cols-2">
                <dl>
                  <DetailRow label="Classificatie">
                    <Badge tone={listing.sellerType === 'PRIVATE' ? 'positive' : 'neutral'}>
                      {listing.sellerType === 'PRIVATE'
                        ? 'Particulier'
                        : listing.sellerType === 'PROFESSIONAL'
                          ? 'Professioneel'
                          : 'Onbekend'}
                    </Badge>
                  </DetailRow>
                  <DetailRow label="Zekerheid">
                    {Math.round(listing.sellerConfidence * 100)}%
                  </DetailRow>
                  <DetailRow label="Naam">{listing.seller?.displayName ?? '—'}</DetailRow>
                  <DetailRow label="Telefoon">
                    {/* Het volledige nummer hoort op de detailpagina — hier wordt gebeld. */}
                    {listing.seller?.phoneE164 ?? maskPhone(null)}
                  </DetailRow>
                </dl>
                <div>
                  <p className="text-xs font-medium tracking-wide text-ink-700 uppercase">
                    Waarop die classificatie berust
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {listing.classificationReasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span aria-hidden className="text-ink-500">
                          ·
                        </span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
                  >
                    Originele advertentie ({listing.source.name}) →
                  </a>
                </div>
              </div>
            </Card>
          )}

          {/* De tijdlijn — het kenmerkende scherm van dit product */}
          {property && events.length > 0 && (
            <Card>
              <CardHeader
                title="Tijdlijn van het pand"
                description="Over alle advertenties heen, ook bij herplaatsing"
              />
              <div className="p-5">
                <PropertyTimeline events={events} />
              </div>
            </Card>
          )}

          {/* Wat wij ermee deden */}
          {opportunity.activities.length > 0 && (
            <Card>
              <CardHeader title="Opvolging" />
              <ul className="divide-y divide-ink-200">
                {opportunity.activities.map((activity) => (
                  <li key={activity.id} className="flex gap-3 px-5 py-2.5 text-sm">
                    <span className="tnum w-36 shrink-0 text-ink-600">
                      {formatDateTime(activity.createdAt)}
                    </span>
                    <span className="text-ink-800">
                      {activity.toStatus && activity.fromStatus !== activity.toStatus
                        ? `${STATUS_LABELS[activity.fromStatus ?? ''] ?? activity.fromStatus} → ${STATUS_LABELS[activity.toStatus] ?? activity.toStatus}`
                        : activity.kind}
                      {activity.note && <span className="text-ink-600"> — {activity.note}</span>}
                    </span>
                    <span className="ml-auto shrink-0 text-ink-600">
                      {activity.user?.name ?? 'systeem'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ── Rechts: de verantwoording en de knoppen ───────────────────── */}
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4 p-5">
              <ScoreBadge score={opportunity.score} size="lg" />
              <div>
                <p className="text-sm font-semibold text-ink-900">{typeLabel}</p>
                <p className="text-xs text-ink-600">
                  Ontdekt {formatRelative(opportunity.createdAt)}
                </p>
                {opportunity.matchedTerritoryName && (
                  <p className="mt-1 text-xs text-ink-600">{opportunity.matchedTerritoryName}</p>
                )}
              </div>
            </div>

            <div className="border-t border-ink-200 p-5">
              <OpportunityActions opportunityId={opportunity.id} status={opportunity.status} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Hoe deze score is opgebouwd"
              description={`Weging ${scoreDetail?.weightsVersion ?? 'v1'}`}
            />
            <div className="space-y-3 p-5">
              {dimensions.map((dimension) => (
                <ScoreBar
                  key={dimension.key}
                  label={DIMENSION_LABELS[dimension.key]}
                  value={dimension.value}
                  // Geen relatie betekent dat die dimensie niet volledig meetelt;
                  // dat hoort zichtbaar te zijn, anders lijkt de score onvolledig.
                  applied={dimension.key !== 'relationship' || opportunity.crmContactId !== null}
                />
              ))}
            </div>

            <div className="border-t border-ink-200 p-5">
              <p className="text-xs font-medium tracking-wide text-ink-700 uppercase">Redenen</p>
              <ul className="mt-2 space-y-1.5">
                {opportunity.reasons.map((reason) => (
                  <li key={reason.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-800">{reason.label}</span>
                    <span className="tnum shrink-0 text-xs text-ink-600">+{reason.points}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="border-t border-ink-200 px-5 py-3 text-xs text-ink-600">
              Deze score zegt hoe kansrijk het gesprek is, niet dat deze persoon wil verkopen.
            </p>
          </Card>

          <AssignPanel
            opportunityId={opportunity.id}
            currentUserId={opportunity.assignedUserId}
            colleagues={colleagues.map((colleague) => ({
              id: colleague.id,
              name: colleague.name ?? colleague.email,
            }))}
          />

          {opportunity.alerts.length > 0 && (
            <Card>
              <CardHeader title="Verstuurde meldingen" />
              <ul className="divide-y divide-ink-200 text-sm">
                {opportunity.alerts.map((alert) => (
                  <li key={alert.id} className="flex justify-between gap-3 px-5 py-2">
                    <span className="text-ink-700">{formatDateTime(alert.createdAt)}</span>
                    <Badge tone={alert.status === 'SENT' ? 'positive' : 'neutral'}>
                      {alert.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
