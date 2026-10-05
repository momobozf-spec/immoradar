'use server'

import { revalidatePath } from 'next/cache'

import { agencyCreateSchema, subscriptionInputSchema } from '@/domain/schemas'
import { requirePlatformAdmin } from '@/lib/session'
import * as userService from '@/services/userService'

/**
 * Platformbeheer: kantoren aanmaken, (de)activeren en het abonnement instellen.
 *
 * Geen enkele actie hier leest of toont data uit het klantenbestand van een
 * kantoor. Een platformbeheerder beheert de rij, niet de inhoud.
 */

export interface PlatformState {
  error: string | null
  ok: boolean
  /** Eenmalig te tonen tijdelijk wachtwoord van de nieuwe kantoorbeheerder. */
  issued: { email: string; temporaryPassword: string } | null
}

const EMPTY: PlatformState = { error: null, ok: false, issued: null }

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' ? value : undefined
}

export async function createAgency(
  _state: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requirePlatformAdmin()

  const parsed = agencyCreateSchema.safeParse({
    name: text(formData, 'name'),
    slug: text(formData, 'slug'),
    contactEmail: text(formData, 'contactEmail'),
    plan: text(formData, 'plan'),
    maxOpportunitiesPerDay: text(formData, 'maxOpportunitiesPerDay'),
    adminEmail: text(formData, 'adminEmail'),
    adminName: text(formData, 'adminName'),
  })
  if (!parsed.success) {
    return { ...EMPTY, error: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' }
  }

  const result = await userService.createAgency(session.userId, parsed.data)
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/admin/agencies')
  return {
    error: null,
    ok: true,
    issued: { email: result.adminEmail, temporaryPassword: result.temporaryPassword },
  }
}

export async function setAgencyActive(
  _state: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requirePlatformAdmin()

  const result = await userService.setAgencyActive(
    session.userId,
    String(formData.get('agencyId') ?? ''),
    formData.get('active') === 'true',
  )
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/admin/agencies')
  return { ...EMPTY, ok: true }
}

export async function updateSubscription(
  _state: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requirePlatformAdmin()

  const parsed = subscriptionInputSchema.safeParse({
    plan: text(formData, 'plan'),
    status: text(formData, 'status'),
    maxOpportunitiesPerDay: text(formData, 'maxOpportunitiesPerDay'),
    endsAt: text(formData, 'endsAt'),
  })
  if (!parsed.success) {
    return { ...EMPTY, error: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' }
  }

  const result = await userService.updateSubscription(
    session.userId,
    String(formData.get('agencyId') ?? ''),
    parsed.data,
  )
  if (!result.ok) return { ...EMPTY, error: result.error }

  revalidatePath('/admin/agencies')
  return { ...EMPTY, ok: true }
}
