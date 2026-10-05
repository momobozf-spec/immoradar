'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * De navigatie.
 *
 * ─── DE VOLGORDE IS HET PRODUCT ──────────────────────────────────────────────
 *
 * "Vandaag" staat vooraan en is de startpagina. Daarna LeadRevive, dan de
 * markt, dan de opvolging, dan alles wat je één keer per maand instelt. Zou
 * Analytics vooraan staan, dan zou het product zeggen dat het over rapportage
 * gaat — en dan verliest de makelaar elke ochtend twee klikken aan het scherm
 * waar hij daadwerkelijk voor komt.
 */

interface NavItem {
  href: string
  label: string
  /** Alleen zichtbaar voor kantoorbeheerders. */
  manageOnly?: boolean
}

const PRIMARY: readonly NavItem[] = [
  { href: '/', label: 'Vandaag' },
  { href: '/leadrevive', label: 'LeadRevive' },
  { href: '/market', label: 'Marktradar' },
  { href: '/properties', label: 'Panden' },
  { href: '/pipeline', label: 'Opvolging' },
  { href: '/analytics', label: 'Analyse' },
]

const SECONDARY: readonly NavItem[] = [
  { href: '/imports', label: 'Imports' },
  { href: '/territories', label: 'Gebieden', manageOnly: true },
  { href: '/alerts', label: 'Meldingen', manageOnly: true },
  { href: '/team', label: 'Team', manageOnly: true },
  { href: '/settings', label: 'Instellingen', manageOnly: true },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Nav({
  agencyName,
  userName,
  roleLabel,
  canManage,
  logoutAction,
}: {
  readonly agencyName: string
  readonly userName: string
  readonly roleLabel: string
  readonly canManage: boolean
  readonly logoutAction: () => Promise<void>
}) {
  const pathname = usePathname()

  const items = [...PRIMARY, ...SECONDARY.filter((item) => canManage || !item.manageOnly)]

  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 text-base font-semibold tracking-tight text-ink-950">
          Immo<span className="text-brand-600">Radar</span>
        </Link>

        <nav aria-label="Hoofdnavigatie" className="min-w-0 flex-1 overflow-x-auto">
          <ul className="flex items-center gap-1">
            {items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-brand-100 font-medium text-brand-700'
                        : 'text-ink-700 hover:bg-ink-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/account"
            className="hidden rounded-md px-2 py-1 text-right hover:bg-ink-100 sm:block"
            title="Mijn account"
          >
            <p className="text-sm leading-tight font-medium text-ink-900">{userName}</p>
            <p className="text-xs leading-tight text-ink-600">
              {agencyName} · {roleLabel}
            </p>
          </Link>
          <Link
            href="/account"
            className="rounded-md px-2 py-1 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900 sm:hidden"
          >
            Account
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            >
              Uitloggen
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
