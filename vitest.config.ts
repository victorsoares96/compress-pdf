import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  test: {
    globals: true,
    logHeapUsage: true,
    testTimeout: 10000,
    coverage: {
      enabled: true,
      clean: true,
      provider: 'istanbul',
      all: true,
      extension: ['ts'],
      include: ['src/**/*.ts'],
    },
  },
  plugins: [tsconfigPaths()],
});
