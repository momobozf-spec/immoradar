import { describe, expect, it } from 'vitest'

import { applyMapping, detectDelimiter, parseCsv, suggestMapping } from '@/crm/csv'
import { computeContactChanges, findDuplicate, hasChanges } from '@/crm/dedupe'
import { detectDormantSignal } from '@/crm/dormant'
import {
  isUsableContact,
  normalizeContact,
  normalizeContactStatus,
  normalizeContactType,
  parseContactDate,
} from '@/crm/normalizeContact'
import { assessContact } from '@/leadrevive/relationshipEngine'

/**
 * LeadRevive: van een rommelig CSV naar een bruikbare relatie.
 *
 * ─── WAT HIER OP HET SPEL STAAT ──────────────────────────────────────────────
 *
 * Dit raakt het klantenbestand van het kantoor — de gevoeligste data in het
 * systeem, en de enige die wij niet kunnen herstellen als hij verkeerd landt.
 * De tests zijn daarom vooral gericht op de twee manieren waarop dat misgaat:
 * twee mensen samenvoegen tot één, en een ingevulde waarde overschrijven met
 * niets.
 */

const NOW = new Date('2026-08-16T09:00:00Z')
const DAY = 86_400_000

describe('CSV lezen', () => {
  it('herkent het scheidingsteken dat Nederlandstalig Excel schrijft', () => {
    expect(detectDelimiter('voornaam;achternaam;email')).toBe(';')
    expect(detectDelimiter('voornaam,achternaam,email')).toBe(',')
  })

  it('telt scheidingstekens niet mee binnen aanhalingstekens', () => {
    // "Brussel, België" in een adresveld zou de komma anders tot winnaar maken
    // op een bestand dat puntkomma's gebruikt.
    expect(detectDelimiter('naam;adres;"Brussel, België";stad')).toBe(';')
  })

  it('leest velden met scheidingstekens en regeleindes erin', () => {
    const parsed = parseCsv('naam;notitie\n"Janssens, Pieter";"regel 1\nregel 2"')

    expect(parsed.header).toEqual(['naam', 'notitie'])
    expect(parsed.rows[0]?.[0]).toBe('Janssens, Pieter')
    expect(parsed.rows[0]?.[1]).toBe('regel 1\nregel 2')
  })

  it('leest verdubbelde aanhalingstekens', () => {
    const parsed = parseCsv('notitie\n"hij zei ""ja"""')
    expect(parsed.rows[0]?.[0]).toBe('hij zei "ja"')
  })

  it('verwijdert de BOM van een Excel-export', () => {
    // Zonder dit heet de eerste kolom "﻿voornaam" en herkent geen enkele
    // automatische kolomtoewijzing hem.
    const parsed = parseCsv('﻿voornaam;achternaam\nPieter;Janssens')
    expect(parsed.header[0]).toBe('voornaam')
  })

  it('meldt regels met een afwijkend aantal kolommen in plaats van ze te laten vallen', () => {
    const parsed = parseCsv('a;b;c\n1;2;3\n1;2')
    expect(parsed.malformedRows).toContain(3)
    expect(parsed.rows).toHaveLength(2)
  })
})

describe('kolommen raden', () => {
  it('herkent Nederlandse, Franse en Engelse kopteksten', () => {
    const mapping = suggestMapping(['Voornaam', 'Achternaam', 'E-mail', 'GSM', 'Gemeente'])
    expect(Object.values(mapping)).toContain('firstName')
    expect(Object.values(mapping)).toContain('lastName')
    expect(Object.values(mapping)).toContain('email')
    expect(Object.values(mapping)).toContain('phone')
    expect(Object.values(mapping)).toContain('city')
  })

  it('legt hetzelfde veld nooit op twee kolommen', () => {
    // "Telefoon" en "Telefoon 2" mogen niet allebei op `phone` belanden, want
    // dan overschrijft de tweede stilzwijgend het nummer waarop we hadden
    // kunnen matchen.
    const mapping = suggestMapping(['Telefoon', 'Telefoon 2', 'Tel privé'])
    const phones = Object.values(mapping).filter((field) => field === 'phone')
    expect(phones).toHaveLength(1)
  })

  it('markeert onbekende kolommen als negeren', () => {
    const mapping = suggestMapping(['Voornaam', 'Interne kolom XYZ'])
    expect(mapping['1']).toBe('ignore')
  })

  it('zet een rij om volgens de mapping', () => {
    const result = applyMapping(['Pieter', 'Janssens', ''], {
      '0': 'firstName',
      '1': 'lastName',
      '2': 'email',
    })

    expect(result.firstName).toBe('Pieter')
    expect(result.lastName).toBe('Janssens')
    // Lege cellen leveren geen veld op; anders zou "" een gevulde waarde wissen.
    expect(result.email).toBeUndefined()
  })
})

describe('datums uit een CRM-export', () => {
  it('leest Belgische datums dag-eerst', () => {
    // `new Date("03/04/2019")` geeft 4 maart — de Amerikaanse lezing. Elke
    // Belgische export bedoelt 3 april, en één maand verschil verschuift de
    // dormantie-drempel.
    const parsed = parseContactDate('03/04/2019')
    expect(parsed?.getUTCMonth()).toBe(3)
    expect(parsed?.getUTCDate()).toBe(3)
  })

  it('leest ISO-datums', () => {
    expect(parseContactDate('2019-04-03')?.getUTCMonth()).toBe(3)
  })

  it('geeft null bij onzin in plaats van een ongeldige datum', () => {
    expect(parseContactDate('onbekend')).toBeNull()
    expect(parseContactDate('')).toBeNull()
  })
})

describe('contacten normaliseren', () => {
  it('normaliseert naar matchsleutels zonder het origineel te vervangen', () => {
    const contact = normalizeContact({
      firstName: 'Pieter',
      lastName: 'Janssens',
      email: 'Pieter.Janssens@Example.BE',
      phone: '0476/11.22.33',
      address: 'Lindelaan 17, 9000 Gent',
    })

    // Wat het kantoor invoerde blijft leidend in de UI…
    expect(contact.displayName).toBe('Pieter Janssens')
    // …en daarnaast staan de sleutels waarop gematcht wordt.
    expect(contact.phoneE164).toBe('+32476112233')
    expect(contact.emailNormalized).toBe('pieter.janssens@example.be')
    expect(contact.addressMatchKey).toBe('9000:lindelaan:17')
    expect(contact.postalCode).toBe('9000')
    expect(contact.province).toBe('oost-vlaanderen')
  })

  it('herkent contacttypes in drie talen', () => {
    expect(normalizeContactType('Schattingsaanvraag')).toBe('VALUATION_LEAD')
    expect(normalizeContactType('vendeur')).toBe('SELLER')
    expect(normalizeContactType('koper')).toBe('BUYER')
    expect(normalizeContactType('')).toBe('UNKNOWN')
  })

  it('herkent statussen', () => {
    expect(normalizeContactStatus('verloren')).toBe('LOST')
    expect(normalizeContactStatus('gewonnen')).toBe('WON')
    expect(normalizeContactStatus('')).toBe('UNKNOWN')
  })

  it('weigert een rij zonder enig identificerend gegeven', () => {
    // Zo'n rij opslaan vervuilt het bestand met records waar niemand iets mee kan.
    expect(isUsableContact(normalizeContact({ notes: 'alleen een notitie' }))).toBe(false)
    expect(isUsableContact(normalizeContact({ phone: '0476112233' }))).toBe(true)
  })
})

describe('deduplicatie', () => {
  const bestaand = {
    id: 'contact-1',
    externalId: 'CRM-1',
    phoneE164: '+32476112233',
    emailNormalized: 'pieter.janssens@example.be',
    nameNormalized: 'janssens pieter',
    addressMatchKey: '9000:lindelaan:17',
    postalCode: '9000',
  }

  it('herkent hetzelfde CRM-id als hetzelfde record', () => {
    const result = findDuplicate(normalizeContact({ externalId: 'CRM-1', lastName: 'Janssens' }), [
      bestaand,
    ])
    expect(result.contactId).toBe('contact-1')
    expect(result.strength).toBe('exact')
  })

  it('herkent hetzelfde telefoonnummer', () => {
    const result = findDuplicate(normalizeContact({ phone: '+32476112233' }), [bestaand])
    expect(result.contactId).toBe('contact-1')
    expect(result.strength).toBe('strong')
  })

  it('voegt NOOIT samen op alleen een naam', () => {
    // Twee mensen samenvoegen is de enige fout hier die niet te herstellen is:
    // de gegevens van de een overschrijven die van de ander, en de
    // oorspronkelijke scheiding is weg.
    const result = findDuplicate(
      normalizeContact({ firstName: 'Pieter', lastName: 'Janssens' }),
      [bestaand],
    )
    expect(result.contactId).toBeNull()
  })

  it('voegt wel samen op naam plus exact adres', () => {
    const result = findDuplicate(
      normalizeContact({
        firstName: 'Pieter',
        lastName: 'Janssens',
        address: 'Lindelaan 17, 9000 Gent',
      }),
      [bestaand],
    )
    expect(result.contactId).toBe('contact-1')
    expect(result.strength).toBe('weak')
  })
})

describe('bijwerken zonder te overschrijven', () => {
  const bestaand = {
    firstName: 'Pieter',
    lastName: 'Janssens',
    displayName: 'Pieter Janssens',
    email: 'pieter@example.be',
    phone: '0476112233',
    address: 'Lindelaan 17',
    postalCode: '9000',
    city: 'Gent',
    emailNormalized: 'pieter@example.be',
    phoneE164: '+32476112233',
    nameNormalized: 'janssens pieter',
    addressMatchKey: '9000:lindelaan:17',
    contactType: 'BUYER',
    status: 'WON',
    leadType: 'Aankoop',
    assignedAgentName: 'Thomas',
    notes: 'Vlotte klant.',
    sourceCreatedAt: new Date('2019-03-14'),
    lastContactAt: new Date('2019-06-03'),
  }

  it('wist niets met een lege waarde', () => {
    // Een export waarin de notitiekolom ontbreekt zou anders alle notities van
    // het kantoor wissen.
    const changes = computeContactChanges(
      bestaand,
      normalizeContact({ firstName: 'Pieter', lastName: 'Janssens', notes: '', email: '' }),
    )
    expect(hasChanges(changes)).toBe(false)
  })

  it('laat een halve export de volledige naam niet verschralen', () => {
    // Een bestand met alleen een kolom "Voornaam" mag "Pieter Janssens" niet
    // terugbrengen tot "Pieter" — dat is stille schade aan het klantenbestand.
    const changes = computeContactChanges(bestaand, normalizeContact({ firstName: 'Pieter' }))
    expect(changes.displayName).toBeUndefined()
    expect(changes.nameNormalized).toBeUndefined()
  })

  it('laat een echte naamswijziging wel door', () => {
    const changes = computeContactChanges(
      bestaand,
      normalizeContact({ firstName: 'Pieter', lastName: 'De Vos' }),
    )
    expect(changes.displayName).toEqual({ from: 'Pieter Janssens', to: 'Pieter De Vos' })
  })

  it('legt per veld vast wat er wijzigde', () => {
    const changes = computeContactChanges(
      bestaand,
      normalizeContact({ firstName: 'Pieter', lastName: 'Janssens', notes: 'Overweegt te verkopen.' }),
    )

    expect(changes.notes).toEqual({ from: 'Vlotte klant.', to: 'Overweegt te verkopen.' })
  })

  it('laat UNKNOWN een eerder vastgesteld type niet terugzetten', () => {
    const changes = computeContactChanges(bestaand, normalizeContact({ firstName: 'Pieter' }))
    expect(changes.contactType).toBeUndefined()
  })

  it('schuift het laatste contact alleen vooruit', () => {
    const ouder = computeContactChanges(
      bestaand,
      normalizeContact({ firstName: 'Pieter', lastContactAt: '01/01/2018' }),
    )
    expect(ouder.lastContactAt).toBeUndefined()

    const nieuwer = computeContactChanges(
      bestaand,
      normalizeContact({ firstName: 'Pieter', lastContactAt: '01/06/2025' }),
    )
    expect(nieuwer.lastContactAt).toBeTruthy()
  })
})

describe('dormante relaties herkennen', () => {
  function dormantContext(overrides: Partial<Parameters<typeof detectDormantSignal>[0]> = {}) {
    return {
      contactType: 'VALUATION_LEAD' as const,
      status: 'LOST' as const,
      lastContactAt: new Date(NOW.getTime() - 640 * DAY),
      sourceCreatedAt: new Date(NOW.getTime() - 760 * DAY),
      interactionCount: 1,
      hasKnownPropertyRelation: true,
      dormantAfterDays: 365,
      now: NOW,
      ...overrides,
    }
  }

  it('herkent een slapende schattingsaanvraag', () => {
    const signal = detectDormantSignal(dormantContext())
    expect(signal?.type).toBe('DORMANT_VALUATION_LEAD')
    expect(signal?.reason).toMatch(/schatting/i)
  })

  it('laat een recent gesproken contact met rust', () => {
    const signal = detectDormantSignal(
      dormantContext({ lastContactAt: new Date(NOW.getTime() - 20 * DAY) }),
    )
    expect(signal).toBeNull()
  })

  it('wekt een koper pas na jaren, niet na twaalf maanden', () => {
    // Wie vorig jaar kocht gaat dit jaar niet verkopen. Elke koper na twaalf
    // maanden opvoeren maakt van LeadRevive een adressenlijst.
    const kortgeleden = detectDormantSignal(
      dormantContext({
        contactType: 'BUYER',
        status: 'WON',
        lastContactAt: new Date(NOW.getTime() - 400 * DAY),
      }),
    )
    expect(kortgeleden).toBeNull()

    const langgeleden = detectDormantSignal(
      dormantContext({
        contactType: 'BUYER',
        status: 'WON',
        lastContactAt: new Date(NOW.getTime() - 7 * 365 * DAY),
      }),
    )
    expect(langgeleden?.type).toBe('PREVIOUS_BUYER')
  })

  it('herkent een nooit opgevolgde lead', () => {
    const signal = detectDormantSignal(
      dormantContext({
        contactType: 'PROSPECT',
        status: 'UNKNOWN',
        lastContactAt: null,
        interactionCount: 0,
      }),
    )
    expect(signal?.type).toBe('UNCONTACTED_LEAD')
  })

  it('doet niets zonder enig tijdsanker', () => {
    // Zonder datum kunnen we niet uitleggen waarom dit contact vandaag opduikt.
    const signal = detectDormantSignal(
      dormantContext({ lastContactAt: null, sourceCreatedAt: null, interactionCount: 0 }),
    )
    expect(signal).toBeNull()
  })
})

describe('relatiebeoordeling', () => {
  const options = { dormantMonths: 12, minRelationshipScore: 45 }

  it('waardeert een schattingslead hoger dan een naam zonder geschiedenis', () => {
    const schatting = assessContact(
      {
        contactType: 'VALUATION_LEAD',
        status: 'LOST',
        sourceCreatedAt: new Date(NOW.getTime() - 760 * DAY),
        lastContactAt: new Date(NOW.getTime() - 640 * DAY),
        interactionCount: 2,
        hadValuation: true,
        hadMandate: false,
        propertyRoles: ['VALUATION_SUBJECT'],
      },
      NOW,
      options,
    )

    const koud = assessContact(
      {
        contactType: 'UNKNOWN',
        status: 'UNKNOWN',
        sourceCreatedAt: new Date(NOW.getTime() - 400 * DAY),
        lastContactAt: null,
        interactionCount: 0,
        hadValuation: false,
        hadMandate: false,
        propertyRoles: [],
      },
      NOW,
      options,
    )

    expect(schatting.relationshipScore).toBeGreaterThan(koud.relationshipScore)
    expect(schatting.reasons.length).toBeGreaterThan(0)
  })

  it('rekent de stilte in maanden uit', () => {
    const assessment = assessContact(
      {
        contactType: 'SELLER',
        status: 'LOST',
        sourceCreatedAt: new Date(NOW.getTime() - 900 * DAY),
        lastContactAt: new Date(NOW.getTime() - 540 * DAY),
        interactionCount: 3,
        hadValuation: false,
        hadMandate: true,
        propertyRoles: ['OWNER'],
      },
      NOW,
      options,
    )

    expect(assessment.monthsSinceLastContact).toBeGreaterThanOrEqual(17)
    expect(assessment.dormantSince).not.toBeNull()
  })
})
