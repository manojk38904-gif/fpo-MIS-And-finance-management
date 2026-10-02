import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Integration suites share one real PostgreSQL/Redis test environment and
    // intentionally exercise tenant isolation. Running files in parallel lets
    // one suite's fixture cleanup invalidate another suite's live sessions or
    // rows, producing false 401/RLS failures. Keep files sequential; individual
    // tests can still exercise concurrency explicitly where the spec requires it.
    fileParallelism: false,
  },
});
