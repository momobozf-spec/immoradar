/**
 * De enige weg naar buiten.
 *
 * Elke uitgaande request van elke collector loopt hierlangs, en krijgt daarmee
 * automatisch: robots.txt-controle, rate limiting per host, een timeout,
 * begrensde retries met exponentiële backoff, een identificeerbare User-Agent en
 * een logregel. Een collector die zelf `fetch` aanroept omzeilt dat allemaal —
 * vandaar dat de collector-interface geen `fetch` doorgeeft maar deze client.
 *
 * ─── WAT HIER MET OPZET NIET IN ZIT ──────────────────────────────────────────
 *
 * Geen proxy-rotatie, geen browser-fingerprint-spoofing, geen CAPTCHA-oplossers,
 * geen stealth-plugins, geen negeren van 403's. Krijgt een collector een
 * blokkade, dan is dat een antwoord: de bron gaat in cooldown en, bij herhaling,
 * uit. Dat is de hele omgang met toegangscontroles in dit systeem.
 */
import {
  AccessBlockedError,
  HttpError,
  RateLimitedError,
  SourceTimeoutError,
  isRetryable,
} from '@/lib/errors'
import { createLogger, type Logger } from '@/lib/logger'

import { RateLimiter, sleep } from './rateLimiter'
import { RobotsPolicy } from './robots'

export interface HttpClientOptions {
  userAgent: string
  maxRequestsPerMinute: number
  timeoutMs: number
  maxRetries: number
  fetchImpl?: typeof fetch
  logger?: Logger
}

export interface RequestOptions {
  /** Overschrijft de timeout van de client voor deze ene request. */
  timeoutMs?: number
  headers?: Record<string, string>
  /** Breekt de request af wanneer de collector als geheel wordt afgekapt. */
  signal?: AbortSignal
}

export interface HttpResponse {
  url: string
  status: number
  body: string
  contentType: string
}

/**
 * Pagina's die technisch een 200 geven maar inhoudelijk een blokkade zijn.
 *
 * Dit is geen omzeiling — integendeel. Zonder deze herkenning zou een collector
 * de challenge-pagina als "de advertentiepagina" parsen, nul resultaten
 * rapporteren en groen blijven, terwijl de bron ons in werkelijkheid weigert.
 * We willen dat juist zien.
 */
const CHALLENGE_MARKERS = [
  'captcha',
  'are you a robot',
  'bent u een robot',
  'access denied',
  'toegang geweigerd',
  'cf-browser-verification',
  'checking your browser',
  'ddos protection by',
  '__cf_chl',
]

function looksLikeChallenge(body: string, contentType: string): boolean {
  if (!contentType.includes('html')) return false
  const head = body.slice(0, 4000).toLowerCase()
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker))
}

export class HttpClient {
  private readonly robots: RobotsPolicy
  private readonly limiter: RateLimiter
  private readonly fetchImpl: typeof fetch
  private readonly log: Logger

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.robots = new RobotsPolicy(options.userAgent, this.fetchImpl)
    this.limiter = new RateLimiter(options.maxRequestsPerMinute)
    this.log = options.logger ?? createLogger({ component: 'http' })
  }

  /** Stelt de limiet voor één host in, binnen de globale bovengrens. */
  configureHost(host: string, requestsPerMinute: number): void {
    this.limiter.configure(host, requestsPerMinute)
  }

  /**
   * Haalt een URL op. Gooit bij elke niet-succesvolle uitkomst een `AppError`
   * met een `kind` waaruit de scheduler kan afleiden of retryen zin heeft.
   */
  async get(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AccessBlockedError(url, `protocol ${parsed.protocol} wordt niet opgehaald`)
    }

    // 1. Mag het? Dit staat vóór de rate limiter, zodat een verboden URL geen
    //    plek in de wachtrij van een host inneemt.
    const { crawlDelaySeconds } = await this.robots.assertAllowed(url)
    if (crawlDelaySeconds > 0) {
      this.limiter.configure(parsed.host, this.options.maxRequestsPerMinute, crawlDelaySeconds)
    }

    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs
    let lastError: unknown = null

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      if (attempt > 0) {
        // Exponentiële backoff met jitter. De jitter is geen detail: zonder hem
        // lopen alle collectors van dezelfde host na een storing exact gelijk op
        // en slaan ze de bron een tweede keer plat.
        const backoffMs = Math.min(30_000, 500 * 2 ** (attempt - 1))
        const jitterMs = Math.floor(Math.random() * 250)
        await sleep(backoffMs + jitterMs, options.signal)
      }

      try {
        await this.limiter.acquire(parsed.host, options.signal)
        return await this.attempt(url, timeoutMs, options)
      } catch (error) {
        lastError = error
        if (!isRetryable(error)) throw error

        this.log.warn('Request mislukt, opnieuw proberen', {
          url,
          attempt: attempt + 1,
          maxRetries: this.options.maxRetries,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new HttpError(url, 0, 'Onbekende fout na alle pogingen')
  }

  private async attempt(
    url: string,
    timeoutMs: number,
    options: RequestOptions,
  ): Promise<HttpResponse> {
    const controller = new AbortController()
    const onOuterAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', onOuterAbort, { once: true })

    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          'user-agent': this.options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'nl-BE,nl;q=0.9,fr-BE;q=0.8,en;q=0.7',
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      })

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'))
        throw new RateLimitedError(url, Number.isFinite(retryAfter) ? retryAfter * 1000 : null)
      }
      if (response.status === 401 || response.status === 403) {
        // Een loginwall of een botblokkade. Beide betekenen: deze bron is via
        // deze weg niet toegankelijk, en dat accepteren we.
        throw new AccessBlockedError(url, `HTTP ${response.status}`)
      }
      if (!response.ok) {
        throw new HttpError(url, response.status, await safeText(response))
      }

      const contentType = response.headers.get('content-type') ?? ''
      const body = await response.text()

      if (looksLikeChallenge(body, contentType)) {
        throw new AccessBlockedError(url, 'antwoord is een bot-challenge, geen inhoud')
      }

      this.log.debug('Request geslaagd', {
        url,
        status: response.status,
        durationMs: Date.now() - startedAt,
        bytes: body.length,
      })

      return { url: response.url || url, status: response.status, body, contentType }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SourceTimeoutError(url, timeoutMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.get(url, {
      ...options,
      headers: { accept: 'application/json', ...options.headers },
    })
    return JSON.parse(response.body) as T
  }

  sitemapsFor(origin: string): Promise<string[]> {
    return this.robots.sitemapsFor(origin)
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}
