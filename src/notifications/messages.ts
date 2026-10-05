import { OPPORTUNITY_TYPE_HINTS, OPPORTUNITY_TYPE_LABELS } from '@/events/opportunityRules'
import type { OpportunityTypeValue } from '@/events/opportunityRules'
import { daysBetween, formatDate } from '@/lib/dates'
import type { OpportunityListItem } from '@/repositories/opportunityRepository'

/**
 * De berichten die een makelaar daadwerkelijk leest.
 *
 * ─── WAT EEN ALERT MOET DOEN ─────────────────────────────────────────────────
 *
 * Een makelaar leest dit op zijn telefoon, tussen twee bezichtigingen door, en
 * beslist in drie seconden of hij belt. Het bericht moet dus in die volgorde
 * antwoord geven op: waar, wat, hoeveel, waarom nu, en waar kan ik verder lezen.
 *
 * Alles wat daar niet aan bijdraagt is ruis. Vandaar geen scoretechniek, geen
 * dimensies, geen interne id's — die staan in het dashboard, achter de link.
 *
 * ─── WAT ER NIET IN STAAT ────────────────────────────────────────────────────
 *
 * Geen telefoonnummer van de verkoper. Een chatbericht wordt doorgestuurd,
 * gescreenshot en blijft in twintig telefoons staan; het nummer hoort achter de
 * login, bij de opportunity, waar te zien is wie het opvroeg. De makelaar is één
 * tik verwijderd van het volledige dossier.
 */

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  HOUSE: 'Huis',
  APARTMENT: 'Appartement',
  LAND: 'Bouwgrond',
  COMMERCIAL: 'Handelspand',
  GARAGE: 'Garage',
  OTHER: 'Vastgoed',
}

function euro(value: number | null): string {
  return value === null ? 'prijs onbekend' : `€ ${value.toLocaleString('nl-BE')}`
}

function locationLine(item: OpportunityListItem): string {
  const property = item.property
  if (!property) return '📍 Locatie onbekend'

  const parts = [property.postalCode, property.city].filter(Boolean).join(' ')
  return `📍 ${parts.length > 0 ? parts : (property.address ?? 'Locatie onbekend')}`
}

/** Het icoon geeft in één blik de urgentie aan. */
function scoreIcon(score: number): string {
  if (score >= 85) return '🔥'
  if (score >= 70) return '⭐'
  return '📌'
}

export interface AlertMessageOptions {
  baseUrl: string
  /** Redenen uit de scoring, zwaarste eerst. */
  reasons: string[]
}

export function buildOpportunityMessage(
  item: OpportunityListItem,
  options: AlertMessageOptions,
): string {
  const type = item.type as OpportunityTypeValue
  const lines: string[] = []

  lines.push(`${scoreIcon(item.score)} ${OPPORTUNITY_TYPE_LABELS[type].toUpperCase()}`)
  lines.push('')
  lines.push(locationLine(item))

  if (item.property) {
    lines.push(`🏠 ${PROPERTY_TYPE_LABELS[item.property.propertyType] ?? 'Vastgoed'}`)
  }
  if (item.listing) {
    lines.push(`💰 ${euro(item.listing.currentPrice)}`)
  }

  lines.push('')
  lines.push(`${scoreIcon(item.score)} Score: ${item.score}/100`)

  // De feitelijke onderbouwing, kort. Vier regels is wat er op een telefoon
  // past zonder dat er gescrold moet worden.
  const facts: string[] = []

  if (item.listing) {
    const listing = item.listing
    if (listing.sellerType === 'PRIVATE') {
      facts.push(`Particuliere verkoper: ${Math.round(listing.sellerConfidence * 100)}%`)
    }
    facts.push(`Online: ${daysBetween(listing.firstSeenAt, new Date())} dagen`)
    if (listing.priceDropCount > 0) {
      facts.push(`Prijsverlagingen: ${listing.priceDropCount}`)
    }
    if (listing.initialPrice && listing.initialPrice !== listing.currentPrice) {
      facts.push(`Oorspronkelijke vraagprijs: ${euro(listing.initialPrice)}`)
    }
  }

  if (item.crmContact) {
    // Dit is waarom dit product bestaat; het hoort bovenaan de feiten te staan.
    facts.unshift(`⭐ Bekend in jullie CRM: ${item.crmContact.displayName ?? 'contact'}`)
    if (item.crmContact.lastContactAt) {
      facts.push(`Laatste contact: ${formatDate(item.crmContact.lastContactAt)}`)
    }
  }

  if (facts.length > 0) {
    lines.push('')
    lines.push(...facts)
  }

  const reason = options.reasons[0]
  if (reason) {
    lines.push('')
    lines.push('Waarom nu:')
    lines.push(reason)
  }

  lines.push('')
  lines.push(OPPORTUNITY_TYPE_HINTS[type])

  if (item.matchedTerritoryName) {
    lines.push('')
    lines.push(`Gebied: ${item.matchedTerritoryName}`)
  }

  lines.push('')
  lines.push(`🔗 ${options.baseUrl}/opportunities/${item.id}`)

  return lines.join('\n')
}

export interface DigestOptions {
  baseUrl: string
  agencyName: string
  date: Date
}

/**
 * De ochtenddigest.
 *
 * Eén bericht met de stand van zaken, in plaats van acht losse meldingen tussen
 * 6:00 en 8:00. Een makelaar die om half negen zijn telefoon pakt wil weten wat
 * er ligt, niet acht keer apart gestoord zijn geweest.
 */
export function buildDigestMessage(
  items: readonly OpportunityListItem[],
  options: DigestOptions,
): string {
  const lines: string[] = []

  lines.push('IMMORADAR — KANSEN VAN VANDAAG')
  lines.push(options.agencyName)
  lines.push(formatDate(options.date))
  lines.push('')

  if (items.length === 0) {
    lines.push('Geen nieuwe kansen sinds gisteren.')
    lines.push('')
    lines.push(`🔗 ${options.baseUrl}/opportunities`)
    return lines.join('\n')
  }

  const hot = items.filter((item) => item.score >= 70)
  lines.push(`${hot.length > 0 ? '🔥' : '📌'} ${items.length} nieuwe kansen`)

  if (hot.length > 0) lines.push(`waarvan ${hot.length} met score 70+`)
  lines.push('')

  // Uitsplitsing per type, alleen wat voorkomt. Een regel "0 herplaatsingen" is
  // ruimte zonder informatie.
  const counts = new Map<OpportunityTypeValue, number>()
  for (const item of items) {
    const type = item.type as OpportunityTypeValue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }

  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`${count}× ${OPPORTUNITY_TYPE_LABELS[type]}`)
  }

  const top = items[0]
  if (top) {
    lines.push('')
    lines.push('Beste kans:')
    lines.push(locationLine(top).replace('📍 ', ''))
    if (top.listing) lines.push(euro(top.listing.currentPrice))
    lines.push(`Score ${top.score}/100`)
    lines.push(`🔗 ${options.baseUrl}/opportunities/${top.id}`)
  }

  const crmCount = items.filter((item) => item.crmContactId !== null).length
  if (crmCount > 0) {
    lines.push('')
    lines.push(`⭐ ${crmCount} hiervan staan al in jullie klantenbestand.`)
  }

  lines.push('')
  lines.push(`🔗 Alle kansen: ${options.baseUrl}/opportunities`)

  return lines.join('\n')
}
