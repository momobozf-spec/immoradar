# ImmoRadar gratis testen op Render

Een testopstelling zonder kosten: `render.free.yaml`. **Alleen testdata, nooit
een export van een kantoor.** Voor een echte pilot: `docs/DEPLOY-RENDER.md`.

Wat gratis betekent bij Render:

- De database **vervalt na 30 dagen** (met alle data), 1 GB, geen back-ups.
- De app slaapt na 15 minuten zonder bezoek; het eerste verzoek daarna duurt
  ongeveer een minuut.
- Geen worker en geen Shell. LeadRevive en onderhoud worden aangeroepen door
  GitHub Actions; je beheerdersaccount wordt bij het opstarten aangemaakt.

## 1. Bestanden in GitHub

In PowerShell, in `coude\immoradar-pro`:

```powershell
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Copy-Item deploy\github-cron.yml .github\workflows\cron.yml
git add .
git commit -m "Gratis testopstelling Render"
git push
```

## 2. Blueprint

1. Render → **Blueprints** → **New Blueprint Instance** → repository `immoradar`.
2. **Blueprint Path:** `render.free.yaml`.
3. Vul in:
   - `APP_BASE_URL`: `https://immoradar-test.onrender.com` (controleer na het
     aanmaken de echte naam en pas aan als die anders is).
   - `LEGAL_ENTITY_ADDRESS`: volledig adres met postcode en gemeente.
   - `LEGAL_CONTACT_EMAIL`.
   - `BOOTSTRAP_ADMIN_EMAIL`: het e-mailadres waarmee jij inlogt.
4. Controleer dat er **$0** staat, dan **Apply**.

De eerste build duurt enkele minuten (de gratis machine is traag).

## 3. Inloggen

immoradar-test → **Logs**. Zoek `Tijdelijk wachtwoord`. Log in op
`https://<adres>/login` en kies meteen een eigen wachtwoord.

Daarna: immoradar-test → **Environment** → `BOOTSTRAP_ADMIN_EMAIL` **verwijderen**
en opslaan. (Laat je hem staan, dan gebeurt er niets: het account bestaat al.)

## 4. Proxy controleren

**Systeem** (`/admin/health`) → **Proxy-diagnose**. Het gekozen bezoekers-IP
moet jouw publieke IP zijn. Staat er een intern adres (10.x, 172.16–31.x,
192.168.x): verhoog `TRUSTED_PROXY_HOPS` in de groep **immoradar-test** met 1
en kijk opnieuw.

## 5. Planning (GitHub Actions)

1. Render → immoradar-test → **Environment** → kopieer de waarde van `CRON_SECRET`.
2. GitHub → repository → **Settings → Secrets and variables → Actions** →
   **New repository secret**, twee keer:
   - `APP_URL` = `https://immoradar-test.onrender.com` (zonder `/` op het einde)
   - `CRON_SECRET` = de gekopieerde waarde
3. GitHub → **Actions** → **cron** → **Run workflow** → `leadrevive`.
   Groen = werkt.

Daarna loopt LeadRevive elk uur en het onderhoud elke nacht.

## Na 30 dagen

Render waarschuwt vóór de database vervalt. Opnieuw beginnen: de database
verwijderen en de Blueprint opnieuw synchroniseren (lege database, stap 2–3
opnieuw). Of overstappen naar `render.yaml` (betaald, met back-ups).
