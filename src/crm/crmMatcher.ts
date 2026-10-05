import { normalizedSimilarity } from '@/lib/text'

/**
 * De brug tussen een marktsignaal en het klantenbestand van één kantoor.
 *
 * ─── WAAROM DIT STRENGER IS DAN DE PROPERTY MATCHING ─────────────────────────
 *
 * Een verkeerd gekoppeld pand levert een rommelige timeline op: vervelend,
 * zichtbaar, herstelbaar. Een verkeerd gekoppeld contact laat een makelaar een
 * vreemde opbellen met "u vroeg in 2019 een schatting bij ons aan". Dat is geen
 * datakwaliteitsprobleem maar een gênant telefoongesprek, en in het ergste geval
 * een klacht over hoe dit kantoor met persoonsgegevens omgaat.
 *
 * Vandaar CRM_MATCH_AUTO_THRESHOLD (0.80) boven PROPERTY_MATCH_THRESHOLD (0.78),
 * en vandaar de harde regel hieronder.
 *
 * ─── DE HARDE REGEL: NAAM ALLEEN IS NOOIT GENOEG ─────────────────────────────
 *
 * "Jan Peeters" staat honderden keren in België. Naamgelijkenis mag bijdragen,
 * maar kan op zichzelf nooit boven de bevestigingsdrempel komen — ook niet bij
 * een perfecte match, ook niet in combinatie met dezelfde gemeente. Er moet
 * altijd een tweede, hard gegeven zijn: een telefoonnummer, een e-mailadres of
 * een adres.
 *
 * ─── DE TENANTGRENS ──────────────────────────────────────────────────────────
 *
 * Deze functie krijgt alleen kandidaten van één kantoor mee. Dat is geen detail
 * maar de kern: `CrmContact` is per definitie tenantdata, en de aanroeper haalt
 * kandidaten uitsluitend op met een `agencyId`-filter.
 */

export type ContactPropertyRoleValue =
  | 'OWNER'
  | 'FORMER_OWNER'
  | 'BUYER'
  | 'SELLER'
  | 'TENANT'
  | 'VALUATION_SUBJECT'
  | 'INTERESTED'

/**
 * Rollen die betekenen "deze persoon gaat over dít pand". Een `BUYER` die ooit
 * naar dit huis kwam kijken hoort daar niet bij: die is geen eigenaar en heeft
 * niets te verkopen.
 */
const OWNERSHIP_ROLES: readonly ContactPropertyRoleValue[] = [
  'OWNER',
  'FORMER_OWNER',
  'SELLER',
  'VALUATION_SUBJECT',
]

export interface ContactPropertyLink {
  propertyId: string | null
  addressMatchKey: string | null
  role: ContactPropertyRoleValue
}

export interface CrmMatchCandidate {
  id: string
  displayName: string | null
  phoneE164: string | null
  emailNormalized: string | null
  nameNormalized: string | null
  addressMatchKey: string | null
  postalCode: string | null
  propertyRelations: readonly ContactPropertyLink[]
}

/** De marktkant waarmee vergeleken wordt. */
export interface MarketSideForCrmMatch {
  propertyId: string | null
  propertyMatchKey: string | null
  postalCode: string | null
  sellerName: string | null
  sellerNameNormalized: string | null
  sellerPhoneE164: string | null
  sellerEmailNormalized: string | null
}

export interface CrmMatchResult {
  contactId: string
  /** 0–1. Hoe zeker we zijn dat dit dezelfde persoon is. */
  confidence: number
  reasons: string[]
  /**
   * Weet het kantoor uit eigen dossier dat dit contact bij dít pand hoort? Het
   * scherpste signaal dat bestaat, en apart doorgegeven omdat de scoring er een
   * eigen factor voor heeft.
   */
  isKnownOwner: boolean
}

export interface CrmMatcherOptions {
  autoThreshold: number
  reviewThreshold: number
}

/** Zonder een hard gegeven blijft de zekerheid hieronder hangen. Zie de kop. */
const NAME_ONLY_CEILING = 0.45

const KNOWN_OWNER_FLOOR = 0.97
const ADDRESS_MATCH_FLOOR = 0.9
const PHONE_MATCH_FLOOR = 0.88
const EMAIL_MATCH_FLOOR = 0.86

interface Evidence {
  confidence: number
  reasons: string[]
  isKnownOwner: boolean
  /** Is er iets anders dan een naam dat de koppeling draagt? */
  hasHardSignal: boolean
}

function evaluate(market: MarketSideForCrmMatch, candidate: CrmMatchCandidate): Evidence {
  const reasons: string[] = []
  let confidence = 0
  let isKnownOwner = false
  let hasHardSignal = false

  // ── 1. Bekend verband met dit pand ────────────────────────────────────────
  //
  // Geen gelijkenis maar een feit uit de eigen dossiers van het kantoor.
  for (const relation of candidate.propertyRelations) {
    if (!OWNERSHIP_ROLES.includes(relation.role)) continue

    const sameProperty =
      market.propertyId !== null && relation.propertyId === market.propertyId
    const sameAddress =
      market.propertyMatchKey !== null && relation.addressMatchKey === market.propertyMatchKey

    if (sameProperty || sameAddress) {
      isKnownOwner = true
      hasHardSignal = true
      confidence = Math.max(confidence, KNOWN_OWNER_FLOOR)
      reasons.push(
        sameProperty
          ? 'Staat in jullie dossier als betrokkene bij dit pand'
          : 'Jullie dossier koppelt dit contact aan dit adres',
      )
      break
    }
  }

  // ── 2. Adres van het contact zelf ─────────────────────────────────────────
  if (
    !isKnownOwner &&
    market.propertyMatchKey !== null &&
    candidate.addressMatchKey === market.propertyMatchKey
  ) {
    hasHardSignal = true
    confidence = Math.max(confidence, ADDRESS_MATCH_FLOOR)
    reasons.push('Het adres in jullie CRM is het adres van deze advertentie')
  }

  // ── 3. Telefoonnummer ─────────────────────────────────────────────────────
  const phoneMatches =
    market.sellerPhoneE164 !== null && candidate.phoneE164 === market.sellerPhoneE164

  if (phoneMatches) {
    hasHardSignal = true
    confidence = Math.max(confidence, PHONE_MATCH_FLOOR)
    reasons.push('Zelfde telefoonnummer als in jullie CRM')
  }

  // ── 4. E-mailadres ────────────────────────────────────────────────────────
  if (
    market.sellerEmailNormalized !== null &&
    candidate.emailNormalized === market.sellerEmailNormalized
  ) {
    hasHardSignal = true
    confidence = Math.max(confidence, EMAIL_MATCH_FLOOR)
    reasons.push('Zelfde e-mailadres als in jullie CRM')
  }

  // ── 5. Naam ───────────────────────────────────────────────────────────────
  //
  // Bevestigend, nooit dragend. Een naamtreffer bovenop een telefoonnummer maakt
  // van "waarschijnlijk" bijna "zeker"; een naamtreffer alléén zegt weinig.
  let nameScore = 0
  if (market.sellerNameNormalized && candidate.nameNormalized) {
    nameScore = normalizedSimilarity(market.sellerNameNormalized, candidate.nameNormalized)

    if (nameScore >= 0.92) {
      reasons.push(`Naam komt overeen (${candidate.displayName ?? candidate.nameNormalized})`)
      confidence = hasHardSignal
        ? Math.min(0.99, confidence + 0.06)
        : Math.max(confidence, 0.4)
    } else if (nameScore >= 0.75) {
      reasons.push('Naam lijkt sterk op een contact in jullie CRM')
      confidence = hasHardSignal ? Math.min(0.99, confidence + 0.02) : Math.max(confidence, 0.3)
    }
  }

  // ── 6. Zelfde gemeente ────────────────────────────────────────────────────
  if (
    market.postalCode !== null &&
    candidate.postalCode === market.postalCode &&
    nameScore >= 0.75
  ) {
    reasons.push(`Zelfde postcode (${market.postalCode})`)
    confidence = hasHardSignal ? Math.min(0.99, confidence + 0.02) : Math.max(confidence, 0.42)
  }

  // De harde regel uit de kop, afgedwongen in plaats van beloofd.
  if (!hasHardSignal) {
    confidence = Math.min(confidence, NAME_ONLY_CEILING)
    if (confidence > 0) {
      reasons.push('Alleen naamgelijkenis — te weinig om automatisch te koppelen')
    }
  }

  return { confidence, reasons, isKnownOwner, hasHardSignal }
}

/**
 * Het beste CRM-contact bij dit marktsignaal.
 *
 * Geeft `null` wanneer niets de reviewdrempel haalt. Tussen review- en
 * autodrempel komt er wél een resultaat terug: het dashboard toont dat als "te
 * bevestigen", en de alertregel met `requireCrmMatch` negeert het.
 */
export function matchCrmContact(
  market: MarketSideForCrmMatch,
  candidates: readonly CrmMatchCandidate[],
  options: CrmMatcherOptions,
): CrmMatchResult | null {
  let best: (Evidence & { contactId: string }) | null = null

  for (const candidate of candidates) {
    const evidence = evaluate(market, candidate)
    if (evidence.confidence <= 0) continue

    if (best === null || evidence.confidence > best.confidence) {
      best = { ...evidence, contactId: candidate.id }
    }
  }

  if (best === null || best.confidence < options.reviewThreshold) return null

  return {
    contactId: best.contactId,
    confidence: Number(best.confidence.toFixed(3)),
    reasons: best.reasons,
    isKnownOwner: best.isKnownOwner,
  }
}

/** Haalt deze koppeling de drempel om als feit behandeld te worden? */
export function isConfirmedMatch(
  match: CrmMatchResult | null,
  options: CrmMatcherOptions,
): boolean {
  return match !== null && match.confidence >= options.autoThreshold
}
