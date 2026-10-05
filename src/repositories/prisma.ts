import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'

/**
 * Eén PrismaClient per proces.
 *
 * In development herlaadt Next bij elke wijziging de servermodules. Zonder deze
 * globale cache maakt elke herlaadbeurt een nieuwe client met een nieuwe pool,
 * en loopt PostgreSQL na twintig bewerkingen vol met "too many clients".
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * ─── WAAROM `error` NIET IN DE LOGCONFIGURATIE STAAT ─────────────────────────
 *
 * Dit systeem gebruikt unique-constraints als werkend mechanisme, niet als
 * vangnet: `ListingEvent.dedupeKey`, `Opportunity.dedupeKey` en `Alert.dedupeKey`
 * maken dubbel werk fysiek onmogelijk, en een botsing (P2002) betekent gewoon
 * "iemand anders was eerder". De repositories vangen die af en geven `null`.
 *
 * Met `error` in de logconfiguratie drukt Prisma zo'n afgevangen botsing tóch af
 * op stderr, compleet met codeframe. Een tweede seed-run of een herhaalde
 * collectorrun ziet er dan uit alsof er iets stuk is, terwijl het systeem
 * precies doet wat het hoort te doen — en dat leert mensen logregels negeren.
 *
 * Dit onderdrukt geen echte fouten: Prisma gooit ze hoe dan ook als exception,
 * met stack trace. Wat hier wegvalt is uitsluitend de dubbele afdruk.
 */
/**
 * ─── DE VERBINDING ───────────────────────────────────────────────────────────
 *
 * Prisma 7 praat via een driver adapter met PostgreSQL in plaats van via een
 * Rust-engine. `DATABASE_POOL_MAX` begrenst de pool per proces: web en worker
 * draaien elk hun eigen pool, en een managed Postgres met 25 verbindingen is zo
 * vol als beide op de standaard van 10 staan en er een deploy overlapt.
 *
 * De URL wordt hier rechtstreeks uit `process.env` gelezen en niet via
 * `getEnv()`: deze module wordt ook door de seed en de CLI geladen, en die
 * hoeven niet de volledige appconfiguratie te valideren om een database te
 * kunnen openen.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL ontbreekt. Zet hem in .env (zie .env.example).')
  }

  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10)
  const adapter = new PrismaPg({
    connectionString,
    max: Number.isFinite(max) && max > 0 ? max : 10,
  })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
  })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
