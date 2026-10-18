// Fichiers de apps/web/public. Dans l'app desktop la page est servie en
// file:// : un chemin absolu « /x.png » y désigne la racine du disque, pas le
// dossier de l'app — d'où le chemin relatif à index.html (le routeur Electron
// est un MemoryRouter, l'URL du document ne change jamais).
const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:'

export function publicAsset(name: string): string {
  return `${isFileProtocol ? './' : '/'}${name}`
}
