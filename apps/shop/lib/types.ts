export type Disponibilite = 'disponible' | 'stock_faible' | 'indisponible'

export interface Produit {
  id: string
  ref: string
  nom: string
  description?: string | null
  categorie: string
  unite: string
  stock_actuel: number
  seuil_alerte: number
  prix_public: number | null
  prix_barre_xaf?: number | null
  promotion?: {
    campagne_id: string
    nom: string
    remise_type: 'pct' | 'forfait'
    remise_valeur: number
    prix_original_xaf: number
    prix_promo_xaf: number
    date_fin: string
  } | null
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
