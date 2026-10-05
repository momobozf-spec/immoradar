import {
  checkPassword,
  generateTemporaryPassword,
  isLocked,
  lockMinutesForCount,
  LOCKOUT_DECAY_MS,
  PASSWORD_PROBLEM_MESSAGES,
} from '@/domain/accountPolicy'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { hashPassword, verifyPassword } from '@/lib/password'
import { FixedWindowLimiter } from '@/lib/rateLimit'
import type { AgencyScope, Role } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as userRepository from '@/repositories/userRepository'
import { isUniqueViolation } from '@/repositories/prismaErrors'
import { recordAudit } from '@/services/auditService'

const logger = createLogger({ component: 'users' })

/**
 * Accounts: inloggen, wachtwoorden, teambeheer en het aanmaken van kantoren.
 *
 * ─── EEN UITKOMST, GEEN EXCEPTION ────────────────────────────────────────────
 *
 * Elke functie die een gebruiker iets laat doen, geeft `{ ok: true, ... }` of
 * `{ ok: false, error }` terug, met een foutmelding die zo op het scherm kan.
 * Een geweigerd wachtwoord of "je kunt de laatste beheerder niet verwijderen"
 * is geen fout in het systeem maar een antwoord aan de gebruiker.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** Een hash die gegarandeerd niet klopt, voor de tijdsgelijke controle bij een onbekend adres. */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * Eén melding voor elke mislukte login: onbekend adres, fout wachtwoord,
 * gedeactiveerd én vergrendeld account. Een aparte melding voor "vergrendeld"
 * zou verraden welke adressen een account hebben (alleen bestaande accounts
 * kunnen op slot gaan). De tweede zin vertelt een legitieme gebruiker wel dat
 * wachten kan helpen.
 */
export const GENERIC_LOGIN_ERROR =
  'Onjuiste combinatie van e-mailadres en wachtwoord. Na herhaalde mislukte pogingen wordt een account tijdelijk vergrendeld.'

let ipLimiter: FixedWindowLimiter | null = null

function limiterForIp(): FixedWindowLimiter {
  ipLimiter ??= new FixedWindowLimiter(getEnv().LOGIN_MAX_ATTEMPTS_PER_IP, 15 * 60_000)
  return ipLimiter
}

// ─────────────────────────────────────────────────────────────────────────────
// Inloggen
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
  agencyId: string | null
  sessionVersion: number
}

/** Telt een mislukte poging en legt een nieuwe vergrendeling vast in de audittrail. */
async function countFailure(user: { id: string; agencyId: string | null }, now: Date): Promise<void> {
  const env = getEnv()
  const policy = { maxAttempts: env.LOGIN_MAX_ATTEMPTS, lockMinutes: env.LOGIN_LOCK_MINUTES }

  const outcome = await userRepository.registerFailedLogin(
    user.id,
    (count) => lockMinutesForCount(count, policy),
    now,
    LOCKOUT_DECAY_MS,
  )

  if (outcome.newlyLocked && outcome.lockedUntil) {
    await recordAudit({
      actor: 'system',
      agencyId: user.agencyId,
      action: 'auth.locked',
      entityType: 'User',
      entityId: user.id,
      metadata: {
        failedLoginCount: outcome.failedLoginCount,
        lockedUntil: outcome.lockedUntil.toISOString(),
      },
    })
  }
}

/**
 * Controleert e-mail en wachtwoord.
 *
 * ─── WAT DE GEBRUIKER TE ZIEN KRIJGT ─────────────────────────────────────────
 *
 * Altijd dezelfde melding bij een mislukking (zie `GENERIC_LOGIN_ERROR`), en het
 * wachtwoord wordt ook bij een onbekend adres gecontroleerd zodat de reactietijd
 * niets verraadt.
 *
 * ─── GELIJKTIJDIGE POGINGEN ──────────────────────────────────────────────────
 *
 * De teller loopt atomair in de database op, en een geslaagde login wordt alleen
 * aanvaard als het account op dat moment níét vergrendeld is. Een salvo van
 * honderden parallelle pogingen zet dus nog steeds het slot, en een juist
 * wachtwoord dat binnenkomt nadat het slot viel, opent niets.
 */
export async function authenticate(
  email: string,
  password: string,
  ip: string,
): Promise<Result<{ user: AuthenticatedUser }>> {
  if (!limiterForIp().hit(ip)) {
    logger.warn('Inlogpogingen per IP overschreden', { ip })
    return { ok: false, error: 'Te veel inlogpogingen vanaf dit netwerk. Probeer het over een kwartier opnieuw.' }
  }

  const user = await agencyRepository.findUserByEmail(email)
  const now = new Date()

  if (user && isLocked(user, now)) {
    // Geen wachtwoordcontrole tijdens de vergrendeling: anders raadt een
    // aanvaller gewoon door. Wel dezelfde kosten als een gewone poging, zodat de
    // reactietijd het slot niet verraadt.
    await verifyPassword(password, DUMMY_HASH)
    logger.warn('Inlogpoging op vergrendeld account', { userId: user.id, ip })
    return { ok: false, error: GENERIC_LOGIN_ERROR }
  }

  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)

  if (!user || !valid || !user.active) {
    if (user && !valid) await countFailure(user, now)
    logger.warn('Mislukte inlogpoging', { email, ip })
    return { ok: false, error: GENERIC_LOGIN_ERROR }
  }

  if (user.role !== 'PLATFORM_ADMIN' && !user.agencyId) {
    logger.error('Gebruiker zonder kantoor', { userId: user.id, role: user.role })
    return { ok: false, error: 'Dit account is niet aan een kantoor gekoppeld. Neem contact op met beheer.' }
  }

  if (!(await userRepository.recordSuccessfulLogin(user.id, new Date()))) {
    // Juist wachtwoord, maar het slot viel terwijl scrypt rekende.
    logger.warn('Juist wachtwoord op intussen vergrendeld account', { userId: user.id, ip })
    return { ok: false, error: GENERIC_LOGIN_ERROR }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      agencyId: user.agencyId,
      sessionVersion: user.sessionVersion,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eigen account
// ─────────────────────────────────────────────────────────────────────────────

function passwordError(password: string, email: string): string | null {
  const problem = checkPassword(password, email)
  return problem ? PASSWORD_PROBLEM_MESSAGES[problem] : null
}

export async function changeOwnPassword(
  userId: string,
  input: { current: string; next: string; confirm: string },
): Promise<Result<{ sessionVersion: number }>> {
  const user = await userRepository.findOwnAccount(userId)
  if (!user || !user.active) return { ok: false, error: 'Je account is niet meer actief.' }

  // Dezelfde vergrendeling als bij het inloggen. Zonder dat kan wie een gestolen
  // sessiecookie heeft hier onbeperkt het huidige wachtwoord raden, en na een
  // treffer het account definitief overnemen.
  const now = new Date()
  if (isLocked(user, now)) {
    return {
      ok: false,
      error: 'Te veel foute pogingen. Je account is tijdelijk vergrendeld; probeer het later opnieuw.',
    }
  }

  if (!(await verifyPassword(input.current, user.passwordHash))) {
    await countFailure(user, now)
    return { ok: false, error: 'Je huidige wachtwoord klopt niet.' }
  }

  if (input.next !== input.confirm) {
    return { ok: false, error: 'De twee nieuwe wachtwoorden zijn niet gelijk.' }
  }

  if (input.next === input.current) {
    return { ok: false, error: 'Kies een ander wachtwoord dan je huidige.' }
  }

  const problem = passwordError(input.next, user.email)
  if (problem) return { ok: false, error: problem }

  const sessionVersion = await userRepository.setOwnPassword(userId, await hashPassword(input.next))

  await recordAudit({
    actor: user.email,
    agencyId: user.agencyId,
    action: 'auth.password_changed',
    entityType: 'User',
    entityId: user.id,
  })

  return { ok: true, sessionVersion }
}

export async function signOutEverywhere(userId: string): Promise<number> {
  const sessionVersion = await userRepository.revokeOwnSessions(userId)
  const user = await userRepository.findOwnAccount(userId)

  await recordAudit({
    actor: user?.email ?? userId,
    agencyId: user?.agencyId ?? null,
    action: 'auth.sessions_revoked',
    entityType: 'User',
    entityId: userId,
  })

  return sessionVersion
}

// ─────────────────────────────────────────────────────────────────────────────
// Team (kantoorbeheerder)
// ─────────────────────────────────────────────────────────────────────────────

type TeamRole = 'AGENCY_ADMIN' | 'AGENT'

async function actorEmail(userId: string): Promise<string> {
  const user = await userRepository.findOwnAccount(userId)
  return user?.email ?? userId
}

export async function addTeamMember(
  scope: AgencyScope,
  input: { email: string; name: string | null; role: TeamRole },
): Promise<Result<{ temporaryPassword: string; email: string }>> {
  if (await userRepository.emailExists(input.email)) {
    return { ok: false, error: 'Er bestaat al een account met dit e-mailadres.' }
  }

  const temporaryPassword = generateTemporaryPassword()

  try {
    const member = await userRepository.createTeamMember(scope.agencyId, {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(temporaryPassword),
    })

    await recordAudit({
      actor: await actorEmail(scope.userId),
      agencyId: scope.agencyId,
      action: 'team.member_added',
      entityType: 'User',
      entityId: member.id,
      metadata: { role: input.role },
    })

    return { ok: true, temporaryPassword, email: member.email }
  } catch (error) {
    // Twee beheerders die tegelijk hetzelfde adres toevoegen.
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'Er bestaat al een account met dit e-mailadres.' }
    }
    throw error
  }
}

const TEAM_OUTCOME_ERRORS = {
  not_found: 'Deze gebruiker hoort niet bij jouw kantoor.',
  last_admin: 'Dit is de laatste actieve beheerder van het kantoor.',
} as const

/**
 * Een kantoor zonder actieve beheerder kan niemand meer toevoegen, geen gebied
 * meer instellen en geen wachtwoord meer resetten. De controle daarop gebeurt
 * in dezelfde transactie als de wijziging (`updateTeamMemberGuarded`).
 */
export async function setTeamMemberActive(
  scope: AgencyScope,
  userId: string,
  active: boolean,
): Promise<Result> {
  if (userId === scope.userId && !active) {
    return { ok: false, error: 'Je kunt je eigen account niet deactiveren.' }
  }

  const outcome = await userRepository.updateTeamMemberGuarded(scope.agencyId, userId, { active })
  if (outcome !== 'ok') return { ok: false, error: TEAM_OUTCOME_ERRORS[outcome] }

  await recordAudit({
    actor: await actorEmail(scope.userId),
    agencyId: scope.agencyId,
    action: active ? 'team.member_reactivated' : 'team.member_deactivated',
    entityType: 'User',
    entityId: userId,
  })

  return { ok: true }
}

export async function setTeamMemberRole(
  scope: AgencyScope,
  userId: string,
  role: TeamRole,
): Promise<Result> {
  if (userId === scope.userId && role !== 'AGENCY_ADMIN') {
    return { ok: false, error: 'Je kunt je eigen beheerrechten niet afnemen.' }
  }

  const outcome = await userRepository.updateTeamMemberGuarded(scope.agencyId, userId, { role })
  if (outcome !== 'ok') return { ok: false, error: TEAM_OUTCOME_ERRORS[outcome] }

  await recordAudit({
    actor: await actorEmail(scope.userId),
    agencyId: scope.agencyId,
    action: 'team.member_role_changed',
    entityType: 'User',
    entityId: userId,
    metadata: { role },
  })

  return { ok: true }
}

export async function resetTeamMemberPassword(
  scope: AgencyScope,
  userId: string,
): Promise<Result<{ temporaryPassword: string; email: string }>> {
  if (userId === scope.userId) {
    return { ok: false, error: 'Wijzig je eigen wachtwoord via Mijn account.' }
  }

  const member = await userRepository.findTeamMember(scope.agencyId, userId)
  if (!member) return { ok: false, error: 'Deze gebruiker hoort niet bij jouw kantoor.' }

  const temporaryPassword = generateTemporaryPassword()
  await userRepository.setTeamMemberTemporaryPassword(
    scope.agencyId,
    userId,
    await hashPassword(temporaryPassword),
  )

  await recordAudit({
    actor: await actorEmail(scope.userId),
    agencyId: scope.agencyId,
    action: 'team.password_reset',
    entityType: 'User',
    entityId: userId,
  })

  return { ok: true, temporaryPassword, email: member.email }
}

// ─────────────────────────────────────────────────────────────────────────────
// Platformbeheer
// ─────────────────────────────────────────────────────────────────────────────

export async function createAgency(
  actorUserId: string,
  input: {
    name: string
    slug: string
    contactEmail: string | null
    plan: string
    maxOpportunitiesPerDay: number
    adminEmail: string
    adminName: string | null
  },
): Promise<Result<{ temporaryPassword: string; adminEmail: string }>> {
  if (await userRepository.slugExists(input.slug)) {
    return { ok: false, error: 'Er bestaat al een kantoor met deze korte naam.' }
  }
  if (await userRepository.emailExists(input.adminEmail)) {
    return { ok: false, error: 'Er bestaat al een account met het e-mailadres van de beheerder.' }
  }

  const temporaryPassword = generateTemporaryPassword()

  try {
    const created = await userRepository.createAgencyWithAdmin({
      name: input.name,
      slug: input.slug,
      contactEmail: input.contactEmail,
      plan: input.plan,
      maxOpportunitiesPerDay: input.maxOpportunitiesPerDay,
      admin: {
        email: input.adminEmail,
        name: input.adminName,
        passwordHash: await hashPassword(temporaryPassword),
      },
    })

    await recordAudit({
      actor: await actorEmail(actorUserId),
      agencyId: created.agencyId,
      action: 'platform.agency_created',
      entityType: 'Agency',
      entityId: created.agencyId,
      metadata: { plan: input.plan, adminUserId: created.adminUserId },
    })

    return { ok: true, temporaryPassword, adminEmail: input.adminEmail.toLowerCase() }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'Korte naam of e-mailadres is intussen al in gebruik.' }
    }
    throw error
  }
}

export async function setAgencyActive(
  actorUserId: string,
  agencyId: string,
  active: boolean,
): Promise<Result> {
  if (!(await userRepository.setAgencyActive(agencyId, active))) {
    return { ok: false, error: 'Kantoor niet gevonden.' }
  }

  await recordAudit({
    actor: await actorEmail(actorUserId),
    agencyId,
    action: active ? 'platform.agency_activated' : 'platform.agency_deactivated',
    entityType: 'Agency',
    entityId: agencyId,
  })

  return { ok: true }
}

export async function updateSubscription(
  actorUserId: string,
  agencyId: string,
  input: {
    plan: string
    status: 'ACTIVE' | 'PAUSED' | 'CANCELLED'
    maxOpportunitiesPerDay: number
    endsAt: Date | null
  },
): Promise<Result> {
  const agency = await agencyRepository.findAgency(agencyId)
  if (!agency) return { ok: false, error: 'Kantoor niet gevonden.' }

  await userRepository.upsertSubscription(agencyId, input)

  await recordAudit({
    actor: await actorEmail(actorUserId),
    agencyId,
    action: 'platform.subscription_updated',
    entityType: 'Agency',
    entityId: agencyId,
    metadata: {
      plan: input.plan,
      status: input.status,
      maxOpportunitiesPerDay: input.maxOpportunitiesPerDay,
      endsAt: input.endsAt?.toISOString() ?? null,
    },
  })

  return { ok: true }
}

/** Alleen voor het bootstrapscript. */
export async function bootstrapPlatformAdmin(
  email: string,
  name: string | null,
): Promise<{ created: false } | { created: true; temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword()
  const created = await userRepository.createPlatformAdminIfMissing({
    email,
    name,
    passwordHash: await hashPassword(temporaryPassword),
  })

  if (!created) return { created: false }

  await recordAudit({
    actor: 'bootstrap',
    agencyId: null,
    action: 'platform.admin_bootstrapped',
    entityType: 'User',
    entityId: created.id,
  })

  return { created: true, temporaryPassword }
}

