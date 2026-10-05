import { formatDateTime } from '@/lib/dates'
import { ROLE_LABELS, requireAgencyAdminPage } from '@/lib/session'
import * as userRepository from '@/repositories/userRepository'

import { Badge, Card, CardHeader, PageHeader } from '../../_components/primitives'

import { AddMemberForm, MemberActions } from './TeamForms'

export const metadata = { title: 'Team' }

/**
 * Wie er in dit kantoor met ImmoRadar werkt.
 *
 * Gedeactiveerde collega's blijven zichtbaar, onderaan: hun naam staat nog bij
 * opgevolgde kansen en in de audittrail, en heractiveren hoort één klik te zijn.
 */
export default async function TeamPage() {
  const scope = await requireAgencyAdminPage()
  const team = await userRepository.listTeam(scope.agencyId)
  const now = new Date()

  return (
    <>
      <PageHeader
        title="Team"
        description="Collega's toevoegen, rollen wijzigen en toegang intrekken. Een gedeactiveerde gebruiker wordt meteen overal afgemeld."
      />

      <div className="space-y-6">
        <AddMemberForm />

        <Card>
          <CardHeader title={`${team.filter((member) => member.active).length} actieve gebruikers`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs tracking-wide text-ink-600 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Gebruiker</th>
                  <th className="px-4 py-2 font-medium">Rol</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Laatst ingelogd</th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">Acties</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {team.map((member) => (
                  <tr key={member.id} className={member.active ? '' : 'bg-ink-50 text-ink-600'}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-ink-900">{member.name ?? member.email}</p>
                      {member.name && <p className="text-xs text-ink-600">{member.email}</p>}
                    </td>
                    <td className="px-4 py-3 align-top">{ROLE_LABELS[member.role]}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {member.active ? (
                          <Badge tone="positive">Actief</Badge>
                        ) : (
                          <Badge tone="neutral">Gedeactiveerd</Badge>
                        )}
                        {member.active && member.mustChangePassword && (
                          <Badge tone="warning">Tijdelijk wachtwoord</Badge>
                        )}
                        {member.lockedUntil && member.lockedUntil > now && (
                          <Badge tone="danger">Vergrendeld</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-ink-700">
                      {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'Nog nooit'}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <MemberActions
                        userId={member.id}
                        role={member.role}
                        active={member.active}
                        isSelf={member.id === scope.userId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-xs text-ink-600">
          Een vergrendeld account ontgrendelt vanzelf na de wachttijd. Wil je dat niet afwachten,
          geef dan een nieuw tijdelijk wachtwoord uit: dat heft de vergrendeling meteen op.
        </p>
      </div>
    </>
  )
}
