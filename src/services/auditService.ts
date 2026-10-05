import { createLogger } from '@/lib/logger'
import { toJsonValue } from '@/lib/json'
import { prisma } from '@/repositories/prisma'

/**
 * De audittrail: wie deed wat, en namens welk kantoor.
 *
 * ─── WAAROM DIT NOOIT MAG GOOIEN ─────────────────────────────────────────────
 *
 * Een audittrail is een bijproduct van een handeling, geen voorwaarde ervoor.
 * Zou het wegschrijven van een logregel kunnen mislukken en daarmee de
 * statuswijziging terugdraaien, dan verliest de makelaar zijn werk omdat de
 * boekhouding hikte. De fout gaat daarom naar de logs en verder niets.
 *
 * Dat is een bewuste afweging en geen slordigheid: dit is een handelingslog voor
 * ondersteuning en verantwoording, geen financieel grootboek.
 *
 * ─── WAT ER NIET IN GAAT ─────────────────────────────────────────────────────
 *
 * Geen telefoonnummers, geen e-mailadressen van contacten, geen namen van
 * verkopers. Een audittrail die persoonsgegevens dupliceert, is een tweede
 * database die je moet beveiligen en opschonen. Wat erin gaat is een verwijzing:
 * entiteit en id. Wie het dossier mag zien, ziet daar de gegevens.
 */

const logger = createLogger({ component: 'audit' })

export interface AuditInput {
  /** E-mailadres of gebruikers-id; bij systeemtaken de naam van de taak. */
  actor: string
  agencyId?: string | null
  /** Puntgescheiden werkwoord: "opportunity.contacted", "crm.import.confirmed". */
  action: string
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: input.actor,
        agencyId: input.agencyId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? toJsonValue(input.metadata) : undefined,
        ip: input.ip ?? null,
      },
    })
  } catch (error) {
    logger.error('Kon audittrail niet wegschrijven', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** De laatste handelingen, voor het beheerscherm. */
export async function recentAudit(agencyId: string | null, limit = 50) {
  return prisma.auditLog.findMany({
    where: agencyId ? { agencyId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
