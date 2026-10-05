import Link from 'next/link'

/** De schil voor pagina's die zonder inlog leesbaar zijn: privacy, voorwaarden. */
export function PublicShell({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-base font-semibold tracking-tight text-ink-950">
        Immo<span className="text-brand-600">Radar</span>
      </Link>

      <article className="legal mt-8 rounded-xl border border-ink-200 bg-white p-6 text-sm leading-relaxed text-ink-800 sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold text-ink-950">{title}</h1>
        {children}
      </article>

      <p className="mt-6 text-xs text-ink-600">
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/voorwaarden" className="hover:underline">
          Voorwaarden
        </Link>
        <span className="mx-2">·</span>
        <Link href="/login" className="hover:underline">
          Inloggen
        </Link>
      </p>
    </main>
  )
}

export function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="mt-6 space-y-2">
      <h2 className="text-base font-semibold text-ink-950">{title}</h2>
      {children}
    </section>
  )
}

/** Naam, ondernemingsnummer en adres van de uitbater, voor zover ingevuld. */
export function LegalIdentity({
  name,
  vat,
  address,
  email,
}: {
  readonly name: string
  readonly vat: string
  readonly address: string
  readonly email: string
}) {
  return (
    <p>
      {name || 'De uitbater van ImmoRadar'}
      {vat && <>, ondernemingsnummer {vat}</>}
      {address && <>, {address}</>}
      {email && (
        <>
          {' '}
          — <a href={`mailto:${email}`} className="text-brand-700 underline">{email}</a>
        </>
      )}
      .
    </p>
  )
}
