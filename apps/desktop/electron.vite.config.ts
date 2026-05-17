import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

function loadEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf-8')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => l.split('=').map(s => s.trim()) as [string, string])
        .filter(([k]) => k)
    )
  } catch { return {} }
}
const env = loadEnvFile(resolve(__dirname, '.env'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: [
        'electron-log',
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
      'process.env.SUPABASE_URL':           JSON.stringify(env.SUPABASE_URL      ?? ''),
      'process.env.VITE_SUPABASE_URL':      JSON.stringify(env.SUPABASE_URL      ?? ''),
      'process.env.SUPABASE_ANON_KEY':      JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
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
})
