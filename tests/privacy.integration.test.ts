import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Wissen en bewaartermijnen tegen een echte database.
 *
 * Wat de verwerkersovereenkomst belooft (art. 7 en 9) moet de software ook
 * doen; dat valt alleen met echte rijen te bewijzen. Draait alleen met
 * TEST_DATABASE_URL, en maakt daar zijn eigen kantoren aan en weer weg. Let op:
 * `runRetention` werkt over de hele database, dus gebruik een wegwerpdatabase,
 * nooit productie:
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run tests/privacy.integration.test.ts
 */

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
if (url) process.env.DATABASE_URL = url

const DAY = 86_400_000
const NOW = new Date('2026-10-05T10:00:00Z')
const run = Date.now().toString(36)

type Prisma = (typeof import('@/repositories/prisma'))['prisma']
type Maintenance = typeof import('@/services/maintenanceService')

let prisma: Prisma
let maintenance: Maintenance

async function agencyWithContact(label: string, lastContactAt: Date) {
  const agency = await prisma.agency.create({ data: { name: `Test ${label}`, slug: `test-${label}-${run}` } })
  const contact = await prisma.crmContact.create({
    data: {
      agencyId: agency.id,
      displayName: `Pieter ${label}`,
      email: `pieter-${label}@example.org`,
      phone: '+32475123456',
      notes: 'wil verhuizen',
      lastContactAt,
    },
  })
  const imp = await prisma.crmImport.create({ data: { agencyId: agency.id, status: 'COMPLETED' } })
  await prisma.crmImportRow.create({
    data: {
      importId: imp.id,
      rowNumber: 1,
      status: 'CREATED',
      raw: { naam: `Pieter ${label}`, gsm: '0475/12.34.56' },
      contactId: contact.id,
      createdAt: new Date(NOW.getTime() - 200 * DAY),
    },
  })
  const opportunity = await prisma.opportunity.create({
    data: {
      agencyId: agency.id,
      origin: 'LEADREVIVE',
      type: 'FORMER_CLIENT',
      crmContactId: contact.id,
      dedupeKey: `t-${label}-${run}`,
      note: 'Pieter belt terug',
    },
  })
  const rule = await prisma.alertRule.create({ data: { agencyId: agency.id, name: 'Test' } })
  await prisma.alert.create({
    data: {
      agencyId: agency.id,
      alertRuleId: rule.id,
      opportunityId: opportunity.id,
      dedupeKey: `t-${label}-${run}`,
      chatId: '1',
      messageText: `⭐ Bekend in jullie CRM: Pieter ${label}`,
    },
  })
  return { agency, contact }
}

suite('wissen en bewaartermijnen', () => {
  beforeAll(async () => {
    prisma = (await import('@/repositories/prisma')).prisma
    maintenance = await import('@/services/maintenanceService')
  })

  afterAll(async () => {
    await prisma.agency.deleteMany({ where: { slug: { endsWith: run } } })
    await prisma.$disconnect()
  })

  it('wist een contact op verzoek, ook uit importregels, notities en meldingen', async () => {
    const { agency, contact } = await agencyWithContact('verzoek', NOW)

    expect(await maintenance.redactCrmContact(agency.id, contact.id, NOW)).toBe(true)

    const row = await prisma.crmContact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(row.displayName).toBeNull()
    expect(row.email).toBeNull()
    expect(row.redactedAt).not.toBeNull()

    const importRow = await prisma.crmImportRow.findFirstOrThrow({ where: { contactId: contact.id } })
    expect(JSON.stringify(importRow.raw)).not.toContain('Pieter')
    expect(importRow.rawClearedAt).not.toBeNull()

    const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { crmContactId: contact.id } })
    expect(opportunity.note).toBeNull()

    const alert = await prisma.alert.findFirstOrThrow({ where: { agencyId: agency.id } })
    expect(alert.messageText).not.toContain('Pieter')
  })

  it('raakt geen contact van een ander kantoor', async () => {
    const a = await agencyWithContact('kantoor-a', NOW)
    const b = await agencyWithContact('kantoor-b', NOW)

    expect(await maintenance.redactCrmContact(a.agency.id, b.contact.id, NOW)).toBe(false)
    const untouched = await prisma.crmContact.findUniqueOrThrow({ where: { id: b.contact.id } })
    expect(untouched.displayName).toBe('Pieter kantoor-b')
  })

  it('past de bewaartermijnen toe op stille contacten en oude importregels', async () => {
    const stale = await agencyWithContact('stil', new Date(NOW.getTime() - 4000 * DAY))
    const fresh = await agencyWithContact('actief', new Date(NOW.getTime() - 10 * DAY))

    const result = await maintenance.runRetention(NOW)
    expect(result.crmContactsRedacted).toBeGreaterThanOrEqual(1)
    expect(result.importRowsCleared).toBeGreaterThanOrEqual(2)

    const gone = await prisma.crmContact.findUniqueOrThrow({ where: { id: stale.contact.id } })
    expect(gone.displayName).toBeNull()
    const kept = await prisma.crmContact.findUniqueOrThrow({ where: { id: fresh.contact.id } })
    expect(kept.displayName).toBe('Pieter actief')

    // Een recente interactie houdt een oud contact in leven.
    const revived = await agencyWithContact('interactie', new Date(NOW.getTime() - 4000 * DAY))
    await prisma.crmInteraction.create({
      data: { agencyId: revived.agency.id, contactId: revived.contact.id, occurredAt: new Date(NOW.getTime() - 5 * DAY) },
    })
    await maintenance.runRetention(NOW)
    const alive = await prisma.crmContact.findUniqueOrThrow({ where: { id: revived.contact.id } })
    expect(alive.displayName).toBe('Pieter interactie')
  })

  it('wist een volledig kantoor, maar geen ander', async () => {
    const doomed = await agencyWithContact('weg', NOW)
    const other = await agencyWithContact('blijft', NOW)
    await prisma.auditLog.create({
      data: { actor: 'thomas@kantoor.be', agencyId: doomed.agency.id, action: 'crm.import', ip: '1.2.3.4', metadata: { file: 'klanten.csv' } },
    })

    const result = await maintenance.purgeAgency(doomed.agency.id)
    expect(result).toMatchObject({ contacts: 1, opportunities: 1 })

    expect(await prisma.agency.count({ where: { id: doomed.agency.id } })).toBe(0)
    expect(await prisma.crmContact.count({ where: { agencyId: doomed.agency.id } })).toBe(0)
    expect(await prisma.crmImportRow.count({ where: { import: { agencyId: doomed.agency.id } } })).toBe(0)
    expect(await prisma.alert.count({ where: { agencyId: doomed.agency.id } })).toBe(0)

    const audit = await prisma.auditLog.findMany({ where: { agencyId: doomed.agency.id } })
    expect(audit.some((entry) => entry.action === 'agency.purged')).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('thomas@kantoor.be')
    expect(JSON.stringify(audit)).not.toContain('1.2.3.4')

    expect(await prisma.crmContact.count({ where: { agencyId: other.agency.id } })).toBe(1)
    expect(await maintenance.purgeAgency(doomed.agency.id)).toBeNull()
  })
})
