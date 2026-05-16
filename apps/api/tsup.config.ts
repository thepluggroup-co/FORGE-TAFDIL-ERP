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
  // Inject ESM shims (__dirname, __filename, etc.)
  shims: true,
  // Bundle workspace packages inline (they export .ts source files)
  noExternal: [/@forge\/.*/],
})
