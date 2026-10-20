import type { ContactPropertyRoleValue } from '@/crm/crmMatcher'
import type { ContactStatusValue, ContactTypeValue } from '@/crm/normalizeContact'
import type { ScoringContext } from '@/scoring/config'
import { scoreOpportunity, type OpportunityScoreResult } from '@/scoring/opportunityScore'
import {
  bestTerritoryPerAgency,
  type TerritoryDefinition,
  type TerritoryMatchResult,
} from '@/territories/territoryMatch'

import { assessContact, type ReviveAssessment } from './relationshipEngine'

/**
 * Eén contact door de volledige LeadRevive-beoordeling: relatie, kanstype,
 * gebied en score.
 *
 * Staat los van de database, zodat de nachtelijke taak (`leadReviveService`) en
 * de intake-scan op een CSV (`intake.ts`) exact dezelfde regels gebruiken. Een
 * scan die iets anders telt dan het product later toont, zou de pilot beloven
 * wat de software niet levert.
 */

export interface ReviveCandidate {
  contactType: ContactTypeValue
  status: ContactStatusValue
  sourceCreatedAt: Date | null
  lastContactAt: Date | null
  interactionCount: number
  /** Soorten geregistreerde interacties (VALUATION, MANDATE, …). */
  interactionKinds: readonly string[]
  propertyRoles: readonly ContactPropertyRoleValue[]
  postalCode: string | null
  city: string | null
  hasPhone: boolean
}

export interface ReviveSettings {
  dormantMonths: number
  minRelationshipScore: number
  minOpportunityScore: number
  highValueThreshold: number
}

export interface ReviveEvaluation {
  assessment: ReviveAssessment
  territoryMatch: TerritoryMatchResult | null
  hadValuation: boolean
  /** Null wanneer er geen kanstype uit komt; dan is er ook niets te scoren. */
  score: OpportunityScoreResult | null
  /** Er komt een kans uit én de score haalt de drempel. */
  qualifies: boolean
}

export function evaluateRevive(
  candidate: ReviveCandidate,
  territories: readonly TerritoryDefinition[],
  settings: ReviveSettings,
  now: Date,
): ReviveEvaluation {
  const hadValuation =
    candidate.contactType === 'VALUATION_LEAD' || candidate.interactionKinds.includes('VALUATION')

  const assessment = assessContact(
    {
      contactType: candidate.contactType,
      status: candidate.status,
      sourceCreatedAt: candidate.sourceCreatedAt,
      lastContactAt: candidate.lastContactAt,
      interactionCount: candidate.interactionCount,
      hadValuation,
      hadMandate: candidate.interactionKinds.includes('MANDATE'),
      propertyRoles: candidate.propertyRoles,
    },
    now,
    {
      dormantMonths: settings.dormantMonths,
      minRelationshipScore: settings.minRelationshipScore,
    },
  )

  const territoryMatch =
    bestTerritoryPerAgency(
      { postalCode: candidate.postalCode, city: candidate.city, province: null },
      territories.filter((territory) => territory.active),
    )[0] ?? null

  if (!assessment.opportunityType) {
    return { assessment, territoryMatch, hadValuation, score: null, qualifies: false }
  }

  const context: ScoringContext = {
    origin: 'LEADREVIVE',
    type: assessment.opportunityType,

    // Er is geen advertentie: alles aan de marktkant staat leeg. De scoring
    // gaat daar netjes mee om — `intent` haalt zijn punten uit de
    // LeadRevive-factoren en `timing` uit de dormantie.
    sellerType: 'unknown',
    sellerConfidence: 0,
    hasPhone: candidate.hasPhone,

    minutesSinceFirstSeen: null,
    daysOnMarket: null,

    priceDropCount: 0,
    totalPriceDropPercent: 0,

    isRelisted: false,
    listingCycles: 1,

    price: null,
    highValueThreshold: settings.highValueThreshold,

    hasCrmMatch: true,
    // Het contact ís het uitgangspunt; er valt niets te koppelen en dus niets
    // om onzeker over te zijn.
    crmMatchConfidence: 1,
    isKnownOwnerOfProperty: candidate.propertyRoles.some(
      (role) => role === 'OWNER' || role === 'FORMER_OWNER',
    ),
    monthsSinceLastContact: assessment.monthsSinceLastContact,
    relationshipAgeMonths: assessment.relationshipAgeMonths,
    hadValuation,
    wasClient: candidate.status === 'WON' || candidate.contactType === 'FORMER_CLIENT',
    neverContacted: assessment.neverContacted,

    territoryMatch: territoryMatch?.precision ?? 'none',
  }

  const score = scoreOpportunity(context)
  return {
    assessment,
    territoryMatch,
    hadValuation,
    score,
    qualifies: score.score >= settings.minOpportunityScore,
  }
}
