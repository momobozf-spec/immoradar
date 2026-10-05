import 'dotenv/config'

import { prisma } from '@/repositories/prisma'
import { purgeAgency } from '@/services/maintenanceService'

/**
 * Wist één kantoor met al zijn gegevens, onherroepelijk. Voor het einde van een
 * pilot of contract (verwerkersovereenkomst, art. 9).
 *
 *   PURGE_AGENCY=<slug> PURGE_CONFIRM=<slug> npm run agency:purge
 *
 * Twee keer dezelfde slug: een tikfout in één variabele wist niets. Maak eerst
 * een export als het kantoor erom vroeg; daarna is er niets meer om te exporteren.
 * Back-ups bevatten de gegevens nog tot ze volgens hun cyclus vervangen worden.
 */
async function main(): Promise<void> {
  const slug = process.env.PURGE_AGENCY?.trim()
  const confirm = process.env.PURGE_CONFIRM?.trim()

  if (!slug || slug !== confirm) {
    process.stderr.write('Zet PURGE_AGENCY en PURGE_CONFIRM allebei op de slug van het kantoor.\n')
    process.exitCode = 1
    return
  }

  const agency = await prisma.agency.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!agency) {
    process.stderr.write(`Geen kantoor met slug ${slug}.\n`)
    process.exitCode = 1
    return
  }

  const result = await purgeAgency(agency.id)
  if (!result) {
    process.stderr.write('Het kantoor was intussen al verwijderd.\n')
    return
  }

  process.stdout.write(
    `Gewist: ${agency.name} — ${result.users} gebruiker(s), ${result.contacts} contact(en), ` +
      `${result.opportunities} kans(en); ${result.auditEntriesRedacted} auditregel(s) geanonimiseerd.\n`,
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
