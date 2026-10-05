import 'dotenv/config'

import { prisma } from '@/repositories/prisma'
import { unlockByEmail } from '@/repositories/userRepository'
import { recordAudit } from '@/services/auditService'

/**
 * Heft de inlogvergrendeling van één account op.
 *
 *   UNLOCK_EMAIL=jij@bedrijf.be npm run unlock:user
 *
 * Voor kantoorgebruikers kan de kantoorbeheerder dit ook in /team (een nieuw
 * tijdelijk wachtwoord heft het slot op). Een platformbeheerder heeft niemand
 * boven zich; voor hem is dit de weg terug als iemand zijn account op slot zet.
 */
async function main(): Promise<void> {
  const email = process.env.UNLOCK_EMAIL?.trim().toLowerCase()
  if (!email) {
    process.stderr.write('Zet UNLOCK_EMAIL op het e-mailadres van het account.\n')
    process.exitCode = 1
    return
  }

  const userId = await unlockByEmail(email)
  if (!userId) {
    process.stderr.write(`Geen account gevonden voor ${email}.\n`)
    process.exitCode = 1
    return
  }

  // Een verwijzing, geen e-mailadres: de audittrail bevat geen persoonsgegevens.
  await recordAudit({ actor: 'cli', action: 'auth.unlocked', entityType: 'User', entityId: userId })
  process.stdout.write(`Vergrendeling opgeheven voor ${email}.\n`)
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Mislukt: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
