# ImmoRadar online zetten op Hetzner

Eén server in Duitsland met alles erop: app, worker, database, nachtelijke
back-up en een https-certificaat. Reken op een uur de eerste keer.

**Waarom Hetzner:** een Duits bedrijf met datacenters in Duitsland. Voor een
verwerkersovereenkomst met makelaarskantoren is "EU-bedrijf, EU-datacenter"
het eenvoudigste verhaal. Een kleine server kost een paar euro per maand
(controleer de prijs bij het bestellen).

## Wat je nodig hebt

- Een domeinnaam waar je de DNS van kan aanpassen, bv. `app.jouwdomein.be`.
- Windows met PowerShell (ssh, scp en tar zitten er standaard in).
- Een halfuur zonder onderbreking.

## 1. Account en verwerkersovereenkomst

1. Maak een account op [hetzner.com](https://www.hetzner.com/cloud/) op naam van
   Marhaba Data & AI Agent BV, met het btw-nummer.
2. Sluit de verwerkersovereenkomst af in je account:
   [accounts.hetzner.com/account/dpa](https://accounts.hetzner.com/account/dpa).
   Kies als gegevens "contactgegevens van klanten en prospecten van
   klanten" en als betrokkenen "klanten van onze klanten". Een vinkje volstaat.

## 2. SSH-sleutel (op je laptop, PowerShell)

```powershell
ssh-keygen -t ed25519 -C "immoradar"
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Kopieer de regel die begint met `ssh-ed25519`. Zet een wachtwoord op de sleutel
als ssh-keygen erom vraagt.

## 3. Server aanmaken (Hetzner Cloud Console)

- **Location:** Falkenstein of Nuremberg (Duitsland).
- **Image:** Ubuntu 24.04.
- **Type:** Shared vCPU, x86, 2 vCPU en 4 GB RAM (de kleinste die beschikbaar is
  met 4 GB, bv. CX23 of CPX22).
- **Networking:** Public IPv4 aan.
- **SSH keys:** plak de sleutel van stap 2.
- **Backups:** aan. Hetzner maakt dan elke dag een kopie van de hele schijf en
  bewaart er 7.
- **Name:** `immoradar-prod`.

Noteer het IPv4-adres.

## 4. Domein laten wijzen

Maak bij je domeinbeheerder een **A-record**: `app.jouwdomein.be` → het IPv4-adres.
Wacht tot `nslookup app.jouwdomein.be` dat adres teruggeeft.

## 5. Server inrichten

Stuur de code naar de server, vanaf je laptop:

```powershell
cd C:\Users\mo-bo\OneDrive\Documenten\coude
tar --exclude=node_modules --exclude=.next --exclude=.env --exclude=.devdb -czf immoradar.tgz immoradar-pro
scp immoradar.tgz root@<IP>:/opt/
ssh root@<IP>
```

Op de server:

```bash
cd /opt && tar -xzf immoradar.tgz && rm immoradar.tgz
bash /opt/immoradar-pro/deploy/setup-server.sh
```

## 6. Configuratie

```bash
cd /opt/immoradar-pro/deploy
cp production.env.example .env.production
openssl rand -hex 32    # → POSTGRES_PASSWORD
openssl rand -hex 32    # → SESSION_SECRET
nano .env.production
chmod 600 .env.production
```

Vul `DOMAIN`, `ACME_EMAIL`, beide geheimen en `LEGAL_ENTITY_ADDRESS` /
`LEGAL_CONTACT_EMAIL` in. `TELEGRAM_BOT_TOKEN` blijft leeg tijdens de pilot.

## 7. Starten

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs -f app
```

De eerste build duurt enkele minuten. Klaar als je in de log `Ready` ziet.
Controle vanaf je laptop: `https://app.jouwdomein.be/api/ready` geeft
`{"status":"ready"}`.

De app weigert te starten met een te kort geheim of zonder https-adres; dan
staat de reden bovenaan de log.

## 8. Jouw beheerdersaccount

```bash
docker compose --env-file .env.production exec -e BOOTSTRAP_ADMIN_EMAIL=jij@jouwdomein.be app npm run bootstrap:admin
```

Het tijdelijke wachtwoord verschijnt één keer. Log in op `https://app.jouwdomein.be/login`
en kies een eigen wachtwoord. Daarna: **Kantoren → Nieuw kantoor** voor de eerste pilot.

## Dagelijks gebruik

| Wat | Commando (in `/opt/immoradar-pro/deploy`) |
| --- | --- |
| Status | `docker compose --env-file .env.production ps` |
| Logs | `docker compose --env-file .env.production logs --tail 200 app worker` |
| Back-ups bekijken | `docker compose --env-file .env.production exec backup ls -lh /backups` |
| Account ontgrendelen | `docker compose --env-file .env.production exec -e UNLOCK_EMAIL=… app npm run unlock:user` |
| Kantoor wissen (einde pilot) | `docker compose --env-file .env.production exec -e PURGE_AGENCY=<slug> -e PURGE_CONFIRM=<slug> app npm run agency:purge` |

## Nieuwe versie uitrollen

Zelfde upload als stap 5 (de map wordt overschreven, `deploy/.env.production`
blijft staan omdat het niet in het archief zit), dan:

```bash
cd /opt/immoradar-pro/deploy
docker compose --env-file .env.production up -d --build
```

De app voert nieuwe migraties zelf uit bij het opstarten.

## Back-ups en herstel

Twee lagen:

1. **Hetzner-back-ups:** de hele schijf, dagelijks, 7 stuks. Herstellen via de
   Console (server → Backups → Rebuild).
2. **Database-dumps:** elke nacht een `pg_dump`, 14 dagen bewaard op de server.

De dumps staan op dezelfde server. Kopieer er wekelijks één naar je laptop, zodat
een verloren server niet ook je back-ups meeneemt:

```powershell
scp root@<IP>:/var/lib/docker/volumes/immoradar_backups/_data/<bestand>.dump .
```

**Hersteltest (één keer per kwartaal):** zet een dump terug in een lege database
en kijk of je kunt inloggen:

```bash
docker compose --env-file .env.production exec -T db createdb -U immoradar herstel_test
docker compose --env-file .env.production exec -T backup sh -c 'pg_restore -h db -U immoradar -d herstel_test /backups/<bestand>.dump'
docker compose --env-file .env.production exec -T db psql -U immoradar -d herstel_test -c 'select count(*) from "Agency"'
docker compose --env-file .env.production exec -T db dropdb -U immoradar herstel_test
```

## Bewaking

Zet een gratis uptime-monitor (bv. UptimeRobot of Better Stack) op
`https://app.jouwdomein.be/api/ready` met een melding naar je gsm.
