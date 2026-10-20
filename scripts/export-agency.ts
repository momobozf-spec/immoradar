import 'dotenv/config'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { prisma } from '@/repositories/prisma'
import { exportAgency } from '@/services/agencyExportService'

/**
 * Schrijft alle gegevens van één kantoor als CSV naar een map.
 *
 *   EXPORT_AGENCY=<slug> npm run agency:export [-- --out exports]
 *
 * Voor het einde van een pilot (teruggave vóór verwijdering, zie
 * verwerkersovereenkomst) of een inzageverzoek. Daarna eventueel
 * `npm run agency:purge`. De uitvoermap bevat persoonsgegevens: bezorg ze via
 * een beveiligde weg en verwijder je lokale kopie zodra het kantoor de
 * ontvangst bevestigt.
 */
async function main(): Promise<void> {
  const slug = process.env.EXPORT_AGENCY?.trim()
  const outIndex = process.argv.indexOf('--out')
  const outRoot = outIndex > -1 ? (process.argv[outIndex + 1] ?? 'exports') : 'exports'

  if (!slug) {
    process.stderr.write('Zet EXPORT_AGENCY op de slug van het kantoor.\n')
    process.exitCode = 1
    return
  }

  const agency = await prisma.agency.findUnique({ where: { slug }, select: { id: true } })
  if (!agency) {
    process.stderr.write(`Geen kantoor met slug ${slug}.\n`)
    process.exitCode = 1
    return
  }

  const result = await exportAgency(agency.id)
  if (!result) {
    process.stderr.write('Het kantoor bestaat niet meer.\n')
    process.exitCode = 1
    return
  }

  const directory = join(outRoot, `${slug}-${result.exportedAt.toISOString().slice(0, 10)}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const [name, content] of Object.entries(result.files)) {
    writeFileSync(join(directory, name), content, { mode: 0o600 })
  }

  process.stdout.write(
    `Geëxporteerd naar ${directory}: ` +
      Object.entries(result.counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ') +
      '.\n',
  )
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Mislukt: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
