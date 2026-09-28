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
  type TypeRessource,
  ressourcesDepuisGamme,
  type OperationGamme,
  type TauxHoraireManquant,
  type ModeCalcul,
  type ResultatDevis,
} from '@forge/shared'
import { z } from 'zod'

const db = supabaseAdmin!

export const devisCalculateSchema = z.object({
  modeleId: z.string().uuid(),
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
  modele_id: string
  version: number
  statut: string
  mode_calcul: string
  unite_facturation_id: string | null
}

interface FicheTechniqueRessourceRow {
  id: string
  type: TypeRessource
  designation: string
  unite: string
  quantite_par_unite: number
  cout_unitaire_reference_xaf: number
  temps_reference_h: number | null
  delai_jours?: number | null
  actif: boolean
}

export type ProposerDevisResultat =
  | { ok: true; resultat: ResultatDevis & { ok: true }; ficheTechniqueId: string }
  | { ok: false; erreurs: Array<{ code: string; message: string }> }

/**
 * Charge la fiche technique ACTIVE du modèle et ses ressources, puis calcule
 * la proposition de devis brut via le moteur pur.
 *
 * §21 — Cette fonction ne fait QUE proposer un calcul. Elle n'écrit rien.
 * C'est l'appelant (route API) qui décide de figer le résultat dans
 * devis.config_snapshot / devis.ressources_snapshot au moment de la création
 * ou de la validation du devis — jamais avant.
 */
export type ChargementFicheTechnique =
  | { ok: true; ficheTechniqueId: string; modeCalcul: ModeCalcul; ressources: RessourceTechnique[] }
  | { ok: false; code: 'ERREUR_DB' | 'FICHE_TECHNIQUE_INTROUVABLE' | 'TAUX_HORAIRE_MANQUANT'; message: string }

/**
 * Fiche technique ACTIVE d'un modèle et ses ressources actives, dans l'ordre.
 * Partagé par le calcul de devis (§13) et le configurateur (Catalogue Hybride Phase 3).
 */
export async function chargerFicheTechniqueActive(modeleId: string): Promise<ChargementFicheTechnique> {
  const { data: fiche, error: ficheError } = await db
    .from('fiche_technique')
    .select('id, modele_id, version, statut, mode_calcul, unite_facturation_id')
    .eq('modele_id', modeleId)
    .eq('statut', 'active')
    .maybeSingle()

  if (ficheError) return { ok: false, code: 'ERREUR_DB', message: ficheError.message }
  if (!fiche) {
    return {
      ok: false,
      code: 'FICHE_TECHNIQUE_INTROUVABLE',
      message: "Aucune fiche technique active pour ce modèle. Créez-en une avant de calculer un devis, ou saisissez la ligne manuellement (§46).",
    }
  }

  const f = fiche as FicheTechniqueRow

  const { data: ressourcesData, error: ressourcesError } = await db
    .from('fiche_technique_ressources')
    .select('id, type, designation, unite, quantite_par_unite, cout_unitaire_reference_xaf, temps_reference_h, delai_jours, actif')
    .eq('fiche_technique_id', f.id)
    .eq('actif', true)
    .order('ordre', { ascending: true })

  if (ressourcesError) return { ok: false, code: 'ERREUR_DB', message: ressourcesError.message }

  const ressources: RessourceTechnique[] = ((ressourcesData ?? []) as FicheTechniqueRessourceRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    designation: r.designation,
    unite: r.unite,
    quantiteParUnite: r.quantite_par_unite,
    coutUnitaireReferenceXaf: r.cout_unitaire_reference_xaf,
    tempsReferenceH: r.temps_reference_h,
    delaiJours: r.delai_jours ?? null,
  }))

  // Phase 5 — gamme opératoire : main-d'œuvre et machines chiffrées aux taux horaires
  const gamme = await chargerGammeOperations(f.id)
  if (!gamme.ok) return gamme
  if (gamme.tauxManquants.length > 0) {
    return {
      ok: false,
      code: 'TAUX_HORAIRE_MANQUANT',
      message: `Coût horaire manquant : ${gamme.tauxManquants.map((t) => `op ${t.operation} (${t.ressource})`).join(', ')}. `
        + 'Renseignez-le (postes de travail / équipements) : aucun prix n\'est calculé avec un taux inconnu.',
    }
  }

  return { ok: true, ficheTechniqueId: f.id, modeCalcul: ModeCalculSchema.parse(f.mode_calcul), ressources: [...ressources, ...gamme.ressources] }
}

interface GammeOperationRow {
  id: string; numero: number; libelle: string; temps_unitaire_h: number; temps_fixe_h: number
  postes_travail: { code: string; libelle: string; cout_horaire_xaf: number | null } | null
  equipements: { code: string; designation: string; cout_horaire_xaf: number | null } | null
}

/** Codes PostgREST / Postgres d'une table absente (migration Phase 5 pas encore appliquée). */
const TABLE_ABSENTE = new Set(['42P01', 'PGRST205'])

async function chargerGammeOperations(ficheTechniqueId: string): Promise<
  | { ok: true; ressources: RessourceTechnique[]; tauxManquants: TauxHoraireManquant[] }
  | { ok: false; code: 'ERREUR_DB'; message: string }
> {
  const { data, error } = await db
    .from('gamme_operations')
    .select('id, numero, libelle, temps_unitaire_h, temps_fixe_h, postes_travail(code, libelle, cout_horaire_xaf), equipements(code, designation, cout_horaire_xaf)')
    .eq('fiche_technique_id', ficheTechniqueId)
    .eq('actif', true)

  if (error) {
    // Avant la migration 20261007 : pas de gamme, le calcul reste celui des ressources seules.
    if (TABLE_ABSENTE.has(String((error as { code?: string }).code))) return { ok: true, ressources: [], tauxManquants: [] }
    return { ok: false, code: 'ERREUR_DB', message: error.message }
  }

  const operations: OperationGamme[] = ((Array.isArray(data) ? data : []) as unknown as GammeOperationRow[]).map((o) => ({
    id: o.id,
    numero: o.numero,
    libelle: o.libelle,
    tempsUnitaireH: Number(o.temps_unitaire_h),
    tempsFixeH: Number(o.temps_fixe_h),
    poste: o.postes_travail
      ? { code: o.postes_travail.code, libelle: o.postes_travail.libelle, coutHoraireXaf: o.postes_travail.cout_horaire_xaf === null ? null : Number(o.postes_travail.cout_horaire_xaf) }
      : null,
    equipement: o.equipements
      ? { code: o.equipements.code, designation: o.equipements.designation, coutHoraireXaf: o.equipements.cout_horaire_xaf === null ? null : Number(o.equipements.cout_horaire_xaf) }
      : null,
  }))

  return { ok: true, ...ressourcesDepuisGamme(operations) }
}

export async function proposerDevis(input: DevisCalculateRequest): Promise<ProposerDevisResultat> {
  const fiche = await chargerFicheTechniqueActive(input.modeleId)
  if (!fiche.ok) return { ok: false, erreurs: [{ code: fiche.code, message: fiche.message }] }

  const { ressources } = fiche
  const modeCalcul = input.modeCalcul ?? fiche.modeCalcul

  const resultat = calculerDevisBrut(
    { modeleId: input.modeleId, modeCalcul, quantite: input.quantite, dimensions: input.dimensions, options: input.options },
    ressources,
  )

  if (!resultat.ok) {
    return { ok: false, erreurs: resultat.erreurs }
  }

  return { ok: true, resultat, ficheTechniqueId: fiche.ficheTechniqueId }
}
