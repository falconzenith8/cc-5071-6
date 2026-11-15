import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    testTimeout: 60000,
    include: ['test/**/*.test.ts'],
  },
});
