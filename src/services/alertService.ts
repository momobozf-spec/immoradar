import type { OpportunityType } from '@/generated/prisma/client'

import { hourInBrussels, isWithinQuietHours, startOfDay } from '@/lib/dates'
import { getEnv } from '@/lib/env'
import { messageOf } from '@/lib/errors'
import { createLogger } from '@/lib/logger'
import { buildDigestMessage, buildOpportunityMessage } from '@/notifications/messages'
import { TelegramClient } from '@/notifications/telegramClient'
import * as agencyRepository from '@/repositories/agencyRepository'
import * as alertRepository from '@/repositories/alertRepository'
import * as opportunityRepository from '@/repositories/opportunityRepository'
import { prisma } from '@/repositories/prisma'

/**
 * Meldingen versturen — en vooral: níet twee keer versturen.
 *
 * ─── DE DRIE SLOTEN OP EEN DUBBELE MELDING ───────────────────────────────────
 *
 *  1. De query haalt alleen kansen op zonder alert voor deze regel.
 *  2. `reserveAlert` claimt de melding via een unique `dedupeKey`; verliest hij
 *     de race met een tweede worker, dan komt er `null` terug en gebeurt er niets.
 *  3. De rij bestaat vóór het versturen, dus een crash halverwege laat een
 *     PENDING-rij achter in plaats van een tweede bericht.
 *
 * Alleen slot 2 is echt waterdicht; de andere twee besparen werk. Dat is de
 * juiste verdeling: correctheid op één plek, in de database, waar niemand er
 * per ongeluk omheen kan.
 *
 * ─── STILTE-UREN EN DAGLIMIET ────────────────────────────────────────────────
 *
 * Een makelaar om 03:12 wakker maken voor een lead kost je de klant, en tweehonderd
 * meldingen op één dag ook. Beide grenzen staan hieronder en beide worden vóór
 * het reserveren gecontroleerd, zodat een onderdrukte melding later alsnog kan.
 */

const logger = createLogger({ component: 'alerts' })

/**
 * De gedeelde reservechat, alleen buiten productie.
 *
 * Valt elk kantoor zonder eigen chat terug op dezelfde chat, dan belanden de
 * kansen van verschillende kantoren in één gesprek — een lek over de tenantgrens.
 * In productie wordt een regel zonder chat daarom overgeslagen (met een warning);
 * in ontwikkeling is de reservechat handig om meldingen te zien.
 */
function fallbackChatId(env: { NODE_ENV: string; TELEGRAM_FALLBACK_CHAT_ID: string }): string {
  return env.NODE_ENV === 'production' ? '' : env.TELEGRAM_FALLBACK_CHAT_ID
}

export interface AlertDispatchResult {
  sent: number
  suppressed: number
  failed: number
}

/**
 * Realtime meldingen voor alle kantoren met een actieve REALTIME-regel.
 *
 * Draait na elke collectorrun. Kansen die door stilte-uren of de daglimiet
 * worden overgeslagen blijven `NEW` en komen bij de volgende ronde weer langs —
 * er gaat dus niets verloren, het wordt alleen uitgesteld.
 */
export async function dispatchRealtimeAlerts(
  now: Date = new Date(),
): Promise<AlertDispatchResult> {
  const env = getEnv()
  const client = new TelegramClient()
  const result: AlertDispatchResult = { sent: 0, suppressed: 0, failed: 0 }

  const rules = await agencyRepository.activeAlertRules('REALTIME')
  const hour = hourInBrussels(now)

  for (const rule of rules) {
    if (isWithinQuietHours(hour, rule.quietHoursStart, rule.quietHoursEnd)) {
      logger.debug('Stilte-uren actief, regel overgeslagen', { alertRuleId: rule.id, hour })
      continue
    }

    const chatId = rule.telegramChatId ?? rule.agency.telegramChatId ?? fallbackChatId(env)
    if (!chatId) {
      logger.warn('Alertregel zonder chat-id overgeslagen', { alertRuleId: rule.id })
      continue
    }

    const subscription = await prisma.subscription.findUnique({
      where: { agencyId: rule.agencyId },
    })
    const dailyCap = subscription?.maxOpportunitiesPerDay ?? 50
    const alreadyToday = await alertRepository.countAlertsToday(rule.agencyId, now)
    const remaining = Math.max(0, dailyCap - alreadyToday)

    if (remaining === 0) {
      logger.info('Daglimiet bereikt', { agencyId: rule.agencyId, dailyCap })
      continue
    }

    const opportunities = await opportunityRepository.opportunitiesAwaitingAlert(
      rule.agencyId,
      rule.minScore,
      rule.types as OpportunityType[],
      rule.requireCrmMatch,
      rule.id,
      remaining,
    )

    for (const opportunity of opportunities) {
      const outcome = await sendOne({
        agencyId: rule.agencyId,
        alertRuleId: rule.id,
        opportunityId: opportunity.id,
        chatId,
        text: buildOpportunityMessage(opportunity, {
          baseUrl: env.APP_BASE_URL,
          reasons: opportunity.reasons.map((reason) => reason.label),
        }),
        client,
      })

      if (outcome === 'SENT') result.sent += 1
      else if (outcome === 'FAILED') result.failed += 1
      else result.suppressed += 1
    }

    if (opportunities.length > 0) {
      await agencyRepository.touchAlertRule(rule.id, now)
    }
  }

  return result
}

/**
 * De ochtenddigest.
 *
 * Vuurt alleen in het ingestelde uur. De `dedupeKey` bevat de datum, zodat een
 * scheduler die drie keer per uur draait toch precies één digest per dag stuurt.
 */
export async function dispatchDigests(now: Date = new Date()): Promise<AlertDispatchResult> {
  const env = getEnv()
  const client = new TelegramClient()
  const result: AlertDispatchResult = { sent: 0, suppressed: 0, failed: 0 }

  const rules = await agencyRepository.activeAlertRules('DIGEST')
  const hour = hourInBrussels(now)
  const dayKey = now.toISOString().slice(0, 10)

  for (const rule of rules) {
    if (rule.digestHour !== hour) continue

    const chatId = rule.telegramChatId ?? rule.agency.telegramChatId ?? fallbackChatId(env)
    if (!chatId) continue

    const since = startOfDay(new Date(now.getTime() - 86_400_000))
    const opportunities = await opportunityRepository.opportunitiesForDigest(
      rule.agencyId,
      since,
      rule.minScore,
    )

    const outcome = await sendOne({
      agencyId: rule.agencyId,
      alertRuleId: rule.id,
      opportunityId: null,
      chatId,
      text: buildDigestMessage(opportunities, {
        baseUrl: env.APP_BASE_URL,
        agencyName: rule.agency.name,
        date: now,
      }),
      client,
      dedupeKey: `digest:${rule.id}:${dayKey}`,
    })

    if (outcome === 'SENT') result.sent += 1
    else if (outcome === 'FAILED') result.failed += 1
    else result.suppressed += 1

    if (outcome === 'SENT') await agencyRepository.touchAlertRule(rule.id, now)
  }

  return result
}

interface SendOneInput {
  agencyId: string
  alertRuleId: string
  opportunityId: string | null
  chatId: string
  text: string
  client: TelegramClient
  dedupeKey?: string
}

type SendOutcome = 'SENT' | 'FAILED' | 'SUPPRESSED'

async function sendOne(input: SendOneInput): Promise<SendOutcome> {
  const dedupeKey = input.dedupeKey ?? `rule:${input.alertRuleId}:opp:${input.opportunityId}`

  const alert = await alertRepository.reserveAlert({
    agencyId: input.agencyId,
    alertRuleId: input.alertRuleId,
    opportunityId: input.opportunityId,
    dedupeKey,
    chatId: input.chatId,
    messageText: input.text,
  })

  // Al gestuurd door een andere worker of een eerdere run.
  if (!alert) return 'SUPPRESSED'

  try {
    const outcome = await input.client.sendMessage(input.chatId, input.text)

    if (outcome.status === 'SUPPRESSED_DRY_RUN') {
      await alertRepository.markAlertOutcome(alert.id, 'SUPPRESSED_DRY_RUN', null)
      return 'SUPPRESSED'
    }

    await alertRepository.markAlertSent(alert.id, outcome.providerMessageId)

    if (input.opportunityId) {
      await prisma.opportunityActivity.create({
        data: { opportunityId: input.opportunityId, kind: 'alert_sent' },
      })
    }

    return 'SENT'
  } catch (error) {
    await alertRepository.markAlertOutcome(alert.id, 'FAILED', messageOf(error))
    logger.error('Alert versturen mislukt', {
      alertId: alert.id,
      error: messageOf(error),
    })
    return 'FAILED'
  }
}
