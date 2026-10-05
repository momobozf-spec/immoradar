# Architectuur

## De vorm van het systeem

ImmoRadar is één Next.js-applicatie met een achtergrondworker en één
PostgreSQL. Meer infrastructuur is er niet, en dat is een keuze: elke extra
component is een extra ding dat kan omvallen op een zaterdagochtend terwijl er
een verse particuliere verkoop in Gent staat waar niemand een melding over krijgt.

```text
┌──────────────┐        ┌──────────────┐
│   Next.js    │        │    Worker    │
│  dashboard   │        │ collectorlus │
│ + cron-routes│        │              │
└──────┬───────┘        └──────┬───────┘
       │                       │
       └───────────┬───────────┘
                   │
            ┌──────▼──────┐
            │ PostgreSQL  │
            └─────────────┘
```

App en worker delen alle code en dezelfde image; alleen het startcommando
verschilt. Ze zijn gescheiden omdat ze verschillend falen — een vastgelopen
collector mag het dashboard niet meeslepen, en een deploy van de webserver hoort
een lopende run niet af te breken.

## De lagen

De code loopt van buiten naar binnen. Elke laag kent alleen de laag onder zich.

```text
src/
  app/            schermen en serveracties     ← kent services
  services/       orkestratie per use case      ← kent repositories + domein
  repositories/   alle databasetoegang          ← kent Prisma
  ────────────────────────────────────────────────────────────
  collectors/     bronnen ophalen               ┐
  normalization/  ruwe data → canoniek model    │
  matching/       welk pand, welke persoon      │  puur, geen database,
  domain/         classificatie, geografie      │  geen netwerk, testbaar
  events/         verandering → marktsignaal    │  met twee objecten
  crm/            CSV, dedup, dormantie         │
  leadrevive/     relatiebeoordeling            │
  scoring/        vijf dimensies → 0–100        │
  territories/    gebied matchen                ┘
  lib/            datums, tekst, telefoon, log, env, sessie
```

### Waarom de onderste helft puur is

Alles onder `repositories/` is een functie van invoer naar uitvoer. Geen
database, geen netwerk, geen klok uit het niets — `now` komt altijd als argument
binnen.

Dat is geen zuiverheid om de zuiverheid. Het zijn de regels waar het product op
drijft, en ze moeten te controleren zijn met twee objecten in een test:

> *"prijs van 495.000 naar 465.000 op dag 64"* moet één `PRICE_DROP` opleveren met
> precies die percentages — en dat mag niet afhangen van wat er toevallig in de
> database staat.

Zodra een regel een repository nodig heeft om getest te worden, wordt hij in de
praktijk niet meer getest.

### Waarom repositories bestaan

Eén plek per model waar SQL vandaan komt. De belangrijkste reden is niet
netheid maar de tenantgrens: elke query op kantoor-eigen data moet `agencyId`
dragen, en die regel is alleen af te dwingen als de queries op een overzichtelijk
aantal plekken staan. `tests/tenancy.test.ts` leest de broncode en faalt op een
query die het vergeet.

## De pijplijn

Van een advertentie bij een bron tot een kaart in het dashboard:

```text
 1. collector          RawListing — alles optioneel, niets vertrouwd
 2. normalisatie       postcode gevalideerd, telefoon in E.164, adres gesplitst
 3. property matching  welk fysiek pand is dit?
 4. classificatie      particulier, professioneel of onbekend
 5. snapshot           alleen als de contentHash verschilt
 6. eventdetectie      NEW_LISTING, FSBO_DETECTED, PRICE_DROP, STALE_30…
 7. territory match    welke kantoren werken hier?
 8. CRM-matching       kent dít kantoor deze verkoper al?      (per kantoor)
 9. scoring            vijf dimensies → 0–100                  (per kantoor)
10. opportunity        één open kans per pand per kantoor
11. alert              Telegram, als de regels dat zeggen
```

Stap 7 is het scharnier. Alles daarvóór is marktdata en voor iedereen hetzelfde;
alles daarna is van één kantoor. Eén advertentie levert daarom voor kantoor A een
koude particuliere verkoop op en voor kantoor B een oud-klant uit 2017 — en dat
verschil is wat het product verkoopt.

## Idempotentie

De collector draait elke paar minuten. Zonder maatregelen zou een advertentie
van 64 dagen bij elke run opnieuw melden dat hij 60 dagen oud is.

Drie sloten, alle drie in de database en niet in de code:

| Waar | Sleutel | Wat het voorkomt |
| --- | --- | --- |
| `ListingEvent.dedupeKey` | uniek | dezelfde prijsdaling twee keer vastleggen |
| `Opportunity.agencyId + dedupeKey` | uniek | hetzelfde pand meerdere keren in de lijst |
| `Alert.dedupeKey` | uniek | twee berichten over dezelfde kans |

Ze staan als unique index en niet als `if (bestaat) return`, omdat twee workers
die tegelijk dezelfde advertentie verwerken die controle allebei zouden passeren.

## Snapshots als bron van waarheid

`ListingSnapshot` wordt alleen geschreven als de `contentHash` verschilt van de
vorige waarneming. Elke run een rij zou de tabel honderd keer zo groot maken
zonder één extra feit toe te voegen.

Alles daarboven — events, scores, tellers, kansen — is afgeleid en
herberekenbaar. Dat is de reden dat een verkeerd gedetecteerde prijsdaling te
repareren is: je gooit de events weg en draait ze opnieuw over de snapshots. Zou
de geschiedenis alleen in de events zitten, dan was elke fout permanent.

## Multi-tenancy

De grens ligt op drie modellen: `Opportunity`, `CrmContact` en `Alert` (plus wat
eraan hangt). Marktdata — `Property`, `Listing`, `Source`, `SellerIdentity` — is
gedeeld, omdat ze publiek is en voor iedereen dezelfde.

Drie lagen bewaken dat:

1. **De sessie** (`requireAgencyScope`) bepaalt namens welk kantoor je handelt.
   Een platformbeheerder heeft géén `agencyId` en wordt door dezelfde functie
   geweigerd op kantoorschermen — "alles mogen" is niet hetzelfde als "namens
   iedereen kunnen handelen".
2. **De repository** zet `agencyId` in de `where`. Bij schrijfacties met
   `updateMany`, zodat een rij van een ander kantoor nul treffers geeft in plaats
   van stilzwijgend te worden gewijzigd.
3. **De test** (`tests/tenancy.test.ts`) leest de broncode en faalt op een query
   die het vergeet. Uitzonderingen staan er met naam en reden in.

Zie [privacy.md](privacy.md).

## Configuratie

Alles wat aan drempels te draaien valt komt uit de omgeving, via één
gevalideerd schema (`src/lib/env.ts`). Een verkeerd getypte drempel —
`PRIVATE_CONFIDENCE_THRESHOLD="85"` in plaats van `"0.85"` — laat de applicatie
niet starten, in plaats van élke advertentie als particulier door te laten en
vijf kantoren tegelijk een onbruikbare melding te sturen.

De drempels zijn zichtbaar op **Instellingen**, maar niet aanpasbaar vanuit de
UI. Een classificatiedrempel verlagen verandert wie er gebeld wordt; dat hoort
een bewuste ingreep met een herstart te zijn, geen schuifje.

## Testbaarheid

```text
tests/
  normalization.test.ts   postcodes, adressen, telefoons, contentHash
  matching.test.ts        property matching, classificatie, CRM-matching
  events.test.ts          prijs, stale, intrekking, herplaatsing, kansregels
  crm.test.ts             CSV, kolomherkenning, dedup, dormantie, relatie
  scoring.test.ts         de vijf dimensies, ordening, territory
  tenancy.test.ts         tenantgrens op de broncode, logredactie, secrets
```

Geen enkele test raakt het netwerk of een echte site. De scoringtests
controleren bewust de *ordening* en niet de exacte getallen: een test die op "97"
staat blokkeert elke afstelling van de weging, terwijl de uitspraak die het
product doet — *een bekende relatie weegt zwaarder dan dezelfde kans zonder* —
wél moet blijven staan.
