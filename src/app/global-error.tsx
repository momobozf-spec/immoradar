'use client'

/**
 * Laatste vangnet: een fout in de root-layout zelf. Dan is er geen layout en
 * geen stylesheet meer, dus alles staat hier inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  return (
    <html lang="nl-BE">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.125rem' }}>ImmoRadar is tijdelijk niet beschikbaar</h1>
        <p style={{ color: '#555' }}>Probeer het over enkele ogenblikken opnieuw.</p>
        {error.digest && (
          <p>
            <code>{error.digest}</code>
          </p>
        )}
        <button type="button" onClick={reset} style={{ marginTop: '1rem', padding: '0.4rem 0.8rem' }}>
          Opnieuw proberen
        </button>
      </body>
    </html>
  )
}
