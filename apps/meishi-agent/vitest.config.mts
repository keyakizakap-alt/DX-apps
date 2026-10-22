import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server suites run twice: on SQLite (self-hosted / local) and on the PostgreSQL schema via PGlite
// (the Neon deployment). Everything else runs once.
const SERVER_SUITES = [
  'tests/integration/sync-e2ee.test.ts',
  'tests/integration/controller.test.ts',
  'tests/security/server-auth.test.ts',
  'tests/security/server-storage.test.ts',
  'tests/security/ai-boundaries.test.ts',
];

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      { extends: true, test: { name: 'sqlite', include: ['tests/**/*.test.ts'] } },
      { extends: true, test: { name: 'postgres', include: SERVER_SUITES, env: { MEISHI_TEST_DB: 'postgres' } } },
    ],
  },
});
