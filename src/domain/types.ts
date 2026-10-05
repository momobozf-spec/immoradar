/**
 * De typen die door de hele pijplijn reizen.
 *
 * Er zijn er bewust drie, één per fase, in plaats van één groot type met overal
 * optionele velden:
 *
 *   RawListing        wat een bron zegt          — alles optioneel, niets vertrouwd
 *   NormalizedListing wat wij ervan maken        — schoongemaakt, Belgisch geduid
 *   ClassifiedListing wat we erover concluderen  — verkopertype en zekerheid erbij
 *
 * Het verschil is niet cosmetisch. Zou `NormalizedListing` hetzelfde type zijn
 * als `RawListing`, dan kan de matcher niet uitgaan van een gevalideerde
 * postcode en moet elke laag opnieuw controleren of het veld deugt.
 */

export type ListingTypeValue = 'sale' | 'rent'
export type SellerTypeValue = 'private' | 'professional' | 'unknown'
export type PropertyTypeValue =
  | 'house'
  | 'apartment'
  | 'land'
  | 'commercial'
  | 'garage'
  | 'other'

/**
 * Wat een collector teruggeeft. Alles behalve de herkomstvelden is optioneel:
 * een bron die alleen een titel en een prijs geeft is een magere bron, geen
 * fout. De normalisatie beslist later of er genoeg in zit om mee te werken.
 */
export interface RawListing {
  source: string
  sourceListingId: string
  url: string

  title?: string
  description?: string

  price?: number
  currency?: string

  listingType?: ListingTypeValue
  propertyType?: string

  address?: string
  postalCode?: string
  city?: string
  province?: string

  bedrooms?: number
  surfaceArea?: number

  sellerName?: string
  sellerPhone?: string
  /**
   * Wat de bron zélf zegt over het verkopertype. Een *hint*, geen conclusie:
   * bronnen labelen dit inconsistent, en de classificatie weegt het mee als
   * signaal in plaats van het over te nemen.
   */
  sellerTypeHint?: SellerTypeValue

  publishedAt?: Date
  scrapedAt: Date

  /** Ruwe payload, uitsluitend om parsingfouten te kunnen nakijken. */
  raw?: unknown
}

/**
 * Een advertentie nadat we hem begrepen hebben: prijs als hele euro's, postcode
 * gevalideerd, provincie afgeleid, telefoon in E.164, adres in onderdelen.
 */
export interface NormalizedListing {
  source: string
  sourceListingId: string
  url: string

  title: string | null
  description: string | null

  price: number | null
  currency: string

  listingType: ListingTypeValue
  propertyType: PropertyTypeValue

  /** Volledige adresregel zoals de bron hem gaf, opgeschoond. */
  address: string | null
  streetName: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  province: string | null

  bedrooms: number | null
  surfaceArea: number | null

  sellerName: string | null
  sellerPhoneE164: string | null
  sellerPhoneIsMobile: boolean
  sellerTypeHint: SellerTypeValue

  publishedAt: Date | null
  scrapedAt: Date

  /**
   * Hash over de inhoudelijke velden. Verschilt hij van de vorige waarneming,
   * dan is er iets veranderd en verdient het een snapshot.
   */
  contentHash: string
  /** Adressleutel voor snelle kandidaatselectie bij property matching. */
  matchKey: string | null

  raw: unknown
}

/** Uitkomst van de verkoperclassificatie. */
export interface SellerClassification {
  type: SellerTypeValue
  /** 0–1. Hoe zeker we zijn van `type`, niet hoe "goed" de lead is. */
  confidence: number
  /** Mensleesbaar, in het dashboard getoond. Zwaarste signaal eerst. */
  reasons: string[]
  /** Herkende kantoornaam, als het een professionele verkoper is. */
  agencyName: string | null
}

export interface ClassifiedListing extends NormalizedListing {
  classification: SellerClassification
}

/** Uitkomst van de property matching. */
export interface PropertyMatch {
  propertyId?: string
  /** 0–1. Boven PROPERTY_MATCH_THRESHOLD koppelen we automatisch. */
  confidence: number
  reasons: string[]
}
