import { getEnv } from '@/lib/env'
import { formatDate } from '@/lib/dates'
import { requireAgencyAdminPage, ROLE_LABELS } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as crmRepository from '@/repositories/crmRepository'

import { Badge, Card, CardHeader, PageHeader } from '../../_components/primitives'
import { AgencySettingsForm } from './AgencySettingsForm'

export const metadata = { title: 'Instellingen' }

/**
 * Kantoorinstellingen, medewerkers en de geldende drempels.
 *
 * ─── WAAROM DE DREMPELS HIER ALLEEN GETOOND WORDEN ───────────────────────────
 *
 * Ze komen uit de omgeving en niet uit de database, en dat is met opzet: een
 * classificatiedrempel van 0,85 naar 0,50 zetten verandert wat het systeem een
 * particuliere verkoper noemt, en daarmee wie er gebeld wordt. Zo'n wijziging
 * hoort een bewuste ingreep te zijn met een herstart, geen schuifje in een
 * scherm waar iemand aan kan zitten. Ze tonen is wél nuttig — dan kan een
 * kantoor zien waarom het krijgt wat het krijgt.
 */
export default async function SettingsPage() {
  const scope = await requireAgencyAdminPage()

  const [agency, users, counts] = await Promise.all([
    agencyRepository.findAgency(scope.agencyId),
    agencyRepository.listUsers(scope.agencyId),
    crmRepository.crmCounts(scope.agencyId),
  ])

  const env = getEnv()

  const thresholds = [
    ['Particulier vanaf zekerheid', `${Math.round(env.PRIVATE_CONFIDENCE_THRESHOLD * 100)}%`],
    ['Professioneel vanaf advertenties', String(env.PROFESSIONAL_LISTING_COUNT_THRESHOLD)],
    ['Pand koppelen vanaf', `${Math.round(env.PROPERTY_MATCH_THRESHOLD * 100)}%`],
    ['CRM koppelen vanaf', `${Math.round(env.CRM_MATCH_AUTO_THRESHOLD * 100)}%`],
    ['CRM ter bevestiging vanaf', `${Math.round(env.CRM_MATCH_REVIEW_THRESHOLD * 100)}%`],
    ['Slapend na', `${env.DORMANT_MONTHS} maanden`],
    ['Minimale kansscore', String(env.MIN_OPPORTUNITY_SCORE)],
    ['Kans verloopt na', `${env.OPPORTUNITY_TTL_DAYS} dagen`],
    ['Stale-drempels', `${env.STALE_THRESHOLD_DAYS.join(', ')} dagen`],
    ['Bewaartermijn verkopersgegevens', `${env.RETENTION_SELLER_CONTACT_DAYS} dagen`],
  ] as const

  return (
    <>
      <PageHeader title="Instellingen" description={agency?.name ?? ''} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AgencySettingsForm
          contactEmail={agency?.contactEmail ?? ''}
          telegramChatId={agency?.telegramChatId ?? ''}
        />

        <Card>
          <CardHeader title={`Medewerkers (${users.length})`} />
          <ul className="divide-y divide-ink-200">
            {users.map((user) => (
              <li key={user.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {user.name ?? user.email}
                  </p>
                  <p className="truncate text-xs text-ink-600">{user.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!user.active && <Badge tone="danger">inactief</Badge>}
                  <Badge>{ROLE_LABELS[user.role]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Geldende drempels"
            description="Uit de omgeving; een wijziging vraagt een herstart"
          />
          <dl className="space-y-1 p-5 text-sm">
            {thresholds.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-ink-600">{label}</dt>
                <dd className="tnum font-medium text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Klantenbestand" />
          <dl className="space-y-1 p-5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Contacten</dt>
              <dd className="tnum font-medium text-ink-900">{counts.total}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Waarvan slapend</dt>
              <dd className="tnum font-medium text-ink-900">{counts.dormant}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Met telefoonnummer</dt>
              <dd className="tnum font-medium text-ink-900">{counts.withPhone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-600">Gekoppeld aan een pand</dt>
              <dd className="tnum font-medium text-ink-900">{counts.linkedToProperty}</dd>
            </div>
          </dl>
          <p className="border-t border-ink-200 px-5 py-3 text-xs text-ink-600">
            Kantoor aangemaakt op {agency ? formatDate(agency.createdAt) : '—'}. Deze gegevens zijn
            uitsluitend zichtbaar voor dit kantoor.
          </p>
        </Card>
      </div>
    </>
  )
}
