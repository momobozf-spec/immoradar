import { z } from 'zod'

import { endOfDayInBrussels } from '@/lib/dates'

/**
 * Zod-schema's voor alles wat van buiten komt: collectoruitvoer, formulieren,
 * querystrings en cron-payloads.
 *
 * De collector-kant is het belangrijkst. Een bron kan van de ene op de andere
 * dag zijn veldnamen wijzigen of een prijs als string gaan sturen; zonder deze
 * poort loopt dat door tot in een alert bij een makelaar ("€ NaN"). Met deze
 * poort wordt het één afgekeurd item en een warning in de collectorrun.
 */

/** Prijzen zijn hele euro's. Vastgoedadvertenties noteren geen centen, en een
 *  Float gaat driften zodra we prijswijzigingen diffen. */
const priceSchema = z
  .number()
  .finite()
  .positive()
  .max(100_000_000)
  .transform((value) => Math.round(value))

/** Accepteert zowel een getal als de stringvorm die veel bronnen gebruiken. */
const looseNumber = z.union([
  z.number(),
  z
    .string()
    .trim()
    .transform((value) => Number(value.replace(/[^\d.,-]/g, '').replace(',', '.'))),
])

const optionalTrimmed = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined)

export const rawListingSchema = z.object({
  source: z.string().min(1),
  sourceListingId: z.string().min(1),
  url: z.string().url(),

  title: optionalTrimmed,
  description: optionalTrimmed,

  price: looseNumber.pipe(priceSchema).optional().catch(undefined),
  currency: z.string().trim().length(3).optional().catch(undefined),

  listingType: z.enum(['sale', 'rent']).optional().catch(undefined),
  propertyType: optionalTrimmed,

  address: optionalTrimmed,
  postalCode: optionalTrimmed,
  city: optionalTrimmed,
  province: optionalTrimmed,

  bedrooms: looseNumber
    .pipe(z.number().int().min(0).max(50))
    .optional()
    .catch(undefined),
  surfaceArea: looseNumber
    .pipe(z.number().int().min(1).max(100_000))
    .optional()
    .catch(undefined),

  sellerName: optionalTrimmed,
  sellerPhone: optionalTrimmed,
  sellerTypeHint: z.enum(['private', 'professional', 'unknown']).optional().catch(undefined),

  publishedAt: z.coerce.date().optional().catch(undefined),
  scrapedAt: z.coerce.date(),

  raw: z.unknown().optional(),
})

export type RawListingInput = z.infer<typeof rawListingSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard-invoer
// ─────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Geen geldig e-mailadres'),
  password: z.string().min(1, 'Wachtwoord ontbreekt'),
})

/** De volledige acquisitiepijplijn, gelijk aan `OpportunityStatus` in Prisma. */
export const OPPORTUNITY_STATUSES = [
  'NEW',
  'ASSIGNED',
  'TO_CONTACT',
  'CONTACTED',
  'INTERESTED',
  'VALUATION_BOOKED',
  'MANDATE_PROPOSED',
  'MANDATE_WON',
  'LOST',
  'DISMISSED',
  'SNOOZED',
] as const

/** Statussen die nog werk vragen. `OPEN` in de filter betekent precies deze. */
export const OPEN_OPPORTUNITY_STATUSES = [
  'NEW',
  'ASSIGNED',
  'TO_CONTACT',
  'CONTACTED',
  'INTERESTED',
  'VALUATION_BOOKED',
  'MANDATE_PROPOSED',
] as const

export const OPPORTUNITY_TYPES = [
  'NEW_FSBO',
  'STALE_FSBO',
  'PRIVATE_PRICE_DROP',
  'PRIVATE_MULTIPLE_PRICE_DROP',
  'PRIVATE_RELIST',
  'AGENCY_TO_PRIVATE',
  'DORMANT_VALUATION_LEAD',
  'FORMER_SELLER_PROSPECT',
  'FORMER_CLIENT',
  'PREVIOUS_BUYER',
  'LOST_MANDATE',
  'UNCONTACTED_LEAD',
] as const

export const opportunityFilterSchema = z.object({
  status: z.enum([...OPPORTUNITY_STATUSES, 'OPEN', 'ALL']).default('OPEN'),
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  origin: z.enum(['MARKET', 'LEADREVIVE', 'CROSS']).optional(),
  /** Alleen kansen met een bevestigde CRM-koppeling. */
  crmOnly: z.coerce.boolean().optional(),
  assignedUserId: z.string().min(1).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  postalCode: z.string().trim().regex(/^\d{4}$/).optional(),
  city: z.string().trim().min(1).optional(),
  propertyType: z
    .enum(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'GARAGE', 'OTHER'])
    .optional(),
  sellerType: z.enum(['PRIVATE', 'PROFESSIONAL', 'UNKNOWN']).optional(),
  sourceKey: z.string().trim().min(1).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  /** Maximale leeftijd van de opportunity in dagen. */
  maxAgeDays: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(['score', 'newest', 'price', 'relationship']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
})

export type OpportunityFilter = z.infer<typeof opportunityFilterSchema>

export const territoryInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Naam ontbreekt').max(80),
    kind: z.enum(['POSTAL_CODE', 'MUNICIPALITY', 'PROVINCE']),
    /** Vrij ingevoerd als "9000, 9030 9040" — scheidingsteken maakt niet uit. */
    values: z.string().trim().min(1, 'Geef minstens één waarde op'),
    active: z.boolean().default(true),
  })
  .transform((input) => ({
    ...input,
    valueList: [
      ...new Set(
        input.values
          .split(/[,;\n]+|\s{1,}/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
      ),
    ],
  }))

export const alertRuleInputSchema = z.object({
  name: z.string().trim().min(1, 'Naam ontbreekt').max(80),
  kind: z.enum(['REALTIME', 'DIGEST']),
  enabled: z.boolean().default(true),
  minScore: z.coerce.number().int().min(0).max(100).default(60),
  types: z.array(z.enum(OPPORTUNITY_TYPES)).default([]),
  requireCrmMatch: z.coerce.boolean().default(false),
  telegramChatId: z.string().trim().max(64).optional(),
  digestHour: z.coerce.number().int().min(0).max(23).default(7),
  quietHoursStart: z.coerce.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).optional(),
})

export const sourceSettingsSchema = z.object({
  sourceId: z.string().min(1),
  enabled: z.boolean(),
  pollIntervalSeconds: z.coerce.number().int().min(30).max(86_400),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(600),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000),
  maxRetries: z.coerce.number().int().min(0).max(10),
})

export const opportunityActionSchema = z.object({
  opportunityId: z.string().min(1),
  /** `status` verplaatst de kans in de pijplijn; de rest zijn losse handelingen. */
  action: z.enum(['status', 'snooze', 'assign', 'note']),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  /** Voor 'snooze': hoeveel dagen. */
  snoozeDays: z.coerce.number().int().min(1).max(90).optional(),
  /** Voor 'assign'. Leeg betekent: toewijzing opheffen. */
  assignedUserId: z.string().min(1).optional(),
  note: z.string().trim().max(2_000).optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// CRM-import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De velden waarop een kolom uit het CSV gelegd kan worden.
 *
 * `ignore` staat er expliciet in: een kolom bewust overslaan is een keuze die
 * bewaard hoort te blijven in `CrmImport.columnMapping`, niet een gat.
 */
export const CRM_IMPORT_FIELDS = [
  'ignore',
  'externalId',
  'firstName',
  'lastName',
  'displayName',
  'email',
  'phone',
  'address',
  'postalCode',
  'city',
  'contactType',
  'status',
  'leadType',
  'assignedAgentName',
  'notes',
  'sourceCreatedAt',
  'lastContactAt',
] as const

export type CrmImportField = (typeof CRM_IMPORT_FIELDS)[number]

export const crmImportMappingSchema = z.object({
  importId: z.string().min(1),
  /** Kolomindex (als string, want het komt uit een formulier) → veldnaam. */
  mapping: z.record(z.string(), z.enum(CRM_IMPORT_FIELDS)),
})

export const crmContactFilterSchema = z.object({
  query: z.string().trim().max(120).optional(),
  contactType: z
    .enum([
      'BUYER',
      'SELLER',
      'LANDLORD',
      'TENANT',
      'VALUATION_LEAD',
      'PROSPECT',
      'FORMER_CLIENT',
      'UNKNOWN',
    ])
    .optional(),
  status: z.enum(['ACTIVE', 'DORMANT', 'LOST', 'WON', 'UNKNOWN']).optional(),
  dormantOnly: z.coerce.boolean().optional(),
  sort: z.enum(['relationship', 'recent', 'name']).default('relationship'),
  page: z.coerce.number().int().min(1).default(1),
})

export type CrmContactFilter = z.infer<typeof crmContactFilterSchema>

export const marketFilterSchema = z.object({
  listingType: z.enum(['SALE', 'RENT']).default('SALE'),
  propertyType: z
    .enum(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'GARAGE', 'OTHER'])
    .optional(),
  days: z.coerce.number().int().min(7).max(365).default(30),
  province: z.string().trim().min(1).optional(),
  groupBy: z.enum(['postalCode', 'city']).default('postalCode'),
})

export type MarketFilter = z.infer<typeof marketFilterSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Accounts en kantoorbeheer
// ─────────────────────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .pipe(z.email('Geen geldig e-mailadres').nullable())

export const TEAM_ROLES = ['AGENCY_ADMIN', 'AGENT'] as const

export const teamMemberInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Geen geldig e-mailadres'),
  name: optionalText(120),
  role: z.enum(TEAM_ROLES, 'Kies een rol'),
})

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const

const maxPerDay = z.coerce
  .number({ error: 'Geef een aantal op' })
  .int('Geef een geheel getal op')
  .min(1, 'Minstens 1')
  .max(1000, 'Hoogstens 1000')

const plan = z.string().trim().min(1, 'Geef een plan op').max(40, 'Hoogstens 40 tekens')

export const agencyCreateSchema = z.object({
  name: z.string().trim().min(2, 'Geef de naam van het kantoor op').max(120),
  /** Korte naam: kleine letters, cijfers en koppeltekens. Wordt nooit meer gewijzigd. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Alleen kleine letters, cijfers en koppeltekens')
    .min(3, 'Minstens 3 tekens')
    .max(60, 'Hoogstens 60 tekens'),
  contactEmail: optionalEmail,
  plan,
  maxOpportunitiesPerDay: maxPerDay,
  adminEmail: z.string().trim().toLowerCase().email('Geen geldig e-mailadres voor de beheerder'),
  adminName: optionalText(120),
})

export const subscriptionInputSchema = z.object({
  plan,
  status: z.enum(SUBSCRIPTION_STATUSES, 'Kies een status'),
  maxOpportunitiesPerDay: maxPerDay,
  /** `yyyy-mm-dd` uit een datumveld; leeg = geen einddatum. Loopt tot het einde van die dag (Brussel). */
  endsAt: z
    .string()
    .trim()
    .optional()
    .transform((value, context) => {
      if (!value) return null
      const date = endOfDayInBrussels(value)
      if (!date) {
        context.addIssue({ code: 'custom', message: 'Ongeldige datum' })
        return z.NEVER
      }
      return date
    }),
})
