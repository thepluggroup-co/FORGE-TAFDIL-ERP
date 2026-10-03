// FORGE — Fabrication d'un OF : chargement de la gamme (Catalogue Hybride Phase 7)
//
// La gamme et les matières de la fiche technique sont COPIÉES dans l'OF
// (of_operations, of_consommations) avec les taux horaires et coûts du moment.
// La fiche utilisée est celle figée au devis (devis.fiche_technique_id), même
// si une nouvelle version est devenue active depuis.
// Le calcul lui-même vit dans @forge/shared/production (pur, testé).

import { supabaseAdmin } from '@forge/db'
import {
  planifierOF, type OperationGammeSource, type RessourceMatiereSource, type ResultatPlanification,
} from '@forge/shared'

const db = supabaseAdmin!

interface GammeRow {
  id: string; numero: number; libelle: string; temps_unitaire_h: number; temps_fixe_h: number
  postes_travail: { id: string; libelle: string; cout_horaire_xaf: number | null } | null
  equipements: { id: string; designation: string; cout_horaire_xaf: number | null } | null
}

interface RessourceRow {
  id: string; type: 'materiau' | 'consommable'; designation: string; unite: string
  ressource_produit_id: string | null; quantite_par_unite: number; cout_unitaire_reference_xaf: number
}

const nombreOuNull = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))

/** Plan de fabrication (étapes + consommations prévues) d'une version de fiche technique. */
export async function chargerPlanFabrication(ficheTechniqueId: string, quantiteFacturable: number): Promise<
  ResultatPlanification | { ok: false; code: 'ERREUR_DB'; message: string }
> {
  const [gamme, ressources] = await Promise.all([
    db.from('gamme_operations')
      .select('id, numero, libelle, temps_unitaire_h, temps_fixe_h, postes_travail(id, libelle, cout_horaire_xaf), equipements(id, designation, cout_horaire_xaf)')
      .eq('fiche_technique_id', ficheTechniqueId)
      .eq('actif', true),
    db.from('fiche_technique_ressources')
      .select('id, type, designation, unite, ressource_produit_id, quantite_par_unite, cout_unitaire_reference_xaf')
      .eq('fiche_technique_id', ficheTechniqueId)
      .eq('actif', true)
      .in('type', ['materiau', 'consommable'])
      .order('ordre', { ascending: true }),
  ])
  if (gamme.error)      return { ok: false, code: 'ERREUR_DB', message: gamme.error.message }
  if (ressources.error) return { ok: false, code: 'ERREUR_DB', message: ressources.error.message }

  const operations: OperationGammeSource[] = ((gamme.data ?? []) as unknown as GammeRow[]).map((o) => ({
    id: o.id, numero: o.numero, libelle: o.libelle,
    tempsUnitaireH: Number(o.temps_unitaire_h), tempsFixeH: Number(o.temps_fixe_h),
    poste: o.postes_travail
      ? { id: o.postes_travail.id, libelle: o.postes_travail.libelle, coutHoraireXaf: nombreOuNull(o.postes_travail.cout_horaire_xaf) }
      : null,
    equipement: o.equipements
      ? { id: o.equipements.id, designation: o.equipements.designation, coutHoraireXaf: nombreOuNull(o.equipements.cout_horaire_xaf) }
      : null,
  }))

  const matieres: RessourceMatiereSource[] = ((ressources.data ?? []) as RessourceRow[]).map((r) => ({
    id: r.id, type: r.type, designation: r.designation, unite: r.unite, produitId: r.ressource_produit_id,
    quantiteParUnite: Number(r.quantite_par_unite), coutUnitaireReferenceXaf: Number(r.cout_unitaire_reference_xaf ?? 0),
  }))

  return planifierOF(quantiteFacturable, operations, matieres)
}

export type ResultatChargementGamme =
  | { ok: true; operations: number; consommations: number }
  | { ok: false; code: 'GAMME_DEJA_CHARGEE' | 'QUANTITE_INVALIDE' | 'GAMME_VIDE' | 'ERREUR_DB'; message: string }

/** Copie la gamme d'une fiche technique dans un OF. Refuse si l'OF a déjà ses étapes. */
export async function chargerGammeDansOF(
  jobId: string,
  ficheTechniqueId: string,
  quantiteFacturable: number,
): Promise<ResultatChargementGamme> {
  const { count, error: errCount } = await db
    .from('of_operations').select('id', { count: 'exact', head: true }).eq('job_id', jobId)
  if (errCount) return { ok: false, code: 'ERREUR_DB', message: errCount.message }
  if ((count ?? 0) > 0) return { ok: false, code: 'GAMME_DEJA_CHARGEE', message: 'Les étapes de cet OF sont déjà chargées.' }

  const plan = await chargerPlanFabrication(ficheTechniqueId, quantiteFacturable)
  if (!plan.ok) return plan

  if (plan.operations.length > 0) {
    const { error } = await db.from('of_operations').insert(plan.operations.map((o) => ({
      job_id:                      jobId,
      gamme_operation_id:          o.gammeOperationId,
      numero:                      o.numero,
      libelle:                     o.libelle,
      poste_id:                    o.posteId,
      poste_libelle:               o.posteLibelle,
      equipement_id:               o.equipementId,
      equipement_designation:      o.equipementDesignation,
      temps_prevu_h:               o.tempsPrevuH,
      cout_horaire_poste_xaf:      o.coutHorairePosteXaf,
      cout_horaire_equipement_xaf: o.coutHoraireEquipementXaf,
    })))
    // 23505 : un chargement concurrent a inséré les étapes juste avant (UNIQUE job_id, numero)
    if (error?.code === '23505') return { ok: false, code: 'GAMME_DEJA_CHARGEE', message: 'Les étapes de cet OF sont déjà chargées.' }
    if (error) return { ok: false, code: 'ERREUR_DB', message: error.message }
  }

  if (plan.consommations.length > 0) {
    const { error } = await db.from('of_consommations').insert(plan.consommations.map((r) => ({
      job_id:                      jobId,
      ressource_id:                r.ressourceId,
      type:                        r.type,
      produit_id:                  r.produitId,
      designation:                 r.designation,
      unite:                       r.unite,
      quantite_prevue:             r.quantitePrevue,
      cout_unitaire_reference_xaf: r.coutUnitaireReferenceXaf,
    })))
    if (error) {
      // Pas de gamme à moitié chargée : sans ses matières, les étapes sont retirées
      // pour que le chargement puisse être relancé (sinon GAMME_DEJA_CHARGEE à vie).
      const { error: errRetrait } = await db.from('of_operations').delete().eq('job_id', jobId)
      if (errRetrait) console.error(`[production] OF ${jobId} : étapes orphelines non retirées :`, errRetrait.message)
      return { ok: false, code: 'ERREUR_DB', message: error.message }
    }
  }

  const { error: errJob } = await db.from('jobs_production').update({
    fiche_technique_id:  ficheTechniqueId,
    quantite_facturable: quantiteFacturable,
    gamme_chargee_le:    new Date().toISOString(),
  }).eq('id', jobId)
  if (errJob) console.error('[production] OF → fiche technique :', errJob.message)

  return { ok: true, operations: plan.operations.length, consommations: plan.consommations.length }
}

/**
 * Fiche technique et quantité facturable figées au devis d'une commande, ou
 * null si le devis n'en porte pas (devis manuel, ancien devis).
 */
export async function ficheDepuisCommande(commandeId: string): Promise<{ ficheTechniqueId: string; quantiteFacturable: number } | null> {
  const { data: cmd } = await db.from('commandes').select('devis_id').eq('id', commandeId).maybeSingle()
  const devisId = (cmd as { devis_id?: string | null } | null)?.devis_id
  if (!devisId) return null

  const { data: devis } = await db
    .from('devis').select('fiche_technique_id, ressources_snapshot').eq('id', devisId).maybeSingle()
  const d = devis as { fiche_technique_id?: string | null; ressources_snapshot?: { quantiteFacturable?: number } | null } | null
  if (!d?.fiche_technique_id) return null

  const { data: lignes } = await db
    .from('devis_lignes').select('quantite_calculee').eq('devis_id', devisId).order('ordre', { ascending: true })
  const deLigne = ((lignes ?? []) as Array<{ quantite_calculee: number | null }>)
    .map((l) => Number(l.quantite_calculee)).find((q) => Number.isFinite(q) && q > 0)
  const quantiteFacturable = deLigne ?? Number(d.ressources_snapshot?.quantiteFacturable)
  if (!Number.isFinite(quantiteFacturable) || quantiteFacturable <= 0) return null

  return { ficheTechniqueId: d.fiche_technique_id, quantiteFacturable }
}
