# CRM ↔ markt matching

De vraag: *er staat een woning te koop — kent dit kantoor die verkoper al?*

Dit is het onderscheidende onderdeel van ImmoRadar. Een particuliere verkoop in
Gent is informatie die iedereen kan kopen. Dat die verkoper de man is aan wie dít
kantoor in 2019 dat huis verkocht, kan alleen dit kantoor weten.

## De fout die je niet mag maken

De twee fouten zijn niet gelijkwaardig, en de hele opzet volgt daaruit.

| Fout | Kosten |
| --- | --- |
| Een match missen | Een gemiste kans. Vervelend, onzichtbaar, herstelbaar. |
| Verkeerd matchen | De makelaar belt een vreemde alsof hij hem kent. Dat gesprek is niet te repareren. |

Daarom: **naamgelijkenis is nooit genoeg.** "Jan Peeters" komt in Vlaanderen
duizenden keren voor. Naam is een *versterker*, geen sleutel.

Die regel staat niet alleen in commentaar maar wordt afgedwongen: zonder een hard
signaal blijft de zekerheid onder `NAME_ONLY_CEILING` (0,45) en haalt de match de
reviewdrempel niet. `tests/matching.test.ts` controleert het van twee kanten —
naam alleen én naam plus dezelfde gemeente leveren allebei `null` op.

## Harde signalen

Elk hiervan verwijst naar iets unieks. Zonder minstens één is er geen match.

| Signaal | Zekerheid | Waarom |
| --- | --- | --- |
| Bekende pandrelatie | 0,97 | Geen gelijkenis maar een feit uit de eigen dossiers |
| Adres van het contact = het pand | 0,90 | De eigenaar verkoopt het huis waar hij woont |
| Telefoonnummer, exact | 0,88 | Een Belgisch gsm-nummer hoort bij één persoon |
| E-mailadres, exact | 0,86 | Bijna even sterk; gezinnen delen soms een adres |

De pandrelatie staat bovenaan en niet het telefoonnummer. Nummers wisselen van
eigenaar; huizen niet.

## Versterkers

Verhogen de zekerheid, maar dragen nooit een match alleen:

- naam komt overeen — minder waard bij een veelvoorkomende achternaam;
- zelfde postcode of gemeente;
- contacttype past bij een verkoopsignaal (verkoper, schattingslead).

Ze werken vermenigvuldigend op de resterende twijfel, niet optellend. Vier zwakke
aanwijzingen komen daardoor niet automatisch op 100% uit.

## Drie uitkomsten

```text
≥ CRM_MATCH_AUTO_THRESHOLD    (0,80)   feit        — telt mee in de score
≥ CRM_MATCH_REVIEW_THRESHOLD  (0,55)   te bevestigen — getoond met een slag om de arm
daaronder                              geen match  — bestaat niet
```

Het middengebied is geen halfslachtigheid maar het eerlijke antwoord. De UI zegt
het ook: *"Mogelijke match (68%) — bevestiging nodig"*, met daaronder de
waarschuwing om de relatie niet in het gesprek te gebruiken voordat ze
gecontroleerd is. Alertregels met `requireCrmMatch` negeren dit niveau.

## De tenantgrens

De kandidaten komen **uitsluitend** uit het klantenbestand van het kantoor
waarvoor gerekend wordt. De matcher zelf kan dat niet controleren — hij ziet
alleen wat hij krijgt — en daarom haalt `crmRepository.findMatchCandidates` ze
altijd op met een `agencyId`-filter, en bewaakt `tests/tenancy.test.ts` dat die
regel niet stilletjes verdwijnt.

Er bestaat in het schema geen pad van een gedeelde `SellerIdentity` naar een
`CrmContact`. Dat is bewust: zou een verkoper naar contacten wijzen, dan kon
kantoor A langs een gedeelde marktverkoper bij het klantenbestand van kantoor B
komen.

## Kandidaatselectie

De matcher is nauwkeurig maar duur. Hem op alle contacten loslaten zou bij
vijfduizend contacten per kantoor een tafelscan per advertentie betekenen.
Kandidaten komen daarom langs vier geïndexeerde wegen:

```text
phoneE164        exact
emailNormalized  exact
addressMatchKey  postcode:straat:huisnummer — dezelfde vorm als Property.matchKey
nameNormalized   alleen als kandidaat, nooit als bewijs
```

Dat `CrmContact.addressMatchKey` en `Property.matchKey` dezelfde vorm hebben is
geen toeval: het maakt een CRM-adres en een advertentieadres direct vergelijkbaar
zonder tussenstap.

## Het scherpste geval

`ContactPropertyRelationship` legt vast dat het kantoor weet dat contact X bij
pand Y hoort — uit een verkoop, een aankoop of een schatting.

Er zit een gat in de tijd: een kantoor importeert vandaag *"Pieter kocht
Kerkstraat 12"*, maar dat pand bestaat bij ons pas wanneer het geadverteerd
wordt. `attachRelationshipsToProperty` sluit dat gat achteraf: zodra het pand
voor het eerst opduikt, worden alle losse CRM-adressen die erop passen eraan
gekoppeld.

Dat is de enige schrijfquery in het systeem die over kantoren heen loopt, en dat
is correct: elke rij houdt zijn eigen `agencyId`, en het enige veld dat gevuld
wordt is `propertyId` — een verwijzing naar gedeelde marktdata. Kantoor A ziet
daarna zijn eigen contact bij dat pand, kantoor B het zijne. De uitzondering
staat met reden in `tests/tenancy.test.ts`.

## Wat een match oplevert

```json
{
  "contactId": "…",
  "confidence": 0.99,
  "isKnownOwner": true,
  "reasons": [
    "Staat in jullie dossier als betrokkene bij dit pand",
    "Zelfde telefoonnummer als in jullie CRM",
    "Naam komt overeen (Pieter Janssens)"
  ]
}
```

De `reasons` staan letterlijk op de detailpagina onder *"Waarom wij denken dat
dit dezelfde persoon is"*. Een makelaar die op het punt staat te bellen met
*"Pieter, met Thomas"* moet kunnen zien waaróp dat berust — en zelf kunnen
beslissen of hij het gebruikt.
