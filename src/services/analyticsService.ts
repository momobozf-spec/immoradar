import { OPPORTUNITY_TYPE_LABELS, type OpportunityTypeValue } from '@/events/opportunityRules'
import { prisma } from '@/repositories/prisma'

/**
 * De cijfers voor de kantoorleiding.
 *
 * ─── WAT HIER BEWUST NIET GEBEURT ────────────────────────────────────────────
 *
 * Er staat nergens "ImmoRadar leverde dit kantoor twaalf mandaten op". Dat zou
 * een causale claim zijn, en die kunnen wij niet dragen: een makelaar die een
 * kans opvolgt en het mandaat wint, had die eigenaar misschien ook zonder ons
 * gesproken. Wat wij wél weten is wat er in de pijplijn geregistreerd is — welke
 * kansen zijn aangemaakt, welke zijn opgevolgd, en hoe die zich verhouden.
 *
 * Vandaar dat elk getal hier uit `OpportunityActivity` en de statusvelden komt,
 * en dat de UI spreekt van "gemarkeerd als" in plaats van "geleid tot". Het
 * verschil lijkt muggenzifterij tot een kantoor op grond van die cijfers een
 * abonnement verlengt.
 *
 * ─── DE CONVERSIE ────────────────────────────────────────────────────────────
 *
 * Conversie wordt gerekend over kansen die een *eindstatus* bereikt hebben, niet
 * over alle kansen. Anders daalt het percentage elke ochtend automatisch doordat
 * er nieuwe kansen bijkomen die niemand nog heeft kunnen bellen — en dan meet
 * het cijfer de instroom in plaats van het werk.
 */

export interface FunnelStage {
  key: string
  label: string
  count: number
}

export interface TypeBreakdown {
  type: string
  label: string
  total: number
  contacted: number
  won: number
}

export interface AgentBreakdown {
  userId: string
  name: string
  assigned: number
  contacted: number
  won: number
}

export interface AnalyticsResult {
  funnel: FunnelStage[]
  byType: TypeBreakdown[]
  byAgent: AgentBreakdown[]
  totals: {
    detected: number
    contacted: number
    valuations: number
    mandatesProposed: number
    mandatesWon: number
    lost: number
    /** Percentage van de afgeronde kansen dat een mandaat werd. */
    conversionRate: number
    /** Aandeel van de gewonnen mandaten waar een CRM-relatie bij zat. */
    crossShareOfWins: number
  }
}

export async function agencyAnalytics(
  agencyId: string,
  sinceDays = 90,
): Promise<AnalyticsResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  const scope = { agencyId, createdAt: { gte: since } }

  const [
    detected,
    contacted,
    valuations,
    mandatesProposed,
    mandatesWon,
    lost,
    dismissed,
    crossWins,
    typeRows,
    agentRows,
    users,
  ] = await Promise.all([
    prisma.opportunity.count({ where: scope }),
    // Alles wat ooit gecontacteerd is, ook als het intussen verder is: een kans
    // die nu MANDATE_WON heet, is onderweg gecontacteerd geweest.
    prisma.opportunity.count({ where: { ...scope, contactedAt: { not: null } } }),
    prisma.opportunity.count({
      where: {
        ...scope,
        OR: [
          { status: 'VALUATION_BOOKED' },
          { activities: { some: { toStatus: 'VALUATION_BOOKED' } } },
        ],
      },
    }),
    prisma.opportunity.count({
      where: {
        ...scope,
        OR: [
          { status: { in: ['MANDATE_PROPOSED', 'MANDATE_WON'] } },
          { activities: { some: { toStatus: 'MANDATE_PROPOSED' } } },
        ],
      },
    }),
    prisma.opportunity.count({ where: { ...scope, status: 'MANDATE_WON' } }),
    prisma.opportunity.count({ where: { ...scope, status: 'LOST' } }),
    prisma.opportunity.count({ where: { ...scope, status: 'DISMISSED' } }),
    prisma.opportunity.count({
      where: { ...scope, status: 'MANDATE_WON', crmContactId: { not: null } },
    }),
    prisma.opportunity.groupBy({
      by: ['type'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.opportunity.groupBy({
      by: ['assignedUserId'],
      where: { ...scope, assignedUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { agencyId },
      select: { id: true, name: true, email: true },
    }),
  ])

  // Per type ook de opvolging, zodat zichtbaar wordt welk soort signaal het
  // meest oplevert — dat is de vraag die bepaalt waar het kantoor op inzet.
  const byType: TypeBreakdown[] = await Promise.all(
    typeRows.map(async (row) => {
      const [typeContacted, typeWon] = await Promise.all([
        prisma.opportunity.count({
          where: { ...scope, type: row.type, contactedAt: { not: null } },
        }),
        prisma.opportunity.count({ where: { ...scope, type: row.type, status: 'MANDATE_WON' } }),
      ])

      return {
        type: row.type,
        label: OPPORTUNITY_TYPE_LABELS[row.type as OpportunityTypeValue] ?? row.type,
        total: row._count._all,
        contacted: typeContacted,
        won: typeWon,
      }
    }),
  )

  const userById = new Map(users.map((user) => [user.id, user.name ?? user.email]))

  const byAgent: AgentBreakdown[] = await Promise.all(
    agentRows
      .filter((row): row is typeof row & { assignedUserId: string } => row.assignedUserId !== null)
      .map(async (row) => {
        const [agentContacted, agentWon] = await Promise.all([
          prisma.opportunity.count({
            where: { ...scope, assignedUserId: row.assignedUserId, contactedAt: { not: null } },
          }),
          prisma.opportunity.count({
            where: { ...scope, assignedUserId: row.assignedUserId, status: 'MANDATE_WON' },
          }),
        ])

        return {
          userId: row.assignedUserId,
          name: userById.get(row.assignedUserId) ?? 'onbekend',
          assigned: row._count._all,
          contacted: agentContacted,
          won: agentWon,
        }
      }),
  )

  const closed = mandatesWon + lost + dismissed

  return {
    funnel: [
      { key: 'detected', label: 'Gedetecteerd', count: detected },
      { key: 'contacted', label: 'Gecontacteerd', count: contacted },
      { key: 'valuation', label: 'Schatting gepland', count: valuations },
      { key: 'proposed', label: 'Mandaat voorgesteld', count: mandatesProposed },
      { key: 'won', label: 'Mandaat gewonnen', count: mandatesWon },
    ],
    byType: byType.sort((a, b) => b.total - a.total),
    byAgent: byAgent.sort((a, b) => b.won - a.won || b.assigned - a.assigned),
    totals: {
      detected,
      contacted,
      valuations,
      mandatesProposed,
      mandatesWon,
      lost,
      conversionRate: closed === 0 ? 0 : (mandatesWon / closed) * 100,
      crossShareOfWins: mandatesWon === 0 ? 0 : (crossWins / mandatesWon) * 100,
    },
  }
}
