/**
 * Datumrekenwerk voor de pijplijn.
 *
 * Alles wat met "hoe lang staat dit al te koop" te maken heeft loopt hierlangs.
 * Dat is geen luxe: de stale-detectie, de scoring en de teksten in Telegram
 * moeten hetzelfde antwoord geven op dezelfde vraag, anders meldt het systeem
 * "64 dagen online" terwijl het dashboard 63 toont.
 */

export const MS_PER_DAY = 86_400_000

/** Hele dagen tussen twee momenten, naar beneden afgerond. Nooit negatief. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY))
}

/** Minuten tussen twee momenten, naar beneden afgerond. Nooit negatief. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

/**
 * Hele maanden tussen twee momenten.
 *
 * Via kalendermaanden en niet via "dagen gedeeld door 30". LeadRevive rekent in
 * jaren stilte ("acht jaar geen contact"), en dan loopt de 30-dagenbenadering na
 * zeven jaar ruim een maand uit de pas — genoeg om een contact net wel of net
 * niet over een drempel te tillen.
 */
export function monthsBetween(from: Date, to: Date): number {
  const years = to.getUTCFullYear() - from.getUTCFullYear()
  const months = to.getUTCMonth() - from.getUTCMonth()
  const total = years * 12 + months

  // De laatste maand telt pas als de dag van de maand ook gepasseerd is.
  return Math.max(0, to.getUTCDate() < from.getUTCDate() ? total - 1 : total)
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Het uur in Europe/Brussels.
 *
 * Bewust via `Intl` en niet via de systeemtijdzone: een digest die om 07:00
 * lokale tijd hoort te vertrekken moet dat ook doen wanneer de container in UTC
 * draait — en dat doet hij, want dat is de standaard op vrijwel elke host.
 */
export function hourInBrussels(date: Date): number {
  const formatted = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels',
    hour: 'numeric',
    hour12: false,
  }).format(date)

  const parsed = Number(formatted)
  return Number.isFinite(parsed) ? parsed % 24 : date.getUTCHours()
}

/**
 * Valt `hour` binnen een stiltevenster?
 *
 * Ondersteunt vensters die over middernacht heen lopen (22 → 7), want dat is
 * precies het venster dat een makelaar instelt.
 */
export function isWithinQuietHours(
  hour: number,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  if (start === null || start === undefined || end === null || end === undefined) return false
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

/** "14 jan 2026" — compact en eenduidig in tabellen. */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Brussels',
  }).format(date)
}

/** "14 jan 2026, 09:32" — voor timelines waar het tijdstip meetelt. */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(date)
}

/** "3 min geleden", "5 d geleden" — leest sneller dan een absolute datum. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const minutes = minutesBetween(date, now)
  if (minutes < 1) return 'zojuist'
  if (minutes < 60) return `${minutes} min geleden`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} u geleden`

  const days = Math.floor(hours / 24)
  if (days < 31) return `${days} d geleden`

  const months = Math.floor(days / 30)
  return months < 12 ? `${months} mnd geleden` : `${Math.floor(days / 365)} j geleden`
}

/**
 * 23:59:59.999 op een kalenderdag in Europe/Brussels, als absoluut tijdstip.
 *
 * De offset is +01:00 in de winter en +02:00 in de zomer; een vaste offset zou
 * een abonnement een uur te vroeg of te laat laten aflopen. We nemen de offset
 * die op die dag om de middag geldt — de omschakeling valt altijd 's nachts
 * vroeg, dus om 23:59 geldt dezelfde.
 *
 * Geeft null bij een ongeldige datum (bv. 2026-02-30).
 */
export function endOfDayInBrussels(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null

  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)

  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12))
  if (
    noonUtc.getUTCFullYear() !== year ||
    noonUtc.getUTCMonth() !== month - 1 ||
    noonUtc.getUTCDate() !== day
  ) {
    return null
  }

  const brusselsNoon = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(noonUtc)
  const offsetHours = Number(brusselsNoon) - 12

  return new Date(Date.UTC(year, month - 1, day, 23 - offsetHours, 59, 59, 999))
}
