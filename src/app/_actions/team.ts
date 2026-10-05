'use server'

import { revalidatePath } from 'next/cache'

import { TEAM_ROLES, teamMemberInputSchema } from '@/domain/schemas'
import { requireAgencyAdmin } from '@/lib/session'
import * as userService from '@/services/userService'

/**
 * Teambeheer binnen één kantoor.
 *
 * Alleen een kantoorbeheerder; het kantoor komt uit de sessie. Elke wijziging
 * op een gebruiker draagt het `agencyId` mee tot in de `where`, zodat een id
 * van een ander kantoor in een formulier niets raakt.
 */

export interface TeamState {
  error: string | null
  /** Eenmalig te tonen tijdelijk wachtwoord, met het adres waarvoor het geldt. */
  issued: { email: string; temporaryPassword: string } | null
  ok: boolean
}

const EMPTY: TeamState = { error: null, issued: null, ok: false }

export async function addMember(_state: TeamState, formData: FormData): Promise<TeamState> {
  const scope = await requireAgencyAdmin()

  const parsed = teamMemberInputSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name') ?? undefined,
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { ...EMPTY, error: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' }
  }

  const result = await userService.addTeamMember(scope, parsed.data)
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/team')
  return {
    error: null,
    ok: true,
    issued: { email: result.email, temporaryPassword: result.temporaryPassword },
  }
}

function userIdFrom(formData: FormData): string {
  return String(formData.get('userId') ?? '')
}

export async function resetPassword(_state: TeamState, formData: FormData): Promise<TeamState> {
  const scope = await requireAgencyAdmin()

  const result = await userService.resetTeamMemberPassword(scope, userIdFrom(formData))
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/team')
  return {
    error: null,
    ok: true,
    issued: { email: result.email, temporaryPassword: result.temporaryPassword },
  }
}

export async function toggleActive(_state: TeamState, formData: FormData): Promise<TeamState> {
  const scope = await requireAgencyAdmin()
  const active = formData.get('active') === 'true'

  const result = await userService.setTeamMemberActive(scope, userIdFrom(formData), active)
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/team')
  return { ...EMPTY, ok: true }
}

export async function changeRole(_state: TeamState, formData: FormData): Promise<TeamState> {
  const scope = await requireAgencyAdmin()

  const role = String(formData.get('role') ?? '')
  if (!(TEAM_ROLES as readonly string[]).includes(role)) {
    return { ...EMPTY, error: 'Onbekende rol.' }
  }

  const result = await userService.setTeamMemberRole(
    scope,
    userIdFrom(formData),
    role as (typeof TEAM_ROLES)[number],
  )
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/team')
  return { ...EMPTY, ok: true }
}
