import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Tenantscheiding, afgedwongen op de broncode.
 *
 * ─── WAAROM DEZE TEST BESTAAT NAAST EEN INTEGRATIETEST ───────────────────────
 *
 * Een integratietest met twee kantoren bewijst dat de queries die er zíjn goed
 * werken. Hij zegt niets over de query die morgen wordt toegevoegd — en dat is
 * nu juist waar het misgaat. Een nieuwe `prisma.crmContact.findMany` zonder
 * `agencyId` is geen subtiele bug maar een onmiddellijk datalek tussen
 * concurrenten, en zo'n regel hoort niet door code review te hoeven worden
 * gevangen.
 *
 * Deze test leest daarom de broncode en dwingt de conventie af die het hele
 * project volgt: een query op kantoor-eigen data noemt `agencyId`, of staat in
 * een functie die `agencyId` binnenkrijgt.
 *
 * ─── DE UITZONDERINGEN ───────────────────────────────────────────────────────
 *
 * Ze staan hieronder met naam en reden. Dat is het punt: een uitzondering op de
 * tenantgrens hoort een bewuste, opgeschreven beslissing te zijn, niet iets wat
 * je ontdekt door de query te lezen.
 */

const SOURCE_ROOT = path.resolve(process.cwd(), 'src')

/**
 * Modellen die van één kantoor zijn.
 *
 * Marktdata (Property, Listing, Source, SellerIdentity) staat er bewust niet in:
 * die beschrijft de Belgische markt en is voor iedereen dezelfde.
 */
const TENANT_MODELS = [
  'crmContact',
  'crmInteraction',
  'crmImport',
  'contactPropertyRelationship',
  'opportunity',
  'alertRule',
  'territory',
] as const

/** Leesmethoden en schrijfmethoden die een tenantfilter horen te dragen. */
const GUARDED_METHODS = [
  'findMany',
  'findFirst',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'create',
  'createMany',
  'upsert',
]

/**
 * Bewust toegestane queries over kantoren heen, met de reden erbij.
 *
 * Elke regel hier is een plek waar de tenantgrens níet geldt. Ze zijn met opzet
 * schaars en met opzet expliciet: wie er een toevoegt, schrijft op waarom.
 */
const ALLOWED_CROSS_TENANT: readonly { file: string; symbol: string; reason: string }[] = [
  {
    file: path.join('app', 'admin', 'health', 'page.tsx'),
    symbol: 'HealthPage',
    reason:
      'Platformbeheer telt rijen over het hele platform. Toont uitsluitend aantallen, nooit inhoud.',
  },
  {
    file: path.join('app', 'admin', 'agencies', 'page.tsx'),
    symbol: 'AgenciesPage',
    reason: 'Platformbeheer toont aantallen per kantoor, nooit de contacten zelf.',
  },
  {
    file: path.join('repositories', 'crmRepository.ts'),
    symbol: 'attachRelationshipsToProperty',
    reason:
      'Koppelt één gedeeld marktpand aan de relaties van álle kantoren die dat adres kennen. ' +
      'Elke rij houdt zijn eigen agencyId; alleen het gedeelde propertyId wordt gevuld.',
  },
  {
    file: path.join('repositories', 'opportunityRepository.ts'),
    symbol: 'expireStaleOpportunities',
    reason: 'Onderhoudstaak: laat verlopen kansen van alle kantoren vervallen. Leest niets uit.',
  },
  {
    file: path.join('services', 'maintenanceService.ts'),
    symbol: '*',
    reason: 'Bewaartermijnen gelden platformbreed; deze module wist data, ze toont niets.',
  },
  {
    file: path.join('services', 'leadReviveService.ts'),
    symbol: 'runLeadReviveForAllAgencies',
    reason: 'Loopt kantoor voor kantoor; elke onderliggende query krijgt één agencyId mee.',
  },
  {
    file: path.join('services', 'alertService.ts'),
    symbol: '*',
    reason: 'De alertloper haalt regels van alle kantoren op en verwerkt ze per kantoor.',
  },
]

function sourceFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    // De gegenereerde Prisma-client is geen applicatiecode: hij bevat elke
    // modelmethode zonder filter en zou hier als valse lekken opduiken.
    if (full === path.join(SOURCE_ROOT, 'generated')) continue
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full)
  }

  return files
}

/**
 * Knipt een Prisma-aanroep uit de broncode door haakjes te tellen.
 *
 * Een reguliere expressie zou bij de eerste geneste `)` stoppen en een query met
 * een `include` halverwege afkappen — waarna de controle onterecht zou slagen.
 */
function extractCall(source: string, startIndex: number): string {
  const open = source.indexOf('(', startIndex)
  if (open === -1) return ''

  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    else if (source[index] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }

  return source.slice(open)
}

/**
 * De functie waarin deze aanroep staat.
 *
 * De conventie in dit project is dat elke repository-functie `agencyId` als
 * parameter krijgt en die in zijn `where` zet — soms via een tussenvariabele
 * (`const where = { agencyId, … }`) of een gespreid object (`{ ...scope }`).
 * Alleen naar de aanroep kijken zou al die correcte gevallen ten onrechte
 * afkeuren; naar de omhullende functie kijken vangt het geval dat er werkelijk
 * toe doet: een query in een functie die geen enkel kantoor kent.
 */
function enclosingFunction(source: string, index: number): { name: string; body: string } {
  const before = source.slice(0, index)

  const declaration = [...before.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)].pop()
  const arrow = [...before.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)].pop()

  const chosen =
    (declaration?.index ?? -1) > (arrow?.index ?? -1) ? declaration : arrow

  if (!chosen) return { name: '(module)', body: source }

  // Van het begin van de functie tot ruim voorbij de query: genoeg om de
  // signatuur en de opbouw van de `where` te zien.
  return {
    name: chosen[1] ?? '(anoniem)',
    body: source.slice(chosen.index ?? 0, index + 400),
  }
}

interface Offence {
  file: string
  fn: string
  model: string
  method: string
  snippet: string
}

function isAllowed(file: string, fn: string): boolean {
  return ALLOWED_CROSS_TENANT.some(
    (entry) => entry.file === file && (entry.symbol === '*' || entry.symbol === fn),
  )
}

function findOffences(): Offence[] {
  const offences: Offence[] = []

  for (const file of sourceFiles(SOURCE_ROOT)) {
    const relative = path.relative(SOURCE_ROOT, file)
    const source = readFileSync(file, 'utf8')

    for (const model of TENANT_MODELS) {
      for (const method of GUARDED_METHODS) {
        const needle = `.${model}.${method}`
        let cursor = source.indexOf(needle)

        while (cursor !== -1) {
          const call = extractCall(source, cursor + needle.length)
          const context = enclosingFunction(source, cursor)

          const scoped =
            call.includes('agencyId') ||
            call.includes('agency:') ||
            // De omhullende functie krijgt een kantoor mee en bouwt daar zijn
            // filter uit op — de conventie van elke repository hier.
            /agencyId\s*[:,)]/.test(context.body) ||
            /agencyId\s*:\s*string/.test(context.body)

          if (!scoped && !isAllowed(relative, context.name)) {
            offences.push({
              file: relative,
              fn: context.name,
              model,
              method,
              snippet: call.slice(0, 120).replace(/\s+/g, ' '),
            })
          }

          cursor = source.indexOf(needle, cursor + needle.length)
        }
      }
    }
  }

  return offences
}

describe('tenantscheiding in de broncode', () => {
  it('begrenst elke query op kantoor-eigen data tot één kantoor', () => {
    const offences = findOffences()

    const report = offences
      .map(
        (offence) =>
          `  ${offence.file} → ${offence.fn}(): prisma.${offence.model}.${offence.method}${offence.snippet}`,
      )
      .join('\n')

    expect(
      offences,
      offences.length === 0
        ? ''
        : `Query op kantoor-eigen data zonder kantoorgrens:\n${report}\n\n` +
            'Geef de functie een agencyId en zet het in de where. Is de query bewust ' +
            'kantooroverstijgend, voeg hem dan met een reden toe aan ALLOWED_CROSS_TENANT ' +
            'in deze test.',
    ).toEqual([])
  })

  it('dekt elk model dat een agencyId draagt', () => {
    // Vangnet voor het schema: komt er een nieuw tenant-model bij, dan hoort het
    // in TENANT_MODELS te staan, anders bewaakt niemand het.
    const schema = readFileSync(path.resolve(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

    const modelsWithAgency = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)]
      // Woordgrens: `agencyIdentityId` op SellerIdentity is géén tenantsleutel.
      .filter(([, , body]) => /^\s*agencyId\s+String/m.test(body ?? ''))
      .map(([, name]) => name)
      .filter((name): name is string => Boolean(name))

    const uncovered = modelsWithAgency
      .map((name) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
      .filter((name) => !(TENANT_MODELS as readonly string[]).includes(name))
      // Deze hangen aan een al begrensde ouder (Opportunity, AlertRule, Agency)
      // en worden nooit los opgevraagd.
      .filter((name) => !['alert', 'auditLog', 'subscription', 'user'].includes(name))

    expect(uncovered, `Nieuw tenant-model niet bewaakt: ${uncovered.join(', ')}`).toEqual([])
  })

  it('houdt de lijst met uitzonderingen kort en beargumenteerd', () => {
    // Een uitzondering zonder reden is geen uitzondering maar een gat.
    for (const entry of ALLOWED_CROSS_TENANT) {
      expect(entry.reason.length, `${entry.file} heeft geen bruikbare reden`).toBeGreaterThan(30)
    }

    // Groeit deze lijst voorbij een handvol, dan is de grens geen grens meer.
    expect(ALLOWED_CROSS_TENANT.length).toBeLessThanOrEqual(10)
  })
})

describe('geheimen en persoonsgegevens', () => {
  it('redigeert persoonsgegevens en geheimen in de logs', () => {
    // Een logbestand is de makkelijkste plek om per ongeluk duizenden
    // persoonsgegevens te verzamelen die er niet horen te staan.
    const logger = readFileSync(path.join(SOURCE_ROOT, 'lib', 'logger.ts'), 'utf8').toLowerCase()

    for (const key of ['phone', 'email', 'token', 'password', 'secret', 'chatid']) {
      expect(logger, `logger redigeert "${key}" niet`).toContain(`'${key}`)
    }
  })

  it('bevat geen ongedocumenteerde secrets in de broncode', () => {
    const suspicious = /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9+/_-]{20,}['"]/i

    // Het enige toegestane geval: het ontwikkelgeheim in env.ts. Dat is publiek
    // bekend, staat vol met "development-only", en `assertProductionSecrets`
    // zorgt dat de applicatie er in productie niet mee start.
    const documented = new Set([path.join('lib', 'env.ts')])

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const relative = path.relative(SOURCE_ROOT, file)
      if (documented.has(relative)) continue

      expect(suspicious.test(readFileSync(file, 'utf8')), `${relative} lijkt een secret te bevatten`).toBe(
        false,
      )
    }
  })

  it('weigert in productie te starten zonder sessiegeheim', () => {
    // Zonder SESSION_SECRET is elk sessiecookie te vervalsen, en dan is de
    // tenantscheiding een suggestie in plaats van een grens.
    const env = readFileSync(path.join(SOURCE_ROOT, 'lib', 'env.ts'), 'utf8')
    expect(env).toContain('assertProductionSecrets')
    expect(env).toMatch(/SESSION_SECRET/)
  })
})
