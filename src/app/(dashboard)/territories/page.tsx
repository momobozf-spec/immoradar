import { provinceLabel } from '@/domain/geo/provinces'
import { requireAgencyAdminPage } from '@/lib/session'
import * as agencyRepository from '@/repositories/agencyRepository'

import { Badge, Card, CardHeader, EmptyState, PageHeader } from '../../_components/primitives'
import { TerritoryForm, TerritoryRow } from './TerritoryForms'

export const metadata = { title: 'Gebieden' }

/**
 * De gebieden waarin dit kantoor werkt.
 *
 * ─── WAAROM DIT SCHERM ZWAARDER WEEGT DAN HET LIJKT ──────────────────────────
 *
 * Zonder gebied krijgt een kantoor geen enkele kans te zien — de
 * territory-matching is de laatste zeef vóór een opportunity ontstaat. Een
 * kantoor dat hier niets invult, denkt dat het product stuk is. Vandaar dat de
 * lege staat het expliciet zegt in plaats van een streepje te tonen.
 */
export default async function TerritoriesPage() {
  const scope = await requireAgencyAdminPage()
  const territories = await agencyRepository.listTerritories(scope.agencyId)

  return (
    <>
      <PageHeader
        title="Gebieden"
        description="Waar werkt dit kantoor? Alleen kansen binnen deze gebieden komen in je lijst terecht."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {territories.length === 0 ? (
            <EmptyState
              title="Nog geen gebieden ingesteld"
              description="Zolang hier niets staat, ontvangt dit kantoor geen enkele marktkans. Voeg minstens één postcodegebied toe."
            />
          ) : (
            <Card>
              <CardHeader title={`${territories.length} gebieden`} />
              <ul className="divide-y divide-ink-200">
                {territories.map((territory) => {
                  const values =
                    territory.kind === 'POSTAL_CODE'
                      ? territory.postalCodes
                      : territory.kind === 'MUNICIPALITY'
                        ? territory.municipalities
                        : territory.provinces.map((province) => provinceLabel(province))

                  return (
                    <li key={territory.id} className="flex items-start justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-ink-900">{territory.name}</p>
                          {!territory.active && <Badge>inactief</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-600">
                          {territory.kind === 'POSTAL_CODE'
                            ? 'Postcodes'
                            : territory.kind === 'MUNICIPALITY'
                              ? 'Gemeenten'
                              : 'Provincies'}
                          : {values.join(', ')}
                        </p>
                      </div>
                      <TerritoryRow territoryId={territory.id} />
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </div>

        <div>
          <TerritoryForm />
        </div>
      </div>
    </>
  )
}
