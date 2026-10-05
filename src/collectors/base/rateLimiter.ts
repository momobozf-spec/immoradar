/**
 * Rate limiting per host.
 *
 * Een token bucket, niet een simpele teller per minuut. Het verschil telt: met
 * een teller mag je twintig requests in de eerste seconde doen en dan 59
 * seconden niets, wat vanaf de kant van de bron eruitziet als een aanval. Een
 * bucket spreidt ze uit.
 *
 * `Crawl-delay` uit robots.txt kan de limiet verder verlagen, nooit verhogen —
 * de bron mag strenger zijn dan wij, niet losser.
 */

interface Bucket {
  tokens: number
  lastRefillMs: number
  capacity: number
  refillPerMs: number
  /** Minimale tijd tussen twee requests, uit Crawl-delay. */
  minIntervalMs: number
  lastRequestMs: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  /** @param defaultPerMinute Bovengrens voor hosts zonder eigen instelling. */
  constructor(private readonly defaultPerMinute: number) {}

  /** Stelt de limiet voor één host in. Lager dan de default mag; hoger niet. */
  configure(host: string, requestsPerMinute: number, crawlDelaySeconds = 0): void {
    const effective = Math.max(1, Math.min(requestsPerMinute, this.defaultPerMinute))
    const bucket = this.bucketFor(host)

    bucket.capacity = effective
    bucket.refillPerMs = effective / 60_000
    bucket.tokens = Math.min(bucket.tokens, effective)
    bucket.minIntervalMs = Math.max(bucket.minIntervalMs, crawlDelaySeconds * 1000)
  }

  private bucketFor(host: string): Bucket {
    let bucket = this.buckets.get(host)
    if (!bucket) {
      bucket = {
        tokens: this.defaultPerMinute,
        lastRefillMs: Date.now(),
        capacity: this.defaultPerMinute,
        refillPerMs: this.defaultPerMinute / 60_000,
        minIntervalMs: 0,
        lastRequestMs: 0,
      }
      this.buckets.set(host, bucket)
    }
    return bucket
  }

  /** Hoeveel milliseconden er nog gewacht moet worden voor deze host. */
  private delayFor(bucket: Bucket, now: number): number {
    const elapsed = now - bucket.lastRefillMs
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs)
    bucket.lastRefillMs = now

    const spacingDelay = Math.max(0, bucket.lastRequestMs + bucket.minIntervalMs - now)
    const tokenDelay = bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) / bucket.refillPerMs)

    return Math.max(spacingDelay, tokenDelay)
  }

  /**
   * Wacht tot deze host weer een request mag krijgen.
   *
   * @param signal Breekt het wachten af wanneer de collector-timeout verloopt,
   *   zodat een strak gelimiteerde host niet de hele worker vasthoudt.
   */
  async acquire(host: string, signal?: AbortSignal): Promise<void> {
    const bucket = this.bucketFor(host)

    for (;;) {
      if (signal?.aborted) throw new Error('Wachten op rate limit afgebroken')

      const now = Date.now()
      const delay = this.delayFor(bucket, now)

      if (delay <= 0) {
        bucket.tokens -= 1
        bucket.lastRequestMs = now
        return
      }

      await sleep(Math.min(delay, 1000), signal)
    }
  }

  /** Alleen voor tests. */
  reset(): void {
    this.buckets.clear()
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Afgebroken'))
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort(): void {
      clearTimeout(timer)
      reject(new Error('Afgebroken'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
