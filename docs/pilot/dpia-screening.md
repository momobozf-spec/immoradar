# DPIA-screening LeadRevive — CONCEPT

> Een gegevensbeschermingseffectbeoordeling (DPIA) is de verantwoordelijkheid van
> het **kantoor** (verwerkingsverantwoordelijke); als verwerker help je. Deze
> screening helpt beslissen of een volledige DPIA nodig is. **[JURIST]** moet de
> conclusie bevestigen.

## Criteria (richtsnoeren EDPB/WP248 en de lijst van de GBA)

| Criterium | Van toepassing? | Toelichting |
|---|---|---|
| Evaluatie of scoring | **Ja, beperkt** | Contacten krijgen een volgorde-score. Het is geen profiel van gedrag of kredietwaardigheid en leidt niet tot een beslissing over de persoon, wel tot een telefoontje. |
| Geautomatiseerde besluitvorming met rechtsgevolg | Nee | Een makelaar beslist of hij belt. |
| Systematische monitoring | Nee | Geen observatie van gedrag; alleen datums uit het CRM. |
| Bijzondere of gevoelige gegevens | Nee, in principe | Notitievelden kunnen gevoelige info bevatten (bv. scheiding, overlijden). Vraag kantoren notities niet mee te exporteren of ze op te schonen. |
| Grootschalige verwerking | Twijfel | Eén kantoor: duizenden contacten. Over meerdere kantoren samen groter. |
| Koppeling van datasets | Nee in de pilot | De marktradar (koppeling met advertenties) staat uit. **Bij activering: opnieuw beoordelen, waarschijnlijk wel DPIA.** |
| Kwetsbare betrokkenen | Nee | |
| Nieuwe technologie | Nee | Regelgebaseerd, geen AI. |
| Verhindert uitoefening van rechten | Nee | |

## Voorlopige conclusie

Eén criterium duidelijk (scoring), één twijfelachtig (schaal). Bij twee of meer
criteria raden de richtsnoeren een DPIA aan. **Voorstel:** voor de pilot een
beknopte DPIA laten opmaken door het kantoor, met deze screening en Bijlage 2 van
de verwerkersovereenkomst als basis. **[JURIST]** beslist of dat nodig is.

## Risico's en maatregelen

| Risico | Maatregel |
|---|---|
| Betrokkene wordt gebeld zonder te verwachten dat het kantoor zijn gegevens nog gebruikt | Kantoor beoordeelt grondslag (gerechtvaardigd belang) en informatieplicht; LeadRevive toont per contact de reden, zodat het gesprek eerlijk kan beginnen. **[JURIST]**: Bel-me-niet-meer-lijst. |
| Verkeerde samenvoeging van twee personen | Ontdubbelen nooit op naam alleen; naam alleen samen met exact adres (getest). |
| Toegang door een ander kantoor | Tenantscheiding op elke query, geautomatiseerd getest. |
| Te lang bewaren | Automatische bewaartermijnen; wissen binnen 30 dagen na het einde. |
| Lek via exports of intake-uitvoer op de laptop van de verwerker | Export-/intakemappen buiten Git, alleen op een versleutelde schijf, verwijderen na de pilot. |
