import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSession, ROLE_LABELS } from '@/lib/session'

import { Nav } from './Nav'
import { logout } from '../_actions/auth'

/**
 * De schil om alles wat achter de inlog zit.
 *
 * Hier valt de eerste en belangrijkste controle: geen sessie, geen pagina. Elke
 * onderliggende route herhaalt die controle op zijn eigen manier — met
 * `requireAgencyScope`, dat óók de kantoorgrens afdwingt — maar deze laag zorgt
 * dat een niet-ingelogde bezoeker nooit verder komt dan de loginpagina, ook niet
 * als een route dat ooit zou vergeten.
 *
 * Twee doorverwijzingen komen erbij: een tijdelijk wachtwoord moet eerst
 * vervangen worden (/account), en een kantoor zonder lopend abonnement krijgt
 * een uitleg in plaats van zijn data (/inactief).
 */
export default async function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Een platformbeheerder hoort bij geen kantoor en heeft in de kantoorschermen
  // niets te zoeken; hij wordt naar zijn eigen omgeving gestuurd.
  if (!session.agencyId) redirect('/admin/sources')

  if (session.mustChangePassword) redirect('/account')
  if (!session.agencyServed) redirect('/inactief')

  return (
    <div className="min-h-screen">
      <Nav
        agencyName={session.agencyName ?? ''}
        userName={session.name ?? session.email}
        roleLabel={ROLE_LABELS[session.role]}
        canManage={session.role !== 'AGENT'}
        logoutAction={logout}
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-600 sm:px-6 lg:px-8">
        <Link href="/privacy" className="hover:text-ink-900 hover:underline">
          Privacy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/voorwaarden" className="hover:text-ink-900 hover:underline">
          Voorwaarden
        </Link>
      </footer>
    </div>
  )
}
