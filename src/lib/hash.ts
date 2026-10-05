import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Hashing voor twee heel verschillende doelen, met opzet in één bestand zodat
 * duidelijk blijft welke waar hoort.
 *
 * `sha256Hex` is een *inhoudsvingerafdruk*: goedkoop, deterministisch, gebruikt
 * om te zien of een advertentie gewijzigd is. Niet geschikt voor geheimen.
 *
 * `signValue`/`verifySignedValue` zijn HMAC met een geheim, voor het
 * sessiecookie. Het verschil is niet academisch: een sessiecookie met een kale
 * SHA-256 erin kan iedereen namaken — en in een multi-tenant dienst betekent dat
 * inloggen als een willekeurig ander kantoor.
 */

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Korte vorm van dezelfde hash — genoeg voor een vingerafdruk-index. */
export function shortHash(input: string, length = 16): string {
  return sha256Hex(input).slice(0, length)
}

/**
 * Stabiele hash over een objectvorm: sleutels gesorteerd, lege waarden
 * weggelaten. Zonder de sortering krijgt dezelfde advertentie een andere hash
 * puur omdat een bron zijn JSON-velden anders ordent, en dan detecteren we een
 * wijziging die er niet is.
 */
export function stableHash(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
    .filter(([, inner]) => inner !== undefined && inner !== null && inner !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, inner]) => `${key}=${String(inner)}`)

  return sha256Hex(entries.join('|'))
}

export function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

/**
 * Vergelijkt in constante tijd. Een gewone `===` op een MAC lekt via de looptijd
 * hoeveel bytes klopten, waarmee een aanvaller de handtekening byte voor byte
 * kan raden.
 */
export function verifySignedValue(value: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signValue(value, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

/** Constante-tijd stringvergelijking voor gedeelde secrets (cron, webhooks). */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
