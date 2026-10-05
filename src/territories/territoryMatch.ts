import { normalizeText } from '@/lib/text'

/**
 * Welk kantoor mag deze kans zien?
 *
 * ─── WAAROM DIT EEN EIGEN LAAG IS ────────────────────────────────────────────
 *
 * Belgische makelaars werken geografisch: een kantoor in Gent wil 9000, 9030,
 * 9040 en 9050, en niets uit Luik. De koppeling gebied → kantoor is daarmee de
 * plek waar de multi-tenancy inhoudelijk begint. Zit hier een fout, dan krijgt
 * kantoor A de leads van kantoor B — en dat is niet alleen een bug, dat is het
 * einde van het vertrouwen in de dienst.
 *
 * ─── PRECISIE TELT MEE ───────────────────────────────────────────────────────
 *
 * Een postcodetreffer is sterker dan een provincietreffer. Dat verschil gaat
 * mee naar de scoring: "exacte match met jouw postcodegebied" is 10 punten,
 * "ligt in jouw provincie" 4. Zonder dat onderscheid zou een kantoor met de
 * provincie Antwerpen als gebied dezelfde scores krijgen als het kantoor dat
 * precies die ene straat bedient.
 */

export type TerritoryKindValue = 'POSTAL_CODE' | 'MUNICIPALITY' | 'PROVINCE'
export type TerritoryPrecision = 'postal_code' | 'municipality' | 'province'

export interface TerritoryDefinition {
  id: string
  agencyId: string
  name: string
  kind: TerritoryKindValue
  postalCodes: readonly string[]
  municipalities: readonly string[]
  provinces: readonly string[]
  active: boolean
}

export interface LocationForMatch {
  postalCode: string | null
  city: string | null
  province: string | null
}

export interface TerritoryMatchResult {
  agencyId: string
  territoryId: string
  territoryName: string
  precision: TerritoryPrecision
}

/** Hoe sterk een treffer is; hoger wint bij meerdere gebieden van één kantoor. */
const PRECISION_RANK: Record<TerritoryPrecision, number> = {
  postal_code: 3,
  municipality: 2,
  province: 1,
}

/**
 * Matcht één gebied tegen één locatie.
 *
 * Gemeentenamen worden aan beide kanten genormaliseerd: een kantoor dat
 * "Sint-Pieters-Woluwe" invoert moet ook advertenties vangen die "sint pieters
 * woluwe" schrijven, anders werkt het gebied in de praktijk niet.
 */
function matchOne(
  territory: TerritoryDefinition,
  location: LocationForMatch,
): TerritoryPrecision | null {
  if (!territory.active) return null

  switch (territory.kind) {
    case 'POSTAL_CODE':
      if (!location.postalCode) return null
      return territory.postalCodes.includes(location.postalCode) ? 'postal_code' : null

    case 'MUNICIPALITY': {
      if (!location.city) return null
      const city = normalizeText(location.city)
      if (city.length === 0) return null
      return territory.municipalities.some((entry) => normalizeText(entry) === city)
        ? 'municipality'
        : null
    }

    case 'PROVINCE': {
      if (!location.province) return null
      const province = normalizeText(location.province)
      if (province.length === 0) return null
      return territory.provinces.some((entry) => normalizeText(entry) === province)
        ? 'province'
        : null
    }
  }
}

/** Alle treffers, ongefilterd. Handig voor het dashboard ("welke gebieden raken dit?"). */
export function matchTerritories(
  location: LocationForMatch,
  territories: readonly TerritoryDefinition[],
): TerritoryMatchResult[] {
  const results: TerritoryMatchResult[] = []

  for (const territory of territories) {
    const precision = matchOne(territory, location)
    if (precision === null) continue

    results.push({
      agencyId: territory.agencyId,
      territoryId: territory.id,
      territoryName: territory.name,
      precision,
    })
  }

  return results
}

/**
 * Eén treffer per kantoor: de meest precieze.
 *
 * Dit is wat de pijplijn gebruikt. Een kantoor dat zowel "provincie
 * Oost-Vlaanderen" als "postcode 9000" heeft ingesteld hoort één opportunity te
 * krijgen — met de sterkste onderbouwing, niet twee keer dezelfde woning.
 */
export function bestTerritoryPerAgency(
  location: LocationForMatch,
  territories: readonly TerritoryDefinition[],
): TerritoryMatchResult[] {
  const best = new Map<string, TerritoryMatchResult>()

  for (const match of matchTerritories(location, territories)) {
    const current = best.get(match.agencyId)
    if (!current || PRECISION_RANK[match.precision] > PRECISION_RANK[current.precision]) {
      best.set(match.agencyId, match)
    }
  }

  return [...best.values()]
}

/**
 * Zet de vrije invoer uit het territoryformulier om naar de juiste kolom.
 *
 * Postcodes worden gecontroleerd op vorm; gemeenten en provincies worden
 * genormaliseerd opgeslagen zodat de vergelijking hierboven werkt zonder bij
 * elke query opnieuw te normaliseren.
 */
export function splitTerritoryValues(
  kind: TerritoryKindValue,
  values: readonly string[],
): { postalCodes: string[]; municipalities: string[]; provinces: string[]; rejected: string[] } {
  const postalCodes: string[] = []
  const municipalities: string[] = []
  const provinces: string[] = []
  const rejected: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0) continue

    switch (kind) {
      case 'POSTAL_CODE':
        if (/^[1-9]\d{3}$/.test(trimmed)) postalCodes.push(trimmed)
        else rejected.push(trimmed)
        break
      case 'MUNICIPALITY':
        municipalities.push(normalizeText(trimmed))
        break
      case 'PROVINCE':
        provinces.push(normalizeText(trimmed))
        break
    }
  }

  return {
    postalCodes: [...new Set(postalCodes)],
    municipalities: [...new Set(municipalities)].filter((entry) => entry.length > 0),
    provinces: [...new Set(provinces)].filter((entry) => entry.length > 0),
    rejected,
  }
}
