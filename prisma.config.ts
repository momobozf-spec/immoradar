import path from 'node:path'

import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 leest de database-URL voor de CLI (migrate, studio, db push) hier en
 * niet meer uit `schema.prisma`. De applicatie zelf gebruikt hem niet: die
 * opent haar verbinding via de driver adapter in src/repositories/prisma.ts.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  // Geen `env('DATABASE_URL')`: die gooit als de variabele ontbreekt, en
  // `prisma generate` (bij npm install en in de Docker-build) heeft geen
  // database nodig. Migreren zonder URL faalt nog steeds, met een duidelijke
  // melding van Prisma zelf.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
})
