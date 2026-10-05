import { getEnv } from '@/lib/env'

import { LegalIdentity, PublicShell, Section } from '../PublicShell'

export const metadata = { title: 'Gebruiksvoorwaarden' }

// Leest de configuratie bij elke request, niet één keer bij de build.
export const dynamic = 'force-dynamic'

/**
 * Gebruiksvoorwaarden voor kantoren.
 *
 * De commerciële afspraken (prijs, looptijd, opzegging) staan in de
 * overeenkomst met elk kantoor; deze pagina regelt het gebruik van de software.
 * Moet vóór de lancering door een jurist nagekeken worden.
 */
export default function TermsPage() {
  const env = getEnv()

  return (
    <PublicShell title="Gebruiksvoorwaarden">
      <Section title="Partijen">
        <LegalIdentity
          name={env.LEGAL_ENTITY_NAME}
          vat={env.LEGAL_ENTITY_VAT}
          address={env.LEGAL_ENTITY_ADDRESS}
          email={env.LEGAL_CONTACT_EMAIL}
        />
        <p>
          Deze voorwaarden gelden voor elk vastgoedkantoor met een ImmoRadar-abonnement en voor
          iedere medewerker die namens dat kantoor inlogt. Prijs, looptijd en opzegging staan in de
          overeenkomst tussen de uitbater en het kantoor; bij tegenstrijdigheid gaat die
          overeenkomst voor.
        </p>
      </Section>

      <Section title="Wat ImmoRadar doet">
        <p>
          ImmoRadar signaleert marktgebeurtenissen (nieuwe particuliere verkopen, prijsdalingen,
          lang te koop staande panden) en koppelt die aan het eigen klantenbestand van het kantoor.
          Scores en suggesties zijn een hulpmiddel bij het prioriteren, geen garantie op een
          opdracht of een verkoop. Marktgegevens komen uit bronnen die we mogen gebruiken; we
          garanderen niet dat ze volledig of foutloos zijn.
        </p>
      </Section>

      <Section title="Verplichtingen van het kantoor">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Het kantoor importeert alleen klantgegevens die het rechtmatig verwerkt, en blijft daarvoor
            verwerkingsverantwoordelijke.
          </li>
          <li>
            Contact met particuliere verkopers gebeurt met respect voor hun keuze: wie aangeeft geen
            contact te willen, wordt niet opnieuw benaderd. Het kantoor respecteert de regels rond
            telefonische prospectie, waaronder de Bel-me-niet-meer-lijst.
          </li>
          <li>
            Inloggegevens zijn persoonlijk. Het kantoor deactiveert de toegang van medewerkers die
            vertrekken.
          </li>
          <li>
            Gegevens uit ImmoRadar worden niet doorverkocht, niet massaal geëxporteerd en niet
            gebruikt om een concurrerende dienst te bouwen.
          </li>
        </ul>
      </Section>

      <Section title="Beschikbaarheid en aansprakelijkheid">
        <p>
          We doen redelijke inspanningen om ImmoRadar beschikbaar en veilig te houden, en melden
          geplande onderbrekingen vooraf. Onze aansprakelijkheid is beperkt tot directe schade en
          tot het bedrag dat het kantoor in de twaalf maanden vóór het schadegeval betaalde, behalve
          bij opzet of grove fout.
        </p>
      </Section>

      <Section title="Gegevens bij het einde van het abonnement">
        <p>
          Bij het einde van het abonnement wordt de toegang gesloten. Het kantoor kan binnen dertig
          dagen vragen om zijn geïmporteerde klantgegevens terug te krijgen; daarna worden ze
          gewist.
        </p>
      </Section>

      <Section title="Toepasselijk recht">
        <p>Op deze voorwaarden is Belgisch recht van toepassing.</p>
      </Section>
    </PublicShell>
  )
}
