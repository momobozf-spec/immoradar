import type { SellerIdentity, SellerType } from '@/generated/prisma/client'

import type { SellerClassification } from '@/domain/types'
import { normalizeAgencyName, normalizeText } from '@/lib/text'

import { prisma } from './prisma'
import { isUniqueViolation } from './prismaErrors'

/**
 * Verkopers herkennen en bijhouden (de marktkant).
 *
 * ─── DE IDENTITEITSVRAAG ─────────────────────────────────────────────────────
 *
 * Twee advertenties met hetzelfde telefoonnummer zijn dezelfde verkoper. Dat is
 * hard, want een nummer is van één persoon of één kantoor. Daarom is
 * `phoneE164` de primaire sleutel voor identiteit.
 *
 * Zonder telefoonnummer valt er terug op de naam. Dat is zwakker: "Jan Peeters"
 * kan twee verschillende mensen zijn. De gevolgen van die fout zijn bewust
 * asymmetrisch gekozen: samengevoegde verkopers krijgen een hogere
 * `activeListingCount`, wat ze richting *professioneel* duwt — en professioneel
 * betekent geen FSBO-melding. Fout zitten kost ons dus een gemiste lead, niet
 * een verkeerde lead bij een makelaar. Dat is de goede kant om op te falen.
 *
 * ─── LET OP HET VERSCHIL MET CrmContact ──────────────────────────────────────
 *
 * `SellerIdentity` is een publiek waargenomen identiteit uit de markt, gedeeld
 * tussen alle tenants. Een `CrmContact` is een klantrelatie van één kantoor. Er
 * loopt geen relatie van hier naar daar; de brug is de CRM-matching, en die
 * maakt per kantoor een eigen oordeel. Zou er wél een directe koppeling zijn,
 * dan kon kantoor A langs een gedeelde verkoper bij het klantenbestand van
 * kantoor B komen.
 */

export interface SellerIdentityInput {
  displayName: string | null
  phoneE164: string | null
}

export async function resolveSeller(
  input: SellerIdentityInput,
  now: Date,
): Promise<SellerIdentity | null> {
  if (!input.phoneE164 && !input.displayName) return null

  const normalizedName = input.displayName ? normalizeText(input.displayName) : null

  if (input.phoneE164) {
    const existing = await prisma.sellerIdentity.findUnique({
      where: { phoneE164: input.phoneE164 },
    })
    if (existing) {
      return prisma.sellerIdentity.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          // Een naam die we eerder niet hadden alsnog invullen; een bestaande
          // naam niet overschrijven met iets uit een magerdere bron.
          displayName: existing.displayName ?? input.displayName,
          normalizedName: existing.normalizedName ?? normalizedName,
        },
      })
    }
  }

  if (input.displayName && normalizedName && normalizedName.length >= 3) {
    const byName = await prisma.sellerIdentity.findFirst({
      where: {
        normalizedName,
        // Alleen samenvoegen met een verkoper die óók geen nummer heeft, of met
        // precies dit nummer. Anders zou een naamgelijkenis een verkoper met een
        // ander telefoonnummer opslokken.
        OR: [{ phoneE164: null }, { phoneE164: input.phoneE164 ?? undefined }],
      },
      orderBy: { lastSeenAt: 'desc' },
    })

    if (byName) {
      return prisma.sellerIdentity.update({
        where: { id: byName.id },
        data: { lastSeenAt: now, phoneE164: byName.phoneE164 ?? input.phoneE164 },
      })
    }
  }

  try {
    return await prisma.sellerIdentity.create({
      data: {
        displayName: input.displayName,
        normalizedName,
        phoneE164: input.phoneE164,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    })
  } catch (error) {
    // Race met een andere worker op hetzelfde telefoonnummer: de ander was
    // eerder, dus pak zijn rij.
    if (isUniqueViolation(error) && input.phoneE164) {
      return prisma.sellerIdentity.findUnique({ where: { phoneE164: input.phoneE164 } })
    }
    throw error
  }
}

/** Hoeveel advertenties van deze verkoper nu actief zijn — het professioneel-signaal. */
export async function countActiveListings(sellerId: string): Promise<number> {
  return prisma.listing.count({
    where: { sellerId, status: { in: ['ACTIVE', 'MISSING'] } },
  })
}

export async function applyClassification(
  sellerId: string,
  classification: SellerClassification,
  activeListingCount: number,
): Promise<void> {
  await prisma.sellerIdentity.update({
    where: { id: sellerId },
    data: {
      classification: toPrismaSellerType(classification.type),
      confidence: classification.confidence,
      reasons: classification.reasons.slice(0, 10),
      activeListingCount,
    },
  })
}

/**
 * Koppelt een professionele verkoper aan een marktidentiteit (Competitor Radar).
 *
 * `normalizedName` is de sleutel: "Immo De Meyer BVBA" en "immo de meyer" horen
 * één concurrent te zijn, anders halveren hun cijfers in de vergelijking.
 */
export async function linkAgencyIdentity(
  sellerId: string,
  agencyName: string,
  phoneE164: string | null,
  now: Date,
): Promise<string | null> {
  const normalizedName = normalizeAgencyName(agencyName)
  if (normalizedName.length < 3) return null

  const identity = await prisma.agencyIdentity.upsert({
    where: { normalizedName },
    update: { lastSeenAt: now },
    create: {
      name: agencyName.trim(),
      normalizedName,
      phoneE164,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  })

  await prisma.sellerIdentity.update({
    where: { id: sellerId },
    data: { agencyIdentityId: identity.id },
  })

  return identity.id
}

function toPrismaSellerType(value: 'private' | 'professional' | 'unknown'): SellerType {
  switch (value) {
    case 'private':
      return 'PRIVATE'
    case 'professional':
      return 'PROFESSIONAL'
    case 'unknown':
      return 'UNKNOWN'
  }
}
