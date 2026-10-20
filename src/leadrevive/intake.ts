import type { ContactPropertyRoleValue } from '@/crm/crmMatcher'
import { applyMapping, parseCsv, suggestMapping } from '@/crm/csv'
import { computeContactChanges, findDuplicate, type DedupeCandidate } from '@/crm/dedupe'
import { DORMANT_CATEGORY_LABELS, DORMANT_CATEGORY_ORDER } from '@/crm/dormant'
import {
  isUsableContact,
  normalizeContact,
  type NormalizedContact,
  type RawContactInput,
} from '@/crm/normalizeContact'
import { roleForContactType } from '@/crm/propertyRole'
import type { CrmImportField } from '@/domain/schemas'
import type { LeadReviveOpportunityType } from '@/events/opportunityRules'
import type { TerritoryDefinition } from '@/territories/territoryMatch'

import { evaluateRevive, type ReviveSettings } from './reviveEvaluation'

/**
 * Intake-scan: wat levert het bestand van een kantoor op, vóór er iets in de
 * database komt?
 *
 * ─── WAAROM DIT BESTAAT ──────────────────────────────────────────────────────
 *
 * Een pilot mag geen aantal kansen beloven voordat we weten wat een kantoor
 * aanlevert. Deze scan beantwoordt precies dat, met de regels die het product
 * zelf gebruikt (`evaluateRevive`), op een CSV, zonder database:
 *
 *   - hoeveel rijen bruikbaar zijn en hoeveel dubbel;
 *   - welke velden ontbreken en wat dat kost;
 *   - hoeveel *bruikbare kansen* eruit komen, per categorie, met de reden.
 *
 * ─── WAT EEN "BRUIKBARE KANS" IS ─────────────────────────────────────────────
 *
 * Een contact telt alleen als bruikbare kans als het aan alle vier voldoet:
 *
 *   1. LeadRevive kent het een categorie toe en de score haalt de drempel
 *      (dezelfde drempel als in het product, `MIN_OPPORTUNITY_SCORE`);
 *   2. er is een geldig telefoonnummer of e-mailadres — anders kan niemand bellen;
 *   3. als het kantoor een werkgebied opgaf: het contact ligt erin;
 *   4. "nooit opgevolgd" telt alleen als de export een kolom "laatste contact"
 *      heeft — zonder die kolom weten we niet of er ooit gebeld is.
 *
 * Een bruikbare kans is een *reden om te bellen*, geen verkoopkans. De score is
 * een volgorde, geen kansberekening.
 */

export interface IntakeOptions {
  now: Date
  settings: ReviveSettings
  /** Werkgebied van het kantoor. Leeg = geen gebiedsfilter. */
  territories?: readonly TerritoryDefinition[]
  /** Kolomindex → veld. Zonder: dezelfde suggestie als het importscherm. */
  mapping?: Record<string, CrmImportField>
  /** Maximaal aantal rijen, zoals bij de echte import. */
  maxRows?: number
}

export interface IntakeOpportunity {
  name: string
  phone: string | null
  email: string | null
  postalCode: string | null
  city: string | null
  category: LeadReviveOpportunityType
  categoryLabel: string
  score: number
  /** Wat we weten, in gewone taal. */
  reasons: string[]
  monthsSilent: number | null
  usable: boolean
  /** Waarom niet bruikbaar, als dat zo is. */
  notUsableBecause: string[]
  /** Hoeveel exportrijen in dit ene contact samenkwamen. */
  mergedRows: number
}

export interface IntakeReport {
  rows: number
  malformedRows: number
  delimiter: string
  mapping: { column: string; field: CrmImportField }[]
  invalidRows: number
  duplicateRows: number
  uniqueContacts: number
  /** Aandeel unieke contacten met een waarde, 0–1. */
  coverage: {
    reachable: number
    phone: number
    email: number
    address: number
    postalCode: number
    createdAt: number
    lastContactAt: number
    typeRecognised: number
  }
  hasLastContactColumn: boolean
  warnings: string[]
  categories: { type: LeadReviveOpportunityType; label: string; total: number; usable: number }[]
  /** Contacten zonder kanstype of onder de scoredrempel. */
  notSelected: number
  opportunities: IntakeOpportunity[]
  usableCount: number
}

interface WorkingContact {
  contact: NormalizedContact
  roles: Set<ContactPropertyRoleValue>
  mergedRows: number
}

const DEFAULT_MAX_ROWS = 20_000

/** De reden om te bellen, per categorie — vooraan, in de voorzichtige vorm. */
const CATEGORY_REASON: Record<LeadReviveOpportunityType, string> = {
  DORMANT_VALUATION_LEAD: 'Vroeg een schatting aan; daar kwam geen mandaat van',
  LOST_MANDATE: 'Mandaat ging destijds niet door; het pand is bekend',
  FORMER_SELLER_PROSPECT: 'Wilde eerder verkopen; dat werd geen mandaat',
  PREVIOUS_BUYER: 'Kocht via het kantoor, vijf jaar of langer geleden',
  FORMER_CLIENT: 'Was klant van het kantoor',
  UNCONTACTED_LEAD: 'Kwam binnen en is nooit opgevolgd',
}

/** Redenen die de categoriezin alleen herhalen. */
const REDUNDANT_REASONS = new Set(['Was eerder klant van het kantoor', 'Kreeg eerder een schatting of vroeg er een aan'])

export function runIntake(content: string, options: IntakeOptions): IntakeReport {
  const parsed = parseCsv(content)
  const mapping = options.mapping ?? suggestMapping(parsed.header)
  const rows = parsed.rows.slice(0, options.maxRows ?? DEFAULT_MAX_ROWS)

  const mappedFields = new Set(Object.values(mapping))
  const hasLastContactColumn = mappedFields.has('lastContactAt')

  // ── Inlezen, normaliseren, ontdubbelen — zoals de echte import ─────────────
  const working: WorkingContact[] = []
  const candidates: DedupeCandidate[] = []
  let invalidRows = 0
  let duplicateRows = 0

  for (const row of rows) {
    const contact = normalizeContact(applyMapping(row, mapping) as RawContactInput)
    if (!isUsableContact(contact)) {
      invalidRows += 1
      continue
    }

    const duplicate = findDuplicate(contact, candidates)
    const target = duplicate.contactId !== null ? working[Number(duplicate.contactId)] : undefined
    if (duplicate.contactId !== null && target) {
      duplicateRows += 1
      const changes = computeContactChanges(target.contact, contact)
      for (const [field, change] of Object.entries(changes)) {
        ;(target.contact as unknown as Record<string, unknown>)[field] = change.to
      }
      if (contact.addressMatchKey) target.roles.add(roleForContactType(contact.contactType))
      target.mergedRows += 1
      candidates[Number(duplicate.contactId)] = toCandidate(duplicate.contactId, target.contact)
      continue
    }

    const id = String(working.length)
    const roles = new Set<ContactPropertyRoleValue>()
    if (contact.addressMatchKey) roles.add(roleForContactType(contact.contactType))
    working.push({ contact, roles, mergedRows: 1 })
    candidates.push(toCandidate(id, contact))
  }

  // ── Beoordelen met de regels van het product ─────────────────────────────
  const territories = options.territories ?? []
  const opportunities: IntakeOpportunity[] = []
  let notSelected = 0

  for (const item of working) {
    const { contact } = item
    const evaluation = evaluateRevive(
      {
        contactType: contact.contactType,
        status: contact.status,
        sourceCreatedAt: contact.sourceCreatedAt,
        lastContactAt: contact.lastContactAt,
        // Een CSV draagt geen interactiegeschiedenis; de import maakt er ook geen.
        interactionCount: 0,
        interactionKinds: [],
        propertyRoles: [...item.roles],
        postalCode: contact.postalCode,
        city: contact.city,
        hasPhone: contact.phoneE164 !== null,
      },
      territories,
      options.settings,
      options.now,
    )

    const category = evaluation.assessment.opportunityType
    if (!category || !evaluation.score || !evaluation.qualifies) {
      notSelected += 1
      continue
    }

    const notUsableBecause: string[] = []
    if (!contact.phoneE164 && !contact.emailNormalized) {
      notUsableBecause.push('geen geldig telefoonnummer of e-mailadres')
    }
    if (territories.length > 0 && !evaluation.territoryMatch) {
      notUsableBecause.push('buiten het opgegeven werkgebied')
    }
    if (category === 'UNCONTACTED_LEAD' && !hasLastContactColumn) {
      notUsableBecause.push('export heeft geen kolom "laatste contact": niet te zeggen of er ooit gebeld is')
    }

    opportunities.push({
      name: displayNameOf(contact),
      phone: contact.phoneE164,
      email: contact.emailNormalized,
      postalCode: contact.postalCode,
      city: contact.city,
      category,
      categoryLabel: DORMANT_CATEGORY_LABELS[category],
      score: evaluation.score.score,
      reasons: [
        CATEGORY_REASON[category],
        ...evaluation.assessment.reasons.filter((reason) => !REDUNDANT_REASONS.has(reason)),
      ],
      monthsSilent: evaluation.assessment.monthsSinceLastContact,
      usable: notUsableBecause.length === 0,
      notUsableBecause,
      mergedRows: item.mergedRows,
    })
  }

  opportunities.sort(
    (a, b) => Number(b.usable) - Number(a.usable) || b.score - a.score || a.name.localeCompare(b.name),
  )

  const unique = working.length
  const share = (count: number): number => (unique === 0 ? 0 : count / unique)
  const count = (predicate: (contact: NormalizedContact) => boolean): number =>
    working.filter((item) => predicate(item.contact)).length

  const coverage = {
    reachable: share(count((c) => c.phoneE164 !== null || c.emailNormalized !== null)),
    phone: share(count((c) => c.phoneE164 !== null)),
    email: share(count((c) => c.emailNormalized !== null)),
    address: share(count((c) => c.addressMatchKey !== null)),
    postalCode: share(count((c) => c.postalCode !== null)),
    createdAt: share(count((c) => c.sourceCreatedAt !== null)),
    lastContactAt: share(count((c) => c.lastContactAt !== null)),
    typeRecognised: share(count((c) => c.contactType !== 'UNKNOWN')),
  }

  const categories = DORMANT_CATEGORY_ORDER.map((type) => ({
    type,
    label: DORMANT_CATEGORY_LABELS[type],
    total: opportunities.filter((o) => o.category === type).length,
    usable: opportunities.filter((o) => o.category === type && o.usable).length,
  }))

  return {
    rows: rows.length,
    malformedRows: parsed.malformedRows.length,
    delimiter: parsed.delimiter,
    mapping: Object.entries(mapping)
      .filter(([, field]) => field !== 'ignore')
      .map(([column, field]) => ({ column: parsed.header[Number(column)] ?? column, field })),
    invalidRows,
    duplicateRows,
    uniqueContacts: unique,
    coverage,
    hasLastContactColumn,
    warnings: buildWarnings(coverage, hasLastContactColumn, mappedFields, parsed.malformedRows.length),
    categories,
    notSelected,
    opportunities,
    usableCount: opportunities.filter((o) => o.usable).length,
  }
}

function toCandidate(id: string, contact: NormalizedContact): DedupeCandidate {
  return {
    id,
    externalId: contact.externalId,
    phoneE164: contact.phoneE164,
    emailNormalized: contact.emailNormalized,
    nameNormalized: contact.nameNormalized,
    addressMatchKey: contact.addressMatchKey,
    postalCode: contact.postalCode,
  }
}

function displayNameOf(contact: NormalizedContact): string {
  const fromParts = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  if (contact.firstName && contact.lastName) return fromParts
  // "Janssens, Pieter" → "Pieter Janssens": zo spreekt een makelaar iemand aan.
  const comma = contact.displayName?.match(/^([^,]+),\s*(.+)$/)
  if (comma?.[1] && comma[2]) return `${comma[2]} ${comma[1]}`
  return contact.displayName ?? (fromParts || '(naam onbekend)')
}

function buildWarnings(
  coverage: IntakeReport['coverage'],
  hasLastContactColumn: boolean,
  mappedFields: Set<CrmImportField>,
  malformedRows: number,
): string[] {
  const warnings: string[] = []
  const pct = (value: number): string => `${Math.round(value * 100)}%`

  if (!hasLastContactColumn) {
    warnings.push(
      'Geen kolom "laatste contact". Zonder die datum is "hoe lang stil" onbekend en telt "nooit opgevolgd" niet mee.',
    )
  } else if (coverage.lastContactAt < 0.5) {
    warnings.push(`Slechts ${pct(coverage.lastContactAt)} van de contacten heeft een datum van laatste contact.`)
  }
  if (!mappedFields.has('contactType')) {
    warnings.push('Geen kolom met het type contact (koper, verkoper, schatting…). De categorieën hangen daarvan af.')
  } else if (coverage.typeRecognised < 0.7) {
    warnings.push(`Bij ${pct(1 - coverage.typeRecognised)} van de contacten is het type niet herkend.`)
  }
  if (coverage.address < 0.5) {
    warnings.push(
      `Slechts ${pct(coverage.address)} heeft een volledig adres. Zonder adres koppelt het product een contact niet aan een pand, en dat verlaagt de relatiescore.`,
    )
  }
  if (coverage.reachable < 0.8) {
    warnings.push(`Slechts ${pct(coverage.reachable)} heeft een geldig telefoonnummer of e-mailadres.`)
  }
  if (!mappedFields.has('sourceCreatedAt')) {
    warnings.push('Geen aanmaakdatum. Dan is de leeftijd van de relatie onbekend.')
  }
  if (malformedRows > 0) {
    warnings.push(`${malformedRows} rij(en) met een afwijkend aantal kolommen.`)
  }
  return warnings
}
