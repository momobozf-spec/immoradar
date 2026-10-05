# ImmoRadar op Render (Frankfurt)

Het draaiboek voor de pilot. Alles staat in `render.yaml` (een Render
*Blueprint*): één webservice, één worker en een Postgres-database, allemaal in
Frankfurt. Reken op een halfuur. Wil je liever een eigen server bij een
EU-bedrijf, zie `deploy/README.md` (Hetzner).

**Kosten** volgens de prijspagina van Render (oktober 2026): webservice en
worker elk $7/maand (0.5c-512mb), database $6/maand (0.1c-256mb), plus opslag
per GB. Controleer bij het aanmaken.

## 1. Verwerkersovereenkomst met Render

Render Services, Inc. is een Amerikaans bedrijf; de data staat in Frankfurt.
Render is gecertificeerd onder het EU-US Data Privacy Framework en biedt een
verwerkersovereenkomst aan op [render.com/dpa](https://render.com/dpa). Lees
hem, sluit hem af voor je workspace en bewaar een kopie: je verwerkersovereenkomst
met de kantoren noemt Render als subverwerker.

## 2. Code naar een privé-GitHub-repository

Render bouwt vanuit Git. In PowerShell, in `coude\immoradar-pro`:

```powershell
git init
git add .
git commit -m "ImmoRadar pilot"
```

Maak op GitHub een **privé**-repository `immoradar` (zonder README), en dan:

```powershell
git remote add origin https://github.com/<jouw-account>/immoradar.git
git branch -M main
git push -u origin main
```

`.gitignore` houdt `.env`, `node_modules` en `.next` buiten de repository.
Controleer na de push op GitHub dat er géén `.env` tussen staat.

## 3. Blueprint aanmaken

1. Render Dashboard → **Blueprints** → **New Blueprint Instance**.
2. Koppel GitHub en kies de repository `immoradar`, branch `main`.
3. Render leest `render.yaml` en vraagt de waarden die niet in de code staan:
   - `APP_BASE_URL` voor **immoradar-web én immoradar-worker**: dezelfde
     https-URL. Nog geen eigen domein? Neem voorlopig
     `https://immoradar-web.onrender.com` (de echte naam zie je na het
     aanmaken; pas hem dan aan).
   - `LEGAL_ENTITY_ADDRESS` en `LEGAL_CONTACT_EMAIL`.
4. **Apply**. De eerste build duurt enkele minuten.

De database is alleen intern bereikbaar (`ipAllowList: []`). De web-service
voert de migraties uit bij het opstarten.

Controle: `https://<adres>/api/ready` geeft `{"status":"ready"}`.

## 4. Jouw beheerdersaccount

immoradar-web → **Shell**:

```bash
BOOTSTRAP_ADMIN_EMAIL=jij@jouwdomein.be npm run bootstrap:admin
```

Het tijdelijke wachtwoord verschijnt één keer. Log in en kies een eigen wachtwoord.

## 5. Proxy controleren (belangrijk)

Ingelogd als beheerder: **Systeem** (`/admin/health`) → **Proxy-diagnose**.
Het "gekozen bezoekers-IP" moet je eigen publieke IP-adres zijn.

- Klopt het: niets te doen.
- Staat er een intern adres (10.x, 172.16–31.x, 192.168.x): verhoog
  `TRUSTED_PROXY_HOPS` in de omgevingsgroep **immoradar-prod** met 1, laat
  opnieuw deployen en kijk opnieuw.

Staat dit verkeerd, dan delen alle bezoekers één inloglimiet (30 pogingen per
kwartier voor iedereen samen), of kan een aanvaller de limiet omzeilen.

## 6. Eigen domein

immoradar-web → **Settings → Custom Domains** → `app.jouwdomein.be`. Render
toont het DNS-record (CNAME) en regelt het certificaat. Zet daarna
`APP_BASE_URL` op `https://app.jouwdomein.be`, bij **beide** services.

## 7. Back-ups

Render maakt van een betaalde database zelf back-ups met herstel tot op een
tijdstip; hoe lang hangt af van je workspace-plan (Hobby: 3 dagen, Pro: 7 dagen,
volgens de prijspagina van oktober 2026). Neem daarnaast elke week een eigen
export via de pagina van de database in het dashboard, en bewaar alleen de laatste twee op
een versleutelde schijf (BitLocker). De verwerkersovereenkomst belooft dat
gewiste gegevens na ten hoogste 14 dagen uit de back-ups verdwenen zijn.

## Dagelijks gebruik (immoradar-web → Shell)

| Wat | Commando |
| --- | --- |
| Account ontgrendelen | `UNLOCK_EMAIL=… npm run unlock:user` |
| Kantoor wissen (einde pilot) | `PURGE_AGENCY=<slug> PURGE_CONFIRM=<slug> npm run agency:purge` |

## Nieuwe versie

`git push` naar `main`; Render bouwt en deployt zelf.

## Bewaking

Zet een gratis uptime-monitor (UptimeRobot, Better Stack) op `/api/ready` met
een melding naar je gsm, en zet in Render → Notifications meldingen aan voor
mislukte deploys.
