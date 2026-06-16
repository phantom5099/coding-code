import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: resolve(root, 'dist/cli.bundle.js'),
  // pino-pretty 仅在开发模式使用，生产模式不会加载
  external: ['pino-pretty'],
  // 动态 import 的 TUI 路径无法静态解析，保持原样
  splitting: false,
  sourcemap: true,
  minify: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  logOverride: {
    'commonjs-variable-in-esm': 'silent',
  },
});

console.log('Backend bundle written to dist/cli.bundle.js');
