/**
 * Belgische postcodes → gemeente en provincie.
 *
 * ─── WAAROM DIT EEN BEREIK-TABEL IS EN GEEN LIJST VAN 2.700 POSTCODES ────────
 *
 * België deelt postcodes uit in aaneengesloten blokken per provincie. 1000–1299
 * is Brussel, 2000–2999 Antwerpen, 9000–9999 Oost-Vlaanderen. Die blokken zijn
 * stabiel en publiek. Een bereik-tabel van dertien regels dekt dus élke
 * Belgische postcode, terwijl een volledige gemeentelijst 2.700 regels kost die
 * bij elke gemeentefusie verouderen.
 *
 * Voor de gemeenten geldt het omgekeerde: territories worden in de praktijk op
 * steden ingesteld, en die wil je op naam kunnen matchen. De lijst dekt de
 * steden waar de dienst voor bedoeld is; een postcode die er niet in staat
 * krijgt gewoon geen `city`, en het postcode-territory werkt nog steeds. Falen
 * op de gemeentenaam mag nooit de postcodematch breken.
 */

export const PROVINCES = [
  'brussels',
  'antwerpen',
  'vlaams-brabant',
  'waals-brabant',
  'west-vlaanderen',
  'oost-vlaanderen',
  'henegouwen',
  'luik',
  'limburg',
  'luxemburg',
  'namen',
] as const

export type Province = (typeof PROVINCES)[number]

export const PROVINCE_LABELS: Record<Province, string> = {
  brussels: 'Brussels Hoofdstedelijk Gewest',
  antwerpen: 'Antwerpen',
  'vlaams-brabant': 'Vlaams-Brabant',
  'waals-brabant': 'Waals-Brabant',
  'west-vlaanderen': 'West-Vlaanderen',
  'oost-vlaanderen': 'Oost-Vlaanderen',
  henegouwen: 'Henegouwen',
  luik: 'Luik',
  limburg: 'Limburg',
  luxemburg: 'Luxemburg',
  namen: 'Namen',
}

interface PostalRange {
  from: number
  to: number
  province: Province
}

/**
 * De officiële blokindeling. Let op 1300–1499: dat is Waals-Brabant, niet
 * Vlaams-Brabant — een fout die makkelijk te maken is omdat de blokken van
 * Brussel en Vlaams-Brabant er direct omheen liggen.
 */
const POSTAL_RANGES: readonly PostalRange[] = [
  { from: 1000, to: 1299, province: 'brussels' },
  { from: 1300, to: 1499, province: 'waals-brabant' },
  { from: 1500, to: 1999, province: 'vlaams-brabant' },
  { from: 2000, to: 2999, province: 'antwerpen' },
  { from: 3000, to: 3499, province: 'vlaams-brabant' },
  { from: 3500, to: 3999, province: 'limburg' },
  { from: 4000, to: 4999, province: 'luik' },
  { from: 5000, to: 5999, province: 'namen' },
  { from: 6000, to: 6599, province: 'henegouwen' },
  { from: 6600, to: 6999, province: 'luxemburg' },
  { from: 7000, to: 7999, province: 'henegouwen' },
  { from: 8000, to: 8999, province: 'west-vlaanderen' },
  { from: 9000, to: 9999, province: 'oost-vlaanderen' },
]

/** Postcode (viercijferig) → gemeentenaam, voor de steden die ertoe doen. */
const POSTAL_CITIES: Readonly<Record<string, string>> = {
  '1000': 'Brussel',
  '1030': 'Schaarbeek',
  '1040': 'Etterbeek',
  '1050': 'Elsene',
  '1060': 'Sint-Gillis',
  '1070': 'Anderlecht',
  '1080': 'Sint-Jans-Molenbeek',
  '1082': 'Sint-Agatha-Berchem',
  '1090': 'Jette',
  '1140': 'Evere',
  '1150': 'Sint-Pieters-Woluwe',
  '1160': 'Oudergem',
  '1170': 'Watermaal-Bosvoorde',
  '1180': 'Ukkel',
  '1190': 'Vorst',
  '1200': 'Sint-Lambrechts-Woluwe',
  '1210': 'Sint-Joost-ten-Node',
  '1300': 'Waver',
  '1310': 'Terhulpen',
  '1340': 'Ottignies-Louvain-la-Neuve',
  '1400': 'Nijvel',
  '1410': 'Waterloo',
  '1500': 'Halle',
  '1600': 'Sint-Pieters-Leeuw',
  '1700': 'Dilbeek',
  '1800': 'Vilvoorde',
  '1830': 'Machelen',
  '1930': 'Zaventem',
  '2000': 'Antwerpen',
  '2018': 'Antwerpen',
  '2020': 'Antwerpen',
  '2030': 'Antwerpen',
  '2050': 'Antwerpen',
  '2060': 'Antwerpen',
  '2100': 'Deurne',
  '2140': 'Borgerhout',
  '2170': 'Merksem',
  '2180': 'Ekeren',
  '2200': 'Herentals',
  '2300': 'Turnhout',
  '2400': 'Mol',
  '2500': 'Lier',
  '2600': 'Berchem',
  '2610': 'Wilrijk',
  '2800': 'Mechelen',
  '2900': 'Schoten',
  '2930': 'Brasschaat',
  '3000': 'Leuven',
  '3001': 'Heverlee',
  '3010': 'Kessel-Lo',
  '3200': 'Aarschot',
  '3300': 'Tienen',
  '3500': 'Hasselt',
  '3600': 'Genk',
  '3700': 'Tongeren',
  '3800': 'Sint-Truiden',
  '3900': 'Pelt',
  '4000': 'Luik',
  '4020': 'Luik',
  '4100': 'Seraing',
  '4500': 'Hoei',
  '4600': 'Wezet',
  '4700': 'Eupen',
  '4800': 'Verviers',
  '5000': 'Namen',
  '5100': 'Jambes',
  '5300': 'Andenne',
  '5500': 'Dinant',
  '6000': 'Charleroi',
  '6040': 'Jumet',
  '6200': 'Châtelet',
  '6700': 'Aarlen',
  '6800': 'Libramont-Chevigny',
  '6900': 'Marche-en-Famenne',
  '7000': 'Bergen',
  '7100': 'La Louvière',
  '7300': 'Bergen',
  '7500': 'Doornik',
  '7700': 'Moeskroen',
  '8000': 'Brugge',
  '8200': 'Brugge',
  '8300': 'Knokke-Heist',
  '8400': 'Oostende',
  '8500': 'Kortrijk',
  '8600': 'Diksmuide',
  '8700': 'Tielt',
  '8800': 'Roeselare',
  '8900': 'Ieper',
  '9000': 'Gent',
  '9030': 'Mariakerke',
  '9040': 'Sint-Amandsberg',
  '9050': 'Gentbrugge',
  '9100': 'Sint-Niklaas',
  '9200': 'Dendermonde',
  '9300': 'Aalst',
  '9400': 'Ninove',
  '9500': 'Geraardsbergen',
  '9600': 'Ronse',
  '9700': 'Oudenaarde',
  '9800': 'Deinze',
  '9900': 'Eeklo',
}

/**
 * Herkent een Belgische postcode in vrije tekst of een los veld.
 *
 * Ruim ingesteld: bronnen schrijven "B-9000", "9000 Gent" of "9000". Een
 * vijfcijferig getal is géén Belgische postcode (dat is Frankrijk of Duitsland)
 * en levert bewust null op.
 */
export function parseBelgianPostalCode(input: string | null | undefined): string | null {
  if (!input) return null

  const match = input.match(/(?<![\d])(?:B[- ]?)?([1-9]\d{3})(?![\d])/i)
  if (!match?.[1]) return null

  const code = match[1]
  return isBelgianPostalCode(code) ? code : null
}

export function isBelgianPostalCode(code: string): boolean {
  if (!/^[1-9]\d{3}$/.test(code)) return false
  const numeric = Number(code)
  return numeric >= 1000 && numeric <= 9992
}

export function provinceForPostalCode(code: string | null | undefined): Province | null {
  if (!code || !isBelgianPostalCode(code)) return null
  const numeric = Number(code)
  return (
    POSTAL_RANGES.find((range) => numeric >= range.from && numeric <= range.to)?.province ?? null
  )
}

export function cityForPostalCode(code: string | null | undefined): string | null {
  if (!code) return null
  return POSTAL_CITIES[code] ?? null
}

export function isProvince(value: string): value is Province {
  return (PROVINCES as readonly string[]).includes(value)
}

export function provinceLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return isProvince(value) ? PROVINCE_LABELS[value] : value
}
