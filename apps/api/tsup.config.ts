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
  // tsup's shims inject __require (underscored) but esbuild's bundled CJS
  // wrapper checks for the plain `require` global and throws when absent.
  // Defining require via createRequire in the banner bridges the gap so
  // bundled CJS deps (agentkeepalive → require("http") etc.) work on Node 24.
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
})
