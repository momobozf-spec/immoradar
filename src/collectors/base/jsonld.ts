import { safeJsonParse } from '@/lib/json'

/**
 * JSON-LD uit een HTML-pagina halen.
 *
 * ─── WAAROM DIT DE DERDE VOORKEUR IS EN GEEN HTML-SCRAPER ────────────────────
 *
 * `<script type="application/ld+json">` is gestructureerde data die de site
 * *bedoeld* publiceert — voor zoekmachines, en daarmee voor iedereen die
 * publiek toegankelijke informatie leest. Het is stabiel (de site houdt het
 * werkend voor Google), het is expliciet gepubliceerd, en het vraagt één
 * request per pagina in plaats van een parser die op klassennamen jaagt en
 * bij elke redesign breekt.
 *
 * ─── WAAROM ZONDER cheerio ───────────────────────────────────────────────────
 *
 * We zoeken één tagsoort en lezen de inhoud. Daar een volledige DOM-parser van
 * 500 kB voor binnenhalen is niet in verhouding — en een DOM opbouwen van een
 * pagina van 2 MB kost meer dan de request zelf.
 */

/**
 * De script-tags. Non-greedy, want een pagina bevat er meestal meerdere en een
 * greedy match zou alles tussen de eerste en de laatste als één blok pakken.
 */
const JSON_LD_BLOCK = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** Alle JSON-LD-objecten uit een pagina, plat geslagen. */
export function extractJsonLd(html: string): unknown[] {
  const found: unknown[] = []

  for (const match of html.matchAll(JSON_LD_BLOCK)) {
    const body = match[1]
    if (!body) continue

    const parsed = safeJsonParse<unknown>(stripCdata(body))
    if (parsed === null) continue

    // Een blok mag zelf een array zijn, of een @graph bevatten. Beide platslaan,
    // zodat de aanroeper altijd met een vlakke lijst objecten werkt.
    for (const node of flatten(parsed)) {
      found.push(node)
    }
  }

  return found
}

function stripCdata(input: string): string {
  return input.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
}

function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten)

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const graph = record['@graph']
    if (Array.isArray(graph)) return graph.flatMap(flatten)
    return [record]
  }

  return []
}

/**
 * Objecten van een bepaald schema.org-type.
 *
 * `@type` kan een string of een array zijn ("een Product én een Offer"), en de
 * vergelijking is hoofdletterongevoelig omdat sites het inconsistent schrijven.
 */
export function selectByType(nodes: unknown[], ...types: string[]): Record<string, unknown>[] {
  const wanted = new Set(types.map((type) => type.toLowerCase()))

  return nodes.filter((node): node is Record<string, unknown> => {
    if (node === null || typeof node !== 'object') return false

    const rawType = (node as Record<string, unknown>)['@type']
    const list = Array.isArray(rawType) ? rawType : [rawType]

    return list.some((entry) => typeof entry === 'string' && wanted.has(entry.toLowerCase()))
  })
}

/** Genest veld ophalen: `pick(node, 'address', 'postalCode')`. */
export function pick(node: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = node

  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    // schema.org staat toe dat elk veld een array van waarden is.
    if (Array.isArray(current)) current = current[0]
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

export function pickString(node: Record<string, unknown>, ...path: string[]): string | undefined {
  const value = pick(node, ...path)
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return String(value)
  return undefined
}

export function pickNumber(node: Record<string, unknown>, ...path: string[]): number | undefined {
  const value = pick(node, ...path)
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string') {
    // "€ 495.000" / "495000.00" / "495 000" → 495000. Punten en spaties zijn in
    // Belgische notatie duizendtalscheiders, geen decimaalteken.
    const cleaned = value.replace(/[^\d,.-]/g, '')
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/\.(?=\d{3}\b)/g, '')

    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) return parsed
  }

  return undefined
}
