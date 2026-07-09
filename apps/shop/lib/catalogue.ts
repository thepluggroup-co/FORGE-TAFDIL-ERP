import { createPublicClient } from './supabase'
import { forgeApiBaseUrl } from './forge-api'
import type { CatalogueResponse, Disponibilite, Produit } from './types'

function disponibilite(stock: number, seuil: number): Disponibilite {
  if (stock <= 0) return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

type PromoActive = {
  campagne_id: string
  campagne_nom: string
  product_id: string
  remise_type: 'pct' | 'forfait'
  remise_valeur: number
  prix_promo_xaf: number | null
  date_fin: string
}

function computePromoPrice(base: number | null | undefined, promo?: PromoActive) {
  const prixBase = Math.round(Number(base ?? 0))
  if (!promo || prixBase <= 0) return null
  const prixForce = Math.round(Number(promo.prix_promo_xaf ?? 0))
  if (prixForce > 0 && prixForce < prixBase) return prixForce
  const remise = promo.remise_type === 'pct'
    ? Math.round(prixBase * Math.min(100, Number(promo.remise_valeur ?? 0)) / 100)
    : Math.round(Number(promo.remise_valeur ?? 0))
  const next = Math.max(0, prixBase - remise)
  return next > 0 && next < prixBase ? next : null
}

async function fetchPromosDirect(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, PromoActive>()
  const today = new Date().toISOString().slice(0, 10)
  const db = createPublicClient()
  const { data, error } = await db
    .from('campagnes_produits')
    .select(`
      campagne_id,
      product_id,
      remise_type,
      remise_valeur,
      prix_promo_xaf,
      priorite,
      campagnes_marketing!inner(nom, statut, date_debut, date_fin)
    `)
    .in('product_id', productIds)
    .eq('campagnes_marketing.statut', 'active')
    .lte('campagnes_marketing.date_debut', today)
    .gte('campagnes_marketing.date_fin', today)
    .order('priorite', { ascending: false })
    .order('created_at', { ascending: false })

  if (error || !data) return new Map<string, PromoActive>()

  const map = new Map<string, PromoActive>()
  for (const row of data as any[]) {
    if (map.has(row.product_id)) continue
    map.set(row.product_id, {
      campagne_id: row.campagne_id,
      campagne_nom: row.campagnes_marketing?.nom ?? 'Promotion',
      product_id: row.product_id,
      remise_type: row.remise_type === 'forfait' ? 'forfait' : 'pct',
      remise_valeur: Number(row.remise_valeur ?? 0),
      prix_promo_xaf: row.prix_promo_xaf === null || row.prix_promo_xaf === undefined ? null : Number(row.prix_promo_xaf),
      date_fin: row.campagnes_marketing?.date_fin ?? today,
    })
  }
  return map
}

function mapProduitShop(row: any, promo?: PromoActive): Produit {
  const p = row.produits
  const promoPrice = computePromoPrice(row.prix_public, promo)
  return {
    id: row.product_id,
    ref: p.ref,
    nom: p.designation,
    description: p.description,
    categorie: p.categorie,
    unite: p.unite,
    stock_actuel: p.stock_actuel,
    seuil_alerte: p.stock_min,
    prix_public: promoPrice ?? row.prix_public,
    prix_barre_xaf: promoPrice ? row.prix_public : null,
    promotion: promoPrice && promo ? {
      campagne_id: promo.campagne_id,
      nom: promo.campagne_nom,
      remise_type: promo.remise_type,
      remise_valeur: promo.remise_valeur,
      prix_original_xaf: row.prix_public,
      prix_promo_xaf: promoPrice,
      date_fin: promo.date_fin,
    } : null,
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
    const promos = await fetchPromosDirect(data.map((row: any) => row.product_id))
    return data.map((row: any) => mapProduitShop(row, promos.get(row.product_id)))
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
    const promos = await fetchPromosDirect([data.product_id])
    return mapProduitShop(data, promos.get(data.product_id))
  } catch {
    return null
  }
}
