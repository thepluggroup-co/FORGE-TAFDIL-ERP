import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@forge/db', '@forge/shared', 'electron-log', 'electron-updater'] })],
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
