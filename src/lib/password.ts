import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Wachtwoordhashing met scrypt uit de standaardbibliotheek.
 *
 * ─── WAAROM scrypt EN GEEN bcrypt/argon2-PAKKET ──────────────────────────────
 *
 * Beide zijn uitstekend, maar beide zijn native modules die bij elke Node-versie
 * en elk platform opnieuw gecompileerd moeten worden. Deze dienst draait op
 * Windows-laptops, in Docker en op Render; een native build die op één daarvan
 * faalt kost meer dan hij oplevert. `crypto.scrypt` is memory-hard, zit in Node
 * zelf, en is voor het aantal gebruikers van een B2B-dashboard ruim voldoende.
 *
 * Het formaat is zelfbeschrijvend — `scrypt$N$r$p$salt$hash` — zodat de
 * parameters later verhoogd kunnen worden zonder bestaande hashes ongeldig te
 * maken: een oude hash draagt zijn eigen parameters bij zich.
 */
/**
 * `promisify(scrypt)` verliest de overload met een options-object, en die hebben
 * we nodig voor `maxmem`. Vandaar deze handgeschreven wrapper.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

interface ScryptParams {
  N: number
  r: number
  p: number
  keyLength: number
}

/** OWASP-richtlijn voor scrypt: N=2^16, r=8, p=1. */
const CURRENT: ScryptParams = { N: 65_536, r: 8, p: 1, keyLength: 32 }

/**
 * `maxmem` moet expliciet: Node's standaard van 32 MB is te krap voor N=2^16
 * (die vraagt ongeveer 128·N·r = 64 MB) en scrypt faalt dan met een
 * weinigzeggende foutmelding.
 */
function maxmemFor(params: ScryptParams): number {
  return 256 * params.N * params.r
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, CURRENT)

  return [
    'scrypt',
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/**
 * Controleert een wachtwoord tegen een opgeslagen hash.
 *
 * Geeft `false` bij elk onverwacht formaat in plaats van te gooien: een
 * beschadigde hash in de database mag een inlogpoging afwijzen, niet de hele
 * loginpagina laten crashen.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const saltPart = parts[4]
  const keyPart = parts[5]

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (!saltPart || !keyPart) return false

  // Bovengrens tegen een onbedoelde (of kwaadwillige) parameterexplosie die
  // gigabytes zou reserveren bij één inlogpoging.
  if (N > 1_048_576 || r > 32 || p > 16) return false

  const salt = Buffer.from(saltPart, 'base64url')
  const expected = Buffer.from(keyPart, 'base64url')

  try {
    const actual = await derive(password, salt, { N, r, p, keyLength: expected.length })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
