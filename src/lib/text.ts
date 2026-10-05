/**
 * Tekstnormalisatie en -vergelijking.
 *
 * Deze module draagt zowel de classificatie ("staat 'zonder makelaar' in deze
 * tekst?") als de property matching ("beschrijven deze twee advertenties
 * hetzelfde huis?"). Beide falen op precies dezelfde manier als je het naïef
 * doet: Belgische advertenties staan vol accenten (Liège, Sint-Genesius-Rode),
 * wisselende leestekens en drie talen door elkaar.
 */

/**
 * Kleine letters, accenten weg, leestekens naar spaties, spaties samengevat.
 *
 * `Sint-Pieters-Woluwe` en `sint pieters woluwe` moeten hetzelfde opleveren,
 * anders matcht een gemeente-territory nooit op een advertentie die het
 * koppelteken anders schrijft dan wij.
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .normalize('NFD')
    // Na NFD staat elk accent als losse combineerbare mark achter zijn letter.
    // `\p{M}` haalt die weg: é → e. Geschreven als Unicode-property en niet als
    // codepoint-bereik, zodat er geen onzichtbare tekens in de broncode staan.
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Zelfde normalisatie, maar zonder spaties — handig als hashsleutel. */
export function normalizeKey(input: string | null | undefined): string {
  return normalizeText(input).replace(/\s+/g, '')
}

export function tokenize(input: string | null | undefined): string[] {
  const normalized = normalizeText(input)
  return normalized.length === 0 ? [] : normalized.split(' ')
}

/**
 * Woorden die in elke vastgoedadvertentie staan en dus niets onderscheiden.
 * Ze uit de vergelijking halen voorkomt dat twee volstrekt verschillende
 * woningen op "te koop instapklaar gelegen" al halverwege lijken te matchen.
 */
const STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'van', 'in', 'op', 'met', 'voor', 'te', 'aan', 'is', 'of', 'bij',
  'uit', 'door', 'naar', 'dit', 'deze', 'die', 'dat', 'er', 'ook', 'als', 'zeer', 'ruime',
  'ruim', 'mooie', 'mooi', 'gelegen', 'nabij', 'zeer',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'et', 'dans', 'sur', 'avec', 'pour', 'au', 'aux',
  'ce', 'cette', 'tres', 'belle', 'beau', 'situe', 'situee',
  'the', 'and', 'with', 'for', 'this', 'that',
  'koop', 'huur', 'vendre', 'louer', 'sale', 'rent', 'verkoop', 'woning', 'immo',
])

export function contentTokens(input: string | null | undefined): string[] {
  return tokenize(input).filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

/**
 * Jaccard-gelijkenis over woordverzamelingen: |doorsnede| / |unie|.
 *
 * Gekozen boven Levenshtein voor beschrijvingen omdat advertenties bij een
 * herplaatsing meestal *hergeschikt* worden (alinea's wisselen, een zin erbij),
 * niet karakter voor karakter aangepast. Jaccard is daar ongevoelig voor;
 * Levenshtein straft een verplaatste alinea af alsof de tekst nieuw is — en dan
 * mist de relist-detectie precies de gevallen waarvoor ze bestaat.
 */
export function jaccardSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const setA = new Set(contentTokens(a))
  const setB = new Set(contentTokens(b))

  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Levenshtein-afstand, begrensd op korte strings.
 *
 * Alleen voor titels en adressen — daar telt een typefout of een ontbrekend
 * huisnummer wél, en zijn de strings kort genoeg dat O(n·m) niets kost. Boven de
 * limiet vallen we terug op "maximaal verschillend" in plaats van een matrix van
 * 20.000 × 20.000 op te bouwen.
 */
const MAX_LEVENSHTEIN_LENGTH = 256

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  if (a.length > MAX_LEVENSHTEIN_LENGTH || b.length > MAX_LEVENSHTEIN_LENGTH) {
    return Math.max(a.length, b.length)
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      )
    }
    const swap = previous
    previous = current
    current = swap
  }

  return previous[b.length] ?? Math.max(a.length, b.length)
}

/** Levenshtein omgerekend naar 0–1, na normalisatie van beide kanten. */
export function normalizedSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (left.length === 0 || right.length === 0) return 0
  if (left === right) return 1

  const distance = levenshtein(left, right)
  const longest = Math.max(left.length, right.length)
  return Math.max(0, 1 - distance / longest)
}

/**
 * Beste van twee werelden voor beschrijvingen: hoge Jaccard betekent "dezelfde
 * woorden", hoge Levenshtein betekent "bijna letterlijk dezelfde tekst". Een
 * herplaatste advertentie scoort op minstens één van beide hoog.
 */
export function descriptionSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return Math.max(jaccardSimilarity(a, b), normalizedSimilarity(a?.slice(0, 240), b?.slice(0, 240)))
}

/** Knipt tekst af op een woordgrens, voor het dashboard en Telegram. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  const cut = input.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Rechtsvormen die niets zeggen over wélk kantoor het is.
 *
 * "Immo De Meyer BV" en "Immo De Meyer BVBA" zijn hetzelfde kantoor dat van
 * rechtsvorm veranderd is — zonder deze lijst zou Competitor Radar er twee
 * concurrenten van maken en beider cijfers halveren.
 */
const LEGAL_FORMS = new Set([
  'bv', 'bvba', 'nv', 'sa', 'sprl', 'srl', 'comm', 'va', 'cvba', 'vzw', 'asbl',
  'sc', 'scs', 'gcv', 'eenmanszaak', 'bvbaa',
])

/** Kantoornaam → stabiele sleutel voor `AgencyIdentity.normalizedName`. */
export function normalizeAgencyName(input: string | null | undefined): string {
  return tokenize(input)
    .filter((token) => !LEGAL_FORMS.has(token))
    .join(' ')
    .trim()
}
