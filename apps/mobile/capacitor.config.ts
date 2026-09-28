import type { CapacitorConfig } from '@capacitor/cli'

// Live-reload dev : CAP_DEV_SERVER_URL pointe la WebView vers le serveur Vite
// au lieu des fichiers embarqués dans dist/. N'est JAMAIS actif sans cette
// variable — un build normal (npm run build && cap sync) reste inchangé.
const devServerUrl = process.env.CAP_DEV_SERVER_URL

const config: CapacitorConfig = {
  appId: 'com.tafdil.forge',
  appName: 'FORGE',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
}

export default config
