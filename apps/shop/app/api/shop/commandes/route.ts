import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { z } from 'zod'

const TVA_RATE = 0.1925

const TARIFS_LIVRAISON: Record<string, { tarif: number; delaiJours: number }> = {
  'douala':          { tarif: 2000,  delaiJours: 1 },
  'douala_banlieue': { tarif: 3500,  delaiJours: 1 },
  'yaounde':         { tarif: 8000,  delaiJours: 2 },
  'bafoussam':       { tarif: 10000, delaiJours: 3 },
  'autre':           { tarif: 15000, delaiJours: 5 },
}

function genRef(): string {
  const year = new Date().getFullYear()
  const seq  = String(Math.floor(Math.random() * 9000) + 1000)
  return `WEB-${year}-${seq}`
}

const ligneSchema = z.object({
  product_id:    z.string().uuid(),
  designation:   z.string().min(1),
  quantite:      z.number().positive(),
  prix_unitaire: z.number().min(0),
})

const commandeSchema = z.object({
  client_nom:       z.string().min(2).max(200),
  client_telephone: z.string().min(8).max(20),
  client_email:     z.string().email().optional(),
  client_adresse:   z.string().min(5),
  client_ville:     z.string().optional(),
  lignes:           z.array(ligneSchema).min(1),
  mode_paiement:    z.enum(['mtn_momo', 'orange_money', 'livraison']),
  notes_client:     z.string().max(500).optional(),
  frais_livraison:  z.number().min(0).default(0),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = commandeSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const data_in = parsed.data
    const db = createServiceClient()

    // Vérifier stock pour chaque ligne
    for (const ligne of data_in.lignes) {
      const { data: produit } = await db
        .from('produits')
        .select('id, designation, stock_actuel, unite')
        .eq('id', ligne.product_id)
        .single()

      if (!produit) {
        return NextResponse.json({ error: `Produit introuvable : ${ligne.product_id}`, code: 'PRODUCT_NOT_FOUND' }, { status: 404 })
      }
      if ((produit as any).stock_actuel < ligne.quantite) {
        return NextResponse.json({
          error: 'Stock insuffisant', code: 'STOCK_INSUFFISANT',
          details: { product_id: ligne.product_id, designation: (produit as any).designation, stock_actuel: (produit as any).stock_actuel, demande: ligne.quantite },
        }, { status: 409 })
      }
    }

    const montant_ht  = data_in.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0) + data_in.frais_livraison
    const tva         = Math.round(montant_ht * TVA_RATE)
    const montant_ttc = Math.round(montant_ht + tva)
    const ref         = genRef()

    const lignesJson = data_in.lignes.map((l) => ({
      product_id:    l.product_id,
      designation:   l.designation,
      quantite:      l.quantite,
      prix_unitaire: l.prix_unitaire,
      total_ht:      Math.round(l.quantite * l.prix_unitaire),
    }))

    const { data: commande, error } = await db
      .from('commandes_shop')
      .insert({
        ref,
        client_nom:       data_in.client_nom,
        client_telephone: data_in.client_telephone,
        client_email:     data_in.client_email ?? null,
        client_adresse:   data_in.client_adresse,
        client_ville:     data_in.client_ville ?? null,
        lignes:           lignesJson,
        montant_ht,
        tva,
        montant_ttc,
        frais_livraison:  data_in.frais_livraison,
        mode_paiement:    data_in.mode_paiement,
        notes_client:     data_in.notes_client ?? null,
        statut_commande:  'recue',
        statut_paiement:  'en_attente',
      })
      .select('id, ref')
      .single()

    if (error || !commande) {
      console.error('[shop/commandes] insert:', error)
      return NextResponse.json({ error: 'Erreur création commande', code: 'DB_ERROR' }, { status: 500 })
    }

    // Créer commande ERP en miroir
    const today = new Date().toISOString().split('T')[0]
    const { data: erpCommande } = await db
      .from('commandes')
      .insert({
        numero:          ref,
        client_nom:      data_in.client_nom,
        statut:          'confirmed',
        date_commande:   today,
        total_ht_xaf:    montant_ht,
        tva_xaf:         tva,
        total_ttc_xaf:   montant_ttc,
        notes:           `[SOURCE WEB] ${data_in.notes_client ?? ''}`.trim(),
      })
      .select('id')
      .single()

    if (erpCommande?.id) {
      await db.from('commandes_shop').update({ erp_commande_id: erpCommande.id }).eq('id', commande.id)
      await db.from('commandes_lignes').insert(
        data_in.lignes.map((l, i) => ({
          commande_id:          erpCommande.id,
          produit_id:           l.product_id,
          designation:          l.designation,
          quantite:             l.quantite,
          prix_unitaire_ht_xaf: l.prix_unitaire,
          total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire),
          ordre:                i,
        }))
      )
    }

    return NextResponse.json({ ref, montant_ttc, statut: 'recue' }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
