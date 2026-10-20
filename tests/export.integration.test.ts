import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toCsv } from '@/lib/csvExport'

/**
 * Teruggave van gegevens aan het einde van een pilot.
 *
 * Het CSV-formaat is puur en draait altijd. De export zelf alleen met
 * TEST_DATABASE_URL, net als de privacysuite (zelfde waarschuwing: een
 * wegwerpdatabase, nooit productie).
 */

describe('CSV voor een kantoor', () => {
  it('opent in Nederlandstalig Excel: BOM, puntkomma, aanhalingstekens waar nodig', () => {
    const csv = toCsv([{ naam: 'Janssens; Pieter', notitie: 'zei "misschien"' }], [
      { header: 'naam', value: (row) => row.naam },
      { header: 'notitie', value: (row) => row.notitie },
    ])
    expect(csv.startsWith('﻿naam;notitie\r\n')).toBe(true)
    expect(csv).toContain('"Janssens; Pieter";"zei ""misschien"""')
  })

  it('maakt van een CRM-notitie geen formule', () => {
    const csv = toCsv([{ notitie: '=HYPERLINK("http://x","klik")' }, { notitie: '+32475123456' }], [
      { header: 'notitie', value: (row) => row.notitie },
    ])
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""klik"")"`)
    expect(csv).toContain("'+32475123456")
  })
})

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
if (url) process.env.DATABASE_URL = url

const run = Date.now().toString(36)

type Prisma = (typeof import('@/repositories/prisma'))['prisma']
let prisma: Prisma
let exportAgency: (typeof import('@/services/agencyExportService'))['exportAgency']

suite('export van één kantoor', () => {
  beforeAll(async () => {
    prisma = (await import('@/repositories/prisma')).prisma
    exportAgency = (await import('@/services/agencyExportService')).exportAgency
  })

  afterAll(async () => {
    await prisma.agency.deleteMany({ where: { slug: { endsWith: run } } })
    await prisma.$disconnect()
  })

  it('bevat de eigen contacten en kansen, en niets van een ander kantoor', async () => {
    const own = await prisma.agency.create({ data: { name: 'Eigen', slug: `export-eigen-${run}` } })
    const other = await prisma.agency.create({ data: { name: 'Ander', slug: `export-ander-${run}` } })

    const contact = await prisma.crmContact.create({
      data: { agencyId: own.id, displayName: 'Pieter Eigen', phone: '+32499000101', notes: '=SOM(A1)' },
    })
    await prisma.crmContact.create({ data: { agencyId: other.id, displayName: 'Anna Ander' } })
    await prisma.opportunity.create({
      data: {
        agencyId: own.id,
        origin: 'LEADREVIVE',
        type: 'DORMANT_VALUATION_LEAD',
        crmContactId: contact.id,
        dedupeKey: `export-${run}`,
        score: 50,
      },
    })
    await prisma.user.create({
      data: { email: `makelaar-${run}@voorbeeld.test`, passwordHash: 'geheim-hash', agencyId: own.id },
    })

    const result = await exportAgency(own.id)
    expect(result).not.toBeNull()
    const files = result!.files

    expect(files['contacten.csv']).toContain('Pieter Eigen')
    expect(files['contacten.csv']).not.toContain('Anna Ander')
    expect(files['contacten.csv']).toContain("'=SOM(A1)")
    expect(files['kansen.csv']).toContain('DORMANT_VALUATION_LEAD')
    expect(files['gebruikers.csv']).toContain(`makelaar-${run}@voorbeeld.test`)
    expect(Object.values(files).join('\n')).not.toContain('geheim-hash')
    expect(result!.counts).toMatchObject({ contacten: 1, kansen: 1, gebruikers: 1 })

    const audit = await prisma.auditLog.findFirst({ where: { agencyId: own.id, action: 'agency.exported' } })
    expect(audit).not.toBeNull()
  })
})
