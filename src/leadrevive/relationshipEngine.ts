import type { ContactPropertyRoleValue } from '@/crm/crmMatcher'
import type { ContactStatusValue, ContactTypeValue } from '@/crm/normalizeContact'
import type { LeadReviveOpportunityType } from '@/events/opportunityRules'
import { monthsBetween } from '@/lib/dates'

/**
 * LeadRevive: wat een bestaande relatie waard is, en wanneer ze rijp is.
 *
 * ─── DE AANNAME WAAR DIT OP RUST ─────────────────────────────────────────────
 *
 * Het klantenbestand van een gemiddeld Belgisch immokantoor bevat honderden
 * mensen die ooit een schatting vroegen, een bod deden of een pand kochten, en
 * daarna nooit meer gehoord zijn. Belgische eigenaars verhuizen gemiddeld na
 * acht tot tien jaar. Een contact uit 2016 dat sindsdien stil is, is dus geen
 * dood spoor maar een relatie die statistisch gezien nú in beweging komt.
 *
 * Dat is geen voorspelling van gedrag van een individu — het is een rangorde in
 * wie je eerst belt. De motor hieronder geeft daarom een score en een reden, en
 * nooit een bewering over wat iemand van plan is.
 *
 * ─── WAAROM DIT PUUR IS ──────────────────────────────────────────────────────
 *
 * Alles komt binnen als argument, inclusief `now`. De regel "twaalf maanden
 * stilte maakt een contact dormant" moet met twee objecten te testen zijn, niet
 * met een database vol testdata en een gemanipuleerde klok.
 */

export interface ContactStateForRevive {
  contactType: ContactTypeValue
  status: ContactStatusValue
  /** Wanneer het contact in het bron-CRM ontstond. */
  sourceCreatedAt: Date | null
  lastContactAt: Date | null
  /** Aantal geregistreerde contactmomenten. */
  interactionCount: number
  hadValuation: boolean
  /** Is er ooit een mandaat besproken of getekend? */
  hadMandate: boolean
  propertyRoles: readonly ContactPropertyRoleValue[]
}

export interface ReviveAssessment {
  /** 0–100. Wat de bestaande band waard is, los van enig marktsignaal. */
  relationshipScore: number
  /** Sinds wanneer het stil is. Null wanneer er recent nog contact was. */
  dormantSince: Date | null
  monthsSinceLastContact: number | null
  relationshipAgeMonths: number | null
  /** Nooit één contactmoment gehad — het goedkoopste werk dat er ligt. */
  neverContacted: boolean
  /** Levert dit contact op zichzelf een kans op? Null als er niets te wekken valt. */
  opportunityType: LeadReviveOpportunityType | null
  reasons: string[]
}

export interface ReviveOptions {
  /** Na hoeveel maanden stilte een contact dormant heet. */
  dormantMonths: number
  /** Minimale relatiescore voordat een dormant contact een eigen kans wordt. */
  minRelationshipScore: number
}

const OWNERSHIP_ROLES: readonly ContactPropertyRoleValue[] = [
  'OWNER',
  'FORMER_OWNER',
  'SELLER',
  'VALUATION_SUBJECT',
]

/**
 * Een koper met een adres in het dossier: het kantoor kent het pand dat hij
 * kocht. Telt mee voor de relatie, maar niet als bewezen eigendom — het adres in
 * een export kan ook zijn huidige woonadres zijn.
 */
const RELATIONSHIP_ROLES: readonly ContactPropertyRoleValue[] = [...OWNERSHIP_ROLES, 'BUYER']

export function assessContact(
  contact: ContactStateForRevive,
  now: Date,
  options: ReviveOptions,
): ReviveAssessment {
  const reasons: string[] = []

  const monthsSinceLastContact = contact.lastContactAt
    ? monthsBetween(contact.lastContactAt, now)
    : null

  const relationshipAgeMonths = contact.sourceCreatedAt
    ? monthsBetween(contact.sourceCreatedAt, now)
    : null

  const neverContacted = contact.interactionCount === 0 && contact.lastContactAt === null

  // ── Relatiescore ──────────────────────────────────────────────────────────

  let score = 0

  const knowsProperty = contact.propertyRoles.some((role) => RELATIONSHIP_ROLES.includes(role))
  if (knowsProperty) {
    score += 25
    reasons.push('Jullie dossier koppelt dit contact aan een pand')
  }

  if (contact.status === 'WON' || contact.contactType === 'FORMER_CLIENT') {
    score += 30
    reasons.push('Was eerder klant van het kantoor')
  }

  if (contact.hadValuation || contact.contactType === 'VALUATION_LEAD') {
    score += 20
    reasons.push('Kreeg eerder een schatting of vroeg er een aan')
  }

  if (contact.hadMandate) {
    score += 10
    reasons.push('Er is eerder over een mandaat gesproken')
  }

  if (contact.interactionCount >= 5) {
    score += 15
    reasons.push(`${contact.interactionCount} geregistreerde contactmomenten`)
  } else if (contact.interactionCount >= 2) {
    score += 8
    reasons.push(`${contact.interactionCount} geregistreerde contactmomenten`)
  }

  if (relationshipAgeMonths !== null && relationshipAgeMonths >= 24) {
    const years = Math.floor(relationshipAgeMonths / 12)
    score += Math.min(10, years * 2)
    reasons.push(`Relatie bestaat al ${years} jaar`)
  }

  const relationshipScore = Math.max(0, Math.min(100, score))

  // ── Dormant? ──────────────────────────────────────────────────────────────

  const isDormant =
    monthsSinceLastContact !== null
      ? monthsSinceLastContact >= options.dormantMonths
      : // Nooit contact gehad telt als dormant zodra het contact zelf oud genoeg
        // is. Een lead van gisteren die nog niet gebeld is, is geen slapende
        // relatie maar gewoon werk van vandaag.
        relationshipAgeMonths !== null && relationshipAgeMonths >= 1

  const dormantSince =
    isDormant && contact.lastContactAt
      ? contact.lastContactAt
      : isDormant
        ? contact.sourceCreatedAt
        : null

  if (isDormant && monthsSinceLastContact !== null) {
    reasons.push(`${monthsSinceLastContact} maanden geen contact meer`)
  }

  return {
    relationshipScore,
    dormantSince,
    monthsSinceLastContact,
    relationshipAgeMonths,
    neverContacted,
    opportunityType: deriveOpportunityType(contact, {
      isDormant,
      neverContacted,
      knowsProperty,
      relationshipAgeMonths,
      relationshipScore,
      options,
    }),
    reasons,
  }
}

interface DerivationInput {
  isDormant: boolean
  neverContacted: boolean
  knowsProperty: boolean
  relationshipAgeMonths: number | null
  relationshipScore: number
  options: ReviveOptions
}

/**
 * Welk kanstype past bij dit contact.
 *
 * De volgorde is de rangorde van bruikbaarheid, en dat is bewust. Een contact
 * kan aan meerdere beschrijvingen voldoen — een oud-klant die ooit een schatting
 * vroeg is allebei — en dan hoort de specifiekste te winnen, want die geeft de
 * makelaar het beste openingszinnetje.
 *
 * ─── WAAROM DE RELATIEDREMPEL NIET OVERAL GELDT ──────────────────────────────
 *
 * Een schattingsaanvraag, een verloren mandaat, een verkoper die afhaakte of een
 * koper van vijf jaar of langer geleden: bij die categorieën ís de definitie de
 * reden om te bellen (zie docs/leadrevive.md). Een CSV-export draagt geen
 * interactiegeschiedenis, dus hun relatiescore blijft laag — 25 voor een bekend
 * pand plus hooguit 10 voor de leeftijd. Met de drempel ervoor kwamen ze uit een
 * import nooit boven, en leverde LeadRevive alleen schattingen en oud-klanten op.
 * De drempel blijft gelden voor oud-klanten, en de eindscore
 * (`MIN_OPPORTUNITY_SCORE`) blijft voor iedereen de laatste filter.
 */
function deriveOpportunityType(
  contact: ContactStateForRevive,
  input: DerivationInput,
): LeadReviveOpportunityType | null {
  // Een nooit opgevolgde lead is geen "slapende relatie" maar een gat in de
  // opvolging. Die staat vooraan omdat het het goedkoopste werk is dat er ligt.
  // Wel met een tijdsanker (zonder aanmaakdatum is niet uit te leggen waarom hij
  // vandaag opduikt) en niet voor huurders: daar valt niets te verkopen.
  if (input.neverContacted) {
    const anchored = input.relationshipAgeMonths !== null && input.relationshipAgeMonths >= 1
    if (anchored && contact.status !== 'LOST' && contact.contactType !== 'TENANT') {
      return 'UNCONTACTED_LEAD'
    }
    return null
  }

  if (!input.isDormant) return null

  // Verloren mandaat: een mandaatgesprek dat niet doorging, of een verkoper met
  // een bekend pand die als verloren staat — in een CSV is dat dezelfde feit.
  if (
    contact.status === 'LOST' &&
    (contact.hadMandate || (contact.contactType === 'SELLER' && input.knowsProperty))
  ) {
    return 'LOST_MANDATE'
  }

  if (contact.contactType === 'VALUATION_LEAD' && contact.status !== 'WON') {
    return 'DORMANT_VALUATION_LEAD'
  }

  if (contact.contactType === 'SELLER' && contact.status !== 'WON') {
    return 'FORMER_SELLER_PROSPECT'
  }

  // Een koper wordt pas een verkoopkans als er genoeg tijd voorbij is. Iemand
  // die vorig jaar kocht gaat dit jaar niet verkopen, en hem bellen zou de
  // relatie eerder schaden dan helpen.
  // Ook niet als "oud-klant": dat zou dezelfde koper langs een zijdeur na twee
  // jaar toch op de lijst zetten.
  if (contact.contactType === 'BUYER') {
    return input.relationshipAgeMonths !== null && input.relationshipAgeMonths >= 60
      ? 'PREVIOUS_BUYER'
      : null
  }

  if (contact.status === 'WON' || contact.contactType === 'FORMER_CLIENT') {
    if (input.relationshipScore < input.options.minRelationshipScore) return null
    return 'FORMER_CLIENT'
  }

  return null
}
