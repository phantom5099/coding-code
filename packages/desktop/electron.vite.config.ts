import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

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
