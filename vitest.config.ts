import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.tsx',
      'packages/*/test/**/*.test.js',
    ],
    // Full-suite runs spawn many real git subprocesses; cap parallelism to
    // avoid worker RPC timeouts and git test flakes on high-core machines.
    poolOptions: {
      forks: { maxForks: 8 },
    },
  },
});
