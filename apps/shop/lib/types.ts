export type Disponibilite = 'disponible' | 'stock_faible' | 'indisponible'

export interface Produit {
  id: string
  ref: string
  nom: string
  categorie: string
  unite: string
  stock_actuel: number
  seuil_alerte: number
  prix_public: number | null
  description_longue: string | null
  images: string[]
  tags: string[]
  delai_fabrication_jours: number
  min_commande: number
  disponibilite: Disponibilite
}

export interface CatalogueResponse {
  data: Produit[]
  total: number
}

// CartItem is defined in lib/cart.ts (Zustand store)
