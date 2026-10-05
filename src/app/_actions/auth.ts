'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { loginSchema } from '@/domain/schemas'
import { pickClientIp } from '@/lib/clientIp'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import {
  clearSessionCookie,
  getSession,
  issueSessionToken,
  setSessionCookie,
} from '@/lib/session'
import { recordAudit } from '@/services/auditService'
import * as userService from '@/services/userService'

const logger = createLogger({ component: 'auth' })

export interface LoginState {
  error: string | null
}

/**
 * Het IP-adres van de bezoeker, voor de rate limiter en de audittrail.
 *
 * Een proxy vóór de app voegt het adres dat hém aansprak rechts toe aan
 * `X-Forwarded-For`. Alles links daarvan stuurde de bezoeker zelf mee en is dus
 * te vervalsen: wie daar elke keer iets anders invult, krijgt anders bij elke
 * poging een vers tellertje — of blokkeert met het IP van een kantoor iedereen
 * op dat kantoor. Daarom tellen we `TRUSTED_PROXY_HOPS` adressen van rechts.
 */
async function clientIp(): Promise<string> {
  return pickClientIp((await headers()).get('x-forwarded-for'), getEnv().TRUSTED_PROXY_HOPS)
}

/**
 * Inloggen.
 *
 * De volledige controle (vergrendeling, tijdsgelijke vergelijking, één melding
 * voor elke mislukking) staat in `userService.authenticate`. Deze actie geeft
 * alleen het cookie uit en stuurt door.
 */
export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: 'Vul een geldig e-mailadres en wachtwoord in.' }
  }

  const ip = await clientIp()
  const result = await userService.authenticate(parsed.data.email, parsed.data.password, ip)

  if (!result.ok) return { error: result.error }

  const { user } = result

  await setSessionCookie(
    issueSessionToken({
      userId: user.id,
      agencyId: user.agencyId,
      role: user.role,
      sessionVersion: user.sessionVersion,
    }),
  )

  await recordAudit({
    actor: user.email,
    agencyId: user.agencyId,
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
    ip,
  })

  redirect(user.role === 'PLATFORM_ADMIN' ? '/admin/sources' : '/')
}

export async function logout(): Promise<void> {
  const session = await getSession()

  if (session) {
    await recordAudit({
      actor: session.email,
      agencyId: session.agencyId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: session.userId,
    })
  }

  await clearSessionCookie()
  redirect('/login')
}

// ─────────────────────────────────────────────────────────────────────────────
// Eigen account
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountState {
  error: string | null
  ok: boolean
}

/**
 * Het eigen wachtwoord wijzigen.
 *
 * Na de wijziging zijn alle andere sessies van deze gebruiker ongeldig. De
 * huidige krijgt meteen een nieuw cookie met de nieuwe versie, zodat de
 * gebruiker zelf niet opnieuw hoeft in te loggen.
 */
export async function changePassword(
  _state: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await getSession()
  if (!session) redirect('/login')

  const result = await userService.changeOwnPassword(session.userId, {
    current: String(formData.get('current') ?? ''),
    next: String(formData.get('next') ?? ''),
    confirm: String(formData.get('confirm') ?? ''),
  })

  if (!result.ok) return { error: result.error, ok: false }

  await setSessionCookie(
    issueSessionToken({
      userId: session.userId,
      agencyId: session.agencyId,
      role: session.role,
      sessionVersion: result.sessionVersion,
    }),
  )

  logger.info('Wachtwoord gewijzigd', { userId: session.userId })

  // Wie hier kwam met een tijdelijk wachtwoord, mag nu door naar zijn werk.
  if (session.mustChangePassword) {
    redirect(session.role === 'PLATFORM_ADMIN' ? '/admin/sources' : '/')
  }

  return { error: null, ok: true }
}

/** Alle sessies van deze gebruiker beëindigen, ook deze. */
export async function signOutEverywhere(): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  await userService.signOutEverywhere(session.userId)
  await clearSessionCookie()
  redirect('/login')
}
