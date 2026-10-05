import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getEnv } from '@/lib/env'
import { getSession } from '@/lib/session'

import { logout } from '../_actions/auth'

export const metadata = { title: 'Abonnement niet actief' }

/**
 * Waar een gebruiker belandt wanneer zijn kantoor niet (meer) bediend wordt:
 * gedeactiveerd, abonnement gepauzeerd of opgezegd, of einddatum verstreken.
 *
 * Geen foutpagina en geen lege lijst — een makelaar die maandagochtend inlogt
 * hoort te lezen wát er aan de hand is en bij wie hij terecht kan.
 */
export default async function InactivePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.agencyServed) redirect(session.role === 'PLATFORM_ADMIN' ? '/admin/sources' : '/')

  const contact = getEnv().LEGAL_CONTACT_EMAIL

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 text-sm">
        <p className="text-base font-semibold text-ink-950">Het abonnement van {session.agencyName} is niet actief</p>
        <p className="mt-2 text-ink-700">
          De toegang tot ImmoRadar is gepauzeerd. Er gaan geen meldingen meer uit en er worden geen
          nieuwe kansen aangemaakt. Je gegevens blijven bewaard.
        </p>
        <p className="mt-2 text-ink-700">
          {session.role === 'AGENCY_ADMIN'
            ? 'Neem contact op om het abonnement te heractiveren'
            : 'Vraag je kantoorbeheerder om het abonnement te heractiveren'}
          {contact && (
            <>
              {' '}
              via{' '}
              <a href={`mailto:${contact}`} className="text-brand-700 underline">
                {contact}
              </a>
            </>
          )}
          .
        </p>

        <div className="mt-6 flex items-center justify-between">
          <Link href="/account" className="text-brand-700 hover:underline">
            Mijn account
          </Link>
          <form action={logout}>
            <button type="submit" className="text-ink-600 hover:text-ink-900">
              Uitloggen
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
