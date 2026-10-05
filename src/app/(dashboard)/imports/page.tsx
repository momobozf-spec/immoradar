import { formatDateTime } from '@/lib/dates'
import { requireAgencyScope } from '@/lib/session'
import * as crmRepository from '@/repositories/crmRepository'

import { Badge, Card, CardHeader, PageHeader } from '../../_components/primitives'
import { ImportWizard } from './ImportWizard'

export const metadata = { title: 'Imports' }

const STATUS_TONES: Record<string, 'neutral' | 'positive' | 'danger' | 'warning'> = {
  COMPLETED: 'positive',
  FAILED: 'danger',
  IMPORTING: 'warning',
  READY: 'warning',
  ANALYZING: 'neutral',
  PENDING: 'neutral',
}

/**
 * Importeren en de geschiedenis ervan.
 *
 * De geschiedenis staat op dezelfde pagina en niet weggestopt: wie een import
 * doet wil daarna kunnen zien wat hij gedaan heeft, en wie een vreemd contact
 * tegenkomt wil kunnen nagaan uit welk bestand het kwam. Zonder die herleidbaar-
 * heid is "nooit stilzwijgend overschrijven" een belofte zonder bewijs.
 */
export default async function ImportsPage() {
  const scope = await requireAgencyScope()
  const imports = await crmRepository.listImports(scope.agencyId)

  return (
    <>
      <PageHeader
        title="CRM importeren"
        description="Laad het klantenbestand van je kantoor in. LeadRevive gebruikt het om slapende relaties te vinden en om marktsignalen aan bestaande klanten te koppelen."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ImportWizard />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Eerdere imports" />
            {imports.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-600">Nog niets geïmporteerd.</p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {imports.map((record) => (
                  <li key={record.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {record.fileName ?? 'Zonder bestandsnaam'}
                      </p>
                      <Badge tone={STATUS_TONES[record.status] ?? 'neutral'}>{record.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {formatDateTime(record.startedAt)}
                    </p>
                    {record.status === 'COMPLETED' && (
                      <p className="tnum mt-1 text-xs text-ink-700">
                        {record.createdCount} nieuw · {record.updatedCount} bijgewerkt ·{' '}
                        {record.duplicateCount} duplicaat · {record.invalidCount} onbruikbaar
                      </p>
                    )}
                    {record.error && <p className="mt-1 text-xs text-danger">{record.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Wat er met je data gebeurt" />
            <ul className="space-y-2 p-5 text-sm text-ink-700">
              <li>
                Je klantenbestand blijft van jou. Geen enkel ander kantoor kan het zien of
                doorzoeken.
              </li>
              <li>
                Bestaande contacten worden bijgewerkt, nooit gewist. Een lege cel overschrijft
                geen ingevulde waarde.
              </li>
              <li>
                Per rij wordt vastgelegd wat er gebeurde en waarom — inclusief wat er wijzigde.
              </li>
              <li>Wij gebruiken jouw CRM-data nooit om die van een ander kantoor te verrijken.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
