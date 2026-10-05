# Privacy en tenantscheiding

Dit systeem bewaart twee soorten persoonsgegevens, en ze verdienen een andere
behandeling.

| | Herkomst | Zichtbaar voor | Bewaartermijn |
| --- | --- | --- | --- |
| **`SellerIdentity`** | publieke advertenties | alle kantoren | `RETENTION_SELLER_CONTACT_DAYS` (180 d) |
| **`CrmContact`** | het kantoor zelf | uitsluitend dat kantoor | `RETENTION_CRM_CONTACT_DAYS` (1825 d) |

Marktdata is publiek en daarom gedeeld. Een klantenbestand is dat nooit.

## De tenantgrens

De grens loopt langs drie modellen: `Opportunity`, `CrmContact` en `Alert`, plus
wat eraan hangt (`CrmInteraction`, `CrmImport`, `ContactPropertyRelationship`,
`Territory`, `AlertRule`).

Drie lagen bewaken hem:

**1. De sessie.** `requireAgencyScope()` bepaalt namens welk kantoor je handelt.
Een platformbeheerder heeft geen `agencyId` en wordt door diezelfde functie
geweigerd op kantoorschermen. Dat "alles mogen" niet hetzelfde is als "namens
iedereen kunnen handelen" is opzet: zou een beheerder als kantoor A kunnen
doorgaan, dan belanden zijn handelingen in de audittrail van dat kantoor alsof
zij het deden.

**2. De query.** Elke repository zet `agencyId` in de `where`. Bij schrijfacties
met `updateMany` in plaats van `update`:

```ts
// Raakt nul rijen als de kans van een ander kantoor is. Een `update` op id
// alleen zou wél schrijven.
await prisma.opportunity.updateMany({ where: { id, agencyId }, data })
```

**3. De test.** `tests/tenancy.test.ts` leest de broncode en faalt op een query
op tenant-eigen data zonder kantoorgrens. Dat vangt de fout die in de praktijk
gemaakt wordt: niet een verkeerd geschreven `where`, maar een vergéten `where` in
een query die volgende maand wordt toegevoegd.

Uitzonderingen staan in diezelfde test, met naam en reden. Een uitzondering op de
tenantgrens hoort een opgeschreven beslissing te zijn, niet iets wat je ontdekt
door de query te lezen.

### Wat een platformbeheerder ziet

Aantallen, nooit inhoud. `/admin/agencies` toont per kantoor hoeveel contacten,
kansen en meldingen er zijn — en heeft geen enkele doorklik naar de contacten
zelf. Zou dat scherm die doorklik hebben, dan kreeg de belofte "geen enkel ander
kantoor kan het zien" een uitzondering, en één uitzondering maakt de belofte
waardeloos.

## Wat er niet gebeurt

- **Geen enkele tenant verrijkt een andere.** Het klantenbestand van kantoor A
  wordt nooit gebruikt om een kans van kantoor B te scoren, te matchen of te
  verrijken. Er bestaat in het schema geen pad van `SellerIdentity` naar
  `CrmContact` — precies om te voorkomen dat zoiets langs een gedeelde
  marktverkoper mogelijk wordt.
- **Geen persoonsgegevens in de logs.** De logger redigeert op sleutelnaam
  (`phone`, `email`, `token`, `chatId`, `password`, `secret`, …) en doet dat
  centraal, niet op de aanroepplek. Een `logger.info('kans', { seller })` diep in
  de pijplijn mag geen telefoonnummer laten weglekken omdat de schrijver van die
  regel er niet aan dacht. `tests/tenancy.test.ts` bewaakt dat de lijst niet
  stilletjes uitgedund wordt.
- **Geen persoonsgegevens in de audittrail.** Daar staan verwijzingen — entiteit
  en id — en geen namen of nummers. Een audittrail die persoonsgegevens
  dupliceert is een tweede database die je moet beveiligen en opschonen.

## Dataminimalisatie

Van een CRM nemen we alleen over wat nodig is om (a) een slapende relatie te
herkennen en (b) een marktsignaal aan een bestaande klant te koppelen. Geen
dossiers, geen documenten, geen financiële gegevens. Het CRM van het kantoor
blijft de bron van waarheid; `externalId` is de weg terug.

De genormaliseerde velden (`phoneE164`, `emailNormalized`, `nameNormalized`,
`addressMatchKey`) bestaan uitsluitend om te matchen. Ze staan náást de
originelen en vervangen ze niet: wat het kantoor invoerde is wat de makelaar op
zijn scherm ziet.

## Bewaartermijnen

`runRetention()` draait dagelijks vanuit de worker (of via
`POST /api/cron/maintenance`) en ruimt op in volgorde van gevoeligheid:

1. **Contactgegevens van verkopers** (`RETENTION_SELLER_CONTACT_DAYS`) — naam en
   telefoon worden gewist, de rij blijft. Zo verliezen bestaande advertenties hun
   relatie en dus hun geschiedenis niet.
2. **Ruwe bronpayloads** (`RETENTION_RAW_PAYLOAD_DAYS`, 14 d) — die bestaan
   alleen om parsingfouten te kunnen nakijken.
3. **Verwijderde advertenties** (`RETENTION_REMOVED_LISTING_DAYS`, 730 d).
4. **Ruwe importregels** (`RETENTION_IMPORT_ROWS_DAYS`, 90 d) — de kolommen
   zoals ze in het CSV stonden (namen, telefoons). Status en melding per regel
   blijven, zodat een import herleidbaar blijft zonder de persoonsgegevens.
5. **CRM-contacten zonder activiteit** (`RETENTION_CRM_CONTACT_DAYS`, 3650 d) —
   geanonimiseerd zoals bij een verzoek (hieronder). "Activiteit" = het laatste
   contact volgens het kantoor of een interactie; zonder die datums telt de
   aanmaakdatum. Bewust niet `updatedAt`: de LeadRevive-motor schrijft scores
   bij en zou elk contact eeuwig jong houden. Standaard tien jaar, omdat een
   kortere termijn dan vijf jaar de categorie "eerdere koper" wist op het moment
   dat ze relevant wordt. De termijn ligt uiteindelijk bij het kantoor; `0` zet
   de opruiming uit.

## Verwijderen op verzoek

Twee routines voor één persoon, beide met behoud van de niet-persoonlijke
geschiedenis:

```ts
redactSeller(sellerId)                // naam en telefoon weg, ook uit snapshots
redactCrmContact(agencyId, contactId) // contact, interacties, importregels,
                                      // notities bij kansen en meldingstekst
```

De rij blijft bestaan met `redactedAt`. Hem hard verwijderen zou de tijdlijn van
een pand of de importgeschiedenis van een kantoor kapotmaken — en die bevatten na
de redactie geen persoonsgegevens meer.

## Een kantoor wissen

Bij het einde van een pilot of contract (verwerkersovereenkomst, art. 9):

```bash
PURGE_AGENCY=<slug> PURGE_CONFIRM=<slug> npm run agency:purge
```

Alles hangt via `onDelete: Cascade` aan `Agency` — gebruikers, klantenbestand,
imports, kansen, meldingen, gebieden, abonnement — en verdwijnt in één
transactie. Het auditlog heeft geen relatie met `Agency`; de regels van dat
kantoor blijven, zonder `actor`, `ip` en `metadata`. Back-ups bevatten de
gegevens tot ze volgens hun cyclus vervangen worden.

Getest tegen een echte database in `tests/privacy.integration.test.ts`.

## Herkomst

Elk gegeven draagt zijn oorsprong:

- een advertentie wijst naar `Source` en houdt zijn `sourceUrl`, zodat elke kans
  controleerbaar is;
- een contact wijst naar `CrmImport` en `CrmImportRow`, met de ruwe rij en de
  gebruikte kolomtoewijzing;
- een wijziging door een import staat als veld-voor-veld diff op
  `CrmImportRow.changes`.

Dat laatste is wat *"nooit stilzwijgend overschrijven"* concreet maakt. Een lege
waarde overschrijft nooit een gevulde, een `UNKNOWN` zet geen vastgesteld type
terug, een oudere contactdatum verdringt geen recentere — en een halve export
(alleen een kolom "Voornaam") mag "Pieter Janssens" niet terugbrengen tot
"Pieter".

## Beveiliging

- Wachtwoorden met scrypt (OWASP-parameters), zelfbeschrijvend formaat zodat de
  kosten later verhoogd kunnen worden zonder bestaande hashes ongeldig te maken.
- Sessiecookies zijn HMAC-ondertekend, `httpOnly`, `sameSite=lax`, `secure` in
  productie. Zonder `SESSION_SECRET` van 32+ tekens start de applicatie in
  productie niet — web (`src/instrumentation.ts`) noch worker.
- Sessies zijn intrekbaar: het cookie draagt de `sessionVersion` van de
  gebruiker, en elke request controleert die tegen de database samen met
  `active`, de rol en het kantoor. Deactiveren, een wachtwoordwijziging en
  *Overal afmelden* beëindigen alle lopende sessies onmiddellijk.
- Inlogvergrendeling per account in de database (5 pogingen, oplopende
  wachttijd) en een plafond per IP-adres. Tijdelijke wachtwoorden van een
  beheerder moeten bij de eerste login vervangen worden.
- Een kantoor met een gepauzeerd, opgezegd of verlopen abonnement ziet zijn data
  niet meer, en de pijplijn maakt er geen kansen of meldingen meer voor.
- Alle invoer langs Zod: collectoruitvoer, formulieren, querystrings,
  cron-payloads.
- CSP, `X-Frame-Options: DENY`, `nosniff` en HSTS op elke response;
  `Cache-Control: no-store` op alles onder `/api`.
- De cron-routes staan uit zonder `CRON_SECRET`, accepteren alleen POST, en
  vergelijken het geheim in constante tijd.
- Een kans van een ander kantoor geeft **404**, niet 403 — dat laatste zou
  bevestigen dát er een kans met dat id bestaat.
