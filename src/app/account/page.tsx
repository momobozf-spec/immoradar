import Link from 'next/link'

import { PASSWORD_MIN_LENGTH } from '@/domain/accountPolicy'
import { ROLE_LABELS, requireSession } from '@/lib/session'

import { logout } from '../_actions/auth'
import { Card, CardHeader, PageHeader } from '../_components/primitives'

import { ChangePasswordForm, SignOutEverywhereForm } from './AccountForms'

export const metadata = { title: 'Mijn account' }

/**
 * De eigen account.
 *
 * Bewust buiten de kantoor- en beheerschil: dit is de ene pagina die een
 * gebruiker met een tijdelijk wachtwoord mag openen, en die moet werken voor
 * een makelaar én een platformbeheerder — ook als het abonnement van het kantoor
 * gepauzeerd is.
 */
export default async function AccountPage() {
  const session = await requireSession({ allowPendingPasswordChange: true })
  const home = session.role === 'PLATFORM_ADMIN' ? '/admin/sources' : '/'

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link href={home} className="text-base font-semibold tracking-tight text-ink-950">
          Immo<span className="text-brand-600">Radar</span>
        </Link>
        <form action={logout}>
          <button type="submit" className="text-sm text-ink-600 hover:text-ink-900">
            Uitloggen
          </button>
        </form>
      </div>

      <PageHeader title="Mijn account" />

      {session.mustChangePassword && (
        <div
          className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink-900"
          role="alert"
        >
          Je bent ingelogd met een tijdelijk wachtwoord. Kies eerst een eigen wachtwoord; daarna
          kom je in het dashboard.
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader title="Gegevens" />
          <dl className="grid grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-600 uppercase">Naam</dt>
              <dd className="mt-1 text-ink-900">{session.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-600 uppercase">E-mail</dt>
              <dd className="mt-1 text-ink-900">{session.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-600 uppercase">Rol</dt>
              <dd className="mt-1 text-ink-900">{ROLE_LABELS[session.role]}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-600 uppercase">Kantoor</dt>
              <dd className="mt-1 text-ink-900">{session.agencyName ?? 'Platformbeheer'}</dd>
            </div>
          </dl>
          <p className="border-t border-ink-200 px-5 py-3 text-xs text-ink-600">
            Naam of e-mailadres aanpassen doet je kantoorbeheerder.
          </p>
        </Card>

        <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />

        {!session.mustChangePassword && <SignOutEverywhereForm />}

        {!session.mustChangePassword && (
          <p className="text-sm">
            <Link href={home} className="text-brand-700 hover:underline">
              ← Terug naar het dashboard
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
