import { toCsv } from '@/lib/csvExport'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/repositories/prisma'

/**
 * Alles wat een kantoor bij ons heeft, als bestanden die het zelf kan openen.
 *
 * Voor het einde van een pilot of contract (verwerkersovereenkomst: teruggave
 * vóór verwijdering) en voor een verzoek van een betrokkene die via het kantoor
 * binnenkomt. Strikt één kantoor: elke query filtert op `agencyId`.
 *
 * Wat er níet in zit, en waarom:
 *  - wachtwoordhashes en sessies: geen gegevens van het kantoor, wel een risico;
 *  - marktgegevens (panden, advertenties): gedeeld tussen kantoren en niet van
 *    dit kantoor afkomstig;
 *  - ruwe importrijen: tijdelijk (bewaartermijn 90 dagen) en dubbel met de
 *    contacten die eruit ontstonden.
 */

const logger = createLogger({ component: 'agency-export' })

export interface AgencyExport {
  agency: { id: string; name: string; slug: string }
  exportedAt: Date
  files: Record<string, string>
  counts: Record<string, number>
}

export async function exportAgency(agencyId: string, now: Date = new Date()): Promise<AgencyExport | null> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true, slug: true },
  })
  if (!agency) return null

  const [users, territories, contacts, interactions, opportunities, imports] = await Promise.all([
    prisma.user.findMany({
      where: { agencyId },
      select: { name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.territory.findMany({ where: { agencyId }, orderBy: { name: 'asc' } }),
    prisma.crmContact.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'asc' },
      include: { assignedUser: { select: { email: true } } },
    }),
    prisma.crmInteraction.findMany({
      where: { agencyId },
      orderBy: { occurredAt: 'asc' },
      include: { contact: { select: { externalId: true, id: true } } },
    }),
    prisma.opportunity.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'asc' },
      include: {
        crmContact: { select: { id: true, externalId: true, displayName: true } },
        assignedUser: { select: { email: true } },
        reasons: { orderBy: { rank: 'asc' }, select: { label: true } },
      },
    }),
    prisma.crmImport.findMany({ where: { agencyId }, orderBy: { startedAt: 'asc' } }),
  ])

  const files: Record<string, string> = {
    'contacten.csv': toCsv(contacts, [
      { header: 'id', value: (c) => c.id },
      { header: 'extern_id', value: (c) => c.externalId },
      { header: 'naam', value: (c) => c.displayName },
      { header: 'voornaam', value: (c) => c.firstName },
      { header: 'achternaam', value: (c) => c.lastName },
      { header: 'e-mail', value: (c) => c.email },
      { header: 'telefoon', value: (c) => c.phone },
      { header: 'adres', value: (c) => c.address },
      { header: 'postcode', value: (c) => c.postalCode },
      { header: 'gemeente', value: (c) => c.city },
      { header: 'type', value: (c) => c.contactType },
      { header: 'status', value: (c) => c.status },
      { header: 'leadtype', value: (c) => c.leadType },
      { header: 'makelaar', value: (c) => c.assignedUser?.email ?? c.assignedAgentName },
      { header: 'notities', value: (c) => c.notes },
      { header: 'aangemaakt_in_crm', value: (c) => c.sourceCreatedAt },
      { header: 'laatste_contact', value: (c) => c.lastContactAt },
      { header: 'relatiescore', value: (c) => c.relationshipScore },
      { header: 'slapend_sinds', value: (c) => c.dormantSince },
      { header: 'gewist_op', value: (c) => c.redactedAt },
    ]),
    'interacties.csv': toCsv(interactions, [
      { header: 'contact_id', value: (i) => i.contact.id },
      { header: 'contact_extern_id', value: (i) => i.contact.externalId },
      { header: 'soort', value: (i) => i.kind },
      { header: 'datum', value: (i) => i.occurredAt },
      { header: 'samenvatting', value: (i) => i.summary },
      { header: 'door', value: (i) => i.agentName },
    ]),
    'kansen.csv': toCsv(opportunities, [
      { header: 'id', value: (o) => o.id },
      { header: 'herkomst', value: (o) => o.origin },
      { header: 'type', value: (o) => o.type },
      { header: 'status', value: (o) => o.status },
      { header: 'volgorde_score', value: (o) => o.score },
      { header: 'contact_id', value: (o) => o.crmContact?.id },
      { header: 'contact_extern_id', value: (o) => o.crmContact?.externalId },
      { header: 'contact_naam', value: (o) => o.crmContact?.displayName },
      { header: 'redenen', value: (o) => o.reasons.map((reason) => reason.label) },
      { header: 'toegewezen_aan', value: (o) => o.assignedUser?.email },
      { header: 'aangemaakt', value: (o) => o.createdAt },
      { header: 'gecontacteerd_op', value: (o) => o.contactedAt },
      { header: 'notitie', value: (o) => o.note },
    ]),
    'gebruikers.csv': toCsv(users, [
      { header: 'naam', value: (u) => u.name },
      { header: 'e-mail', value: (u) => u.email },
      { header: 'rol', value: (u) => u.role },
      { header: 'aangemaakt', value: (u) => u.createdAt },
    ]),
    'werkgebieden.csv': toCsv(territories, [
      { header: 'naam', value: (t) => t.name },
      { header: 'soort', value: (t) => t.kind },
      { header: 'postcodes', value: (t) => t.postalCodes },
      { header: 'gemeenten', value: (t) => t.municipalities },
      { header: 'provincies', value: (t) => t.provinces },
      { header: 'actief', value: (t) => t.active },
    ]),
    'importen.csv': toCsv(imports, [
      { header: 'bestand', value: (i) => i.fileName },
      { header: 'status', value: (i) => i.status },
      { header: 'gestart', value: (i) => i.startedAt },
      { header: 'nieuw', value: (i) => i.createdCount },
      { header: 'bijgewerkt', value: (i) => i.updatedCount },
      { header: 'dubbel', value: (i) => i.duplicateCount },
      { header: 'ongeldig', value: (i) => i.invalidCount },
    ]),
  }

  const counts = {
    contacten: contacts.length,
    interacties: interactions.length,
    kansen: opportunities.length,
    gebruikers: users.length,
    werkgebieden: territories.length,
    importen: imports.length,
  }

  files['LEESMIJ.txt'] =
    [
      `Export van ${agency.name} (${agency.slug}) uit ImmoRadar / LeadRevive`,
      `Gemaakt op ${now.toISOString()}`,
      '',
      ...Object.entries(counts).map(([name, count]) => `${name}: ${count}`),
      '',
      'De CSV-bestanden gebruiken een puntkomma en openen rechtstreeks in Excel.',
      'Waarden die met =, +, - of @ beginnen staan er met een apostrof voor (geen formules).',
      'Wachtwoorden, sessies en gedeelde marktgegevens zitten niet in deze export.',
      '',
    ].join('\r\n')

  await prisma.auditLog.create({
    data: { actor: 'cli', agencyId, action: 'agency.exported', entityType: 'Agency', entityId: agencyId },
  })
  logger.info('Kantoor geëxporteerd', { agencyId, ...counts })

  return { agency, exportedAt: now, files, counts }
}
