import type { ListingEvent } from '@/generated/prisma/client'

import { formatDate } from '@/lib/dates'

import { formatEuro } from '../../_components/primitives'

/**
 * De levensloop van één pand, over alle advertenties heen.
 *
 * ─── WAAROM DIT HET KENMERKENDE SCHERM IS ────────────────────────────────────
 *
 * Iedereen kan tonen wat een woning vandaag kost. Alleen wie de geschiedenis
 * bewaart kan tonen dat ze in januari voor 510.000 begon, twee keer zakte, in
 * maart werd ingetrokken en in april voor 465.000 terugkwam. Dat verhaal is het
 * verkoopargument van de makelaar: hij belt niet met "ik zag uw woning", maar
 * met "u probeert het nu acht maanden en bent al 45.000 gezakt".
 *
 * Daarom hangt de tijdlijn aan het *pand* en niet aan de advertentie. Hing hij
 * aan de advertentie, dan begon het verhaal bij elke herplaatsing opnieuw — en
 * precies dan is het op zijn interessantst.
 */

const EVENT_LABELS: Record<string, string> = {
  NEW_LISTING: 'Advertentie gedetecteerd',
  FSBO_DETECTED: 'Particuliere verkoper herkend',
  PRICE_DROP: 'Prijs verlaagd',
  PRICE_INCREASE: 'Prijs verhoogd',
  STALE_30: '30 dagen online',
  STALE_60: '60 dagen online',
  STALE_90: '90 dagen online',
  LISTING_REMOVED: 'Advertentie ingetrokken',
  RELISTED: 'Opnieuw aangeboden',
  AGENCY_TO_PRIVATE: 'Van kantoor naar particulier',
  PRIVATE_TO_AGENCY: 'Van particulier naar kantoor',
}

/**
 * De kleur van de stip. Alleen de gebeurtenissen die iets betekenen voor de
 * verkoopkans krijgen nadruk; de rest blijft grijs, zodat het oog de
 * kantelpunten vindt zonder te lezen.
 */
function toneOf(type: string): string {
  switch (type) {
    case 'FSBO_DETECTED':
    case 'AGENCY_TO_PRIVATE':
      return 'bg-positive'
    case 'PRICE_DROP':
    case 'RELISTED':
      return 'bg-score-warm'
    case 'LISTING_REMOVED':
      return 'bg-danger'
    case 'STALE_30':
    case 'STALE_60':
    case 'STALE_90':
      return 'bg-score-mild'
    default:
      return 'bg-ink-400'
  }
}

export function PropertyTimeline({ events }: { readonly events: readonly ListingEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-600">Nog geen gebeurtenissen vastgelegd.</p>
  }

  // Nieuwste bovenaan: wie de pagina opent wil weten wat er laatst gebeurde.
  const ordered = [...events].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  )

  return (
    <ol className="relative space-y-4 border-l border-ink-200 pl-6">
      {ordered.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className={`absolute top-1.5 -left-[1.6875rem] h-2.5 w-2.5 rounded-full ring-2 ring-white ${toneOf(event.type)}`}
          />

          <div className="flex flex-wrap items-baseline gap-x-3">
            <time
              dateTime={event.occurredAt.toISOString()}
              className="tnum text-xs font-medium tracking-wide text-ink-600 uppercase"
            >
              {formatDate(event.occurredAt)}
            </time>
            <p className="text-sm font-medium text-ink-900">
              {EVENT_LABELS[event.type] ?? event.type}
            </p>
          </div>

          {/* Prijswijzigingen krijgen het bedrag zelf, niet alleen een woord:
              "van 510.000 naar 495.000" is het gespreksonderwerp. */}
          {event.oldPrice != null && event.newPrice != null && (
            <p className="tnum mt-0.5 text-sm text-ink-800">
              {formatEuro(event.oldPrice)}
              <span aria-hidden className="mx-1.5 text-ink-500">
                →
              </span>
              <span className="font-medium">{formatEuro(event.newPrice)}</span>
              {event.percentageDrop != null && event.percentageDrop !== 0 && (
                <span
                  className={`ml-2 text-xs ${event.percentageDrop > 0 ? 'text-danger' : 'text-positive'}`}
                >
                  {event.percentageDrop > 0 ? '−' : '+'}
                  {Math.abs(event.percentageDrop).toFixed(1).replace('.', ',')}%
                </span>
              )}
            </p>
          )}

          {event.detail && <p className="mt-0.5 text-sm text-ink-600">{event.detail}</p>}
        </li>
      ))}
    </ol>
  )
}
