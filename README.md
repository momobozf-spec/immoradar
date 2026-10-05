# ImmoRadar

**Acquisitie-intelligentie voor Belgische vastgoedkantoren.**

ImmoRadar beantwoordt elke ochtend één vraag voor een makelaar:

> Wie moet ik vandaag bellen om de volgende verkoopopdracht te winnen?

Het is geen CRM en geen zoekmachine voor panden. Het is een laag intelligentie
bovenop bestaande systemen, die twee dingen combineert die tot nu toe los van
elkaar stonden:

| Motor | Vraag die hij beantwoordt |
| --- | --- |
| **ImmoRadar** | Wie in mijn gebied probeert nú zelf te verkopen? |
| **LeadRevive** | Wie zit er al in mijn eigen bestand met een reden om te bellen? |

De waarde zit in de combinatie. Een particuliere verkoop in Gent is informatie
die iedereen kan kopen. *"Deze particuliere verkoper is de man aan wie jij in
2019 dat huis verkocht"* kan alleen dit kantoor weten — en dat verandert een koud
belletje in een gesprek dat begint met een naam.

> **Status: productieklaar** (oktober 2026). Accountbeheer, sessie-intrekking,
> inlogvergrendeling, abonnementen, health checks, CI en end-to-endtests zijn er.
> Wat nog buiten de code moet gebeuren — vooral een toegestane databron en een
> juridische review — staat in [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).
> Uitrollen: [docs/DEPLOY.md](docs/DEPLOY.md).
>
> *FSBO Lead Radar* is volledig in dit project opgegaan (zelfde collectors,
> classificatie, deduplicatie en Telegram-meldingen, plus de CRM-kant). De aparte
> map `fsbo-lead-radar` mag naar het archief.

---

## Snel starten

Je hebt Node 20+ nodig en een PostgreSQL. Er zijn twee wegen; kies er één.

### Met Docker

```bash
cp .env.example .env          # vul SESSION_SECRET in
docker compose up -d db       # alleen de database
npm install                   # genereert ook de Prisma-client
npm run db:migrate
npm run db:seed
npm run dev
```

### Zonder Docker

`npm run dev:db` pakt een echte PostgreSQL uit in `.devdb/` en start hem op
poort 5433. Handig op machines waar Docker niet draait of niet mag.

```bash
cp .env.example .env
npm install
npm run dev:db                # laat deze terminal open staan
```

Zet in een tweede terminal de `DATABASE_URL` uit de uitvoer in je `.env` en:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> en log in:

| Account | Wachtwoord | Rol |
| --- | --- | --- |
| `thomas@immo-example-gent.be` | `immoradar` | Kantoorbeheerder |
| `sofie@immo-example-gent.be` | `immoradar` | Makelaar |
| `admin@immoradar.be` | `immoradar` | Platformbeheerder |

De seed zet een volledige Belgische markt neer plus vijf kantoren met hun eigen
klantenbestand. Alles is deterministisch: dezelfde seed geeft altijd hetzelfde
resultaat.

---

## Wat je te zien krijgt

De seed plant vijf scenario's die het hele product laten zien. Ze staan
bovenaan bij **Immo Example Gent**.

| | Scenario | Waar het om gaat |
| --- | --- | --- |
| A | Verse particuliere verkoop, onbekende verkoper | De basis: een marktsignaal in jouw gebied |
| B | Verse particuliere verkoop, **koper uit 2019** | Het vlaggenschip: markt × relatie |
| C | Particulier, 67 dagen online, twee prijsverlagingen | Zelf verkopen lukt niet |
| D | Slapende schattingsaanvraag, geen marktsignaal | LeadRevive alleen |
| E | Herplaatst pand bij een bekende relatie | De timeline over twee advertenties heen |

Scenario B levert in de demo een kans van **94/100** op, met de uitleg
*"Uit jullie eigen dossier: dit contact hoort bij dit pand"*.

---

## Hoe het werkt

```text
bron → normalisatie → property matching → classificatie → snapshot
                                                             │
                                                        eventdetectie
                                                             │
                                              ┌──────────────┴──────────────┐
                                              │                             │
                                       territory match              CRM-matching
                                              │                             │
                                              └──────────────┬──────────────┘
                                                             │
                                                       scoring (5 dimensies)
                                                             │
                                                  opportunity → alert → dashboard
```

Elke stap staat apart en is los te testen. De volledige uitleg staat in
[`docs/architecture.md`](docs/architecture.md).

### De vier principes achter het datamodel

1. **Het pand is de hoofdrolspeler, niet de advertentie.** Advertenties
   verschijnen, veranderen van prijs, worden ingetrokken en komen maanden later
   terug onder een nieuw id. Alleen met `Property` als anker kun je zeggen: *dit
   huis staat al 210 dagen te koop, bij twee kantoren, met drie
   prijsverlagingen.*
2. **Elke waarneming die iets nieuws zegt wordt bewaard.** Snapshots zijn de bron
   van waarheid; events, scores en tellers zijn afgeleid en herberekenbaar.
3. **De marktlaag is gedeeld, de commerciële laag is van één kantoor.** De
   tenantgrens ligt op één plek: bij `Opportunity`, `CrmContact` en `Alert`.
4. **CRM-data verlaat nooit de tenant.** Er bestaat in het schema geen pad van
   het klantenbestand van kantoor A naar kantoor B.

---

## Commando's

| Commando | Wat het doet |
| --- | --- |
| `npm run dev` | Dashboard op poort 3000 |
| `npm run dev:db` | Lokale PostgreSQL zonder Docker |
| `npm run worker` | De collectorlus: bronnen, events, kansen, meldingen |
| `npm run pipeline` | Eén pijplijnronde, handmatig |
| `npm run db:migrate` | Migraties toepassen |
| `npm run db:seed` | Demodata (wist eerst alles) |
| `npm run db:studio` | Prisma Studio |
| `npm run verify` | Schema + typecheck + lint + tests |
| `npm test` | Alleen de unittests |
| `npm run build` | Productiebuild |
| `npm run smoke` | Rooktest: rendert elk scherm voor een echte gebruiker? |
| `npm run test:e2e` | Playwright tegen een draaiende server (accounts, vergrendeling, abonnement) |
| `npm run bootstrap:admin` | Eerste platformbeheerder in een lege productiedatabase |

---

## Documentatie

| Document | Onderwerp |
| --- | --- |
| [architecture.md](docs/architecture.md) | De lagen en waarom ze gescheiden zijn |
| [data-model.md](docs/data-model.md) | Elke tabel en de beslissing erachter |
| [opportunity-engine.md](docs/opportunity-engine.md) | Van marktgebeurtenis naar kans |
| [leadrevive.md](docs/leadrevive.md) | Slapende relaties uit het eigen bestand |
| [crm-matching.md](docs/crm-matching.md) | Wanneer is dit dezelfde persoon? |
| [scoring.md](docs/scoring.md) | De vijf dimensies en hun weging |
| [privacy.md](docs/privacy.md) | Tenantscheiding, bewaartermijnen, verwijderen |
| [adding-a-data-source.md](docs/adding-a-data-source.md) | Een nieuwe bron toevoegen |
| [adding-a-crm-adapter.md](docs/adding-a-crm-adapter.md) | Een nieuwe CRM-koppeling |
| [DEPLOY.md](docs/DEPLOY.md) | Van lege server tot eerste kantoor |
| [LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) | Wat vóór de eerste klant buiten de code moet gebeuren |

---

## Databronnen

**Er zit in deze repository geen enkele scraper die een echte site aanraakt.**

Dat is geen omissie maar een ontwerpkeuze. Geautomatiseerd ophalen mag alleen
wanneer de bron dat toestaat, en dat is per bron een feitelijke vraag —
robots.txt, gebruiksvoorwaarden, soms een contract. Zolang dat voor een bron niet
is vastgesteld, hoort er geen collector voor in productie te staan.

Wat er wél is:

- **`fixture-be`** — leest `fixtures/listings.json` van schijf.
- **`demo-be`** — genereert een synthetische Belgische markt die in de loop van
  minuten verandert: prijzen zakken, advertenties verdwijnen en komen terug.
- **`createJsonLdFeedCollector`** — een kant-en-klare bouwsteen voor zodra er wél
  een goedgekeurde bron is.

De collectorlaag heeft daarnaast robots.txt-naleving, rate limiting, timeouts,
exponentiële backoff en cooldown per bron ingebouwd. Er zit niets in dat
CAPTCHA's omzeilt, inlogmuren doorbreekt of zich voordoet als een browser. Zie
[docs/adding-a-data-source.md](docs/adding-a-data-source.md).

Elke bron draait alleen als hij **op twee plekken** aanstaat: `enabled` in de
database én genoemd in `COLLECTOR_ENABLED_SOURCES`. Twee sloten met verschillende
sleutelhouders, zodat niemand per ongeluk verkeer naar buiten laat gaan.

---

## Meldingen

Telegram, in twee vormen: een directe melding bij een hete kans en een
ochtendsamenvatting. Per kantoor instelbaar op minimumscore, type en
stiltevensters.

Zonder `TELEGRAM_BOT_TOKEN` worden meldingen **wel aangemaakt en bewaard, maar
niet verstuurd** (status `SUPPRESSED_DRY_RUN`). Zo is de hele alertlaag te
demonstreren zonder bot, en het scherm zegt er met zoveel woorden bij dat er
niets vertrekt.

---

## Productie

Het volledige draaiboek staat in [docs/DEPLOY.md](docs/DEPLOY.md). Kort:

```bash
npx prisma migrate deploy
BOOTSTRAP_ADMIN_EMAIL=jij@bedrijf.be npm run bootstrap:admin
npm start                     # web
npm run worker                # achtergrondwerk, aparte service
```

Web en worker weigeren te starten zonder `SESSION_SECRET` van minstens 32
tekens of met een `APP_BASE_URL` zonder https — een vervalsbaar sessiecookie
maakt de tenantscheiding een suggestie in plaats van een grens.

### Accounts

- **Geen zelfregistratie.** De platformbeheerder maakt kantoren aan
  (`/admin/agencies`), de kantoorbeheerder voegt collega's toe (`/team`).
- **Tijdelijke wachtwoorden**, één keer getoond, verplicht te vervangen bij de
  eerste login. Minstens 12 tekens; lengte telt, geen complexiteitsregels.
- **Sessies zijn intrekbaar.** Elk cookie draagt de `sessionVersion` van de
  gebruiker; deactiveren, een wachtwoordwijziging of *Overal afmelden* verhoogt
  die en maakt alle lopende sessies meteen ongeldig. Rol en kantoor komen per
  request uit de database, niet uit het cookie.
- **Vergrendeling** na 5 foute pogingen (15 min, daarna verdubbelend tot een
  dag) en een plafond per IP-adres tegen het uitproberen van veel accounts.
- **Abonnementen.** Een gepauzeerd, opgezegd of verlopen abonnement sluit de
  kantoordata af met een uitlegpagina, en de pijplijn maakt voor dat kantoor
  geen kansen of meldingen meer.

### Prisma 7

De client wordt gegenereerd naar `src/generated/prisma` (bij `npm install`) en
praat via `@prisma/adapter-pg` met PostgreSQL — geen Rust-engine, geen
platformgebonden binaries. Importeer types uit `@/generated/prisma/client`.

---

## Wat dit bewust niet doet

Geen WhatsApp, geen mobiele app, geen chatbot, geen automatische cold
outreach, geen automatische telefoongesprekken, geen online betalingen (B2B
facturatie loopt via je boekhouding; het abonnement stuur je in
`/admin/agencies`), geen ML-voorspellingen, geen scrapers zonder toestemming.

En één inhoudelijke: **een score zegt niet dat iemand wil verkopen.** Hij zegt
hoe kansrijk het gesprek is. Dat onderscheid staat op elk scherm waar een score
staat, omdat een makelaar die het anders leest met de verkeerde verwachting belt
— en dat kost precies de relatie die het product wilde benutten.
