/**
 * Een eenvoudige rate limiter in het geheugen van het proces.
 *
 * ─── WAT DIT WEL EN NIET IS ──────────────────────────────────────────────────
 *
 * De echte bescherming tegen het raden van wachtwoorden is de vergrendeling per
 * account in de database (`src/services/userService.ts`): die geldt over alle
 * processen en herstarts heen. Dit is de tweede laag, tegen één IP-adres dat
 * dúízenden verschillende accounts probeert ("password spraying") — iets wat de
 * vergrendeling per account niet ziet, omdat elk account maar één poging krijgt.
 *
 * In het geheugen is goed genoeg voor één webproces. Draaien er meerdere
 * replica's, dan deelt elk zijn eigen teller; de limiet is dan in de praktijk
 * `limiet × replica's`. Dat blijft ruim onder wat een spraying-aanval nodig
 * heeft, en het bespaart een Redis voor een product dat er verder geen nodig
 * heeft.
 */

interface Window {
  count: number
  resetAt: number
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Bovengrens op het aantal sleutels, tegen geheugengroei bij een aanval met wisselende IP's. */
    private readonly maxKeys = 10_000,
  ) {}

  /** Telt een poging en zegt of ze binnen de limiet valt. */
  hit(key: string, now = Date.now()): boolean {
    const current = this.windows.get(key)

    if (!current || current.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.prune(now)
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }

    current.count += 1
    return current.count <= this.limit
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key)
    }
    // Nog steeds vol: de oudste sleutels eruit. Een Map itereert in
    // invoegvolgorde, dus dat zijn de eerste.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value
      if (oldest === undefined) break
      this.windows.delete(oldest)
    }
  }
}
