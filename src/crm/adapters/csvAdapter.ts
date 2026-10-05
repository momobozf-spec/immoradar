import type { CrmImportField } from '@/domain/schemas'

import { applyMapping, parseCsv, suggestMapping } from '../csv'
import type { RawContactInput } from '../normalizeContact'

import type { CrmAdapter, CrmImportContext, CrmImportResult } from './types'

/**
 * De CSV-adapter: de enige koppeling die de MVP heeft, en bewust de enige.
 *
 * ─── WAAROM CSV EERST EN NIET WHISE ──────────────────────────────────────────
 *
 * Elk Belgisch makelaarskantoor kan binnen twee minuten een CSV exporteren, uit
 * welk systeem dan ook. Een API-koppeling vraagt toegang, documentatie, een
 * contract en een testomgeving per aanbieder — en levert precies dezelfde
 * contacten op. Voor het bewijzen van de waarde van LeadRevive is dat verschil
 * puur vertraging.
 *
 * De adapterlaag bestaat wél al, zodat `WhiseAdapter` later een bestand van
 * tachtig regels is in plaats van een verbouwing.
 */

export interface CsvAdapterOptions {
  content: string
  fileName?: string
  /**
   * Kolomindex → veld. Wat de gebruiker op het importscherm bevestigt of
   * aanpast komt hier binnen; ontbreekt het, dan raadt de adapter zelf.
   */
  mapping?: Record<string, CrmImportField>
}

export class CsvCrmAdapter implements CrmAdapter {
  readonly key = 'csv'
  readonly name = 'CSV-bestand'

  private readonly options: CsvAdapterOptions

  constructor(options: CsvAdapterOptions) {
    this.options = options
  }

  // De inhoud zit al in het object; er valt niets op te halen. De context hoort
  // bij het contract en wordt door deze adapter niet gebruikt.
  async importContacts(_context: CrmImportContext): Promise<CrmImportResult> {
    return this.read()
  }

  /**
   * Synchrone variant voor het analysescherm: laat zien wat we van het bestand
   * begrijpen vóórdat er iets wordt weggeschreven.
   */
  read(): CrmImportResult {
    const warnings: string[] = []
    const parsed = parseCsv(this.options.content)

    if (parsed.header.length === 0) {
      return { contacts: [], header: [], warnings: ['Bestand bevat geen kolomkoppen'] }
    }

    const mapping = this.options.mapping ?? suggestMapping(parsed.header)

    // Zonder identificerend veld levert het bestand geen bruikbare contacten op.
    // Dat nu melden is beter dan duizenden rijen als "ongeldig" wegschrijven.
    const mapped = new Set(Object.values(mapping))
    const hasIdentity =
      mapped.has('displayName') ||
      mapped.has('lastName') ||
      mapped.has('email') ||
      mapped.has('phone') ||
      mapped.has('externalId')

    if (!hasIdentity) {
      warnings.push(
        'Geen kolom herkend voor naam, e-mail of telefoon. Controleer de kolomtoewijzing.',
      )
    }

    if (parsed.malformedRows.length > 0) {
      warnings.push(
        `${parsed.malformedRows.length} regel(s) hadden een afwijkend aantal kolommen ` +
          `(regel ${parsed.malformedRows.slice(0, 5).join(', ')}${parsed.malformedRows.length > 5 ? '…' : ''}). ` +
          'Ze zijn aangevuld en meegenomen.',
      )
    }

    if (parsed.rows.length === 0) {
      warnings.push('Bestand bevat kolomkoppen maar geen datarijen')
    }

    const contacts: RawContactInput[] = parsed.rows.map((row) => applyMapping(row, mapping))

    return { contacts, header: parsed.header, warnings }
  }

  /** De mapping die gebruikt is — voor opslag op `CrmImport.columnMapping`. */
  resolveMapping(): Record<string, CrmImportField> {
    if (this.options.mapping) return this.options.mapping
    return suggestMapping(parseCsv(this.options.content).header)
  }
}

/** Herkenbaar bestandstype voor de uploadpoort. */
export function looksLikeCsv(fileName: string | null | undefined): boolean {
  if (!fileName) return false
  return /\.(csv|tsv|txt)$/i.test(fileName)
}
