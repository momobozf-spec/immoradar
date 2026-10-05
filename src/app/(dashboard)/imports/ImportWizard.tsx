'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { CRM_IMPORT_FIELDS, type CrmImportField } from '@/domain/schemas'

import {
  analyzeUpload,
  confirmUpload,
  type AnalyzeState,
  type ConfirmState,
} from '../../_actions/imports'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../_components/primitives'

/**
 * De importwizard: kiezen, controleren, bevestigen.
 *
 * De middelste stap is de reden dat dit een wizard is en geen knop. Wat daar
 * getoond wordt — welke kolom op welk veld ligt, met echte voorbeeldwaarden
 * eronder — is het enige moment waarop een verkeerd geraden kolom nog gratis te
 * herstellen is.
 */

const FIELD_LABELS: Record<CrmImportField, string> = {
  ignore: '— niet importeren —',
  externalId: 'CRM-id',
  firstName: 'Voornaam',
  lastName: 'Achternaam',
  displayName: 'Volledige naam',
  email: 'E-mailadres',
  phone: 'Telefoon',
  address: 'Adres',
  postalCode: 'Postcode',
  city: 'Gemeente',
  contactType: 'Contacttype',
  status: 'Status',
  leadType: 'Soort lead',
  assignedAgentName: 'Dossierbeheerder',
  notes: 'Notities',
  sourceCreatedAt: 'Aangemaakt op',
  lastContactAt: 'Laatste contact',
}

const ANALYZE_INITIAL: AnalyzeState = { error: null, result: null }
const CONFIRM_INITIAL: ConfirmState = { error: null, summary: null }

function SubmitButton({ label, variant = 'primary' }: { readonly label: string; readonly variant?: keyof typeof buttonStyles }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles[variant]} disabled={pending}>
      {pending ? 'Bezig…' : label}
    </button>
  )
}

export function ImportWizard() {
  const [analyzeState, analyzeAction] = useActionState<AnalyzeState, FormData>(
    analyzeUpload,
    ANALYZE_INITIAL,
  )
  const [confirmState, confirmAction] = useActionState<ConfirmState, FormData>(
    confirmUpload,
    CONFIRM_INITIAL,
  )

  const result = analyzeState.result

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1 · Bestand kiezen"
          description="Een CSV-export uit je eigen CRM. Puntkomma's, komma's en tabs worden allemaal herkend."
        />
        <form action={analyzeAction} className="space-y-3 p-5">
          <div>
            <label htmlFor="file" className={labelStyles}>
              CSV-bestand
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              required
              className={`${inputStyles} mt-1 file:mr-3 file:rounded file:border-0 file:bg-ink-200 file:px-3 file:py-1 file:text-sm`}
            />
          </div>

          {analyzeState.error && <ErrorNote>{analyzeState.error}</ErrorNote>}

          <SubmitButton label="Bestand analyseren" />

          <p className="text-xs text-ink-600">
            Er wordt nog niets opgeslagen in je klantenbestand. Je ziet eerst wat we begrijpen.
          </p>
        </form>
      </Card>

      {result && (
        <Card>
          <CardHeader
            title="2 · Kolommen controleren"
            description={`${result.totalRows} rijen gevonden. Corrigeer wat verkeerd geraden is.`}
          />

          <form action={confirmAction} className="p-5">
            <input type="hidden" name="importId" value={result.importId} />
            <input type="hidden" name="header" value={JSON.stringify(result.header)} />

            {result.warnings.length > 0 && (
              <ul className="mb-4 space-y-1">
                {result.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="rounded-md bg-warning/12 px-3 py-1.5 text-sm text-ink-800"
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-ink-600 uppercase">
                    <th className="py-2 pr-4 font-medium">Kolom in je bestand</th>
                    <th className="py-2 pr-4 font-medium">Wordt geïmporteerd als</th>
                    <th className="py-2 font-medium">Voorbeeldwaarden</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200">
                  {result.header.map((column, index) => (
                    <tr key={`${column}-${index}`}>
                      <td className="py-2 pr-4 font-medium text-ink-900">{column || `Kolom ${index + 1}`}</td>
                      <td className="py-2 pr-4">
                        <select
                          name={`column-${index}`}
                          defaultValue={result.suggestedMapping[String(index)] ?? 'ignore'}
                          className="rounded-md border border-ink-300 bg-white px-2 py-1 text-sm"
                        >
                          {CRM_IMPORT_FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {FIELD_LABELS[field]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-ink-600">
                        {result.preview
                          .map((row) => row[index])
                          .filter((value): value is string => Boolean(value))
                          .slice(0, 3)
                          .join(' · ') || <span className="text-ink-400">leeg</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {confirmState.error && (
              <div className="mt-4">
                <ErrorNote>{confirmState.error}</ErrorNote>
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <SubmitButton label="Importeren" />
              <p className="text-xs text-ink-600">
                Bestaande contacten worden bijgewerkt, nooit stilzwijgend overschreven — je ziet
                per rij wat er gebeurde.
              </p>
            </div>
          </form>
        </Card>
      )}

      {confirmState.summary && (
        <Card>
          <CardHeader title="3 · Klaar" />
          <p className="p-5 text-sm text-ink-800">{confirmState.summary}</p>
        </Card>
      )}
    </div>
  )
}
