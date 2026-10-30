import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts', 'overlay/src/**/*.test.ts'],
    restoreMocks: true,
    setupFiles: ['./scripts/offline-network.mjs'],
  },
});
