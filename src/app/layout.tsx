import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'ImmoRadar',
    template: '%s — ImmoRadar',
  },
  description:
    'Acquisitie-intelligentie voor Belgische vastgoedkantoren: marktsignalen en bestaande klantrelaties in één lijst.',
  // Een B2B-dashboard met klantgegevens hoort niet in een zoekindex.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  return (
    <html lang="nl-BE">
      <body>{children}</body>
    </html>
  )
}
