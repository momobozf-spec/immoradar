/**
 * CSV schrijven voor een kantoor dat zijn gegevens terugvraagt.
 *
 * Puntkomma als scheidingsteken en een BOM vooraan: zo opent Excel op een
 * Nederlandstalige Windows het bestand meteen in kolommen, met accenten intact.
 * Dat is wat een makelaar dubbelklikt; een technisch correcte maar onleesbare
 * export voldoet niet aan de belofte "je krijgt je gegevens terug".
 *
 * Waarden die met =, +, - of @ beginnen krijgen een apostrof ervoor. Een notitie
 * als "=HYPERLINK(...)" uit een CRM wordt anders een formule zodra iemand het
 * bestand opent (CSV-injectie).
 */

export type CsvValue = string | number | boolean | Date | null | undefined | readonly string[]

const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return ''

  let text: string
  if (value instanceof Date) text = value.toISOString()
  else if (Array.isArray(value)) text = value.join(' | ')
  else text = String(value)

  if (FORMULA_START.test(text)) text = `'${text}`
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv<Row>(
  rows: readonly Row[],
  columns: readonly { header: string; value: (row: Row) => CsvValue }[],
): string {
  const lines = [columns.map((column) => cell(column.header)).join(';')]
  for (const row of rows) {
    lines.push(columns.map((column) => cell(column.value(row))).join(';'))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
