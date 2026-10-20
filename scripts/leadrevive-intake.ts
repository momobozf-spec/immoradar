import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parseCsv } from '@/crm/csv'
import { runIntake, type IntakeOpportunity, type IntakeReport } from '@/leadrevive/intake'
import type { LeadReviveOpportunityType } from '@/events/opportunityRules'
import type { TerritoryDefinition } from '@/territories/territoryMatch'

/**
 * Intake-scan op een CSV-export, lokaal, zonder database.
 *
 *   npm run leadrevive:intake -- <bestand.csv> [--postcodes 9000,9030] [--out map]
 *                                [--mask] [--now 2026-10-20] [--title "Kantoor X"]
 *
 * Schrijft `intake.md` (de cijfers) en `intake.html` (de demo: van rommelige
 * export naar bellijst) naar de uitvoermap (standaard `./intake-output`).
 *
 * Een echte export bevat persoonsgegevens. Draai dit alleen op een bestand dat
 * je onder een verwerkersovereenkomst kreeg, op je eigen toestel, en verwijder
 * de uitvoer na de pilot. `--mask` kort namen en nummers in voor schermafdrukken.
 */

const CALL_OPENERS: Record<LeadReviveOpportunityType, string> = {
  DORMANT_VALUATION_LEAD:
    '"U vroeg in [jaar] een schatting van [adres]. De markt is sindsdien veranderd; mag ik u kort vertellen wat dat voor uw woning betekent?"',
  LOST_MANDATE:
    '"We spraken in [jaar] over de verkoop van [adres]. Ik bel niet om iets te verkopen, maar om te horen hoe het nu staat."',
  FORMER_SELLER_PROSPECT:
    '"U overwoog in [jaar] te verkopen. Speelt dat nog, of is de situatie veranderd?"',
  PREVIOUS_BUYER:
    '"U kocht [adres] via ons in [jaar]. We maken een update van wat woningen in uw straat nu waard zijn; interesseert u dat?"',
  FORMER_CLIENT:
    '"U was in [jaar] klant bij ons. Ik bel om te horen hoe het met u en de woning gaat."',
  UNCONTACTED_LEAD:
    '"U liet in [jaar] uw gegevens bij ons achter en we hebben u nooit teruggebeld. Excuses daarvoor — waarmee kunnen we u helpen?"',
}

interface Args {
  file: string
  postcodes: string[]
  out: string
  mask: boolean
  now: Date
  title: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: '',
    postcodes: [],
    out: 'intake-output',
    mask: false,
    now: new Date(),
    title: 'Intake-scan',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = (): string => argv[++index] ?? ''
    if (value === '--postcodes') args.postcodes = next().split(',').map((code) => code.trim()).filter(Boolean)
    else if (value === '--out') args.out = next()
    else if (value === '--mask') args.mask = true
    else if (value === '--now') args.now = new Date(`${next()}T09:00:00Z`)
    else if (value === '--title') args.title = next()
    else if (value && !value.startsWith('--')) args.file = value
  }
  return args
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] !== undefined && process.env[name] !== '' ? value : fallback
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const pct = (value: number): string => `${Math.round(value * 100)}%`

function maskName(name: string): string {
  const parts = name.replace(',', '').split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return `${name.slice(0, 1)}.`
  return `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join(' ')}`
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 6)} •• •• ${phone.slice(-2)}`
}

function present(opportunity: IntakeOpportunity, mask: boolean) {
  return {
    name: mask ? maskName(opportunity.name) : opportunity.name,
    reach: opportunity.phone
      ? mask
        ? maskPhone(opportunity.phone)
        : opportunity.phone
      : opportunity.email
        ? mask
          ? `${opportunity.email.slice(0, 2)}…@${opportunity.email.split('@')[1] ?? ''}`
          : opportunity.email
        : '—',
  }
}

function markdown(report: IntakeReport, args: Args): string {
  const lines: string[] = []
  lines.push(`# ${args.title}`, '')
  lines.push(`Bestand: \`${basename(args.file)}\` · peildatum ${args.now.toISOString().slice(0, 10)}`, '')
  lines.push('## Wat er binnenkwam', '')
  lines.push(`- ${report.rows} rijen, ${report.malformedRows} met een afwijkend aantal kolommen`)
  lines.push(`- ${report.invalidRows} zonder naam, telefoon of e-mail (niet te gebruiken)`)
  lines.push(`- ${report.duplicateRows} dubbele rijen samengevoegd → **${report.uniqueContacts} unieke contacten**`, '')
  lines.push('| Veld | Ingevuld |', '|---|---:|')
  const c = report.coverage
  lines.push(`| Telefoon of e-mail | ${pct(c.reachable)} |`)
  lines.push(`| Volledig adres | ${pct(c.address)} |`)
  lines.push(`| Aanmaakdatum | ${pct(c.createdAt)} |`)
  lines.push(`| Laatste contact | ${pct(c.lastContactAt)} |`)
  lines.push(`| Type herkend | ${pct(c.typeRecognised)} |`, '')
  if (report.warnings.length > 0) {
    lines.push('### Datakwaliteit', '', ...report.warnings.map((warning) => `- ${warning}`), '')
  }
  lines.push('## Resultaat', '')
  lines.push(`**${report.usableCount} bruikbare kansen** (reden om te bellen, bereikbaar, in het werkgebied).`, '')
  lines.push('| Categorie | Kansen | Waarvan bruikbaar |', '|---|---:|---:|')
  for (const category of report.categories) {
    lines.push(`| ${category.label} | ${category.total} | ${category.usable} |`)
  }
  lines.push('', `${report.notSelected} contacten leverden geen kans op (geen categorie of onder de scoredrempel).`, '')
  lines.push('## Bellijst', '', '| # | Contact | Categorie | Volgorde | Waarom |', '|---:|---|---|---:|---|')
  report.opportunities
    .filter((o) => o.usable)
    .forEach((opportunity, index) => {
      const shown = present(opportunity, args.mask)
      lines.push(
        `| ${index + 1} | ${shown.name} | ${opportunity.categoryLabel} | ${opportunity.score} | ${opportunity.reasons.join(' · ')} |`,
      )
    })
  lines.push('', '> De score is een **volgorde om te bellen**, geen kans op verkoop.', '')
  lines.push(
    '> Vóór elk gesprek: wie je bent en voor welk kantoor, waarom je belt, dat de gegevens uit het eigen klantenbestand komen, en dat de persoon bezwaar kan maken (GBA, ontwerp-aanbeveling 01/2025, bijlage 2). Controleer de Bel-me-niet-meer-lijst.',
    '',
  )
  return lines.join('\n')
}

function html(report: IntakeReport, args: Args, raw: { header: string[]; rows: string[][] }): string {
  const usable = report.opportunities.filter((o) => o.usable)
  const notUsable = report.opportunities.filter((o) => !o.usable)
  const rawRows = raw.rows.slice(0, 8)

  const rawTable = `<table class="raw"><thead><tr>${raw.header
    .map((column) => `<th>${escapeHtml(column)}</th>`)
    .join('')}</tr></thead><tbody>${rawRows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeHtml(args.mask && cell.length > 3 ? `${cell.slice(0, 3)}…` : cell) || '<span class="empty">leeg</span>'}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`

  const bar = (label: string, value: number) =>
    `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.round(value * 100)}%"></div></div><b>${pct(value)}</b></div>`

  const cards = usable
    .map((opportunity, index) => {
      const shown = present(opportunity, args.mask)
      return `<li class="card">
  <div class="rank">${index + 1}</div>
  <div class="body">
    <div class="top"><b>${escapeHtml(shown.name)}</b><span class="tag">${escapeHtml(opportunity.categoryLabel)}</span><span class="muted">${escapeHtml(opportunity.postalCode ?? '')} ${escapeHtml(opportunity.city ?? '')} · ${escapeHtml(shown.reach)}</span></div>
    <ul class="why">${opportunity.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}${opportunity.mergedRows > 1 ? `<li>${opportunity.mergedRows} rijen in de export samengevoegd tot één contact</li>` : ''}</ul>
    <p class="opener"><span>Openingszin</span> ${escapeHtml(CALL_OPENERS[opportunity.category])}</p>
    <p class="unknown">Wat we níet weten: of deze persoon nu wil verkopen. Dit is een reden om te bellen, geen voorspelling.</p>
  </div>
  <div class="order" title="Volgorde op de lijst, geen verkoopkans">${opportunity.score}<small>volgorde</small></div>
</li>`
    })
    .join('\n')

  const rest = notUsable
    .map((opportunity) => {
      const shown = present(opportunity, args.mask)
      return `<li><b>${escapeHtml(shown.name)}</b> — ${escapeHtml(opportunity.categoryLabel)}: ${escapeHtml(opportunity.notUsableBecause.join('; '))}</li>`
    })
    .join('')

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(args.title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d2327;--muted:#5f6b72;--line:#e3e0d8;--accent:#1f5f8b;--accent-soft:#e3eef6;--warn:#8a5a00;--warn-soft:#fbf1dc}
@media (prefers-color-scheme:dark){:root{--bg:#14181b;--card:#1d2226;--ink:#e8ecee;--muted:#9aa6ad;--line:#2d343a;--accent:#7fb7de;--accent-soft:#1d3342;--warn:#f0c46a;--warn-soft:#3a2f17}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px}
.muted{color:var(--muted)}.step{display:inline-block;background:var(--accent-soft);color:var(--accent);border-radius:99px;padding:2px 10px;font-size:12px;font-weight:600;margin-right:6px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table.raw{border-collapse:collapse;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:nowrap}table.raw th,table.raw td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}.empty{color:var(--muted);font-style:italic}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.stat b{display:block;font-size:24px}
.bars{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px}.bar{display:grid;grid-template-columns:150px 1fr 48px;gap:10px;align-items:center;margin:4px 0}.track{height:8px;background:var(--line);border-radius:99px}.fill{height:8px;background:var(--accent);border-radius:99px}
.warn{background:var(--warn-soft);color:var(--warn);border-radius:10px;padding:10px 14px;margin-top:10px}
ol.list{list-style:none;padding:0;margin:0;display:grid;gap:10px}.card{display:grid;grid-template-columns:36px 1fr 70px;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.rank{font-weight:700;font-size:18px;color:var(--muted)}.top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.tag{background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600}
.why{margin:8px 0;padding-left:18px}.opener{margin:6px 0;font-style:italic}.opener span{font-style:normal;font-size:12px;font-weight:600;color:var(--muted);margin-right:4px}.unknown{margin:4px 0 0;font-size:12px;color:var(--muted)}
.order{text-align:center;font-weight:700;font-size:20px;color:var(--muted)}.order small{display:block;font-size:10px;font-weight:500}
.note{border-left:3px solid var(--accent);padding:6px 12px;background:var(--card);border-radius:0 8px 8px 0}
@media (max-width:640px){.card{grid-template-columns:28px 1fr}.order{grid-column:2;text-align:left}.bar{grid-template-columns:110px 1fr 40px}}
</style></head><body><main>
<h1>${escapeHtml(args.title)}</h1>
<p class="muted">Bestand ${escapeHtml(basename(args.file))} · peildatum ${args.now.toISOString().slice(0, 10)} · berekend met de regels van LeadRevive (ImmoRadar)</p>

<h2><span class="step">1</span>Wat het kantoor aanleverde</h2>
<p>Een gewone CRM-export: namen in twee volgordes, telefoonnummers in vier notaties, dag-eerst datums, Nederlandse en Franse types, dubbele contacten.</p>
<div class="scroll">${rawTable}</div>
<p class="muted">Eerste ${rawRows.length} van ${report.rows} rijen.</p>

<h2><span class="step">2</span>Opgeschoond en ontdubbeld</h2>
<div class="stats">
<div class="stat"><b>${report.rows}</b>rijen in de export</div>
<div class="stat"><b>${report.duplicateRows}</b>dubbele rijen samengevoegd</div>
<div class="stat"><b>${report.invalidRows}</b>onbruikbaar (geen naam/telefoon/e-mail)</div>
<div class="stat"><b>${report.uniqueContacts}</b>unieke contacten</div>
</div>
<div class="bars">
${bar('Telefoon of e-mail', report.coverage.reachable)}
${bar('Volledig adres', report.coverage.address)}
${bar('Aanmaakdatum', report.coverage.createdAt)}
${bar('Laatste contact', report.coverage.lastContactAt)}
${bar('Type herkend', report.coverage.typeRecognised)}
</div>
${report.warnings.map((warning) => `<div class="warn">${escapeHtml(warning)}</div>`).join('')}

<h2><span class="step">3</span>Wie eerst bellen — ${usable.length} bruikbare kansen</h2>
<p class="note"><b>Vóór elk gesprek</b> (GBA, ontwerp-aanbeveling 01/2025, bijlage 2): zeg wie je bent en voor welk kantoor je belt, waarom je belt, dat je gegevens uit ons eigen klantenbestand komen, en dat de persoon bezwaar kan maken. Bel niemand die op de Bel-me-niet-meer-lijst staat.</p>
<p class="note">Een <b>bruikbare kans</b> is een contact met een concrete reden om te bellen (een van zes categorieën), dat bereikbaar is en in het werkgebied ligt. Het getal rechts is de <b>volgorde</b> op de lijst — geen kans op een verkoop.</p>
<ol class="list">
${cards}
</ol>

${rest ? `<h2>Niet op de lijst, en waarom</h2><ul>${rest}</ul>` : ''}
<p class="muted">${report.notSelected} contacten leverden geen reden om te bellen op (recent nog gesproken, huurder, te weinig gegevens, of onder de drempel).</p>
</main></body></html>
`
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    process.stderr.write('Gebruik: npm run leadrevive:intake -- <bestand.csv> [--postcodes 9000,9030] [--out map] [--mask]\n')
    process.exitCode = 1
    return
  }

  const content = readFileSync(args.file, 'utf8')
  const territories: TerritoryDefinition[] =
    args.postcodes.length > 0
      ? [
          {
            id: 'intake',
            agencyId: 'intake',
            name: 'Werkgebied',
            kind: 'POSTAL_CODE',
            postalCodes: args.postcodes,
            municipalities: [],
            provinces: [],
            active: true,
          },
        ]
      : []

  // Zelfde standaarden als src/lib/env.ts, zodat de scan telt wat het product toont.
  const report = runIntake(content, {
    now: args.now,
    territories,
    settings: {
      dormantMonths: numberFromEnv('DORMANT_MONTHS', 12),
      minRelationshipScore: numberFromEnv('MIN_RELATIONSHIP_SCORE', 45),
      minOpportunityScore: numberFromEnv('MIN_OPPORTUNITY_SCORE', 40),
      highValueThreshold: numberFromEnv('HIGH_VALUE_THRESHOLD', 600_000),
    },
  })

  mkdirSync(args.out, { recursive: true })
  writeFileSync(join(args.out, 'intake.md'), markdown(report, args))
  writeFileSync(join(args.out, 'intake.html'), html(report, args, parseCsv(content)))

  process.stdout.write(
    `${report.rows} rijen → ${report.uniqueContacts} unieke contacten → ${report.usableCount} bruikbare kansen.\n` +
      `Rapport: ${join(args.out, 'intake.md')} en ${join(args.out, 'intake.html')}\n`,
  )
}

main()
