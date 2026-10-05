import type { Prisma } from '@/generated/prisma/client'

/**
 * Veilige omgang met Prisma's `Json`-kolommen.
 *
 * Het probleem dat dit oplost: `Prisma.InputJsonValue` accepteert geen
 * `undefined` en geen `Date`, terwijl een ruwe bronpayload beide bevat. Zonder
 * deze conversie faalt een insert pas op het moment dat één bron toevallig een
 * datumveld meestuurt — in productie, midden in een collectorrun.
 */

/** Onbekende waarde → iets dat Prisma in een Json-kolom accepteert. */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

/**
 * Leest een Json-kolom terug als record.
 *
 * Prisma geeft `JsonValue` terug, wat ook `string`, `number` of `null` kan zijn.
 * Overal in de UI `typeof x === 'object'` schrijven is niet te doen; dit doet
 * het één keer.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/** Parse zonder te gooien — voor bronnen waarvan de JSON stuk kan zijn. */
export function safeJsonParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T
  } catch {
    return null
  }
}
