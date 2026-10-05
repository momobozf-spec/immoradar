import { describe, expect, it } from 'vitest'

import { parseBelgianAddress, buildMatchKey } from '@/domain/geo/address'
import { cityForPostalCode, parseBelgianPostalCode, provinceForPostalCode } from '@/domain/geo/provinces'
import { normalizeListing, normalizePropertyType } from '@/normalization/normalizeListing'
import { extractBelgianPhones, normalizeBelgianPhone } from '@/lib/phone'
import { normalizeAgencyName, normalizeText } from '@/lib/text'
import type { RawListing } from '@/domain/types'

/**
 * De normalisatielaag.
 *
 * Deze tests zijn niet cosmetisch. Elke fout hier plant zich voort: een verkeerd
 * gelezen postcode betekent dat een kans bij het verkeerde kantoor terechtkomt,
 * een gemiste telefoon betekent dat dezelfde verkoper als twee personen telt, en
 * een verkeerd geraden huisnummer laat twee woningen hun geschiedenis delen.
 */

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    source: 'fixture-be',
    sourceListingId: 'test-1',
    url: 'https://example.be/listing/1',
    scrapedAt: new Date('2026-08-16T09:00:00Z'),
    ...overrides,
  }
}

describe('Belgische postcodes', () => {
  it('leest een postcode uit vrije tekst en uit losse velden', () => {
    expect(parseBelgianPostalCode('9000')).toBe('9000')
    expect(parseBelgianPostalCode('B-9000')).toBe('9000')
    expect(parseBelgianPostalCode('Woning te koop in 9000 Gent')).toBe('9000')
  })

  it('weigert wat geen Belgische postcode is', () => {
    // Vijf cijfers is Frankrijk of Duitsland; als postcode accepteren zou de
    // territory-matching stilzwijgend laten mislukken.
    expect(parseBelgianPostalCode('75001')).toBeNull()
    expect(parseBelgianPostalCode('0999')).toBeNull()
    expect(parseBelgianPostalCode('geen')).toBeNull()
  })

  it('leidt provincie en gemeente af', () => {
    expect(provinceForPostalCode('9000')).toBe('oost-vlaanderen')
    expect(provinceForPostalCode('2000')).toBe('antwerpen')
    expect(provinceForPostalCode('1000')).toBe('brussels')
    expect(cityForPostalCode('9000')).toBe('Gent')
  })
})

describe('adressen', () => {
  it('splitst de gangbare Belgische schrijfwijzen', () => {
    const parsed = parseBelgianAddress('Kerkstraat 12, 9000 Gent')
    expect(parsed.streetName).toBe('Kerkstraat')
    expect(parsed.houseNumber).toBe('12')
    expect(parsed.postalCode).toBe('9000')
    expect(parsed.city).toBe('Gent')
  })

  it('laat bus- en appartementsaanduidingen buiten het huisnummer', () => {
    // Bus 3 en bus 5 staan in hetzelfde gebouw. Voor de matcher is dat één pand
    // met verschillende eenheden, geen twee panden.
    expect(parseBelgianAddress('Kerkstraat 12 bus 3, 9000 Gent').houseNumber).toBe('12')
    expect(parseBelgianAddress('Avenue Louise 143/5, 1000 Bruxelles').houseNumber).toBe('143')
  })

  it('geeft null bij twijfel in plaats van te gokken', () => {
    // Een verkeerd geraden huisnummer is erger dan geen huisnummer: dan koppelt
    // de matcher twee verschillende woningen aan één pand.
    const parsed = parseBelgianAddress('9000 Gent')
    expect(parsed.houseNumber).toBeNull()
  })

  it('bouwt alleen een matchKey met een volledig adres', () => {
    expect(buildMatchKey('9000', 'Kerkstraat', '12')).toBe('9000:kerkstraat:12')
    // Zonder huisnummer zou de sleutel elk huis in de straat opleveren.
    expect(buildMatchKey('9000', 'Kerkstraat', null)).toBeNull()
    expect(buildMatchKey(null, 'Kerkstraat', '12')).toBeNull()
  })

  it('geeft dezelfde sleutel ongeacht schrijfwijze', () => {
    expect(buildMatchKey('9000', 'Sint-Pieters-Nieuwstraat', '12A')).toBe(
      buildMatchKey('9000', 'sint pieters nieuwstraat', '12a'),
    )
  })
})

describe('telefoonnummers', () => {
  it('brengt alle Belgische schrijfwijzen naar één E.164-vorm', () => {
    const forms = ['0475 12 34 56', '0475/12.34.56', '+32 475 12 34 56', '+32 (0)475 123 456', '0032475123456']
    for (const form of forms) {
      expect(normalizeBelgianPhone(form)?.e164, form).toBe('+32475123456')
    }
  })

  it('herkent mobiel apart van vast', () => {
    expect(normalizeBelgianPhone('0475123456')?.isMobile).toBe(true)
    expect(normalizeBelgianPhone('092251234')?.isMobile).toBe(false)
  })

  it('weigert buitenlandse nummers', () => {
    // Een Frans nummer opslaan alsof we het begrepen hadden, laat het meedoen in
    // de matching en koppelt uiteindelijk verkeerde mensen aan elkaar.
    expect(normalizeBelgianPhone('+33 6 12 34 56 78')).toBeNull()
  })

  it('vist nummers uit een advertentietekst', () => {
    const found = extractBelgianPhones('Interesse? Bel 0475/12.34.56 of 09 225 12 34.')
    expect(found.map((phone) => phone.e164)).toEqual(['+32475123456', '+3292251234'])
  })
})

describe('tekstnormalisatie', () => {
  it('haalt accenten en leestekens weg', () => {
    expect(normalizeText('Liège')).toBe('liege')
    expect(normalizeText('Sint-Genesius-Rode')).toBe('sint genesius rode')
  })

  it('laat rechtsvormen uit kantoornamen weg', () => {
    // "Immo De Meyer BV" en "Immo De Meyer BVBA" zijn hetzelfde kantoor dat van
    // rechtsvorm veranderde.
    expect(normalizeAgencyName('Immo De Meyer BVBA')).toBe(normalizeAgencyName('Immo De Meyer BV'))
  })
})

describe('woningtypes', () => {
  it('herkent NL, FR en EN', () => {
    expect(normalizePropertyType('Woning')).toBe('house')
    expect(normalizePropertyType('maison')).toBe('house')
    expect(normalizePropertyType('SingleFamilyResidence')).toBe('house')
    expect(normalizePropertyType('Appartement')).toBe('apartment')
    expect(normalizePropertyType('bouwgrond')).toBe('land')
  })

  it('kiest de specifieke term boven de algemene', () => {
    // "appartementsgebouw" bevat "appartement", maar is een handelspand.
    expect(normalizePropertyType('Studio')).toBe('apartment')
    expect(normalizePropertyType('handelspand')).toBe('commercial')
  })
})

describe('normalizeListing', () => {
  it('maakt van een magere advertentie een bruikbare rij', () => {
    const listing = normalizeListing(
      raw({
        title: 'Woning te koop in 9000 Gent',
        price: 495_000,
        address: 'Kerkstraat 12, 9000 Gent',
      }),
    )

    expect(listing.postalCode).toBe('9000')
    expect(listing.city).toBe('Gent')
    expect(listing.province).toBe('oost-vlaanderen')
    expect(listing.propertyType).toBe('house')
    expect(listing.matchKey).toBe('9000:kerkstraat:12')
    expect(listing.currency).toBe('EUR')
  })

  it('haalt het telefoonnummer uit de beschrijving als er geen veld is', () => {
    // Juist particuliere advertenties — de advertenties waar het om gaat —
    // zetten hun nummer alleen in de lopende tekst.
    const listing = normalizeListing(
      raw({ description: 'Particuliere verkoop. Bel 0475 12 34 56 voor een bezoek.' }),
    )
    expect(listing.sellerPhoneE164).toBe('+32475123456')
    expect(listing.sellerPhoneIsMobile).toBe(true)
  })

  it('geeft dezelfde contentHash bij een andere scrapeAt', () => {
    // Zou scrapedAt meetellen, dan schreven we bij elke run een snapshot per
    // advertentie: miljoenen rijen die allemaal hetzelfde zeggen.
    const a = normalizeListing(raw({ price: 495_000, scrapedAt: new Date('2026-08-16T09:00:00Z') }))
    const b = normalizeListing(raw({ price: 495_000, scrapedAt: new Date('2026-08-16T18:00:00Z') }))
    expect(a.contentHash).toBe(b.contentHash)
  })

  it('geeft een andere contentHash bij een andere prijs', () => {
    const a = normalizeListing(raw({ price: 495_000 }))
    const b = normalizeListing(raw({ price: 475_000 }))
    expect(a.contentHash).not.toBe(b.contentHash)
  })

  it('weigert een advertentie zonder bruikbare herkomst', () => {
    expect(() => normalizeListing(raw({ url: 'geen-url' }))).toThrow()
  })
})
