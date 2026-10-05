import { buildMatchKey, parseBelgianAddress } from '@/domain/geo/address'
import {
  cityForPostalCode,
  parseBelgianPostalCode,
  provinceForPostalCode,
} from '@/domain/geo/provinces'
import { normalizeBelgianPhone } from '@/lib/phone'
import { normalizeText } from '@/lib/text'

/**
 * Eén CSV-rij → een contact zoals wij het opslaan.
 *
 * ─── DE REGEL DIE HIER GELDT ─────────────────────────────────────────────────
 *
 * De genormaliseerde velden (`phoneE164`, `emailNormalized`, `nameNormalized`,
 * `addressMatchKey`) bestaan uitsluitend om te kunnen matchen. Ze staan náást de
 * originelen en vervangen ze nooit. Als het kantoor "Jan Van der Straeten" heeft
 * ingevoerd, dan is dat wat de makelaar op zijn scherm ziet — niet
 * "jan van der straeten".
 *
 * Dat is geen kosmetiek. Een makelaar herkent zijn eigen klantenbestand aan hoe
 * hij het zelf heeft opgeschreven; normaliseer je dat weg, dan voelt het CRM
 * ineens als andermans systeem.
 */

export type ContactTypeValue =
  | 'BUYER'
  | 'SELLER'
  | 'LANDLORD'
  | 'TENANT'
  | 'VALUATION_LEAD'
  | 'PROSPECT'
  | 'FORMER_CLIENT'
  | 'UNKNOWN'

export type ContactStatusValue = 'ACTIVE' | 'DORMANT' | 'LOST' | 'WON' | 'UNKNOWN'

export interface RawContactInput {
  externalId?: string
  firstName?: string
  lastName?: string
  displayName?: string
  email?: string
  phone?: string
  address?: string
  postalCode?: string
  city?: string
  contactType?: string
  status?: string
  leadType?: string
  assignedAgentName?: string
  notes?: string
  sourceCreatedAt?: string
  lastContactAt?: string
}

export interface NormalizedContact {
  externalId: string | null

  firstName: string | null
  lastName: string | null
  displayName: string | null

  email: string | null
  phone: string | null

  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null

  emailNormalized: string | null
  phoneE164: string | null
  nameNormalized: string | null
  addressMatchKey: string | null

  contactType: ContactTypeValue
  status: ContactStatusValue
  leadType: string | null
  assignedAgentName: string | null
  notes: string | null

  sourceCreatedAt: Date | null
  lastContactAt: Date | null
}

/** Een rij zonder enig identificerend gegeven kan geen contact worden. */
export function isUsableContact(contact: NormalizedContact): boolean {
  return (
    contact.phoneE164 !== null ||
    contact.emailNormalized !== null ||
    (contact.nameNormalized !== null && contact.nameNormalized.length >= 3)
  )
}

const CONTACT_TYPE_PATTERNS: readonly (readonly [ContactTypeValue, readonly string[]])[] = [
  ['VALUATION_LEAD', ['schatting', 'waardebepaling', 'valuation', 'estimation', 'expertise']],
  ['SELLER', ['verkoper', 'verkoop', 'vendeur', 'seller', 'vendre', 'te koop']],
  ['BUYER', ['koper', 'aankoop', 'acheteur', 'buyer', 'zoeker', 'kandidaat koper']],
  ['LANDLORD', ['verhuurder', 'eigenaar verhuur', 'bailleur', 'landlord']],
  ['TENANT', ['huurder', 'locataire', 'tenant']],
  ['FORMER_CLIENT', ['oud klant', 'ex klant', 'former client', 'ancien client', 'klant']],
  ['PROSPECT', ['prospect', 'lead', 'interesse', 'contact']],
]

export function normalizeContactType(input: string | null | undefined): ContactTypeValue {
  const normalized = normalizeText(input)
  if (normalized.length === 0) return 'UNKNOWN'

  for (const [type, patterns] of CONTACT_TYPE_PATTERNS) {
    if (patterns.some((pattern) => normalized.includes(pattern))) return type
  }

  return 'UNKNOWN'
}

export function normalizeContactStatus(input: string | null | undefined): ContactStatusValue {
  const normalized = normalizeText(input)
  if (normalized.length === 0) return 'UNKNOWN'

  if (/(gewonnen|won|klant geworden|verkocht|sold|mandaat)/.test(normalized)) return 'WON'
  if (/(verloren|lost|afgewezen|geen interesse|perdu)/.test(normalized)) return 'LOST'
  if (/(slapend|dormant|inactief|inactive)/.test(normalized)) return 'DORMANT'
  if (/(actief|active|lopend|open)/.test(normalized)) return 'ACTIVE'

  return 'UNKNOWN'
}

/**
 * Datums uit CRM-exports.
 *
 * Belgische exports schrijven `31/12/2019` (dag eerst). `new Date()` leest dat
 * als Amerikaans en maakt er een ongeldige datum van, of erger: `01/12/2019`
 * wordt 12 januari in plaats van 1 december. Dat verschil van elf maanden
 * bepaalt of een relatie dormant heet, dus het moet expliciet.
 */
export function parseContactDate(input: string | null | undefined): Date | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const dayFirst = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (dayFirst) {
    const [, day, month, year] = dayFirst
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  // ISO en alles wat daarop lijkt (2019-12-31, 2019-12-31T10:00:00Z).
  const isoLike = /^\d{4}-\d{2}-\d{2}/.test(trimmed)
  if (isoLike) {
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const fallback = new Date(trimmed)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function clean(input: string | undefined): string | null {
  if (!input) return null
  const trimmed = input.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * De naamsleutel waarop gededupliceerd en gematcht wordt.
 *
 * ─── WAAROM DE WOORDEN GESORTEERD WORDEN ─────────────────────────────────────
 *
 * Ongeveer de helft van de CRM-exports schrijft "Janssens, Pieter" en de andere
 * helft "Pieter Janssens" — soms binnen één bestand, afhankelijk van wie de rij
 * ooit invoerde. Een sleutel die de volgorde bewaart, geeft die twee vormen twee
 * verschillende sleutels, en dan herkent de deduplicatie dezelfde persoon niet
 * bij een tweede import.
 *
 * Sorteren maakt de sleutel volgorde-ongevoelig. Dat vergroot het risico op een
 * onterechte samenvoeging niet: naam alleen leidt nooit tot een match — er moet
 * altijd een exact adres of een harder gegeven naast staan (zie dedupe.ts en
 * crmMatcher.ts).
 *
 * Woorden van één letter (initialen) vallen weg: "P. Janssens" en
 * "Pieter Janssens" horen dezelfde sleutel te geven.
 */
export function buildNameKey(input: string | null | undefined): string | null {
  if (!input) return null

  const tokens = normalizeText(input)
    .split(' ')
    .filter((token) => token.length > 1)

  if (tokens.length === 0) return null
  return [...tokens].sort().join(' ')
}

export function normalizeContact(input: RawContactInput): NormalizedContact {
  const firstName = clean(input.firstName)
  const lastName = clean(input.lastName)

  // Volledige naam: wat het kantoor zelf schreef wint; anders samengesteld.
  const displayName =
    clean(input.displayName) ??
    ([firstName, lastName].filter(Boolean).join(' ').trim() || null)

  const email = clean(input.email)
  const phone = clean(input.phone)
  const parsedPhone = normalizeBelgianPhone(phone)

  const parsedAddress = parseBelgianAddress(input.address)
  const postalCode =
    parseBelgianPostalCode(input.postalCode) ?? parsedAddress.postalCode ?? null
  const city = clean(input.city) ?? parsedAddress.city ?? cityForPostalCode(postalCode)

  return {
    externalId: clean(input.externalId),

    firstName,
    lastName,
    displayName,

    email,
    phone,

    address: parsedAddress.address ?? clean(input.address),
    postalCode,
    city,
    province: provinceForPostalCode(postalCode),

    // Een e-mailadres is hoofdletterongevoelig; zonder deze stap zijn
    // "Jan@example.be" en "jan@example.be" twee contacten.
    emailNormalized: email ? email.toLowerCase() : null,
    phoneE164: parsedPhone?.e164 ?? null,
    nameNormalized: buildNameKey(displayName),
    addressMatchKey: buildMatchKey(
      postalCode,
      parsedAddress.streetName,
      parsedAddress.houseNumber,
    ),

    contactType: normalizeContactType(input.contactType ?? input.leadType),
    status: normalizeContactStatus(input.status),
    leadType: clean(input.leadType),
    assignedAgentName: clean(input.assignedAgentName),
    notes: clean(input.notes),

    sourceCreatedAt: parseContactDate(input.sourceCreatedAt),
    lastContactAt: parseContactDate(input.lastContactAt),
  }
}
