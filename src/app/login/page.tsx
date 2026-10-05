import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'

import { LoginForm } from './LoginForm'

export const metadata = { title: 'Inloggen' }

/**
 * De enige pagina buiten de sessiemuur.
 *
 * Wie al ingelogd is hoort hier niet te blijven staan: een ingelogde gebruiker
 * die op /login belandt heeft een oude tab of een bladwijzer, en hoort gewoon
 * zijn lijst te zien.
 */
export default async function LoginPage() {
  const session = await getSession()
  if (session) {
    if (session.mustChangePassword) redirect('/account')
    redirect(session.role === 'PLATFORM_ADMIN' ? '/admin/sources' : '/')
  }

  const isDemo = process.env.NODE_ENV !== 'production'

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xl font-semibold tracking-tight text-ink-950">
            Immo<span className="text-brand-600">Radar</span>
          </p>
          <p className="mt-1 text-sm text-ink-600">
            Acquisitie-intelligentie voor vastgoedkantoren
          </p>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-6">
          <LoginForm />
        </div>

        {isDemo && (
          <div className="mt-6 rounded-lg border border-ink-200 bg-white/60 p-4 text-xs text-ink-600">
            <p className="font-medium text-ink-800">Demo-accounts</p>
            <ul className="mt-2 space-y-1">
              <li>
                <code className="text-ink-800">thomas@immo-example-gent.be</code> — kantoorbeheerder
              </li>
              <li>
                <code className="text-ink-800">sofie@immo-example-gent.be</code> — makelaar
              </li>
              <li>
                <code className="text-ink-800">admin@immoradar.be</code> — platformbeheerder
              </li>
            </ul>
            <p className="mt-2">
              Wachtwoord: <code className="text-ink-800">immoradar</code>
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ink-600">
          <Link href="/privacy" className="hover:text-ink-900 hover:underline">
            Privacy
          </Link>
          <span className="mx-2">·</span>
          <Link href="/voorwaarden" className="hover:text-ink-900 hover:underline">
            Voorwaarden
          </Link>
        </p>
      </div>
    </main>
  )
}
