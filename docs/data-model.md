# Datamodel

Het schema staat in [`prisma/schema.prisma`](../prisma/schema.prisma), met de
verantwoording bij elke tabel. Dit document geeft het overzicht en de
beslissingen die het geheel bij elkaar houden.

## De vijf principes

1. **Het pand is de hoofdrolspeler, niet de advertentie.**
2. **Elke waarneming die iets nieuws zegt wordt bewaard.**
3. **De marktlaag is gedeeld, de commerciële laag is van één kantoor.**
4. **CRM-data verlaat nooit de tenant.**
5. **Persoonsgegevens staan per persoon op één rij.**

## De marktlaag — gedeeld

```text
Source ──< Listing >── Property
             │            │
             ├──< ListingSnapshot
             └──< ListingEvent >─┘
             │
      SellerIdentity ──> AgencyIdentity
```

### Property versus Listing

De belangrijkste scheiding in het model.

Een advertentie is vluchtig: hij verschijnt, verandert van prijs, wordt
ingetrokken en komt drie maanden later terug onder een nieuw id, bij een ander
kantoor, met een herschreven tekst. Het pand is er de hele tijd.

Alleen met `Property` als anker kun je zeggen: *dit huis staat al 210 dagen te
koop, bij twee kantoren, met drie prijsverlagingen* — en dat is precies wat een
makelaar aan de telefoon nodig heeft. Hing de geschiedenis aan de advertentie,
dan verloor je haar bij elke herplaatsing, en juist dan is ze op haar
interessantst.

`Property.matchKey` (`postcode:straat:huisnummer`) is puur een index om
kandidaten op te halen. De echte beslissing valt in de matcher, die veel meer
signalen weegt.

### ListingSnapshot

Eén rij per waarneming die iets nieuws zegt — dus alleen als de `contentHash`
verschilt. Elke run een rij zou de tabel honderd keer zo groot maken zonder één
extra feit toe te voegen.

De `contentHash` bevat bewust **niet** `scrapedAt` en **niet** de URL. Zou
`scrapedAt` meetellen, dan verschilt de hash bij elke run. Een URL kan wijzigen
door een trackingparameter zonder dat de advertentie anders is geworden.

Snapshots zijn de bron van waarheid. Alles daarboven is afgeleid en
herberekenbaar — dat is de reden dat een verkeerd gedetecteerde prijsdaling te
repareren is.

### SellerIdentity

Een verkoper zoals wij hem uit publieke advertenties kennen. Bewust mager: alleen
wat nodig is om particulier van professioneel te scheiden en om contact te kunnen
opnemen.

Telefoon in E.164 en `@unique`, zodat hetzelfde nummer uit twee bronnen tot één
verkoper leidt in plaats van tot twee halve leads — waarop de
professioneel-detectie ("deze verkoper heeft acht advertenties") haar basis
verliest.

Let op het verschil met `CrmContact`: dít is een publiek waargenomen identiteit,
gedeeld tussen alle kantoren. Er loopt in het schema géén relatie van hier naar
een contact, juist om te voorkomen dat kantoor A langs een gedeelde verkoper bij
het klantenbestand van kantoor B komt.

### ListingEvent

Hangt aan zowel de advertentie als het **pand**. Die tweede kolom lijkt
overbodig en is het niet: de tijdlijn van een pand loopt over meerdere
advertenties heen, en zonder deze kolom zou de belangrijkste view van het product
een join over herplaatsingsketens moeten maken.

`dedupeKey` is `@unique`. Als index en niet als `if (bestaat) return`, omdat twee
workers die tegelijk dezelfde advertentie verwerken die controle allebei zouden
passeren.

## De tenantlaag — per kantoor

```text
Agency ──< User
   ├──< Territory
   ├──< AlertRule ──< Alert
   ├──< CrmContact ──< CrmInteraction
   │        ├──< ContactPropertyRelationship >── Property
   │        └──< CrmImportRow >── CrmImport
   └──< Opportunity
            ├──< OpportunityReason
            ├──< OpportunitySignal
            ├──── OpportunityScore  (1:1)
            ├──< OpportunityAssignment
            └──< OpportunityActivity
```

### CrmContact

Wat we van een CRM overnemen, en niet meer: genoeg om een slapende relatie te
herkennen en om een marktsignaal aan een bestaande klant te koppelen. Geen
dossiers, geen documenten, geen financiële gegevens. `externalId` is de weg terug
naar het bron-CRM.

De genormaliseerde velden (`phoneE164`, `emailNormalized`, `nameNormalized`,
`addressMatchKey`) bestaan uitsluitend om te matchen. Ze staan náást de
originelen: als het kantoor "Jan Van der Straeten" invoerde, is dat wat de
makelaar ziet.

`addressMatchKey` heeft dezelfde vorm als `Property.matchKey`. Dat is geen
toeval — het maakt een CRM-adres en een advertentieadres direct vergelijkbaar.

### ContactPropertyRelationship

Het scharnier tussen de CRM-laag en de marktlaag, en het scherpste signaal dat
het systeem kent: als het kantoor in 2019 een huis aan Pieter verkocht en dat
huis staat nu als particuliere verkoop online, dan is dat geen gelijkenis maar
een feit.

`propertyId` is optioneel. Een kantoor importeert vandaag *"Pieter kocht
Kerkstraat 12"*, maar dat pand bestaat bij ons pas wanneer het geadverteerd
wordt. Het adres staat er daarom los bij, zodat de koppeling later alsnog kan
ontstaan.

### Opportunity

Drie herkomsten in één tabel:

| `origin` | Marktkant | CRM-kant |
| --- | --- | --- |
| `MARKET` | gevuld | leeg |
| `LEADREVIVE` | leeg | gevuld |
| `CROSS` | gevuld | gevuld |

Eén tabel en niet drie, omdat de makelaar 's ochtends **één** lijst nodig heeft,
geordend op wat het meest oplevert. Drie tabellen zouden drie lijsten opleveren,
en dan moet hij zelf de rangorde bepalen — precies het werk dat dit product uit
handen hoort te nemen.

De prijs daarvan is dat `propertyId`, `listingId` en `sourceEventId` optioneel
zijn. Wat altijd geldt: `origin` zegt welke kant gevuld is.

`@@unique([agencyId, dedupeKey])` met `dedupeKey = property:{id}` zorgt voor één
open kans per pand per kantoor. Zie
[opportunity-engine.md](opportunity-engine.md).

### Reason, Signal en Score

Drie tabellen die op elkaar lijken en verschillende dingen doen:

- **`OpportunityReason`** — de *uitleg*, als rijen zodat het dashboard erop kan
  filteren en de scoring achteraf te verantwoorden is.
- **`OpportunitySignal`** — de *invoer*, vóór weging. Verander je de weging, dan
  verandert de uitleg mee; de signalen die destijds waargenomen zijn horen te
  blijven staan.
- **`OpportunityScore`** — de opbouw per dimensie plus `weightsVersion`, zodat
  *"waarom 97?"* beantwoordbaar blijft nadat de configuratie gewijzigd is.

### Assignment en Activity

Toewijzing is een geschiedenis en geen kolom: *"deze lead is drie keer
doorgegeven"* is managementinformatie die je kwijt bent zodra je alleen de
huidige eigenaar bewaart. De rij met `unassignedAt = null` is de actuele
toewijzing.

`OpportunityActivity` draagt de analytics. Zonder die rijen is "conversie" een
gok.

## Indexen

Aangelegd op de queries die het product daadwerkelijk draait:

| Index | Voor |
| --- | --- |
| `Opportunity(agencyId, status, score desc)` | de startpagina — de belangrijkste query |
| `Opportunity(agencyId, origin, status)` | LeadRevive en de tellers |
| `Property(matchKey)` | kandidaatselectie bij matching |
| `Property(postalCode, propertyType)` | kandidaten zonder huisnummer |
| `Listing(sourceId, sourceListingId)` uniek | de identiteit van een advertentie |
| `ListingEvent(propertyId, occurredAt desc)` | de tijdlijn van een pand |
| `CrmContact(agencyId, phoneE164)` | CRM-matching op telefoon |
| `CrmContact(agencyId, addressMatchKey)` | CRM-matching op adres |
| `SellerIdentity(phoneE164)` uniek | één verkoper per nummer |

Elke index op tenantdata begint met `agencyId`. Dat is geen stijlkeuze: het is de
kolom waarop élke query filtert.

## Enums als contract

Statussen en typen zijn enums en geen vrije strings. Een typefout in
`'MANDATE_WON'` hoort een compilatiefout te zijn en geen kans die stilzwijgend
uit elke telling verdwijnt.

Dezelfde waarden staan in `src/domain/schemas.ts` als Zod-enums, zodat
formulierinvoer en databasewaarden niet uit elkaar kunnen lopen.
