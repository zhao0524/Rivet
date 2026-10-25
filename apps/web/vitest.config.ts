import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Node's native `localStorage` can shadow jsdom's. Disable it only when this runtime
 * supports the flag: Web Storage was added in Node 22.4, not the initial Node 22 release.
 */
const workerNodeArgs = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
  ? ['--no-experimental-webstorage']
  : [];

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    dedupe: ['three', 'react', 'react-dom'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: /^three$/, replacement: path.resolve(__dirname, 'node_modules/three/build/three.module.js') },
      // `require.context` is webpack-only; under Vite the showcase fixtures are enumerated with `import.meta.glob`.
      { find: /^\.\/enumerate-files$/, replacement: path.resolve(__dirname, 'src/lib/showcase/fixtures/enumerate-files.vite.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { execArgv: workerNodeArgs } },
    server: {
      deps: {
        inline: ['three', /@react-three\//],
      },
    },
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
