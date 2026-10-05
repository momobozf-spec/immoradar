import { normalizeText } from '@/lib/text'

import type { CrmImportField } from '@/domain/schemas'

/**
 * CSV lezen zoals CRM-exports het schrijven.
 *
 * ─── WAAROM EEN EIGEN PARSER ─────────────────────────────────────────────────
 *
 * Niet omdat het leuk is, maar omdat de invoer voorspelbaar rommelig is en de
 * eisen klein: Belgische CRM-exports komen als UTF-8 met BOM, gescheiden door
 * puntkomma's (Excel op een Nederlandstalige Windows), met velden tussen dubbele
 * aanhalingstekens waarin komma's, puntkomma's én regeleindes kunnen staan.
 * Een pakket dat dat allemaal kan is niet klein, en het stuk dat wij nodig
 * hebben past hieronder.
 *
 * Wat er wél in moet en er vaak uit gelaten wordt: verdubbelde aanhalingstekens
 * ("" binnen een veld), regeleindes binnen een veld, en scheidingstekendetectie.
 * Zonder die drie loopt een import stuk op het eerste adresveld met een komma.
 */

const SUPPORTED_DELIMITERS = [';', ',', '\t', '|'] as const

export interface ParsedCsv {
  header: string[]
  rows: string[][]
  delimiter: string
  /** Regels die niet evenveel kolommen hadden als de kop — gemeld, niet stil weggelaten. */
  malformedRows: number[]
}

/**
 * Raadt het scheidingsteken uit de eerste regel.
 *
 * Telt buiten aanhalingstekens, want "Brussel, België" in een adresveld zou een
 * komma anders tot winnaar maken op een bestand dat puntkomma's gebruikt.
 */
export function detectDelimiter(firstLine: string): string {
  let best = ';'
  let bestCount = 0

  for (const delimiter of SUPPORTED_DELIMITERS) {
    let count = 0
    let inQuotes = false

    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index]
      if (char === '"') inQuotes = !inQuotes
      else if (!inQuotes && char === delimiter) count += 1
    }

    if (count > bestCount) {
      bestCount = count
      best = delimiter
    }
  }

  return best
}

export function parseCsv(content: string): ParsedCsv {
  // BOM weg: anders heet de eerste kolom "﻿voornaam" en matcht geen enkele
  // automatische kolomherkenning.
  const text = content.replace(/^﻿/, '')

  const firstLineEnd = text.search(/\r?\n/)
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  const delimiter = detectDelimiter(firstLine)

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        // "" binnen een veld is één letterlijk aanhalingsteken.
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
    } else if (char !== '\r') {
      field += char
    }
  }

  // Laatste veld/regel, als het bestand niet op een newline eindigt.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim().length > 0))
  const header = (nonEmpty.shift() ?? []).map((value) => value.trim())

  const malformedRows: number[] = []
  const body: string[][] = []

  nonEmpty.forEach((entry, index) => {
    if (entry.length !== header.length) malformedRows.push(index + 2)
    // Toch meenemen, aangevuld of afgekapt: één kolom te veel door een losse
    // puntkomma in een notitieveld hoort geen contact te laten verdwijnen.
    const normalized = Array.from({ length: header.length }, (_, column) =>
      (entry[column] ?? '').trim(),
    )
    body.push(normalized)
  })

  return { header, rows: body, delimiter, malformedRows }
}

/**
 * Herkent per kolomkop welk veld het waarschijnlijk is.
 *
 * Een voorstel, geen beslissing: de gebruiker ziet de mapping en past aan.
 * Kolomnamen komen in het Nederlands, Frans en Engels binnen, afhankelijk van
 * het CRM waaruit geëxporteerd is.
 */
const HEADER_PATTERNS: readonly (readonly [CrmImportField, readonly string[]])[] = [
  ['externalId', ['id', 'contact id', 'contactid', 'klantnummer', 'referentie', 'reference', 'nr']],
  ['firstName', ['voornaam', 'first name', 'firstname', 'prenom', 'prénom']],
  ['lastName', ['achternaam', 'naam', 'last name', 'lastname', 'nom', 'familienaam']],
  ['displayName', ['volledige naam', 'full name', 'fullname', 'contact', 'nom complet', 'display name']],
  ['email', ['email', 'e-mail', 'mail', 'emailadres', 'courriel']],
  ['phone', ['telefoon', 'tel', 'gsm', 'mobiel', 'phone', 'telephone', 'téléphone', 'mobile']],
  ['address', ['adres', 'straat', 'address', 'adresse', 'rue', 'street']],
  ['postalCode', ['postcode', 'postal code', 'zip', 'code postal', 'cp']],
  ['city', ['gemeente', 'stad', 'city', 'plaats', 'ville', 'localite', 'localité']],
  ['contactType', ['type', 'contacttype', 'soort', 'categorie', 'category']],
  ['status', ['status', 'statut', 'staat']],
  ['leadType', ['leadtype', 'lead type', 'bron', 'source', 'interesse', 'aanvraag']],
  ['assignedAgentName', ['makelaar', 'agent', 'verantwoordelijke', 'eigenaar', 'owner', 'courtier']],
  ['notes', ['notities', 'notes', 'opmerking', 'opmerkingen', 'remarque', 'commentaar']],
  ['sourceCreatedAt', ['aangemaakt', 'created', 'datum', 'date', 'created at', 'aanmaakdatum']],
  ['lastContactAt', ['laatste contact', 'last contact', 'laatst gecontacteerd', 'dernier contact']],
]

export function suggestMapping(header: readonly string[]): Record<string, CrmImportField> {
  const mapping: Record<string, CrmImportField> = {}
  const used = new Set<CrmImportField>()

  header.forEach((column, index) => {
    const normalized = normalizeText(column)
    if (normalized.length === 0) {
      mapping[String(index)] = 'ignore'
      return
    }

    for (const [field, patterns] of HEADER_PATTERNS) {
      // Elk veld hoogstens één keer voorstellen: twee kolommen die allebei
      // "naam" heten mogen niet allebei op `lastName` gelegd worden, want dan
      // overschrijft de tweede stilzwijgend de eerste.
      if (used.has(field)) continue

      if (patterns.some((pattern) => normalized === pattern || normalized.includes(pattern))) {
        mapping[String(index)] = field
        used.add(field)
        return
      }
    }

    mapping[String(index)] = 'ignore'
  })

  return mapping
}

/** Eén rij + mapping → een object met veldnamen. */
export function applyMapping(
  row: readonly string[],
  mapping: Readonly<Record<string, CrmImportField>>,
): Partial<Record<Exclude<CrmImportField, 'ignore'>, string>> {
  const result: Partial<Record<Exclude<CrmImportField, 'ignore'>, string>> = {}

  for (const [column, field] of Object.entries(mapping)) {
    if (field === 'ignore') continue

    const value = row[Number(column)]?.trim()
    if (!value) continue

    result[field] = value
  }

  return result
}
