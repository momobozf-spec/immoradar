'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { changePassword, signOutEverywhere, type AccountState } from '../_actions/auth'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../_components/primitives'

const INITIAL: AccountState = { error: null, ok: false }

function Submit({ label, pendingLabel }: { readonly label: string; readonly pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles.primary} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  )
}

export function ChangePasswordForm({ minLength }: { readonly minLength: number }) {
  const [state, formAction] = useActionState<AccountState, FormData>(changePassword, INITIAL)

  return (
    <Card>
      <CardHeader
        title="Wachtwoord wijzigen"
        description={`Minstens ${minLength} tekens. Een zin van een paar woorden is sterker dan een kort wachtwoord met tekens.`}
      />
      <form action={formAction} className="space-y-3 p-5">
        <div>
          <label htmlFor="current" className={labelStyles}>
            Huidig wachtwoord
          </label>
          <input
            id="current"
            name="current"
            type="password"
            autoComplete="current-password"
            required
            className={`${inputStyles} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="next" className={labelStyles}>
            Nieuw wachtwoord
          </label>
          <input
            id="next"
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={minLength}
            required
            className={`${inputStyles} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className={labelStyles}>
            Nieuw wachtwoord, nog eens
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={minLength}
            required
            className={`${inputStyles} mt-1`}
          />
        </div>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}
        {state.ok && (
          <p className="text-sm text-positive">
            Wachtwoord gewijzigd. Je andere sessies zijn afgemeld.
          </p>
        )}

        <Submit label="Wachtwoord opslaan" pendingLabel="Opslaan…" />
      </form>
    </Card>
  )
}

export function SignOutEverywhereForm() {
  return (
    <Card>
      <CardHeader
        title="Overal afmelden"
        description="Meldt je af op elk toestel waarop je ingelogd bent, ook hier. Gebruik dit als je een toestel kwijt bent of op een gedeelde computer vergat uit te loggen."
      />
      <form action={signOutEverywhere} className="p-5">
        <Submit label="Overal afmelden" pendingLabel="Bezig…" />
      </form>
    </Card>
  )
}
