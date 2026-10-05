'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { applyOpportunityAction, type ActionState } from '../_actions/opportunities'
import { buttonStyles } from '../_components/primitives'

/**
 * De knoppenrij onder een kans.
 *
 * ─── WAAROM ELKE KNOP EEN EIGEN FORMULIER IS ─────────────────────────────────
 *
 * Eén formulier met vijf submitknoppen zou minder markup zijn, maar dan deelt
 * elke knop dezelfde `pending`-toestand: klik je op "Gecontacteerd", dan gaan
 * ook "Snooze" en "Wegleggen" op grijs. Op een scherm waar iemand tien kansen
 * achter elkaar afhandelt is dat het verschil tussen soepel en hokkerig.
 */

function ActionButton({
  label,
  variant = 'secondary',
  title,
}: {
  readonly label: string
  readonly variant?: keyof typeof buttonStyles
  readonly title?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button type="submit" title={title} className={buttonStyles[variant]} disabled={pending}>
      {pending ? '…' : label}
    </button>
  )
}

const INITIAL: ActionState = { error: null, ok: false }

export function OpportunityActions({
  opportunityId,
  status,
  compact = false,
}: {
  readonly opportunityId: string
  readonly status: string
  readonly compact?: boolean
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    applyOpportunityAction,
    INITIAL,
  )

  const isClosed = ['MANDATE_WON', 'LOST', 'DISMISSED'].includes(status)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isClosed ? (
        <form action={formAction}>
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="action" value="status" />
          <input type="hidden" name="status" value="NEW" />
          <ActionButton label="Heropenen" />
        </form>
      ) : (
        <>
          <form action={formAction}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <input type="hidden" name="action" value="assign" />
            <ActionButton label="Aan mij" title="Wijs deze kans aan jezelf toe" />
          </form>

          <form action={formAction}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <input type="hidden" name="action" value="status" />
            <input type="hidden" name="status" value="CONTACTED" />
            <ActionButton label="Gecontacteerd" variant="primary" />
          </form>

          {!compact && (
            <form action={formAction}>
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <input type="hidden" name="action" value="snooze" />
              <input type="hidden" name="snoozeDays" value="7" />
              <ActionButton label="Snooze 7d" title="Verberg deze kans een week" />
            </form>
          )}

          <form action={formAction}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <input type="hidden" name="action" value="status" />
            <input type="hidden" name="status" value="DISMISSED" />
            <ActionButton label="Wegleggen" variant="ghost" />
          </form>
        </>
      )}

      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </div>
  )
}
