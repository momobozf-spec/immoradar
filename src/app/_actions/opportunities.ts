'use server'

import { revalidatePath } from 'next/cache'

import { opportunityActionSchema } from '@/domain/schemas'
import { addDays } from '@/lib/dates'
import { requireAgencyScope } from '@/lib/session'
import * as opportunityRepository from '@/repositories/opportunityRepository'
import * as userRepository from '@/repositories/userRepository'
import { recordAudit } from '@/services/auditService'

/**
 * De acties op de opportunitykaart.
 *
 * ─── DE TENANTGRENS LIGT ÉÉN LAAG DIEPER ─────────────────────────────────────
 *
 * Elke actie begint met `requireAgencyScope()` en geeft het `agencyId` door aan
 * de repository, die het in de `where` van zijn queries zet. Twee sloten: de
 * sessie bepaalt namens welk kantoor je handelt, en de query weigert rijen van
 * een ander kantoor aan te raken. Zou alleen het eerste slot er zijn, dan
 * volstaat een geraden id uit een URL om de status van andermans kans te
 * wijzigen.
 *
 * De repository geeft `false` terug wanneer de kans niet van dit kantoor is. Dat
 * wordt hier een nette melding en geen technische fout: de gebruiker heeft een
 * verlopen link, niet een defect.
 */

export interface ActionState {
  error: string | null
  ok: boolean
}

export async function applyOpportunityAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const scope = await requireAgencyScope()

  const raw = {
    opportunityId: formData.get('opportunityId'),
    action: formData.get('action'),
    status: formData.get('status') ?? undefined,
    snoozeDays: formData.get('snoozeDays') ?? undefined,
    assignedUserId: formData.get('assignedUserId') ?? undefined,
    note: formData.get('note') ?? undefined,
  }

  const parsed = opportunityActionSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: 'Deze actie kon niet worden verwerkt.', ok: false }
  }

  const { opportunityId, action, status, snoozeDays, assignedUserId, note } = parsed.data

  let applied = false

  switch (action) {
    case 'status': {
      if (!status) return { error: 'Geen status opgegeven.', ok: false }
      applied = await opportunityRepository.applyOpportunityAction({
        agencyId: scope.agencyId,
        opportunityId,
        userId: scope.userId,
        status,
        note: note ?? null,
        kind: 'status_change',
      })
      break
    }

    case 'snooze': {
      applied = await opportunityRepository.applyOpportunityAction({
        agencyId: scope.agencyId,
        opportunityId,
        userId: scope.userId,
        snoozedUntil: addDays(new Date(), snoozeDays ?? 7),
        note: note ?? null,
        kind: 'snoozed',
      })
      break
    }

    case 'assign': {
      // Het id komt uit het formulier: alleen een actieve collega van dít kantoor
      // mag een kans toegewezen krijgen.
      const assignee = assignedUserId ?? scope.userId
      if (!(await userRepository.isActiveTeamMember(scope.agencyId, assignee))) {
        return { error: 'Deze collega bestaat niet (meer) in jouw kantoor.', ok: false }
      }

      applied = await opportunityRepository.applyOpportunityAction({
        agencyId: scope.agencyId,
        opportunityId,
        userId: scope.userId,
        // Toewijzen zet de kans meteen op ASSIGNED: hij ligt nu bij iemand, en
        // dat is een andere toestand dan "nieuw en van niemand".
        status: 'ASSIGNED',
        assignedUserId: assignee,
        note: note ?? null,
        kind: 'assigned',
      })
      break
    }

    case 'note': {
      applied = await opportunityRepository.applyOpportunityAction({
        agencyId: scope.agencyId,
        opportunityId,
        userId: scope.userId,
        note: note ?? null,
        kind: 'note',
      })
      break
    }
  }

  if (!applied) {
    return { error: 'Deze kans bestaat niet of hoort bij een ander kantoor.', ok: false }
  }

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: `opportunity.${action}${status ? `.${status}` : ''}`,
    entityType: 'Opportunity',
    entityId: opportunityId,
  })

  revalidatePath('/')
  revalidatePath('/pipeline')
  revalidatePath('/leadrevive')
  revalidatePath(`/opportunities/${opportunityId}`)

  return { error: null, ok: true }
}
