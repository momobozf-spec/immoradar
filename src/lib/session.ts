import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { isAgencyServed } from '@/domain/accountPolicy'
import { findSessionUser } from '@/repositories/userRepository'

import { AuthError } from './errors'
import { getEnv, sessionSecret } from './env'
import { signValue, verifySignedValue } from './hash'

/**
 * Sessies en de tenantgrens.
 *
 * ─── WAAROM GEEN next-auth ───────────────────────────────────────────────────
 *
 * Er is één inlogvorm: e-mail en wachtwoord, uitgegeven door de beheerder van
 * het kantoor. Geen zelfregistratie, geen OAuth, geen magic links. Een compleet
 * auth-framework zou hier vooral configuratie en aanvalsoppervlak toevoegen aan
 * iets dat in honderd regels past en volledig te overzien is.
 *
 * ─── WAT ER WÉL IN MOET ──────────────────────────────────────────────────────
 *
 * Het cookie is HMAC-ondertekend en dus niet te vervalsen zonder SESSION_SECRET,
 * httpOnly (niet leesbaar vanuit JavaScript), SameSite=Lax (gaat niet mee vanaf
 * een andere site) en het verloopt.
 *
 * ─── DE BELANGRIJKSTE REGEL VAN DIT BESTAND ──────────────────────────────────
 *
 * `agencyId` komt uit het ondertekende cookie en nooit uit een URL, formulier of
 * querystring. Dat is de hele tenantscheiding. Zou één pagina het kantoor-id uit
 * een parameter lezen, dan is `?agencyId=<ander kantoor>` genoeg om andermans
 * leads te bekijken — en dan helpt geen enkele databasekolom meer.
 *
 * ─── WAAROM ELKE REQUEST TOCH DE DATABASE RAADPLEEGT ─────────────────────────
 *
 * Een ondertekend cookie alleen is niet in te trekken: een ontslagen medewerker
 * of een gestolen cookie blijft geldig tot de vervaldatum. Daarom draagt het
 * cookie `ver` (de `sessionVersion` van de gebruiker op het moment van
 * uitgifte), en controleert `getSession` per request dat de gebruiker nog
 * actief is en dezelfde versie heeft. Rol en kantoor komen daarbij uit de
 * database, niet uit het cookie: een rolwijziging geldt meteen.
 *
 * Het is één query op primaire sleutel, en via React `cache` hooguit één keer
 * per request, hoeveel componenten de sessie ook opvragen.
 */

const COOKIE_NAME = 'immoradar_session'

export type Role = 'PLATFORM_ADMIN' | 'AGENCY_ADMIN' | 'AGENT'

interface SessionPayload {
  /** userId */
  sub: string
  /** Null voor een PLATFORM_ADMIN; die hoort bij geen enkel kantoor. */
  agencyId: string | null
  role: Role
  /** `User.sessionVersion` bij uitgifte. Wijkt hij af, dan is de sessie ingetrokken. */
  ver: number
  /** Uitgegeven op / verloopt op, in milliseconden. */
  iat: number
  exp: number
}

/** Wat nodig is om een cookie uit te geven. */
export interface SessionGrant {
  userId: string
  agencyId: string | null
  role: Role
  sessionVersion: number
}

export interface Session {
  userId: string
  agencyId: string | null
  role: Role
  email: string
  name: string | null
  /** Naam van het kantoor; null voor een platformbeheerder. */
  agencyName: string | null
  /** Tijdelijk wachtwoord dat eerst vervangen moet worden. */
  mustChangePassword: boolean
  /** Kantoor actief en abonnement lopend. Altijd true voor een platformbeheerder. */
  agencyServed: boolean
}

function encode(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signValue(body, secret)}`
}

function decode(token: string, secret: string): SessionPayload | null {
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  if (!verifySignedValue(body, signature, secret)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.ver !== 'number' || !Number.isInteger(payload.ver)) return null
    if (
      payload.role !== 'PLATFORM_ADMIN' &&
      payload.role !== 'AGENCY_ADMIN' &&
      payload.role !== 'AGENT'
    ) {
      return null
    }
    // Een niet-platformbeheerder zonder kantoor zou een gebruiker zijn die
    // overal en nergens bij hoort. Zo'n token weigeren we, ook al is de
    // handtekening geldig.
    if (payload.role !== 'PLATFORM_ADMIN' && typeof payload.agencyId !== 'string') return null

    return payload
  } catch {
    return null
  }
}

export function issueSessionToken(session: SessionGrant): string {
  const env = getEnv()
  const now = Date.now()

  return encode(
    {
      sub: session.userId,
      agencyId: session.agencyId,
      role: session.role,
      ver: session.sessionVersion,
      iat: now,
      exp: now + env.SESSION_TTL_HOURS * 3_600_000,
    },
    sessionSecret(env),
  )
}

export async function setSessionCookie(token: string): Promise<void> {
  const env = getEnv()
  const store = await cookies()

  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600,
  })
}

export async function clearSessionCookie(): Promise<void> {
  ;(await cookies()).delete(COOKIE_NAME)
}

/**
 * De huidige sessie, of null wanneer er niemand (geldig) ingelogd is.
 *
 * Null ook wanneer het cookie technisch klopt maar de gebruiker intussen
 * gedeactiveerd is, zijn wachtwoord wijzigde, of "overal uitloggen" koos.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = decode(token, sessionSecret())
  if (!payload) return null

  const user = await findSessionUser(payload.sub)
  if (!user || !user.active) return null
  if (user.sessionVersion !== payload.ver) return null

  // Zelfde regel als bij het inloggen: een kantoorrol zonder kantoor is een
  // configuratiefout, en die laten we niet binnen.
  if (user.role !== 'PLATFORM_ADMIN' && !user.agencyId) return null

  const agencyServed =
    user.role === 'PLATFORM_ADMIN' ||
    (user.agency !== null &&
      isAgencyServed(
        { agencyActive: user.agency.active, subscription: user.agency.subscription },
        new Date(),
      ))

  return {
    userId: user.id,
    agencyId: user.role === 'PLATFORM_ADMIN' ? null : user.agencyId,
    role: user.role,
    email: user.email,
    name: user.name,
    agencyName: user.agency?.name ?? null,
    mustChangePassword: user.mustChangePassword,
    agencyServed,
  }
})

/**
 * Eist een ingelogde bezoeker.
 *
 * ─── WAAROM DIT REDIRECT EN NIET GOOIT ───────────────────────────────────────
 *
 * Niet ingelogd zijn is geen fout maar een routeringsvraag — het is de meest
 * voorkomende request die een afgeschermde app krijgt. Next rendert layout en
 * pagina parallel; gooide dit een `AuthError`, dan logt elke anonieme bezoeker
 * een stacktrace terwijl de layout ondertussen netjes doorstuurt. Dat leert
 * mensen logregels negeren, en dan mis je de keer dat er écht iets stuk is.
 *
 * `redirect()` gooit intern een NEXT_REDIRECT die het framework zelf afhandelt.
 * `AuthError` blijft gereserveerd voor wél ingelogd maar niet bevoegd — dat is
 * een echte autorisatiefout en hoort wél op te vallen.
 */
export async function requireSession(
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')

  // Een tijdelijk wachtwoord geeft toegang tot precies één ding: het vervangen.
  if (session.mustChangePassword && !options.allowPendingPasswordChange) {
    redirect('/account')
  }

  return session
}

/** De tenantcontext. Elke query over kantoordata begint hiermee. */
export interface AgencyScope {
  agencyId: string
  role: Role
  userId: string
}

/**
 * Eist een sessie die bij een kantoor hoort.
 *
 * Een PLATFORM_ADMIN hoort bij geen enkel kantoor en krijgt hier dus een fout —
 * bewust. Admin-schermen (bronbeheer) gebruiken `requirePlatformAdmin`;
 * kantoorschermen gebruiken deze. Dat een beheerder "alles mag" betekent niet
 * dat hij ergens als kantoor A doorgaat, want dan zouden zijn handelingen in de
 * audittrail van dat kantoor belanden alsof zij het deden.
 */
export async function requireAgencyScope(): Promise<AgencyScope> {
  const session = await requireSession()

  if (!session.agencyId) {
    throw new AuthError('Deze pagina hoort bij een kantoor; je account is een platformbeheerder')
  }

  // Gepauzeerd, opgezegd of gedeactiveerd: geen kantoordata, wel een uitleg.
  if (!session.agencyServed) redirect('/inactief')

  return { agencyId: session.agencyId, role: session.role, userId: session.userId }
}

export async function requirePlatformAdmin(): Promise<Session> {
  const session = await requireSession()
  if (session.role !== 'PLATFORM_ADMIN') throw new AuthError('Alleen voor platformbeheerders')
  return session
}

/**
 * Eist beheerrechten binnen het eigen kantoor.
 *
 * AGENT mag opportunities opvolgen; gebieden, alertregels en gebruikers zijn
 * voor AGENCY_ADMIN. Zonder dat onderscheid kan elke medewerker de meldingen van
 * het hele kantoor omzetten.
 */
export async function requireAgencyAdmin(): Promise<AgencyScope> {
  const scope = await requireAgencyScope()
  if (scope.role === 'AGENT') {
    throw new AuthError('Alleen een kantoorbeheerder mag dit wijzigen')
  }
  return scope
}

/**
 * Hetzelfde als `requireAgencyAdmin`, maar voor pagina's.
 *
 * ─── WAAROM ER TWEE VARIANTEN ZIJN ───────────────────────────────────────────
 *
 * Gooien is het juiste gedrag in een serveractie: daar is de aanroep een
 * opdracht die faalt, en de aanroeper vangt de fout op en toont een melding.
 *
 * Op een pagina is gooien het verkeerde gedrag. Een makelaar die op een oude
 * bladwijzer naar /gebieden klikt heeft niets fout gedaan; hij hoort geen
 * foutpagina te krijgen maar gewoon zijn eigen lijst. Een 500 zou bovendien
 * suggereren dat er iets stuk is in plaats van dat hij hier niet hoort.
 *
 * De navigatie verbergt deze pagina's al voor een AGENT; dit is de tweede,
 * echte grendel — voor wie de URL toch intypt.
 */
export async function requireAgencyAdminPage(): Promise<AgencyScope> {
  const scope = await requireAgencyScope()
  if (scope.role === 'AGENT') redirect('/')
  return scope
}

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: 'Platformbeheerder',
  AGENCY_ADMIN: 'Kantoorbeheerder',
  AGENT: 'Makelaar',
}
