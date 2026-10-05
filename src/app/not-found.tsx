import Link from 'next/link'

export const metadata = { title: 'Niet gevonden' }

/**
 * Ook wat een kans van een ander kantoor oplevert: een 404, geen 403. Dat
 * laatste zou bevestigen dat er een kans met dat id bestaat.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 text-center text-sm">
        <p className="text-base font-semibold text-ink-950">Deze pagina bestaat niet</p>
        <p className="mt-2 text-ink-700">
          Of ze bestaat niet meer, of ze hoort niet bij jouw kantoor.
        </p>
        <Link href="/" className="mt-4 inline-block text-brand-700 hover:underline">
          Naar het overzicht
        </Link>
      </div>
    </main>
  )
}
