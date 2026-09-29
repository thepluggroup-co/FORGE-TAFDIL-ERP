// FORGE — Demandes de devis : transitions tracées (Catalogue Hybride Phase 6, §23)
//
// Toute évolution de statut d'une demande (demandes_devis_web) passe par ici :
// règle de transition (@forge/shared/demande-devis) + ligne d'historique.

import { supabaseAdmin } from '@forge/db'
import {
  statutDemandeDepuisDevis, transitionDemandeAutorisee, normaliserStatutDemande,
  type StatutDemande,
} from '@forge/shared'

const db = supabaseAdmin!

export type ResultatTransition =
  | { ok: true; ancien: string; nouveau: StatutDemande }
  | { ok: false; code: 'NOT_FOUND' | 'TRANSITION_INTERDITE' | 'DB_ERROR'; message: string }

/**
 * Change le statut d'une demande si la transition est autorisée, et l'historise.
 * `par` = utilisateur ERP, ou null pour un changement automatique.
 */
export async function changerStatutDemande(
  demandeId: string,
  nouveau: StatutDemande,
  options: { par: string | null; commentaire?: string | null; horsWorkflow?: boolean },
): Promise<ResultatTransition> {
  const { data: demande } = await db.from('demandes_devis_web').select('id, statut').eq('id', demandeId).maybeSingle()
  if (!demande) return { ok: false, code: 'NOT_FOUND', message: 'Demande introuvable' }

  const ancien = (demande as { statut: string }).statut
  if (!options.horsWorkflow && !transitionDemandeAutorisee(ancien, nouveau)) {
    return { ok: false, code: 'TRANSITION_INTERDITE', message: `Passage de « ${ancien} » à « ${nouveau} » non autorisé` }
  }

  const { error } = await db.from('demandes_devis_web').update({ statut: nouveau }).eq('id', demandeId)
  if (error) return { ok: false, code: 'DB_ERROR', message: error.message }

  const { error: errHisto } = await db.from('demandes_devis_historique').insert({
    demande_id: demandeId, ancien_statut: ancien, nouveau_statut: nouveau,
    commentaire: options.commentaire ?? null, par: options.par,
  })
  if (errHisto) console.error('[demandes-devis] historique:', errHisto.message)

  return { ok: true, ancien, nouveau }
}

/**
 * Aligne la demande liée à un devis sur le statut de ce devis (envoyé, accepté,
 * refusé, expiré, transformé en commande). Le devis fait foi : la mise à jour
 * suit la réalité même si elle saute une étape, mais une demande déjà
 * convertie n'est jamais rouverte. Ne lève jamais d'erreur : la synchronisation
 * ne doit pas faire échouer l'opération sur le devis.
 */
export async function synchroniserDemandeDepuisDevis(devisId: string, statutDevis: string, par: string | null = null): Promise<void> {
  try {
    const cible = statutDemandeDepuisDevis(statutDevis)
    if (!cible) return

    const { data } = await db.from('demandes_devis_web').select('id, statut').eq('erp_devis_id', devisId)
    for (const demande of (Array.isArray(data) ? data : []) as Array<{ id: string; statut: string }>) {
      const actuel = normaliserStatutDemande(demande.statut)
      if (actuel === cible || actuel === 'convertie') continue
      await changerStatutDemande(demande.id, cible, {
        par, horsWorkflow: true, commentaire: `Synchronisé avec le devis (statut ${statutDevis})`,
      })
    }
  } catch (e) {
    console.error('[demandes-devis] synchronisation depuis devis:', e instanceof Error ? e.message : e)
  }
}
