import type { Agency, AlertRule, Prisma, Territory, User } from '@/generated/prisma/client'

import type { TerritoryDefinition } from '@/territories/territoryMatch'

import { prisma } from './prisma'

/**
 * Kantoren, gebruikers, gebieden en alertregels.
 *
 * Alles wat hier binnenkomt of uitgaat is tenantdata. De enige functie zonder
 * `agencyId` is `allActiveTerritories`, en die bestaat juist omdat de pijplijn
 * moet kunnen bepalen wélke kantoren een kans krijgen — dat is de ene plek waar
 * je over alle kantoren heen moet kijken, en ze staat daarom apart en met uitleg.
 */

export async function findAgency(agencyId: string): Promise<Agency | null> {
  return prisma.agency.findUnique({ where: { id: agencyId } })
}

export async function listAgencies(): Promise<Agency[]> {
  return prisma.agency.findMany({ orderBy: { name: 'asc' } })
}

/**
 * De kantoren die bediend worden: actief, en zonder abonnement of met een
 * lopend abonnement. Dezelfde regel als `isAgencyServed` in
 * src/domain/accountPolicy.ts, maar als databasefilter, zodat de pijplijn geen
 * kansen of meldingen maakt voor een kantoor dat gepauzeerd of opgezegd is.
 */
export function servedAgencyWhere(now: Date = new Date()): Prisma.AgencyWhereInput {
  return {
    active: true,
    OR: [
      { subscription: { is: null } },
      {
        subscription: {
          is: { status: 'ACTIVE', OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        },
      },
    ],
  }
}

export async function listServedAgencies(): Promise<Agency[]> {
  return prisma.agency.findMany({ where: servedAgencyWhere(), orderBy: { name: 'asc' } })
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } })
}

export async function findUser(userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } })
}

export async function recordLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
}

export async function listUsers(agencyId: string): Promise<User[]> {
  return prisma.user.findMany({
    where: { agencyId, active: true },
    orderBy: { name: 'asc' },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Gebieden
// ─────────────────────────────────────────────────────────────────────────────

export async function listTerritories(agencyId: string): Promise<Territory[]> {
  return prisma.territory.findMany({
    where: { agencyId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
}

/**
 * Alle actieve gebieden van alle actieve kantoren.
 *
 * ─── DE ENIGE QUERY DIE OVER TENANTS HEEN KIJKT ──────────────────────────────
 *
 * De pijplijn moet bij elk marktsignaal bepalen wélke kantoren het in hun gebied
 * hebben. Dat kan niet per kantoor, want dan zou je de hele markt één keer per
 * kantoor doorrekenen.
 *
 * Wat hier teruggegeven wordt is bewust minimaal: alleen gebiedsdefinities en
 * het bijbehorende `agencyId`. Geen kansen, geen contacten, geen instellingen.
 * De uitkomst wordt gebruikt om kansen te *maken*, niet om ze te tonen — en elke
 * kans die eruit ontstaat draagt vanaf dat moment zijn eigen `agencyId`.
 */
export async function allActiveTerritories(): Promise<TerritoryDefinition[]> {
  const territories = await prisma.territory.findMany({
    where: { active: true, agency: servedAgencyWhere() },
    select: {
      id: true,
      agencyId: true,
      name: true,
      kind: true,
      postalCodes: true,
      municipalities: true,
      provinces: true,
      active: true,
    },
  })

  return territories
}

export async function createTerritory(
  agencyId: string,
  input: {
    name: string
    kind: 'POSTAL_CODE' | 'MUNICIPALITY' | 'PROVINCE'
    postalCodes: string[]
    municipalities: string[]
    provinces: string[]
    active: boolean
  },
): Promise<Territory> {
  return prisma.territory.create({ data: { agencyId, ...input } })
}

/** Verwijdert een gebied — alleen als het van dit kantoor is. */
export async function deleteTerritory(agencyId: string, territoryId: string): Promise<boolean> {
  const result = await prisma.territory.deleteMany({ where: { id: territoryId, agencyId } })
  return result.count > 0
}

export async function setTerritoryActive(
  agencyId: string,
  territoryId: string,
  active: boolean,
): Promise<boolean> {
  const result = await prisma.territory.updateMany({
    where: { id: territoryId, agencyId },
    data: { active },
  })
  return result.count > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertregels
// ─────────────────────────────────────────────────────────────────────────────

export async function listAlertRules(agencyId: string): Promise<AlertRule[]> {
  return prisma.alertRule.findMany({ where: { agencyId }, orderBy: { name: 'asc' } })
}

export async function activeAlertRules(
  kind: 'REALTIME' | 'DIGEST',
): Promise<(AlertRule & { agency: Agency })[]> {
  return prisma.alertRule.findMany({
    where: { enabled: true, kind, agency: servedAgencyWhere() },
    include: { agency: true },
  })
}

export async function createAlertRule(
  agencyId: string,
  input: Omit<Parameters<typeof prisma.alertRule.create>[0]['data'], 'agency' | 'agencyId'>,
): Promise<AlertRule> {
  return prisma.alertRule.create({ data: { ...input, agencyId } })
}

export async function updateAlertRule(
  agencyId: string,
  alertRuleId: string,
  data: Parameters<typeof prisma.alertRule.updateMany>[0]['data'],
): Promise<boolean> {
  const result = await prisma.alertRule.updateMany({ where: { id: alertRuleId, agencyId }, data })
  return result.count > 0
}

export async function deleteAlertRule(agencyId: string, alertRuleId: string): Promise<boolean> {
  const result = await prisma.alertRule.deleteMany({ where: { id: alertRuleId, agencyId } })
  return result.count > 0
}

export async function touchAlertRule(alertRuleId: string, firedAt: Date): Promise<void> {
  await prisma.alertRule.update({ where: { id: alertRuleId }, data: { lastFiredAt: firedAt } })
}

export async function updateAgencySettings(
  agencyId: string,
  data: { name?: string; contactEmail?: string | null; telegramChatId?: string | null },
): Promise<void> {
  await prisma.agency.update({ where: { id: agencyId }, data })
}
