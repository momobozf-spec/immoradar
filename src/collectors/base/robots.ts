/**
 * robots.txt: een echte poort, geen decoratie.
 *
 * ─── WAAROM DIT NIET OPTIONEEL IS ────────────────────────────────────────────
 *
 * De opdracht is expliciet: geen technische toegangscontroles omzeilen. Een
 * robots.txt is precies zo'n controle, alleen in tekstvorm. Elke uitgaande
 * request van elke collector loopt hierlangs; er is geen tweede pad naar buiten.
 *
 * Faalt het ophalen van robots.txt zelf (netwerkfout, 5xx), dan gaan we *niet*
 * door. Dat is de conservatieve kant: niet weten of iets mag is geen
 * toestemming. Alleen een expliciete 404 — de host zegt "ik heb geen regels" —
 * telt als toestemming, want dat is wat de standaard voorschrijft.
 *
 * Deze parser volgt de gangbare interpretatie: de meest specifieke
 * User-agent-groep wint, en binnen die groep het langste matchende pad, met
 * Allow boven Disallow bij gelijke lengte.
 */
import { AppError, RobotsDisallowedError } from '@/lib/errors'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ component: 'robots' })

interface Rule {
  type: 'allow' | 'disallow'
  path: string
  /** Vertaalde vorm van het pad, met * en $ als jokers. */
  matcher: RegExp
}

interface Group {
  agents: string[]
  rules: Rule[]
  crawlDelaySeconds: number | null
}

export interface RobotsRuleset {
  groups: Group[]
  sitemaps: string[]
  /** Geen robots.txt gevonden (404): alles mag. */
  permissive: boolean
}

/**
 * Vertaalt een robots-pad naar een reguliere expressie.
 *
 * `*` staat voor "wat dan ook", `$` verankert het einde. Al het andere wordt
 * letterlijk genomen — en dus geëscaped, anders zou een pad met een punt of
 * haakje erin ineens als regex-metateken gaan werken en veel te veel matchen.
 */
function pathToMatcher(path: string): RegExp {
  const anchoredAtEnd = path.endsWith('$')
  const body = anchoredAtEnd ? path.slice(0, -1) : path

  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')

  return new RegExp(`^${escaped}${anchoredAtEnd ? '$' : ''}`)
}

export function parseRobotsTxt(content: string): RobotsRuleset {
  const groups: Group[] = []
  const sitemaps: string[] = []

  let current: Group | null = null
  // Opeenvolgende User-agent-regels horen bij dezelfde groep; een andere regel
  // daarna sluit de kop af.
  let acceptingAgents = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line.length === 0) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (!acceptingAgents || current === null) {
        current = { agents: [], rules: [], crawlDelaySeconds: null }
        groups.push(current)
        acceptingAgents = true
      }
      current.agents.push(value.toLowerCase())
      continue
    }

    if (field === 'sitemap') {
      sitemaps.push(value)
      continue
    }

    if (current === null) continue
    acceptingAgents = false

    if (field === 'disallow' || field === 'allow') {
      // Een lege Disallow betekent "niets verboden" — geen regel dus.
      if (field === 'disallow' && value === '') continue
      current.rules.push({
        type: field,
        path: value,
        matcher: pathToMatcher(value === '' ? '/' : value),
      })
    } else if (field === 'crawl-delay') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelaySeconds = parsed
    }
  }

  return { groups, sitemaps, permissive: false }
}

/** De groep die voor deze user-agent geldt: exacte naam wint van `*`. */
function groupFor(ruleset: RobotsRuleset, userAgent: string): Group | null {
  const agent = userAgent.toLowerCase()

  let wildcard: Group | null = null
  let best: { group: Group; length: number } | null = null

  for (const group of ruleset.groups) {
    for (const candidate of group.agents) {
      if (candidate === '*') {
        wildcard ??= group
        continue
      }
      // De standaard matcht op substring: "ImmoRadarBot/0.1" hoort bij een groep
      // die "immoradarbot" noemt.
      if (agent.includes(candidate) && (best === null || candidate.length > best.length)) {
        best = { group, length: candidate.length }
      }
    }
  }

  return best?.group ?? wildcard
}

export interface RobotsDecision {
  allowed: boolean
  /** De regel die de doorslag gaf, voor de logregel en de foutmelding. */
  rule: string
  crawlDelaySeconds: number
}

export function evaluate(
  ruleset: RobotsRuleset,
  pathname: string,
  userAgent: string,
): RobotsDecision {
  if (ruleset.permissive) {
    return { allowed: true, rule: 'geen robots.txt', crawlDelaySeconds: 0 }
  }

  const group = groupFor(ruleset, userAgent)
  if (!group) return { allowed: true, rule: 'geen toepasselijke groep', crawlDelaySeconds: 0 }

  // Langste match wint; bij gelijke lengte wint Allow. Dat is de gangbare
  // interpretatie en de enige die niet willekeurig is.
  let winner: Rule | null = null
  for (const rule of group.rules) {
    if (!rule.matcher.test(pathname)) continue
    if (
      winner === null ||
      rule.path.length > winner.path.length ||
      (rule.path.length === winner.path.length && rule.type === 'allow')
    ) {
      winner = rule
    }
  }

  return {
    allowed: winner === null || winner.type === 'allow',
    rule: winner === null ? 'geen matchende regel' : `${winner.type}: ${winner.path}`,
    crawlDelaySeconds: group.crawlDelaySeconds ?? 0,
  }
}

interface CacheEntry {
  ruleset: RobotsRuleset
  fetchedAtMs: number
}

const CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Haalt robots.txt op, cachet per host, en beslist per URL.
 *
 * De cache is een uur geldig. Korter zou betekenen dat een collector die elke
 * twee minuten draait de robots.txt vaker ophaalt dan de pagina's waarvoor hij
 * komt; langer zou een net ingevoerd verbod te lang negeren.
 */
export class RobotsPolicy {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  private async load(origin: string): Promise<RobotsRuleset> {
    const cached = this.cache.get(origin)
    if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
      return cached.ruleset
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'user-agent': this.userAgent, accept: 'text/plain' },
        signal: controller.signal,
        redirect: 'follow',
      })

      let ruleset: RobotsRuleset
      if (response.status === 404 || response.status === 410) {
        // De host zegt: ik heb geen regels. Dat is toestemming.
        ruleset = { groups: [], sitemaps: [], permissive: true }
      } else if (!response.ok) {
        // 401/403 op robots.txt betekent dat de host geautomatiseerde toegang
        // afschermt. 5xx betekent dat we het niet weten. In beide gevallen:
        // niet doorgaan.
        throw new AppError(`robots.txt van ${origin} gaf HTTP ${response.status}`, {
          kind: response.status >= 500 ? 'HTTP_ERROR' : 'ACCESS_BLOCKED',
          retryable: response.status >= 500,
          context: { origin, status: response.status },
        })
      } else {
        ruleset = parseRobotsTxt(await response.text())
      }

      this.cache.set(origin, { ruleset, fetchedAtMs: Date.now() })
      return ruleset
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(`robots.txt van ${origin} kon niet opgehaald worden`, {
        kind: 'ACCESS_BLOCKED',
        retryable: true,
        context: { origin },
        cause: error,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Gooit `RobotsDisallowedError` wanneer de URL verboden is. Geeft anders de
   * `Crawl-delay` terug zodat de rate limiter zich eraan kan houden.
   */
  async assertAllowed(url: string): Promise<{ crawlDelaySeconds: number }> {
    const parsed = new URL(url)
    const ruleset = await this.load(parsed.origin)
    const decision = evaluate(ruleset, `${parsed.pathname}${parsed.search}`, this.userAgent)

    if (!decision.allowed) {
      logger.warn('robots.txt verbiedt deze URL', { url, rule: decision.rule })
      throw new RobotsDisallowedError(url, decision.rule)
    }

    return { crawlDelaySeconds: decision.crawlDelaySeconds }
  }

  /** Sitemaps die robots.txt aanwijst — het nette startpunt voor een crawler. */
  async sitemapsFor(origin: string): Promise<string[]> {
    return (await this.load(origin)).sitemaps
  }

  clearCache(): void {
    this.cache.clear()
  }
}
