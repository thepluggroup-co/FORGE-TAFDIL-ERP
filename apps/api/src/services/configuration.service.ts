// FORGE — Couche DB du configurateur (Catalogue Hybride Phase 3)
//
// Charge le schéma de configuration d'un modèle, sa fiche technique active et
// la règle de marge applicable, puis délègue validation et estimation aux
// fonctions pures de @forge/shared (configuration.ts). N'écrit rien.

import { supabaseAdmin } from '@forge/db'
import {
  validerConfiguration, estimerConfiguration, resoudreTauxMarge, resoudreModeCommercial,
  type CommercialMode, type ParametreConfiguration, type RegleMarge, type ResultatEstimation,
  type ResultatValidation, type TypeGamme, type UniteLongueur, type RoleCalcul, type TypeParametre,
  type CategorieCout, type RegleFraisIndirects, selectionnerFraisIndirects,
} from '@forge/shared'
import { chargerFicheTechniqueActive } from './devis-calculation.service'

const db = supabaseAdmin!

export interface ModeleConfigurable {
  id: string
  reference: string
  designation: string
  description: string | null
  unite_facturation: string | null
  actif: boolean
  famille_id: string
  commercialMode: CommercialMode | null
}

interface ParametreRow {
  id: string; code: string; libelle: string; type: TypeParametre; obligatoire: boolean
  unite: UniteLongueur | null; min: number | null; max: number | null; pas: number | null
  role_calcul: RoleCalcul | null; cout_si_oui_xaf: number | null; ordre: number; actif: boolean
  categorie_cout: CategorieCout | null; cout_par_commande: boolean | null
  modele_parametre_valeurs: Array<{
    code: string; libelle: string; cout_supplementaire_xaf: number | null
    validation_requise: boolean; ordre: number; actif: boolean
    categorie_cout: CategorieCout | null; cout_par_commande: boolean | null
  }> | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function chargerModele(modeleId: string): Promise<ModeleConfigurable | null> {
  const { data } = await db
    .from('modeles')
    .select('id, reference, designation, description, unite_facturation, type_gamme, actif, famille_id, familles(type_gamme)')
    .eq('id', modeleId)
    .maybeSingle()
  if (!data) return null
  const m = data as unknown as Omit<ModeleConfigurable, 'commercialMode'> & {
    type_gamme: TypeGamme | null; familles: { type_gamme: TypeGamme } | null
  }
  return {
    id: m.id, reference: m.reference, designation: m.designation, description: m.description,
    unite_facturation: m.unite_facturation, actif: m.actif, famille_id: m.famille_id,
    commercialMode: resoudreModeCommercial(m, m.familles),
  }
}

/** Paramètres ACTIFS du modèle, dans l'ordre, au format du moteur pur (coûts inclus). */
export async function chargerParametres(modeleId: string): Promise<ParametreConfiguration[]> {
  const { data, error } = await db
    .from('modele_parametres')
    .select('id, code, libelle, type, obligatoire, unite, min, max, pas, role_calcul, cout_si_oui_xaf, categorie_cout, cout_par_commande, ordre, actif, modele_parametre_valeurs(code, libelle, cout_supplementaire_xaf, validation_requise, categorie_cout, cout_par_commande, ordre, actif)')
    .eq('modele_id', modeleId)
    .eq('actif', true)
    .order('ordre', { ascending: true })

  if (error || !Array.isArray(data)) return []

  return (data as unknown as ParametreRow[]).map((p) => ({
    code: p.code,
    libelle: p.libelle,
    type: p.type,
    obligatoire: p.obligatoire,
    unite: p.unite,
    min: num(p.min),
    max: num(p.max),
    pas: num(p.pas),
    roleCalcul: p.role_calcul,
    coutSiOuiXaf: num(p.cout_si_oui_xaf) ?? 0,
    categorieCout: p.categorie_cout ?? 'option',
    coutParCommande: p.cout_par_commande ?? false,
    valeurs: (p.modele_parametre_valeurs ?? [])
      .filter((v) => v.actif)
      .sort((a, b) => a.ordre - b.ordre)
      .map((v) => ({
        code: v.code,
        libelle: v.libelle,
        coutSupplementaireXaf: num(v.cout_supplementaire_xaf) ?? 0,
        validationRequise: v.validation_requise,
        categorieCout: v.categorie_cout ?? 'option',
        coutParCommande: v.cout_par_commande ?? false,
      })),
  }))
}

/** Vue CLIENT du schéma : aucun coût d'option exposé (§27). */
export function schemaPublic(parametres: ParametreConfiguration[]) {
  return parametres.map((p) => ({
    code: p.code,
    libelle: p.libelle,
    type: p.type,
    obligatoire: p.obligatoire,
    unite: p.unite ?? null,
    min: p.min ?? null,
    max: p.max ?? null,
    pas: p.pas ?? null,
    valeurs: p.type === 'choix'
      ? (p.valeurs ?? []).map((v) => ({ code: v.code, libelle: v.libelle, validation_requise: v.validationRequise }))
      : undefined,
  }))
}

/** Famille du modèle puis ses ascendantes, de la plus proche à la racine (sans boucle). */
export async function chargerFamillesAscendantes(familleId: string): Promise<string[]> {
  const { data: familles } = await db.from('familles').select('id, parent_id')
  const parents = new Map(((Array.isArray(familles) ? familles : []) as Array<{ id: string; parent_id: string | null }>)
    .map((f) => [f.id, f.parent_id]))
  const ascendants: string[] = []
  const vus = new Set<string>()
  for (let courant: string | null = familleId; courant && !vus.has(courant); courant = parents.get(courant) ?? null) {
    vus.add(courant)
    ascendants.push(courant)
  }
  return ascendants
}

/** Frais indirects applicables au modèle aujourd'hui (Phase 4) — ils se cumulent. */
export async function chargerFraisIndirects(modeleId: string, ascendants: string[]): Promise<RegleFraisIndirects[]> {
  const { data, error } = await db
    .from('frais_indirects')
    .select('id, libelle, centre_cout, mode, valeur, base, portee, famille_id, modele_id, date_debut, date_fin, actif')
    .eq('actif', true)
  if (error || !Array.isArray(data)) return []

  const regles = (data as Array<{
    id: string; libelle: string; centre_cout: string | null; mode: RegleFraisIndirects['mode']; valeur: number
    base: RegleFraisIndirects['base']; portee: RegleFraisIndirects['portee']; famille_id: string | null; modele_id: string | null
    date_debut: string | null; date_fin: string | null; actif: boolean
  }>).map((r) => ({
    id: r.id, libelle: r.libelle, centreCout: r.centre_cout, mode: r.mode, valeur: Number(r.valeur), base: r.base,
    portee: r.portee, familleId: r.famille_id, modeleId: r.modele_id, dateDebut: r.date_debut, dateFin: r.date_fin, actif: r.actif,
  }))
  return selectionnerFraisIndirects(regles, modeleId, ascendants, new Date().toISOString().slice(0, 10))
}

/** Taux de marge applicable : modèle > famille la plus proche (en remontant l'arbre) > global. */
export async function chargerTauxMarge(modeleId: string, ascendants: string[]): Promise<number | null> {
  const { data: regles } = await db.from('regles_marge').select('portee, famille_id, modele_id, taux_pct, actif').eq('actif', true)

  const r = ((Array.isArray(regles) ? regles : []) as Array<{
    portee: RegleMarge['portee']; famille_id: string | null; modele_id: string | null; taux_pct: number; actif: boolean
  }>).map((x) => ({ portee: x.portee, familleId: x.famille_id, modeleId: x.modele_id, tauxPct: Number(x.taux_pct), actif: x.actif }))

  return resoudreTauxMarge(r, modeleId, ascendants)
}

export interface EvaluationConfiguration {
  parametres: ParametreConfiguration[]
  validation: ResultatValidation
  estimation: ResultatEstimation
  ficheTechniqueId: string | null
  tauxMargePct: number | null
  /** Cause interne d'une fiche inutilisable (ex. taux horaire manquant) — vue ERP seulement. */
  erreurFiche?: string
}

/** Valide puis estime une saisie. Le prix n'est calculé que pour une configuration valide ou à valider. */
export async function evaluerConfiguration(
  modele: ModeleConfigurable,
  saisie: Record<string, unknown>,
  quantite: number,
): Promise<EvaluationConfiguration> {
  const parametres = await chargerParametres(modele.id)
  const validation = validerConfiguration(parametres, saisie, quantite)

  if (validation.statut === 'invalide' || validation.statut === 'hors_limites') {
    return {
      parametres, validation, ficheTechniqueId: null, tauxMargePct: null,
      estimation: estimerConfiguration({ modeleId: modele.id, validation, modeCalcul: null, ressources: [], tauxMargePct: null }),
    }
  }

  const ascendants = await chargerFamillesAscendantes(modele.famille_id)
  const [fiche, tauxMargePct, fraisIndirects] = await Promise.all([
    chargerFicheTechniqueActive(modele.id),
    chargerTauxMarge(modele.id, ascendants),
    chargerFraisIndirects(modele.id, ascendants),
  ])

  // Taux horaire manquant (Phase 5) : pas de prix automatique ; le client reçoit
  // un message générique, le détail reste dans erreurFiche (vue interne).
  const estimation: ResultatEstimation = !fiche.ok && fiche.code === 'TAUX_HORAIRE_MANQUANT'
    ? { disponible: false, raison: 'CALCUL_IMPOSSIBLE', message: 'Le prix de ce produit est en cours de mise à jour : il sera établi par nos équipes.' }
    : estimerConfiguration({
        modeleId: modele.id,
        validation,
        modeCalcul: fiche.ok ? fiche.modeCalcul : null,
        ressources: fiche.ok ? fiche.ressources : [],
        tauxMargePct,
        fraisIndirects,
      })

  return {
    parametres, validation, estimation, ficheTechniqueId: fiche.ok ? fiche.ficheTechniqueId : null, tauxMargePct,
    erreurFiche: fiche.ok ? undefined : fiche.message,
  }
}
