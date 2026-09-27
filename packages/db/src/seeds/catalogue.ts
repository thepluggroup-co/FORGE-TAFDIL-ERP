/**
 * FORGE ERP — Seed Catalogue Produits Finis
 * Insère les 12 familles racines (largeur de gamme) avec leur type_gamme.
 * Ne crée aucune sous-famille ni aucun modèle — cela se fait manuellement
 * via l'interface (apps/web/src/pages/Catalogue.tsx) une fois construite.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type TypeGamme = 'catalogue' | 'sur_mesure' | 'configuration'

export const SEED_FAMILLES: Array<{ nom: string; typeGamme: TypeGamme; ordre: number }> = [
  { nom: 'Charpente / Hangar métallique',    typeGamme: 'configuration', ordre: 1 },
  { nom: 'Tuyauterie industrielle',          typeGamme: 'sur_mesure',    ordre: 2 },
  { nom: 'Citerne / Bac de stockage',        typeGamme: 'catalogue',     ordre: 3 },
  { nom: 'Panneau publicitaire / Kiosque',   typeGamme: 'configuration', ordre: 4 },
  { nom: 'Portail / Grilles / Ferronnerie',  typeGamme: 'configuration', ordre: 5 },
  { nom: 'Carrosserie plateau camion',       typeGamme: 'sur_mesure',    ordre: 6 },
  { nom: 'Auvent / Couverture métallique',   typeGamme: 'configuration', ordre: 7 },
  { nom: 'Menuiserie métallique',            typeGamme: 'configuration', ordre: 8 },
  { nom: 'Mécanosoudure / Tôlerie',          typeGamme: 'sur_mesure',    ordre: 9 },
  { nom: 'Aménagement / Bâtiment',           typeGamme: 'sur_mesure',    ordre: 10 },
  { nom: 'Fournitures industrielles',        typeGamme: 'catalogue',     ordre: 11 },
  { nom: 'Produit du catalogue',             typeGamme: 'catalogue',     ordre: 12 },
]

export async function runCatalogueSeed(db: SupabaseClient): Promise<void> {
  console.info('[seed:catalogue] Démarrage du seed catalogue produits finis…')

  const { data: existing, error: existingErr } = await db
    .from('familles')
    .select('nom')
    .is('parent_id', null)

  if (existingErr) throw new Error(`Erreur lecture familles existantes: ${existingErr.message}`)

  const existingNames = new Set((existing ?? []).map((f: { nom: string }) => f.nom))
  const toInsert = SEED_FAMILLES
    .filter((f) => !existingNames.has(f.nom))
    .map((f) => ({ nom: f.nom, type_gamme: f.typeGamme, ordre: f.ordre, parent_id: null }))

  if (toInsert.length === 0) {
    console.info('[seed:catalogue] 12 familles racines déjà présentes — rien à faire')
    return
  }

  const { error: insertErr } = await db.from('familles').insert(toInsert)
  if (insertErr) throw new Error(`Erreur seed familles: ${insertErr.message}`)

  console.info(`[seed:catalogue] ${toInsert.length} famille(s) racine(s) créée(s)`)
}
