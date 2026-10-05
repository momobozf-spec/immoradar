'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { saveAgencySettings, type SettingsState } from '../../_actions/settings'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../_components/primitives'

const INITIAL: SettingsState = { error: null, ok: false }

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles.primary} disabled={pending}>
      {pending ? 'Opslaan…' : 'Opslaan'}
    </button>
  )
}

export function AgencySettingsForm({
  contactEmail,
  telegramChatId,
}: {
  readonly contactEmail: string
  readonly telegramChatId: string
}) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    saveAgencySettings,
    INITIAL,
  )

  return (
    <Card>
      <CardHeader title="Kantoorgegevens" />
      <form action={formAction} className="space-y-3 p-5">
        <div>
          <label htmlFor="contactEmail" className={labelStyles}>
            Contactadres
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={contactEmail}
            className={`${inputStyles} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="telegramChatId" className={labelStyles}>
            Telegram-chat
          </label>
          <input
            id="telegramChatId"
            name="telegramChatId"
            defaultValue={telegramChatId}
            placeholder="-1001234567890"
            className={`${inputStyles} mt-1`}
          />
          <p className="mt-1 text-xs text-ink-600">
            De chat waarin meldingen belanden, tenzij een regel er zelf een opgeeft.
          </p>
        </div>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}
        {state.ok && <p className="text-sm text-positive">Opgeslagen.</p>}

        <Submit />
      </form>
    </Card>
  )
}
