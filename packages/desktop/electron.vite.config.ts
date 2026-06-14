import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const codingcodeRoot = resolve(__dirname, '../codingcode/src');
const infraRoot = resolve(__dirname, '../infra/src');

// 读取 package.json 获取第三方依赖列表
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const thirdPartyDeps = Object.keys(pkg.dependencies || {}).filter(
  (dep) => !dep.startsWith('@codingcode/')
);

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('electron/main.ts'),
      },
      rollupOptions: {
        external: thirdPartyDeps,
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@codingcode/core/core/workspace': resolve(codingcodeRoot, 'core/workspace.ts'),
        '@codingcode/core/layer': resolve(codingcodeRoot, 'layer.ts'),
        '@codingcode/core/server/create': resolve(codingcodeRoot, 'server/index.ts'),
        '@codingcode/core/server/port-discovery': resolve(
          codingcodeRoot,
          'server/port-discovery.ts'
        ),
        '@codingcode/infra/config': resolve(infraRoot, 'config.ts'),
        '@codingcode/infra/logger': resolve(infraRoot, 'logger.ts'),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: resolve('electron/preload.ts'),
      },
      rollupOptions: {
        external: thirdPartyDeps,
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('shared'),
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@shared': resolve('shared'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
