import { NotificationError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'

/**
 * Telegram Bot API.
 *
 * ─── DRY-RUN IS DE STANDAARD ─────────────────────────────────────────────────
 *
 * Zonder `TELEGRAM_BOT_TOKEN` verstuurt deze client niets en meldt hij dat als
 * `SUPPRESSED_DRY_RUN`. Dat is bewust de standaardtoestand: bij het opzetten van
 * het project, tijdens het seeden en in tests wil niemand dat er echte berichten
 * naar echte makelaars vertrekken. De alertrij wordt wél aangemaakt, met de
 * volledige tekst erin, zodat het dashboard laat zien wat er verstuurd zóu zijn.
 *
 * ─── GEEN parse_mode ─────────────────────────────────────────────────────────
 *
 * MarkdownV2 vereist dat zestien tekens geëscaped worden, waaronder de punt en
 * het minteken. Eén adres met een koppelteken of één prijs met een punt levert
 * dan een 400 op en dus een gemiste lead. Telegram maakt kale URL's toch
 * klikbaar, dus platte tekst kost ons niets en scheelt een hele klasse fouten.
 */

const logger = createLogger({ component: 'telegram' })

const API_BASE = 'https://api.telegram.org'
const TIMEOUT_MS = 10_000

export interface SendResult {
  status: 'SENT' | 'SUPPRESSED_DRY_RUN'
  providerMessageId: string | null
}

interface TelegramResponse {
  ok: boolean
  result?: { message_id?: number }
  description?: string
  error_code?: number
}

export interface TelegramClientOptions {
  fetchImpl?: typeof fetch
  /** Overschrijft de token uit de omgeving; gebruikt in tests. */
  token?: string
}

export class TelegramClient {
  private readonly fetchImpl: typeof fetch
  private readonly token: string

  constructor(options: TelegramClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.token = options.token ?? getEnv().TELEGRAM_BOT_TOKEN
  }

  get isConfigured(): boolean {
    return this.token.length > 0
  }

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    if (!this.isConfigured) {
      logger.info('Dry-run: geen TELEGRAM_BOT_TOKEN, bericht niet verstuurd', {
        chatId,
        length: text.length,
      })
      return { status: 'SUPPRESSED_DRY_RUN', providerMessageId: null }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await this.fetchImpl(`${API_BASE}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          // Voorbeeldkaartjes van de bronlink zouden het bericht drie keer zo
          // hoog maken en de leesbaarheid in een drukke chat verpesten.
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      })

      const payload = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse

      if (!response.ok || !payload.ok) {
        const description = payload.description ?? `HTTP ${response.status}`
        // 429 en 5xx zijn tijdelijk; 400 ("chat not found") is een
        // configuratiefout die opnieuw proberen niet oplost.
        const retryable = response.status === 429 || response.status >= 500
        throw new NotificationError(`Telegram weigerde het bericht: ${description}`, retryable, {
          status: response.status,
          errorCode: payload.error_code,
        })
      }

      return {
        status: 'SENT',
        providerMessageId: payload.result?.message_id ? String(payload.result.message_id) : null,
      }
    } catch (error) {
      if (error instanceof NotificationError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NotificationError(`Telegram antwoordde niet binnen ${TIMEOUT_MS} ms`, true)
      }
      throw new NotificationError(
        `Telegram onbereikbaar: ${error instanceof Error ? error.message : String(error)}`,
        true,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
