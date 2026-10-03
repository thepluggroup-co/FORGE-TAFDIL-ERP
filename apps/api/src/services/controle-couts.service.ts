// FORGE — Contrôle des coûts : chargement groupé (Catalogue Hybride Phase 8)
//
// Toute la logique de calcul vit dans @forge/shared/controle-couts (pure).
// Ici : lecture groupée (quelques requêtes pour N OF / N commandes, jamais une
// requête par ligne) des valeurs figées au lancement des OF et au devis.

import { supabaseAdmin } from '@forge/db'
import {
  calculerCoutsOF, calculerMargeCommande,
  type CoutsOF, type MargeCommande, type OperationCout, type ConsommationCout, type SnapshotCoutDevis,
} from '@forge/shared'

const db = supabaseAdmin!

type OperationRow = OperationCout & { job_id: string }
type ConsommationRow = ConsommationCout & { job_id: string }

/** Taille d'un filtre `.in()` : ~100 UUID gardent l'URL PostgREST loin de sa limite. */
const TAILLE_PAQUET = 100

/** Exécute une lecture `.in()` par paquets d'identifiants et concatène les lignes. */
async function parPaquets(
  ids: string[],
  lire: (paquet: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const paquets: string[][] = []
  for (let i = 0; i < ids.length; i += TAILLE_PAQUET) paquets.push(ids.slice(i, i + TAILLE_PAQUET))
  const resultats = await Promise.all(paquets.map(lire))
  return resultats.flatMap((r) => {
    if (r.error) throw new Error(r.error.message)
    return r.data ?? []
  })
}

/** Coûts prévus / réels de plusieurs OF, indexés par id d'OF. */
export async function coutsDesOF(jobIds: string[]): Promise<Map<string, CoutsOF>> {
  const resultat = new Map<string, CoutsOF>()
  if (jobIds.length === 0) return resultat

  const [ops, conso] = await Promise.all([
    parPaquets(jobIds, (ids) => db.from('of_operations')
      .select('job_id, numero, libelle, statut, temps_prevu_h, temps_reel_h, poste_libelle, equipement_designation, cout_horaire_poste_xaf, cout_horaire_equipement_xaf')
      .in('job_id', ids)),
    parPaquets(jobIds, (ids) => db.from('of_consommations')
      .select('job_id, designation, type, quantite_prevue, quantite_reelle, cout_unitaire_reference_xaf')
      .in('job_id', ids)),
  ])

  const parJob = <T extends { job_id: string }>(lignes: T[]) => {
    const m = new Map<string, T[]>()
    for (const l of lignes) m.set(l.job_id, [...(m.get(l.job_id) ?? []), l])
    return m
  }
  const opsParJob = parJob(ops as OperationRow[])
  const consoParJob = parJob(conso as ConsommationRow[])

  for (const id of jobIds) {
    const o = (opsParJob.get(id) ?? []).sort((a, b) => a.numero - b.numero)
    resultat.set(id, calculerCoutsOF(o, consoParJob.get(id) ?? []))
  }
  return resultat
}

export interface LigneControleCommande {
  commande_id: string
  numero: string
  client_nom: string | null
  statut: string
  nb_of: number
  marge: MargeCommande
}

/** Marge prévue / réelle de plusieurs commandes. */
export async function controleDesCommandes(commandeIds: string[]): Promise<LigneControleCommande[]> {
  if (commandeIds.length === 0) return []

  const [{ data: commandes, error: errCmd }, { data: jobs, error: errJobs }] = await Promise.all([
    db.from('commandes').select('id, numero, client_nom, statut, total_ht_xaf, devis_id').in('id', commandeIds),
    db.from('jobs_production').select('id, commande_id, statut').in('commande_id', commandeIds),
  ])
  if (errCmd) throw new Error(errCmd.message)
  if (errJobs) throw new Error(errJobs.message)

  type Cmd = { id: string; numero: string; client_nom: string | null; statut: string; total_ht_xaf: number | null; devis_id: string | null }
  const cmds = (commandes ?? []) as Cmd[]
  const ofs = ((jobs ?? []) as Array<{ id: string; commande_id: string; statut: string }>).filter((j) => j.statut !== 'cancelled')

  const devisIds = [...new Set(cmds.map((c) => c.devis_id).filter((d): d is string => !!d))]
  const snapshots = new Map<string, SnapshotCoutDevis | null>()
  if (devisIds.length > 0) {
    const { data: devis, error } = await db.from('devis').select('id, ressources_snapshot').in('id', devisIds)
    if (error) throw new Error(error.message)
    for (const d of (devis ?? []) as Array<{ id: string; ressources_snapshot: SnapshotCoutDevis | null }>) snapshots.set(d.id, d.ressources_snapshot)
  }

  const couts = await coutsDesOF(ofs.map((j) => j.id))

  return cmds.map((c) => {
    const sesOF = ofs.filter((j) => j.commande_id === c.id)
    return {
      commande_id: c.id,
      numero:      c.numero,
      client_nom:  c.client_nom,
      statut:      c.statut,
      nb_of:       sesOF.length,
      marge: calculerMargeCommande({
        prixVenteHtXaf: Number(c.total_ht_xaf ?? 0),
        ofs:            sesOF.map((j) => couts.get(j.id)!).filter(Boolean),
        snapshot:       c.devis_id ? snapshots.get(c.devis_id) ?? null : null,
      }),
    }
  })
}
