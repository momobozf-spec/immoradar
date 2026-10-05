/**
 * Draait één keer bij het opstarten van de Next-server, vóór de eerste request.
 *
 * Hier valt de productiecontrole op geheimen en configuratie. Zonder deze hook
 * zou de webserver met een ontbrekend SESSION_SECRET gewoon starten en pas bij
 * de eerste login falen. De worker doet dezelfde controle in src/jobs/worker.ts.
 *
 * Bij een fout stopt het proces met exitcode 1, in plaats van een server te
 * laten draaien die elke request weigert: een hostingplatform ziet dan meteen
 * een mislukte deploy en houdt de vorige versie online.
 *
 * De controle zelf zit in instrumentation-node.ts, zodat de Edge-bundel nooit
 * `process.exit` bevat.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkProductionSecretsOrExit } = await import('./instrumentation-node')
    checkProductionSecretsOrExit()
  }
}
