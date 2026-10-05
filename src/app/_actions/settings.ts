'use server'

import { revalidatePath } from 'next/cache'

import { alertRuleInputSchema, territoryInputSchema } from '@/domain/schemas'
import { normalizeText } from '@/lib/text'
import { isProvince } from '@/domain/geo/provinces'
import { requireAgencyAdmin } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'
import { recordAudit } from '@/services/auditService'

/**
 * Gebieden, alertregels en kantoorinstellingen.
 *
 * ─── WAAROM ALLES HIER `requireAgencyAdmin` GEBRUIKT ─────────────────────────
 *
 * Een makelaar mag zijn eigen kansen opvolgen; hij mag niet bepalen in welke
 * postcodes het kantoor werkt of vanaf welke score iedereen een melding krijgt.
 * Dat onderscheid is geen bureaucratie: zonder dat slot kan één medewerker de
 * meldingen van het hele kantoor uitzetten, en dan valt het product stil zonder
 * dat iemand weet waarom.
 */

export interface SettingsState {
  error: string | null
  ok: boolean
}

const OK: SettingsState = { error: null, ok: true }

// ─────────────────────────────────────────────────────────────────────────────
// Gebieden
// ─────────────────────────────────────────────────────────────────────────────

export async function createTerritory(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const scope = await requireAgencyAdmin()

  const parsed = territoryInputSchema.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind'),
    values: formData.get('values'),
    active: formData.get('active') !== null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.', ok: false }
  }

  const { name, kind, valueList, active } = parsed.data

  // Per soort gebied de waarden valideren en normaliseren. Een postcode die geen
  // postcode is zou stilzwijgend nooit matchen, en dan zoekt een kantoor weken
  // naar de reden dat er geen kansen binnenkomen.
  const postalCodes: string[] = []
  const municipalities: string[] = []
  const provinces: string[] = []

  for (const value of valueList) {
    if (kind === 'POSTAL_CODE') {
      if (!/^[1-9]\d{3}$/.test(value)) {
        return { error: `"${value}" is geen Belgische postcode.`, ok: false }
      }
      postalCodes.push(value)
    } else if (kind === 'MUNICIPALITY') {
      municipalities.push(normalizeText(value))
    } else {
      const normalized = normalizeText(value).replace(/\s+/g, '-')
      if (!isProvince(normalized)) {
        return { error: `"${value}" is geen bekende provincie.`, ok: false }
      }
      provinces.push(normalized)
    }
  }

  const territory = await agencyRepository.createTerritory(scope.agencyId, {
    name,
    kind,
    postalCodes,
    municipalities,
    provinces,
    active,
  })

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: 'territory.created',
    entityType: 'Territory',
    entityId: territory.id,
    metadata: { name, kind, count: valueList.length },
  })

  revalidatePath('/territories')
  return OK
}

export async function removeTerritory(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const scope = await requireAgencyAdmin()

  const territoryId = formData.get('territoryId')
  if (typeof territoryId !== 'string') return { error: 'Onbekend gebied.', ok: false }

  const removed = await agencyRepository.deleteTerritory(scope.agencyId, territoryId)
  if (!removed) return { error: 'Dit gebied hoort niet bij jouw kantoor.', ok: false }

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: 'territory.deleted',
    entityType: 'Territory',
    entityId: territoryId,
  })

  revalidatePath('/territories')
  return OK
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertregels
// ─────────────────────────────────────────────────────────────────────────────

export async function saveAlertRule(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const scope = await requireAgencyAdmin()

  const ruleId = formData.get('ruleId')

  const parsed = alertRuleInputSchema.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind'),
    enabled: formData.get('enabled') !== null,
    minScore: formData.get('minScore'),
    requireCrmMatch: formData.get('requireCrmMatch') !== null,
    telegramChatId: formData.get('telegramChatId') || undefined,
    digestHour: formData.get('digestHour'),
    quietHoursStart: formData.get('quietHoursStart') || undefined,
    quietHoursEnd: formData.get('quietHoursEnd') || undefined,
    types: formData.getAll('types').filter((value): value is string => typeof value === 'string'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.', ok: false }
  }

  if (typeof ruleId === 'string' && ruleId.length > 0) {
    const updated = await agencyRepository.updateAlertRule(scope.agencyId, ruleId, parsed.data)
    if (!updated) return { error: 'Deze regel hoort niet bij jouw kantoor.', ok: false }
  } else {
    await agencyRepository.createAlertRule(scope.agencyId, parsed.data)
  }

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: ruleId ? 'alertrule.updated' : 'alertrule.created',
    entityType: 'AlertRule',
    entityId: typeof ruleId === 'string' ? ruleId : null,
  })

  revalidatePath('/alerts')
  return OK
}

export async function removeAlertRule(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const scope = await requireAgencyAdmin()

  const ruleId = formData.get('ruleId')
  if (typeof ruleId !== 'string') return { error: 'Onbekende regel.', ok: false }

  const removed = await agencyRepository.deleteAlertRule(scope.agencyId, ruleId)
  if (!removed) return { error: 'Deze regel hoort niet bij jouw kantoor.', ok: false }

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: 'alertrule.deleted',
    entityType: 'AlertRule',
    entityId: ruleId,
  })

  revalidatePath('/alerts')
  return OK
}

// ─────────────────────────────────────────────────────────────────────────────
// Kantoorinstellingen
// ─────────────────────────────────────────────────────────────────────────────

export async function saveAgencySettings(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const scope = await requireAgencyAdmin()

  const telegramChatId = formData.get('telegramChatId')
  const contactEmail = formData.get('contactEmail')

  await agencyRepository.updateAgencySettings(scope.agencyId, {
    telegramChatId: typeof telegramChatId === 'string' ? telegramChatId.trim() || null : undefined,
    contactEmail: typeof contactEmail === 'string' ? contactEmail.trim() || null : undefined,
  })

  await recordAudit({
    actor: scope.userId,
    agencyId: scope.agencyId,
    action: 'agency.settings.updated',
    entityType: 'Agency',
    entityId: scope.agencyId,
  })

  revalidatePath('/settings')
  return OK
}
