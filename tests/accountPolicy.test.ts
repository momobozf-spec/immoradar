import { describe, expect, it } from 'vitest'

import {
  afterFailedLogin,
  lockMinutesForCount,
  checkPassword,
  generateTemporaryPassword,
  isAgencyServed,
  isLocked,
  UNLOCKED,
  type LockoutPolicy,
} from '@/domain/accountPolicy'

const POLICY: LockoutPolicy = { maxAttempts: 5, lockMinutes: 15 }
const NOW = new Date('2026-10-04T10:00:00Z')

describe('wachtwoordbeleid', () => {
  it('weigert korte wachtwoorden', () => {
    expect(checkPassword('kort', 'a@b.be')).toBe('too_short')
    expect(checkPassword('elf tekens!', 'a@b.be')).toBe('too_short')
  })

  it('aanvaardt een lange zin zonder complexiteitseisen', () => {
    expect(checkPassword('mijn kat slaapt op de vensterbank', 'thomas@kantoor.be')).toBeNull()
  })

  it('weigert een wachtwoord dat het e-mailadres bevat', () => {
    expect(checkPassword('thomas-is-de-beste', 'thomas@kantoor.be')).toBe('contains_email')
  })

  it('weigert voor de hand liggende wachtwoorden, ongeacht hoofdletters', () => {
    expect(checkPassword('ImmoRadar1234', 'x@y.be')).toBe('too_common')
  })

  it('weigert herhalende patronen', () => {
    expect(checkPassword('aaaaaaaaaaaaaaa', 'x@y.be')).toBe('too_repetitive')
    expect(checkPassword('abababababab', 'x@y.be')).toBe('too_repetitive')
  })

  it('weigert absurd lange wachtwoorden (scrypt-kosten)', () => {
    expect(checkPassword('x'.repeat(150) + 'abcdefghijklmnopqrstuvwxyz'.repeat(3), 'x@y.be')).toBe(
      'too_long',
    )
  })

  it('telt tekens, geen bytes', () => {
    // Twaalf emoji zijn twaalf tekens, al zijn het 24 UTF-16-eenheden.
    expect(checkPassword('🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬', 'x@y.be')).toBeNull()
  })
})

describe('tijdelijke wachtwoorden', () => {
  it('heeft het vaste formaat en voldoet zelf aan het beleid', () => {
    const password = generateTemporaryPassword()
    expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/)
    expect(checkPassword(password, 'x@y.be')).toBeNull()
  })

  it('bevat geen tekens die op elkaar lijken', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateTemporaryPassword()).not.toMatch(/[0O1lI]/)
    }
  })

  it('is niet voorspelbaar', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()))
    expect(seen.size).toBe(500)
  })
})

describe('inlogvergrendeling', () => {
  it('vergrendelt pas bij de drempel', () => {
    let state = UNLOCKED
    for (let attempt = 1; attempt < POLICY.maxAttempts; attempt += 1) {
      state = afterFailedLogin(state, POLICY, NOW)
      expect(isLocked(state, NOW)).toBe(false)
    }

    state = afterFailedLogin(state, POLICY, NOW)
    expect(isLocked(state, NOW)).toBe(true)
    expect(state.lockedUntil?.getTime()).toBe(NOW.getTime() + 15 * 60_000)
  })

  it('ontgrendelt vanzelf na de wachttijd', () => {
    let state = UNLOCKED
    for (let attempt = 0; attempt < POLICY.maxAttempts; attempt += 1) {
      state = afterFailedLogin(state, POLICY, NOW)
    }
    expect(isLocked(state, new Date(NOW.getTime() + 15 * 60_000 + 1))).toBe(false)
  })

  it('verdubbelt de wachttijd bij elke volgende reeks', () => {
    let state = UNLOCKED
    for (let attempt = 0; attempt < POLICY.maxAttempts * 2; attempt += 1) {
      state = afterFailedLogin(state, POLICY, NOW)
    }
    expect(state.lockedUntil?.getTime()).toBe(NOW.getTime() + 30 * 60_000)
  })

  it('schuift het slot niet op bij pogingen tussen twee drempels', () => {
    let state = UNLOCKED
    for (let attempt = 0; attempt < POLICY.maxAttempts; attempt += 1) {
      state = afterFailedLogin(state, POLICY, NOW)
    }
    const lockedUntil = state.lockedUntil

    const later = new Date(NOW.getTime() + 60_000)
    state = afterFailedLogin(state, POLICY, later)
    expect(state.lockedUntil).toEqual(lockedUntil)
  })

  it('begrenst de wachttijd op één dag', () => {
    let state = UNLOCKED
    for (let attempt = 0; attempt < POLICY.maxAttempts * 20; attempt += 1) {
      state = afterFailedLogin(state, POLICY, NOW)
    }
    expect(state.lockedUntil?.getTime()).toBe(NOW.getTime() + 24 * 60 * 60_000)
  })
})

describe('abonnement', () => {
  it('bedient een actief kantoor zonder abonnementsrij', () => {
    expect(isAgencyServed({ agencyActive: true, subscription: null }, NOW)).toBe(true)
  })

  it('bedient geen gedeactiveerd kantoor, ook niet met een actief abonnement', () => {
    expect(
      isAgencyServed(
        { agencyActive: false, subscription: { status: 'ACTIVE', endsAt: null } },
        NOW,
      ),
    ).toBe(false)
  })

  it('bedient geen gepauzeerd of opgezegd abonnement', () => {
    for (const status of ['PAUSED', 'CANCELLED'] as const) {
      expect(isAgencyServed({ agencyActive: true, subscription: { status, endsAt: null } }, NOW)).toBe(
        false,
      )
    }
  })

  it('bedient niet meer na de einddatum', () => {
    const ended = new Date(NOW.getTime() - 1)
    const future = new Date(NOW.getTime() + 86_400_000)
    expect(
      isAgencyServed({ agencyActive: true, subscription: { status: 'ACTIVE', endsAt: ended } }, NOW),
    ).toBe(false)
    expect(
      isAgencyServed({ agencyActive: true, subscription: { status: 'ACTIVE', endsAt: future } }, NOW),
    ).toBe(true)
  })
})

describe('wachttijd per aantal mislukte pogingen', () => {
  it('vergrendelt alleen op een veelvoud van de drempel', () => {
    expect(lockMinutesForCount(4, POLICY)).toBeNull()
    expect(lockMinutesForCount(5, POLICY)).toBe(15)
    expect(lockMinutesForCount(6, POLICY)).toBeNull()
    expect(lockMinutesForCount(10, POLICY)).toBe(30)
    expect(lockMinutesForCount(15, POLICY)).toBe(60)
  })

  it('stijgt nooit boven een dag', () => {
    expect(lockMinutesForCount(500, POLICY)).toBe(24 * 60)
  })
})

describe('bezoekers-IP achter proxies', () => {
  it('neemt het adres van de laatste vertrouwde proxy, niet wat de bezoeker meestuurt', async () => {
    const { pickClientIp } = await import('@/lib/clientIp')
    expect(pickClientIp('1.1.1.1, 9.9.9.9', 1)).toBe('9.9.9.9')
    expect(pickClientIp('1.1.1.1, 9.9.9.9, 10.0.0.5', 2)).toBe('9.9.9.9')
    expect(pickClientIp('9.9.9.9', 3)).toBe('unknown')
    expect(pickClientIp(null, 0)).toBe('direct')
  })
})
