/**
 * Een PostgreSQL voor ontwikkeling, zonder Docker.
 *
 * ─── WAAROM DIT BESTAAT NAAST docker-compose.yml ─────────────────────────────
 *
 * Docker is de nette weg en staat in de README. Maar dit project wordt ook
 * ontwikkeld op Windows-laptops waar Docker Desktop niet draait, niet mag, of
 * een herstart vraagt. `embedded-postgres` pakt een echte PostgreSQL-binary uit
 * in `.devdb/` en start die op een eigen poort — dezelfde database-engine als in
 * productie, zonder installatie.
 *
 * Bewust een apárte poort (5433) van de docker-compose-variant (5432): wie beide
 * ooit tegelijk start, krijgt dan een duidelijke `DATABASE_URL`-keuze in plaats
 * van een verbinding met de verkeerde database.
 *
 * Draai `npm run dev:db` in een eigen terminal en laat hem staan. Ctrl-C stopt
 * hem netjes; de data in `.devdb/` blijft.
 */
import path from 'node:path'

import 'dotenv/config'
import EmbeddedPostgres from 'embedded-postgres'

const DATABASE_DIR = path.resolve(process.cwd(), '.devdb')

/** Waar de app de database verwacht als er geen `DATABASE_URL` staat. */
const FALLBACK = {
  port: 5433,
  user: 'postgres',
  password: 'postgres',
  database: 'immoradar',
}

/**
 * De verbindingsgegevens komen uit `DATABASE_URL`, niet uit constanten hier.
 *
 * ─── WAAROM DIT ZO MOET ──────────────────────────────────────────────────────
 *
 * Staan ze los van elkaar, dan start dit script vroeg of laat een server op een
 * andere poort dan waar de app naar kijkt. Je krijgt dan een draaiende database
 * én een verbindingsfout, en je zoekt een half uur naar een probleem dat er
 * niet is.
 *
 * Dat is geen hypothetisch geval: op een machine met meerdere projecten die
 * elk `embedded-postgres` gebruiken, zijn 5433 en 5434 zo bezet. De uitweg is
 * dan een andere poort in `.env` — en dit script hoort die te volgen in plaats
 * van hem te negeren.
 */
function readTarget(): { port: number; user: string; password: string; database: string } {
  const raw = process.env.DATABASE_URL
  if (!raw) return FALLBACK

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`DATABASE_URL is geen geldige URL: ${raw}`)
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
  if (!localHosts.has(url.hostname)) {
    // Dit script start een lokale server. Wijst DATABASE_URL naar een externe
    // host, dan is er al een database en zou dit script alleen maar de indruk
    // wekken dat het die beheert.
    throw new Error(
      `DATABASE_URL wijst naar "${url.hostname}". Dit script start alleen een lokale ontwikkeldatabase.`,
    )
  }

  return {
    port: Number(url.port) || FALLBACK.port,
    user: decodeURIComponent(url.username) || FALLBACK.user,
    password: decodeURIComponent(url.password) || FALLBACK.password,
    database: url.pathname.replace(/^\//, '') || FALLBACK.database,
  }
}

const TARGET = readTarget()
const { port: PORT, user: USER, password: PASSWORD, database: DATABASE } = TARGET

const CONNECTION_STRING = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public`

async function main(): Promise<void> {
  const postgres = new EmbeddedPostgres({
    databaseDir: DATABASE_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    // De datamap blijft staan tussen sessies; anders was elke herstart een
    // lege database en een nieuwe seed.
    persistent: true,
    /**
     * ─── WAAROM DIT ER MOET STAAN ─────────────────────────────────────────
     *
     * `initdb` neemt zonder deze vlaggen de systeemlocale over. Op een
     * Nederlandstalige Windows is dat `Dutch_Belgium.1252`, en dan krijgt de
     * cluster WIN1252 als encoding. Dat lijkt lang goed te gaan en breekt dan
     * op precies de verkeerde plek: een score-uitleg met een echt minteken
     * (−6,06%) of een gemeente als Liège levert
     *
     *     character with byte sequence 0xe2 0x88 0x92 has no equivalent in
     *     encoding "WIN1252"
     *
     * en de kans wordt niet aangemaakt. In een Belgisch product met drie talen
     * is UTF-8 geen voorkeur maar een vereiste; docker-compose gebruikt het
     * standaard, en de ontwikkeldatabase hoort niet stiekem anders te zijn.
     *
     * `--locale=C` erbij omdat een UTF-8-encoding met een 1252-locale door
     * initdb geweigerd wordt. Sorteervolgorde speelt hier geen rol: alles wat
     * op volgorde moet staan wordt in de applicatie genormaliseerd.
     */
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })

  // `initialise` is idempotent genoeg: op een bestaande datamap slaat hij over.
  // We vangen de fout af omdat de melding per platform verschilt en een tweede
  // start geen foutmelding hoort op te leveren.
  try {
    await postgres.initialise()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/exists|not empty|already/i.test(message)) throw error
  }

  await postgres.start()

  try {
    await postgres.createDatabase(DATABASE)
    process.stdout.write(`Database "${DATABASE}" aangemaakt.\n`)
  } catch {
    // Bestond al — dat is het normale geval bij de tweede start.
  }

  process.stdout.write(
    [
      '',
      `  PostgreSQL draait op poort ${PORT}, database "${DATABASE}".`,
      '',
      process.env.DATABASE_URL
        ? '  Dit volgt de DATABASE_URL uit je .env.'
        : `  Geen DATABASE_URL gevonden. Zet in je .env:\n\n  DATABASE_URL="${CONNECTION_STRING}"`,
      '',
      '  Daarna, in een tweede terminal:',
      '',
      '    npm run db:migrate',
      '    npm run db:seed',
      '    npm run dev',
      '',
      '  Ctrl-C stopt de database.',
      '',
      '',
    ].join('\n'),
  )

  const shutdown = async (): Promise<void> => {
    process.stdout.write('\nDatabase stoppen…\n')
    try {
      await postgres.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  // Openhouden totdat er een signaal komt.
  await new Promise<never>(() => {})
}

main().catch((error: unknown) => {
  process.stderr.write(`Kon de ontwikkeldatabase niet starten: ${String(error)}\n`)
  process.exit(1)
})
