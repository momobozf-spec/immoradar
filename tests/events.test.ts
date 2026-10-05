import { describe, expect, it } from 'vitest'

import {
  detectNewListing,
  detectPriceChange,
  detectRelist,
  detectRemoval,
  detectSellerTransition,
  detectStaleListing,
  detectUpdateEvents,
} from '@/events/detectors'
import { expiryDaysFor, opportunityTypeFor } from '@/events/opportunityRules'
import type { ListingStateForEvents, ObservationForEvents } from '@/events/types'

/**
 * De eventmotor: waar data verandering wordt, en verandering een marktsignaal.
 *
 * Twee eigenschappen worden hier bewaakt, en beide zijn het verschil tussen een
 * bruikbaar product en een dat wordt uitgezet:
 *
 *   idempotentie — de collector draait elke paar minuten. Zonder dedupeKey meldt
 *                  een 64 dagen oude advertentie driehonderd keer per dag dat
 *                  hij 60 dagen oud is.
 *   terughoudend — een gemiste run is geen intrekking, en 200 euro op 495.000 is
 *                  geen marktsignaal.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-16T09:00:00Z')

function state(overrides: Partial<ListingStateForEvents> = {}): ListingStateForEvents {
  return {
    id: 'listing-1',
    price: 495_000,
    initialPrice: 495_000,
    sellerType: 'private',
    firstSeenAt: new Date(NOW.getTime() - 40 * DAY),
    lastSeenAt: NOW,
    publishedAt: null,
    staleDaysReported: [],
    priceDropCount: 0,
    missedRuns: 0,
    ...overrides,
  }
}

function observation(overrides: Partial<ObservationForEvents> = {}): ObservationForEvents {
  return { price: 495_000, sellerType: 'private', observedAt: NOW, ...overrides }
}

describe('nieuwe advertentie', () => {
  it('levert NEW_LISTING en bij een zekere particulier ook FSBO_DETECTED', () => {
    const events = detectNewListing('l1', 'private', true, NOW, null)
    expect(events.map((event) => event.type)).toEqual(['NEW_LISTING', 'FSBO_DETECTED'])
  })

  it('meldt geen FSBO als de classificatie niet zeker genoeg is', () => {
    // Een FSBO-melding voor een woning die bij een collega staat, is precies het
    // bericht dat een makelaar laat opzeggen.
    const events = detectNewListing('l1', 'unknown', false, NOW, null)
    expect(events.map((event) => event.type)).toEqual(['NEW_LISTING'])
  })
})

describe('prijswijzigingen', () => {
  it('rekent een daling correct uit', () => {
    const [event] = detectPriceChange(state(), observation({ price: 465_000 }), 0.5)

    expect(event?.type).toBe('PRICE_DROP')
    expect(event?.oldPrice).toBe(495_000)
    expect(event?.newPrice).toBe(465_000)
    expect(event?.absoluteDrop).toBe(30_000)
    expect(event?.percentageDrop).toBeCloseTo(6.06, 1)
  })

  it('negeert ruis onder de drempel', () => {
    // Bronnen ronden af en corrigeren typefouten. 200 euro op 495.000 hoort
    // geen makelaar wakker te maken.
    expect(detectPriceChange(state(), observation({ price: 494_800 }), 0.5)).toHaveLength(0)
  })

  it('herkent ook een verhoging', () => {
    const [event] = detectPriceChange(state(), observation({ price: 520_000 }), 0.5)
    expect(event?.type).toBe('PRICE_INCREASE')
  })

  it('doet niets zonder prijs aan één van beide kanten', () => {
    expect(detectPriceChange(state({ price: null }), observation(), 0.5)).toHaveLength(0)
    expect(detectPriceChange(state(), observation({ price: null }), 0.5)).toHaveLength(0)
  })

  it('geeft dezelfde dedupeKey voor dezelfde wijziging op dezelfde dag', () => {
    const a = detectPriceChange(state(), observation({ price: 465_000 }), 0.5)[0]
    const b = detectPriceChange(state(), observation({ price: 465_000 }), 0.5)[0]
    expect(a?.dedupeKey).toBe(b?.dedupeKey)
  })
})

describe('verkoperovergang', () => {
  it('herkent de overstap van kantoor naar particulier', () => {
    // Commercieel het interessantst: het mandaat is afgelopen of opgezegd.
    const [event] = detectSellerTransition(
      state({ sellerType: 'professional' }),
      observation({ sellerType: 'private' }),
    )
    expect(event?.type).toBe('AGENCY_TO_PRIVATE')
  })

  it('telt "onbekend" aan geen van beide kanten mee', () => {
    // Dat wij beter zijn gaan kijken is geen overstap, en daar mag geen melding
    // uit volgen.
    expect(
      detectSellerTransition(state({ sellerType: 'unknown' }), observation({ sellerType: 'private' })),
    ).toHaveLength(0)
    expect(
      detectSellerTransition(state({ sellerType: 'private' }), observation({ sellerType: 'unknown' })),
    ).toHaveLength(0)
  })
})

describe('stale-detectie', () => {
  it('meldt elke gepasseerde drempel precies één keer', () => {
    const listing = state({ firstSeenAt: new Date(NOW.getTime() - 95 * DAY) })
    const events = detectStaleListing(listing, NOW, [30, 60, 90])

    expect(events.map((event) => event.type)).toEqual(['STALE_30', 'STALE_60', 'STALE_90'])
  })

  it('herhaalt niet wat al gemeld is', () => {
    const listing = state({
      firstSeenAt: new Date(NOW.getTime() - 95 * DAY),
      staleDaysReported: [30, 60],
    })

    expect(detectStaleListing(listing, NOW, [30, 60, 90]).map((event) => event.type)).toEqual([
      'STALE_90',
    ])
  })

  it('slaat drempels over waarvoor geen eventtype bestaat', () => {
    // STALE_THRESHOLD_DAYS="30,45" mag geen event opleveren dat de rest van het
    // systeem niet kent.
    const listing = state({ firstSeenAt: new Date(NOW.getTime() - 50 * DAY) })
    expect(detectStaleListing(listing, NOW, [30, 45]).map((event) => event.type)).toEqual(['STALE_30'])
  })
})

describe('intrekking', () => {
  it('meldt niets na één gemiste run', () => {
    // Bronnen paginëren, haperen en doen onderhoud. Meteen REMOVED melden geeft
    // bij de volgende run een RELISTED — over een herplaatsing die nooit gebeurde.
    expect(detectRemoval(state({ missedRuns: 1 }), 3, NOW)).toHaveLength(0)
    expect(detectRemoval(state({ missedRuns: 2 }), 3, NOW)).toHaveLength(0)
  })

  it('meldt pas op de drempel', () => {
    const [event] = detectRemoval(state({ missedRuns: 3 }), 3, NOW)
    expect(event?.type).toBe('LISTING_REMOVED')
  })
})

describe('herplaatsing', () => {
  const previous = {
    id: 'oud',
    removedAt: new Date(NOW.getTime() - 40 * DAY),
    lastSeenAt: new Date(NOW.getTime() - 45 * DAY),
    price: 495_000,
  }

  it('herkent een herplaatsing binnen het venster', () => {
    const [event] = detectRelist('nieuw', previous, observation({ price: 465_000 }), 365)

    expect(event?.type).toBe('RELISTED')
    expect(event?.newPrice).toBe(465_000)
    expect(event?.detail).toMatch(/40 dagen/)
  })

  it('is buiten het venster geen herplaatsing maar een nieuwe verkoop', () => {
    const old = { ...previous, removedAt: new Date(NOW.getTime() - 800 * DAY) }
    expect(detectRelist('nieuw', old, observation(), 365)).toHaveLength(0)
  })
})

describe('detectUpdateEvents', () => {
  it('bundelt prijs, verkoper en ouderdom in leesvolgorde', () => {
    const listing = state({
      firstSeenAt: new Date(NOW.getTime() - 65 * DAY),
      sellerType: 'professional',
    })

    const events = detectUpdateEvents(listing, observation({ price: 465_000, sellerType: 'private' }), {
      minPriceChangePercent: 0.5,
      staleThresholdsDays: [30, 60, 90],
    })

    expect(events.map((event) => event.type)).toEqual([
      'PRICE_DROP',
      'AGENCY_TO_PRIVATE',
      'STALE_30',
      'STALE_60',
    ])
  })
})

describe('van event naar kans', () => {
  it('maakt van een zekere FSBO een NEW_FSBO', () => {
    expect(
      opportunityTypeFor({
        eventType: 'FSBO_DETECTED',
        sellerType: 'private',
        isConfidentPrivate: true,
        priceDropCount: 0,
      }),
    ).toBe('NEW_FSBO')
  })

  it('onderscheidt een tweede prijsverlaging van de eerste', () => {
    // Eén verlaging kan een correctie zijn; twee is een verkoper die beweegt.
    expect(
      opportunityTypeFor({
        eventType: 'PRICE_DROP',
        sellerType: 'private',
        isConfidentPrivate: true,
        priceDropCount: 1,
      }),
    ).toBe('PRIVATE_PRICE_DROP')

    expect(
      opportunityTypeFor({
        eventType: 'PRICE_DROP',
        sellerType: 'private',
        isConfidentPrivate: true,
        priceDropCount: 2,
      }),
    ).toBe('PRIVATE_MULTIPLE_PRICE_DROP')
  })

  it('levert geen kans op bij een professionele verkoper', () => {
    // Daar is het mandaat al vergeven; er als kans over melden vult de lijst met
    // werk dat niets oplevert.
    for (const eventType of ['FSBO_DETECTED', 'PRICE_DROP', 'STALE_60', 'RELISTED'] as const) {
      expect(
        opportunityTypeFor({
          eventType,
          sellerType: 'professional',
          isConfidentPrivate: false,
          priceDropCount: 2,
        }),
        eventType,
      ).toBeNull()
    }
  })

  it('laat AGENCY_TO_PRIVATE door zonder zekere classificatie', () => {
    // De overstap zelf is het signaal; de eventdetectie stelde al vast dát het
    // verkopertype omsloeg.
    expect(
      opportunityTypeFor({
        eventType: 'AGENCY_TO_PRIVATE',
        sellerType: 'private',
        isConfidentPrivate: false,
        priceDropCount: 0,
      }),
    ).toBe('AGENCY_TO_PRIVATE')
  })

  it('geeft marktinformatie zonder kans geen type', () => {
    for (const eventType of ['NEW_LISTING', 'PRICE_INCREASE', 'LISTING_REMOVED', 'PRIVATE_TO_AGENCY'] as const) {
      expect(
        opportunityTypeFor({
          eventType,
          sellerType: 'private',
          isConfidentPrivate: true,
          priceDropCount: 0,
        }),
        eventType,
      ).toBeNull()
    }
  })

  it('laat een verse FSBO sneller verlopen dan een lang lopende', () => {
    // Over een week hebben er al vijf kantoren gebeld; een woning van 90 dagen
    // is over een maand nog steeds een gesprek waard.
    expect(expiryDaysFor('NEW_FSBO', 30)).toBeLessThan(expiryDaysFor('STALE_FSBO', 30))
    expect(expiryDaysFor('DORMANT_VALUATION_LEAD', 30)).toBeGreaterThanOrEqual(30)
  })
})
