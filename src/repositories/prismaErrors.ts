import { Prisma } from '@/generated/prisma/client'

/**
 * Prisma-foutcodes die de pijplijn als normale uitkomst behandelt.
 *
 * De belangrijkste is P2002 (unique constraint). Dat is hier geen fout maar het
 * mechanisme: de `dedupeKey` op events en alerts maakt dubbel werk fysiek
 * onmogelijk, en een botsing betekent simpelweg "iemand anders was eerder".
 * Zonder deze helper zou elke race tussen twee workers als een crash eindigen
 * in plaats van als "al gedaan".
 */

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
}
