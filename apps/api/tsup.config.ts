import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  clean: true,
  platform: 'node',
  target: 'node20',
  shims: true,
  noExternal: [/@forge\/.*/],
  // Prevent CJS transitive deps from being inlined into the ESM bundle.
  // node-fetch@2 → whatwg-url → require("punycode") crashes on Node.js 24.
  external: ['node-fetch', 'whatwg-url', 'punycode'],
})
