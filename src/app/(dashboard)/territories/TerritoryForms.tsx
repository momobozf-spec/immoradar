'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  createTerritory,
  removeTerritory,
  type SettingsState,
} from '../../_actions/settings'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../_components/primitives'

const INITIAL: SettingsState = { error: null, ok: false }

function Submit({ label, variant = 'primary' }: { readonly label: string; readonly variant?: keyof typeof buttonStyles }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles[variant]} disabled={pending}>
      {pending ? '…' : label}
    </button>
  )
}

/**
 * Nieuw gebied toevoegen.
 *
 * Eén vrij tekstveld voor de waarden in plaats van een rij invoervakjes: een
 * kantoor plakt zijn postcodes uit een e-mail of een spreadsheet, in welke
 * scheiding dan ook. Het schema splitst op komma's, puntkomma's, regeleindes en
 * spaties — zie `territoryInputSchema`.
 */
export function TerritoryForm() {
  const [state, formAction] = useActionState<SettingsState, FormData>(createTerritory, INITIAL)

  return (
    <Card>
      <CardHeader title="Gebied toevoegen" />
      <form action={formAction} className="space-y-3 p-5">
        <div>
          <label htmlFor="name" className={labelStyles}>
            Naam
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={80}
            placeholder="Gent-Noord"
            className={`${inputStyles} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="kind" className={labelStyles}>
            Soort
          </label>
          <select id="kind" name="kind" defaultValue="POSTAL_CODE" className={`${inputStyles} mt-1`}>
            <option value="POSTAL_CODE">Postcodes</option>
            <option value="MUNICIPALITY">Gemeenten</option>
            <option value="PROVINCE">Provincies</option>
          </select>
        </div>

        <div>
          <label htmlFor="values" className={labelStyles}>
            Waarden
          </label>
          <textarea
            id="values"
            name="values"
            required
            rows={3}
            placeholder="9000, 9030, 9040, 9050"
            className={`${inputStyles} mt-1`}
          />
          <p className="mt-1 text-xs text-ink-600">
            Gescheiden door komma&apos;s, spaties of regeleindes — het maakt niet uit.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" name="active" defaultChecked className="rounded border-ink-300" />
          Meteen actief
        </label>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}

        <Submit label="Gebied toevoegen" />
      </form>
    </Card>
  )
}

/** Verwijderknop per rij. */
export function TerritoryRow({ territoryId }: { readonly territoryId: string }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(removeTerritory, INITIAL)

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="territoryId" value={territoryId} />
      <Submit label="Verwijderen" variant="danger" />
      {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </form>
  )
}
