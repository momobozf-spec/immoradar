import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // De suite raakt nooit een echte site en nooit een echte database. De
    // DATABASE_URL hieronder bestaat alleen zodat de env-validatie slaagt;
    // niets in de tests opent een verbinding.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/immoradar_test?schema=public',
      SESSION_SECRET: 'test-session-secret-that-is-at-least-32-chars',
      TELEGRAM_BOT_TOKEN: '',
      COLLECTOR_ENABLED_SOURCES: 'fixture-be,demo-be',
    },
  },
})
