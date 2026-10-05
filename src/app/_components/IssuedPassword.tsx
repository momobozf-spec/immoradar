'use client'

import { useState } from 'react'

import { buttonStyles } from './primitives'

/**
 * Een tijdelijk wachtwoord, één keer getoond.
 *
 * Het staat nergens anders: niet in de database (alleen de hash), niet in een
 * log, niet in een mail. Wie dit scherm sluit zonder het door te geven, maakt
 * gewoon een nieuw aan. De ontvanger moet het bij de eerste login vervangen.
 */
export function IssuedPassword({
  email,
  temporaryPassword,
}: {
  readonly email: string
  readonly temporaryPassword: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(temporaryPassword)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-lg border border-brand-500/40 bg-brand-100/40 p-4 text-sm" role="status">
      <p className="font-medium text-ink-900">Tijdelijk wachtwoord voor {email}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-ink-300 bg-white px-3 py-1.5 font-mono text-base tracking-wider text-ink-950 select-all">
          {temporaryPassword}
        </code>
        <button type="button" onClick={copy} className={buttonStyles.secondary}>
          {copied ? 'Gekopieerd' : 'Kopiëren'}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-700">
        Dit wordt maar één keer getoond. Geef het persoonlijk of telefonisch door, niet in
        dezelfde mail als het e-mailadres. Bij de eerste login moet het vervangen worden.
      </p>
    </div>
  )
}
