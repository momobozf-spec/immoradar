'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  addMember,
  changeRole,
  resetPassword,
  toggleActive,
  type TeamState,
} from '../../_actions/team'
import { IssuedPassword } from '../../_components/IssuedPassword'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../_components/primitives'

const INITIAL: TeamState = { error: null, issued: null, ok: false }

function Submit({
  label,
  pendingLabel,
  variant = 'primary',
}: {
  readonly label: string
  readonly pendingLabel: string
  readonly variant?: keyof typeof buttonStyles
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles[variant]} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  )
}

export function AddMemberForm() {
  const [state, formAction] = useActionState<TeamState, FormData>(addMember, INITIAL)

  return (
    <Card>
      <CardHeader
        title="Collega toevoegen"
        description="De nieuwe gebruiker krijgt een tijdelijk wachtwoord dat bij de eerste login vervangen moet worden."
      />
      <form action={formAction} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <div>
          <label htmlFor="member-email" className={labelStyles}>
            E-mailadres
          </label>
          <input
            id="member-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className={`${inputStyles} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="member-name" className={labelStyles}>
            Naam
          </label>
          <input id="member-name" name="name" autoComplete="off" className={`${inputStyles} mt-1`} />
        </div>
        <div>
          <label htmlFor="member-role" className={labelStyles}>
            Rol
          </label>
          <select id="member-role" name="role" defaultValue="AGENT" className={`${inputStyles} mt-1`}>
            <option value="AGENT">Makelaar — volgt kansen op</option>
            <option value="AGENCY_ADMIN">Kantoorbeheerder — beheert ook gebieden, meldingen en team</option>
          </select>
        </div>
        <div className="flex items-end">
          <Submit label="Toevoegen" pendingLabel="Toevoegen…" />
        </div>

        <div className="sm:col-span-2">
          {state.error && <ErrorNote>{state.error}</ErrorNote>}
          {state.issued && (
            <IssuedPassword
              email={state.issued.email}
              temporaryPassword={state.issued.temporaryPassword}
            />
          )}
        </div>
      </form>
    </Card>
  )
}

/**
 * De knoppen op één rij van de teamtabel.
 *
 * Elke knop is een eigen formulier met het `userId` als verborgen veld. Dat id
 * komt uit de pagina, maar de server vertrouwt het niet blind: hij zoekt het op
 * binnen het kantoor uit de sessie.
 */
export function MemberActions({
  userId,
  role,
  active,
  isSelf,
}: {
  readonly userId: string
  readonly role: 'AGENCY_ADMIN' | 'AGENT' | 'PLATFORM_ADMIN'
  readonly active: boolean
  readonly isSelf: boolean
}) {
  const [resetState, resetAction] = useActionState<TeamState, FormData>(resetPassword, INITIAL)
  const [activeState, activeAction] = useActionState<TeamState, FormData>(toggleActive, INITIAL)
  const [roleState, roleAction] = useActionState<TeamState, FormData>(changeRole, INITIAL)

  if (isSelf) {
    return <span className="text-xs text-ink-600">Dit ben jij</span>
  }

  const error = resetState.error ?? activeState.error ?? roleState.error

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        {active && (
          <form action={roleAction}>
            <input type="hidden" name="userId" value={userId} />
            <input
              type="hidden"
              name="role"
              value={role === 'AGENCY_ADMIN' ? 'AGENT' : 'AGENCY_ADMIN'}
            />
            <Submit
              label={role === 'AGENCY_ADMIN' ? 'Maak makelaar' : 'Maak beheerder'}
              pendingLabel="Bezig…"
              variant="ghost"
            />
          </form>
        )}

        {active && (
          <form action={resetAction}>
            <input type="hidden" name="userId" value={userId} />
            <Submit label="Nieuw wachtwoord" pendingLabel="Bezig…" variant="secondary" />
          </form>
        )}

        <form action={activeAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? 'false' : 'true'} />
          <Submit
            label={active ? 'Deactiveren' : 'Heractiveren'}
            pendingLabel="Bezig…"
            variant={active ? 'danger' : 'secondary'}
          />
        </form>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {resetState.issued && (
        <IssuedPassword
          email={resetState.issued.email}
          temporaryPassword={resetState.issued.temporaryPassword}
        />
      )}
    </div>
  )
}
