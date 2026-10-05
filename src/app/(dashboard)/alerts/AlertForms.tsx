'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { OPPORTUNITY_TYPES } from '@/domain/schemas'
import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'

import { removeAlertRule, saveAlertRule, type SettingsState } from '../../_actions/settings'
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
 * Een nieuwe meldingsregel.
 *
 * De stiltevensters staan er niet voor de sier. Een makelaar die om 03:12 een
 * melding krijgt over een lead, zet de meldingen de volgende ochtend uit — en
 * dan levert het product niets meer op, hoe goed de detectie ook is.
 */
export function AlertRuleForm() {
  const [state, formAction] = useActionState<SettingsState, FormData>(saveAlertRule, INITIAL)
  const [kind, setKind] = useState<'REALTIME' | 'DIGEST'>('REALTIME')

  return (
    <Card>
      <CardHeader title="Regel toevoegen" />
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
            placeholder="Hete kansen"
            className={`${inputStyles} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="kind" className={labelStyles}>
            Soort
          </label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as 'REALTIME' | 'DIGEST')}
            className={`${inputStyles} mt-1`}
          >
            <option value="REALTIME">Direct bij een nieuwe kans</option>
            <option value="DIGEST">Eén samenvatting per dag</option>
          </select>
        </div>

        <div>
          <label htmlFor="minScore" className={labelStyles}>
            Vanaf score
          </label>
          <input
            id="minScore"
            name="minScore"
            type="number"
            min={0}
            max={100}
            defaultValue={75}
            className={`${inputStyles} mt-1`}
          />
        </div>

        {kind === 'DIGEST' ? (
          <div>
            <label htmlFor="digestHour" className={labelStyles}>
              Verzenduur (Europe/Brussels)
            </label>
            <input
              id="digestHour"
              name="digestHour"
              type="number"
              min={0}
              max={23}
              defaultValue={7}
              className={`${inputStyles} mt-1`}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quietHoursStart" className={labelStyles}>
                Stil vanaf
              </label>
              <input
                id="quietHoursStart"
                name="quietHoursStart"
                type="number"
                min={0}
                max={23}
                defaultValue={22}
                className={`${inputStyles} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="quietHoursEnd" className={labelStyles}>
                Stil tot
              </label>
              <input
                id="quietHoursEnd"
                name="quietHoursEnd"
                type="number"
                min={0}
                max={23}
                defaultValue={7}
                className={`${inputStyles} mt-1`}
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="telegramChatId" className={labelStyles}>
            Telegram-chat (optioneel)
          </label>
          <input
            id="telegramChatId"
            name="telegramChatId"
            maxLength={64}
            placeholder="Leeg = de chat van het kantoor"
            className={`${inputStyles} mt-1`}
          />
        </div>

        <fieldset>
          <legend className={labelStyles}>Alleen deze types (leeg = alles)</legend>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-ink-200 p-2">
            {OPPORTUNITY_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-ink-800">
                <input
                  type="checkbox"
                  name="types"
                  value={type}
                  className="rounded border-ink-300"
                />
                {OPPORTUNITY_TYPE_LABELS[type as OpportunityTypeValue] ?? type}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" name="requireCrmMatch" className="rounded border-ink-300" />
          Alleen kansen met een bekende relatie
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" name="enabled" defaultChecked className="rounded border-ink-300" />
          Regel actief
        </label>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}

        <Submit label="Regel opslaan" />
      </form>
    </Card>
  )
}

export function DeleteRuleButton({ ruleId }: { readonly ruleId: string }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(removeAlertRule, INITIAL)

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="ruleId" value={ruleId} />
      <Submit label="Verwijderen" variant="danger" />
      {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </form>
  )
}
