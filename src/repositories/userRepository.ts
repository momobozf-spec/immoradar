import type {
  Agency,
  Subscription,
  SubscriptionStatus,
  User,
  UserRole,
} from '@/generated/prisma/client'

import { prisma } from './prisma'

/**
 * Gebruikers, accounts en kantoorbeheer.
 *
 * ─── DE TENANTGRENS HIER ─────────────────────────────────────────────────────
 *
 * Elke functie die een gebruiker van een kantoor wijzigt, krijgt het `agencyId`
 * mee en zet het in de `where`. Een kantoorbeheerder die het id van een
 * gebruiker van een ander kantoor in een formulier plakt, raakt dan niets: de
 * update vindt geen rij. Dezelfde regel als overal in deze codebase — het
 * kantoor komt uit de sessie, nooit uit de request.
 *
 * Functies zonder `agencyId` zijn uitsluitend voor platformbeheer en de eigen
 * account van de ingelogde gebruiker, en dragen dat in hun naam.
 */

export type SessionUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'name'
  | 'role'
  | 'agencyId'
  | 'active'
  | 'sessionVersion'
  | 'mustChangePassword'
> & {
  agency: (Pick<Agency, 'id' | 'name' | 'active'> & {
    subscription: Pick<Subscription, 'status' | 'endsAt'> | null
  }) | null
}

/** Alles wat de sessiecontrole bij elke request nodig heeft, in één query. */
export async function findSessionUser(userId: string): Promise<SessionUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      agencyId: true,
      active: true,
      sessionVersion: true,
      mustChangePassword: true,
      agency: {
        select: {
          id: true,
          name: true,
          active: true,
          subscription: { select: { status: true, endsAt: true } },
        },
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Inloggen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Telt een mislukte poging, atomair.
 *
 * ─── WAAROM GEEN LEES-REKEN-SCHRIJF ──────────────────────────────────────────
 *
 * Lees je de teller, wacht je op scrypt en schrijf je dan `teller + 1` terug,
 * dan lezen tweehonderd gelijktijdige pogingen allemaal 0 en schrijven ze
 * allemaal 1: tweehonderd gokken per vergrendeling in plaats van vijf. Daarom
 * verhoogt de database zelf (`increment`) en beslist de teruggegeven waarde
 * over de vergrendeling.
 */
export async function registerFailedLogin(
  userId: string,
  lockMinutesFor: (failedLoginCount: number) => number | null,
  now: Date,
  decayMs: number,
): Promise<{ failedLoginCount: number; lockedUntil: Date | null; newlyLocked: boolean }> {
  // Een oude, verlopen vergrendeling telt niet meer mee.
  await prisma.user.updateMany({
    where: { id: userId, lockedUntil: { lt: new Date(now.getTime() - decayMs) } },
    data: { failedLoginCount: 0, lockedUntil: null },
  })

  const counted = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true, lockedUntil: true },
  })

  const minutes = lockMinutesFor(counted.failedLoginCount)
  if (minutes === null) return { ...counted, newlyLocked: false }

  const lockedUntil = new Date(now.getTime() + minutes * 60_000)
  await prisma.user.update({ where: { id: userId }, data: { lockedUntil } })
  return { failedLoginCount: counted.failedLoginCount, lockedUntil, newlyLocked: true }
}

/**
 * Registreert een geslaagde login, maar alleen als het account op dat moment
 * niet vergrendeld is. Een poging die vóór de vergrendeling startte en pas
 * erna klaar was met scrypt, komt er zo niet alsnog door.
 *
 * Geeft false terug als het account intussen op slot ging.
 */
export async function recordSuccessfulLogin(userId: string, now: Date): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id: userId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  })
  return result.count === 1
}

/** Heft een vergrendeling op. Voor het beheerscript; zie scripts/unlock-user.ts. */
export async function unlockByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  })
  if (!user) return null

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  })
  return user.id
}

// ─────────────────────────────────────────────────────────────────────────────
// Eigen account
// ─────────────────────────────────────────────────────────────────────────────

export async function findOwnAccount(userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } })
}

/**
 * Nieuw wachtwoord voor de eigen account. Verhoogt `sessionVersion`, zodat elke
 * andere lopende sessie (een vergeten laptop, een gestolen cookie) vervalt.
 * Geeft de nieuwe versie terug, zodat de huidige sessie opnieuw uitgegeven kan
 * worden en de gebruiker zelf ingelogd blijft.
 */
export async function setOwnPassword(userId: string, passwordHash: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
    select: { sessionVersion: true },
  })
  return user.sessionVersion
}

export async function revokeOwnSessions(userId: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  })
  return user.sessionVersion
}

// ─────────────────────────────────────────────────────────────────────────────
// Team van één kantoor
// ─────────────────────────────────────────────────────────────────────────────

export type TeamMember = Pick<
  User,
  'id' | 'email' | 'name' | 'role' | 'active' | 'lastLoginAt' | 'mustChangePassword' | 'lockedUntil' | 'createdAt'
>

const TEAM_MEMBER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  lastLoginAt: true,
  mustChangePassword: true,
  lockedUntil: true,
  createdAt: true,
} as const

export async function listTeam(agencyId: string): Promise<TeamMember[]> {
  return prisma.user.findMany({
    where: { agencyId },
    select: TEAM_MEMBER_SELECT,
    orderBy: [{ active: 'desc' }, { name: 'asc' }, { email: 'asc' }],
  })
}

export async function findTeamMember(agencyId: string, userId: string): Promise<TeamMember | null> {
  return prisma.user.findFirst({ where: { id: userId, agencyId }, select: TEAM_MEMBER_SELECT })
}

export async function emailExists(email: string): Promise<boolean> {
  const count = await prisma.user.count({ where: { email: email.toLowerCase() } })
  return count > 0
}

export async function createTeamMember(
  agencyId: string,
  input: { email: string; name: string | null; role: Extract<UserRole, 'AGENCY_ADMIN' | 'AGENT'>; passwordHash: string },
): Promise<TeamMember> {
  return prisma.user.create({
    data: {
      agencyId,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      mustChangePassword: true,
    },
    select: TEAM_MEMBER_SELECT,
  })
}

export type TeamUpdateOutcome = 'ok' | 'not_found' | 'last_admin'

/**
 * Wijzigt rol of actief-status van een collega, met de garantie dat er altijd
 * minstens één actieve kantoorbeheerder overblijft.
 *
 * ─── WAAROM IN EEN TRANSACTIE MET SLOT ───────────────────────────────────────
 *
 * Tellen en daarna wijzigen in twee losse stappen laat een race open: twee
 * beheerders die elkaar op hetzelfde moment degraderen, zien elk "er blijft er
 * één over" en laten samen een kantoor zonder beheerder achter. `FOR UPDATE` op
 * de beheerdersrijen van dit kantoor laat de tweede wachten tot de eerste klaar
 * is; zijn telling ziet dan de nieuwe toestand.
 */
export async function updateTeamMemberGuarded(
  agencyId: string,
  userId: string,
  change: { active?: boolean; role?: Extract<UserRole, 'AGENCY_ADMIN' | 'AGENT'> },
): Promise<TeamUpdateOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "agencyId" = ${agencyId} AND "role" = 'AGENCY_ADMIN' FOR UPDATE`

    const member = await tx.user.findFirst({
      where: { id: userId, agencyId },
      select: { role: true, active: true },
    })
    if (!member) return 'not_found'

    const losesAdmin =
      member.role === 'AGENCY_ADMIN' &&
      member.active &&
      (change.active === false || change.role === 'AGENT')

    if (losesAdmin) {
      const others = await tx.user.count({
        where: { agencyId, role: 'AGENCY_ADMIN', active: true, id: { not: userId } },
      })
      if (others === 0) return 'last_admin'
    }

    await tx.user.updateMany({
      where: { id: userId, agencyId },
      data: {
        ...(change.role ? { role: change.role } : {}),
        ...(change.active !== undefined
          ? {
              active: change.active,
              // Deactiveren zet elke lopende sessie meteen uit; ook bij
              // heractiveren komt een oude sessie niet terug.
              sessionVersion: { increment: 1 },
            }
          : {}),
      },
    })
    return 'ok'
  })
}

/** Actieve gebruiker van dit kantoor? Voor het toewijzen van een kans. */
export async function isActiveTeamMember(agencyId: string, userId: string): Promise<boolean> {
  const count = await prisma.user.count({ where: { id: userId, agencyId, active: true } })
  return count === 1
}

export async function setTeamMemberTemporaryPassword(
  agencyId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id: userId, agencyId },
    data: {
      passwordHash,
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
  })
  return result.count === 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Platformbeheer
// ─────────────────────────────────────────────────────────────────────────────

export async function slugExists(slug: string): Promise<boolean> {
  const count = await prisma.agency.count({ where: { slug } })
  return count > 0
}

/**
 * Een nieuw kantoor met zijn abonnement en eerste beheerder, in één transactie.
 * Lukt één stap niet, dan bestaat er niets: geen kantoor zonder beheerder dat
 * niemand ooit kan openen.
 */
export async function createAgencyWithAdmin(input: {
  name: string
  slug: string
  contactEmail: string | null
  plan: string
  maxOpportunitiesPerDay: number
  admin: { email: string; name: string | null; passwordHash: string }
}): Promise<{ agencyId: string; adminUserId: string }> {
  return prisma.$transaction(async (tx) => {
    const agency = await tx.agency.create({
      data: {
        name: input.name,
        slug: input.slug,
        contactEmail: input.contactEmail,
        subscription: {
          create: {
            plan: input.plan,
            status: 'ACTIVE',
            maxOpportunitiesPerDay: input.maxOpportunitiesPerDay,
          },
        },
      },
      select: { id: true },
    })

    const admin = await tx.user.create({
      data: {
        agencyId: agency.id,
        email: input.admin.email.toLowerCase(),
        name: input.admin.name,
        role: 'AGENCY_ADMIN',
        passwordHash: input.admin.passwordHash,
        mustChangePassword: true,
      },
      select: { id: true },
    })

    return { agencyId: agency.id, adminUserId: admin.id }
  })
}

export async function setAgencyActive(agencyId: string, active: boolean): Promise<boolean> {
  const result = await prisma.agency.updateMany({ where: { id: agencyId }, data: { active } })
  return result.count === 1
}

export async function upsertSubscription(
  agencyId: string,
  input: {
    plan: string
    status: SubscriptionStatus
    maxOpportunitiesPerDay: number
    endsAt: Date | null
  },
): Promise<void> {
  await prisma.subscription.upsert({
    where: { agencyId },
    create: { agencyId, ...input },
    update: input,
  })
}

/**
 * De eerste platformbeheerder, voor een lege productiedatabase.
 * Bestaat het adres al, dan gebeurt er niets en is het resultaat `null`.
 */
export async function createPlatformAdminIfMissing(input: {
  email: string
  name: string | null
  passwordHash: string
}): Promise<{ id: string } | null> {
  const email = input.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) return null

  return prisma.user.create({
    data: {
      email,
      name: input.name,
      role: 'PLATFORM_ADMIN',
      agencyId: null,
      passwordHash: input.passwordHash,
      mustChangePassword: true,
    },
    select: { id: true },
  })
}
