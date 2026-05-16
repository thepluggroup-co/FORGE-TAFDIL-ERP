import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@forge/db', '@forge/shared'] })],
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
  // Pas de renderer : on charge apps/web depuis localhost (dev) ou file:// (prod)
  renderer: {
    root: '.',
    build: { outDir: 'out/renderer', emptyOutDir: false },
  },
})
