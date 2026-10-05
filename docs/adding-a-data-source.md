# Een databron toevoegen

## Stap nul: mag het?

Deze stap is geen formaliteit en staat daarom vooraan.

Voordat je één regel code schrijft, moet vaststaan dát deze bron geautomatiseerd
benaderd mag worden en op welke grond. Dat is een feitelijke vraag per bron —
robots.txt, gebruiksvoorwaarden, soms een contract of een API-sleutel — en geen
technische.

**Staat dat niet vast, dan hoort er geen collector voor in productie.** Bouw dan
een fixture (`fixtures/listings.json`) en werk daarmee verder; de rest van de
pijplijn is identiek.

De voorkeursvolgorde, van net naar minst net:

```text
1. OFFICIAL_API      officiële API met sleutel en voorwaarden
2. PUBLIC_FEED       aangeboden feed, bedoeld om gelezen te worden
3. STRUCTURED_DATA   JSON-LD of microdata op publieke pagina's
4. PUBLIC_HTML       publieke HTML — alleen als 1–3 niet kunnen
```

Een collector die `PUBLIC_HTML` declareert, moet kunnen uitleggen waarom de drie
nettere routes niet konden. Die uitleg staat in `accessNotes` en is zichtbaar in
het beheerscherm — een bron zonder verantwoording valt daar meteen op.

## Wat nooit mag

- CAPTCHA's omzeilen
- inlogmuren of betaalmuren doorbreken
- anti-botmaatregelen ontwijken of browservingerafdrukken vervalsen
- robots.txt negeren
- opgegeven rate limits overschrijden
- je voordoen als een gewone bezoeker

Dit is geen lijst met risico's om af te wegen. Een `RobotsDisallowedError` en een
`AccessBlockedError` worden daarom nooit geretried: de bron zegt nee, en harder
proberen maakt dat niet anders. De bron gaat in cooldown en bij herhaling uit.

## Het contract

```ts
interface ListingCollector {
  readonly source: string
  collect(context: CollectorContext): Promise<CollectorResult>
}
```

Een collector doet **één** ding: advertenties ophalen en als `RawListing`
teruggeven. Hij normaliseert niet, classificeert niet, praat niet met de
database, detecteert geen events en beslist niet of iets een kans is. Al die
stappen zijn gedeeld en gelden voor elke bron; zou een collector ze zelf doen,
dan zou elke nieuwe bron ze opnieuw — en net iets anders — implementeren.

De `CollectorContext` reikt de HTTP-client aan in plaats van de collector er zelf
een te laten maken. Dat is geen gemak maar een grens: langs die client lopen
robots-controle, rate limiting, timeouts en retries, en eromheen werken kan niet.
In een test geef je een client met een nep-fetch mee, en dan raakt de collector
gegarandeerd geen echte site.

## Recept

### 1. Definieer de collector

```ts
// src/collectors/mijnbron/mijnbronCollector.ts
import type { CollectorContext, CollectorDefinition, CollectorResult } from '../types'

export const mijnbronCollector: CollectorDefinition = {
  source: 'mijnbron-be',
  name: 'Mijn Bron',
  accessMethod: 'PUBLIC_FEED',
  baseUrl: 'https://example.be',
  defaultPollIntervalSeconds: 900,
  defaultRateLimitPerMinute: 10,
  accessNotes:
    'Publieke RSS-feed, expliciet aangeboden voor hergebruik in de voorwaarden ' +
    'van 2026-01-01. robots.txt staat /feed toe. Contact: data@example.be.',
  requiresBrowser: false,

  async collect(context: CollectorContext): Promise<CollectorResult> {
    const warnings: string[] = []
    const response = await context.http.get('/feed.xml')

    // … parsen naar RawListing[]

    return { listings, warnings }
  },
}
```

Voor een bron met JSON-LD op de detailpagina's is er een kant-en-klare
bouwsteen: `createJsonLdFeedCollector`.

### 2. Registreer hem

```ts
// src/collectors/registry.ts
const REGISTRY = [fixtureCollector, demoMarketCollector, mijnbronCollector]
```

### 3. Zet hem op twee plekken aan

```bash
COLLECTOR_ENABLED_SOURCES="fixture-be,demo-be,mijnbron-be"
```

En in het beheerscherm `Source.enabled` op waar. **Twee sloten met verschillende
sleutelhouders**: het dashboard beheert het eerste, de omgeving het tweede. Zo
kan niemand per ongeluk — via een migratie, een seed of een verkeerde klik — een
bron laten lopen die op deze omgeving niet hoort te lopen.

Een lege allowlist betekent *geen enkele bron*, niet *alle bronnen*. Een vergeten
variabele levert dan een stille worker op in plaats van onbedoeld verkeer.

### 4. Test zonder het internet

```ts
const http = new HttpClient({ fetch: async () => new Response(fixture) })
const result = await mijnbronCollector.collect({ http, /* … */ })
```

Geen enkele test in dit project raakt een echte site. Een suite die dat wel doet
faalt op een zaterdag om redenen die niets met de code te maken hebben, en wordt
daarna genegeerd.

## Wat je gratis krijgt

Zodra de collector `RawListing[]` teruggeeft, doet de rest van de pijplijn zijn
werk: normalisatie, property matching, verkoperclassificatie, snapshots,
eventdetectie, territory matching, CRM-matching, scoring, kansen en meldingen.

Ook zonder eigen code: robots.txt-naleving met caching, rate limiting per bron,
timeouts, exponentiële backoff, cooldown na opeenvolgende fouten,
gezondheidsstatus, per-run-statistieken en foutisolatie — één stukke bron zet
zichzelf op non-actief in plaats van de worker vol te laten lopen.

## Velden

Alleen deze drie zijn verplicht:

```ts
{
  source: 'mijnbron-be',
  sourceListingId: '12345',   // stabiel binnen deze bron
  url: 'https://…',           // de terugweg; zonder controle geen bruikbare kans
  scrapedAt: new Date(),
}
```

De rest is optioneel. Een bron die alleen een titel en een prijs geeft is een
magere bron, geen fout — de normalisatie beslist of er genoeg in zit.

Twee velden verdienen aandacht:

- **`sellerTypeHint`** is een *hint*, geen conclusie. Bronnen labelen dit
  inconsistent; de classificatie weegt het mee als één signaal tussen andere in
  plaats van het over te nemen.
- **`raw`** bewaart de oorspronkelijke payload, uitsluitend om parsingfouten te
  kunnen nakijken. Hij wordt door de retentieroutine gewist.
