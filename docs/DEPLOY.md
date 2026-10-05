# In productie zetten

Dit is het draaiboek van een lege server tot een eerste kantoor dat inlogt. Wat
er juridisch en commercieel nog moet gebeuren vóór je een klant aansluit, staat
apart in [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

## Wat er draait

| Onderdeel | Commando | Opmerking |
| --- | --- | --- |
| PostgreSQL 17 | — | Managed (Neon, Supabase, Scaleway, OVH) of eigen container. Backups aan. |
| Web | `npm start` | Dashboard, serveracties, `/api/health`, `/api/ready`, cron-routes. |
| Worker | `npm run worker` | Collectors, LeadRevive, meldingen, opruiming. Eén instantie. |

Web en worker gebruiken dezelfde image (zie `Dockerfile`). Alleen het
startcommando verschilt. De web-service migreert bij het opstarten; de worker
nooit.

## Omgevingsvariabelen

Volledige lijst met uitleg in [`.env.example`](../.env.example). Verplicht in
productie — de app weigert anders te starten (`src/instrumentation.ts`,
`src/jobs/worker.ts`):

| Variabele | Waarde |
| --- | --- |
| `DATABASE_URL` | Verbinding met PostgreSQL, met `sslmode=require` bij een managed database. |
| `SESSION_SECRET` | Minstens 32 willekeurige tekens. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `APP_BASE_URL` | De publieke URL, met `https://`. |

Sterk aanbevolen:

| Variabele | Waarom |
| --- | --- |
| `LEGAL_ENTITY_*`, `LEGAL_CONTACT_EMAIL` | Verschijnen op `/privacy` en `/voorwaarden`. Zonder contactadres kan niemand zijn privacyrechten uitoefenen. |
| `TELEGRAM_BOT_TOKEN` | Zonder token worden meldingen aangemaakt maar niet verstuurd. |
| `CRON_SECRET` | Alleen als je de taken via HTTP laat aanroepen in plaats van met de worker. |
| `DATABASE_POOL_MAX` | Zet web + worker samen onder de verbindingslimiet van je database. |
| `TRUSTED_PROXY_HOPS` | Aantal proxies vóór de app (Caddy: 1; Render: meten via Beheer → Systeem → Proxy-diagnose). Fout ingesteld = de IP-limiet telt het verkeerde adres. |

## Eerste installatie

```bash
# 1. Migraties op de lege database
npx prisma migrate deploy

# 2. Jouw platformbeheerdersaccount
BOOTSTRAP_ADMIN_EMAIL=jij@jouwbedrijf.be npm run bootstrap:admin
#    → drukt één keer een tijdelijk wachtwoord af

# 3. Web en worker starten
npm start            # of de web-service van je platform
npm run worker       # aparte service, één instantie
```

Draai **nooit** `npm run db:seed` op productie: de demo-seed wist eerst de hele
database. Hij weigert daarom met `NODE_ENV=production`.

Daarna, in de browser:

1. Log in op `/login` met het tijdelijke wachtwoord en kies een eigen wachtwoord.
2. Ga naar **Kantoren** (`/admin/agencies`) → *Nieuw kantoor*. Vul de naam, het
   plan en het e-mailadres van de kantoorbeheerder in. Je krijgt één keer een
   tijdelijk wachtwoord te zien; geef het persoonlijk of telefonisch door.
3. De kantoorbeheerder logt in, kiest een eigen wachtwoord, stelt onder
   **Gebieden** de postcodes of gemeenten in, en voegt onder **Team** zijn
   collega's toe.

## Op Render

Volledig draaiboek met `render.yaml` (Blueprint, Frankfurt): [DEPLOY-RENDER.md](DEPLOY-RENDER.md).
Eigen server bij Hetzner: [../deploy/README.md](../deploy/README.md).

## Health checks

| Route | Betekenis | Gebruik |
| --- | --- | --- |
| `GET /api/health` | Het webproces draait. Raakt de database niet. | Liveness / container-healthcheck |
| `GET /api/ready` | De database antwoordt binnen 2 s. | Readiness / load balancer |

Beide zonder inlog, zonder details in het antwoord.

## Accounts in productie

- **Geen zelfregistratie.** Kantoren maak jij aan; collega's voegt de
  kantoorbeheerder toe.
- **Tijdelijke wachtwoorden** worden één keer getoond en moeten bij de eerste
  login vervangen worden. Tot dan kan de gebruiker alleen `/account` openen.
- **Vergrendeling**: 5 foute pogingen → 15 minuten op slot, daarna telkens het
  dubbele (tot een dag; na een dag rust begint de teller opnieuw). De
  inlogmelding is altijd dezelfde, zodat ze niet verraadt of een adres bestaat.
  Een nieuw tijdelijk wachtwoord via **Team** heft het slot meteen op; voor een
  platformbeheerder: `UNLOCK_EMAIL=… npm run unlock:user`.
- **Telegram**: een kantoor zonder eigen chat krijgt in productie géén meldingen
  (de gedeelde `TELEGRAM_FALLBACK_CHAT_ID` geldt alleen buiten productie), zodat
  kansen van verschillende kantoren nooit in één chat belanden.
- **Intrekken**: deactiveren, een wachtwoordwijziging en *Overal afmelden*
  maken alle lopende sessies van die gebruiker onmiddellijk ongeldig.
- **Abonnement**: in **Kantoren** → *Beheren* zet je een kantoor op gepauzeerd,
  opgezegd of een einddatum. Dan ziet het kantoor een uitlegpagina, maakt de
  pijplijn geen kansen meer aan en gaan er geen meldingen meer uit. De data
  blijft bewaard.

## Einde van een pilot of contract

Wil een kantoor niet verder, maak dan op verzoek eerst een export en wis daarna
alles binnen 30 dagen (verwerkersovereenkomst, art. 9):

```bash
PURGE_AGENCY=<slug> PURGE_CONFIRM=<slug> npm run agency:purge
```

Dat is onherroepelijk. Bevestig het wissen daarna per e-mail aan het kantoor.
Eén persoon wissen op verzoek: `redactCrmContact` (zie [privacy.md](privacy.md)).

## Een nieuwe versie uitrollen

```bash
npm ci                       # genereert ook de Prisma-client
npm run verify               # schema, types, lint, unittests
npm run build
npx prisma migrate deploy    # vóór de nieuwe web-instanties verkeer krijgen
```

Schemawijzigingen: altijd met `npm run db:migrate` lokaal een migratie maken en
die mee committen. Nooit `db:push` op productie.

## Back-ups en herstel

Zet dagelijkse back-ups met point-in-time recovery aan bij je databaseprovider.
Test één keer per kwartaal een herstel naar een aparte database en draai daar
`npm run smoke` tegen. Een back-up die nooit hersteld is, is een hoop.
