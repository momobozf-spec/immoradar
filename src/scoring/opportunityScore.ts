import {
  DEFAULT_SCORING_CONFIG,
  SCORE_DIMENSIONS,
  type ScoreDimension,
  type ScoreReason,
  type ScoringConfig,
  type ScoringContext,
} from './config'

/**
 * De Opportunity Score: 0–100.
 *
 * Wat het getal betekent: hoe waarschijnlijk het is dat hier een verkoopmandaat
 * te winnen valt, gegeven publieke advertentiedata én wat het kantoor zelf al
 * over deze mensen weet. Het is géén voorspelling van de verkoopprijs en geen
 * oordeel over de woning.
 *
 * Zie `config.ts` voor waarom er vijf dimensies zijn en niet één optelsom.
 */

export interface DimensionScore {
  dimension: ScoreDimension
  /** 0–100 binnen deze dimensie. */
  value: number
  /** Meegewogen in het eindcijfer? `relationship` telt niet zonder CRM-match. */
  applicable: boolean
  weight: number
}

export interface OpportunityScoreResult {
  /** Het eindcijfer. Dit is de sorteersleutel van het hele product. */
  score: number
  /** Per dimensie, voor `OpportunityScore` en de uitleg in het dashboard. */
  dimensions: Record<ScoreDimension, number>
  /** Kracht van het externe marktsignaal, los bewaard op `Opportunity.intentScore`. */
  intentScore: number
  /** Waarde van de bestaande relatie, los bewaard op `Opportunity.relationshipScore`. */
  relationshipScore: number
  /** Bonus voor de combinatie markt + bekende relatie. */
  crossBonus: number
  /** Zwaarste bijdrage eerst — dit staat in het dashboard en in Telegram. */
  reasons: ScoreReason[]
  weightsVersion: string
  breakdown: ScoreBreakdown
}

export interface ScoreBreakdown {
  dimensions: DimensionScore[]
  weightedBase: number
  crossBonus: number
  total: number
}

export function scoreOpportunity(
  context: ScoringContext,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): OpportunityScoreResult {
  const perDimension = new Map<ScoreDimension, ScoreReason[]>()

  for (const factor of config.factors) {
    const outcome = factor.evaluate(context)
    if (outcome === null || outcome.points <= 0) continue

    // Een factor die meer teruggeeft dan zijn eigen maximum is een fout in de
    // configuratie. Hier afkappen in plaats van vertrouwen, zodat één verkeerd
    // ingestelde factor de schaal niet onbruikbaar maakt.
    const points = Math.min(outcome.points, factor.maxPoints)

    const reasons = perDimension.get(factor.dimension) ?? []
    reasons.push({
      code: factor.code,
      label: outcome.label,
      points,
      dimension: factor.dimension,
    })
    perDimension.set(factor.dimension, reasons)
  }

  const accepted: ScoreReason[] = []
  const dimensions: Record<ScoreDimension, number> = {
    intent: 0,
    relationship: 0,
    timing: 0,
    territory: 0,
    confidence: 0,
  }

  for (const dimension of SCORE_DIMENSIONS) {
    const reasons = perDimension.get(dimension) ?? []

    // Binnen een dimensie wint de zwaarste factor bij het afkappen op 100. Zou
    // je op configuratievolgorde afkappen, dan bepaalt de toevallige regelorde
    // welke reden de makelaar te zien krijgt.
    const sorted = [...reasons].sort((a, b) => b.points - a.points)

    let total = 0
    for (const reason of sorted) {
      const remaining = 100 - total
      if (remaining <= 0) break

      const points = Math.min(reason.points, remaining)
      total += points
      accepted.push({ ...reason, points })
    }

    dimensions[dimension] = total
  }

  // De relatiedimensie telt alleen mee als er een relatie ís. Zie config.ts.
  const applicable = new Set<ScoreDimension>(SCORE_DIMENSIONS)
  if (!context.hasCrmMatch) applicable.delete('relationship')

  const totalWeight = SCORE_DIMENSIONS.filter((dimension) => applicable.has(dimension)).reduce(
    (sum, dimension) => sum + config.weights[dimension],
    0,
  )

  const weightedBase =
    totalWeight === 0
      ? 0
      : SCORE_DIMENSIONS.filter((dimension) => applicable.has(dimension)).reduce(
          (sum, dimension) => sum + config.weights[dimension] * dimensions[dimension],
          0,
        ) / totalWeight

  // De kern van het product: een marktsignaal bij iemand die het kantoor al kent
  // is meer waard dan hetzelfde signaal bij een vreemde. De bonus schaalt met
  // hoe sterk de relatie is én hoe zeker de koppeling — een zwakke match op een
  // sterke relatie hoort niet vol mee te tellen.
  const crossBonus =
    context.origin === 'CROSS' && context.hasCrmMatch
      ? Math.round(
          config.crossBonusMax * (dimensions.relationship / 100) * context.crmMatchConfidence,
        )
      : 0

  const total = Math.max(0, Math.min(config.maxScore, Math.round(weightedBase) + crossBonus))

  const breakdown: ScoreBreakdown = {
    dimensions: SCORE_DIMENSIONS.map((dimension) => ({
      dimension,
      value: dimensions[dimension],
      applicable: applicable.has(dimension),
      weight: config.weights[dimension],
    })),
    weightedBase: Math.round(weightedBase),
    crossBonus,
    total,
  }

  return {
    score: total,
    dimensions,
    intentScore: dimensions.intent,
    relationshipScore: dimensions.relationship,
    crossBonus,
    reasons: accepted.sort((a, b) => b.points - a.points),
    weightsVersion: config.version,
    breakdown,
  }
}

/**
 * De redenen als losse regels, zoals ze in een Telegram-bericht staan.
 *
 * Zonder punten: een makelaar heeft niets aan "Verkoopt zonder makelaar (+45)".
 * Hij wil weten wát er aan de hand is; het getal staat al bovenaan.
 */
export function reasonLines(result: OpportunityScoreResult, limit = 5): string[] {
  return result.reasons.slice(0, limit).map((reason) => reason.label)
}
