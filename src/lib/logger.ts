/**
 * Gestructureerde logging: één JSON-object per regel, zodat een logdrain erop
 * kan filteren zonder reguliere expressies.
 *
 * Redaction zit hier, niet op de call-sites. Een `logger.info('kans', { seller })`
 * ergens diep in de pijplijn mag geen telefoonnummer laten weglekken omdat de
 * schrijver van die regel er niet aan dacht.
 */
import { getEnv } from './env'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/**
 * Sleutels waarvan de waarde nooit in een logregel hoort. De telefoonvelden
 * zitten erbij: een logbestand is de makkelijkste plek om per ongeluk duizenden
 * persoonsgegevens te verzamelen die er niet horen te staan.
 */
const REDACTED_KEYS = new Set([
  'token',
  'apikey',
  'api_key',
  'authorization',
  'password',
  'passwordhash',
  'secret',
  'sessionsecret',
  'cookie',
  'telegrambottoken',
  'phone',
  'phonee164',
  'sellerphone',
  'chatid',
  'telegramchatid',
  'email',
  'contactemail',
])

const MAX_STRING_LENGTH = 500
const MAX_DEPTH = 5

export type LogContext = Record<string, unknown>

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > MAX_DEPTH) return '[diep genest]'

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(inner, depth + 1)
    }
    return out
  }
  return String(value)
}

function currentLevel(): LogLevel {
  try {
    return getEnv().LOG_LEVEL
  } catch {
    // De logger moet ook bruikbaar zijn wanneer juist de env-validatie faalt —
    // dat is nu precies het moment waarop je een logregel wilt zien.
    return 'info'
  }
}

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  child(bindings: LogContext): Logger
}

function write(level: LogLevel, bindings: LogContext, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return

  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(redact({ ...bindings, ...context }) as Record<string, unknown>),
  }

  const line = JSON.stringify(record)
  if (level === 'error') process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

function build(bindings: LogContext): Logger {
  return {
    debug: (message, context) => write('debug', bindings, message, context),
    info: (message, context) => write('info', bindings, message, context),
    warn: (message, context) => write('warn', bindings, message, context),
    error: (message, context) => write('error', bindings, message, context),
    child: (extra) => build({ ...bindings, ...extra }),
  }
}

export const logger: Logger = build({})

export function createLogger(bindings: LogContext): Logger {
  return build(bindings)
}
