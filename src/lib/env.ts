import { z } from 'zod'

/**
 * Eén plek waar de omgeving gelezen én gevalideerd wordt.
 *
 * Waarom validatie in plaats van `process.env.X ?? default` op de call-site: een
 * verkeerd getypte drempel (`PRIVATE_CONFIDENCE_THRESHOLD="85"` in plaats van
 * `"0.85"`) zou anders pas opvallen wanneer élke advertentie als particulier
 * doorgaat en vijf kantoren tegelijk een onbruikbare alert krijgen. Hier faalt
 * de start.
 *
 * Secrets komen uitsluitend hiervandaan. Nergens in de broncode staat een token,
 * wachtwoord of connectiestring.
 */

/** Komma-gescheiden lijst → array zonder lege elementen. */
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )

const numeric = (fallback: number): z.ZodType<number> =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().finite())

/** Komma-gescheiden getallen, oplopend gesorteerd en ontdubbeld. */
const numericCsv = (fallback: string): z.ZodType<number[]> =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value))
    .transform((value) =>
      [
        ...new Set(
          value
            .split(',')
            .map((part) => Number(part.trim()))
            .filter((part) => Number.isFinite(part) && part > 0),
        ),
      ].sort((a, b) => a - b),
    )
    .pipe(z.array(z.number().int().positive()).min(1))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL ontbreekt'),

  /** Ondertekent het sessiecookie. Zie `assertProductionSecrets`. */
  SESSION_SECRET: z.string().default(''),
  SESSION_TTL_HOURS: numeric(12).pipe(z.number().int().positive()),

  /** Max. verbindingen per proces naar PostgreSQL (web en worker elk apart). */
  DATABASE_POOL_MAX: numeric(10).pipe(z.number().int().positive().max(100)),

  // ── Inlogbeveiliging ──────────────────────────────────────────────────────
  /** Na zoveel mislukte pogingen op rij gaat een account tijdelijk op slot. */
  LOGIN_MAX_ATTEMPTS: numeric(5).pipe(z.number().int().min(3).max(20)),
  /** Duur van de eerste vergrendeling; elke volgende reeks verdubbelt. */
  LOGIN_LOCK_MINUTES: numeric(15).pipe(z.number().int().min(1).max(1440)),
  /**
   * Hoeveel reverse proxies er vóór de app staan die `X-Forwarded-For` aanvullen
   * (Render, Fly, een load balancer: 1). Het client-IP is dan het zoveelste adres
   * van rechts — de linkse adressen kan de bezoeker zelf verzinnen. 0 = de
   * header negeren (direct verbonden, of onbekend).
   */
  TRUSTED_PROXY_HOPS: numeric(1).pipe(z.number().int().min(0).max(10)),
  /** Inlogpogingen per IP-adres per kwartier, over alle accounts heen. */
  LOGIN_MAX_ATTEMPTS_PER_IP: numeric(30).pipe(z.number().int().min(5).max(1000)),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_FALLBACK_CHAT_ID: z.string().default(''),

  // ── Classificatie ─────────────────────────────────────────────────────────
  /** Vanaf welke zekerheid een verkoper particulier heet. */
  PRIVATE_CONFIDENCE_THRESHOLD: numeric(0.85).pipe(z.number().min(0).max(1)),
  /** Hoeveel gelijktijdige advertenties een verkoper professioneel maken. */
  PROFESSIONAL_LISTING_COUNT_THRESHOLD: numeric(4).pipe(z.number().int().min(1)),

  // ── Property matching ─────────────────────────────────────────────────────
  /** Vanaf hier koppelen we automatisch aan een bestaand pand. */
  PROPERTY_MATCH_THRESHOLD: numeric(0.78).pipe(z.number().min(0).max(1)),
  /** Daaronder, maar boven deze grens, is het een kandidaat voor de relist-detectie. */
  PROPERTY_MATCH_REVIEW_THRESHOLD: numeric(0.55).pipe(z.number().min(0).max(1)),

  // ── CRM ↔ markt matching ──────────────────────────────────────────────────
  /**
   * Vanaf hier koppelen we een marktsignaal automatisch aan een CRM-contact.
   * Hoger dan de property-drempel, en met opzet: een verkeerd gekoppeld pand
   * levert een rommelige timeline op, een verkeerd gekoppeld contact laat een
   * makelaar een vreemde opbellen alsof hij hem kent.
   */
  CRM_MATCH_AUTO_THRESHOLD: numeric(0.8).pipe(z.number().min(0).max(1)),
  /** Daartussen: match tonen als "te bevestigen", niet als feit. */
  CRM_MATCH_REVIEW_THRESHOLD: numeric(0.55).pipe(z.number().min(0).max(1)),

  // ── LeadRevive ────────────────────────────────────────────────────────────
  /** Na hoeveel maanden stilte een contact dormant heet. */
  DORMANT_MONTHS: numeric(12).pipe(z.number().int().min(1).max(120)),
  /** Minimale relatiescore voordat een dormant contact een eigen kans wordt. */
  MIN_RELATIONSHIP_SCORE: numeric(45).pipe(z.number().int().min(0).max(100)),

  // ── Event detection ───────────────────────────────────────────────────────
  /** Bij welke leeftijden (dagen) een STALE_LISTING-event valt. */
  STALE_THRESHOLD_DAYS: numericCsv('30,60,90'),
  /** Kleinere prijswijzigingen negeren we: dat is ruis, geen marktsignaal. */
  PRICE_CHANGE_MIN_PERCENT: numeric(0.5).pipe(z.number().min(0).max(100)),
  /** Zoveel runs zonder waarneming voordat een advertentie REMOVED heet. */
  COLLECTOR_MISSING_RUNS_BEFORE_REMOVED: numeric(3).pipe(z.number().int().min(1)),
  /** Binnen hoeveel dagen na verwijdering een nieuwe advertentie een relist is. */
  RELIST_WINDOW_DAYS: numeric(365).pipe(z.number().int().positive()),

  // ── Opportunities ─────────────────────────────────────────────────────────
  /** Minimale score voordat een opportunity überhaupt wordt aangemaakt. */
  MIN_OPPORTUNITY_SCORE: numeric(40).pipe(z.number().int().min(0).max(100)),
  /** Na hoeveel dagen een onaangeraakte opportunity verloopt. */
  OPPORTUNITY_TTL_DAYS: numeric(30).pipe(z.number().int().positive()),
  /** Vanaf welke vraagprijs een pand als hoogwaardig telt (commissie weegt mee). */
  HIGH_VALUE_THRESHOLD: numeric(600_000).pipe(z.number().int().positive()),

  // ── Collectors ────────────────────────────────────────────────────────────
  COLLECTOR_ENABLED_SOURCES: csv,
  COLLECTOR_USER_AGENT: z
    .string()
    .default('ImmoRadarBot/0.1 (+https://example.be/bot; contact@example.be)'),
  COLLECTOR_MAX_REQUESTS_PER_MINUTE: numeric(20).pipe(z.number().int().positive()),
  COLLECTOR_HTTP_TIMEOUT_MS: numeric(15_000).pipe(z.number().int().positive()),
  COLLECTOR_COOLDOWN_MINUTES: numeric(30).pipe(z.number().int().positive()),
  COLLECTOR_CONCURRENCY: numeric(3).pipe(z.number().int().positive().max(32)),
  COLLECTOR_MAX_ITEMS_PER_RUN: numeric(500).pipe(z.number().int().positive()),
  /**
   * Hoeveel minuten één "tick" van de demobron duurt. De synthetische markt
   * verandert per tick (prijsdaling, intrekking, herplaatsing); lager zetten
   * laat de volledige levensloop van een pand in enkele minuten zien.
   */
  DEMO_TICK_MINUTES: numeric(5).pipe(z.number().int().positive()),

  // ── Bewaartermijnen ───────────────────────────────────────────────────────
  RETENTION_SELLER_CONTACT_DAYS: numeric(180).pipe(z.number().int().min(0)),
  RETENTION_RAW_PAYLOAD_DAYS: numeric(14).pipe(z.number().int().min(0)),
  RETENTION_REMOVED_LISTING_DAYS: numeric(730).pipe(z.number().int().min(0)),
  /**
   * Hoe lang een CRM-contact zonder enige activiteit bewaard blijft. Ruim, want
   * dit is data die het kantoor zélf aanleverde en waarvan de bewaartermijn
   * uiteindelijk bij het kantoor ligt; 0 zet de opruiming uit. Standaard tien
   * jaar: korter dan vijf zou de categorie "eerdere koper" (vijf jaar stil)
   * wissen op het moment dat ze relevant wordt.
   */
  RETENTION_CRM_CONTACT_DAYS: numeric(3_650).pipe(z.number().int().min(0)),
  /**
   * Hoe lang de ruwe kolommen van een importregel bewaard blijven. Ze dienen
   * alleen om een import na te kijken; status en melding blijven daarna staan.
   */
  RETENTION_IMPORT_ROWS_DAYS: numeric(90).pipe(z.number().int().min(0)),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Gedeeld geheim voor de cron-routes. Leeg = routes uit. */
  CRON_SECRET: z.string().default(''),
  /** Basis-URL in alertberichten, zodat een link naar het juiste dashboard wijst. */
  APP_BASE_URL: z.string().default('http://localhost:3000'),

  // ── Juridische identiteit (privacyverklaring en voorwaarden) ──────────────
  /** De rechtspersoon achter het platform: verwerkingsverantwoordelijke en contractpartij. */
  LEGAL_ENTITY_NAME: z.string().default(''),
  LEGAL_ENTITY_VAT: z.string().default(''),
  LEGAL_ENTITY_ADDRESS: z.string().default(''),
  /** Adres voor privacyverzoeken (inzage, verwijdering, bezwaar). */
  LEGAL_CONTACT_EMAIL: z.string().default(''),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Ongeldige omgevingsvariabelen:\n${details}`)
  }

  return result.data
}

export function getEnv(): Env {
  cached ??= parseEnv()
  return cached
}

/** Alleen voor tests: dwingt een herlezing na het aanpassen van process.env. */
export function resetEnvCache(): void {
  cached = null
}

/**
 * Harde eis in productie. Zonder `SESSION_SECRET` is elk sessiecookie te
 * vervalsen, en dan is de tenantscheiding — de belangrijkste belofte van een
 * multi-tenant SaaS — een suggestie in plaats van een grens.
 */
export function assertProductionSecrets(env: Env = getEnv()): void {
  if (env.NODE_ENV !== 'production') return

  const missing: string[] = []
  if (env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (minstens 32 tekens)')
  if (env.SESSION_SECRET === DEV_SESSION_SECRET) {
    missing.push('SESSION_SECRET (het publieke ontwikkelgeheim is in productie niet toegestaan)')
  }
  if (!isSecureBaseUrl(env.APP_BASE_URL)) {
    missing.push('APP_BASE_URL met https:// (sessiecookies zijn in productie Secure)')
  }

  if (missing.length > 0) {
    throw new Error(`Productie vereist: ${missing.join(', ')}`)
  }
}

/**
 * https, of een lokaal adres. Dat laatste zodat `docker compose --profile full`
 * op een laptop in productiemodus kan draaien zonder certificaat; browsers
 * behandelen localhost als veilige context en aanvaarden er Secure-cookies.
 */
export function isSecureBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Is er een bruikbaar sessiegeheim? Buiten productie mag het ontbreken; er wordt
 * dan een vast ontwikkelgeheim gebruikt en het dashboard zegt dat met een banner.
 */
export function isSessionSecretConfigured(env: Env = getEnv()): boolean {
  return env.SESSION_SECRET.length >= 32
}

const DEV_SESSION_SECRET = 'immoradar-development-only-session-secret-not-for-production'

/**
 * Het geheim waarmee cookies ondertekend worden.
 *
 * Buiten productie valt dit terug op een vaste, publiek bekende string. Dat is
 * bewust: het maakt `npm run dev` mogelijk zonder configuratie, en het is
 * onbruikbaar in productie omdat `assertProductionSecrets` daar al gefaald zou
 * hebben.
 */
export function sessionSecret(env: Env = getEnv()): string {
  if (isSessionSecretConfigured(env)) return env.SESSION_SECRET

  // Tweede slot, los van `assertProductionSecrets` bij het opstarten: valt een
  // productieproces hier toch terug op het publieke ontwikkelgeheim, dan is elk
  // cookie te vervalsen. Liever geen enkele sessie dan een vervalsbare.
  if (env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET ontbreekt of is te kort; sessies zijn in productie uitgeschakeld')
  }

  return DEV_SESSION_SECRET
}
