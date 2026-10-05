/**
 * Belgische telefoonnummers naar E.164.
 *
 * Waarom met de hand en niet libphonenumber: we hebben precies één land nodig,
 * en het Belgische nummerplan is klein genoeg om exact te vatten. Een
 * afhankelijkheid van 500 kB voor twee prefixregels is geen goede ruil.
 *
 * Dit is in de eerste plaats een *matching*-primitief. Twee advertenties die
 * "0475 12 34 56" en "+32475123456" schrijven horen dezelfde verkoper te zijn;
 * lukt dat niet, dan ziet het systeem één particulier als twee en verliest de
 * professioneel-detectie ("deze verkoper heeft acht advertenties") haar basis.
 */

/**
 * Mobiele prefixen (zonder landcode, zonder voorloopnul): 45x–49x. Een mobiel
 * nummer is een sterker particulier-signaal dan een vast nummer, dus de
 * classificatie wil dit onderscheid kennen.
 */
const MOBILE_PREFIXES = /^4[5-9][0-9]/

export interface ParsedPhone {
  /** +32XXXXXXXXX */
  e164: string
  national: string
  isMobile: boolean
}

/**
 * Haalt cijfers uit vrije tekst. Belgische advertenties schrijven nummers als
 * "0475/12.34.56", "0475 123 456", "+32 (0)475 12 34 56" — allemaal hetzelfde.
 */
function digitsOf(input: string): { digits: string; hadPlus: boolean } {
  const trimmed = input.trim()
  // "(0)" na een landcode is een schrijfconventie, geen cijfer.
  const withoutParenZero = trimmed.replace(/\(\s*0\s*\)/g, '')
  return {
    digits: withoutParenZero.replace(/\D/g, ''),
    hadPlus: /^\s*(\+|00)/.test(trimmed),
  }
}

/**
 * Normaliseert een Belgisch nummer naar E.164, of geeft null als het er geen is.
 *
 * Buitenlandse nummers geven bewust null: een lead met een Frans nummer is voor
 * deze dienst geen bruikbaar contactpunt, en hem als "+33…" opslaan zou hem in
 * de matching laten meedoen alsof we hem begrepen hadden.
 */
export function normalizeBelgianPhone(input: string | null | undefined): ParsedPhone | null {
  if (!input) return null

  const { digits, hadPlus } = digitsOf(input)
  if (digits.length < 8) return null

  let national: string | null = null

  if (digits.startsWith('0032')) {
    national = digits.slice(4)
  } else if (digits.startsWith('32') && hadPlus) {
    national = digits.slice(2)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  } else if (!hadPlus && (digits.length === 8 || digits.length === 9)) {
    // Nummer zonder voorloopnul en zonder landcode; in BE-context is dat een
    // nationaal nummer waarvan de nul is weggelaten.
    national = digits
  } else if (digits.startsWith('32')) {
    national = digits.slice(2)
  }

  if (national === null) return null
  // Een leidende nul kan alsnog overblijven bij "0032 0475…"-achtige invoer.
  national = national.replace(/^0+/, '')

  // Belgische nationale nummers zijn 8 cijfers (vast) of 9 (mobiel en enkele
  // vaste zones). Alles daarbuiten is geen Belgisch nummer.
  if (national.length !== 8 && national.length !== 9) return null

  return {
    e164: `+32${national}`,
    national: `0${national}`,
    isMobile: national.length === 9 && MOBILE_PREFIXES.test(national),
  }
}

/** Alle Belgische nummers uit een vrije tekst, ontdubbeld en op volgorde. */
export function extractBelgianPhones(text: string | null | undefined): ParsedPhone[] {
  if (!text) return []

  // Kandidaten: reeksen cijfers met scheidingstekens, lang genoeg om een
  // telefoonnummer te kunnen zijn. Bewust ruim — normalizeBelgianPhone filtert.
  const candidates = text.match(/(?:\+|00)?[\d][\d\s./()-]{7,20}\d/g) ?? []

  const seen = new Set<string>()
  const found: ParsedPhone[] = []

  for (const candidate of candidates) {
    const parsed = normalizeBelgianPhone(candidate)
    if (parsed && !seen.has(parsed.e164)) {
      seen.add(parsed.e164)
      found.push(parsed)
    }
  }

  return found
}

/**
 * Toont een nummer gedeeltelijk gemaskeerd, voor schermen waar het volledige
 * nummer geen functie heeft. De makelaar krijgt het volledige nummer op de
 * detailpagina van de opportunity; een overzichtstabel heeft er niets aan en
 * zou het alleen maar op honderd schermen tegelijk tonen.
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '—'
  if (e164.length <= 6) return e164
  return `${e164.slice(0, 6)}${'•'.repeat(Math.max(0, e164.length - 8))}${e164.slice(-2)}`
}
