import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

function loadEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf-8')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
        // split sur le PREMIER '=' seulement — les JWT/secrets en contiennent dans leur valeur
        .map(l => {
          const idx = l.indexOf('=')
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()] as [string, string]
        })
        .filter(([k]) => k)
    )
  } catch { return {} }
}
const env = loadEnvFile(resolve(__dirname, '.env'))
// Même fichier que celui lu par `vite build` du renderer en production
const webEnv = loadEnvFile(resolve(__dirname, '../web/.env.local'))

export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: [
        'electron-log',
        'electron-updater',
        // Supabase + ws are bundled inline: not direct desktop deps and not
        // accessible via pnpm's non-flat node_modules at runtime.
        'ws',
        '@supabase/supabase-js',
        '@supabase/realtime-js',
        '@supabase/postgrest-js',
        '@supabase/storage-js',
        '@supabase/functions-js',
        '@supabase/auth-js',
      ],
    })],
    define: {
      'process.env.SUPABASE_URL':              JSON.stringify(env.SUPABASE_URL              ?? ''),
      'process.env.VITE_SUPABASE_URL':         JSON.stringify(env.SUPABASE_URL              ?? ''),
      'process.env.SUPABASE_ANON_KEY':         JSON.stringify(env.SUPABASE_ANON_KEY         ?? ''),
      'process.env.VITE_SUPABASE_ANON_KEY':    JSON.stringify(env.SUPABASE_ANON_KEY         ?? ''),
      // Ne JAMAIS baker SERVICE_ROLE_KEY / JWT_SECRET ici : l'installateur est
      // distribué publiquement (GitHub Releases) et ses fichiers sont lisibles.
      // En dev, l'API embarquée les reçoit depuis apps/api/.env (main/index.ts).
      // En prod, la synchro passe par l'API hébergée (pas de secrets requis).
      'process.env.FORGE_API_URL': JSON.stringify(command === 'build' ? (webEnv.VITE_API_URL ?? '') : ''),
    },
    resolve: {
      alias: (() => {
        // pnpm postinstall failures leave packages unlinked in desktop/node_modules.
        // Point Rollup directly to the virtual store so it can bundle them inline.
        const store = resolve(__dirname, '../../node_modules/.pnpm')
        const sup = (pkg: string, ver: string, entry = 'dist/index.cjs') =>
          ({ [`@supabase/${pkg}`]: `${store}/@supabase+${pkg}@${ver}/node_modules/@supabase/${pkg}/${entry}` })
        return {
          '@forge/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
          'ws': `${store}/ws@8.20.1/node_modules/ws/index.js`,
          ...sup('supabase-js',  '2.105.4', 'dist/index.cjs'),
          ...sup('realtime-js',  '2.105.4', 'dist/main/index.js'),
          ...sup('postgrest-js', '2.105.4', 'dist/index.cjs'),
          ...sup('storage-js',   '2.105.4', 'dist/index.cjs'),
          ...sup('functions-js', '2.105.4', 'dist/main/index.js'),
          ...sup('auth-js',      '2.105.4', 'dist/main/index.js'),
        }
      })(),
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // Native addons that must stay external
        // bufferutil / utf-8-validate are optional perf addons for ws — not required
        external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
    },
  },
}))
