import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

// ── Seuils par type de commande ────────────────────────────────────────────────

const SEUILS_WEB = {
  minimum_credit:    50_000,
  credit_45j:       150_000,
  plafond_max:      200_000 as number | null,
  historique_requis: 1,
} as const

const SEUILS_DEVIS = {
  minimum_credit:   100_000,
  credit_45j:       200_000,
  credit_60j:       500_000,
  plafond_max:    1_000_000 as number | null,
  historique_requis: 2,
} as const

const SEUILS_PROJET = {
  minimum_credit:   300_000,
  credit_60j:     1_000_000,
  plafond_max:    null as number | null,
  historique_requis: 0,
} as const

// ── Types publics ──────────────────────────────────────────────────────────────

export type TypeCommande = 'web' | 'devis' | 'projet'

export interface EligibiliteCredit {
  eligible: boolean
  raison?: string
}

// ── Helpers internes ───────────────────────────────────────────────────────────

function getSeuils(typeCommande: TypeCommande, conditionCode: string) {
  // Les codes PROJ-* imposent les seuils projet quelle que soit la route appelante
  if (conditionCode.startsWith('PROJ')) return SEUILS_PROJET
  if (typeCommande === 'web') return SEUILS_WEB
  return SEUILS_DEVIS
}

// ── Fonction principale ────────────────────────────────────────────────────────

/**
 * Vérifie si un client est éligible à une condition de crédit (≠ P100).
 *
 * @param clientId  UUID du client ERP — null pour les commandes web anonymes
 * @param montantXaf  Montant TTC de la commande en XAF
 * @param typeCommande  Contexte de la commande : 'web' | 'devis' | 'projet'
 * @param conditionPaiementCode  Code de la condition sélectionnée (P100, P30-LIV, …)
 */
export async function verifierEligibiliteCredit(
  clientId: string | null,
  montantXaf: number,
  typeCommande: TypeCommande,
  conditionPaiementCode: string,
): Promise<EligibiliteCredit> {

  // P100 = comptant intégral — toujours autorisé sans vérification
  if (conditionPaiementCode === 'P100') {
    return { eligible: true }
  }

  const seuils = getSeuils(typeCommande, conditionPaiementCode)

  // ── Vérifications liées au client ───────────────────────────────────────────

  if (!clientId) {
    // Commande anonyme (shop web) : on ne peut pas vérifier l'historique
    if (seuils.historique_requis > 0) {
      return {
        eligible: false,
        raison: 'Compte client ERP requis pour bénéficier d\'un crédit — veuillez vous rapprocher de notre équipe commerciale.',
      }
    }
  } else {
    const { data: client } = await db
      .from('clients')
      .select('statut, score_fiabilite, encours_credit_xaf, plafond_credit_xaf')
      .eq('id', clientId)
      .single()

    if (client) {
      const c = client as {
        statut: string
        score_fiabilite: string | null
        encours_credit_xaf: number | null
        plafond_credit_xaf: number | null
      }

      // Client bloqué — refus systématique
      if (c.statut === 'bloque') {
        return {
          eligible: false,
          raison: 'Client bloqué — aucune condition de crédit autorisée.',
        }
      }

      // Nouveau client sans historique suffisant
      if (c.score_fiabilite === 'nouveau' && seuils.historique_requis > 0) {
        return {
          eligible: false,
          raison: `Nouveau client — paiement comptant intégral (P100) requis. ${seuils.historique_requis} commande(s) honorée(s) nécessaire(s) pour accéder au crédit.`,
        }
      }

      // Vérification du plafond crédit
      const encours    = c.encours_credit_xaf ?? 0
      const plafondClient = (c.plafond_credit_xaf ?? 0) > 0 ? c.plafond_credit_xaf! : null
      const plafondEffectif = seuils.plafond_max !== null && plafondClient !== null
        ? Math.min(seuils.plafond_max, plafondClient)
        : (seuils.plafond_max ?? plafondClient)

      if (plafondEffectif !== null && encours + montantXaf > plafondEffectif) {
        return {
          eligible: false,
          raison: `Plafond crédit dépassé — encours actuel ${encours.toLocaleString('fr-CM')} XAF + commande ${montantXaf.toLocaleString('fr-CM')} XAF > plafond ${plafondEffectif.toLocaleString('fr-CM')} XAF.`,
        }
      }
    }
  }

  // ── Montant minimum pour accéder au crédit ──────────────────────────────────

  if (montantXaf < seuils.minimum_credit) {
    return {
      eligible: false,
      raison: `Montant trop faible pour bénéficier du crédit — minimum ${seuils.minimum_credit.toLocaleString('fr-CM')} XAF requis (P100 uniquement en dessous de ce seuil).`,
    }
  }

  // ── Vérifications par condition spécifique ──────────────────────────────────

  // P30-LIV : solde à la livraison — pas de délai crédit, disponible dès minimum_credit
  // (déjà validé par le seuil minimum ci-dessus)

  if (conditionPaiementCode === 'P30-45') {
    const seuil45 = 'credit_45j' in seuils ? (seuils as typeof SEUILS_DEVIS | typeof SEUILS_WEB).credit_45j : Infinity
    if (montantXaf < seuil45) {
      return {
        eligible: false,
        raison: `Montant insuffisant pour un crédit 45 jours — minimum ${seuil45.toLocaleString('fr-CM')} XAF.`,
      }
    }
  }

  if (conditionPaiementCode === 'P30-60') {
    if (typeCommande === 'web') {
      return {
        eligible: false,
        raison: 'Crédit 60 jours non disponible pour les commandes web — maximum P30-45.',
      }
    }
    const seuil60 = 'credit_60j' in seuils ? (seuils as typeof SEUILS_DEVIS | typeof SEUILS_PROJET).credit_60j : Infinity
    if (montantXaf < seuil60) {
      return {
        eligible: false,
        raison: `Montant insuffisant pour un crédit 60 jours — minimum ${seuil60.toLocaleString('fr-CM')} XAF.`,
      }
    }
  }

  if (conditionPaiementCode === 'PROJ-DG') {
    // Accord DG requis : éligible au dépôt mais doit être confirmé hors-système
    return {
      eligible: true,
      raison: 'Conditions PROJ-DG : accord préalable du DG requis — validation commerciale hors-système obligatoire.',
    }
  }

  return { eligible: true }
}
