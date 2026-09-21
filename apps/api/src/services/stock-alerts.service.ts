import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

interface ProduitSnapshot {
  id: string
  designation: string
  unite: string
  stock_actuel: number
  stock_min: number
  statut: string
  fournisseur: string | null
}

async function genererNumeroAppro(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('bons_approvisionnement')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `APPRO-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

/**
 * Après l'exécution d'un bon de sortie, inspecte les produits concernés.
 * Si certains passent sous stock_min et ne sont pas déjà couverts par un
 * bon d'approvisionnement ouvert, crée un brouillon groupé et diffuse
 * une alerte Realtime à destination de l'admin.
 */
export async function creerBonApprovisionnementSiNecessaire(
  bonSortieId: string,
  produitIds: string[],
  userId: string,
): Promise<{ created: boolean; bon_id?: string; nb_produits?: number }> {
  if (produitIds.length === 0) return { created: false }

  // ── 1. Produits effectivement sous seuil après la sortie ──────────────────
  const { data: produits, error: fetchErr } = await db
    .from('produits')
    .select('id, designation, unite, stock_actuel, stock_min, statut, fournisseur')
    .in('id', produitIds)
    .in('statut', ['alerte', 'critique', 'rupture'])

  if (fetchErr) {
    console.error('[stock-alerts] fetch produits:', fetchErr.message)
    return { created: false }
  }
  if (!produits || produits.length === 0) return { created: false }

  // ── 2. Déduplication : produits déjà dans un bon ouvert ───────────────────
  const alreadyCovered = new Set<string>()

  const { data: openBons } = await db
    .from('bons_approvisionnement')
    .select('id')
    .in('statut', ['brouillon', 'valide', 'commande'])

  if (openBons && openBons.length > 0) {
    const openIds = (openBons as Array<{ id: string }>).map(b => b.id)
    const { data: coveredLignes } = await db
      .from('bons_approvisionnement_lignes')
      .select('produit_id')
      .in('bon_id', openIds)
      .in('produit_id', (produits as ProduitSnapshot[]).map(p => p.id))

    for (const l of (coveredLignes ?? []) as Array<{ produit_id: string }>) {
      alreadyCovered.add(l.produit_id)
    }
  }

  const toOrder = (produits as ProduitSnapshot[]).filter(p => !alreadyCovered.has(p.id))
  if (toOrder.length === 0) {
    console.info('[stock-alerts] tous les produits sous seuil sont déjà couverts par un appro ouvert')
    return { created: false }
  }

  // ── 3. Créer le bon d'approvisionnement brouillon ─────────────────────────
  const numero = await genererNumeroAppro()

  const { data: bon, error: bonErr } = await db
    .from('bons_approvisionnement')
    .insert({
      numero,
      statut:        'brouillon',
      bon_sortie_id: bonSortieId,
      notes:         'Généré automatiquement — stock sous seuil après exécution du bon de sortie',
      created_by:    userId,
      sync_status:   'synced',
    })
    .select()
    .single()

  if (bonErr || !bon) {
    console.error('[stock-alerts] création bon appro:', bonErr?.message)
    return { created: false }
  }

  const bonId = (bon as { id: string }).id

  const lignes = toOrder.map(p => ({
    bon_id:               bonId,
    produit_id:           p.id,
    designation:          p.designation,
    unite:                p.unite,
    // Quantité minimale pour revenir au stock_min, minimum 1 unité
    quantite_a_commander: Math.max(1, Math.ceil(p.stock_min - p.stock_actuel)),
    stock_actuel_snap:    p.stock_actuel,
    stock_min_snap:       p.stock_min,
    statut_alerte:        p.statut,
    fournisseur:          p.fournisseur ?? null,
  }))

  const { error: lignesErr } = await db.from('bons_approvisionnement_lignes').insert(lignes)
  if (lignesErr) {
    // Rollback du bon pour éviter un enregistrement orphelin
    await db.from('bons_approvisionnement').delete().eq('id', bonId)
    console.error('[stock-alerts] insertion lignes appro:', lignesErr.message)
    return { created: false }
  }

  // ── 4. Broadcast Realtime → dashboard admin ───────────────────────────────
  try {
    const channel = db.channel('forge-stock')
    await channel.send({
      type:  'broadcast',
      event: 'alerte_appro',
      payload: {
        bon_appro_id:    bonId,
        numero,
        nb_produits:     toOrder.length,
        produits_alertes: toOrder.map(p => ({
          id:           p.id,
          designation:  p.designation,
          statut:       p.statut,
          stock_actuel: p.stock_actuel,
          stock_min:    p.stock_min,
        })),
        bon_sortie_id: bonSortieId,
      },
    })
    db.removeChannel(channel)
  } catch {
    // Realtime non critique — ne pas bloquer
  }

  console.info(`[stock-alerts] bon appro ${numero} créé — ${toOrder.length} produit(s) sous seuil`)
  return { created: true, bon_id: bonId, nb_produits: toOrder.length }
}
