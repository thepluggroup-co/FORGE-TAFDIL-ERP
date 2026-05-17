import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Load apps/desktop/.env so Supabase credentials are available at build time
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
    plugins: [externalizeDepsPlugin({ exclude: ['@forge/db', '@forge/shared', 'electron-log', 'electron-updater'] })],
    define: {
      'process.env.SUPABASE_URL':        JSON.stringify(env.SUPABASE_URL      ?? ''),
      'process.env.VITE_SUPABASE_URL':   JSON.stringify(env.SUPABASE_URL      ?? ''),
      'process.env.SUPABASE_ANON_KEY':   JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
    },
    resolve: {
      alias: {
        '@forge/db':     resolve(__dirname, '../../packages/db/src/supabase-client.ts'),
        '@forge/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // better-sqlite3 is a native addon — must stay external
        external: ['better-sqlite3'],
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
