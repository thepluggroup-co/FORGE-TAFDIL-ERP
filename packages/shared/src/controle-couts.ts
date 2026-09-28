// FORGE — Contrôle des coûts (Catalogue Hybride Phase 8, §26/§27)
//
// Compare, pour un OF puis pour une commande :
//   - le coût PRÉVU : temps prévus × taux horaires figés au lancement,
//     quantités prévues × coûts de référence figés (Phase 7) ;
//   - le coût RÉEL : temps réellement passés, quantités réellement consommées,
//     valorisés aux MÊMES taux figés, pour que l'écart mesure la fabrication
//     (temps, pertes matière) et non une variation de tarif.
//
// Tant que l'OF n'est pas fini, le réel est une estimation « à terminaison » :
// une étape non terminée compte pour le plus grand de son temps réel déjà
// saisi et de son temps prévu ; une consommation non saisie compte pour sa
// quantité prévue. Le résultat le signale (complet = false).
//
// Un taux horaire inconnu n'est jamais compté pour 0 : l'étape est exclue des
// deux côtés et signalée.
// Fonctions PURES, testées sans base.

import { arrondirXaf } from './devis-calcul'

export interface OperationCout {
  numero: number
  libelle: string
  statut: string
  temps_prevu_h: number | null
  temps_reel_h: number | null
  poste_libelle?: string | null
  equipement_designation?: string | null
  cout_horaire_poste_xaf: number | null
  cout_horaire_equipement_xaf: number | null
}

export interface ConsommationCout {
  designation: string
  type: 'materiau' | 'consommable'
  quantite_prevue: number
  quantite_reelle: number | null
  cout_unitaire_reference_xaf: number
}

export interface PosteCouts {
  mainOeuvreXaf: number
  machinesXaf: number
  matieresXaf: number
  consommablesXaf: number
  totalXaf: number
}

export interface CoutsOF {
  prevu: PosteCouts
  reel: PosteCouts
  ecartXaf: number
  /** Écart en % du prévu, ou null si le prévu est nul. */
  ecartPct: number | null
  /** true quand toutes les étapes sont closes et toutes les consommations saisies. */
  complet: boolean
  alertes: string[]
}

const vide = (): PosteCouts => ({ mainOeuvreXaf: 0, machinesXaf: 0, matieresXaf: 0, consommablesXaf: 0, totalXaf: 0 })

function finaliser(p: PosteCouts): PosteCouts {
  const r = {
    mainOeuvreXaf:   arrondirXaf(p.mainOeuvreXaf),
    machinesXaf:     arrondirXaf(p.machinesXaf),
    matieresXaf:     arrondirXaf(p.matieresXaf),
    consommablesXaf: arrondirXaf(p.consommablesXaf),
    totalXaf:        0,
  }
  r.totalXaf = r.mainOeuvreXaf + r.machinesXaf + r.matieresXaf + r.consommablesXaf
  return r
}

export function pourcentageEcart(reel: number, prevu: number): number | null {
  if (!(prevu > 0)) return null
  return Math.round(((reel - prevu) / prevu) * 1000) / 10
}

/** Coût prévu et coût réel (ou estimé à terminaison) d'un OF. */
export function calculerCoutsOF(operations: OperationCout[], consommations: ConsommationCout[]): CoutsOF {
  const prevu = vide()
  const reel = vide()
  const alertes: string[] = []
  let complet = true

  for (const op of operations) {
    const tPrevu = Number(op.temps_prevu_h ?? 0)
    const tSaisi = op.temps_reel_h === null ? null : Number(op.temps_reel_h)
    let tReel: number
    switch (op.statut) {
      case 'sautee':   tReel = 0; break
      case 'terminee': tReel = tSaisi ?? tPrevu; if (tSaisi === null) complet = false; break
      default:         tReel = Math.max(tSaisi ?? 0, tPrevu); complet = false
    }
    const tPrevuRetenu = op.statut === 'sautee' ? 0 : tPrevu

    const taux: Array<[number | null, 'mainOeuvreXaf' | 'machinesXaf', string | null | undefined]> = [
      [op.cout_horaire_poste_xaf, 'mainOeuvreXaf', op.poste_libelle],
      [op.cout_horaire_equipement_xaf, 'machinesXaf', op.equipement_designation],
    ]
    for (const [t, poste, nom] of taux) {
      if (nom == null && t == null) continue
      if (t == null || !Number.isFinite(Number(t))) {
        alertes.push(`Op ${op.numero} ${op.libelle} : taux horaire inconnu (${nom ?? 'ressource'}), non chiffrée`)
        continue
      }
      prevu[poste] += tPrevuRetenu * Number(t)
      reel[poste] += tReel * Number(t)
    }
  }

  for (const k of consommations) {
    const cle = k.type === 'consommable' ? 'consommablesXaf' : 'matieresXaf'
    const cout = Number(k.cout_unitaire_reference_xaf ?? 0)
    const qPrevue = Number(k.quantite_prevue ?? 0)
    if (k.quantite_reelle === null) complet = false
    const qReelle = k.quantite_reelle === null ? qPrevue : Number(k.quantite_reelle)
    if (cout === 0 && qReelle > 0) alertes.push(`${k.designation} : coût de référence nul, consommation non valorisée`)
    prevu[cle] += qPrevue * cout
    reel[cle] += qReelle * cout
  }

  if (operations.length === 0 && consommations.length === 0) {
    complet = false
    alertes.push('OF sans gamme : aucun coût de fabrication suivi')
  }

  const p = finaliser(prevu)
  const r = finaliser(reel)
  return { prevu: p, reel: r, ecartXaf: r.totalXaf - p.totalXaf, ecartPct: pourcentageEcart(r.totalXaf, p.totalXaf), complet, alertes }
}

// ── Commande : coût de revient et marge réels ──────────────────────────────────

/** Estimation interne figée au devis (devis.ressources_snapshot), champs utiles ici. */
export interface SnapshotCoutDevis {
  coutRevientXaf?: number
  coutSousTraitanceXaf?: number
  coutOptionsXaf?: number
  fraisIndirectsXaf?: number
  coutTransportXaf?: number
  coutInstallationXaf?: number
  margeXaf?: number
}

export interface MargeCommande {
  prixVenteHtXaf: number
  /** Coûts non suivis en atelier (sous-traitance, options, frais indirects, transport, installation), repris du devis. */
  autresCoutsPrevusXaf: number | null
  coutRevientPrevuXaf: number | null
  coutRevientReelXaf: number
  margePrevueXaf: number | null
  margeReelleXaf: number
  tauxMargeReellePct: number | null
  ecartMargeXaf: number | null
  complet: boolean
  alertes: string[]
}

/**
 * Marge réelle d'une commande = prix vendu HT − (coût de fabrication réel de
 * ses OF + coûts hors atelier prévus au devis). Sans estimation figée au devis,
 * seuls les coûts de fabrication sont comptés, et c'est signalé.
 */
export function calculerMargeCommande(args: {
  prixVenteHtXaf: number
  ofs: CoutsOF[]
  snapshot: SnapshotCoutDevis | null
}): MargeCommande {
  const alertes = args.ofs.flatMap((o) => o.alertes)
  const fabricationReelle = args.ofs.reduce((s, o) => s + o.reel.totalXaf, 0)
  const s = args.snapshot

  const autres = s && Number.isFinite(Number(s.coutRevientXaf))
    ? arrondirXaf(['coutSousTraitanceXaf', 'coutOptionsXaf', 'fraisIndirectsXaf', 'coutTransportXaf', 'coutInstallationXaf']
        .reduce((t, k) => t + Number((s as Record<string, number | undefined>)[k] ?? 0), 0))
    : null
  if (autres === null) alertes.push('Devis sans estimation de coût figée : frais indirects, transport et sous-traitance non comptés')
  if (args.ofs.length === 0) alertes.push('Aucun OF pour cette commande')

  const coutRevientPrevu = s && Number.isFinite(Number(s.coutRevientXaf)) ? arrondirXaf(Number(s.coutRevientXaf)) : null
  const coutRevientReel = arrondirXaf(fabricationReelle + (autres ?? 0))
  const prix = arrondirXaf(args.prixVenteHtXaf)
  const margePrevue = coutRevientPrevu === null ? null : prix - coutRevientPrevu
  const margeReelle = prix - coutRevientReel

  return {
    prixVenteHtXaf:       prix,
    autresCoutsPrevusXaf: autres,
    coutRevientPrevuXaf:  coutRevientPrevu,
    coutRevientReelXaf:   coutRevientReel,
    margePrevueXaf:       margePrevue,
    margeReelleXaf:       margeReelle,
    tauxMargeReellePct:   prix > 0 ? Math.round((margeReelle / prix) * 1000) / 10 : null,
    ecartMargeXaf:        margePrevue === null ? null : margeReelle - margePrevue,
    complet:              args.ofs.length > 0 && args.ofs.every((o) => o.complet) && autres !== null,
    alertes,
  }
}

// ── Indicateurs de l'atelier ──────────────────────────────────────────────────

/**
 * Rendement = temps prévu / temps réel des étapes terminées (100 % = conforme
 * au prévu, > 100 % = plus rapide). null sans étape terminée chiffrée.
 */
export function rendementAtelier(etapes: Array<{ temps_prevu_h: number | null; temps_reel_h: number | null }>): number | null {
  const valides = etapes.filter((e) => Number(e.temps_reel_h) > 0 && Number(e.temps_prevu_h) > 0)
  const reel = valides.reduce((s, e) => s + Number(e.temps_reel_h), 0)
  if (!(reel > 0)) return null
  const prevu = valides.reduce((s, e) => s + Number(e.temps_prevu_h), 0)
  return Math.round((prevu / reel) * 100)
}
