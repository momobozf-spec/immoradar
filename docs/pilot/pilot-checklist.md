# Checklist eerste LeadRevive-pilot

Wat er technisch en organisatorisch moet gebeuren vóór, tijdens en na de eerste
betaalde pilot. Elke stap noemt het commando of de plek. **Niets hiervan is al
uitgevoerd op een echte omgeving**: er is nog geen hosting, domein of klant.

Legende: 🔧 = jij, in een account of dashboard · 💻 = commando in deze repo ·
⚖️ = professionele controle nodig.

## A. Vóór je één klantbestand aanraakt

### Juridisch (blokkerend)
- [ ] ⚖️ Concept-verwerkersovereenkomst laten nalezen: [verwerkersovereenkomst-concept.md](verwerkersovereenkomst-concept.md).
      De punten met **[JURIST]** zijn open vragen, geen invulvelden.
- [ ] ⚖️ Vraag aan de jurist: mag een kantoor zijn eigen oud-klanten, kopers en
      schattingsaanvragen telefonisch benaderen op grond van gerechtvaardigd
      belang, en hoe verhoudt dat zich tot de Bel-me-niet-meer-lijst (WER
      art. VI.110 e.v.)? Dit bepaalt welke categorieën je mag aanbieden.
- [ ] 🔧 Register van verwerkingen invullen: [register-verwerkingen-concept.md](register-verwerkingen-concept.md).
- [ ] ⚖️ DPIA-screening afronden: [dpia-screening.md](dpia-screening.md).
- [ ] 🔧 Render-DPA aanvaarden voor je workspace (render.com/dpa) en een kopie bewaren.
- [ ] 🔧 Beroepsaansprakelijkheid/cyberverzekering: navragen bij je huidige verzekeraar
      of verwerking van klantbestanden gedekt is.

### Hosting (Render, Frankfurt)
- [ ] 🔧 Blueprint `render.yaml` gebruiken, **niet** `render.free.yaml` (die database
      wordt na 30 dagen gewist en heeft geen back-ups).
- [ ] 🔧 Eigen domein + https; `APP_BASE_URL` op dat domein (web én worker).
- [ ] 🔧 `LEGAL_ENTITY_ADDRESS` en `LEGAL_CONTACT_EMAIL` invullen; controleer
      `LEGAL_ENTITY_NAME` en `LEGAL_ENTITY_VAT` in de omgevingsgroep.
- [ ] 🔧 `COLLECTOR_ENABLED_SOURCES` leeg laten: geen marktbron in de pilot. De menu-items
      Marktradar en Panden verdwijnen dan vanzelf.
- [ ] 🔧 `TELEGRAM_BOT_TOKEN` leeg laten (meldingen uit, tenzij het kantoor erom vraagt).
- [ ] 🔧 Uptime-monitor op `https://<domein>/api/ready` met melding naar jou.
- [ ] 💻 Na de eerste deploy: `npm run bootstrap:admin` (via `BOOTSTRAP_ADMIN_EMAIL`), daarna
      die variabele weer leegmaken.

### Back-ups
- [ ] 🔧 Point-in-time recovery staat aan op het betaalde Postgres-plan; noteer de termijn
      (3 of 7 dagen, volgens het plan).
- [ ] 🔧 Wekelijkse eigen dump op een versleutelde schijf; bewaar er maximaal twee
      (zie [DEPLOY-RENDER.md](../DEPLOY-RENDER.md)).
- [ ] 🔧 **Eén hersteltest** vóór de pilot: herstel een dump naar een lege database en
      draai `npm run smoke` ertegen. Noteer datum en duur.

### Code (gedaan in deze branch)
- [x] 💻 CI draait weer (`.github/workflows/ci.yml`).
- [x] 💻 Export per kantoor: `EXPORT_AGENCY=<slug> npm run agency:export`.
- [x] 💻 Intake-scan zonder database: `npm run leadrevive:intake -- export.csv --postcodes 9000,9030`.
- [x] 💻 Alle zes LeadRevive-categorieën komen uit een CSV-import (getest).
- [x] 💻 Import ontdubbelt ook op naam + exact adres, en splitst "Achternaam, Voornaam".

## B. Tijdens de pilot

### Intake (dag 0–5)
- [ ] Verwerkersovereenkomst getekend **vóór** het bestand komt.
- [ ] Export komt via een veilige weg: de kantoorbeheerder uploadt zelf in `/imports`
      tijdens de kick-off, of via een gedeelde map met vervaldatum. Nooit als e-mailbijlage.
- [ ] Draai eerst de intake-scan (lokaal of op de server) en bespreek het rapport:
      [intake-scan.md](intake-scan.md). Pas daarna gaan de cijfers van de pilot vast.
- [ ] Kantoor aanmaken in `/admin/agencies`: plan `pilot`, einddatum dag 60,
      maximum kansen per dag. Tijdelijk wachtwoord persoonlijk doorgeven.
- [ ] Werkgebied instellen in `/territories`; import bevestigen in `/imports`.
- [ ] LeadRevive draait via de worker; controleer `/leadrevive` dezelfde dag.

### Opvolging
- [ ] Wekelijks: aantal kansen op status "gecontacteerd", "afspraak", "mandaat" in `/pipeline`.
- [ ] Dag 30: tweede export importeren (zelfde kolommen → zelfde mapping).
- [ ] Incident (datalek, verkeerde toegang): binnen 24 uur melden aan het kantoor
      (verwerkersovereenkomst art. 8); het kantoor beslist over melding aan de GBA.

## C. Na de pilot

### Het kantoor gaat door
- [ ] Plan op `standard`, einddatum leegmaken; factuur voor het abonnement.

### Het kantoor stopt
1. 💻 Export maken:
   ```bash
   EXPORT_AGENCY=<slug> npm run agency:export -- --out exports
   ```
   Levert `contacten.csv`, `interacties.csv`, `kansen.csv`, `gebruikers.csv`,
   `werkgebieden.csv`, `importen.csv` en `LEESMIJ.txt` (puntkomma, opent in Excel,
   formules onschadelijk gemaakt). Wordt gelogd in het auditlog.
2. 🔧 Bezorg de export via een beveiligde weg; vraag een ontvangstbevestiging.
3. 💻 Wissen (onherroepelijk, binnen 30 dagen na het einde):
   ```bash
   PURGE_AGENCY=<slug> PURGE_CONFIRM=<slug> npm run agency:purge
   ```
4. 🔧 Verwijder je lokale kopie van de export en eventuele intake-uitvoer.
5. 🔧 Bevestig het wissen schriftelijk aan het kantoor, met de datum waarop de
   gegevens ook uit de back-ups verdwenen zijn (PITR-termijn + je eigen dumpcyclus,
   maximaal 14 dagen volgens het concept).

### Verzoek van één betrokkene (via het kantoor)
- Inzage: zoek het contact op in `/leadrevive` of de export; bezorg het aan het kantoor.
- Verwijdering: `redactCrmContact(agencyId, contactId)` (zie [privacy.md](../privacy.md)).
