// FORGE — Workflow des demandes de devis (Catalogue Hybride Phase 6, §22/§23)
//
// Une demande de devis (table demandes_devis_web) suit :
//
//   nouvelle → en_qualification ⇄ infos_requises
//            → en_chiffrage → devis_envoye → acceptee → convertie
//   (refusee et expiree possibles en cours de route)
//
// Les valeurs historiques (vue, en_cours, traitee) restent lisibles : elles
// sont traitées comme leur équivalent (en_qualification / en_chiffrage).
// Fonctions PURES : le serveur les utilise pour refuser toute transition
// illégale, l'ERP pour n'afficher que les actions possibles.

export const STATUTS_DEMANDE = [
  'nouvelle', 'en_qualification', 'infos_requises', 'en_chiffrage',
  'devis_envoye', 'acceptee', 'refusee', 'expiree', 'convertie',
] as const
export type StatutDemande = typeof STATUTS_DEMANDE[number]

/** Anciennes valeurs encore présentes en base, jamais écrites par le nouveau code. */
export const STATUTS_DEMANDE_HISTORIQUES = ['vue', 'en_cours', 'traitee'] as const
export type StatutDemandeHistorique = typeof STATUTS_DEMANDE_HISTORIQUES[number]

const EQUIVALENT_HISTORIQUE: Record<StatutDemandeHistorique, StatutDemande> = {
  vue:      'en_qualification',
  en_cours: 'en_qualification',
  traitee:  'en_chiffrage',
}

/** Statut courant ramené au workflow actuel (une valeur historique vers son équivalent). */
export function normaliserStatutDemande(statut: string): StatutDemande | null {
  if ((STATUTS_DEMANDE as readonly string[]).includes(statut)) return statut as StatutDemande
  if (statut in EQUIVALENT_HISTORIQUE) return EQUIVALENT_HISTORIQUE[statut as StatutDemandeHistorique]
  return null
}

const TRANSITIONS: Record<StatutDemande, StatutDemande[]> = {
  nouvelle:         ['en_qualification', 'refusee'],
  en_qualification: ['infos_requises', 'en_chiffrage', 'refusee'],
  infos_requises:   ['en_qualification', 'refusee', 'expiree'],
  en_chiffrage:     ['devis_envoye', 'en_qualification', 'refusee'],
  devis_envoye:     ['acceptee', 'refusee', 'expiree', 'en_chiffrage'],
  acceptee:         ['convertie'],
  refusee:          [],
  expiree:          [],
  convertie:        [],
}

/** Statuts atteignables depuis `statut` (valeur historique acceptée). */
export function transitionsDemande(statut: string): StatutDemande[] {
  const courant = normaliserStatutDemande(statut)
  return courant ? TRANSITIONS[courant] : []
}

export function transitionDemandeAutorisee(de: string, vers: StatutDemande): boolean {
  return transitionsDemande(de).includes(vers)
}

/**
 * Statut de la demande induit par le statut de SON devis ERP, ou null si le
 * devis n'implique aucun changement. Utilisé pour synchroniser la demande sans
 * double saisie (le devis reste la source de vérité de la négociation).
 */
export function statutDemandeDepuisDevis(statutDevis: string): StatutDemande | null {
  switch (statutDevis) {
    case 'brouillon':  return 'en_chiffrage'
    case 'envoye':     return 'devis_envoye'
    case 'accepte':    return 'acceptee'
    case 'refuse':     return 'refusee'
    case 'expire':     return 'expiree'
    case 'transforme': return 'convertie'
    default:           return null
  }
}

export const LIBELLES_STATUT_DEMANDE: Record<StatutDemande | StatutDemandeHistorique, string> = {
  nouvelle:         'Nouvelle',
  en_qualification: 'En qualification',
  infos_requises:   'Informations requises',
  en_chiffrage:     'En chiffrage',
  devis_envoye:     'Devis envoyé',
  acceptee:         'Acceptée',
  refusee:          'Refusée',
  expiree:          'Expirée',
  convertie:        'Convertie en commande',
  vue:              'Vue (ancien statut)',
  en_cours:         'En cours (ancien statut)',
  traitee:          'Traitée (ancien statut)',
}
