# De opportunity-motor

Van "de prijs is gezakt" naar "bel deze mensen vandaag".

## Feit versus oordeel

Er zitten twee soorten dingen in dit systeem, en ze horen niet door elkaar te
lopen.

Een **`ListingEvent`** is een feit over de markt: de prijs zakte, de advertentie
verdween, het pand kwam terug. Feiten zijn voor iedereen hetzelfde en staan in de
gedeelde laag.

Een **`Opportunity`** is een oordeel: dit is het waard dat een makelaar er tijd
in steekt. Dat oordeel hangt af van wie er kijkt — welk gebied, welk
klantenbestand — en staat dus per kantoor.

Eén prijsdaling in Gent levert daarom voor kantoor A een koude particuliere
verkoop op, voor kantoor B een oud-klant uit 2017, en voor kantoor C helemaal
niets omdat Gent buiten hun gebied ligt.

## De gebeurtenissen

| Event | Wanneer |
| --- | --- |
| `NEW_LISTING` | eerste waarneming |
| `FSBO_DETECTED` | verkoper is met voldoende zekerheid particulier |
| `PRICE_DROP` / `PRICE_INCREASE` | prijswijziging boven `PRICE_CHANGE_MIN_PERCENT` |
| `STALE_30` / `STALE_60` / `STALE_90` | leeftijdsdrempel gepasseerd |
| `LISTING_REMOVED` | na `COLLECTOR_MISSING_RUNS_BEFORE_REMOVED` gemiste runs |
| `RELISTED` | hetzelfde pand opnieuw aangeboden binnen `RELIST_WINDOW_DAYS` |
| `AGENCY_TO_PRIVATE` / `PRIVATE_TO_AGENCY` | verkopertype sloeg om |

De drie stale-drempels zijn aparte typen en geen parameter op één `STALE`-event.
Dat is geen cosmetiek: het dashboard filtert erop, de scoring weegt ze
verschillend, en *"staat 90 dagen online"* is commercieel een ander gesprek dan
*"staat 30 dagen online"*.

### Twee vormen van terughoudendheid

**Een gemiste run is geen intrekking.** Bronnen paginëren, haperen, doen
onderhoud en filteren soms tijdelijk anders. Een advertentie die we deze run niet
zagen gaat eerst naar `MISSING` en pas na meerdere opeenvolgende runs naar
`REMOVED`. Zou je er meteen `LISTING_REMOVED` van maken, dan volgt bij de
volgende run een `RELISTED` — en heeft de makelaar een melding gekregen over een
herplaatsing die nooit gebeurd is.

**Kleine prijswijzigingen zijn ruis.** Bronnen ronden af, corrigeren typefouten
en wisselen soms tussen "vanaf"-prijs en vraagprijs. 200 euro op 495.000 is geen
marktsignaal.

## Van gebeurtenis naar kans

```text
FSBO_DETECTED        + zeker particulier  → NEW_FSBO
STALE_30/60/90       + zeker particulier  → STALE_FSBO
PRICE_DROP           + zeker particulier  → PRIVATE_PRICE_DROP
  … bij ≥ 2 verlagingen                   → PRIVATE_MULTIPLE_PRICE_DROP
RELISTED             + zeker particulier  → PRIVATE_RELIST
AGENCY_TO_PRIVATE                         → AGENCY_TO_PRIVATE
```

**Alleen particuliere verkopers.** Een prijsdaling bij een collega-kantoor is
marktinformatie — die hoort in de Marktradar, niet in de werklijst. Daar valt
geen mandaat te winnen; het pand ís al gegund. Er als kans over melden vult de
lijst met werk dat niets oplevert, en dat is de snelste manier om een makelaar
zijn meldingen te laten uitzetten.

**Twee uitzonderingen op die regel, allebei met reden.**

`AGENCY_TO_PRIVATE` eist geen zekere particulier-classificatie. De overstap zelf
is het signaal: dat een woning van een kantoor naar een eigenaar gaat betekent
dat het mandaat weg is, ook als we de nieuwe verkoper nog niet met 85% zekerheid
hebben ingedeeld. De eventdetectie stelde al vast dát het type omsloeg.

Een tweede prijsverlaging krijgt een eigen type. Eén verlaging kan een correctie
zijn; twee is een verkoper die beweegt, en dat is het moment waarop een gesprek
over een mandaat kans maakt. In één type stoppen zou dat verschil onzichtbaar
maken in de lijst.

## Eén kans per pand

Dit is de belangrijkste ontwerpbeslissing in deze laag, en ze is niet vanzelf
goed gegaan.

Eén woning brengt in de loop van maanden een reeks signalen voort: FSBO
gedetecteerd, dertig dagen gepasseerd, prijs omlaag, ingetrokken, opnieuw
geplaatst. Per gebeurtenis een kans zou dat huis **zes keer** in de ochtendlijst
zetten. Per type nog altijd vier keer.

Het is één keer bellen — naar dezelfde eigenaar, over hetzelfde huis. Een
makelaar die dezelfde woning vier keer ziet, vertrouwt de rangschikking niet
meer, en dan is "Vandaag" geen selectie meer maar een logboek.

De dedupe-sleutel is daarom `property:{propertyId}` per kantoor. Een volgend
signaal **versterkt** de bestaande kans in plaats van een nieuwe te maken:

```text
score omhoog?          ja  → bijwerken, en het type volgt de sterkste reden
score gelijk of lager? nee → laten staan
al opgepakt?           nee → nooit aanraken
```

Die laatste regel telt. Zodra een makelaar de kans heeft opgepakt (`CONTACTED` en
verder) blijft ze onaangeroerd: de score aanpassen onder iemands handen verandert
de volgorde van zijn lijst terwijl hij aan het bellen is, en overschrijft de
historie waar de analytics op steunen.

De volledige reeks gebeurtenissen blijft zichtbaar in de **tijdlijn van het
pand**, waar ze hoort — dat is een geschiedenis, geen takenlijst.

## Levensduur

Niet alle kansen verouderen even snel.

| Type | Vervalt na | Waarom |
| --- | --- | --- |
| `NEW_FSBO` | 14 d | Over een week hebben er al vijf kantoren gebeld |
| `PRIVATE_PRICE_DROP` | 21 d | Het momentum van de verlaging is dan weg |
| `STALE_FSBO` | 45 d+ | Verandert nauwelijks; over een maand nog steeds een gesprek waard |
| LeadRevive-types | 90 d+ | Die lagen er al twee jaar |

## De acquisitiepijplijn

```text
NEW → ASSIGNED → TO_CONTACT → CONTACTED → INTERESTED
    → VALUATION_BOOKED → MANDATE_PROPOSED → MANDATE_WON
                                          ↘ LOST / DISMISSED / SNOOZED
```

Bewust licht. Dit vervangt het CRM van het kantoor niet; het houdt bij hoever
déze kans staat. Elke overgang landt in `OpportunityActivity`, en dat is waar de
analytics op steunen — zonder die rijen is "conversie" een gok.

Toewijzingen zijn een geschiedenis (`OpportunityAssignment`) en geen kolom:
*"deze lead is drie keer doorgegeven"* is managementinformatie die je kwijt bent
zodra je alleen de huidige eigenaar bewaart.

## Wat de analytics wél en niet zeggen

Er staat nergens dat ImmoRadar mandaten heeft opgeleverd. Dat zou een causale
claim zijn die deze gegevens niet kunnen dragen: een makelaar die een kans
opvolgt en het mandaat wint, had die eigenaar misschien ook zonder ons gesproken.

Wat er wél staat is wat er in de opvolging geregistreerd is. Conversie wordt
bovendien gerekend over kansen die een **eindstatus** bereikt hebben, niet over
alle kansen — anders daalt het percentage elke ochtend automatisch doordat er
nieuwe kansen bijkomen die niemand nog heeft kunnen bellen, en meet het cijfer de
instroom in plaats van het werk.
