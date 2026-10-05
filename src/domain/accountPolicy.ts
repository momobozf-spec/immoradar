import { randomInt } from 'node:crypto'

/**
 * Regels rond accounts: wachtwoordbeleid, tijdelijke wachtwoorden en
 * inlogvergrendeling.
 *
 * ─── WAAROM DIT PUUR IS ──────────────────────────────────────────────────────
 *
 * Elke beslissing hier ("mag dit wachtwoord?", "zit dit account op slot?") is
 * een functie van zijn argumenten. De service rond de database past ze alleen
 * toe. Zo is het beleid volledig te testen zonder database, en staat het op één
 * plek in plaats van verspreid over formulieren en serveracties.
 */

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 200

/**
 * Wachtwoorden die in elke gelekte lijst bovenaan staan, plus de voor de hand
 * liggende varianten op de productnaam. Geen volledige blocklist — wel genoeg om
 * de pogingen tegen te houden die een aanvaller als eerste probeert.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  'password1234',
  'wachtwoord123',
  'wachtwoord1234',
  'qwertyuiop12',
  'azertyuiop12',
  'immoradar123',
  'immoradar1234',
  'welkom123456',
  'welcome12345',
  'letmein12345',
  'iloveyou1234',
  'admin1234567',
])

export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'contains_email'
  | 'too_common'
  | 'too_repetitive'

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Kies een wachtwoord van minstens ${PASSWORD_MIN_LENGTH} tekens.`,
  too_long: `Een wachtwoord mag hoogstens ${PASSWORD_MAX_LENGTH} tekens lang zijn.`,
  contains_email: 'Je wachtwoord mag je e-mailadres niet bevatten.',
  too_common: 'Dit wachtwoord is te voor de hand liggend. Kies iets anders.',
  too_repetitive: 'Dit wachtwoord herhaalt te veel dezelfde tekens.',
}

/**
 * Beoordeelt een nieuw wachtwoord.
 *
 * Bewust géén eisen als "minstens één hoofdletter en een cijfer": die leveren
 * `Wachtwoord1!` op. Lengte is wat telt, en een lange zin is zowel sterker als
 * makkelijker te onthouden.
 */
export function checkPassword(password: string, email: string): PasswordProblem | null {
  const length = [...password].length
  if (length < PASSWORD_MIN_LENGTH) return 'too_short'
  if (length > PASSWORD_MAX_LENGTH) return 'too_long'

  const lower = password.toLowerCase()
  const localPart = email.toLowerCase().split('@')[0] ?? ''
  if (localPart.length >= 4 && lower.includes(localPart)) return 'contains_email'

  if (COMMON_PASSWORDS.has(lower)) return 'too_common'

  // "aaaaaaaaaaaa" en "abababababab": minder dan vier verschillende tekens.
  if (new Set(lower).size < 4) return 'too_repetitive'

  return null
}

/**
 * Tekens voor een tijdelijk wachtwoord.
 *
 * Zonder tekens die op elkaar lijken (0/O, 1/l/I) — dit wachtwoord wordt
 * voorgelezen aan de telefoon of overgetypt van een scherm.
 */
const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Een tijdelijk wachtwoord in vier blokken van vier: `k7Rm-Qx2p-...`.
 *
 * 16 tekens uit 55 is ruim 92 bits entropie. Het wordt één keer getoond aan de
 * beheerder die het uitgeeft en moet bij de eerste login vervangen worden.
 */
export function generateTemporaryPassword(): string {
  const blocks: string[] = []
  for (let block = 0; block < 4; block += 1) {
    let part = ''
    for (let index = 0; index < 4; index += 1) {
      part += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]
    }
    blocks.push(part)
  }
  return blocks.join('-')
}

// ─────────────────────────────────────────────────────────────────────────────
// Inlogvergrendeling
// ─────────────────────────────────────────────────────────────────────────────

export interface LockoutPolicy {
  /** Na zoveel mislukte pogingen op rij gaat het account op slot. */
  maxAttempts: number
  /** Zo lang duurt de eerste vergrendeling. */
  lockMinutes: number
}

export interface LockoutState {
  failedLoginCount: number
  lockedUntil: Date | null
}

export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime()
}

/**
 * De toestand na een mislukte poging.
 *
 * Elke volgende reeks mislukte pogingen verdubbelt de wachttijd, tot een dag.
 * Iemand die zijn wachtwoord vergeten is, merkt daar na vijf pogingen een
 * kwartier van; een script dat duizenden wachtwoorden probeert, komt nergens.
 */
/**
 * Hoe lang een account op slot gaat na `failedLoginCount` mislukte pogingen op
 * rij, of null als dit aantal geen nieuwe vergrendeling oplevert.
 *
 * Elke volgende reeks verdubbelt de wachttijd, tot een dag. Iemand die zijn
 * wachtwoord vergeten is, merkt daar na vijf pogingen een kwartier van; een
 * script dat duizenden wachtwoorden probeert, komt nergens.
 *
 * Alleen bij een veelvoud van de drempel: anders schuift elke poging het slot
 * verder op en houdt een aanvaller een legitieme gebruiker eindeloos buiten.
 */
export function lockMinutesForCount(failedLoginCount: number, policy: LockoutPolicy): number | null {
  if (failedLoginCount < policy.maxAttempts) return null
  if (failedLoginCount % policy.maxAttempts !== 0) return null

  const rounds = failedLoginCount / policy.maxAttempts - 1
  return Math.min(policy.lockMinutes * 2 ** rounds, 24 * 60)
}

/** De toestand na een mislukte poging (pure variant van wat de database atomair doet). */
export function afterFailedLogin(
  state: LockoutState,
  policy: LockoutPolicy,
  now: Date,
): LockoutState {
  const failedLoginCount = state.failedLoginCount + 1
  const minutes = lockMinutesForCount(failedLoginCount, policy)

  return {
    failedLoginCount,
    lockedUntil: minutes === null ? state.lockedUntil : new Date(now.getTime() + minutes * 60_000),
  }
}

/**
 * Na een dag zonder nieuwe vergrendeling begint de teller opnieuw. Zonder dat
 * verdubbelt elke vergrendeling voor altijd, en volstaan vijf pogingen per dag
 * om een bekend account permanent buiten te houden.
 */
export const LOCKOUT_DECAY_MS = 24 * 60 * 60_000

export const UNLOCKED: LockoutState = { failedLoginCount: 0, lockedUntil: null }

// ─────────────────────────────────────────────────────────────────────────────
// Abonnement
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceState {
  agencyActive: boolean
  subscription: { status: 'ACTIVE' | 'PAUSED' | 'CANCELLED'; endsAt: Date | null } | null
}

/**
 * Wordt dit kantoor bediend?
 *
 * Een kantoor zonder abonnementsrij wordt bediend zolang het actief staat: zo
 * blijven bestaande installaties werken. Met een abonnement moet dat op ACTIVE
 * staan en mag de einddatum niet verstreken zijn.
 */
export function isAgencyServed(state: ServiceState, now: Date): boolean {
  if (!state.agencyActive) return false
  if (!state.subscription) return true
  if (state.subscription.status !== 'ACTIVE') return false
  if (state.subscription.endsAt && state.subscription.endsAt.getTime() <= now.getTime()) {
    return false
  }
  return true
}
