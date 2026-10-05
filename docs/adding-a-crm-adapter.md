# Een CRM-adapter toevoegen

De MVP heeft er één: CSV. Deze pagina beschrijft hoe je er een toevoegt, en welke
regels daarbij gelden.

## Het contract

```ts
interface CrmAdapter {
  readonly key: string
  readonly name: string

  importContacts(context: CrmImportContext): Promise<CrmImportResult>

  pushOpportunity?(opportunity: PushableOpportunity): Promise<void>
}
```

Een adapter doet **één** ding: contacten aanleveren in ruwe vorm. Hij
normaliseert niet, dedupliceert niet, praat niet met de database en beslist niet
of een contact slapend is.

Die grens is belangrijker dan ze lijkt. Zou een adapter zelf normaliseren, dan
zouden de dormantie-regels afhangen van waar de data vandaan kwam — en dat is
precies wat je niet wilt uitleggen aan een kantoor dat halverwege van CRM wisselt
en ineens andere kansen krijgt.

## Recept

```ts
// src/crm/adapters/whiseAdapter.ts
export class WhiseAdapter implements CrmAdapter {
  readonly key = 'whise'
  readonly name = 'Whise'

  async importContacts(context: CrmImportContext): Promise<CrmImportResult> {
    // Alleen ophalen. De vorm die je teruggeeft is voor elke adapter dezelfde.
    return { contacts, header: [], warnings }
  }
}
```

Vervolgens:

1. Registreer hem waar de importservice zijn adapters kiest.
2. Sla `key` op in `CrmImport.adapter`, zodat achteraf te zien is waar een
   contact vandaan kwam.
3. Zet inloggegevens in de omgeving, nooit in de code — `src/lib/env.ts` is de
   enige plek waar secrets vandaan komen.

De rest — normaliseren, dedupliceren, importgeschiedenis, dormantiedetectie,
relatiescore, CRM-matching — is gedeeld en werkt ongewijzigd.

## Wat je niet doet

**Geen ongedocumenteerde API's.** Een endpoint dat je in het netwerkverkeer van
een webapplicatie hebt gevonden is geen koppeling: hij verandert zonder
aankondiging, en hem gebruiken is meestal in strijd met de voorwaarden waar het
kantoor zélf aan gebonden is. Dat maakt van een integratieprobleem een probleem
van de klant.

**Geen inloggegevens van het kantoor doorgeven aan een derde.** Als een koppeling
alleen kan door namens de makelaar in te loggen op een systeem waar wij geen
partij zijn, is dat een gesprek met de leverancier, geen implementatiedetail.

## Terugschrijven

`pushOpportunity` staat in het contract maar is nergens geïmplementeerd, en dat
is opzet: geen enkele MVP-koppeling ondersteunt het, en een adapter die het niet
kan hoort dat niet te doen alsof.

De methode staat er zodat de fase waarin ImmoRadar kansen terugschrijft naar het
CRM van het kantoor later geen herschrijving van deze laag vraagt.

## Wat een adapter aanlevert

```ts
interface RawContactInput {
  externalId?: string
  firstName?: string
  lastName?: string
  displayName?: string
  email?: string
  phone?: string
  address?: string
  postalCode?: string
  city?: string
  contactType?: string       // vrij; wordt genormaliseerd
  status?: string            // vrij; wordt genormaliseerd
  leadType?: string
  assignedAgentName?: string
  notes?: string
  sourceCreatedAt?: string   // vrij formaat; wordt dag-eerst gelezen
  lastContactAt?: string
}
```

Alles optioneel en alles string. De adapter interpreteert niet, hij levert aan.

Twee dingen om te weten:

**Datums mogen in elk formaat.** `parseContactDate` leest ISO én de Belgische
dag-eerst-notatie. Geef door wat de bron gaf; zelf omzetten introduceert precies
de maandverwisseling die de dormantieberekening scheeftrekt.

**`sourceCreatedAt` is niet de importdatum.** Het is wanneer het contact in het
bron-CRM ontstond. Dat verschil is de kern van LeadRevive: een relatie uit 2018
is iets anders waard dan een import van vorige week.

## Testen

Zonder netwerk, met een vast antwoord:

```ts
const adapter = new WhiseAdapter({ fetch: async () => new Response(fixture) })
const result = await adapter.importContacts({ agencyId: 'a', lastImportAt: null })

expect(result.contacts).toHaveLength(42)
```

Zie `tests/crm.test.ts` voor het patroon.
