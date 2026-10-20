# Verwerkersovereenkomst (art. 28 AVG) — CONCEPT

> **CONCEPT, GEEN JURIDISCH ADVIES.** Dit document is opgesteld als werkversie
> op basis van wat de software feitelijk doet. Het moet vóór ondertekening
> nagelezen worden door een jurist met ervaring in gegevensbescherming.
> Punten gemarkeerd met **[JURIST]** zijn open vragen; punten met **[INVULLEN]**
> zijn feitelijke gegevens die jij aanvult.
>
> De artikelnummers worden elders in de repo gebruikt (art. 7 bewaartermijnen,
> art. 8 inbreuken, art. 9 einde). Hernummer je, pas dan ook `docs/privacy.md`,
> `docs/DEPLOY.md` en de scripts aan.

---

**Tussen**

1. **[INVULLEN: naam kantoor]**, met zetel te [INVULLEN], KBO [INVULLEN], BIV-erkenning
   [INVULLEN], vertegenwoordigd door [INVULLEN], hierna "het Kantoor" of
   "Verwerkingsverantwoordelijke";

2. **[INVULLEN: jouw onderneming]**, met zetel te [INVULLEN], KBO/btw [INVULLEN],
   hierna "de Verwerker",

samen in het kader van de **LeadRevive-pilot** volgens het pilotvoorstel van
[INVULLEN: datum] (de "Hoofdovereenkomst").

## Artikel 1 — Onderwerp en rollen

1.1 Het Kantoor laat de Verwerker persoonsgegevens uit zijn eigen klantenbestand
verwerken om slapende relaties te identificeren en te ordenen (de "Dienst").

1.2 Voor die verwerking is het Kantoor verwerkingsverantwoordelijke en de Verwerker
verwerker in de zin van art. 4.8 AVG. De Verwerker verwerkt de gegevens uitsluitend
voor het Kantoor en voor geen enkel ander doel of andere klant.

1.3 De marktradar (publieke advertenties van particuliere verkopers) maakt **geen**
deel uit van de Dienst tijdens de pilot.

## Artikel 2 — Aard van de verwerking

Zie **Bijlage 1**: doel, categorieën van betrokkenen en gegevens, duur.

## Artikel 3 — Instructies

3.1 De Verwerker verwerkt alleen op schriftelijke instructie van het Kantoor. De
Hoofdovereenkomst, deze overeenkomst en de instellingen die het Kantoor in de
software kiest (werkgebied, gebruikers, imports) gelden als instructies.

3.2 Acht de Verwerker een instructie in strijd met de AVG, dan meldt hij dat
onmiddellijk.

## Artikel 4 — Vertrouwelijkheid

Alleen de Verwerker zelf heeft toegang tot de gegevens. [INVULLEN als er
medewerkers of onderaannemers zijn.] De beheersomgeving van het platform toont
van een klantenbestand uitsluitend aantallen, geen inhoud.

## Artikel 5 — Beveiliging

De Verwerker neemt de maatregelen van **Bijlage 2**. Hij past ze aan wanneer de
stand van de techniek of het risico dat vraagt, en meldt wijzigingen die het
beschermingsniveau verlagen vooraf.

## Artikel 6 — Subverwerkers

6.1 Het Kantoor geeft algemene toestemming voor de subverwerkers in **Bijlage 3**.

6.2 De Verwerker meldt een nieuwe of vervangende subverwerker minstens 30 dagen
vooraf. Het Kantoor kan binnen die termijn gemotiveerd bezwaar maken en, als geen
oplossing gevonden wordt, de Hoofdovereenkomst kosteloos beëindigen.

6.3 De Verwerker legt elke subverwerker minstens dezelfde verplichtingen op.

## Artikel 7 — Bewaartermijnen en rechten van betrokkenen

7.1 Gegevens worden bewaard zolang de Hoofdovereenkomst loopt. Binnen die looptijd
gelden de termijnen van Bijlage 1 (onder meer: ruwe importregels 90 dagen; contacten
zonder activiteit [INVULLEN: termijn, standaard 3650 dagen] — **[JURIST]** is tien
jaar verdedigbaar voor prospectiedoeleinden, of moet het kantoor een kortere termijn
kiezen?).

7.2 De Verwerker helpt het Kantoor bij verzoeken van betrokkenen (inzage,
verbetering, verwijdering, beperking, bezwaar). Een verzoek dat rechtstreeks bij
de Verwerker binnenkomt, stuurt hij binnen 3 werkdagen door; hij beantwoordt het
niet zelf.

7.3 Verwijdering van één persoon gebeurt binnen 5 werkdagen na de instructie van
het Kantoor (technisch: `redactCrmContact`).

## Artikel 8 — Inbreuken in verband met persoonsgegevens

8.1 De Verwerker meldt een inbreuk aan het Kantoor zonder onredelijke vertraging en
uiterlijk **24 uur** na ontdekking, met wat op dat moment bekend is (aard, betrokken
gegevens en aantallen, waarschijnlijke gevolgen, genomen maatregelen).

8.2 Het Kantoor beslist over melding aan de Gegevensbeschermingsautoriteit (72 uur)
en aan betrokkenen. De Verwerker verleent de nodige medewerking.

## Artikel 9 — Einde: teruggave en verwijdering

9.1 Bij het einde van de pilot of de Hoofdovereenkomst bezorgt de Verwerker op
verzoek van het Kantoor een volledige export (CSV) binnen 10 werkdagen.

9.2 Uiterlijk 30 dagen na het einde wist de Verwerker alle gegevens van het Kantoor
uit de productieomgeving en bevestigt hij dat schriftelijk.

9.3 Kopieën in back-ups verdwijnen volgens de back-upcyclus, uiterlijk 14 dagen na
het wissen. Tot dan worden ze niet gebruikt, behalve om een storing te herstellen.
**[JURIST]**: volstaat dit, of moet er een uitdrukkelijke afwijking van 9.2 staan?

## Artikel 10 — Informatie en audit

De Verwerker stelt alle informatie ter beschikking die nodig is om naleving aan te
tonen (deze overeenkomst, het register, de beschrijving in Bijlage 2) en staat een
audit toe, op kosten van het Kantoor, met een redelijke aankondigingstermijn van
[INVULLEN: 15] werkdagen.

## Artikel 11 — Doorgifte buiten de EER

De gegevens staan in de EU (Frankfurt). Render Services, Inc. is een Amerikaanse
onderneming; toegang vanuit de VS is technisch mogelijk voor support en beheer en
valt onder het EU-US Data Privacy Framework en de DPA van Render. **[JURIST]**:
bevestigen dat dit volstaat en dat het in de informatie aan betrokkenen vermeld
moet worden.

## Artikel 12 — Aansprakelijkheid

**[JURIST]**: aansprakelijkheidsregeling en eventuele beperking (bv. tot het
bedrag van de Hoofdovereenkomst, behalve bij opzet of grove fout), afgestemd op
je verzekering.

## Artikel 13 — Duur en toepasselijk recht

Deze overeenkomst loopt zolang de Verwerker gegevens van het Kantoor verwerkt.
Belgisch recht is van toepassing; bevoegd zijn de rechtbanken van [INVULLEN].

Opgemaakt te [INVULLEN] op [INVULLEN], in twee exemplaren.

| Voor het Kantoor | Voor de Verwerker |
|---|---|
| [naam, functie, handtekening] | [naam, functie, handtekening] |

---

## Bijlage 1 — Beschrijving van de verwerking

| | |
|---|---|
| **Doel** | Slapende relaties in het eigen klantenbestand van het Kantoor identificeren, indelen in categorieën en ordenen, zodat het Kantoor ze kan opvolgen. |
| **Betrokkenen** | Contacten in het klantenbestand van het Kantoor: (kandidaat-)verkopers, kopers, aanvragers van een schatting, oud-klanten, prospects, verhuurders/huurders. Gebruikers van het Kantoor (medewerkers). |
| **Gegevens** | Naam, telefoon, e-mail, adres van het pand of de woning, type contact en status, datum van aanmaak en laatste contact, vrije notities uit het CRM, naam van de behandelende makelaar. Medewerkers: naam, e-mail, rol, inloggegevens (gehasht). |
| **Geen** | Identiteitsdocumenten, rijksregisternummers, financiële gegevens, bijzondere categorieën (art. 9 AVG). **[INVULLEN]**: vraag het Kantoor zulke gegevens niet in de export op te nemen; notitievelden kunnen ze toch bevatten. |
| **Bron** | CSV/Excel-export die het Kantoor zelf aanlevert of uploadt. |
| **Duur** | De looptijd van de pilot (60 dagen) en een eventuele opvolgende overeenkomst. |
| **Bewaartermijnen** | Ruwe importregels 90 dagen; contacten zonder activiteit [INVULLEN] dagen; alles uiterlijk 30 dagen na het einde (art. 9). |

## Bijlage 2 — Technische en organisatorische maatregelen

Feitelijk zoals in de software (zie `docs/privacy.md` en `docs/architecture.md`):

- Hosting en database in de EU (Render, Frankfurt); database niet bereikbaar van buitenaf.
- Strikte scheiding per kantoor: elke query op klantgegevens filtert op het kantoor;
  een geautomatiseerde test controleert dat (`tests/tenancy.test.ts`).
- Wachtwoorden met scrypt gehasht; vergrendeling na herhaalde foute pogingen;
  sessies intrekbaar; verplicht vervangen van een tijdelijk wachtwoord.
- Https met HSTS en een strikte Content-Security-Policy.
- Logs bevatten geen namen, telefoonnummers of e-mailadressen (redactie op sleutelnaam);
  het auditlog bevat alleen verwijzingen.
- Automatische bewaartermijnen (dagelijkse opruimtaak).
- Back-ups: point-in-time recovery van de hostingpartij [INVULLEN: termijn] plus een
  wekelijkse versleutelde dump, maximaal twee bewaard.
- Toegang tot productie alleen door de Verwerker, met tweestapsverificatie op
  hosting- en GitHub-accounts [INVULLEN: bevestigen dat dit aan staat].

## Bijlage 3 — Subverwerkers

| Subverwerker | Dienst | Locatie gegevens | Waarborg |
|---|---|---|---|
| Render Services, Inc. | Hosting web, worker en database | Frankfurt (EU) | DPA van Render; EU-US Data Privacy Framework |
| [Optioneel] Telegram | Meldingen, alleen als het Kantoor dit inschakelt | buiten de EER | **[JURIST]**: niet inschakelen tijdens de pilot, tenzij afzonderlijk afgesproken |
