// FORGE — Couche DB du calcul de devis (MASTER PROMPT V3 §13/§35)
//
// Ce fichier est la SEULE partie du moteur qui touche la base de données.
// Toute la logique de calcul (formules, arrondis, assemblage) vit dans
// @forge/shared (packages/shared/src/devis-calcul.ts), pure et testée sans
// DB — voir apps/api/src/__tests__/devis-calculation.test.ts.

import { supabaseAdmin } from '@forge/db'
import {
  calculerDevisBrut,
  ModeCalculSchema,
  DimensionsSchema,
  type RessourceTechnique,
  type ResultatDevis,
} from '@forge/shared'
import { z } from 'zod'

const db = supabaseAdmin!

export const devisCalculateSchema = z.object({
  produitId: z.string().uuid(),
  quantite: z.number().positive(),
  dimensions: DimensionsSchema.optional(),
  options: z.record(z.unknown()).optional(),
  // Optionnel : force un mode de calcul différent de celui de la fiche technique active
  // (cas d'un devis manuel sans fiche technique — §46 rétrocompatibilité).
  modeCalcul: ModeCalculSchema.optional(),
})
export type DevisCalculateRequest = z.infer<typeof devisCalculateSchema>

interface FicheTechniqueRow {
  id: string
  produit_id: string
  version: number
  statut: string
  mode_calcul: string
  unite_facturation_id: string | null
}

interface FicheTechniqueRessourceRow {
  id: string
  type: 'materiau' | 'main_oeuvre' | 'equipement'
  designation: string
  unite: string
  quantite_par_unite: number
  cout_unitaire_reference_xaf: number
  temps_reference_h: number | null
  actif: boolean
}

export type ProposerDevisResultat =
  | { ok: true; resultat: ResultatDevis & { ok: true }; ficheTechniqueId: string }
  | { ok: false; erreurs: Array<{ code: string; message: string }> }

/**
 * Charge la fiche technique ACTIVE du produit et ses ressources, puis calcule
 * la proposition de devis brut via le moteur pur.
 *
 * §21 — Cette fonction ne fait QUE proposer un calcul. Elle n'écrit rien.
 * C'est l'appelant (route API) qui décide de figer le résultat dans
 * devis.config_snapshot / devis.ressources_snapshot au moment de la création
 * ou de la validation du devis — jamais avant.
 */
export async function proposerDevis(input: DevisCalculateRequest): Promise<ProposerDevisResultat> {
  const { data: fiche, error: ficheError } = await db
    .from('fiche_technique')
    .select('id, produit_id, version, statut, mode_calcul, unite_facturation_id')
    .eq('produit_id', input.produitId)
    .eq('statut', 'active')
    .maybeSingle()

  if (ficheError) {
    return { ok: false, erreurs: [{ code: 'ERREUR_DB', message: ficheError.message }] }
  }
  if (!fiche) {
    return {
      ok: false,
      erreurs: [{ code: 'FICHE_TECHNIQUE_INTROUVABLE', message: "Aucune fiche technique active pour ce produit. Créez-en une avant de calculer un devis, ou saisissez la ligne manuellement (§46)." }],
    }
  }

  const f = fiche as FicheTechniqueRow
  const modeCalcul = input.modeCalcul ?? ModeCalculSchema.parse(f.mode_calcul)

  const { data: ressourcesData, error: ressourcesError } = await db
    .from('fiche_technique_ressources')
    .select('id, type, designation, unite, quantite_par_unite, cout_unitaire_reference_xaf, temps_reference_h, actif')
    .eq('fiche_technique_id', f.id)
    .eq('actif', true)
    .order('ordre', { ascending: true })

  if (ressourcesError) {
    return { ok: false, erreurs: [{ code: 'ERREUR_DB', message: ressourcesError.message }] }
  }

  const ressources: RessourceTechnique[] = ((ressourcesData ?? []) as FicheTechniqueRessourceRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    designation: r.designation,
    unite: r.unite,
    quantiteParUnite: r.quantite_par_unite,
    coutUnitaireReferenceXaf: r.cout_unitaire_reference_xaf,
    tempsReferenceH: r.temps_reference_h,
  }))

  const resultat = calculerDevisBrut(
    { produitId: input.produitId, modeCalcul, quantite: input.quantite, dimensions: input.dimensions, options: input.options },
    ressources,
  )

  if (!resultat.ok) {
    return { ok: false, erreurs: resultat.erreurs }
  }

  return { ok: true, resultat, ficheTechniqueId: f.id }
}
