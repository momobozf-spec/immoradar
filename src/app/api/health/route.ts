import { NextResponse } from 'next/server'

/**
 * Liveness: draait het webproces?
 *
 * Bewust zonder database. Een hostingplatform herstart een container waarvan de
 * liveness faalt; zou dit de database raadplegen, dan herstart een korte
 * databasestoring alle webprocessen tegelijk en maakt ze het probleem groter.
 * Of de app requests kan bedienen, zegt /api/ready.
 */
export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
