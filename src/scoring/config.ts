import type { OpportunityTypeValue } from '@/events/opportunityRules'

/**
 * De scoringconfiguratie: vijf dimensies, elk met eigen factoren en gewicht.
 *
 * ─── WAAROM VIJF DIMENSIES EN GEEN ÉÉN OPTELSOM ──────────────────────────────
 *
 * Een kans is goed om verschillende, onafhankelijke redenen: de verkoper wil
 * duidelijk iets (intent), je kent hem al (relationship), het is nú het moment
 * (timing), het ligt in je gebied (territory), en we weten redelijk zeker dat
 * het klopt (confidence).
 *
 * Die redenen recht optellen heeft twee kwalen. Ten eerste kaapt de dimensie met
 * de meeste factoren de score: "prijsverlaging" plus "meerdere verlagingen" is
 * twee keer hetzelfde feit — dat de verkoper beweegt. Ten tweede wordt alles
 * 100 zodra er genoeg factoren zijn, en een score die niet meer onderscheidt is
 * geen score maar een vinkje.
 *
 * Elke dimensie rekent daarom apart naar 0–100, en pas daarna worden ze gewogen.
 * Binnen een dimensie mag stapelen; over dimensies heen bepaalt het gewicht.
 *
 * ─── DE RELATIEDIMENSIE IS VOORWAARDELIJK ────────────────────────────────────
 *
 * Bij een kans zonder CRM-relatie telt `relationship` niet mee en worden de
 * overige gewichten geherschaald. Anders zou een perfecte FSBO in je eigen
 * postcode nooit boven de 75 kunnen komen, puur omdat we die verkoper toevallig
 * niet in het klantenbestand hebben — en dan zou de score straffen voor iets wat
 * de makelaar niet kan beïnvloeden.
 *
 * De combinatie van beide krijgt in plaats daarvan een expliciete bonus. Dat is
 * de these van dit product: een marktsignaal bij iemand die je al kent is meer
 * waard dan hetzelfde signaal bij een vreemde.
 */

export type ScoreDimension =
  | 'intent'
  | 'relationship'
  | 'timing'
  | 'territory'
  | 'confidence'

export const SCORE_DIMENSIONS: readonly ScoreDimension[] = [
  'intent',
  'relationship',
  'timing',
  'territory',
  'confidence',
]

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  intent: 'Verkoopintentie',
  relationship: 'Relatie',
  timing: 'Timing',
  territory: 'Gebied',
  confidence: 'Zekerheid',
}

/** Alles wat de scoringmotor over een kans moet weten. */
export interface ScoringContext {
  origin: 'MARKET' | 'LEADREVIVE' | 'CROSS'
  type: OpportunityTypeValue

  // ── Marktkant ─────────────────────────────────────────────────────────────
  sellerType: 'private' | 'professional' | 'unknown'
  /** 0–1, de zekerheid van de verkoperclassificatie. */
  sellerConfidence: number
  hasPhone: boolean

  /** Minuten sinds wij de advertentie voor het eerst zagen. */
  minutesSinceFirstSeen: number | null
  daysOnMarket: number | null

  priceDropCount: number
  /** Totale daling ten opzichte van de eerste prijs, in procenten. */
  totalPriceDropPercent: number

  isRelisted: boolean
  /** Hoe vaak dit pand al op de markt is geweest. */
  listingCycles: number

  price: number | null
  highValueThreshold: number

  // ── CRM-kant ──────────────────────────────────────────────────────────────
  hasCrmMatch: boolean
  /** 0–1. Hoe zeker we zijn dat het dezelfde persoon is. */
  crmMatchConfidence: number
  /**
   * Het scherpste signaal dat bestaat: het kantoor weet uit zijn eigen dossiers
   * dat dit contact eigenaar van dít pand is. Geen gelijkenis maar een feit.
   */
  isKnownOwnerOfProperty: boolean
  /** Maanden sinds het laatste contactmoment; null als er nooit contact was. */
  monthsSinceLastContact: number | null
  /** Hoe lang de relatie al bestaat, in maanden. */
  relationshipAgeMonths: number | null
  hadValuation: boolean
  wasClient: boolean
  /** Binnengekomen lead die nooit is opgevolgd. */
  neverContacted: boolean

  // ── Gebied ────────────────────────────────────────────────────────────────
  territoryMatch: 'postal_code' | 'municipality' | 'province' | 'none'
}

export interface ScoreReason {
  code: string
  label: string
  points: number
  dimension: ScoreDimension
}

export interface DimensionFactor {
  code: string
  dimension: ScoreDimension
  /** Bovengrens binnen de 0–100-schaal van de eigen dimensie. */
  maxPoints: number
  evaluate(context: ScoringContext): { points: number; label: string } | null
}

export interface ScoringConfig {
  /** Komt in `OpportunityScore.weightsVersion`, zodat een oude score te duiden blijft. */
  version: string
  factors: readonly DimensionFactor[]
  weights: Readonly<Record<ScoreDimension, number>>
  /** Maximale bonus voor een marktsignaal bij een bekende relatie. */
  crossBonusMax: number
  maxScore: number
}

const euro = (value: number): string => `€ ${value.toLocaleString('nl-BE')}`

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 'v1',
  maxScore: 100,
  crossBonusMax: 12,

  weights: {
    intent: 0.4,
    relationship: 0.22,
    timing: 0.15,
    territory: 0.11,
    confidence: 0.12,
  },

  factors: [
    // ─────────────────────────────────────────────────────────────────────────
    // INTENT — hoe sterk wijst dit erop dat hier een mandaat te winnen valt
    // ─────────────────────────────────────────────────────────────────────────
    {
      code: 'private_seller',
      dimension: 'intent',
      maxPoints: 45,
      evaluate(context) {
        if (context.sellerType !== 'private') return null
        return { points: 45, label: 'Verkoopt zonder makelaar' }
      },
    },
    {
      code: 'agency_to_private',
      dimension: 'intent',
      maxPoints: 25,
      evaluate(context) {
        if (context.type !== 'AGENCY_TO_PRIVATE') return null
        return { points: 25, label: 'Mandaat bij een collega is afgelopen' }
      },
    },
    {
      code: 'price_reduction',
      dimension: 'intent',
      maxPoints: 15,
      evaluate(context) {
        if (context.priceDropCount < 1) return null
        const drop =
          context.totalPriceDropPercent > 0
            ? ` (−${context.totalPriceDropPercent.toFixed(1)}%)`
            : ''
        return { points: 15, label: `Vraagprijs verlaagd${drop}` }
      },
    },
    {
      code: 'multiple_reductions',
      dimension: 'intent',
      maxPoints: 15,
      evaluate(context) {
        if (context.priceDropCount < 2) return null
        return {
          points: 15,
          label: `${context.priceDropCount} prijsverlagingen — verkoper beweegt`,
        }
      },
    },
    {
      code: 'relisted',
      dimension: 'intent',
      maxPoints: 20,
      evaluate(context) {
        if (!context.isRelisted) return null
        const cycles =
          context.listingCycles > 2 ? ` (${context.listingCycles}e keer op de markt)` : ''
        return { points: 20, label: `Eerder ingetrokken en opnieuw aangeboden${cycles}` }
      },
    },
    {
      code: 'long_on_market',
      dimension: 'intent',
      maxPoints: 20,
      evaluate(context) {
        const days = context.daysOnMarket
        if (days === null || days < 30) return null
        // Loopt op met de tijd: 30 dagen is een signaal, 120 dagen is een
        // verkoper die weet dat het zo niet lukt.
        const points = days >= 90 ? 20 : days >= 60 ? 15 : 10
        return { points, label: `${days} dagen online zonder verkoop` }
      },
    },
    {
      code: 'dormant_valuation',
      dimension: 'intent',
      maxPoints: 40,
      evaluate(context) {
        if (context.type !== 'DORMANT_VALUATION_LEAD') return null
        return { points: 40, label: 'Vroeg ooit een schatting aan en werd geen klant' }
      },
    },
    {
      code: 'former_seller_intent',
      dimension: 'intent',
      maxPoints: 35,
      evaluate(context) {
        if (context.type !== 'FORMER_SELLER_PROSPECT' && context.type !== 'LOST_MANDATE') {
          return null
        }
        return { points: 35, label: 'Wilde eerder verkopen; dat werd geen mandaat' }
      },
    },
    {
      code: 'never_contacted',
      dimension: 'intent',
      maxPoints: 25,
      evaluate(context) {
        if (!context.neverContacted) return null
        return { points: 25, label: 'Binnengekomen lead die nooit is opgevolgd' }
      },
    },
    {
      code: 'high_value',
      dimension: 'intent',
      maxPoints: 10,
      evaluate(context) {
        if (context.price === null || context.price < context.highValueThreshold) return null
        return { points: 10, label: `Hoge vraagprijs (${euro(context.price)})` }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // RELATIONSHIP — wat de bestaande band waard is
    // ─────────────────────────────────────────────────────────────────────────
    {
      code: 'known_owner',
      dimension: 'relationship',
      maxPoints: 55,
      evaluate(context) {
        if (!context.isKnownOwnerOfProperty) return null
        return {
          points: 55,
          label: 'Uit jullie eigen dossier: dit contact hoort bij dit pand',
        }
      },
    },
    {
      code: 'was_client',
      dimension: 'relationship',
      maxPoints: 30,
      evaluate(context) {
        if (!context.wasClient) return null
        return { points: 30, label: 'Was eerder klant van het kantoor' }
      },
    },
    {
      code: 'had_valuation',
      dimension: 'relationship',
      maxPoints: 20,
      evaluate(context) {
        if (!context.hadValuation) return null
        return { points: 20, label: 'Kreeg eerder een schatting van jullie' }
      },
    },
    {
      code: 'relationship_age',
      dimension: 'relationship',
      maxPoints: 15,
      evaluate(context) {
        const months = context.relationshipAgeMonths
        if (months === null || months < 12) return null
        const years = Math.floor(months / 12)
        return { points: Math.min(15, 5 * years), label: `Relatie bestaat al ${years} jaar` }
      },
    },
    {
      code: 'crm_known',
      dimension: 'relationship',
      maxPoints: 15,
      evaluate(context) {
        if (!context.hasCrmMatch) return null
        return { points: 15, label: 'Staat in jullie klantenbestand' }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TIMING — waarom nú
    // ─────────────────────────────────────────────────────────────────────────
    {
      code: 'fresh_listing',
      dimension: 'timing',
      maxPoints: 100,
      evaluate(context) {
        const minutes = context.minutesSinceFirstSeen
        if (minutes === null || minutes > 60) return null
        // Binnen tien minuten is de hoofdprijs: dan heeft nog geen enkel ander
        // kantoor gebeld. Daarna zakt het snel.
        if (minutes <= 10) {
          return { points: 100, label: `Nog geen 10 minuten online (${minutes} min)` }
        }
        return { points: 60, label: `Minder dan een uur online (${minutes} min)` }
      },
    },
    {
      code: 'recent_price_drop',
      dimension: 'timing',
      maxPoints: 70,
      evaluate(context) {
        if (context.priceDropCount < 1) return null
        if (context.type !== 'PRIVATE_PRICE_DROP' && context.type !== 'PRIVATE_MULTIPLE_PRICE_DROP') {
          return null
        }
        return { points: 70, label: 'Prijs is net verlaagd — het gesprek staat open' }
      },
    },
    {
      code: 'stale_milestone',
      dimension: 'timing',
      maxPoints: 65,
      evaluate(context) {
        if (context.type !== 'STALE_FSBO') return null
        const days = context.daysOnMarket ?? 0
        return { points: days >= 90 ? 65 : 50, label: 'Net een drempel gepasseerd op de markt' }
      },
    },
    {
      code: 'relist_moment',
      dimension: 'timing',
      maxPoints: 75,
      evaluate(context) {
        if (!context.isRelisted) return null
        return { points: 75, label: 'Opnieuw op de markt — nieuwe poging, nieuwe kans' }
      },
    },
    {
      code: 'dormancy_ripe',
      dimension: 'timing',
      maxPoints: 60,
      evaluate(context) {
        const months = context.monthsSinceLastContact
        if (months === null || months < 12) return null
        // Belgische eigenaars verhuizen gemiddeld na acht tot tien jaar; een
        // relatie van die leeftijd is rijp. Daarvóór loopt het geleidelijk op.
        const points = months >= 84 ? 60 : months >= 36 ? 45 : 30
        return { points, label: `${Math.floor(months / 12)} jaar geen contact meer` }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TERRITORY — past het in het werkgebied
    // ─────────────────────────────────────────────────────────────────────────
    {
      code: 'territory_match',
      dimension: 'territory',
      maxPoints: 100,
      evaluate(context) {
        switch (context.territoryMatch) {
          case 'postal_code':
            return { points: 100, label: 'Exacte match met jouw postcodegebied' }
          case 'municipality':
            return { points: 75, label: 'Ligt in jouw gemeente' }
          case 'province':
            return { points: 40, label: 'Ligt in jouw provincie' }
          case 'none':
            return null
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIDENCE — hoe zeker weten we dit
    // ─────────────────────────────────────────────────────────────────────────
    {
      code: 'seller_confidence',
      dimension: 'confidence',
      maxPoints: 55,
      evaluate(context) {
        if (context.sellerType === 'unknown') return null
        const points = Math.round(55 * context.sellerConfidence)
        return {
          points,
          label: `Verkopertype ${Math.round(context.sellerConfidence * 100)}% zeker`,
        }
      },
    },
    {
      code: 'crm_match_confidence',
      dimension: 'confidence',
      maxPoints: 30,
      evaluate(context) {
        if (!context.hasCrmMatch) return null
        const points = Math.round(30 * context.crmMatchConfidence)
        return {
          points,
          label: `CRM-koppeling ${Math.round(context.crmMatchConfidence * 100)}% zeker`,
        }
      },
    },
    {
      code: 'phone_available',
      dimension: 'confidence',
      maxPoints: 15,
      evaluate(context) {
        if (!context.hasPhone) return null
        return { points: 15, label: 'Telefoonnummer beschikbaar' }
      },
    },
  ],
}
