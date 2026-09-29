export const FRAIS_LIVRAISON = {
  douala:          { tarif: 2000,  delaiJours: 1 },
  douala_banlieue: { tarif: 3500,  delaiJours: 1 },
  yaounde:         { tarif: 8000,  delaiJours: 2 },
  bafoussam:       { tarif: 10000, delaiJours: 3 },
  autre:           { tarif: 15000, delaiJours: 5 },
} as const

/**
 * Zones livrées au tarif forfaitaire depuis le site TAFDIL. Hors de ces zones,
 * la livraison est « sur devis » (contact commercial) : aucun frais n'est
 * facturé à la commande web.
 *
 * Source unique pour le checkout (apps/shop) ET pour le recalcul serveur
 * (POST /api/shop/commandes) : le serveur n'accepte jamais les frais envoyés
 * par le navigateur.
 */
const ZONES_LIVRAISON_WEB: Record<string, keyof typeof FRAIS_LIVRAISON> = {
  douala:  'douala',
  yaounde: 'yaounde',
  yaoundé: 'yaounde',
}

/** Frais de livraison web en XAF pour une ville, ou `null` si la zone est « sur devis ». */
export function fraisLivraisonWeb(ville: string | null | undefined): number | null {
  const zone = ZONES_LIVRAISON_WEB[String(ville ?? '').trim().toLowerCase()]
  return zone ? FRAIS_LIVRAISON[zone].tarif : null
}

export const APP_NAME = 'FORGE'
export const COMPANY_NAME = 'TAFDIL'
export const COMPANY_LOCATION = 'Douala, Cameroun'
export const CURRENCY = 'XAF'
export const CURRENCY_SYMBOL = 'FCFA'

/**
 * Adresse physique de la boutique de retrait TAFDIL.
 * Affichée au client lors d'un mode de livraison "retrait_boutique"
 * et utilisée dans les notifications (SMS / email) de confirmation.
 */
export const BOUTIQUE_RETRAIT = {
  nom:    'TAFDIL — Accueil & Showroom',
  ligne1: 'Kotto',
  ligne2: 'derrière école Mauryvanas',
  ville:  'Douala',
  pays:   'Cameroun',
  telephone: '+237 6 95 88 45 28',
  horaires: 'Lun – Ven : 8h00 – 17h30 · Sam : 9h00 – 13h00',
  instructions: 'Présentez votre numéro de commande à l’accueil pour récupérer votre colis.',
} as const

export const API_ROUTES = {
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
  },
  products: '/api/products',
  orders: '/api/orders',
  production: '/api/production',
  inventory: '/api/inventory',
  clients: '/api/clients',
  ai: '/api/ai',
} as const
