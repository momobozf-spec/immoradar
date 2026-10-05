import 'dotenv/config'

import { prisma } from '@/repositories/prisma'
import { bootstrapPlatformAdmin } from '@/services/userService'

/**
 * De eerste platformbeheerder in een lege (productie)database.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=jij@bedrijf.be npm run bootstrap:admin
 *
 * Druk het tijdelijke wachtwoord één keer af; bij de eerste login moet het
 * vervangen worden. Bestaat het adres al, dan verandert er niets — het script
 * is veilig om in een deploypipeline te laten staan.
 *
 * Kantoren en hun beheerders maak je daarna aan in /admin/agencies.
 */
async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || null

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    process.stderr.write('Zet BOOTSTRAP_ADMIN_EMAIL op een geldig e-mailadres.\n')
    process.exitCode = 1
    return
  }

  const result = await bootstrapPlatformAdmin(email, name)

  if (!result.created) {
    process.stdout.write(`Er bestaat al een account voor ${email}. Er is niets gewijzigd.\n`)
    return
  }

  process.stdout.write(
    [
      '',
      `  Platformbeheerder aangemaakt: ${email}`,
      `  Tijdelijk wachtwoord:          ${result.temporaryPassword}`,
      '',
      '  Dit wordt maar één keer getoond. Log in en kies meteen een eigen wachtwoord.',
      '',
    ].join('\n'),
  )
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Bootstrap mislukt: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
