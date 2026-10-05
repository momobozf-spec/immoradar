import type { LeadReviveOpportunityType } from '@/events/opportunityRules'
import { daysBetween } from '@/lib/dates'

import type { ContactStatusValue, ContactTypeValue } from './normalizeContact'

/**
 * LeadRevive: welke contacten uit het eigen bestand verdienen vandaag aandacht?
 *
 * ─── DE EERLIJKHEID DIE DIT BESTAND MOET DRAGEN ──────────────────────────────
 *
 * Wat hier uitkomt is een *signaal*, geen bewijs. Dat iemand in 2024 een
 * schatting aanvroeg en sindsdien niets liet horen, betekent niet dat hij nu wil
 * verkopen. Het betekent dat er ooit een reden was om over verkopen na te
 * denken, dat die reden zelden verdwijnt, en dat niemand hem er sindsdien naar
 * gevraagd heeft.
 *
 * Die nuance is niet vrijblijvend. Een makelaar die deze lijst leest als
 * "verkopers" belt met de verkeerde toon en verbrandt precies de relatie die het
 * product wilde benutten. Vandaar dat elke categorie hieronder een `reason`
 * krijgt die zegt wat we wél weten, en nooit een conclusie die we niet kunnen
 * dragen.
 *
 * ─── WAAROM CATEGORIEËN EN GEEN ENKELE LIJST ─────────────────────────────────
 *
 * Een dormante schattingsaanvraag en een nooit opgevolgde lead vragen een ander
 * gesprek. Ze op één hoop gooien en op score sorteren zou de makelaar dwingen
 * per rij uit te zoeken waarom hij belt — precies het werk dat dit product uit
 * handen hoort te nemen.
 */

export interface DormantContext {
  contactType: ContactTypeValue
  status: ContactStatusValue

  lastContactAt: Date | null
  sourceCreatedAt: Date | null
  interactionCount: number

  hasKnownPropertyRelation: boolean

  /** Vanaf hoeveel dagen stilte een contact dormant heet. */
  dormantAfterDays: number
  now: Date
}

export interface DormantSignal {
  type: LeadReviveOpportunityType
  /** Wat we weten, in de voorzichtige vorm waarin we het weten. */
  reason: string
  /** 0–1. Hoe sterk dit signaal is — niet hoe waarschijnlijk een verkoop is. */
  strength: number
  /** Dagen stilte, voor de weergave. */
  silenceDays: number | null
}

/** Dagen sinds het laatste levensteken; valt terug op de aanmaakdatum. */
function silenceOf(context: DormantContext): number | null {
  const reference = context.lastContactAt ?? context.sourceCreatedAt
  if (!reference) return null
  return daysBetween(reference, context.now)
}

function monthsOf(days: number): number {
  return Math.floor(days / 30)
}

/**
 * Bepaalt of dit contact een LeadRevive-signaal oplevert, en welk.
 *
 * Er komt maximaal één signaal uit: de categorieën zijn geordend van sterkst
 * naar zwakst, en de eerste die past wint. Twee kaarten voor dezelfde persoon
 * zou betekenen dat de makelaar dezelfde man twee keer belt.
 */
export function detectDormantSignal(context: DormantContext): DormantSignal | null {
  const silence = silenceOf(context)

  // Zonder enig tijdsanker weten we niet of het stil is. Zo'n contact hoort niet
  // in LeadRevive: we zouden niet kunnen uitleggen waarom het vandaag opduikt.
  if (silence === null) return null

  const months = monthsOf(silence)
  const isDormant = silence >= context.dormantAfterDays

  // ── Nooit opgevolgd ───────────────────────────────────────────────────────
  //
  // Staat vooraan omdat het de goedkoopste categorie is: er is nooit een
  // gesprek geweest, dus er valt niets te herstellen — alleen te beginnen.
  if (context.interactionCount === 0 && context.lastContactAt === null && isDormant) {
    return {
      type: 'UNCONTACTED_LEAD',
      reason: `Kwam ${months} maanden geleden binnen en is nooit opgevolgd`,
      strength: 0.7,
      silenceDays: silence,
    }
  }

  // ── Slapende schattingsaanvraag ───────────────────────────────────────────
  //
  // De sterkste categorie. Iemand die een schatting vroeg, dacht na over
  // verkopen; dat er geen mandaat uit kwam betekent dat het gesprek ergens is
  // blijven liggen.
  if (context.contactType === 'VALUATION_LEAD' && isDormant) {
    return {
      type: 'DORMANT_VALUATION_LEAD',
      reason: `Vroeg een schatting aan, geen mandaat gevolgd, ${months} maanden stil`,
      strength: 0.85,
      silenceDays: silence,
    }
  }

  // ── Verloren mandaat ──────────────────────────────────────────────────────
  if (context.contactType === 'SELLER' && context.status === 'LOST' && context.hasKnownPropertyRelation) {
    return {
      type: 'LOST_MANDATE',
      reason: `Mandaat ging destijds niet door; pand bekend, ${months} maanden stil`,
      strength: 0.75,
      silenceDays: silence,
    }
  }

  // ── Verloren verkoopprospect ──────────────────────────────────────────────
  if (context.contactType === 'SELLER' && isDormant) {
    return {
      type: 'FORMER_SELLER_PROSPECT',
      reason: `Wilde eerder verkopen, ${months} maanden geen contact`,
      strength: 0.7,
      silenceDays: silence,
    }
  }

  // ── Eerdere koper ─────────────────────────────────────────────────────────
  //
  // Hier ligt de drempel bewust hoger dan de dormantie-grens. Iemand die vorig
  // jaar kocht gaat dit jaar niet verkopen; pas na een jaar of vijf wordt het
  // een zinnig gesprek. Zou je elke koper na twaalf maanden stilte opvoeren,
  // dan is LeadRevive een adressenlijst en geen selectie.
  if (context.contactType === 'BUYER') {
    const years = Math.floor(silence / 365)
    if (years >= 5) {
      return {
        type: 'PREVIOUS_BUYER',
        reason: `Kocht ${years} jaar geleden via het kantoor`,
        // Loopt op met de jaren en zit vast op 0.8: na vijftien jaar weet je
        // niet méér, alleen dat het langer geleden is.
        strength: Math.min(0.8, 0.45 + years * 0.05),
        silenceDays: silence,
      }
    }
    return null
  }

  // ── Oud-klant ─────────────────────────────────────────────────────────────
  if ((context.contactType === 'FORMER_CLIENT' || context.status === 'WON') && isDormant) {
    return {
      type: 'FORMER_CLIENT',
      reason: `Was klant, ${months} maanden geen contact`,
      strength: 0.6,
      silenceDays: silence,
    }
  }

  // ── Overige dormante relaties ─────────────────────────────────────────────
  //
  // Verhuurders en algemene prospects. Alleen wanneer er een pandrelatie bekend
  // is: zonder eigendom is er niets te verkopen, en dan is het geen signaal maar
  // een naam uit een lijst.
  if (
    isDormant &&
    context.hasKnownPropertyRelation &&
    (context.contactType === 'LANDLORD' || context.contactType === 'PROSPECT')
  ) {
    return {
      type: 'FORMER_SELLER_PROSPECT',
      reason: `Bekende pandrelatie, ${months} maanden stil`,
      strength: 0.5,
      silenceDays: silence,
    }
  }

  return null
}

/** De categorieën zoals ze op het LeadRevive-scherm gegroepeerd worden. */
export const DORMANT_CATEGORY_LABELS: Record<LeadReviveOpportunityType, string> = {
  DORMANT_VALUATION_LEAD: 'Slapende schattingsaanvragen',
  FORMER_SELLER_PROSPECT: 'Verloren verkoopprospects',
  FORMER_CLIENT: 'Oud-klanten',
  PREVIOUS_BUYER: 'Eerdere kopers',
  LOST_MANDATE: 'Verloren mandaten',
  UNCONTACTED_LEAD: 'Nooit opgevolgde leads',
}

/**
 * De volgorde waarin de categorieën getoond worden: sterkste signaal bovenaan.
 * Bewust vast en niet op aantal gesorteerd — een makelaar die elke ochtend
 * dezelfde volgorde ziet, vindt sneller wat hij zoekt.
 */
export const DORMANT_CATEGORY_ORDER: readonly LeadReviveOpportunityType[] = [
  'DORMANT_VALUATION_LEAD',
  'LOST_MANDATE',
  'FORMER_SELLER_PROSPECT',
  'PREVIOUS_BUYER',
  'FORMER_CLIENT',
  'UNCONTACTED_LEAD',
]
