export const FRAIS_LIVRAISON = {
  douala:          { tarif: 2000,  delaiJours: 1 },
  douala_banlieue: { tarif: 3500,  delaiJours: 1 },
  yaounde:         { tarif: 8000,  delaiJours: 2 },
  bafoussam:       { tarif: 10000, delaiJours: 3 },
  autre:           { tarif: 15000, delaiJours: 5 },
} as const

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
  ligne1: 'Carrefour Maeti — Zone industrielle',
  ligne2: 'Entrée face à la station Total',
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
