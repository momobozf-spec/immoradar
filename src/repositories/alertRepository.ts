import type { Alert, AlertStatus, Prisma } from '@/generated/prisma/client'

import { prisma } from './prisma'
import { isUniqueViolation } from './prismaErrors'

/**
 * Alerts vastleggen en hun afloop bijhouden.
 *
 * ─── WAAROM DE ALERT VÓÓR HET VERSTUREN WORDT AANGEMAAKT ─────────────────────
 *
 * Eerst versturen en dan opslaan lijkt logischer, maar dan bepaalt een crash
 * tussen die twee stappen dat er een bericht bij een makelaar ligt waarvan wij
 * niets weten — en bij de volgende run sturen we het opnieuw.
 *
 * Andersom is het ergste geval een rij met status PENDING waarvan het bericht
 * nooit vertrok. Dat is zichtbaar, herstelbaar, en het stoort niemand.
 *
 * De unique `dedupeKey` doet het echte werk: hij maakt een tweede bericht voor
 * dezelfde (regel, kans) fysiek onmogelijk, ook wanneer twee workers tegelijk
 * dezelfde kans oppakken.
 */

export interface ReserveAlertInput {
  agencyId: string
  alertRuleId: string
  opportunityId: string | null
  dedupeKey: string
  chatId: string
  messageText: string
}

/**
 * Claimt het recht om dit bericht te versturen.
 *
 * Geeft `null` wanneer de melding al bestond. De aanroeper stuurt dan niets —
 * dat is de volledige bescherming tegen dubbele alerts.
 */
export async function reserveAlert(input: ReserveAlertInput): Promise<Alert | null> {
  try {
    return await prisma.alert.create({
      data: {
        agencyId: input.agencyId,
        alertRuleId: input.alertRuleId,
        opportunityId: input.opportunityId,
        dedupeKey: input.dedupeKey,
        chatId: input.chatId,
        messageText: input.messageText,
        status: 'PENDING',
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

export async function markAlertSent(
  alertId: string,
  providerMessageId: string | null,
): Promise<void> {
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      providerMessageId,
      attempts: { increment: 1 },
      error: null,
    },
  })
}

export async function markAlertOutcome(
  alertId: string,
  status: Extract<AlertStatus, 'FAILED' | 'SUPPRESSED_DRY_RUN'>,
  error: string | null,
): Promise<void> {
  await prisma.alert.update({
    where: { id: alertId },
    data: { status, attempts: { increment: 1 }, error: error?.slice(0, 500) ?? null },
  })
}

const alertInclude = {
  alertRule: { select: { name: true, kind: true } },
  opportunity: {
    select: {
      id: true,
      type: true,
      score: true,
      property: { select: { postalCode: true, city: true, address: true } },
    },
  },
} satisfies Prisma.AlertInclude

export type AlertListItem = Prisma.AlertGetPayload<{ include: typeof alertInclude }>

export async function listAlerts(agencyId: string, limit = 100): Promise<AlertListItem[]> {
  return prisma.alert.findMany({
    where: { agencyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: alertInclude,
  })
}

export async function countAlertsSince(agencyId: string, since: Date): Promise<number> {
  return prisma.alert.count({
    where: { agencyId, status: 'SENT', createdAt: { gte: since } },
  })
}

/**
 * Hoeveel meldingen dit kantoor vandaag al kreeg.
 *
 * Voedt `Subscription.maxOpportunitiesPerDay`: een kantoor dat half België als
 * gebied instelt hoort niet in meldingen te verzuipen, want dan zet het ze uit
 * en is de dienst voor hen waardeloos geworden.
 */
export async function countAlertsToday(agencyId: string, now: Date): Promise<number> {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)

  return prisma.alert.count({
    where: {
      agencyId,
      createdAt: { gte: startOfDay },
      status: { in: ['SENT', 'PENDING'] },
    },
  })
}
