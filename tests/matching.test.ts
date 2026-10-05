import { describe, expect, it } from 'vitest'

import { classifySeller, isConfidentPrivate } from '@/domain/classification/sellerClassifier'
import { matchProperty, type PropertyCandidate } from '@/matching/propertyMatcher'
import { matchCrmContact, type CrmMatchCandidate, type MarketSideForCrmMatch } from '@/crm/crmMatcher'
import { normalizeListing } from '@/normalization/normalizeListing'
import { normalizeText } from '@/lib/text'
import type { RawListing } from '@/domain/types'

/**
 * De drie beslissingen waarop het product staat of valt:
 * welk pand is dit, wie verkoopt het, en kennen wij die persoon al?
 *
 * Bij alle drie is de fout asymmetrisch. Te weinig koppelen kost een kans; te
 * veel koppelen laat een makelaar een vreemde opbellen alsof hij hem kent, of
 * geeft twee woningen één geschiedenis. De tests hieronder zijn daarom vooral
 * gericht op wat er *niet* mag matchen.
 */

const MATCHER_OPTIONS = { matchThreshold: 0.78, reviewThreshold: 0.55 }
const CRM_OPTIONS = { autoThreshold: 0.8, reviewThreshold: 0.55 }

function listing(overrides: Partial<RawListing> = {}) {
  return normalizeListing({
    source: 'fixture-be',
    sourceListingId: 'x',
    url: 'https://example.be/1',
    scrapedAt: new Date('2026-08-16T09:00:00Z'),
    ...overrides,
  })
}

function candidate(overrides: Partial<PropertyCandidate> = {}): PropertyCandidate {
  return {
    id: 'prop-1',
    matchKey: '9000:kerkstraat:12',
    streetName: 'Kerkstraat',
    houseNumber: '12',
    postalCode: '9000',
    city: 'Gent',
    propertyType: 'house',
    bedrooms: 3,
    surfaceArea: 160,
    listings: [],
    ...overrides,
  }
}

describe('property matching', () => {
  it('koppelt op een exact adres', () => {
    const result = matchProperty(
      listing({ address: 'Kerkstraat 12, 9000 Gent', propertyType: 'woning' }),
      [candidate()],
      MATCHER_OPTIONS,
    )

    expect(result.propertyId).toBe('prop-1')
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('koppelt buren NOOIT aan hetzelfde pand', () => {
    // Zelfde straat, ander huisnummer. Dit is de fout die niet te herstellen is:
    // prijsdalingen van het ene huis zouden op het andere verschijnen.
    const result = matchProperty(
      listing({ address: 'Kerkstraat 14, 9000 Gent', propertyType: 'woning' }),
      [candidate()],
      MATCHER_OPTIONS,
    )

    expect(result.propertyId).toBeUndefined()
    // De blokkade drukt de zekerheid ver onder de reviewdrempel: niet "twijfel",
    // maar "dit is het niet".
    expect(result.confidence).toBeLessThan(0.55)
  })

  it('koppelt niet over postcodes heen', () => {
    const result = matchProperty(
      listing({ address: 'Kerkstraat 12, 2000 Antwerpen', propertyType: 'woning' }),
      [candidate()],
      MATCHER_OPTIONS,
    )

    expect(result.propertyId).toBeUndefined()
  })

  it('herkent een herplaatsing aan het telefoonnummer van de verkoper', () => {
    // Nieuw bron-id, nieuwe URL, lagere prijs, herschreven tekst — maar dezelfde
    // verkoper op hetzelfde adresniveau. Dit is precies waarvoor de matcher
    // bestaat; zonder deze weg mist de relist-detectie haar belangrijkste geval.
    const result = matchProperty(
      listing({
        address: 'Kerkstraat, 9000 Gent',
        propertyType: 'woning',
        description: 'Opnieuw te koop. Bel 0475 12 34 56.',
      }),
      [
        candidate({
          matchKey: null,
          houseNumber: null,
          listings: [
            {
              title: 'Woning te koop',
              description: 'Ruime woning',
              price: 495_000,
              sellerPhoneE164: '+32475123456',
            },
          ],
        }),
      ],
      MATCHER_OPTIONS,
    )

    expect(result.propertyId).toBe('prop-1')
  })

  it('geeft geen koppeling zonder kandidaten', () => {
    const result = matchProperty(listing({ address: 'Kerkstraat 12, 9000 Gent' }), [], MATCHER_OPTIONS)
    expect(result.propertyId).toBeUndefined()
    expect(result.confidence).toBe(0)
  })
})

describe('verkoperclassificatie', () => {
  const options = { professionalListingThreshold: 4 }

  it('herkent een expliciete particuliere verkoop', () => {
    const result = classifySeller(
      {
        sellerName: 'Pieter Janssens',
        sellerPhoneE164: '+32475123456',
        sellerPhoneIsMobile: true,
        title: 'Woning te koop',
        description: 'Particuliere verkoop — geen immokantoren aub.',
        sourceHint: 'unknown',
        activeListingCount: 1,
      },
      options,
    )

    expect(result.type).toBe('private')
    expect(isConfidentPrivate(result, 0.85)).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('herkent een kantoor aan naam en aanbod', () => {
    const result = classifySeller(
      {
        sellerName: 'Immo De Meyer BVBA',
        sellerPhoneE164: '+3292251234',
        sellerPhoneIsMobile: false,
        title: 'Woning te koop',
        description: 'Neem contact op met ons kantoor voor een bezichtiging.',
        sourceHint: 'professional',
        activeListingCount: 12,
      },
      options,
    )

    expect(result.type).toBe('professional')
    expect(result.agencyName).toBeTruthy()
  })

  it('zegt liever niets dan iets verkeerds', () => {
    // Geen aanwijzingen: UNKNOWN is een volwaardige uitkomst. Liever geen lead
    // dan een FSBO-melding over een woning die bij een collega staat.
    const result = classifySeller(
      {
        sellerName: null,
        sellerPhoneE164: null,
        sellerPhoneIsMobile: false,
        title: null,
        description: null,
        sourceHint: 'unknown',
        activeListingCount: 0,
      },
      options,
    )

    expect(result.type).toBe('unknown')
    expect(isConfidentPrivate(result, 0.85)).toBe(false)
  })
})

describe('CRM ↔ markt matching', () => {
  function crmCandidate(overrides: Partial<CrmMatchCandidate> = {}): CrmMatchCandidate {
    return {
      id: 'contact-1',
      displayName: 'Pieter Janssens',
      nameNormalized: normalizeText('Pieter Janssens'),
      phoneE164: null,
      emailNormalized: null,
      addressMatchKey: null,
      postalCode: '9000',
      propertyRelations: [],
      ...overrides,
    }
  }

  function market(overrides: Partial<MarketSideForCrmMatch> = {}): MarketSideForCrmMatch {
    return {
      propertyId: 'prop-1',
      propertyMatchKey: '9000:lindelaan:17',
      postalCode: '9000',
      sellerName: 'Pieter Janssens',
      sellerNameNormalized: normalizeText('Pieter Janssens'),
      sellerPhoneE164: null,
      sellerEmailNormalized: null,
      ...overrides,
    }
  }

  it('koppelt NOOIT op alleen een naam', () => {
    // De belangrijkste test in dit bestand. Er wonen duizenden Belgen die
    // "Jan Peeters" heten; matchen op naam alleen laat een makelaar een vreemde
    // opbellen alsof hij hem kent, en dat gesprek is niet te repareren.
    const result = matchCrmContact(market(), [crmCandidate()], CRM_OPTIONS)
    expect(result).toBeNull()
  })

  it('koppelt ook niet op naam plus dezelfde gemeente', () => {
    const result = matchCrmContact(
      market({ postalCode: '9000' }),
      [crmCandidate({ postalCode: '9000' })],
      CRM_OPTIONS,
    )
    expect(result).toBeNull()
  })

  it('koppelt wel op een exact telefoonnummer', () => {
    const result = matchCrmContact(
      market({ sellerPhoneE164: '+32476112233' }),
      [crmCandidate({ phoneE164: '+32476112233' })],
      CRM_OPTIONS,
    )

    expect(result?.contactId).toBe('contact-1')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('koppelt op een bekende pandrelatie uit het eigen dossier', () => {
    // Het scherpste signaal dat bestaat: geen gelijkenis maar een feit uit de
    // eigen administratie van het kantoor.
    const result = matchCrmContact(
      market(),
      [
        crmCandidate({
          propertyRelations: [
            { propertyId: 'prop-1', addressMatchKey: '9000:lindelaan:17', role: 'OWNER' },
          ],
        }),
      ],
      CRM_OPTIONS,
    )

    expect(result?.contactId).toBe('contact-1')
    expect(result?.isKnownOwner).toBe(true)
    expect(result?.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('koppelt wanneer het woonadres het aangeboden pand is', () => {
    const result = matchCrmContact(
      market(),
      [crmCandidate({ addressMatchKey: '9000:lindelaan:17' })],
      CRM_OPTIONS,
    )

    expect(result?.contactId).toBe('contact-1')
  })

  it('kiest de sterkste kandidaat bij meerdere treffers', () => {
    const result = matchCrmContact(
      market({ sellerPhoneE164: '+32476112233' }),
      [
        crmCandidate({ id: 'zwak', addressMatchKey: '9000:lindelaan:17' }),
        crmCandidate({
          id: 'sterk',
          phoneE164: '+32476112233',
          propertyRelations: [
            { propertyId: 'prop-1', addressMatchKey: '9000:lindelaan:17', role: 'OWNER' },
          ],
        }),
      ],
      CRM_OPTIONS,
    )

    expect(result?.contactId).toBe('sterk')
  })

  it('geeft null zonder kandidaten', () => {
    expect(matchCrmContact(market(), [], CRM_OPTIONS)).toBeNull()
  })
})
