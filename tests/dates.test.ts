import { describe, expect, it } from 'vitest'

import { endOfDayInBrussels } from '@/lib/dates'
import { subscriptionInputSchema } from '@/domain/schemas'

describe('einde van een dag in Brussel', () => {
  it('gebruikt +01:00 in de winter', () => {
    expect(endOfDayInBrussels('2026-01-15')?.toISOString()).toBe('2026-01-15T22:59:59.999Z')
  })

  it('gebruikt +02:00 in de zomer', () => {
    expect(endOfDayInBrussels('2026-07-15')?.toISOString()).toBe('2026-07-15T21:59:59.999Z')
  })

  it('klopt op de dagen van de omschakeling', () => {
    // 29 maart 2026: zomertijd vanaf 02:00. 25 oktober 2026: wintertijd vanaf 03:00.
    expect(endOfDayInBrussels('2026-03-29')?.toISOString()).toBe('2026-03-29T21:59:59.999Z')
    expect(endOfDayInBrussels('2026-10-25')?.toISOString()).toBe('2026-10-25T22:59:59.999Z')
  })

  it('weigert datums die niet bestaan', () => {
    expect(endOfDayInBrussels('2026-02-30')).toBeNull()
    expect(endOfDayInBrussels('2026-13-01')).toBeNull()
    expect(endOfDayInBrussels('15/01/2026')).toBeNull()
  })
})

describe('abonnementsformulier', () => {
  it('maakt van een leeg datumveld "geen einddatum"', () => {
    const parsed = subscriptionInputSchema.parse({
      plan: 'starter',
      status: 'ACTIVE',
      maxOpportunitiesPerDay: '50',
      endsAt: '',
    })
    expect(parsed.endsAt).toBeNull()
    expect(parsed.maxOpportunitiesPerDay).toBe(50)
  })

  it('weigert een onbestaande einddatum met een leesbare melding', () => {
    const parsed = subscriptionInputSchema.safeParse({
      plan: 'starter',
      status: 'ACTIVE',
      maxOpportunitiesPerDay: '50',
      endsAt: '2026-02-30',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('Ongeldige datum')
  })
})
