import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'

import { logout } from '../_actions/auth'

/**
 * De platformbeheer-omgeving.
 *
 * ─── WAAROM DIT EEN EIGEN SCHIL HEEFT ────────────────────────────────────────
 *
 * Een platformbeheerder hoort bij geen enkel kantoor. Zou hij het gewone
 * dashboard delen, dan moet elke pagina daar overweg met een ontbrekend
 * `agencyId` — en dan is de kantoorgrens niet meer "altijd aanwezig" maar
 * "meestal aanwezig". Precies dat soort uitzonderingen maakt tenantscheiding
 * lek.
 *
 * Beheer heeft daarom eigen routes met een eigen controle, en ziet uitsluitend
 * infrastructuur: bronnen, collectorruns, kantoren als rij in een tabel. Geen
 * enkel scherm hier toont de contacten of kansen van een kantoor.
 */

const ADMIN_NAV = [
  { href: '/admin/sources', label: 'Bronnen' },
  { href: '/admin/agencies', label: 'Kantoren' },
  { href: '/admin/health', label: 'Systeem' },
] as const

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'PLATFORM_ADMIN') redirect('/')
  if (session.mustChangePassword) redirect('/account')

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-ink-950">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/admin/sources" className="text-base font-semibold tracking-tight text-white">
            Immo<span className="text-brand-500">Radar</span>{' '}
            <span className="text-sm font-normal text-ink-400">beheer</span>
          </Link>

          <nav aria-label="Beheernavigatie" className="flex-1">
            <ul className="flex items-center gap-1">
              {ADMIN_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-3 py-1.5 text-sm text-ink-300 transition-colors hover:bg-ink-900 hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Link href="/account" className="text-sm text-ink-400 hover:text-white">
            Mijn account
          </Link>
          <form action={logout}>
            <button type="submit" className="text-sm text-ink-400 hover:text-white">
              Uitloggen
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
