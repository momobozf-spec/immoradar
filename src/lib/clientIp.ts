/**
 * Het IP-adres van de bezoeker uit `X-Forwarded-For`.
 *
 * Een proxy vóór de app voegt het adres dat hém aansprak rechts toe. Alles
 * links daarvan stuurde de bezoeker zelf mee en is dus te vervalsen. Daarom
 * tellen we `hops` adressen van rechts: het aantal proxies dat we vertrouwen.
 * Hoeveel dat er zijn hangt van het platform af (Caddy: 1; Render: meten via
 * Beheer → Systeem → Proxy-diagnose).
 */
export function forwardedChain(header: string | null): string[] {
  return (header ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function pickClientIp(header: string | null, hops: number): string {
  if (hops === 0) return 'direct'
  const chain = forwardedChain(header)
  return chain[chain.length - hops] ?? 'unknown'
}
