import { assertProductionSecrets } from './lib/env'

/** Alleen in de Node-runtime geladen (zie instrumentation.ts). */
export function checkProductionSecretsOrExit(): void {
  try {
    assertProductionSecrets()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
