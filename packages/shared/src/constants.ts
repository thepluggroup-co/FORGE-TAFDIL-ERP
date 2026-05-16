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
