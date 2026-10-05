import { describe, expect, it } from 'vitest'

import { DEFAULT_SCORING_CONFIG, type ScoringContext } from '@/scoring/config'
import { scoreOpportunity } from '@/scoring/opportunityScore'
import { bestTerritoryPerAgency, matchTerritories, type TerritoryDefinition } from '@/territories/territoryMatch'

/**
 * De scoringmotor.
 *
 * ─── WAT HIER BEWAAKT WORDT ──────────────────────────────────────────────────
 *
 * Niet de exacte getallen — die mogen verschuiven als de weging verandert, en
 * een test die op "97" staat zou elke afstelling blokkeren. Wat wél vastligt is
 * de *ordening*: de uitspraken die het product doet over wat belangrijker is dan
 * wat. Als die omvallen, verkoopt het product iets anders dan het belooft.
 */

function context(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    origin: 'MARKET',
    type: 'NEW_FSBO',

    sellerType: 'private',
    sellerConfidence: 0.94,
    hasPhone: true,

    minutesSinceFirstSeen: 12,
    daysOnMarket: 0,

    priceDropCount: 0,
    totalPriceDropPercent: 0,

    isRelisted: false,
    listingCycles: 1,

    price: 495_000,
    highValueThreshold: 600_000,

    hasCrmMatch: false,
    crmMatchConfidence: 0,
    isKnownOwnerOfProperty: false,
    monthsSinceLastContact: null,
    relationshipAgeMonths: null,
    hadValuation: false,
    wasClient: false,
    neverContacted: false,

    territoryMatch: 'postal_code',
    ...overrides,
  }
}

describe('scorebereik', () => {
  it('blijft altijd tussen 0 en 100', () => {
    const best = scoreOpportunity(
      context({
        origin: 'CROSS',
        sellerConfidence: 0.99,
        priceDropCount: 4,
        totalPriceDropPercent: 18,
        daysOnMarket: 200,
        isRelisted: true,
        listingCycles: 4,
        hasCrmMatch: true,
        crmMatchConfidence: 0.99,
        isKnownOwnerOfProperty: true,
        hadValuation: true,
        wasClient: true,
        price: 1_200_000,
      }),
    )

    const worst = scoreOpportunity(
      context({
        sellerType: 'unknown',
        sellerConfidence: 0,
        hasPhone: false,
        minutesSinceFirstSeen: 100_000,
        price: null,
        territoryMatch: 'none',
      }),
    )

    expect(best.score).toBeLessThanOrEqual(100)
    expect(best.score).toBeGreaterThan(worst.score)
    expect(worst.score).toBeGreaterThanOrEqual(0)
  })

  it('geeft altijd een uitleg bij een score boven nul', () => {
    // Een makelaar die niet kan zien waarom iets hoog scoort, gaat de
    // rangschikking negeren — en dan had het scoren net zo goed niet gehoeven.
    const result = scoreOpportunity(context())
    expect(result.score).toBeGreaterThan(0)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons.every((reason) => reason.label.length > 0)).toBe(true)
  })

  it('sorteert de redenen zwaarste eerst', () => {
    const result = scoreOpportunity(context({ daysOnMarket: 95, priceDropCount: 2 }))
    const points = result.reasons.map((reason) => reason.points)
    expect([...points].sort((a, b) => b - a)).toEqual(points)
  })
})

describe('de uitspraken die het product doet', () => {
  it('waardeert een bestaande relatie hoger dan dezelfde kans zonder', () => {
    // Dit is de these van het product. Valt deze test om, dan is er geen reden
    // meer om beide motoren in één systeem te hebben.
    const zonder = scoreOpportunity(context())
    const met = scoreOpportunity(
      context({
        origin: 'CROSS',
        hasCrmMatch: true,
        crmMatchConfidence: 0.96,
        isKnownOwnerOfProperty: true,
        wasClient: true,
        relationshipAgeMonths: 84,
        monthsSinceLastContact: 80,
      }),
    )

    expect(met.score).toBeGreaterThan(zonder.score)
  })

  it('waardeert een particulier hoger dan een kantoor', () => {
    const particulier = scoreOpportunity(context())
    const kantoor = scoreOpportunity(context({ sellerType: 'professional', sellerConfidence: 0.95 }))
    expect(particulier.score).toBeGreaterThan(kantoor.score)
  })

  it('waardeert twee prijsverlagingen hoger dan één', () => {
    const een = scoreOpportunity(context({ daysOnMarket: 60, priceDropCount: 1, totalPriceDropPercent: 3 }))
    const twee = scoreOpportunity(
      context({ daysOnMarket: 60, priceDropCount: 2, totalPriceDropPercent: 9 }),
    )
    expect(twee.score).toBeGreaterThan(een.score)
  })

  it('waardeert het eigen postcodegebied hoger dan de provincie', () => {
    const postcode = scoreOpportunity(context({ territoryMatch: 'postal_code' }))
    const provincie = scoreOpportunity(context({ territoryMatch: 'province' }))
    const buiten = scoreOpportunity(context({ territoryMatch: 'none' }))

    expect(postcode.score).toBeGreaterThan(provincie.score)
    expect(provincie.score).toBeGreaterThan(buiten.score)
  })

  it('laat een hogere classificatiezekerheid meewegen', () => {
    const zeker = scoreOpportunity(context({ sellerConfidence: 0.98 }))
    const twijfel = scoreOpportunity(context({ sellerConfidence: 0.86 }))
    expect(zeker.score).toBeGreaterThanOrEqual(twijfel.score)
  })
})

describe('de relatiedimensie', () => {
  it('telt niet mee zonder CRM-koppeling', () => {
    // Anders haalt een perfecte FSBO in de eigen postcode nooit boven de 75,
    // puur omdat we die verkoper toevallig niet in het bestand hebben — en dan
    // straft de score iets af waar de makelaar niets aan kan doen.
    const result = scoreOpportunity(context())
    const relationship = result.breakdown.dimensions.find(
      (dimension) => dimension.dimension === 'relationship',
    )
    expect(relationship?.applicable).toBe(false)
    expect(result.crossBonus).toBe(0)
  })

  it('telt wel mee zodra er een koppeling is', () => {
    const result = scoreOpportunity(
      context({ origin: 'CROSS', hasCrmMatch: true, crmMatchConfidence: 0.95, wasClient: true }),
    )
    const relationship = result.breakdown.dimensions.find(
      (dimension) => dimension.dimension === 'relationship',
    )
    expect(relationship?.applicable).toBe(true)
  })
})

describe('LeadRevive-kansen', () => {
  it('scoort een dormante schattingsaanvraag zonder marktsignaal bruikbaar hoog', () => {
    // Scenario D: geen enkel extern signaal, wel een sterke relatie. Zou dit
    // onderaan belanden, dan is de halve productbelofte onzichtbaar.
    const result = scoreOpportunity(
      context({
        origin: 'LEADREVIVE',
        type: 'DORMANT_VALUATION_LEAD',
        sellerType: 'unknown',
        sellerConfidence: 0,
        hasPhone: true,
        minutesSinceFirstSeen: null,
        daysOnMarket: null,
        price: null,
        hasCrmMatch: true,
        crmMatchConfidence: 1,
        hadValuation: true,
        monthsSinceLastContact: 21,
        relationshipAgeMonths: 25,
        territoryMatch: 'postal_code',
      }),
    )

    // De eis is niet een bepaald cijfer maar dat hij de drempel haalt: onder
    // MIN_OPPORTUNITY_SCORE wordt er geen kans aangemaakt en blijft LeadRevive
    // leeg, hoe sterk de relatie ook is.
    expect(result.score).toBeGreaterThanOrEqual(40)
    expect(result.relationshipScore).toBeGreaterThan(0)
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})

describe('configuratie', () => {
  it('draagt een versienummer, zodat een oude score te duiden blijft', () => {
    expect(DEFAULT_SCORING_CONFIG.version).toBeTruthy()
    expect(scoreOpportunity(context()).weightsVersion).toBe(DEFAULT_SCORING_CONFIG.version)
  })

  it('houdt elke factor binnen zijn eigen maximum', () => {
    // Een verkeerd ingestelde factor mag de hele schaal niet onbruikbaar maken.
    for (const factor of DEFAULT_SCORING_CONFIG.factors) {
      expect(factor.maxPoints).toBeGreaterThan(0)
      expect(factor.maxPoints).toBeLessThanOrEqual(100)
    }
  })
})

describe('territory matching', () => {
  const territories: TerritoryDefinition[] = [
    {
      id: 't-postcode',
      agencyId: 'agency-a',
      name: 'Gent-kern',
      kind: 'POSTAL_CODE',
      postalCodes: ['9000', '9030'],
      municipalities: [],
      provinces: [],
      active: true,
    },
    {
      id: 't-provincie',
      agencyId: 'agency-a',
      name: 'Oost-Vlaanderen',
      kind: 'PROVINCE',
      postalCodes: [],
      municipalities: [],
      provinces: ['oost-vlaanderen'],
      active: true,
    },
    {
      id: 't-ander',
      agencyId: 'agency-b',
      name: 'Antwerpen',
      kind: 'POSTAL_CODE',
      postalCodes: ['2000'],
      municipalities: [],
      provinces: [],
      active: true,
    },
  ]

  const gent = { postalCode: '9000', city: 'Gent', province: 'oost-vlaanderen' }

  it('vindt alle rakende gebieden', () => {
    expect(matchTerritories(gent, territories)).toHaveLength(2)
  })

  it('geeft per kantoor één treffer: de meest precieze', () => {
    // Een kantoor met zowel "provincie Oost-Vlaanderen" als "postcode 9000" moet
    // één kans krijgen, niet twee keer dezelfde woning.
    const best = bestTerritoryPerAgency(gent, territories)
    const forA = best.filter((match) => match.agencyId === 'agency-a')

    expect(forA).toHaveLength(1)
    expect(forA[0]?.precision).toBe('postal_code')
  })

  it('geeft een ander kantoor niets voor een pand buiten zijn gebied', () => {
    const best = bestTerritoryPerAgency(gent, territories)
    expect(best.some((match) => match.agencyId === 'agency-b')).toBe(false)
  })

  it('slaat inactieve gebieden over', () => {
    // Een uitgezet gebied hoort geen kansen meer op te leveren. Zou dit alleen
    // in de query gefilterd worden, dan lekt een vergeten aanroep het gebied
    // stilzwijgend weer naar binnen.
    const inactief = territories.map((territory) => ({ ...territory, active: false }))
    expect(matchTerritories(gent, inactief)).toHaveLength(0)
  })
})
