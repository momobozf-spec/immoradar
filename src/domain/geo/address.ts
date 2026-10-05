import { normalizeText } from '@/lib/text'

import { isBelgianPostalCode, parseBelgianPostalCode } from './provinces'

/**
 * Belgische adressen uit elkaar halen.
 *
 * ─── WAAROM DIT ZO VOORZICHTIG IS ────────────────────────────────────────────
 *
 * Het huisnummer is het scherpste matching-signaal dat we hebben: twee
 * advertenties op "Kerkstraat 12" in 9000 zijn vrijwel zeker hetzelfde pand,
 * terwijl "Kerkstraat" alleen niets zegt — daar staan honderd huizen aan. Maar
 * een *verkeerd* geraden huisnummer is erger dan geen huisnummer: dan koppelt de
 * matcher twee verschillende woningen aan één pand en loopt hun geschiedenis
 * door elkaar. Vandaar dat elke twijfelachtige vorm hier `null` teruggeeft in
 * plaats van een gok.
 *
 * De vormen die in Belgische advertenties voorkomen:
 *
 *   Kerkstraat 12, 9000 Gent          NL: straat, nummer, postcode, gemeente
 *   Rue de la Loi 16, 1000 Bruxelles  FR: idem
 *   Kerkstraat 12 bus 3               busnummer — hoort niet bij het huisnummer
 *   Avenue Louise 143/5               appartement achter een schuine streep
 *   9000 Gent                         alleen gemeente, geen straat
 */

export interface ParsedAddress {
  /** De volledige regel, opgeschoond. */
  address: string | null
  streetName: string | null
  /** Zonder bus- of appartementsaanduiding: "143/5 bus 2" → "143". */
  houseNumber: string | null
  postalCode: string | null
  city: string | null
}

const EMPTY: ParsedAddress = {
  address: null,
  streetName: null,
  houseNumber: null,
  postalCode: null,
  city: null,
}

/**
 * Het huisnummer aan het einde van een straatdeel.
 *
 * Verplicht beginnend met een cijfer, eventueel gevolgd door één letter
 * ("12A", "12 A"). Alles daarachter — "/5", "bus 3", "b3" — is een
 * appartementsaanduiding en hoort niet in de vergelijking: twee advertenties
 * voor bus 2 en bus 5 staan in hetzelfde gebouw, en dat is voor de matcher
 * hetzelfde pand met een verschillende eenheid.
 */
const HOUSE_NUMBER = /\s(\d{1,4})\s*([a-zA-Z])?(?:\s*(?:\/|bus|bte|boite|boîte|b)\s*[\w-]+)?\s*$/i

/** Woorden die een straat aanduiden — helpt te herkennen dát er een straat staat. */
const STREET_MARKERS = [
  'straat', 'laan', 'steenweg', 'baan', 'dreef', 'plein', 'weg', 'kaai', 'markt', 'pad', 'wal',
  'rue', 'avenue', 'chaussee', 'boulevard', 'place', 'chemin', 'route', 'quai', 'allee', 'clos',
]

function cleanupWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

/**
 * Splitst een adresregel in straat, nummer, postcode en gemeente.
 *
 * Werkt met of zonder komma's, en accepteert dat er onderdelen ontbreken.
 * Wat niet met redelijke zekerheid te bepalen is, blijft `null`.
 */
export function parseBelgianAddress(input: string | null | undefined): ParsedAddress {
  if (!input) return EMPTY

  const address = cleanupWhitespace(input.replace(/[;|]/g, ','))
  if (address.length === 0) return EMPTY

  const postalCode = parseBelgianPostalCode(address)

  // Alles knippen op komma's; het deel met de postcode scheidt straat van plaats.
  const parts = address
    .split(',')
    .map((part) => cleanupWhitespace(part))
    .filter((part) => part.length > 0)

  let streetPart: string | null = null
  let cityPart: string | null = null

  if (postalCode) {
    const postalIndex = parts.findIndex((part) => parseBelgianPostalCode(part) === postalCode)

    if (postalIndex > 0) {
      // "Kerkstraat 12, 9000 Gent" — alles vóór het postcodedeel is de straat.
      streetPart = parts.slice(0, postalIndex).join(' ')
      cityPart = parts[postalIndex]?.replace(postalCode, '') ?? null
    } else if (postalIndex === 0 && parts.length > 1) {
      // "9000 Gent, Kerkstraat 12" — omgekeerde volgorde, komt voor bij feeds.
      cityPart = parts[0]?.replace(postalCode, '') ?? null
      streetPart = parts.slice(1).join(' ')
    } else {
      // Eén blok: "Kerkstraat 12 9000 Gent". Knip op de postcode.
      const at = address.indexOf(postalCode)
      streetPart = address.slice(0, at)
      cityPart = address.slice(at + postalCode.length)
    }
  } else {
    streetPart = parts[0] ?? null
    cityPart = parts.length > 1 ? (parts[parts.length - 1] ?? null) : null
  }

  const street = extractStreet(streetPart)
  const city = normalizeCityName(cityPart)

  return {
    address,
    streetName: street.streetName,
    houseNumber: street.houseNumber,
    postalCode,
    // Een "gemeente" die zelf een postcode blijkt te zijn is geen gemeente.
    city: city && !isBelgianPostalCode(city) ? city : null,
  }
}

function extractStreet(input: string | null): { streetName: string | null; houseNumber: string | null } {
  if (!input) return { streetName: null, houseNumber: null }

  const cleaned = cleanupWhitespace(input.replace(/^[-–—\s]+/, ''))
  if (cleaned.length === 0) return { streetName: null, houseNumber: null }

  const match = cleaned.match(HOUSE_NUMBER)
  if (match?.[1]) {
    const streetName = cleanupWhitespace(cleaned.slice(0, match.index ?? 0))
    // Een nummer zonder straat ervoor is geen adres maar een los getal — dat kan
    // net zo goed een oppervlakte of een bouwjaar zijn dat hier terechtkwam.
    if (streetName.length >= 2) {
      const suffix = match[2] ? match[2].toUpperCase() : ''
      return { streetName, houseNumber: `${match[1]}${suffix}` }
    }
  }

  return { streetName: cleaned.length >= 2 ? cleaned : null, houseNumber: null }
}

function normalizeCityName(input: string | null): string | null {
  if (!input) return null
  const cleaned = cleanupWhitespace(input.replace(/^[-–—,\s]+|[-–—,\s]+$/g, ''))
  if (cleaned.length < 2) return null
  // "België" / "Belgique" als laatste deel is geen gemeente.
  if (/^(belgi[eë]|belgique|belgium)$/i.test(cleaned)) return null
  return cleaned
}

/** Bevat deze tekst iets dat op een straatnaam lijkt? */
export function looksLikeStreet(input: string | null | undefined): boolean {
  const normalized = normalizeText(input)
  if (normalized.length === 0) return false
  return STREET_MARKERS.some((marker) => normalized.includes(marker))
}

/**
 * De sleutel waarmee de matcher kandidaat-panden ophaalt.
 *
 * Bewust alléén postcode + straat + huisnummer: dat is het deel van een adres
 * dat identiek hoort te zijn bij twee advertenties voor hetzelfde pand. Prijs,
 * titel en oppervlakte horen hier niet in — die veranderen juist tussen twee
 * advertenties door, en dan zou de sleutel niets meer terugvinden.
 *
 * Geeft `null` zonder huisnummer: een sleutel op alleen "9000 kerkstraat" zou
 * elk huis in die straat als kandidaat opleveren, en dat is geen selectie maar
 * een tafelscan met extra stappen.
 */
export function buildMatchKey(
  postalCode: string | null | undefined,
  streetName: string | null | undefined,
  houseNumber: string | null | undefined,
): string | null {
  if (!postalCode || !streetName || !houseNumber) return null

  const street = normalizeText(streetName).replace(/\s+/g, '')
  if (street.length === 0) return null

  return `${postalCode}:${street}:${normalizeText(houseNumber).replace(/\s+/g, '')}`
}
