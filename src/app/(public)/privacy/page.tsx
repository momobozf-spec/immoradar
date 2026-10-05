import { getEnv } from '@/lib/env'

import { LegalIdentity, PublicShell, Section } from '../PublicShell'

export const metadata = { title: 'Privacyverklaring' }

// Leest de configuratie bij elke request, niet één keer bij de build.
export const dynamic = 'force-dynamic'

/**
 * Privacyverklaring.
 *
 * De bewaartermijnen komen uit dezelfde configuratie als de opruimtaak
 * (`runRetention`), zodat wat hier staat en wat het systeem doet niet uit elkaar
 * kunnen lopen.
 *
 * Deze tekst beschrijft feitelijk wat de software doet. Ze is geen juridisch
 * advies en moet vóór de commerciële lancering door een jurist nagekeken worden
 * (zie docs/LAUNCH-CHECKLIST.md).
 */
export default function PrivacyPage() {
  const env = getEnv()
  const identity = {
    name: env.LEGAL_ENTITY_NAME,
    vat: env.LEGAL_ENTITY_VAT,
    address: env.LEGAL_ENTITY_ADDRESS,
    email: env.LEGAL_CONTACT_EMAIL,
  }

  return (
    <PublicShell title="Privacyverklaring">
      <p>
        ImmoRadar is software voor Belgische vastgoedkantoren. Ze combineert publieke
        vastgoedadvertenties met het eigen klantenbestand van een kantoor, zodat dat kantoor weet
        wie het vandaag kan contacteren. Deze verklaring legt uit welke persoonsgegevens daarbij
        verwerkt worden, door wie, en welke rechten je hebt.
      </p>

      <Section title="Wie is verantwoordelijk?">
        <LegalIdentity {...identity} />
        <p>
          Voor de <strong>marktgegevens</strong> (publieke advertenties en de contactgegevens van
          particuliere verkopers die daarin staan) is de uitbater van ImmoRadar
          verwerkingsverantwoordelijke.
        </p>
        <p>
          Voor het <strong>klantenbestand</strong> dat een kantoor zelf importeert, is dat kantoor
          verwerkingsverantwoordelijke en treedt ImmoRadar op als verwerker, in opdracht van en
          uitsluitend voor dat kantoor.
        </p>
      </Section>

      <Section title="Welke gegevens en waarom">
        <p>
          <strong>Particuliere verkopers.</strong> Uit publieke advertenties: naam en
          telefoonnummer zoals vermeld, adres en kenmerken van het pand, vraagprijs en de
          wijzigingen daarin. Doel: een vastgoedkantoor in jouw regio de mogelijkheid geven je zijn
          diensten aan te bieden. Grondslag: gerechtvaardigd belang (art. 6.1.f AVG) van de
          kantoren, afgewogen tegen jouw belang — daarom bewaren we alleen wat je zelf publiek
          maakte, en wissen we je contactgegevens na{' '}
          <strong>{env.RETENTION_SELLER_CONTACT_DAYS} dagen</strong>.
        </p>
        <p>
          <strong>Klanten van een kantoor.</strong> Wat het kantoor uit zijn eigen CRM aanlevert:
          naam, contactgegevens, adres en de geschiedenis van het contact. Doel: het kantoor helpen
          bestaande relaties op te volgen. Deze gegevens zijn uitsluitend zichtbaar voor dat ene
          kantoor en worden nooit gebruikt voor of gedeeld met een ander kantoor.
        </p>
        <p>
          <strong>Gebruikers.</strong> Naam, e-mailadres, rol en inlogmomenten van medewerkers van
          kantoren, om toegang te beheren en misbruik te kunnen vaststellen.
        </p>
      </Section>

      <Section title="Hoe lang">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Contactgegevens van particuliere verkopers: {env.RETENTION_SELLER_CONTACT_DAYS} dagen,
            daarna gewist.
          </li>
          <li>
            Ingetrokken advertenties: {env.RETENTION_REMOVED_LISTING_DAYS} dagen, zonder
            contactgegevens.
          </li>
          <li>
            Ruwe brongegevens (alleen voor foutanalyse): {env.RETENTION_RAW_PAYLOAD_DAYS} dagen.
          </li>
          <li>
            Klantgegevens van een kantoor zonder activiteit:{' '}
            {env.RETENTION_CRM_CONTACT_DAYS > 0
              ? `${env.RETENTION_CRM_CONTACT_DAYS} dagen, of korter als het kantoor dat vraagt`
              : 'zolang het kantoor ze aanhoudt'}
            .
          </li>
        </ul>
      </Section>

      <Section title="Wie heeft toegang">
        <p>
          Medewerkers van het kantoor dat de gegevens importeerde, en — voor marktgegevens — de
          kantoren die in jouw regio actief zijn. De beheerders van het platform zien van een
          klantenbestand uitsluitend aantallen, nooit de inhoud. We verkopen geen gegevens.
        </p>
        <p>
          Meldingen over kansen kunnen via Telegram verstuurd worden naar een chat die het kantoor
          zelf instelt.
        </p>
      </Section>

      <Section title="Je rechten">
        <p>
          Je hebt recht op inzage, verbetering, verwijdering en beperking van je gegevens, en je
          kunt bezwaar maken tegen de verwerking op basis van gerechtvaardigd belang. Een bezwaar
          als particuliere verkoper leidt tot het wissen van je contactgegevens.
        </p>
        <p>
          {identity.email ? (
            <>
              Stuur je verzoek naar{' '}
              <a href={`mailto:${identity.email}`} className="text-brand-700 underline">
                {identity.email}
              </a>
              .
            </>
          ) : (
            <>Neem contact op met de uitbater via de gegevens hierboven.</>
          )}{' '}
          Gaat het om je gegevens in het klantenbestand van een kantoor, dan kun je ook
          rechtstreeks bij dat kantoor terecht.
        </p>
        <p>
          Je kunt klacht indienen bij de Gegevensbeschermingsautoriteit (
          <a
            href="https://www.gegevensbeschermingsautoriteit.be"
            className="text-brand-700 underline"
            rel="noopener noreferrer"
          >
            gegevensbeschermingsautoriteit.be
          </a>
          ).
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          ImmoRadar gebruikt één cookie: het sessiecookie dat je ingelogd houdt. Het is strikt
          noodzakelijk, bevat geen tracking en vervalt na je sessie. Er zijn geen analytische of
          advertentiecookies.
        </p>
      </Section>
    </PublicShell>
  )
}
