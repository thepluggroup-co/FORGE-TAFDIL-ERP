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
  external: ['node-fetch', 'whatwg-url'],
})
