import type { OpportunityType } from '@/generated/prisma/client'

import { expiryDaysFor } from '@/events/opportunityRules'
import { assessContact } from '@/leadrevive/relationshipEngine'
import { addDays } from '@/lib/dates'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as crmRepository from '@/repositories/crmRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'
import type { ScoringContext } from '@/scoring/config'
import { scoreOpportunity } from '@/scoring/opportunityScore'
import { bestTerritoryPerAgency } from '@/territories/territoryMatch'

/**
 * LeadRevive: kansen uit het eigen klantenbestand, zonder extern signaal.
 *
 * ─── WAAROM DIT EEN APARTE DRAAI IS EN GEEN ONDERDEEL VAN DE COLLECTOR ───────
 *
 * De marktpijplijn wordt aangedreven door gebeurtenissen: een prijs zakt, een
 * advertentie verdwijnt. Het klantenbestand kent zulke gebeurtenissen niet — daar
 * gebeurt juist níets, en dat stilzwijgen ís het signaal. Er is dus geen trigger
 * om op te reageren; er is alleen een periodieke herwaardering van "wie ligt hier
 * al lang stil en is de moeite waard".
 *
 * Vandaar een eigen taak die per kantoor over het bestand loopt. Hij is
 * idempotent: dezelfde dormante relatie levert dezelfde `dedupeKey` op en dus
 * één kans, hoe vaak hij ook draait.
 *
 * ─── STRIKT PER KANTOOR ──────────────────────────────────────────────────────
 *
 * Anders dan de marktkant kijkt hier niets over tenants heen. Elke query gaat
 * met een `agencyId` naar de database en de kansen die eruit komen dragen
 * datzelfde id.
 */

const logger = createLogger({ component: 'leadrevive' })

export interface ReviveResult {
  agencyId: string
  contactsAssessed: number
  opportunitiesCreated: number
}

export async function runLeadRevive(agencyId: string, now: Date = new Date()): Promise<ReviveResult> {
  const env = getEnv()
  const result: ReviveResult = { agencyId, contactsAssessed: 0, opportunitiesCreated: 0 }

  const contacts = await crmRepository.contactsForRevive(agencyId)
  if (contacts.length === 0) return result

  const allTerritories = await agencyRepository.listTerritories(agencyId)
  const territories = allTerritories
    .filter((territory) => territory.active)
    .map((territory) => ({
      id: territory.id,
      agencyId: territory.agencyId,
      name: territory.name,
      kind: territory.kind,
      postalCodes: territory.postalCodes,
      municipalities: territory.municipalities,
      provinces: territory.provinces,
      active: territory.active,
    }))

  for (const contact of contacts) {
    result.contactsAssessed += 1

    const assessment = assessContact(
      {
        contactType: contact.contactType,
        status: contact.status,
        sourceCreatedAt: contact.sourceCreatedAt,
        lastContactAt: contact.lastContactAt,
        interactionCount: contact._count.interactions,
        hadValuation:
          contact.contactType === 'VALUATION_LEAD' ||
          contact.interactions.some((interaction) => interaction.kind === 'VALUATION'),
        hadMandate: contact.interactions.some((interaction) => interaction.kind === 'MANDATE'),
        propertyRoles: contact.propertyRelations.map((relation) => relation.role),
      },
      now,
      {
        dormantMonths: env.DORMANT_MONTHS,
        minRelationshipScore: env.MIN_RELATIONSHIP_SCORE,
      },
    )

    // De beoordeling wordt altijd bewaard, ook als er geen kans uit komt: het
    // dashboard toont "slapend sinds" en de relatiescore ook voor contacten die
    // de drempel niet halen.
    await crmRepository.saveAssessment(
      agencyId,
      contact.id,
      assessment.relationshipScore,
      assessment.dormantSince,
    )

    if (!assessment.opportunityType) continue

    const territoryMatch = bestTerritoryPerAgency(
      { postalCode: contact.postalCode, city: contact.city, province: null },
      territories,
    )[0]

    const context: ScoringContext = {
      origin: 'LEADREVIVE',
      type: assessment.opportunityType,

      // Er is geen advertentie: alles aan de marktkant staat leeg. De scoring
      // gaat daar netjes mee om — `intent` haalt zijn punten uit de
      // LeadRevive-factoren en `timing` uit de dormantie.
      sellerType: 'unknown',
      sellerConfidence: 0,
      hasPhone: Boolean(contact.phoneE164),

      minutesSinceFirstSeen: null,
      daysOnMarket: null,

      priceDropCount: 0,
      totalPriceDropPercent: 0,

      isRelisted: false,
      listingCycles: 1,

      price: null,
      highValueThreshold: env.HIGH_VALUE_THRESHOLD,

      hasCrmMatch: true,
      // Het contact ís het uitgangspunt; er valt niets te koppelen en dus niets
      // om onzeker over te zijn.
      crmMatchConfidence: 1,
      isKnownOwnerOfProperty: contact.propertyRelations.some(
        (relation) => relation.role === 'OWNER' || relation.role === 'FORMER_OWNER',
      ),
      monthsSinceLastContact: assessment.monthsSinceLastContact,
      relationshipAgeMonths: assessment.relationshipAgeMonths,
      hadValuation:
        contact.contactType === 'VALUATION_LEAD' ||
        contact.interactions.some((interaction) => interaction.kind === 'VALUATION'),
      wasClient: contact.status === 'WON' || contact.contactType === 'FORMER_CLIENT',
      neverContacted: assessment.neverContacted,

      territoryMatch: territoryMatch?.precision ?? 'none',
    }

    const score = scoreOpportunity(context)
    if (score.score < env.MIN_OPPORTUNITY_SCORE) continue

    const created = await opportunityRepository.createOpportunity({
      agencyId,
      origin: 'LEADREVIVE',
      type: assessment.opportunityType as OpportunityType,
      // Per contact en type één kans. Verandert het type omdat de relatie
      // opschuift (van UNCONTACTED_LEAD naar DORMANT_VALUATION_LEAD), dan is dat
      // een nieuwe kans — terecht, want het is een ander gesprek.
      dedupeKey: `revive:${contact.id}:${assessment.opportunityType}`,

      crmContactId: contact.id,
      crmMatchConfidence: 1,
      crmMatchReasons: assessment.reasons,

      matchedTerritoryId: territoryMatch?.territoryId ?? null,
      matchedTerritoryName: territoryMatch?.territoryName ?? null,

      score,
      expiresAt: addDays(now, expiryDaysFor(assessment.opportunityType, env.OPPORTUNITY_TTL_DAYS)),
      signals: [
        {
          kind: 'crm',
          code: 'relationship_score',
          label: `Relatiescore ${assessment.relationshipScore}`,
          strength: assessment.relationshipScore / 100,
        },
        ...(assessment.monthsSinceLastContact !== null
          ? [
              {
                kind: 'crm' as const,
                code: 'dormancy',
                label: `${assessment.monthsSinceLastContact} maanden stil`,
                strength: Math.min(1, assessment.monthsSinceLastContact / 96),
              },
            ]
          : []),
      ],
    })

    if (created) result.opportunitiesCreated += 1
  }

  logger.info('LeadRevive afgerond', { ...result })
  return result
}

/** Draait LeadRevive voor alle actieve kantoren, kantoor voor kantoor. */
export async function runLeadReviveForAllAgencies(now: Date = new Date()): Promise<ReviveResult[]> {
  const agencies = await agencyRepository.listServedAgencies()
  const results: ReviveResult[] = []

  for (const agency of agencies) {
    if (!agency.active) continue
    results.push(await runLeadRevive(agency.id, now))
  }

  return results
}
