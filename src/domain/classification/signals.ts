import { normalizeText } from '@/lib/text'

/**
 * De losse aanwijzingen waaruit de verkoperclassificatie is opgebouwd.
 *
 * Elk signaal staat hier apart, met zijn eigen gewicht en zijn eigen
 * uitlegregel. Dat is de kern van de opzet: de classificatie moet in het
 * dashboard te verantwoorden zijn ("particulier, 96% — 'zonder makelaar' in de
 * tekst, mobiel nummer, één actieve advertentie"). Eén ondoorzichtige functie
 * die een getal teruggeeft zou hetzelfde antwoord geven en niets uitleggen, en
 * dan kan een makelaar niet beoordelen of hij de lead vertrouwt.
 *
 * De gewichten zijn log-odds. Positief duwt richting professioneel, negatief
 * richting particulier; de classifier telt ze op en haalt er via een logistische
 * functie een kans uit. Dat is beter dan losse percentages optellen, omdat twee
 * zwakke aanwijzingen dan niet per ongeluk samen "zekerheid" worden.
 */

export type SignalDirection = 'professional' | 'private'

export interface Signal {
  code: string
  direction: SignalDirection
  /** Log-odds bijdrage. Altijd positief opgeschreven; de richting bepaalt het teken. */
  weight: number
  label: string
}

export interface SignalInput {
  sellerName: string | null
  sellerPhoneE164: string | null
  sellerPhoneIsMobile: boolean
  title: string | null
  description: string | null
  sourceHint: 'private' | 'professional' | 'unknown'
  /** Hoeveel advertenties we van deze verkoper tegelijk actief zien. */
  activeListingCount: number
  professionalListingThreshold: number
}

/**
 * Het IPI/BIV-nummer is het inschrijvingsnummer van een erkend Belgisch
 * vastgoedmakelaar. Wie het vermeldt ís er een — dit is het enige signaal dat
 * op zichzelf beslissend is.
 */
const IPI_PATTERN = /\b(?:ipi|biv)\s*(?:nr\.?|n°|number|nummer)?\s*:?\s*\d{3}[.\s]?\d{3}\b/i

/** Rechtsvormen. Een verkoper met een rechtsvorm in zijn naam is een onderneming. */
const LEGAL_FORM_PATTERN = /\b(bvba|bv|nv|sa|sprl|srl|cvba|comm\.?\s?va|vzw|asbl|scrl)\b/i

/** Woorden die een vastgoedonderneming aanduiden, NL/FR/EN. */
const AGENCY_NAME_WORDS = [
  'immo', 'immobilier', 'immobiliere', 'vastgoed', 'makelaar', 'makelaardij', 'kantoor',
  'real estate', 'realestate', 'properties', 'property', 'estate', 'agence', 'agency',
  'residence', 'invest', 'group', 'partners', 'notaris', 'notaire', 'syndic',
]

/** Formuleringen waarmee een kantoor over zichzelf praat. */
const AGENCY_PHRASES = [
  'ons kantoor', 'onze kantoren', 'ons team', 'onze makelaar', 'uw makelaar',
  'bezoek onze website', 'maak een afspraak met ons', 'onze expert',
  'notre bureau', 'notre agence', 'notre equipe', 'votre agent',
  'plan een bezichtiging via', 'contacteer ons kantoor',
]

/**
 * De expliciete "geen makelaar"-formuleringen. Dit is het sterkste
 * particulier-signaal dat bestaat: een verkoper schrijft dit alleen als hij het
 * zelf doet, en meestal omdat hij al gebeld is door kantoren.
 */
const NO_AGENT_PHRASES = [
  'zonder makelaar', 'geen makelaars', 'geen makelaar', 'geen immokantoren',
  'geen immo kantoren', 'niet voor makelaars', 'makelaars onthouden zich',
  'sans agence', 'sans agent', 'pas d agences', 'pas d agence', 'agences s abstenir',
  'de particulier a particulier', 'particulier a particulier',
  'no agents', 'no agencies', 'direct van eigenaar', 'rechtstreeks van de eigenaar',
]

/** Woorden waarmee iemand zichzelf als particuliere verkoper aanduidt. */
const PRIVATE_WORDS = [
  'particulier', 'particuliere verkoop', 'eigenaar verkoopt', 'door eigenaar',
  'proprietaire', 'vente par le proprietaire', 'privaat', 'prive verkoop',
]

/**
 * Herkent een persoonsnaam: twee tot drie woorden, elk met een hoofdletter, geen
 * ondernemingswoorden. "Jan Peeters" wel, "Immo De Meyer" niet, "IMMOPUNT" niet.
 */
function looksLikePersonalName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 4 || trimmed.length > 40) return false
  if (LEGAL_FORM_PATTERN.test(trimmed)) return false

  const normalized = normalizeText(trimmed)
  if (AGENCY_NAME_WORDS.some((word) => normalized.includes(word))) return false

  // Volledig in hoofdletters is een merknaam, geen manier waarop mensen hun
  // eigen naam schrijven.
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{4,}/.test(trimmed)) return false

  const words = trimmed.split(/\s+/)
  if (words.length < 2 || words.length > 3) return false

  // Elk woord begint met een hoofdletter, of is een Belgisch tussenvoegsel.
  const TUSSENVOEGSELS = new Set(['de', 'van', 'der', 'den', 'het', 'du', 'le', 'la'])
  return words.every((word) => {
    const lower = word.toLowerCase()
    if (TUSSENVOEGSELS.has(lower)) return true
    return /^[A-ZÀ-Þ][a-zà-ÿ'’-]+$/.test(word)
  })
}

function containsAny(haystack: string, needles: readonly string[]): string | null {
  return needles.find((needle) => haystack.includes(needle)) ?? null
}

/**
 * Verzamelt alle aanwijzingen die op deze advertentie van toepassing zijn.
 *
 * Puur: geen database, geen netwerk. Alles wat nodig is staat in `input`, zodat
 * de regels los te testen zijn met een handvol fixtures.
 */
export function collectSignals(input: SignalInput): Signal[] {
  const signals: Signal[] = []

  const name = input.sellerName?.trim() ?? ''
  const text = normalizeText(`${input.title ?? ''} ${input.description ?? ''}`)
  const rawText = `${input.title ?? ''} ${input.description ?? ''}`

  // ── Professioneel ─────────────────────────────────────────────────────────

  if (IPI_PATTERN.test(rawText) || IPI_PATTERN.test(name)) {
    signals.push({
      code: 'ipi_number',
      direction: 'professional',
      weight: 4,
      label: 'IPI/BIV-nummer vermeld — erkend vastgoedmakelaar',
    })
  }

  if (name && LEGAL_FORM_PATTERN.test(name)) {
    signals.push({
      code: 'legal_form',
      direction: 'professional',
      weight: 2.5,
      label: `Rechtsvorm in verkopersnaam ("${name}")`,
    })
  }

  if (name) {
    const normalizedName = normalizeText(name)
    const hit = containsAny(normalizedName, AGENCY_NAME_WORDS)
    if (hit) {
      signals.push({
        code: 'agency_name_word',
        direction: 'professional',
        weight: 2.5,
        label: `Vastgoedterm in verkopersnaam ("${hit}")`,
      })
    }
  }

  const agencyPhrase = containsAny(text, AGENCY_PHRASES)
  if (agencyPhrase) {
    signals.push({
      code: 'agency_phrasing',
      direction: 'professional',
      weight: 1.2,
      label: `Kantoorformulering in de tekst ("${agencyPhrase}")`,
    })
  }

  if (input.activeListingCount >= input.professionalListingThreshold) {
    signals.push({
      code: 'many_listings',
      direction: 'professional',
      weight: 3,
      label: `${input.activeListingCount} gelijktijdige advertenties van deze verkoper`,
    })
  } else if (input.activeListingCount >= 2) {
    signals.push({
      code: 'several_listings',
      direction: 'professional',
      weight: 0.8,
      label: `${input.activeListingCount} gelijktijdige advertenties van deze verkoper`,
    })
  }

  if (input.sourceHint === 'professional') {
    signals.push({
      code: 'source_hint_professional',
      direction: 'professional',
      weight: 1.5,
      label: 'De bron labelt deze verkoper als professioneel',
    })
  }

  if (input.sellerPhoneE164 && !input.sellerPhoneIsMobile) {
    signals.push({
      code: 'landline',
      direction: 'professional',
      weight: 0.4,
      label: 'Vast telefoonnummer',
    })
  }

  // ── Particulier ───────────────────────────────────────────────────────────

  const noAgentPhrase = containsAny(text, NO_AGENT_PHRASES)
  if (noAgentPhrase) {
    signals.push({
      code: 'no_agent_phrase',
      direction: 'private',
      weight: 3.5,
      label: `Expliciet "${noAgentPhrase}" in de advertentie`,
    })
  }

  const privateWord = containsAny(text, PRIVATE_WORDS)
  if (privateWord) {
    signals.push({
      code: 'private_word',
      direction: 'private',
      weight: 2,
      label: `Verkoper noemt zich particulier ("${privateWord}")`,
    })
  }

  if (name && looksLikePersonalName(name)) {
    signals.push({
      code: 'personal_name',
      direction: 'private',
      weight: 1.2,
      label: `Verkopersnaam is een persoonsnaam ("${name}")`,
    })
  }

  if (input.sellerPhoneIsMobile) {
    signals.push({
      code: 'mobile_phone',
      direction: 'private',
      weight: 0.6,
      label: 'Mobiel telefoonnummer',
    })
  }

  // Precies één, niet "hoogstens één".
  //
  // ─── WAAROM DAT VERSCHIL ERTOE DOET ────────────────────────────────────────
  //
  // Nul actieve advertenties betekent niet "deze verkoper heeft er maar één" —
  // het betekent dat we deze verkoper nog nooit gezien hebben. Dat is afwezige
  // informatie, geen aanwijzing.
  //
  // Met `<= 1` was dit het enige signaal dat een volstrekt lege advertentie nog
  // opleverde, en dan komt er "particulier, 62%" uit een rij zonder naam, zonder
  // telefoon en zonder tekst. Dat is precies de uitkomst die de classificatie
  // hoort te vermijden: liever `unknown` dan een verkopertype dat we verzonnen
  // hebben. UNKNOWN is een volwaardige uitkomst; een verzonnen particulier niet.
  if (input.activeListingCount === 1) {
    signals.push({
      code: 'single_listing',
      direction: 'private',
      weight: 0.5,
      label: 'Eén actieve advertentie van deze verkoper',
    })
  }

  if (input.sourceHint === 'private') {
    signals.push({
      code: 'source_hint_private',
      direction: 'private',
      weight: 1.5,
      label: 'De bron labelt deze verkoper als particulier',
    })
  }

  return signals
}

/** Alleen voor tests en het dashboard: de naamherkenning los beschikbaar. */
export { looksLikePersonalName }
