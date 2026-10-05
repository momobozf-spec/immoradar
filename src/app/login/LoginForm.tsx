'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { login, type LoginState } from '../_actions/auth'
import { buttonStyles, ErrorNote, inputStyles, labelStyles } from '../_components/primitives'

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button type="submit" className={`${buttonStyles.primary} w-full`} disabled={pending}>
      {pending ? 'Bezig…' : 'Inloggen'}
    </button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, { error: null })

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelStyles}>
          E-mailadres
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className={`${inputStyles} mt-1`}
        />
      </div>

      <div>
        <label htmlFor="password" className={labelStyles}>
          Wachtwoord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${inputStyles} mt-1`}
        />
      </div>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}

      <SubmitButton />
    </form>
  )
}
