# LeadRevive

De helft van het product die geen enkele externe bron nodig heeft: de kansen die
al in het eigen klantenbestand zaten.

## De belofte, en de eerlijkheid die erbij hoort

Wat LeadRevive oplevert is een **signaal**, geen vaststelling.

Dat iemand in 2024 een schatting aanvroeg en sindsdien niets liet horen, betekent
niet dat hij nu wil verkopen. Het betekent dat er ooit een aanleiding was om over
verkopen na te denken, dat zo'n aanleiding zelden verdwijnt, en dat niemand er
sindsdien naar gevraagd heeft.

Die nuance is niet vrijblijvend. Een makelaar die deze lijst leest als
"verkopers" belt met de verkeerde toon en verbrandt precies de relatie die het
product wilde benutten. Daarom staat op het scherm zelf wat we wél en niet weten,
en draagt elke categorie de reden waarom hij bovenkomt.

## Importeren

CSV, en bewust alleen CSV. Elk Belgisch makelaarskantoor kan binnen twee minuten
een export maken uit welk systeem dan ook. Een API-koppeling vraagt toegang,
documentatie, een contract en een testomgeving per aanbieder — en levert precies
dezelfde contacten op. Voor het bewijzen van de waarde is dat verschil pure
vertraging. De adapterlaag bestaat wél al; zie
[adding-a-crm-adapter.md](adding-a-crm-adapter.md).

### Wat een echte export bevat

```text
"Janssens, Pieter"      achternaam eerst, of juist niet
PIETER JANSSENS         volledig in kapitalen
0475/12.34.56           vier notaties voor hetzelfde nummer
15/03/2019              dag-eerst — 03/04 is 3 april, niet 4 maart
koper                   het type in het Nederlands, Frans of als eigen code
""                      leeg, wat "onbekend" betekent en niet "geen"
```

Elk van die dingen verkeerd begrijpen kost een match. En een gemiste match is
hier niet neutraal: dan blijft precies het contact onzichtbaar dat het product
had moeten opleveren.

De datumlezing verdient aparte vermelding. `new Date("03/04/2019")` geeft 4
maart — de Amerikaanse lezing. Elke Belgische export bedoelt 3 april. Eén maand
ernaast klinkt onschuldig tot je bedenkt dat de hele motor op *"hoe lang is het
stil"* draait: bij een verkeerd gelezen datum verschuift de dormantiegrens, en
verschijnen er contacten in de lijst die er niet horen of andersom.

### Twee stappen, nooit één

Een import raakt het klantenbestand van het kantoor — de gevoeligste data in dit
systeem, en de enige die wij niet kunnen herstellen als hij verkeerd landt. Eén
knop "upload en verwerk" zou betekenen dat een verkeerd geraden kolom duizend
contacten met de verkeerde naam of datum wegschrijft voordat iemand het ziet.

Dus: eerst analyseren en tonen wat we begrijpen, mét voorbeeldwaarden per kolom;
pas daarna schrijven, en alleen op wat de gebruiker bevestigd heeft. De
uiteindelijke toewijzing komt op `CrmImport.columnMapping` te staan, want een
verkeerde mapping valt vaak pas weken later op en moet dan te herleiden zijn.

### Deduplicatie

De rangorde van sleutels, van hard naar zacht:

| Sleutel | Sterkte | Waarom |
| --- | --- | --- |
| `externalId` | exact | Het kantoor zegt zelf dat dit hetzelfde record is |
| telefoon (E.164) | sterk | Een Belgisch gsm-nummer hoort bij één persoon |
| e-mail | sterk | Bijna even sterk; gezinnen delen soms een adres |
| naam **+** exact adres | zwak | Samen identificerend, apart niet |

Naam alleen voegt nooit samen. De asymmetrie is dezelfde als overal in dit
systeem: te weinig ontdubbelen geeft een dubbel record — zichtbaar en met een
tweede import te herstellen. Te veel ontdubbelen maakt van twee mensen één, en
dan zijn de gegevens van de een door de ander overschreven en is de
oorspronkelijke scheiding weg.

De naamsleutel is volgorde-ongevoelig (woorden gesorteerd), omdat ongeveer de
helft van de exports "Janssens, Pieter" schrijft en de andere helft "Pieter
Janssens" — soms binnen één bestand.

### Nooit stilzwijgend overschrijven

Vier regels, elk met een geval erachter:

1. **Een lege waarde overschrijft nooit een gevulde.** Een export waarin de
   notitiekolom ontbreekt zou anders alle notities van het kantoor wissen.
2. **`UNKNOWN` zet geen vastgesteld type terug.** Dat de export het type niet
   meestuurt, is geen informatie.
3. **Datums schuiven alleen de goede kant op.** Een oudere contactdatum uit een
   oud bestand mag een recenter contactmoment niet ongedaan maken; de vroegste
   aanmaakdatum is juist wél de juiste, want daar begon de relatie.
4. **Een halve export verschraalt geen namen.** Een bestand met alleen een kolom
   "Voornaam" mag "Pieter Janssens" niet terugbrengen tot "Pieter". Dit is het
   verraderlijkste geval: er *wórdt* een waarde geschreven, dus geen enkele
   lege-waarde-controle grijpt in.

Wat er per rij gebeurde staat op `CrmImportRow`, inclusief een veld-voor-veld
diff bij een wijziging.

## Slapende relaties herkennen

Zes categorieën, van sterkst naar zwakst:

| Categorie | Wat we weten |
| --- | --- |
| **Slapende schattingsaanvraag** | Vroeg een schatting, werd geen mandaat, al maanden stil |
| **Verloren mandaat** | Mandaatgesprek ging niet door; pand bekend |
| **Verloren verkoopprospect** | Wilde eerder verkopen, sindsdien geen contact |
| **Eerdere koper** | Kocht via het kantoor, jaren geleden |
| **Oud-klant** | Was klant, al lang stil |
| **Nooit opgevolgde lead** | Kwam binnen en is nooit gebeld |

Er komt **maximaal één** categorie per contact uit. Twee kaarten voor dezelfde
persoon zou betekenen dat de makelaar dezelfde man twee keer belt.

### De drempels die ertoe doen

**Kopers wachten langer.** Wie vorig jaar kocht gaat dit jaar niet verkopen. De
drempel ligt daarom op vijf jaar in plaats van de gewone dormantiegrens van
twaalf maanden — Belgische eigenaars verhuizen gemiddeld na acht tot tien jaar.
Zou je elke koper na twaalf maanden opvoeren, dan is LeadRevive een adressenlijst
en geen selectie.

**Zonder tijdsanker geen signaal.** Een contact zonder enige datum levert niets
op: we zouden niet kunnen uitleggen waarom het vandaag opduikt.

**Nooit gecontacteerd valt terug op de aanmaakdatum.** Een lead die in 2021
binnenkwam en nooit is opgevolgd, is precies zo lang stil als hij bestaat. Zou je
daar "geen datum" van maken, dan verdwijnt de goedkoopste categorie — er is nooit
een gesprek geweest, dus er valt niets te herstellen, alleen te beginnen.

## De relatiescore

Hoeveel is een bestaande band waard op het moment dat er iets gebeurt?

Nadrukkelijk **niet** een voorspelling van verkoopintentie. Wat het wél is: hoe
kansrijk het gesprek is als je toch belt. Een oud-klant neemt op. Een
schattingsaanvraag van vorig jaar herinnert zich waarom hij die deed. Een naam
uit een gekochte lijst doet geen van beide.

De factoren en hun onderbouwing staan in [scoring.md](scoring.md).

## Waar het samenkomt

LeadRevive levert twee dingen:

1. **Zelfstandige kansen** — contacten met een aanleiding, zonder extern signaal.
   Zichtbaar op `/leadrevive`, met `origin = LEADREVIVE`.
2. **De relatiedimensie onder marktkansen** — als een marktsignaal aan een
   bestaand contact gekoppeld wordt, wordt het een `CROSS`-kans.

Dat tweede is waar het product zijn naam aan ontleent. Zie
[crm-matching.md](crm-matching.md).
