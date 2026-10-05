import type { DetectedEventType, SellerTypeValue } from './types'

/**
 * Van marktgebeurtenis naar commerciële kans.
 *
 * ─── DE SCHEIDING DIE HIER GEMAAKT WORDT ─────────────────────────────────────
 *
 * Een `ListingEvent` is een feit over de markt: de prijs zakte, de advertentie
 * verdween, het pand kwam terug. Feiten zijn voor iedereen hetzelfde.
 *
 * Een `Opportunity` is een oordeel: dit is het waard dat een makelaar er tijd in
 * steekt. Dat oordeel hangt af van wie er kijkt (gebied, abonnement) en van wat
 * we over de verkoper weten.
 *
 * Deze module maakt precies die vertaalslag, en niets anders. Ze bepaalt niet
 * wélk kantoor de kans krijgt (dat doet de territory-matching), niet hoe goed de
 * kans is (dat doet de scoring) en niet of er een bestaande klantrelatie achter
 * zit (dat doet de CRM-matching).
 *
 * ─── WAAROM ALLEEN PARTICULIERE VERKOPERS ────────────────────────────────────
 *
 * Een prijsdaling bij een collega-kantoor is marktinformatie — die hoort in de
 * Market Radar, niet in de opportunitylijst. Er is daar geen mandaat te winnen;
 * het pand ís al aan iemand gegund. Er als "kans" over melden zou de lijst
 * vullen met werk dat niets oplevert, en dat is de snelste manier om een
 * makelaar de meldingen te laten uitzetten.
 */

/** De kanstypen die uit een extern marktsignaal ontstaan. */
export type MarketOpportunityType =
  | 'NEW_FSBO'
  | 'STALE_FSBO'
  | 'PRIVATE_PRICE_DROP'
  | 'PRIVATE_MULTIPLE_PRICE_DROP'
  | 'PRIVATE_RELIST'
  | 'AGENCY_TO_PRIVATE'

/** De kanstypen die LeadRevive uit het eigen klantenbestand haalt. */
export type LeadReviveOpportunityType =
  | 'DORMANT_VALUATION_LEAD'
  | 'FORMER_SELLER_PROSPECT'
  | 'FORMER_CLIENT'
  | 'PREVIOUS_BUYER'
  | 'LOST_MANDATE'
  | 'UNCONTACTED_LEAD'

export type OpportunityTypeValue = MarketOpportunityType | LeadReviveOpportunityType

export const MARKET_OPPORTUNITY_TYPES: readonly MarketOpportunityType[] = [
  'NEW_FSBO',
  'STALE_FSBO',
  'PRIVATE_PRICE_DROP',
  'PRIVATE_MULTIPLE_PRICE_DROP',
  'PRIVATE_RELIST',
  'AGENCY_TO_PRIVATE',
]

export const LEADREVIVE_OPPORTUNITY_TYPES: readonly LeadReviveOpportunityType[] = [
  'DORMANT_VALUATION_LEAD',
  'FORMER_SELLER_PROSPECT',
  'FORMER_CLIENT',
  'PREVIOUS_BUYER',
  'LOST_MANDATE',
  'UNCONTACTED_LEAD',
]

export function isMarketOpportunityType(value: OpportunityTypeValue): value is MarketOpportunityType {
  return (MARKET_OPPORTUNITY_TYPES as readonly string[]).includes(value)
}

export interface OpportunityRuleInput {
  eventType: DetectedEventType
  sellerType: SellerTypeValue
  /** Haalt de classificatie de drempel uit PRIVATE_CONFIDENCE_THRESHOLD? */
  isConfidentPrivate: boolean
  /** Hoeveel prijsverlagingen deze advertentie al kende, inclusief de huidige. */
  priceDropCount: number
}

/**
 * Welke opportunity hoort bij dit event, of `null` als het er geen oplevert.
 *
 * Twee keuzes die uitleg verdienen:
 *
 *  1. `AGENCY_TO_PRIVATE` is de enige die geen zekere particulier-classificatie
 *     eist. De overstap zelf is het signaal: dat een woning van een kantoor naar
 *     een eigenaar gaat betekent dat het mandaat weg is, ook als we de nieuwe
 *     verkoper nog niet met 85% zekerheid hebben geclassificeerd. De
 *     event-detectie heeft daar al vastgesteld dát het verkopertype omsloeg.
 *
 *  2. Een tweede prijsverlaging is een ander type dan de eerste. Eén verlaging
 *     kan een correctie zijn; twee is een verkoper die aan het bewegen is, en
 *     dat is het moment waarop een gesprek over een mandaat kans maakt. Ze in
 *     één type stoppen zou dat verschil onzichtbaar maken in de lijst.
 */
export function opportunityTypeFor(input: OpportunityRuleInput): MarketOpportunityType | null {
  switch (input.eventType) {
    case 'AGENCY_TO_PRIVATE':
      return 'AGENCY_TO_PRIVATE'

    case 'FSBO_DETECTED':
      return input.isConfidentPrivate ? 'NEW_FSBO' : null

    case 'STALE_30':
    case 'STALE_60':
    case 'STALE_90':
      return input.isConfidentPrivate ? 'STALE_FSBO' : null

    case 'PRICE_DROP':
      if (!input.isConfidentPrivate) return null
      return input.priceDropCount >= 2 ? 'PRIVATE_MULTIPLE_PRICE_DROP' : 'PRIVATE_PRICE_DROP'

    case 'RELISTED':
      return input.isConfidentPrivate ? 'PRIVATE_RELIST' : null

    // Marktinformatie zonder eigen kans. NEW_LISTING is al gedekt door
    // FSBO_DETECTED wanneer het een particulier is; een prijsstijging, een
    // intrekking en een overstap naar een kantoor zijn dingen die je wilt kunnen
    // terugzien in de timeline en de Market Radar, maar waar niet op gebeld wordt.
    case 'NEW_LISTING':
    case 'PRICE_INCREASE':
    case 'LISTING_REMOVED':
    case 'PRIVATE_TO_AGENCY':
      return null
  }
}

/** Nederlandse labels voor het dashboard en de alertberichten. */
export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityTypeValue, string> = {
  NEW_FSBO: 'Nieuwe particuliere verkoop',
  STALE_FSBO: 'Particulier, lang op de markt',
  PRIVATE_PRICE_DROP: 'Particulier verlaagde de prijs',
  PRIVATE_MULTIPLE_PRICE_DROP: 'Particulier verlaagde meermaals',
  PRIVATE_RELIST: 'Particulier opnieuw op de markt',
  AGENCY_TO_PRIVATE: 'Van kantoor naar particulier',

  DORMANT_VALUATION_LEAD: 'Slapende schattingsaanvraag',
  FORMER_SELLER_PROSPECT: 'Verloren verkoopprospect',
  FORMER_CLIENT: 'Oud-klant',
  PREVIOUS_BUYER: 'Eerdere koper',
  LOST_MANDATE: 'Verloren mandaat',
  UNCONTACTED_LEAD: 'Nooit opgevolgde lead',
}

/** Korte uitleg van wat de makelaar hier kan doen. */
export const OPPORTUNITY_TYPE_HINTS: Record<OpportunityTypeValue, string> = {
  NEW_FSBO:
    'Verkoopt zelf. Bel vroeg — de meeste particulieren schakelen alsnog een kantoor in.',
  STALE_FSBO:
    'Staat al lang online zonder resultaat. Het moment waarop zelf verkopen begint tegen te vallen.',
  PRIVATE_PRICE_DROP:
    'De verkoper beweegt in prijs. Dat is meestal het begin van bereidheid om te veranderen.',
  PRIVATE_MULTIPLE_PRICE_DROP:
    'Tweede verlaging. De vraagprijs was te hoog en de verkoper weet dat inmiddels.',
  PRIVATE_RELIST: 'Eerder ingetrokken en opnieuw geprobeerd. Een eerdere poging is mislukt.',
  AGENCY_TO_PRIVATE:
    'Het mandaat bij een collega is afgelopen of opgezegd. De eigenaar probeert het nu zelf.',

  DORMANT_VALUATION_LEAD:
    'Vroeg ooit een schatting en werd nooit klant. De reden om te schatten is er meestal nog.',
  FORMER_SELLER_PROSPECT:
    'Wilde verkopen, werd geen mandaat. Omstandigheden veranderen; de intentie kwam ergens vandaan.',
  FORMER_CLIENT: 'Was klant. Een bestaande relatie wint het van een koude oproep.',
  PREVIOUS_BUYER:
    'Kocht via het kantoor. Belgische eigenaars verhuizen gemiddeld na acht tot tien jaar.',
  LOST_MANDATE: 'Het mandaat ging naar een concurrent. Die loopt ooit af.',
  UNCONTACTED_LEAD: 'Kwam binnen en is nooit opgevolgd. Het goedkoopste werk dat er ligt.',
}

/**
 * Hoe lang een kans van dit type relevant blijft.
 *
 * Niet alle kansen verouderen even snel. Een verse FSBO is over een week een
 * andere zaak — dan hebben er al vijf kantoren gebeld. Een woning die 90 dagen
 * op de markt staat verandert daarentegen nauwelijks: die is over een maand nog
 * steeds een gesprek waard. En een dormante CRM-relatie veroudert het langzaamst
 * van alles: die lag er al twee jaar.
 */
export function expiryDaysFor(type: OpportunityTypeValue, defaultDays: number): number {
  switch (type) {
    case 'NEW_FSBO':
      return Math.min(defaultDays, 14)
    case 'PRIVATE_PRICE_DROP':
    case 'PRIVATE_MULTIPLE_PRICE_DROP':
      return Math.min(defaultDays, 21)
    case 'AGENCY_TO_PRIVATE':
    case 'PRIVATE_RELIST':
      return defaultDays
    case 'STALE_FSBO':
      return Math.max(defaultDays, 45)

    // LeadRevive-kansen hangen niet aan een advertentie die van de markt kan
    // gaan. Ze verlopen ruim, zodat ze niet elke maand opnieuw als "nieuw" in
    // de lijst springen.
    case 'DORMANT_VALUATION_LEAD':
    case 'FORMER_SELLER_PROSPECT':
    case 'FORMER_CLIENT':
    case 'PREVIOUS_BUYER':
    case 'LOST_MANDATE':
    case 'UNCONTACTED_LEAD':
      return Math.max(defaultDays, 90)
  }
}
