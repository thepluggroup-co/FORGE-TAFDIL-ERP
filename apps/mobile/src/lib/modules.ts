import type { MobileScreen } from '@forge/shared'
import type { IconName } from '../components/ui'

export interface ModuleMeta { screen: MobileScreen; to: string; label: string; hint: string; icon: IconName }

// Modules métier de l'application mobile (ceux du projet). L'ordre est celui du hub « Modules ».
export const MODULES: ModuleMeta[] = [
  { screen: 'orders',      to: '/orders',      label: 'Commandes',   hint: 'Suivi des commandes clients',   icon: 'cart' },
  { screen: 'stocks',      to: '/stocks',      label: 'Stocks',      hint: 'Matériaux et équipements',      icon: 'box' },
  { screen: 'factures',    to: '/factures',    label: 'Factures',    hint: 'Payées, en attente, en retard', icon: 'receipt' },
  { screen: 'performance', to: '/performance', label: 'Analytique',  hint: "Chiffre d'affaires",            icon: 'chart' },
  { screen: 'approbation', to: '/approbation', label: 'Approbation', hint: 'Bons de sortie à valider',      icon: 'check' },
  { screen: 'livraisons',  to: '/livraisons',  label: 'Livraisons',  hint: 'Mes livraisons',                icon: 'truck' },
  { screen: 'caisse',      to: '/caisse',      label: 'Caisse',      hint: 'Ventes et session',             icon: 'wallet' },
]
