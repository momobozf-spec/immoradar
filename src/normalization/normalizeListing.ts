import { buildMatchKey, parseBelgianAddress } from '@/domain/geo/address'
import {
  cityForPostalCode,
  isProvince,
  parseBelgianPostalCode,
  provinceForPostalCode,
} from '@/domain/geo/provinces'
import { rawListingSchema } from '@/domain/schemas'
import type { NormalizedListing, PropertyTypeValue, RawListing } from '@/domain/types'
import { stableHash } from '@/lib/hash'
import { extractBelgianPhones, normalizeBelgianPhone } from '@/lib/phone'
import { normalizeText } from '@/lib/text'

/**
 * Van "wat de bron zegt" naar "wat wij weten".
 *
 * ─── DE TAAK ─────────────────────────────────────────────────────────────────
 *
 * Elke bron schrijft hetzelfde feit anders op: "Huis", "maison", "Woning",
 * "SingleFamilyResidence". "€ 495.000", "495000.00", "495 000 EUR". "B-9000",
 * "9000 Gent", "Gent". Zonder één plek die dat gelijktrekt, vergelijkt de
 * matcher appels met peren en telt de Market Radar hetzelfde woningtype vier
 * keer apart.
 *
 * ─── WAT HIER NIET GEBEURT ───────────────────────────────────────────────────
 *
 * Geen classificatie (dat is een aparte beslissing met eigen uitleg), geen
 * matching, geen database. Deze module is puur: dezelfde invoer geeft altijd
 * dezelfde uitvoer, en dat is precies wat je wilt van de laag waar de
 * `contentHash` gemaakt wordt — die bepaalt of we een wijziging zien of niet.
 */

/**
 * Woningtypen in NL, FR en EN naar één interne waarde.
 *
 * De volgorde telt: er wordt op deelstring gematcht, en "appartementsgebouw"
 * bevat "appartement". Specifieke termen staan daarom vóór algemene.
 */
const PROPERTY_TYPE_PATTERNS: readonly (readonly [PropertyTypeValue, readonly string[]])[] = [
  ['land', ['bouwgrond', 'bouwland', 'grond', 'terrain', 'terrein', 'perceel', 'land', 'plot']],
  [
    'garage',
    ['garage', 'staanplaats', 'parking', 'parkeerplaats', 'carport', 'emplacement'],
  ],
  [
    'commercial',
    [
      'handelspand', 'handelsruimte', 'winkelpand', 'winkel', 'kantoorruimte', 'kantoor',
      'bedrijfspand', 'bedrijfsgebouw', 'magazijn', 'loods', 'horeca',
      'commerce', 'bureau', 'entrepot', 'immeuble de rapport', 'commercial', 'office', 'retail',
    ],
  ],
  [
    'apartment',
    [
      'appartement', 'flat', 'studio', 'duplex', 'triplex', 'penthouse', 'loft',
      'gelijkvloers', 'assistentiewoning', 'apartment', 'condo',
    ],
  ],
  [
    'house',
    [
      'huis', 'woning', 'villa', 'bungalow', 'hoeve', 'fermette', 'chalet', 'rijwoning',
      'burgerwoning', 'herenhuis', 'landhuis', 'maison', 'residence', 'house', 'home',
      'singlefamilyresidence', 'townhouse',
    ],
  ],
]

export function normalizePropertyType(input: string | null | undefined): PropertyTypeValue {
  const normalized = normalizeText(input)
  if (normalized.length === 0) return 'other'

  for (const [type, needles] of PROPERTY_TYPE_PATTERNS) {
    if (needles.some((needle) => normalized.includes(needle))) return type
  }

  return 'other'
}

/**
 * Haalt een telefoonnummer uit het aparte veld, en anders uit de tekst.
 *
 * Veel particuliere advertenties zetten hun nummer alleen in de beschrijving —
 * juist de advertenties waar het ons om te doen is. Het niet uit de tekst halen
 * zou betekenen dat de makelaar de opportunity krijgt maar niet kan bellen.
 */
function resolvePhone(raw: RawListing): { e164: string | null; isMobile: boolean } {
  const direct = normalizeBelgianPhone(raw.sellerPhone)
  if (direct) return { e164: direct.e164, isMobile: direct.isMobile }

  const fromText = extractBelgianPhones(`${raw.title ?? ''} ${raw.description ?? ''}`)
  // Een mobiel nummer is het waarschijnlijkste contactnummer van een
  // particulier; staat er zowel een vast als een mobiel nummer, neem het mobiele.
  const preferred = fromText.find((phone) => phone.isMobile) ?? fromText[0]

  return preferred
    ? { e164: preferred.e164, isMobile: preferred.isMobile }
    : { e164: null, isMobile: false }
}

/** Whitespace opschonen en lege strings naar null. */
function clean(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normaliseert één advertentie.
 *
 * Gooit wanneer de invoer de basisvalidatie niet haalt — dat is een afgekeurd
 * item in de collectorrun, geen reden om de hele run te laten falen. De
 * aanroeper vangt het per item op.
 */
export function normalizeListing(input: RawListing): NormalizedListing {
  const raw = rawListingSchema.parse(input)

  const parsedAddress = parseBelgianAddress(raw.address)

  // Postcode: uit het eigen veld, anders uit het adres, anders uit de titel.
  // Die laatste stap is geen wanhoop maar de praktijk — veel titels luiden
  // "Woning te koop in 9000 Gent".
  const postalCode =
    parseBelgianPostalCode(raw.postalCode) ??
    parsedAddress.postalCode ??
    parseBelgianPostalCode(raw.title) ??
    null

  // Gemeente: liefst wat de bron zegt, anders uit het adres, anders afgeleid uit
  // de postcode. De afgeleide waarde is de zwakste, dus die staat achteraan.
  const city = clean(raw.city) ?? parsedAddress.city ?? cityForPostalCode(postalCode)

  const declaredProvince = clean(raw.province)
  const province =
    provinceForPostalCode(postalCode) ??
    (declaredProvince && isProvince(normalizeText(declaredProvince))
      ? normalizeText(declaredProvince)
      : null)

  const phone = resolvePhone(raw)

  const propertyType = normalizePropertyType(raw.propertyType ?? raw.title)
  const listingType = raw.listingType ?? 'sale'

  const address =
    parsedAddress.address ??
    clean(raw.address) ??
    [postalCode, city].filter(Boolean).join(' ') ??
    null

  const normalized: Omit<NormalizedListing, 'contentHash' | 'matchKey'> = {
    source: raw.source,
    sourceListingId: raw.sourceListingId,
    url: raw.url,

    title: clean(raw.title),
    description: clean(raw.description),

    price: raw.price ?? null,
    currency: raw.currency?.toUpperCase() ?? 'EUR',

    listingType,
    propertyType,

    address: address && address.length > 0 ? address : null,
    streetName: parsedAddress.streetName,
    houseNumber: parsedAddress.houseNumber,
    postalCode,
    city,
    province,

    bedrooms: raw.bedrooms ?? null,
    surfaceArea: raw.surfaceArea ?? null,

    sellerName: clean(raw.sellerName),
    sellerPhoneE164: phone.e164,
    sellerPhoneIsMobile: phone.isMobile,
    sellerTypeHint: raw.sellerTypeHint ?? 'unknown',

    publishedAt: raw.publishedAt ?? null,
    scrapedAt: raw.scrapedAt,

    raw: raw.raw ?? null,
  }

  return {
    ...normalized,
    contentHash: computeContentHash(normalized),
    matchKey: buildMatchKey(postalCode, parsedAddress.streetName, parsedAddress.houseNumber),
  }
}

/**
 * De vingerafdruk die bepaalt of er iets veranderd is.
 *
 * ─── WAT ER WEL EN NIET IN ZIT ───────────────────────────────────────────────
 *
 * Erin: prijs, titel, beschrijving, status-bepalende velden, verkopersnaam en
 * -telefoon. Dat zijn de dingen waarvan een wijziging een snapshot en mogelijk
 * een event verdient.
 *
 * Eruit: `scrapedAt` en `url`. Zou `scrapedAt` meedoen, dan verschilt de hash
 * bij élke run en schrijven we elke vijf minuten een snapshot per advertentie —
 * miljoenen rijen die allemaal hetzelfde zeggen. De URL kan wijzigen door een
 * tracking-parameter zonder dat de advertentie zelf iets anders is geworden.
 */
function computeContentHash(listing: Omit<NormalizedListing, 'contentHash' | 'matchKey'>): string {
  return stableHash({
    price: listing.price,
    currency: listing.currency,
    title: listing.title,
    description: listing.description,
    listingType: listing.listingType,
    propertyType: listing.propertyType,
    address: listing.address,
    postalCode: listing.postalCode,
    city: listing.city,
    bedrooms: listing.bedrooms,
    surfaceArea: listing.surfaceArea,
    sellerName: listing.sellerName,
    sellerPhone: listing.sellerPhoneE164,
  })
}

/** Prisma-enumwaarden uit de interne kleine-letter-varianten. */
export function toPrismaPropertyType(
  value: PropertyTypeValue,
): 'HOUSE' | 'APARTMENT' | 'LAND' | 'COMMERCIAL' | 'GARAGE' | 'OTHER' {
  switch (value) {
    case 'house':
      return 'HOUSE'
    case 'apartment':
      return 'APARTMENT'
    case 'land':
      return 'LAND'
    case 'commercial':
      return 'COMMERCIAL'
    case 'garage':
      return 'GARAGE'
    case 'other':
      return 'OTHER'
  }
}

export function toPrismaListingType(value: 'sale' | 'rent'): 'SALE' | 'RENT' {
  return value === 'rent' ? 'RENT' : 'SALE'
}

export function toPrismaSellerType(
  value: 'private' | 'professional' | 'unknown',
): 'PRIVATE' | 'PROFESSIONAL' | 'UNKNOWN' {
  switch (value) {
    case 'private':
      return 'PRIVATE'
    case 'professional':
      return 'PROFESSIONAL'
    case 'unknown':
      return 'UNKNOWN'
  }
}
