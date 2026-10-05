import { formatDate } from '@/lib/dates'
import { requirePlatformAdmin } from '@/lib/session'
import { prisma } from '@/repositories/prisma'

import { Badge, Card, CardHeader, PageHeader } from '../../_components/primitives'

import { AgencyControls, CreateAgencyForm } from './AgencyForms'

/** `yyyy-mm-dd` van een tijdstip in Brussel, voor de standaardwaarde van een datumveld. */
function isoDateInBrussels(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(date)
}

export const metadata = { title: 'Kantoren' }

/**
 * De kantoren op dit platform.
 *
 * ─── WAT HIER BEWUST NIET STAAT ──────────────────────────────────────────────
 *
 * Aantallen, geen inhoud. Een platformbeheerder mag weten dát een kantoor 500
 * contacten heeft en of het abonnement loopt; hij heeft geen enkele reden om te
 * zien wie die contacten zijn. Zou dit scherm doorklikken naar het klantenbestand,
 * dan zou de belofte "geen enkel ander kantoor kan het zien" een uitzondering
 * krijgen — en één uitzondering is genoeg om de belofte waardeloos te maken.
 *
 * Ondersteuning die tóch bij de data moet, doet dat met een expliciete
 * databasesessie die in de audittrail belandt, niet via een knop in de UI.
 */
export default async function AgenciesPage() {
  await requirePlatformAdmin()

  const agencies = await prisma.agency.findMany({
    orderBy: { name: 'asc' },
    include: {
      subscription: true,
      _count: {
        select: {
          users: true,
          territories: true,
          crmContacts: true,
          opportunities: true,
          alerts: true,
        },
      },
    },
  })

  return (
    <>
      <PageHeader
        title="Kantoren"
        description="Aantallen per kantoor. De inhoud van een klantenbestand is hier niet zichtbaar."
      />

      <div className="mb-6">
        <CreateAgencyForm />
      </div>

      <Card>
        <CardHeader title={`${agencies.length} kantoren`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs tracking-wide text-ink-600 uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Kantoor</th>
                <th className="px-4 py-2 font-medium">Abonnement</th>
                <th className="px-4 py-2 text-right font-medium">Gebruikers</th>
                <th className="px-4 py-2 text-right font-medium">Gebieden</th>
                <th className="px-4 py-2 text-right font-medium">Contacten</th>
                <th className="px-4 py-2 text-right font-medium">Kansen</th>
                <th className="px-4 py-2 text-right font-medium">Meldingen</th>
                <th className="px-4 py-2 font-medium">Sinds</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Beheer</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {agencies.map((agency) => (
                <tr key={agency.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-ink-900">{agency.name}</p>
                    <p className="text-xs text-ink-600">{agency.slug}</p>
                  </td>
                  <td className="px-4 py-2">
                    {agency.subscription ? (
                      <>
                        <Badge tone={agency.subscription.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                          {agency.subscription.plan} · {agency.subscription.status}
                        </Badge>
                        {agency.subscription.endsAt && (
                          <p className="mt-1 text-xs text-ink-600">
                            tot {formatDate(agency.subscription.endsAt)}
                          </p>
                        )}
                      </>
                    ) : (
                      <Badge tone="danger">geen</Badge>
                    )}
                    {!agency.active && (
                      <Badge tone="danger">
                        <span className="ml-1">inactief</span>
                      </Badge>
                    )}
                  </td>
                  <td className="tnum px-4 py-2 text-right">{agency._count.users}</td>
                  <td className="tnum px-4 py-2 text-right">{agency._count.territories}</td>
                  <td className="tnum px-4 py-2 text-right">{agency._count.crmContacts}</td>
                  <td className="tnum px-4 py-2 text-right">{agency._count.opportunities}</td>
                  <td className="tnum px-4 py-2 text-right">{agency._count.alerts}</td>
                  <td className="px-4 py-2 text-ink-700">{formatDate(agency.createdAt)}</td>
                  <td className="px-4 py-2 align-top">
                    <AgencyControls
                      agencyId={agency.id}
                      active={agency.active}
                      subscription={
                        agency.subscription
                          ? {
                              plan: agency.subscription.plan,
                              status: agency.subscription.status,
                              maxOpportunitiesPerDay: agency.subscription.maxOpportunitiesPerDay,
                              endsAt: agency.subscription.endsAt
                                ? isoDateInBrussels(agency.subscription.endsAt)
                                : null,
                            }
                          : null
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
