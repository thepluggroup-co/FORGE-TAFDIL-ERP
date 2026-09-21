import { defineConfig } from 'tsup'

export default defineConfig([
  // ── Build normal (dev + Railway) ───────────────────────────────────────────
  // Dépendances npm restent externes — Node les résout depuis node_modules.
  {
    entry:    ['src/index.ts'],
    format:   ['esm'],
    outDir:   'dist',
    splitting: false,
    sourcemap: false,
    clean:     true,
    platform:  'node',
    target:    'node20',
    shims:     true,
    noExternal: [/@forge\/.*/],
    banner: {
      js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
    },
  },

  // ── Build standalone CJS (Electron desktop — child_process.fork) ──────────
  // Format CJS obligatoire : fork() d'Electron ne supporte pas les ESM .mjs.
  // TOUS les packages npm bundlés → fichier unique, pas de node_modules séparé.
  {
    entry:     ['src/index.ts'],
    format:    ['cjs'],
    outDir:    'dist/standalone',
    outExtension: () => ({ js: '.cjs' }),
    splitting:  false,
    sourcemap:  false,
    clean:      true,
    platform:   'node',
    target:     'node20',
    shims:      true,
    noExternal: [/.*/],
    external: [
      'better-sqlite3',
      'bufferutil',
      'utf-8-validate',
    ],
  },
])
