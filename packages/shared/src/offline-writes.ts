// ── Écritures hors ligne : quelles actions peuvent attendre ? ─────────────────
//
// Sans réseau, desktop et mobile gardent certaines actions dans une file
// d'attente et les rejouent à la reconnexion (protégées des doublons par
// l'en-tête Idempotency-Key, cf. apps/api/src/middleware/idempotency.ts).
//
// Règle métier validée :
//  - PEUVENT ATTENDRE : créations, modifications, suppressions, encaissements
//    en espèces. Le serveur revérifie tout à la synchro (droits, stock,
//    statut) ; un refus revient à l'utilisateur dans « Actions en attente ».
//  - EN LIGNE UNIQUEMENT : validations et approbations (on ne valide pas sur
//    des données périmées), paiements mobile money, mots de passe et PIN,
//    comptes et droits, envois, calculs et synchronisations côté serveur.

/** Marqueur renvoyé à la place de la réponse serveur quand l'action est mise en file. */
export const OFFLINE_QUEUED = { offline_queued: true } as const

export function isQueuedOffline(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { offline_queued?: unknown }).offline_queued === true
}

/** Au-delà, une action en attente n'est plus envoyée sans confirmation de l'utilisateur. */
export const OFFLINE_ACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const OFFLINE_ONLY_ONLINE_MESSAGE = 'Cette action nécessite une connexion Internet'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Familles d'API entières réservées au mode en ligne.
const ONLINE_ONLY_PREFIXES = [
  '/api/admin',        // comptes, rôles, droits, réglages de sécurité
  '/api/profile',      // mot de passe, PIN, téléphone (OTP)
  '/api/auth',
  '/api/ai',
  '/api/paiements',    // mobile money : c'est le réseau de l'opérateur qui débite
  '/api/push',
  '/api/shop',         // commande boutique : route publique, sans anti-doublon, avec paiement
  '/api/caisse',       // la Caisse a sa propre file locale (SQLite + op_id)
  '/api/credit/limits',// accorder un plafond de crédit = une approbation
  '/api/credit/cron',
  '/api/bons/appro',   // réception fournisseur : enchaîne plusieurs appels dépendants
]

// Dernier segment du chemin : transitions de statut, validations, envois,
// calculs et traitements de masse — tous dépendent de l'état serveur du moment.
const ONLINE_ONLY_LAST_SEGMENTS = new Set([
  'statut', 'valider', 'executer', 'activer', 'approuver', 'decision-client',
  'qualification', 'signature', 'virer', 'recruter', 'annuler', 'cancel', 'deactivate',
  'reset-password', 'compte', 'pin',
  'envoyer-approbation', 'transformer-commande', 'envoyer-bon', 'envoyer', 'creer-erp',
  'calculate', 'estimer', 'preparer', 'gamme', 'reception',
  'backfill-bons', 'synchroniser-commandes', 'synchroniser-livraisons', 'regulariser-livraison',
  'justificatifs', 'images', 'documents',   // fichiers : non sérialisables dans la file
])

function pathOnly(path: string): string {
  return path.split('?')[0].replace(/\/+$/, '')
}

/** Vrai si cette écriture peut être mise en file quand le serveur est injoignable. */
export function canQueueOffline(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false
  const clean = pathOnly(path)
  if (!clean.startsWith('/api/')) return false
  // Un identifiant manquant dans l'URL (action enchaînée sur un élément créé
  // hors ligne, donc sans id) : ne jamais mettre en file une requête vouée à l'échec.
  if (/\/(undefined|null)(\/|$)/.test(clean)) return false
  if (ONLINE_ONLY_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`))) return false
  const last = clean.split('/').pop() ?? ''
  return !ONLINE_ONLY_LAST_SEGMENTS.has(last)
}

// ── Libellé lisible pour l'écran « Actions en attente » ───────────────────────

const RESOURCE_LABELS: Array<[RegExp, string]> = [
  [/^\/api\/clients/,                 'Client'],
  [/^\/api\/fournisseurs/,            'Fournisseur'],
  [/^\/api\/devis/,                   'Devis'],
  [/^\/api\/commandes/,               'Commande'],
  [/^\/api\/factures\/[^/]+\/versements/, 'Versement sur facture'],
  [/^\/api\/factures/,                'Facture'],
  [/^\/api\/credits\/[^/]+\/rembourser/,  'Remboursement de crédit'],
  [/^\/api\/credit/,                  'Crédit'],
  [/^\/api\/charges/,                 'Charge'],
  [/^\/api\/sorties-tresorerie/,      'Sortie de trésorerie'],
  [/^\/api\/stocks\/[^/]+\/mouvements?/,  'Mouvement de stock'],
  [/^\/api\/stocks/,                  'Produit en stock'],
  [/^\/api\/bons/,                    'Bon de sortie'],
  [/^\/api\/logistique\/livraisons/,  'Livraison'],
  [/^\/api\/production\/jobs\/[^/]+\/consommations/, 'Consommation de matière'],
  [/^\/api\/production\/jobs\/[^/]+\/operations/,    'Étape de fabrication'],
  [/^\/api\/production/,              'Ordre de fabrication'],
  [/^\/api\/projets\/[^/]+\/taches/,  'Tâche de projet'],
  [/^\/api\/projets\/[^/]+\/membres/, 'Membre de projet'],
  [/^\/api\/projets\/[^/]+\/ressources/, 'Ressource de projet'],
  [/^\/api\/projets/,                 'Projet'],
  [/^\/api\/equipements\/[^/]+\/maintenances/, 'Maintenance'],
  [/^\/api\/equipements/,             'Équipement'],
  [/^\/api\/rh\/presences/,           'Pointage'],
  [/^\/api\/rh\/conges/,              'Congé'],
  [/^\/api\/rh\/employes/,            'Employé'],
  [/^\/api\/rh\/avances-salaire/,     'Avance sur salaire'],
  [/^\/api\/rh\/retenues-salaire/,    'Retenue sur salaire'],
  [/^\/api\/rh\/formation/,           'Formation'],
  [/^\/api\/rh\/apprenants/,          'Apprenant'],
  [/^\/api\/rh/,                      'RH'],
  [/^\/api\/securite\/incidents/,     'Incident de sécurité'],
  [/^\/api\/marketing/,               'Campagne marketing'],
  [/^\/api\/catalogue/,               'Catalogue'],
  [/^\/api\/shop-erp\/produits/,      'Produit boutique'],
  [/^\/api\/shop-erp/,                'Boutique'],
]

const VERBS: Record<string, string> = {
  POST: 'Création', PUT: 'Modification', PATCH: 'Modification', DELETE: 'Suppression',
}

export function describeOfflineAction(method: string, path: string): string {
  const clean = pathOnly(path)
  const resource = RESOURCE_LABELS.find(([re]) => re.test(clean))?.[1] ?? clean.replace(/^\/api\//, '')
  // « Versement », « Remboursement », « Pointage »… se lisent mieux sans verbe devant.
  if (method.toUpperCase() === 'POST' && /^(Versement|Remboursement|Pointage|Mouvement|Consommation)/.test(resource)) {
    return resource
  }
  return `${VERBS[method.toUpperCase()] ?? method} — ${resource}`
}
