import type { NormalizedContact } from './normalizeContact'

/**
 * Herkent of een te importeren contact al bestaat.
 *
 * ─── DE ASYMMETRIE DIE DE OPZET BEPAALT ──────────────────────────────────────
 *
 * Te weinig ontdubbelen → het kantoor krijgt Pieter Janssens twee keer in zijn
 *                          lijst. Vervelend, zichtbaar, en met een tweede import
 *                          te herstellen.
 *
 * Te veel ontdubbelen   → twee verschillende mensen worden één record. De
 *                          gegevens van de een overschrijven die van de ander,
 *                          en de oorspronkelijke scheiding is weg. Dat is niet
 *                          te herstellen, en het is data van de klant.
 *
 * Vandaar: alleen sleutels die een persoon écht identificeren leiden tot een
 * match. Naamgelijkenis doet dat niet — er wonen in Vlaanderen duizenden mensen
 * die Jan Peeters heten — en telt hier daarom alléén mee als bevestiging naast
 * een adres, nooit op zichzelf.
 */

export type DedupeStrength = 'exact' | 'strong' | 'weak' | 'none'

export interface DedupeCandidate {
  id: string
  externalId: string | null
  phoneE164: string | null
  emailNormalized: string | null
  nameNormalized: string | null
  addressMatchKey: string | null
  postalCode: string | null
}

export interface DedupeResult {
  contactId: string | null
  strength: DedupeStrength
  /** 0–1, voor het geval een aanroeper zelf een drempel wil leggen. */
  confidence: number
  reason: string | null
}

const NO_MATCH: DedupeResult = {
  contactId: null,
  strength: 'none',
  confidence: 0,
  reason: null,
}

/**
 * Zoekt het bestaande contact dat hetzelfde is als `incoming`.
 *
 * De rangorde van sleutels, van hard naar zacht:
 *
 *  1. `externalId`  — het kantoor zegt zelf dat dit hetzelfde record is. Er is
 *                     geen sterker signaal denkbaar; dit is per definitie een
 *                     update en geen nieuw contact.
 *  2. telefoon      — in E.164. Een Belgisch gsm-nummer hoort bij één persoon.
 *  3. e-mail        — bijna even sterk. Iets zwakker omdat gezinnen soms één
 *                     adres delen (info@, of het adres van de partner).
 *  4. naam + adres  — samen identificerend, apart niet. Dit is de enige plek
 *                     waar naam meetelt, en alleen mét een exact adres ernaast.
 *
 * Alles daaronder is geen match. Twee mensen met dezelfde naam in dezelfde
 * gemeente is geen bewijs; België is klein en achternamen zijn geclusterd.
 */
export function findDuplicate(
  incoming: NormalizedContact,
  candidates: readonly DedupeCandidate[],
): DedupeResult {
  if (candidates.length === 0) return NO_MATCH

  if (incoming.externalId) {
    const byExternalId = candidates.find(
      (candidate) => candidate.externalId !== null && candidate.externalId === incoming.externalId,
    )
    if (byExternalId) {
      return {
        contactId: byExternalId.id,
        strength: 'exact',
        confidence: 1,
        reason: `Zelfde CRM-id (${incoming.externalId})`,
      }
    }
  }

  if (incoming.phoneE164) {
    const byPhone = candidates.find((candidate) => candidate.phoneE164 === incoming.phoneE164)
    if (byPhone) {
      return {
        contactId: byPhone.id,
        strength: 'strong',
        confidence: 0.95,
        reason: 'Zelfde telefoonnummer',
      }
    }
  }

  if (incoming.emailNormalized) {
    const byEmail = candidates.find(
      (candidate) => candidate.emailNormalized === incoming.emailNormalized,
    )
    if (byEmail) {
      return {
        contactId: byEmail.id,
        strength: 'strong',
        confidence: 0.9,
        reason: 'Zelfde e-mailadres',
      }
    }
  }

  if (incoming.nameNormalized && incoming.addressMatchKey) {
    const byNameAndAddress = candidates.find(
      (candidate) =>
        candidate.nameNormalized === incoming.nameNormalized &&
        candidate.addressMatchKey !== null &&
        candidate.addressMatchKey === incoming.addressMatchKey,
    )
    if (byNameAndAddress) {
      return {
        contactId: byNameAndAddress.id,
        strength: 'weak',
        confidence: 0.75,
        reason: 'Zelfde naam op hetzelfde adres',
      }
    }
  }

  return NO_MATCH
}

/**
 * De velden die een import mag bijwerken op een bestaand contact, met per veld
 * de wijziging.
 *
 * ─── "NOOIT STILZWIJGEND OVERSCHRIJVEN", CONCREET ────────────────────────────
 *
 * Twee regels:
 *
 *  1. Een lege waarde overschrijft nooit een gevulde. Een export waarin de
 *     notitiekolom ontbreekt zou anders alle notities van het kantoor wissen —
 *     de duurste manier om een klant te verliezen die er is.
 *
 *  2. Elke wijziging komt terug in het resultaat en wordt vastgelegd op
 *     `CrmImportRow.changes`. Achteraf is dus per veld te zien wat er stond en
 *     wat het werd.
 *
 * `lastContactAt` gaat alleen vooruit: een oudere datum uit een oud bestand mag
 * een recenter contactmoment niet ongedaan maken.
 */
export interface ContactChange {
  from: unknown
  to: unknown
}

export type ContactChanges = Record<string, ContactChange>

/** Wat er van een bestaand contact bekend is voordat we bijwerken. */
export interface ExistingContactState {
  firstName: string | null
  lastName: string | null
  displayName: string | null
  email: string | null
  phone: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  emailNormalized: string | null
  phoneE164: string | null
  nameNormalized: string | null
  addressMatchKey: string | null
  contactType: string
  status: string
  leadType: string | null
  assignedAgentName: string | null
  notes: string | null
  sourceCreatedAt: Date | null
  lastContactAt: Date | null
}

/** Velden waarvan een lege inkomende waarde nooit een bestaande mag wissen. */
const TEXT_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'email',
  'phone',
  'address',
  'postalCode',
  'city',
  'emailNormalized',
  'phoneE164',
  'nameNormalized',
  'addressMatchKey',
  'leadType',
  'assignedAgentName',
  'notes',
] as const satisfies readonly (keyof ExistingContactState)[]

/**
 * Is de nieuwe naam armer dan wat er al staat?
 *
 * ─── HET GEVAL DAT DIT AFVANGT ───────────────────────────────────────────────
 *
 * Een export met alleen een kolom "Voornaam" levert per rij de naam "Pieter" op.
 * Zonder deze controle wordt "Pieter Janssens" in het klantenbestand daarmee
 * overschreven door "Pieter" — en dan is het kantoor bij één import de
 * achternaam van zijn hele bestand kwijt. Dat is precies het soort stille
 * schade waar de belofte "nooit stilzwijgend overschrijven" over gaat: er
 * wórdt een waarde geschreven, dus geen enkele lege-waarde-controle grijpt in.
 *
 * De regel: bevat de bestaande naam alle woorden van de nieuwe én meer, dan is
 * de nieuwe een verschraling en geen wijziging. Een echte naamswijziging
 * ("Pieter Janssens" → "Pieter De Vos") introduceert nieuwe woorden en gaat dus
 * gewoon door.
 */
function isPoorerName(current: string | null, next: string): boolean {
  if (!current) return false

  const tokenise = (value: string): string[] =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1)

  const currentTokens = new Set(tokenise(current))
  const nextTokens = tokenise(next)

  if (nextTokens.length === 0 || nextTokens.length >= currentTokens.size) return false
  return nextTokens.every((token) => currentTokens.has(token))
}

export function computeContactChanges(
  existing: ExistingContactState,
  incoming: NormalizedContact,
): ContactChanges {
  const changes: ContactChanges = {}

  for (const field of TEXT_FIELDS) {
    const next = incoming[field as keyof NormalizedContact] as string | null | undefined
    const current = existing[field]

    if (next === null || next === undefined || next === '') continue
    if (current === next) continue

    // Namen mogen wijzigen, maar niet verschralen.
    if (
      (field === 'displayName' || field === 'nameNormalized') &&
      isPoorerName(current, next)
    ) {
      continue
    }

    changes[field] = { from: current, to: next }
  }

  // Enums: `UNKNOWN` uit het bestand is geen informatie en mag een eerder
  // vastgesteld type niet terugzetten.
  if (incoming.contactType !== 'UNKNOWN' && incoming.contactType !== existing.contactType) {
    changes.contactType = { from: existing.contactType, to: incoming.contactType }
  }
  if (incoming.status !== 'UNKNOWN' && incoming.status !== existing.status) {
    changes.status = { from: existing.status, to: incoming.status }
  }

  // Datums: alleen vooruit, en alleen als ze er zijn.
  if (
    incoming.sourceCreatedAt &&
    (!existing.sourceCreatedAt || incoming.sourceCreatedAt < existing.sourceCreatedAt)
  ) {
    // De vróégste aanmaakdatum is de juiste: de relatie begon toen, ook als een
    // later bestand een importdatum meestuurt.
    changes.sourceCreatedAt = { from: existing.sourceCreatedAt, to: incoming.sourceCreatedAt }
  }

  if (
    incoming.lastContactAt &&
    (!existing.lastContactAt || incoming.lastContactAt > existing.lastContactAt)
  ) {
    changes.lastContactAt = { from: existing.lastContactAt, to: incoming.lastContactAt }
  }

  return changes
}

export function hasChanges(changes: ContactChanges): boolean {
  return Object.keys(changes).length > 0
}
