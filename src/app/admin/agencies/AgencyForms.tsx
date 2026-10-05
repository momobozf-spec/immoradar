'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  createAgency,
  setAgencyActive,
  updateSubscription,
  type PlatformState,
} from '../../_actions/platform'
import { IssuedPassword } from '../../_components/IssuedPassword'
import {
  Card,
  CardHeader,
  ErrorNote,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../_components/primitives'

const INITIAL: PlatformState = { error: null, ok: false, issued: null }

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

function Field({
  id,
  label,
  children,
  hint,
}: {
  readonly id: string
  readonly label: string
  readonly children: React.ReactNode
  readonly hint?: string
}) {
  return (
    <div>
      <label htmlFor={id} className={labelStyles}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-ink-600">{hint}</p>}
    </div>
  )
}

/** "Immo Example Gent" → "immo-example-gent". Alleen een voorstel; het veld blijft bewerkbaar. */
function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function CreateAgencyForm() {
  const [state, formAction] = useActionState<PlatformState, FormData>(createAgency, INITIAL)
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  return (
    <Card>
      <CardHeader
        title="Nieuw kantoor"
        description="Maakt het kantoor, zijn abonnement en de eerste kantoorbeheerder in één keer aan. De beheerder voegt daarna zelf collega's toe."
      />
      <form action={formAction} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <Field id="agency-name" label="Naam kantoor">
          <input
            id="agency-name"
            name="name"
            required
            className={inputStyles}
            onChange={(event) => {
              if (!slugTouched) setSlug(suggestSlug(event.target.value))
            }}
          />
        </Field>
        <Field id="agency-slug" label="Korte naam" hint="Kleine letters, cijfers en koppeltekens. Niet meer te wijzigen.">
          <input
            id="agency-slug"
            name="slug"
            required
            value={slug}
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(event.target.value)
            }}
            className={inputStyles}
          />
        </Field>
        <Field id="agency-contact" label="Contactadres kantoor">
          <input id="agency-contact" name="contactEmail" type="email" className={inputStyles} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="agency-plan" label="Plan">
            <input id="agency-plan" name="plan" defaultValue="starter" required className={inputStyles} />
          </Field>
          <Field id="agency-max" label="Max. kansen/dag">
            <input
              id="agency-max"
              name="maxOpportunitiesPerDay"
              type="number"
              min={1}
              max={1000}
              defaultValue={50}
              required
              className={inputStyles}
            />
          </Field>
        </div>
        <Field id="admin-email" label="E-mail kantoorbeheerder">
          <input id="admin-email" name="adminEmail" type="email" required autoComplete="off" className={inputStyles} />
        </Field>
        <Field id="admin-name" label="Naam kantoorbeheerder">
          <input id="admin-name" name="adminName" autoComplete="off" className={inputStyles} />
        </Field>

        <div className="sm:col-span-2">
          <Submit label="Kantoor aanmaken" pendingLabel="Aanmaken…" />
        </div>

        <div className="space-y-2 sm:col-span-2">
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

/** Abonnement en status van één kantoor, uitklapbaar in de tabelrij. */
export function AgencyControls({
  agencyId,
  active,
  subscription,
}: {
  readonly agencyId: string
  readonly active: boolean
  readonly subscription: {
    plan: string
    status: 'ACTIVE' | 'PAUSED' | 'CANCELLED'
    maxOpportunitiesPerDay: number
    endsAt: string | null
  } | null
}) {
  const [subState, subAction] = useActionState<PlatformState, FormData>(updateSubscription, INITIAL)
  const [activeState, activeAction] = useActionState<PlatformState, FormData>(setAgencyActive, INITIAL)

  return (
    <details className="text-left">
      <summary className="cursor-pointer text-sm text-brand-700 hover:underline">Beheren</summary>

      <div className="mt-3 w-80 space-y-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
        <form action={subAction} className="space-y-2">
          <input type="hidden" name="agencyId" value={agencyId} />
          <div className="grid grid-cols-2 gap-2">
            <Field id={`plan-${agencyId}`} label="Plan">
              <input
                id={`plan-${agencyId}`}
                name="plan"
                defaultValue={subscription?.plan ?? 'starter'}
                required
                className={inputStyles}
              />
            </Field>
            <Field id={`status-${agencyId}`} label="Status">
              <select
                id={`status-${agencyId}`}
                name="status"
                defaultValue={subscription?.status ?? 'ACTIVE'}
                className={inputStyles}
              >
                <option value="ACTIVE">Actief</option>
                <option value="PAUSED">Gepauzeerd</option>
                <option value="CANCELLED">Opgezegd</option>
              </select>
            </Field>
            <Field id={`max-${agencyId}`} label="Kansen/dag">
              <input
                id={`max-${agencyId}`}
                name="maxOpportunitiesPerDay"
                type="number"
                min={1}
                max={1000}
                defaultValue={subscription?.maxOpportunitiesPerDay ?? 50}
                required
                className={inputStyles}
              />
            </Field>
            <Field id={`ends-${agencyId}`} label="Loopt tot">
              <input
                id={`ends-${agencyId}`}
                name="endsAt"
                type="date"
                defaultValue={subscription?.endsAt ?? ''}
                className={inputStyles}
              />
            </Field>
          </div>
          <Submit label="Abonnement opslaan" pendingLabel="Opslaan…" variant="secondary" />
          {subState.error && <ErrorNote>{subState.error}</ErrorNote>}
          {subState.ok && <p className="text-xs text-positive">Opgeslagen.</p>}
        </form>

        <form action={activeAction} className="border-t border-ink-200 pt-3">
          <input type="hidden" name="agencyId" value={agencyId} />
          <input type="hidden" name="active" value={active ? 'false' : 'true'} />
          <Submit
            label={active ? 'Kantoor deactiveren' : 'Kantoor heractiveren'}
            pendingLabel="Bezig…"
            variant={active ? 'danger' : 'secondary'}
          />
          <p className="mt-1 text-xs text-ink-600">
            {active
              ? 'Gebruikers verliezen meteen de toegang; data blijft bewaard.'
              : 'Gebruikers krijgen hun toegang terug.'}
          </p>
          {activeState.error && <ErrorNote>{activeState.error}</ErrorNote>}
        </form>
      </div>
    </details>
  )
}
