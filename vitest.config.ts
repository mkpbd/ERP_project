import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/database/migrations/**'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { name: 'architecture', include: ['test/architecture/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int-spec.ts'],
          globalSetup: ['test/support/global-db-setup.ts'],
          setupFiles: ['test/support/load-test-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          globalSetup: ['test/support/global-db-setup.ts'],
          setupFiles: ['test/support/load-test-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
