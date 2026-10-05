import 'dotenv/config'

import { createHmac } from 'node:crypto'

import { prisma } from '@/repositories/prisma'

/**
 * Rooktest: rendert het dashboard voor een échte ingelogde gebruiker?
 *
 * ─── WAAROM DIT GEEN OMWEG OM DE LOGIN IS ────────────────────────────────────
 *
 * De inlog loopt via een server action, en die is met `curl` niet zinnig aan te
 * roepen. Dit script maakt daarom een sessiecookie op precies de manier waarop
 * de applicatie dat zelf doet — zelfde payload, zelfde HMAC, zelfde geheim — en
 * doet daar een gewone HTTP-request mee. Slaagt dat, dan werkt de hele keten
 * inclusief de handtekeningcontrole en de kantoorafscherming.
 *
 * Lukt het ondertekenen niet, dan faalt de test; er wordt niets omzeild.
 */

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000'
const DEV_SECRET = 'immoradar-development-only-session-secret-not-for-production'

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

async function main(): Promise<void> {
  const secret =
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
      ? process.env.SESSION_SECRET
      : DEV_SECRET

  const user = await prisma.user.findFirst({
    where: { role: 'AGENCY_ADMIN', active: true, agencyId: { not: null } },
    include: { agency: true },
  })

  if (!user?.agencyId) {
    console.error('Geen kantoorbeheerder in de database — draai eerst npm run db:seed')
    process.exitCode = 1
    return
  }

  const now = Date.now()
  const payload = {
    sub: user.id,
    agencyId: user.agencyId,
    role: user.role,
    // Moet gelijk zijn aan de versie in de database, anders weigert getSession
    // het cookie als ingetrokken.
    ver: user.sessionVersion,
    iat: now,
    exp: now + 3_600_000,
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const cookie = `immoradar_session=${body}.${sign(body, secret)}`

  console.log(`Ingelogd als ${user.email} (${user.agency?.name})\n`)

  const routes = [
    '/',
    '/market',
    '/properties',
    '/territories',
    '/alerts',
    '/leadrevive',
    '/imports',
    '/analytics',
    '/pipeline',
    '/settings',
  ]

  let failures = 0

  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`, {
      headers: { cookie },
      redirect: 'manual',
    })

    const ok = response.status === 200
    if (!ok) failures += 1

    const html = ok ? await response.text() : ''
    const size = ok ? `${Math.round(html.length / 1024)} kB` : ''

    console.log(`  ${ok ? 'OK  ' : 'FOUT'} ${route.padEnd(14)} HTTP ${response.status}  ${size}`)
  }

  // De opportunity-detailpagina, met een echt id van dit kantoor.
  const opportunity = await prisma.opportunity.findFirst({
    where: { agencyId: user.agencyId },
    orderBy: { score: 'desc' },
  })

  if (opportunity) {
    const response = await fetch(`${BASE}/opportunities/${opportunity.id}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const ok = response.status === 200
    if (!ok) failures += 1
    console.log(`  ${ok ? 'OK  ' : 'FOUT'} ${'/opportunities/:id'.padEnd(14)} HTTP ${response.status}`)
  }

  // De tenantgrens: een kans van een ánder kantoor mag niet zichtbaar zijn.
  const foreign = await prisma.opportunity.findFirst({
    where: { agencyId: { not: user.agencyId } },
  })

  if (foreign) {
    const response = await fetch(`${BASE}/opportunities/${foreign.id}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const blocked = response.status === 404 || response.status === 307 || response.status === 403
    if (!blocked) failures += 1
    console.log(
      `  ${blocked ? 'OK  ' : 'LEK '} tenantgrens    HTTP ${response.status} op andermans kans`,
    )
  }

  console.log('')
  console.log(failures === 0 ? 'Alles rendert.' : `${failures} route(s) faalden.`)
  if (failures > 0) process.exitCode = 1

  await prisma.$disconnect()
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  await prisma.$disconnect()
  process.exitCode = 1
})
