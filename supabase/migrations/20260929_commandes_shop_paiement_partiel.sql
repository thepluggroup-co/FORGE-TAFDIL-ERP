-- ═══════════════════════════════════════════════════════════════════════════
-- commandes_shop.statut_paiement — ajout de l'état "paye_partiel" + correction
-- d'une dérive schéma/code sur l'état d'échec.
--
-- Contexte : les paiements NOKASH (Mobile Money) supportent des avances de
-- livraison à 30/50/70% (webhook paiements.ts), mais la contrainte CHECK
-- posée à la création de la table (20260519_shop_tables.sql) ne connaissait
-- que 'en_attente','paye','echoue','rembourse' — aucun état pour "avance
-- reçue, solde à la livraison". Le webhook stockait donc une avance reçue
-- comme 'en_attente', identique à "rien payé du tout", et le client ne
-- recevait aucun message de confirmation pour son acompte.
--
-- Par ailleurs le code (paiements.ts, commerce.ts, tout le frontend) écrit et
-- valide 'echec' pour un paiement échoué, jamais 'echoue' — la contrainte
-- d'origine aurait donc rejeté ces écritures. Alignée ici sur la valeur
-- réellement utilisée partout ailleurs.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.commandes_shop
  DROP CONSTRAINT IF EXISTS commandes_shop_statut_paiement_check;

ALTER TABLE public.commandes_shop
  ADD CONSTRAINT commandes_shop_statut_paiement_check
    CHECK (statut_paiement IN ('en_attente','paye','paye_partiel','echec','rembourse'));
