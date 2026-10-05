import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * De gedeelde bouwstenen van het dashboard.
 *
 * Bewust in één bestand en bewust weinig: elk extra component is een extra plek
 * waar hetzelfde net iets anders gaat werken. Wat hier staat is wat op minstens
 * drie schermen terugkomt.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Opmaak van waarden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bedragen zonder centen.
 *
 * Vastgoedprijzen zijn ronde getallen; "€ 449.000,00" suggereert een precisie
 * die een vraagprijs niet heeft, en kost breedte in elke tabel.
 */
export function formatEuro(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `€ ${value.toLocaleString('nl-BE')}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('nl-BE')
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(digits).replace('.', ',')}%`
}

// ─────────────────────────────────────────────────────────────────────────────
// Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De vier scoreklassen.
 *
 * Drempels op 85/70/55: daaronder is een kans niet dringend, en het verschil
 * tussen 41 en 48 is voor het oog nutteloos. Wie fijner wil kijken, leest het
 * getal — dat staat er altijd bij.
 */
export type ScoreTone = 'hot' | 'warm' | 'mild' | 'cool'

export function scoreTone(score: number): ScoreTone {
  if (score >= 85) return 'hot'
  if (score >= 70) return 'warm'
  if (score >= 55) return 'mild'
  return 'cool'
}

const SCORE_CLASSES: Record<ScoreTone, string> = {
  hot: 'bg-score-hot text-white',
  warm: 'bg-score-warm text-ink-950',
  mild: 'bg-score-mild text-ink-950',
  cool: 'bg-ink-300 text-ink-800',
}

const SCORE_LABELS: Record<ScoreTone, string> = {
  hot: 'Zeer hoge prioriteit',
  warm: 'Hoge prioriteit',
  mild: 'Gemiddelde prioriteit',
  cool: 'Lage prioriteit',
}

/** Het getal waar de hele lijst op sorteert. Groot, want het is de kernboodschap. */
export function ScoreBadge({
  score,
  size = 'md',
}: {
  readonly score: number
  readonly size?: 'sm' | 'md' | 'lg'
}) {
  const tone = scoreTone(score)
  const dimensions =
    size === 'lg'
      ? 'h-16 w-16 text-2xl'
      : size === 'sm'
        ? 'h-8 w-8 text-sm'
        : 'h-12 w-12 text-lg'

  return (
    <span
      className={`tnum inline-flex shrink-0 items-center justify-center rounded-xl font-semibold ${dimensions} ${SCORE_CLASSES[tone]}`}
      title={`${SCORE_LABELS[tone]} — score ${score} van 100`}
    >
      {score}
    </span>
  )
}

/** Horizontale balk voor één scoredimensie. */
export function ScoreBar({
  label,
  value,
  applied = true,
  hint,
}: {
  readonly label: string
  readonly value: number
  readonly applied?: boolean
  readonly hint?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={applied ? 'text-ink-700' : 'text-ink-500'}>
          {label}
          {!applied && <span className="ml-1 text-xs text-ink-500">(telt niet mee)</span>}
        </span>
        <span className={`tnum font-medium ${applied ? 'text-ink-900' : 'text-ink-500'}`}>
          {value}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
        <div
          className={`h-full rounded-full ${applied ? 'bg-brand-600' : 'bg-ink-400'}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-ink-600">{hint}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger'

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-200 text-ink-800',
  brand: 'bg-brand-100 text-brand-700',
  positive: 'bg-positive/12 text-positive',
  warning: 'bg-warning/15 text-ink-900',
  danger: 'bg-danger/12 text-danger',
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  readonly children: ReactNode
  readonly tone?: BadgeTone
  readonly title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Het label dat het product verkoopt.
 *
 * Krijgt bewust de accentkleur en een eigen component: "hier zit een bestaande
 * relatie" is de enige mededeling op het scherm die een makelaar zijn
 * werkvolgorde laat omgooien.
 */
export function CrmMatchBadge({
  name,
  confidence,
  confirmed,
}: {
  readonly name: string | null
  readonly confidence: number
  readonly confirmed: boolean
}) {
  return (
    <Badge
      tone="brand"
      title={`Koppelzekerheid ${Math.round(confidence * 100)}%`}
    >
      {confirmed ? 'BEKENDE RELATIE' : 'MOGELIJKE RELATIE'}
      {name && <span className="font-semibold">· {name}</span>}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <section className={`rounded-xl border border-ink-200 bg-white ${className}`}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-600">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** Losse cijfertegel voor analytics. */
export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  readonly label: string
  readonly value: string | number
  readonly hint?: string
  readonly href?: string
}) {
  const content = (
    <>
      <dt className="text-xs font-medium tracking-wide text-ink-600 uppercase">{label}</dt>
      <dd className="tnum mt-1 text-2xl font-semibold text-ink-950">{value}</dd>
      {hint && <p className="mt-1 text-xs text-ink-600">{hint}</p>}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-ink-200 bg-white px-4 py-3 transition-colors hover:border-brand-500"
      >
        {content}
      </Link>
    )
  }

  return <div className="rounded-xl border border-ink-200 bg-white px-4 py-3">{content}</div>
}

/**
 * Wat er staat als er niets is.
 *
 * Een leeg scherm hoort uit te leggen waarom het leeg is. "Geen kansen" kan
 * betekenen dat de collector niet draait, dat er geen gebied is ingesteld, of
 * dat het gewoon een rustige ochtend is — en dat verschil bepaalt of iemand
 * iets moet doen.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Knoppen
// ─────────────────────────────────────────────────────────────────────────────

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const buttonStyles = {
  primary: `${BUTTON_BASE} bg-brand-600 text-white hover:bg-brand-700`,
  secondary: `${BUTTON_BASE} border border-ink-300 bg-white text-ink-800 hover:border-ink-400 hover:bg-ink-50`,
  ghost: `${BUTTON_BASE} text-ink-700 hover:bg-ink-100`,
  danger: `${BUTTON_BASE} border border-danger/30 bg-white text-danger hover:bg-danger/8`,
} as const

export const inputStyles =
  'w-full rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none'

export const labelStyles = 'block text-xs font-medium tracking-wide text-ink-700 uppercase'
