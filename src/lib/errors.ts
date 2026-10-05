/**
 * Foutsoorten die de scheduler uit elkaar moet kunnen houden.
 *
 * Het onderscheid is niet cosmetisch: een `RobotsDisallowedError` mag nooit
 * geretried worden (de bron zegt nee, harder proberen maakt dat niet anders),
 * terwijl een `SourceTimeoutError` juist het schoolvoorbeeld van retryen is.
 */

export type ErrorKind =
  | 'ROBOTS_DISALLOWED'
  | 'ACCESS_BLOCKED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'CONFIG_ERROR'
  | 'NOTIFICATION_ERROR'
  | 'AUTH_ERROR'
  | 'TENANT_ERROR'
  | 'UNKNOWN'

export class AppError extends Error {
  readonly kind: ErrorKind
  /** Mag de scheduler het opnieuw proberen? */
  readonly retryable: boolean
  readonly context: Record<string, unknown>

  constructor(
    message: string,
    options: {
      kind?: ErrorKind
      retryable?: boolean
      context?: Record<string, unknown>
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.kind = options.kind ?? 'UNKNOWN'
    this.retryable = options.retryable ?? false
    this.context = options.context ?? {}
  }
}

/** De robots.txt van de bron verbiedt dit pad. Nooit retryen, nooit omzeilen. */
export class RobotsDisallowedError extends AppError {
  constructor(url: string, rule: string) {
    super(`robots.txt van ${new URL(url).host} verbiedt ${url} (regel: ${rule})`, {
      kind: 'ROBOTS_DISALLOWED',
      retryable: false,
      context: { url, rule },
    })
  }
}

/**
 * De bron blokkeert geautomatiseerde toegang (403, challenge-pagina, CAPTCHA).
 *
 * Dit is een eindstation. Er zit met opzet geen omzeiling achter: de bron gaat
 * in cooldown en, bij herhaling, uit.
 */
export class AccessBlockedError extends AppError {
  constructor(url: string, detail: string) {
    super(`${new URL(url).host} blokkeert geautomatiseerde toegang: ${detail}`, {
      kind: 'ACCESS_BLOCKED',
      retryable: false,
      context: { url, detail },
    })
  }
}

export class RateLimitedError extends AppError {
  constructor(url: string, retryAfterMs: number | null) {
    super(`${new URL(url).host} geeft rate limit terug`, {
      kind: 'RATE_LIMITED',
      retryable: true,
      context: { url, retryAfterMs },
    })
  }
}

export class SourceTimeoutError extends AppError {
  constructor(target: string, timeoutMs: number) {
    super(`Timeout na ${timeoutMs} ms bij ${target}`, {
      kind: 'TIMEOUT',
      retryable: true,
      context: { target, timeoutMs },
    })
  }
}

export class HttpError extends AppError {
  readonly status: number

  constructor(url: string, status: number, body?: string) {
    super(`HTTP ${status} van ${url}`, {
      kind: 'HTTP_ERROR',
      // 5xx en 429 zijn tijdelijk; 4xx betekent meestal dat de vraag zelf fout is.
      retryable: status >= 500 || status === 429,
      context: { url, status, body: body?.slice(0, 300) },
    })
    this.status = status
  }
}

export class ParseError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { kind: 'PARSE_ERROR', retryable: false, context })
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { kind: 'CONFIG_ERROR', retryable: false, context })
  }
}

export class NotificationError extends AppError {
  constructor(message: string, retryable: boolean, context: Record<string, unknown> = {}) {
    super(message, { kind: 'NOTIFICATION_ERROR', retryable, context })
  }
}

/** Niet ingelogd, of ingelogd zonder de vereiste rol. */
export class AuthError extends AppError {
  constructor(message = 'Niet geautoriseerd') {
    super(message, { kind: 'AUTH_ERROR', retryable: false })
  }
}

/**
 * Een gebruiker probeerde data van een ander kantoor te bereiken.
 *
 * Aparte klasse omdat dit het enige fouttype is dat altijd gelogd moet worden,
 * ook wanneer het "gewoon" een verlopen link blijkt: het is het signaal dat de
 * tenantscheiding op de proef gesteld wordt.
 */
export class TenantAccessError extends AppError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} hoort niet bij dit kantoor`, {
      kind: 'TENANT_ERROR',
      retryable: false,
      context: { entity, id },
    })
  }
}

export function errorKindOf(error: unknown): ErrorKind {
  return error instanceof AppError ? error.kind : 'UNKNOWN'
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable
  // Netwerkfouten van fetch/undici hebben geen nette klasse; behandel ze als
  // tijdelijk, want dat zijn ze meestal.
  return error instanceof TypeError && /fetch failed|network/i.test(error.message)
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : JSON.stringify(error)
}
