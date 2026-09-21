import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@forge/ui':     path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@forge/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@forge/ai':     path.resolve(__dirname, '../../packages/ai/src/index.ts'),
      '@forge/db':     path.resolve(__dirname, '../../packages/db/src/index.ts'),
    },
  },
})
