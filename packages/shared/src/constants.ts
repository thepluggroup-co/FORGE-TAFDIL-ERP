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
