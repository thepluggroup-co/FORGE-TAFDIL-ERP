import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@forge/db/supabase': path.resolve(__dirname, '../../packages/db/src/supabase-client.ts'),
      '@forge/db':          path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@forge/ai':          path.resolve(__dirname, '../../packages/ai/src/index.ts'),
      '@forge/shared':      path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
