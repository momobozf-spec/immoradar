# Intake-scan en "bruikbare kans"

Vóór een pilot een aantal kansen belooft, moet je weten wat het kantoor aanlevert.
De intake-scan beantwoordt dat met **dezelfde regels als het product**
(`src/leadrevive/reviveEvaluation.ts`), op een CSV, zonder database.

```bash
npm run leadrevive:intake -- export.csv --postcodes 9000,9030,9040 --out intake-output
npm run leadrevive:intake -- export.csv --mask          # namen/nummers ingekort, voor schermafdrukken
npm run demo:leadrevive                                 # het fictieve voorbeeld
```

Uitvoer: `intake.md` (cijfers) en `intake.html` (van rommelige export naar
bellijst). De map `intake-output/` staat in `.gitignore`: een echte export bevat
persoonsgegevens. Draai de scan alleen op een bestand dat je onder een getekende
verwerkersovereenkomst kreeg, en verwijder de uitvoer na de pilot.

## Wat een bruikbare kans is

Een contact telt als **bruikbare kans** als het aan alle vier voldoet:

1. **Reden om te bellen.** LeadRevive deelt het in een van de zes categorieën in
   en de volgorde-score haalt de drempel van het product (`MIN_OPPORTUNITY_SCORE`, standaard 40):

   | Categorie | Voorwaarde (uit de export) |
   |---|---|
   | Slapende schattingsaanvraag | type = schatting, geen mandaat, ≥ 12 maanden stil |
   | Verloren mandaat | type = verkoper, status = verloren, adres bekend, ≥ 12 maanden stil |
   | Verloren verkoopprospect | type = verkoper, niet verkocht, ≥ 12 maanden stil |
   | Eerdere koper | type = koper, relatie ≥ 5 jaar, ≥ 12 maanden stil |
   | Oud-klant | was klant, ≥ 12 maanden stil, relatiescore ≥ 45 |
   | Nooit opgevolgd | geen enkel contactmoment, aanmaakdatum ≥ 1 maand geleden, geen huurder |

2. **Bereikbaar.** Er is een geldig Belgisch telefoonnummer of e-mailadres.
3. **In het werkgebied**, als het kantoor er een opgaf.
4. **"Nooit opgevolgd" telt alleen** als de export een kolom *laatste contact* heeft.
   Zonder die kolom weten we niet of iemand ooit gebeld is.

Een bruikbare kans is **een reden om te bellen, geen verkoopkans**. De score is
de volgorde op de lijst. Of iemand wil verkopen, weet niemand vóór het gesprek.

## Wat een kantoor moet aanleveren

| Kolom | Nodig? | Wat er gebeurt zonder |
|---|---|---|
| Naam (voor- en achternaam, of "Achternaam, Voornaam") | verplicht | rij is onbruikbaar |
| GSM/telefoon of e-mail | verplicht voor een bruikbare kans | kans is niet bereikbaar |
| Type contact (koper, verkoper, schatting, klant…) | sterk aanbevolen | geen categorie → geen kans |
| Aanmaakdatum | sterk aanbevolen | leeftijd relatie onbekend; "nooit opgevolgd" en "eerdere koper" vallen weg |
| Laatste contact | sterk aanbevolen | "hoe lang stil" onbekend; "nooit opgevolgd" telt niet |
| Adres + postcode | aanbevolen | geen koppeling aan een pand (lagere volgorde), geen gebiedsfilter |
| Status (verloren, verkocht…) | aanbevolen | geen onderscheid verloren mandaat / oud-klant |
| Klantnummer | nuttig | ontdubbelen bij een tweede import is minder zeker |

Minimum om een pilot te starten (voorstel): **≥ 500 unieke contacten**, waarvan
≥ 70 % met telefoon of e-mail, een kolom type en een kolom laatste contact of
aanmaakdatum. Onder die drempel is een pilot niet zinvol en zeg je dat eerlijk.

## Wat de scan op het fictieve voorbeeld oplevert

`demo/leadrevive/voorbeeld-export.csv`: 20 rijen van een niet-bestaand kantoor in Gent.

- 2 dubbele rijen samengevoegd (zelfde gsm in een ander formaat; zelfde naam op hetzelfde adres) → 18 contacten
- 12 bruikbare kansen in vijf categorieën, 6 contacten zonder reden om te bellen
  (recent gesproken, huurder, buiten het gebied, te weinig gegevens)
- dezelfde 18 contacten en 12 kansen als de echte import plus de nachtelijke
  LeadRevive-taak (lokaal nagerekend tegen PostgreSQL)

De verhouding (12 op 18) zegt **niets** over een echt kantoor: het voorbeeld is
gemaakt om elke categorie te tonen.

## Gevonden en opgelost tijdens het bouwen van deze scan

- De kolom "Laatste contact" werd voorgesteld als *naam* (patroon "contact").
  Opgelost: een exacte kop wint, daarna de langste treffer.
- "Janssens, Pieter" in een kolom *Naam* kwam volledig in de achternaam. Opgelost.
- De import ontdubbelde niet op naam + exact adres, terwijl de documentatie dat
  belooft. Opgelost: de repository gebruikt nu `findDuplicate`.
- Uit een CSV kwamen alleen schattingsaanvragen, oud-klanten en "nooit opgevolgd".
  Verloren mandaten, verkoopprospects en eerdere kopers haalden de relatiedrempel
  nooit, omdat een CSV geen interactiegeschiedenis draagt. Opgelost in
  `relationshipEngine.ts` en de scoring (weging v2), met tests.
- "Nooit opgevolgd" gold ook zonder enige datum en voor huurders. Opgelost.

Nog open: een huisnummer van vier cijfers (Antwerpsesteenweg 1100) levert geen
adressleutel op; zo'n contact krijgt geen pandkoppeling.
