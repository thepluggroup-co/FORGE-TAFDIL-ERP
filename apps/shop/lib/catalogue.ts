import { createPublicClient } from './supabase'
import { forgeApiBaseUrl } from './forge-api'
import type { CatalogueResponse, Disponibilite, Produit } from './types'

function disponibilite(stock: number, seuil: number): Disponibilite {
  if (stock <= 0) return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

function mapProduitShop(row: any): Produit {
  const p = row.produits
  return {
    id: row.product_id,
    ref: p.ref,
    nom: p.designation,
    description: p.description,
    categorie: p.categorie,
    unite: p.unite,
    stock_actuel: p.stock_actuel,
    seuil_alerte: p.stock_min,
    prix_public: row.prix_public,
    description_longue: row.description_longue,
    images: row.images ?? [],
    tags: row.tags ?? [],
    delai_fabrication_jours: row.delai_fabrication_jours,
    min_commande: row.min_commande,
    disponibilite: disponibilite(p.stock_actuel, p.stock_min),
  } as Produit
}

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${forgeApiBaseUrl()}${path}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

export async function fetchCatalogueProduits(params?: { categorie?: string; q?: string }): Promise<Produit[]> {
  const qs = new URLSearchParams()
  if (params?.categorie) qs.set('categorie', params.categorie)
  if (params?.q) qs.set('q', params.q)

  const fromApi = await fetchApi<CatalogueResponse>(`/api/shop/catalogue${qs.size ? `?${qs}` : ''}`)
  if (fromApi?.data) return fromApi.data

  try {
    const db = createPublicClient()
    let query = db
      .from('produits_shop')
      .select(`
        product_id,
        prix_public,
        description_longue,
        images,
        tags,
        delai_fabrication_jours,
        min_commande,
        produits!inner (
          ref, designation, description, categorie, stock_actuel, stock_min, unite, statut
        )
      `)
      .eq('visible_shop', true)
      .order('updated_at', { ascending: false })

    if (params?.categorie) query = query.eq('produits.categorie', params.categorie)
    if (params?.q) query = query.ilike('produits.designation', `%${params.q}%`)

    const { data, error } = await query
    if (error || !data) return []
    return data.map(mapProduitShop)
  } catch {
    return []
  }
}

export async function fetchCatalogueProduit(id: string): Promise<Produit | null> {
  const fromApi = await fetchApi<{ data: Produit }>(`/api/shop/catalogue/${id}`)
  if (fromApi?.data) return fromApi.data

  try {
    const db = createPublicClient()
    const { data, error } = await db
      .from('produits_shop')
      .select(`
        product_id,
        prix_public,
        description_longue,
        images,
        tags,
        delai_fabrication_jours,
        min_commande,
        produits!inner (
          ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut, fournisseur
        )
      `)
      .eq('product_id', id)
      .eq('visible_shop', true)
      .single()

    if (error || !data) return null
    return mapProduitShop(data)
  } catch {
    return null
  }
}
