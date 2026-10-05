'use client'

import { useEffect } from 'react'

/**
 * Een onverwachte fout in een pagina.
 *
 * De gebruiker krijgt geen stacktrace en geen databasemelding, wel een
 * referentie (`digest`) die in de serverlog terug te vinden is. Daar staat de
 * echte fout, met context.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 text-center text-sm">
        <p className="text-base font-semibold text-ink-950">Er ging iets mis</p>
        <p className="mt-2 text-ink-700">
          Probeer het opnieuw. Blijft het misgaan, geef dan deze referentie door aan je beheerder.
        </p>
        {error.digest && (
          <p className="mt-3">
            <code className="rounded bg-ink-100 px-2 py-1 font-mono text-xs text-ink-800">
              {error.digest}
            </code>
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          Opnieuw proberen
        </button>
      </div>
    </main>
  )
}
