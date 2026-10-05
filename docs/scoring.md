# Scoring

Elke kans krijgt een getal van 0 tot 100. Dat getal is de sorteersleutel van het
hele product: het bepaalt wat een makelaar 's ochtends als eerste ziet.

## Wat de score betekent — en wat niet

> **Hoe kansrijk is het gesprek als je belt?**

Niet: hoe waarschijnlijk het is dat deze persoon wil verkopen. Dat onderscheid is
geen juridische voorzichtigheid maar de kern van het product. Leest een makelaar
94 als *"94% kans dat Pieter verkoopt"*, dan belt hij met de verkeerde
verwachting — en één zo'n gesprek is genoeg om het vertrouwen in het systeem
kwijt te zijn.

Die zin staat daarom op de detailpagina, onder de scoreopbouw, in het product
zelf.

## De vijf dimensies

Een kans is goed om verschillende, onafhankelijke redenen:

| Dimensie | Vraag | Bron |
| --- | --- | --- |
| **Intent** | Wat zegt de markt? | advertentie, prijsverloop, ouderdom |
| **Relationship** | Wat weet het kantoor al? | CRM-contact, interacties, pandrelatie |
| **Timing** | Is dit het moment? | hoe vers het signaal is |
| **Territory** | Is dit hun gebied? | postcode, gemeente, provincie |
| **Confidence** | Weten we zeker dat het klopt? | classificatiezekerheid, volledigheid |

Elke dimensie rekent apart naar 0–100. Pas daarna worden ze gewogen.

## Waarom niet gewoon optellen

De factoren uit de oorspronkelijke opzet zijn samen ruim 140 punten. Ze recht
optellen en afkappen op 100 heeft twee gevolgen die je niet wilt:

**Alles wordt 100.** Een lead met vier sterke signalen en een lead met acht zijn
dan even goed, terwijl de tweede duidelijk beter is. Een score die niet meer
onderscheidt is geen score maar een vinkje — en dan werkt de makelaar de lijst
gewoon van boven naar beneden af.

**Eén dimensie kaapt de score.** "Prijsverlaging" plus "meerdere verlagingen" is
twintig punten over hetzelfde feit: dat de verkoper beweegt. Zonder plafond per
groep weegt dat ene feit even zwaar als het volledige verkopersprofiel.

Vandaar: per dimensie een eigen schaal met eigen plafonds, en daarna een gewogen
gemiddelde over de dimensies die iets kunnen zeggen.

## De weging

```text
intent        40 %
relationship  22 %
timing        15 %
territory     11 %
confidence    12 %
```

Het marktsignaal weegt het zwaarst omdat het als enige zegt dat er *nu* iets
gebeurt. De relatie weegt zwaar maar minder, omdat ze niets over timing zegt: dat
je iemand kent maakt het gesprek makkelijker, niet dringender.

De gebruikte versie staat op elke kans (`OpportunityScore.weightsVersion`).
Verandert de weging, dan blijft van een kans van vorige maand herleidbaar volgens
welke regels hij zijn cijfer kreeg.

## Herverdeling: de dimensie die niets kan zeggen

Dit is de subtielste beslissing in het hele model.

Een verse particuliere verkoop van iemand die niet in het klantenbestand staat is
een **goede lead**. Zou `relationship = 0` gewoon meetellen, dan haalt zo'n kans
nooit meer dan ongeveer 75 en zakt hij onder een slapende relatie zonder enig
marktsignaal. Dat is de verkeerde volgorde: iemand die vandaag adverteert is
dringender dan een schattingsaanvraag van twee jaar geleden.

Omgekeerd geldt hetzelfde. Een LeadRevive-kans heeft per definitie geen extern
signaal; `intent = 0` zou hem structureel onderaan houden, en dan is de halve
productbelofte onzichtbaar.

**De regel:** een dimensie die niets kán zeggen doet niet mee, en haar gewicht
wordt over de overige verdeeld. In de UI is dat zichtbaar — de balk staat er
grijs bij met "telt niet mee".

## De kruisbonus

Een gewogen gemiddelde kan één ding principieel niet uitdrukken: dat markt én
relatie samen méér zijn dan de som.

```text
"Er staat een woning te koop in Gent"                        marktinformatie
"Pieter, aan wie jij in 2019 dat huis verkocht, verkoopt nu"  een gesprek
```

Middelen zou het tweede geval juist afvlakken. Daarom krijgt de combinatie een
expliciete bonus (maximaal 12 punten), die meeschaalt met de kracht van de
relatie én met de zekerheid van de koppeling — zodat een zwakke of twijfelachtige
match hem niet opstrijkt.

Dit is de these van het product, in één getal gemaakt.

## Wat er uitkomt

Uit de demodata, gesorteerd zoals de makelaar ze ziet:

```text
97  Particulier verlaagde de prijs   BEKENDE RELATIE · Luc Segers      Gent
94  Nieuwe particuliere verkoop      BEKENDE RELATIE · Pieter Janssens Gent
84  Particulier verlaagde meermaals                                    Sint-Amandsberg
76  Particulier verlaagde de prijs                                     Gent
62  Particulier, lang op de markt                                      Sint-Amandsberg
```

De twee bovenste zijn de kruisgevallen. Dat ze bovenaan staan is niet toevallig
en niet gestuurd: het is wat de weging oplevert.

## Uitleg als eerste-orde-gegeven

Elke kans draagt zijn redenen als **rijen** (`OpportunityReason`), niet als
JSON-blob. Daardoor is de uitleg filterbaar, telbaar en achteraf te
verantwoorden.

Daarnaast worden de ruwe signalen apart bewaard (`OpportunitySignal`) — vóór
weging. Verander je de weging, dan verandert de uitleg mee, maar de signalen die
destijds zijn waargenomen blijven staan. Zonder dat onderscheid is een score van
vorige maand niet meer te reconstrueren.

## De relatiescore apart

`relationshipScore` is los opgeslagen op elke kans, ook bij marktkansen. Zo kan
LeadRevive erop sorteren en kan een kantoor zien of een kans hoog scoort omdat de
markt schreeuwt of omdat ze de mensen kennen. Dat zijn twee verschillende
gesprekken, en één samengesteld getal zou het verschil verbergen.

De factoren, in volgorde van gewicht:

| Signaal | Waarom |
| --- | --- |
| Vroeg ooit een schatting aan | Het sterkste dat een CRM bevat: iemand dacht actief over verkopen na |
| Kantoor kent dit exacte pand | Geen gelijkenis maar een feit uit de eigen dossiers |
| Eerdere verkoper | Wilde ooit verkopen; dat werd geen mandaat |
| Eerdere koper | Belgische eigenaars verhuizen gemiddeld na acht tot tien jaar |
| Recent contact | Een gesprek van vorige maand opent makkelijker dan een van 2019 |
| Toenmalige makelaar nog in dienst | Wie de klant destijds sprak, hoeft zich niet voor te stellen |

## Afstellen

`src/scoring/config.ts` is de enige plek waar aan de weging te draaien valt.
`tests/scoring.test.ts` bewaakt daarbij niet de getallen maar de **uitspraken**:

- een bekende relatie weegt zwaarder dan dezelfde kans zonder;
- een particulier zwaarder dan een kantoor;
- twee prijsverlagingen zwaarder dan één;
- het eigen postcodegebied zwaarder dan de provincie;
- de score blijft altijd tussen 0 en 100 en draagt altijd een uitleg.

Verschuift een gewicht en blijven die uitspraken staan, dan is de afstelling in
orde. Vallen ze om, dan verkoopt het product iets anders dan het belooft.
