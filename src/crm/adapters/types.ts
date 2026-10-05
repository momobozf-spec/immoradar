import type { RawContactInput } from '../normalizeContact'

/**
 * Het contract waaraan elke CRM-koppeling voldoet.
 *
 * ─── WAAROM DIT ZO KLEIN IS ──────────────────────────────────────────────────
 *
 * Een adapter doet één ding: contacten aanleveren in ruwe vorm. Hij
 * normaliseert niet, dedupliceert niet, praat niet met de database en beslist
 * niet of een contact dormant is. Al die stappen zijn gedeeld en moeten voor een
 * CSV precies hetzelfde werken als voor een toekomstige API-koppeling — zou de
 * adapter ze zelf doen, dan zou elke nieuwe koppeling ze opnieuw, en net iets
 * anders, implementeren. Dan hangen de dormantie-regels af van waar de data
 * vandaan kwam, en dat is precies wat je niet wilt uitleggen aan een kantoor dat
 * halverwege van CRM wisselt.
 *
 * `pushOpportunity` is optioneel en met opzet nog nergens geïmplementeerd: het
 * hoort bij de fase waarin ImmoRadar kansen terugschrijft naar het CRM van het
 * kantoor. De methode staat in het contract zodat die stap later geen
 * herschrijving van deze laag vraagt.
 *
 * Zie docs/adding-a-crm-adapter.md voor het volledige recept.
 */

export interface CrmImportContext {
  agencyId: string
  /** Wat de vorige geslaagde import van deze adapter opleverde, indien bekend. */
  lastImportAt: Date | null
}

/** Wat een adapter teruggeeft. */
export interface CrmImportResult {
  contacts: RawContactInput[]
  /** De kolomnamen zoals de bron ze gaf; leeg voor bronnen zonder kolommen. */
  header: string[]
  /** Niet-fatale problemen. Komen in de importgeschiedenis terecht. */
  warnings: string[]
}

/** Wat een adapter over een kans moet weten om hem terug te schrijven. */
export interface PushableOpportunity {
  id: string
  type: string
  score: number
  address: string | null
  price: number | null
  url: string | null
  crmExternalContactId: string | null
  reasons: string[]
}

export interface CrmAdapter {
  /** Stabiele sleutel; wordt opgeslagen op `CrmImport.adapter`. */
  readonly key: string
  readonly name: string

  importContacts(context: CrmImportContext): Promise<CrmImportResult>

  /**
   * Schrijft een kans terug naar het bron-CRM. Optioneel: geen enkele
   * MVP-koppeling ondersteunt het, en een adapter die het niet kan hoort dat
   * niet te doen alsof.
   */
  pushOpportunity?(opportunity: PushableOpportunity): Promise<void>
}
