import { NextResponse } from 'next/server'

import { createLogger } from '@/lib/logger'
import { prisma } from '@/repositories/prisma'

const logger = createLogger({ component: 'ready' })

/**
 * Readiness: kan dit proces requests bedienen?
 *
 * Een `SELECT 1` met een korte timeout. Faalt hij, dan haalt de load balancer
 * dit proces uit de rotatie tot de database terug is. Het antwoord bevat geen
 * details over de fout: deze route is publiek, en een foutmelding van de
 * databasedriver verraadt host, poort of gebruikersnaam.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 2_000

export async function GET(): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'no-store' }

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])
    return NextResponse.json({ status: 'ready' }, { headers })
  } catch (error) {
    logger.error('Readiness-check mislukt', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers })
  }
}
