# Lanceringschecklist

De software is technisch klaar voor productie. Wat hieronder staat kan geen
code oplossen: het zijn beslissingen, contracten en controles die vóór het eerste
betalende kantoor moeten gebeuren. In volgorde van hoe hard ze blokkeren.

## 1. Een echte databron — blokkerend

ImmoRadar bevat bewust **geen scraper voor Immoweb, Zimmo, 2dehands of een
andere site**. Zonder bron draait de marktradar alleen op demodata; LeadRevive
(het eigen klantenbestand) werkt wel volledig.

- [ ] Kies een bron en leg vast dat je ze mag gebruiken: een betaalde datafeed of
      API, een partnerschap met een portaal, of een site waarvan robots.txt én
      gebruiksvoorwaarden geautomatiseerd ophalen toestaan.
- [ ] Laat een jurist bevestigen dat het hergebruik van de contactgegevens van
      particuliere verkopers voor prospectie door kantoren past binnen de AVG
      (gerechtvaardigd belang, informatieplicht art. 14) en de regels rond
      telefonische prospectie.
- [ ] Bouw de collector met `createJsonLdFeedCollector` of een eigen adapter
      (zie [adding-a-data-source.md](adding-a-data-source.md)) en zet hem aan in
      de database én in `COLLECTOR_ENABLED_SOURCES`.

Tot dit rond is, kun je ImmoRadar verkopen als **LeadRevive**: slapende
relaties uit het eigen bestand van het kantoor. Dat heeft geen externe bron
nodig.

## 2. Juridisch — blokkerend

- [ ] `/privacy` en `/voorwaarden` laten nalezen. De teksten beschrijven feitelijk
      wat de software doet, maar zijn geen juridisch advies.
- [ ] Verwerkersovereenkomst (art. 28 AVG) voor elk kantoor: voor het
      klantenbestand ben jij verwerker, het kantoor verwerkingsverantwoordelijke.
- [ ] Register van verwerkingsactiviteiten bijhouden.
- [ ] Nagaan of een DPIA nodig is (grootschalige verwerking van contactgegevens
      van particulieren voor prospectie).
- [ ] Commerciële overeenkomst met prijs, looptijd en opzegging.
- [ ] `LEGAL_ENTITY_ADDRESS` en `LEGAL_CONTACT_EMAIL` invullen.

## 3. Infrastructuur

- [ ] Hosting en database in de EU (Frankfurt, Parijs, Amsterdam).
- [ ] Eigen domein met https; `APP_BASE_URL` erop zetten.
- [ ] Dagelijkse back-ups met point-in-time recovery; één hersteltest.
- [ ] Telegram-bot aanmaken bij @BotFather; `TELEGRAM_BOT_TOKEN` zetten.
- [ ] Monitoring op `/api/ready` (bv. Better Stack of UptimeRobot) met een
      melding naar jou.
- [ ] Logs bewaren en doorzoekbaar maken (de app logt JSON naar stdout, met
      persoonsgegevens geredigeerd).

## 4. Facturatie

Facturatie zit niet in de app; voor B2B met een handvol kantoren is een
maandelijkse factuur vanuit je boekhouding eenvoudiger dan een betaalprovider.
Het abonnement stuur je in **Kantoren → Beheren**: status, plan, maximum aantal
kansen per dag en een einddatum. Een gepauzeerd of verlopen abonnement sluit de
data af zonder iets te wissen.

## 5. Eerste klant

- [ ] Kantoor aanmaken in `/admin/agencies`, tijdelijk wachtwoord persoonlijk
      doorgeven.
- [ ] Samen met de kantoorbeheerder de gebieden instellen en een eerste
      CRM-export importeren (`/imports`).
- [ ] Na een week samen de kansen overlopen: kloppen de scores met hun gevoel?
      De weging staat in `src/scoring/config.ts`.
