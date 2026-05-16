import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Résolution explicite des packages workspace depuis le contexte apps/web
      // Cela permet à Vite de trouver clsx, framer-motion etc. via apps/web/node_modules
      '@forge/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@forge/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@forge/ai': path.resolve(__dirname, '../../packages/ai/src/index.ts'),
      '@forge/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: [
      'clsx',
      'tailwind-merge',
      'framer-motion',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-toast',
      '@radix-ui/react-popover',
    ],
  },
  server: {
    port: 5173,
    fs: {
      // Autorise Vite à servir des fichiers depuis la racine du monorepo
      allow: ['../..'],
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
