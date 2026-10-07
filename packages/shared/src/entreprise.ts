/**
 * Coordonnées officielles de TAFDIL SARL — source unique pour les documents
 * (aperçu web des factures, PDF générés par l'API).
 *
 * Validées par la direction le 2026-10-07 (recette AD-12). Pas de NINEA ni de
 * modalités de paiement pour l'instant : ne pas en inventer.
 */
export const TAFDIL_ENTREPRISE = {
  nom:        'TAFDIL SARL',
  activite:   'Microusine Métallurgique & BTP',
  adresse:    'Kotto Mauryvanas, Douala, Cameroun',
  telephones: ['+237 695 88 45 28', '+237 676 39 76 91'],
  email:      'tafdilsarl@gmail.com',
  niu:        'M052116085624A',
  rccm:       'RC/DLA/2021/B/2624',
} as const
