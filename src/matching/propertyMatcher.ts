import type { NormalizedListing, PropertyMatch, PropertyTypeValue } from '@/domain/types'
import { descriptionSimilarity, normalizeText, normalizedSimilarity } from '@/lib/text'

/**
 * Koppelt een advertentie aan het fysieke pand waar hij over gaat.
 *
 * ─── WAAROM DIT DE MOEILIJKSTE BESLISSING IN HET SYSTEEM IS ──────────────────
 *
 * Alles wat ImmoRadar onderscheidt hangt hieraan. De relist-detectie werkt
 * alleen als een nieuwe advertentie — nieuw bron-id, nieuwe URL, nieuwe prijs,
 * herschreven tekst, ander kantoor — herkend wordt als hetzelfde huis van vorig
 * jaar. De timeline van een pand is alleen waar als er niet twee huizen in
 * terechtgekomen zijn.
 *
 * En de twee fouten zijn niet symmetrisch:
 *
 *   Te weinig koppelen  → een pand krijgt twee rijen. Je mist een relist. Vervelend,
 *                         maar zichtbaar en later te herstellen.
 *   Te veel koppelen    → twee huizen delen één geschiedenis. Prijsdalingen van
 *                         het ene huis verschijnen op het andere, en de makelaar
 *                         belt een verkoper over een prijsverlaging die nooit
 *                         plaatsvond. Dat is niet te herstellen, want de
 *                         oorspronkelijke scheiding is weg.
 *
 * Vandaar de opzet hieronder: harde uitsluitingen eerst, dan pas bewijskracht,
 * en bij twijfel geen koppeling. De opdracht zegt het ook: geen agressieve
 * automatische merges bij lage confidence.
 */

/** Wat de matcher van een kandidaat-pand moet weten. */
export interface PropertyCandidate {
  id: string
  matchKey: string | null
  streetName: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  propertyType: PropertyTypeValue
  bedrooms: number | null
  surfaceArea: number | null
  /**
   * Advertenties die we eerder voor dit pand zagen. De matcher vergelijkt tegen
   * de béste ervan — een pand dat drie keer geadverteerd is heeft drie kansen
   * om herkend te worden, en bij een herplaatsing lijkt de nieuwe tekst meestal
   * het meest op de meest recente.
   */
  listings: PropertyCandidateListing[]
}

/**
 * Wat we van een eerdere advertentie voor dit pand meenemen.
 *
 * Bewust alleen de velden die tússen twee advertenties kunnen verschillen en
 * daarmee iets zeggen over identiteit: tekst, prijs en telefoonnummer.
 * Oppervlakte en slaapkamers zitten op het pand zelf en worden daar vergeleken —
 * ze hier nog eens per advertentie meenemen zou hetzelfde signaal dubbel tellen.
 */
export interface PropertyCandidateListing {
  title: string | null
  description: string | null
  price: number | null
  sellerPhoneE164: string | null
}

export interface MatcherOptions {
  /** Vanaf hier koppelen we automatisch. */
  matchThreshold: number
  /** Daaronder maar hierboven: kandidaat, maar geen automatische koppeling. */
  reviewThreshold: number
}

interface Signal {
  code: string
  weight: number
  /** 0–1. Hoe sterk dit signaal vóór een match pleit. */
  score: number
  label: string
}

/**
 * Twee panden met een verschillend huisnummer in dezelfde straat zijn twee
 * panden. Punt. Alle andere gelijkenis — zelfde straat, zelfde oppervlakte,
 * bijna dezelfde tekst — mag daar niet overheen.
 */
const CONFLICTING_ADDRESS_CEILING = 0.3

/** Verschillende postcode betekent een andere gemeente. Dat is geen twijfelgeval. */
const CONFLICTING_POSTAL_CEILING = 0.1

/** Een exact adres is zo sterk dat de rest er alleen nog bij kan optellen. */
const EXACT_ADDRESS_FLOOR = 0.95

/** Hetzelfde telefoonnummer op hetzelfde adresniveau: vrijwel zeker dezelfde verkoop. */
const PHONE_AND_LOCALITY_FLOOR = 0.82

function equalIgnoringCase(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return normalizeText(a) === normalizeText(b)
}

/** Relatief verschil tussen twee getallen, als 0–1 waarbij 1 identiek is. */
function closeness(a: number | null, b: number | null, tolerance: number): number | null {
  if (a === null || b === null || a <= 0 || b <= 0) return null
  const difference = Math.abs(a - b) / Math.max(a, b)
  if (difference > tolerance) return 0
  return 1 - difference / tolerance
}

/**
 * Vergelijkt één advertentie met één kandidaat-pand.
 *
 * Alleen signalen waarvoor *beide* kanten data hebben tellen mee. Dat is de kern
 * van de opzet: een bron die geen oppervlakte publiceert hoort daar niet voor
 * gestraft te worden, want dan zou een advertentie met weinig velden nooit
 * gekoppeld kunnen worden, ook niet bij een perfect adres.
 */
function scoreCandidate(
  listing: NormalizedListing,
  candidate: PropertyCandidate,
): { confidence: number; signals: Signal[]; blocked: boolean } {
  const signals: Signal[] = []

  const bothHavePostal = Boolean(listing.postalCode && candidate.postalCode)
  const postalMatches = bothHavePostal && listing.postalCode === candidate.postalCode

  const bothHaveNumber = Boolean(listing.houseNumber && candidate.houseNumber)
  const bothHaveStreet = Boolean(listing.streetName && candidate.streetName)
  const streetMatches =
    bothHaveStreet && normalizedSimilarity(listing.streetName, candidate.streetName) >= 0.85
  const numberMatches =
    bothHaveNumber && equalIgnoringCase(listing.houseNumber, candidate.houseNumber)

  // ── Harde uitsluitingen ───────────────────────────────────────────────────

  if (bothHavePostal && !postalMatches) {
    return {
      confidence: CONFLICTING_POSTAL_CEILING,
      signals: [
        {
          code: 'postal_conflict',
          weight: 1,
          score: 0,
          label: `Andere postcode (${listing.postalCode} vs ${candidate.postalCode})`,
        },
      ],
      blocked: true,
    }
  }

  // Zelfde straat, ander huisnummer: buren, geen hetzelfde pand.
  if (streetMatches && bothHaveNumber && !numberMatches) {
    return {
      confidence: CONFLICTING_ADDRESS_CEILING,
      signals: [
        {
          code: 'house_number_conflict',
          weight: 1,
          score: 0,
          label: `Ander huisnummer in dezelfde straat (${listing.houseNumber} vs ${candidate.houseNumber})`,
        },
      ],
      blocked: true,
    }
  }

  // ── Bewijskracht ──────────────────────────────────────────────────────────

  const exactKey =
    Boolean(listing.matchKey) && listing.matchKey === candidate.matchKey

  if (exactKey) {
    signals.push({
      code: 'exact_address',
      weight: 6,
      score: 1,
      label: `Exact adres (${listing.address ?? listing.matchKey})`,
    })
  } else {
    if (bothHaveStreet) {
      const similarity = normalizedSimilarity(listing.streetName, candidate.streetName)
      signals.push({
        code: 'street_name',
        weight: 2.5,
        score: similarity,
        label:
          similarity >= 0.85
            ? `Zelfde straat (${candidate.streetName})`
            : `Straatnaam lijkt op elkaar (${listing.streetName} / ${candidate.streetName})`,
      })
    }

    if (numberMatches) {
      signals.push({
        code: 'house_number',
        weight: 2,
        score: 1,
        label: `Zelfde huisnummer (${listing.houseNumber})`,
      })
    }
  }

  if (bothHavePostal) {
    signals.push({
      code: 'postal_code',
      weight: 1.5,
      score: postalMatches ? 1 : 0,
      label: `Zelfde postcode (${listing.postalCode})`,
    })
  }

  if (listing.city && candidate.city) {
    signals.push({
      code: 'city',
      weight: 0.5,
      score: equalIgnoringCase(listing.city, candidate.city) ? 1 : 0,
      label: `Zelfde gemeente (${candidate.city})`,
    })
  }

  signals.push({
    code: 'property_type',
    weight: 0.7,
    score: listing.propertyType === candidate.propertyType ? 1 : 0,
    label: `Zelfde woningtype (${candidate.propertyType})`,
  })

  const surfaceScore = closeness(listing.surfaceArea, candidate.surfaceArea, 0.08)
  if (surfaceScore !== null) {
    signals.push({
      code: 'surface_area',
      weight: 1.5,
      score: surfaceScore,
      label: `Vergelijkbare oppervlakte (${listing.surfaceArea} m² / ${candidate.surfaceArea} m²)`,
    })
  }

  if (listing.bedrooms !== null && candidate.bedrooms !== null) {
    signals.push({
      code: 'bedrooms',
      weight: 0.8,
      score: listing.bedrooms === candidate.bedrooms ? 1 : 0,
      label: `Zelfde aantal slaapkamers (${candidate.bedrooms})`,
    })
  }

  // ── Vergelijking met de eerdere advertenties van dit pand ─────────────────

  let bestPhoneMatch = false
  let bestTitleScore = 0
  let bestDescriptionScore = 0
  let bestPriceScore: number | null = null

  for (const previous of candidate.listings) {
    if (
      listing.sellerPhoneE164 &&
      previous.sellerPhoneE164 &&
      listing.sellerPhoneE164 === previous.sellerPhoneE164
    ) {
      bestPhoneMatch = true
    }

    bestTitleScore = Math.max(bestTitleScore, normalizedSimilarity(listing.title, previous.title))
    bestDescriptionScore = Math.max(
      bestDescriptionScore,
      descriptionSimilarity(listing.description, previous.description),
    )

    // Ruime tolerantie: tussen twee advertenties van hetzelfde pand zit vaak
    // juist een prijsverlaging. Prijs is hier een zwak bevestigend signaal, geen
    // identiteitsbewijs.
    const priceScore = closeness(listing.price, previous.price, 0.25)
    if (priceScore !== null) bestPriceScore = Math.max(bestPriceScore ?? 0, priceScore)
  }

  if (bestPhoneMatch) {
    signals.push({
      code: 'seller_phone',
      weight: 3,
      score: 1,
      label: 'Zelfde telefoonnummer als een eerdere advertentie',
    })
  }

  if (candidate.listings.length > 0) {
    if (listing.title) {
      signals.push({
        code: 'title_similarity',
        weight: 1.2,
        score: bestTitleScore,
        label: `Titel lijkt op een eerdere advertentie (${Math.round(bestTitleScore * 100)}%)`,
      })
    }
    if (listing.description) {
      signals.push({
        code: 'description_similarity',
        weight: 1.8,
        score: bestDescriptionScore,
        label: `Beschrijving lijkt op een eerdere advertentie (${Math.round(bestDescriptionScore * 100)}%)`,
      })
    }
    if (bestPriceScore !== null) {
      signals.push({
        code: 'price_similarity',
        weight: 0.6,
        score: bestPriceScore,
        label: 'Vergelijkbare vraagprijs',
      })
    }
  }

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  if (totalWeight === 0) return { confidence: 0, signals: [], blocked: false }

  const achieved = signals.reduce((sum, signal) => sum + signal.weight * signal.score, 0)
  let confidence = achieved / totalWeight

  // Vloeren: twee situaties waarin we zeker genoeg zijn, ongeacht wat de rest
  // van de velden zegt.
  if (exactKey) {
    confidence = Math.max(confidence, EXACT_ADDRESS_FLOOR)
  } else if (bestPhoneMatch && (postalMatches || equalIgnoringCase(listing.city, candidate.city))) {
    confidence = Math.max(confidence, PHONE_AND_LOCALITY_FLOOR)
  }

  return { confidence: Math.min(1, confidence), signals, blocked: false }
}

/**
 * Kiest het beste pand voor deze advertentie.
 *
 * Geeft een `propertyId` alleen wanneer de zekerheid boven `matchThreshold`
 * ligt. Daaronder komt de confidence en de uitleg wél terug, maar zonder id —
 * de aanroeper maakt dan een nieuw pand aan en heeft in de reasons staan waarom
 * er getwijfeld werd.
 */
export function matchProperty(
  listing: NormalizedListing,
  candidates: readonly PropertyCandidate[],
  options: MatcherOptions,
): PropertyMatch {
  if (candidates.length === 0) {
    return { confidence: 0, reasons: ['Geen bestaand pand in de buurt gevonden'] }
  }

  let best: { candidate: PropertyCandidate; confidence: number; signals: Signal[] } | null = null

  for (const candidate of candidates) {
    const { confidence, signals } = scoreCandidate(listing, candidate)
    if (best === null || confidence > best.confidence) {
      best = { candidate, confidence, signals }
    }
  }

  if (best === null) {
    return { confidence: 0, reasons: ['Geen bestaand pand in de buurt gevonden'] }
  }

  const reasons = describeSignals(best.signals)

  if (best.confidence >= options.matchThreshold) {
    return { propertyId: best.candidate.id, confidence: best.confidence, reasons }
  }

  if (best.confidence >= options.reviewThreshold) {
    return {
      confidence: best.confidence,
      reasons: [
        `Beste kandidaat haalde ${Math.round(best.confidence * 100)}% — onder de koppeldrempel van ${Math.round(options.matchThreshold * 100)}%`,
        ...reasons,
      ],
    }
  }

  return {
    confidence: best.confidence,
    reasons: ['Geen kandidaat kwam in de buurt van een match'],
  }
}

/** Signalen naar leesregels: alleen wat daadwerkelijk pleitte, zwaarste eerst. */
function describeSignals(signals: Signal[]): string[] {
  return signals
    .filter((signal) => signal.score > 0.25 || signal.weight >= 1)
    .sort((a, b) => b.weight * b.score - a.weight * a.score)
    .slice(0, 6)
    .map((signal) => signal.label)
}
