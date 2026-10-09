import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 与 packages/desktop/vitest.config.ts 同一份别名：从仓库根跑全量测试时，
    // 桌面端源码里的 `@shared/*` 值导入也要能解析
    alias: {
      '@shared': resolve(__dirname, 'packages/desktop/shared'),
    },
  },
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
