'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { applyOpportunityAction, type ActionState } from '../../../_actions/opportunities'
import {
  Card,
  CardHeader,
  buttonStyles,
  inputStyles,
  labelStyles,
} from '../../../_components/primitives'

/**
 * Toewijzen en een notitie achterlaten.
 *
 * De twee staan samen omdat ze bij elkaar horen in de praktijk: wie een lead
 * doorgeeft, zegt er iets bij. Ze scheiden zou betekenen dat de notitie zonder
 * context in de activiteitenlijst belandt.
 */

const INITIAL: ActionState = { error: null, ok: false }

function Submit({ label }: { readonly label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={buttonStyles.secondary} disabled={pending}>
      {pending ? 'Bezig…' : label}
    </button>
  )
}

export function AssignPanel({
  opportunityId,
  currentUserId,
  colleagues,
}: {
  readonly opportunityId: string
  readonly currentUserId: string | null
  readonly colleagues: readonly { id: string; name: string }[]
}) {
  const [assignState, assignAction] = useActionState<ActionState, FormData>(
    applyOpportunityAction,
    INITIAL,
  )
  const [noteState, noteAction] = useActionState<ActionState, FormData>(
    applyOpportunityAction,
    INITIAL,
  )

  return (
    <Card>
      <CardHeader title="Toewijzen en notitie" />

      <form action={assignAction} className="space-y-2 p-5">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input type="hidden" name="action" value="assign" />

        <label htmlFor="assignedUserId" className={labelStyles}>
          Behandeld door
        </label>
        <select
          id="assignedUserId"
          name="assignedUserId"
          defaultValue={currentUserId ?? ''}
          className={inputStyles}
        >
          <option value="">— niemand —</option>
          {colleagues.map((colleague) => (
            <option key={colleague.id} value={colleague.id}>
              {colleague.name}
            </option>
          ))}
        </select>

        <Submit label="Toewijzen" />
        {assignState.error && <p className="text-xs text-danger">{assignState.error}</p>}
      </form>

      <form action={noteAction} className="space-y-2 border-t border-ink-200 p-5">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input type="hidden" name="action" value="note" />

        <label htmlFor="note" className={labelStyles}>
          Notitie
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="Wat is er besproken?"
          className={inputStyles}
        />

        <Submit label="Notitie opslaan" />
        {noteState.error && <p className="text-xs text-danger">{noteState.error}</p>}
      </form>
    </Card>
  )
}
