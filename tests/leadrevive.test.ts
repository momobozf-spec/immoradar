import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ContactPropertyRoleValue } from '@/crm/crmMatcher'
import type { ContactStatusValue, ContactTypeValue } from '@/crm/normalizeContact'
import { runIntake } from '@/leadrevive/intake'
import { assessContact } from '@/leadrevive/relationshipEngine'
import { evaluateRevive, type ReviveSettings } from '@/leadrevive/reviveEvaluation'
import type { TerritoryDefinition } from '@/territories/territoryMatch'

/**
 * LeadRevive zoals een pilot hem gebruikt: een CSV-export, zonder
 * interactiegeschiedenis. Elke categorie die docs/leadrevive.md belooft, moet
 * uit zo'n export kunnen komen — anders belooft het aanbod iets wat de
 * software niet levert.
 */

const NOW = new Date('2026-10-20T09:00:00Z')
const MONTH = 30.44 * 86_400_000
const ago = (months: number): Date => new Date(NOW.getTime() - months * MONTH)

const SETTINGS: ReviveSettings = {
  dormantMonths: 12,
  minRelationshipScore: 45,
  minOpportunityScore: 40,
  highValueThreshold: 600_000,
}

const GENT: TerritoryDefinition = {
  id: 'gent',
  agencyId: 'demo',
  name: 'Gent',
  kind: 'POSTAL_CODE',
  postalCodes: ['9000', '9030', '9031', '9040', '9041', '9050', '9051'],
  municipalities: [],
  provinces: [],
  active: true,
}

/** Een contact zoals het uit een CSV-import komt: geen interacties. */
function fromCsv(input: {
  contactType: ContactTypeValue
  status?: ContactStatusValue
  createdMonthsAgo: number
  lastContactMonthsAgo: number | null
  roles?: ContactPropertyRoleValue[]
}) {
  return evaluateRevive(
    {
      contactType: input.contactType,
      status: input.status ?? 'UNKNOWN',
      sourceCreatedAt: ago(input.createdMonthsAgo),
      lastContactAt: input.lastContactMonthsAgo === null ? null : ago(input.lastContactMonthsAgo),
      interactionCount: 0,
      interactionKinds: [],
      propertyRoles: input.roles ?? [],
      postalCode: '9000',
      city: 'Gent',
      hasPhone: true,
    },
    [GENT],
    SETTINGS,
    NOW,
  )
}

describe('LeadRevive uit een CSV-export', () => {
  it('levert een slapende schattingsaanvraag', () => {
    const result = fromCsv({
      contactType: 'VALUATION_LEAD',
      createdMonthsAgo: 40,
      lastContactMonthsAgo: 36,
      roles: ['VALUATION_SUBJECT'],
    })
    expect(result.assessment.opportunityType).toBe('DORMANT_VALUATION_LEAD')
    expect(result.qualifies).toBe(true)
  })

  it('levert een verloren mandaat voor een verkoper met bekend pand die als verloren staat', () => {
    const result = fromCsv({
      contactType: 'SELLER',
      status: 'LOST',
      createdMonthsAgo: 60,
      lastContactMonthsAgo: 30,
      roles: ['SELLER'],
    })
    expect(result.assessment.opportunityType).toBe('LOST_MANDATE')
    expect(result.qualifies).toBe(true)
  })

  it('levert een verloren verkoopprospect', () => {
    const result = fromCsv({
      contactType: 'SELLER',
      createdMonthsAgo: 50,
      lastContactMonthsAgo: 48,
      roles: ['SELLER'],
    })
    expect(result.assessment.opportunityType).toBe('FORMER_SELLER_PROSPECT')
    expect(result.qualifies).toBe(true)
  })

  it('levert een eerdere koper na vijf jaar', () => {
    const result = fromCsv({
      contactType: 'BUYER',
      createdMonthsAgo: 100,
      lastContactMonthsAgo: 97,
      roles: ['BUYER'],
    })
    expect(result.assessment.opportunityType).toBe('PREVIOUS_BUYER')
    expect(result.qualifies).toBe(true)
  })

  it('zet een koper van twee jaar geleden niet op de lijst, ook niet als oud-klant', () => {
    const result = fromCsv({
      contactType: 'BUYER',
      status: 'WON',
      createdMonthsAgo: 26,
      lastContactMonthsAgo: 24,
      roles: ['BUYER'],
    })
    expect(result.assessment.opportunityType).toBeNull()
  })

  it('levert een oud-klant', () => {
    const result = fromCsv({
      contactType: 'FORMER_CLIENT',
      status: 'WON',
      createdMonthsAgo: 120,
      lastContactMonthsAgo: 118,
      roles: ['FORMER_OWNER'],
    })
    expect(result.assessment.opportunityType).toBe('FORMER_CLIENT')
    expect(result.qualifies).toBe(true)
  })

  it('laat een recent gesproken contact met rust', () => {
    const result = fromCsv({
      contactType: 'VALUATION_LEAD',
      createdMonthsAgo: 12,
      lastContactMonthsAgo: 1,
      roles: ['VALUATION_SUBJECT'],
    })
    expect(result.assessment.opportunityType).toBeNull()
  })
})

describe('nooit opgevolgde leads', () => {
  const base = {
    status: 'UNKNOWN' as const,
    lastContactAt: null,
    interactionCount: 0,
    hadValuation: false,
    hadMandate: false,
    propertyRoles: [],
  }
  const options = { dormantMonths: 12, minRelationshipScore: 45 }

  it('vraagt een tijdsanker', () => {
    const zonderDatum = assessContact(
      { ...base, contactType: 'PROSPECT', sourceCreatedAt: null },
      NOW,
      options,
    )
    expect(zonderDatum.opportunityType).toBeNull()
  })

  it('telt huurders niet mee', () => {
    const huurder = assessContact(
      { ...base, contactType: 'TENANT', sourceCreatedAt: ago(30) },
      NOW,
      options,
    )
    expect(huurder.opportunityType).toBeNull()
  })

  it('herkent een prospect die nooit gebeld werd', () => {
    const prospect = assessContact(
      { ...base, contactType: 'PROSPECT', sourceCreatedAt: ago(30) },
      NOW,
      options,
    )
    expect(prospect.opportunityType).toBe('UNCONTACTED_LEAD')
  })
})

describe('intake-scan op het voorbeeldbestand', () => {
  const csv = readFileSync(join(__dirname, '..', 'demo', 'leadrevive', 'voorbeeld-export.csv'), 'utf8')
  const report = runIntake(csv, { now: NOW, settings: SETTINGS, territories: [GENT] })

  it('leest alle rijen en voegt dubbele contacten samen', () => {
    expect(report.rows).toBe(20)
    // Pieter Janssens staat er twee keer in (zelfde naam + adres); An De Smet
    // ook (zelfde gsm-nummer, ander formaat).
    expect(report.duplicateRows).toBe(2)
    expect(report.uniqueContacts).toBe(18)
  })

  it('herkent de kolommen van een Belgische export', () => {
    const fields = Object.fromEntries(report.mapping.map((entry) => [entry.column, entry.field]))
    expect(fields['Laatste contact']).toBe('lastContactAt')
    expect(fields['Aangemaakt']).toBe('sourceCreatedAt')
    expect(fields['GSM']).toBe('phone')
  })

  it('telt alleen bereikbare kansen in het werkgebied als bruikbaar', () => {
    for (const opportunity of report.opportunities.filter((o) => o.usable)) {
      expect(opportunity.phone ?? opportunity.email).not.toBeNull()
      expect(opportunity.postalCode?.startsWith('90')).toBe(true)
    }
    expect(report.usableCount).toBe(report.opportunities.filter((o) => o.usable).length)
  })

  it('geeft bij elke kans de reden mee', () => {
    for (const opportunity of report.opportunities) {
      expect(opportunity.categoryLabel.length).toBeGreaterThan(0)
    }
    const janssens = report.opportunities.find((o) => o.name.includes('Janssens'))
    expect(janssens?.category).toBe('DORMANT_VALUATION_LEAD')
    expect(janssens?.mergedRows).toBe(2)
  })

  it('meldt een export zonder kolom "laatste contact"', () => {
    const zonder = csv
      .split('\n')
      .map((line) => line.split(';').slice(0, 11).join(';'))
      .join('\n')
    const result = runIntake(zonder, { now: NOW, settings: SETTINGS, territories: [GENT] })
    expect(result.hasLastContactColumn).toBe(false)
    expect(result.warnings.some((warning) => warning.includes('laatste contact'))).toBe(true)
    for (const opportunity of result.opportunities.filter((o) => o.category === 'UNCONTACTED_LEAD')) {
      expect(opportunity.usable).toBe(false)
    }
  })
})
