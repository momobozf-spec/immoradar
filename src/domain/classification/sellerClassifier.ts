import { normalizeAgencyName } from '@/lib/text'

import type { SellerClassification } from '../types'

import { collectSignals, type Signal, type SignalInput } from './signals'

/**
 * De verkoperclassificatie: particulier, professioneel of onbekend.
 *
 * ─── WAAROM REGELS EN GEEN MODEL ─────────────────────────────────────────────
 *
 * Dit is de beslissing waarop het hele product rust — een FSBO-melding voor een
 * woning die in werkelijkheid bij een collega-kantoor staat, is precies het
 * bericht dat een makelaar laat opzeggen. Zo'n beslissing moet uitlegbaar zijn,
 * reproduceerbaar, en aan te passen zonder hertrainen. Een set gewogen regels
 * geeft dat; een model niet. De opdracht laat AI-classificatie bewust optioneel,
 * en dit is waarom: er is geen MVP-probleem dat het oplost.
 *
 * ─── HOE HET REKENT ──────────────────────────────────────────────────────────
 *
 * De signalen zijn log-odds. Ze worden opgeteld en door een logistische functie
 * gehaald, wat een kans oplevert. Het voordeel boven "percentages optellen": vier
 * zwakke aanwijzingen komen niet automatisch op 100% uit, en twee tegenstrijdige
 * aanwijzingen heffen elkaar netjes op in plaats van allebei te winnen.
 *
 * Blijft de uitkomst dicht bij 50/50, dan is het antwoord UNKNOWN. Dat is een
 * volwaardige uitkomst: liever geen lead dan een verkeerde.
 */

/** Onder deze zekerheid durven we geen kant te kiezen. */
const DECISION_THRESHOLD = 0.6

/**
 * Bovengrens op de zekerheid. Ook bij een IPI-nummer én acht advertenties blijft
 * er ruimte voor de mogelijkheid dat de bron ons iets verkeerds vertelde; 100%
 * zou dat ontkennen en het is nooit waar.
 */
const MAX_CONFIDENCE = 0.99

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export interface ClassifierOptions {
  /** Vanaf hoeveel gelijktijdige advertenties een verkoper professioneel heet. */
  professionalListingThreshold: number
}

export interface ClassifierInput {
  sellerName: string | null
  sellerPhoneE164: string | null
  sellerPhoneIsMobile: boolean
  title: string | null
  description: string | null
  sourceHint: 'private' | 'professional' | 'unknown'
  activeListingCount: number
}

/**
 * Classificeert één advertentie.
 *
 * `activeListingCount` komt van buiten omdat het een eigenschap van de verkóper
 * is, niet van de advertentie — de aanroeper heeft dat net opgezocht en geeft
 * het door, zodat deze functie puur blijft.
 */
export function classifySeller(
  input: ClassifierInput,
  options: ClassifierOptions,
): SellerClassification {
  const signalInput: SignalInput = {
    ...input,
    professionalListingThreshold: options.professionalListingThreshold,
  }

  const signals = collectSignals(signalInput)

  const logOdds = signals.reduce(
    (total, signal) => total + (signal.direction === 'professional' ? signal.weight : -signal.weight),
    0,
  )

  const professionalProbability = logistic(logOdds)
  const winner = professionalProbability >= 0.5 ? 'professional' : 'private'
  const rawConfidence = Math.max(professionalProbability, 1 - professionalProbability)
  const confidence = Math.min(MAX_CONFIDENCE, rawConfidence)

  if (signals.length === 0 || confidence < DECISION_THRESHOLD) {
    return {
      type: 'unknown',
      confidence: signals.length === 0 ? 0 : confidence,
      reasons:
        signals.length === 0
          ? ['Geen bruikbare aanwijzingen over het verkopertype']
          : [
              'Tegenstrijdige aanwijzingen — te weinig zekerheid om te classificeren',
              ...describe(signals),
            ],
      agencyName: null,
    }
  }

  return {
    type: winner,
    confidence,
    reasons: describe(signals.filter((signal) => signal.direction === winner).concat(
      // Tegensignalen horen er ook bij: een makelaar die ziet "particulier, 88%
      // — maar de bron zegt professioneel" kan zelf beoordelen of hij belt.
      signals.filter((signal) => signal.direction !== winner),
    )),
    agencyName: winner === 'professional' ? deriveAgencyName(input.sellerName) : null,
  }
}

/** Signalen naar leesregels, zwaarste eerst. */
function describe(signals: Signal[]): string[] {
  return [...signals]
    .sort((a, b) => b.weight - a.weight)
    .map((signal) => signal.label)
}

/**
 * De kantoornaam voor Competitor Radar.
 *
 * Geeft `null` bij een lege of te korte naam: een `AgencyIdentity` met de naam
 * "BV" zou alle eenmanszaken van België op één hoop gooien.
 */
function deriveAgencyName(sellerName: string | null): string | null {
  if (!sellerName) return null
  const normalized = normalizeAgencyName(sellerName)
  return normalized.length >= 3 ? sellerName.trim() : null
}

/**
 * Is deze verkoper zeker genoeg particulier om er commercieel op te acteren?
 *
 * Aparte functie omdat de drempel voor "tonen in het dashboard" een andere is
 * dan voor "hier een Telegram-melding over sturen". De pijplijn gebruikt deze;
 * het dashboard toont alles met zijn zekerheid erbij.
 */
export function isConfidentPrivate(
  classification: SellerClassification,
  threshold: number,
): boolean {
  return classification.type === 'private' && classification.confidence >= threshold
}
