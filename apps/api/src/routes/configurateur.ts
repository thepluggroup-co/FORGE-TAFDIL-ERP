// FORGE — Configurateur public des produits CONFIGURABLES (Catalogue Hybride Phase 3)
//
// Monté sur /api/shop/configurateur, SANS authentification (site TAFDIL).
//
//   GET  /:modeleId          schéma public (aucun coût exposé)
//   POST /:modeleId/estimer  validation + estimation NON contractuelle, n'écrit rien
//   POST /:modeleId/demande  « Demander validation » : configuration figée CFG-XXXXX
//                            + devis brouillon ; hors limites → demande de devis
//
// Le client ne voit jamais coût de revient, marge, coûts d'options ni ressources
// (§27) : ils restent dans configurations.estimation_snapshot et
// devis.ressources_snapshot, vue interne FORGE uniquement.

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { CommercialMode, resumerConfiguration, type ResultatEstimation, type ResultatValidation } from '@forge/shared'
import {
  chargerModele, chargerParametres, evaluerConfiguration, schemaPublic,
  type EvaluationConfiguration, type ModeleConfigurable,
} from '../services/configuration.service'
import { ensureClient } from '../services/client-sync.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'
import { writeAuditLog } from '../services/rbacService'
import { genererNumeroDevis } from './shop'

const db = supabaseAdmin!

export const configurateurRouter = new Hono()

// ── Helpers ────────────────────────────────────────────────────────────────────

interface VitrineConfigurable {
  visible_shop: boolean
  images: unknown
  description_longue: string | null
  delai_fabrication_jours: number | null
}

/** Modèle proposé au configurateur public : actif, CONFIGURABLE et en vitrine. */
async function chargerModelePublic(modeleId: string): Promise<{ modele: ModeleConfigurable; vitrine: VitrineConfigurable } | null> {
  if (!z.string().uuid().safeParse(modeleId).success) return null
  const modele = await chargerModele(modeleId)
  if (!modele || !modele.actif || modele.commercialMode !== CommercialMode.CONFIGURABLE) return null

  const { data: vitrine } = await db
    .from('modeles_shop')
    .select('visible_shop, images, description_longue, delai_fabrication_jours')
    .eq('modele_id', modeleId)
    .maybeSingle()
  if (!vitrine || !(vitrine as VitrineConfigurable).visible_shop) return null

  return { modele, vitrine: vitrine as VitrineConfigurable }
}

/** Résultat client : statut, messages et prix de VENTE estimé HT — jamais le coût. */
function resultatPublic(validation: ResultatValidation, estimation: ResultatEstimation, delai: number | null) {
  return {
    statut: validation.statut,
    erreurs: validation.erreurs.map((e) => ({ parametre: e.parametre, message: e.message })),
    hors_limites: validation.horsLimites,
    validations_requises: validation.validationsRequises,
    estimation: estimation.disponible
      ? {
          disponible: true as const,
          quantite: validation.quantite,
          prix_unitaire_ht_xaf: estimation.estimation.prixUnitaireHtXaf,
          prix_ht_xaf: estimation.estimation.prixVenteHtXaf,
          delai_fabrication_jours: delai,
          non_contractuel: true as const,
        }
      : { disponible: false as const, raison: estimation.raison, message: estimation.message },
  }
}

const saisieSchema = z.object({
  valeurs:  z.record(z.union([z.string().max(100), z.number(), z.boolean(), z.null()])),
  quantite: z.number().int().positive().max(1000),
})

const demandeSchema = saisieSchema.extend({
  client: z.object({
    nom:       z.string().trim().min(2).max(200),
    telephone: z.string().trim().min(8).max(20),
    email:     z.string().email().optional(),
  }),
  commentaire: z.string().max(1000).optional(),
})

const MESSAGES_DEMANDE: Record<ResultatValidation['statut'], string> = {
  valide:       'Votre demande a été transmise : un conseiller TAFDIL confirme le prix et le délai.',
  a_valider:    'Votre configuration nécessite une validation technique : un conseiller TAFDIL vous recontacte.',
  hors_limites: 'Votre projet sort de nos dimensions standard : il sera chiffré sur devis par nos équipes.',
  invalide:     'Configuration invalide.',
}

// ── GET /:modeleId — schéma public ─────────────────────────────────────────────

configurateurRouter.get('/:modeleId', async (c) => {
  const trouve = await chargerModelePublic(c.req.param('modeleId'))
  if (!trouve) return c.json({ error: 'Produit configurable introuvable', code: 'NOT_FOUND' }, 404)

  const { modele, vitrine } = trouve
  const parametres = await chargerParametres(modele.id)

  return c.json({
    data: {
      modele: {
        id: modele.id,
        reference: modele.reference,
        designation: modele.designation,
        description: vitrine.description_longue ?? modele.description,
        images: Array.isArray(vitrine.images) ? vitrine.images : [],
        delai_fabrication_jours: vitrine.delai_fabrication_jours,
        commercial_mode: CommercialMode.CONFIGURABLE,
      },
      parametres: schemaPublic(parametres),
    },
  })
})

// ── POST /:modeleId/estimer — estimation non contractuelle ─────────────────────

configurateurRouter.post('/:modeleId/estimer', zValidator('json', saisieSchema), async (c) => {
  const trouve = await chargerModelePublic(c.req.param('modeleId'))
  if (!trouve) return c.json({ error: 'Produit configurable introuvable', code: 'NOT_FOUND' }, 404)

  const body = c.req.valid('json')
  const { validation, estimation } = await evaluerConfiguration(trouve.modele, body.valeurs, body.quantite)
  return c.json({ data: resultatPublic(validation, estimation, trouve.vitrine.delai_fabrication_jours) })
})

// ── POST /:modeleId/demande — « Demander validation » ──────────────────────────

configurateurRouter.post('/:modeleId/demande', zValidator('json', demandeSchema), async (c) => {
  const trouve = await chargerModelePublic(c.req.param('modeleId'))
  if (!trouve) return c.json({ error: 'Produit configurable introuvable', code: 'NOT_FOUND' }, 404)

  const { modele, vitrine } = trouve
  const body = c.req.valid('json')

  // Le serveur recalcule tout : aucune valeur de prix n'est acceptée du client (§29/§43).
  const evaluation = await evaluerConfiguration(modele, body.valeurs, body.quantite)
  const { validation, estimation } = evaluation
  if (validation.statut === 'invalide') {
    return c.json({ error: 'Configuration invalide', code: 'CONFIGURATION_INVALIDE', details: resultatPublic(validation, estimation, null) }, 422)
  }

  const clientId = await ensureClient({
    nom: body.client.nom, telephone: body.client.telephone, email: body.client.email ?? null,
    adresse: null, ville: null, type: 'particulier',
  })

  // 1. Configuration figée (numéro CFG-XXXXX attribué par la base)
  const { data: configuration, error: errConfig } = await db
    .from('configurations')
    .insert(ligneConfiguration(modele, evaluation, body, clientId))
    .select('id, numero')
    .single()

  if (errConfig || !configuration) {
    console.error('[configurateur] insert configuration:', errConfig)
    return c.json({ error: 'Enregistrement de la configuration impossible', code: 'DB_ERROR' }, 500)
  }
  const cfg = configuration as { id: string; numero: string }

  // 2. Devis brouillon (+ demande de devis web si hors limites), rattachés une seule fois
  const resume = resumerConfiguration(evaluation.parametres, validation.valeurs)
  const devis = await creerDevisBrouillon(modele, evaluation, cfg.numero, resume, body, clientId)
  const demandeId = validation.statut === 'hors_limites'
    ? await creerDemandeDevisWeb(modele, cfg.numero, resume, body, devis?.id ?? null)
    : null

  if (devis || demandeId) {
    const { error: errLien } = await db
      .from('configurations')
      .update({ devis_id: devis?.id ?? null, demande_devis_web_id: demandeId })
      .eq('id', cfg.id)
    if (errLien) console.error('[configurateur] rattachement devis:', errLien)
  }

  writeAuditLog({
    actionType:   'CONFIGURATION_CREEE',
    module:       'COMMERCIAL',
    resourceType: 'configurations',
    resourceId:   cfg.id,
    payloadAfter: { numero: cfg.numero, statut: validation.statut, devis: devis?.numero ?? null, source: 'web' },
    ipAddress:    c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
    userAgent:    c.req.header('user-agent'),
  })

  await notifyWorkflow({
    event:    validation.statut === 'hors_limites' ? 'commandes.configuration_sur_devis' : 'commandes.configuration_a_valider',
    module:   'commandes',
    severite: 'info',
    titre:    `Configuration ${cfg.numero} — ${modele.designation}`,
    message:  `${body.client.nom} : ${resume} (× ${validation.quantite}). Statut : ${validation.statut}.`,
    ref:      cfg.numero,
    url:      devis ? '/devis' : '/boutique',
    data:     { configuration_id: cfg.id, devis_id: devis?.id ?? null },
  })

  return c.json({
    data: {
      numero:       cfg.numero,
      devis_numero: devis?.numero ?? null,
      message:      MESSAGES_DEMANDE[validation.statut],
      ...resultatPublic(validation, estimation, vitrine.delai_fabrication_jours),
    },
  }, 201)
})

// ── Écritures ──────────────────────────────────────────────────────────────────

function ligneConfiguration(
  modele: ModeleConfigurable,
  evaluation: EvaluationConfiguration,
  body: z.infer<typeof demandeSchema>,
  clientId: string | null,
) {
  const { validation, estimation } = evaluation
  return {
    modele_id:           modele.id,
    fiche_technique_id:  evaluation.ficheTechniqueId,
    statut:              validation.statut,
    quantite:            validation.quantite,
    valeurs:             validation.valeurs,
    schema_snapshot:     evaluation.parametres,
    estimation_snapshot: estimation.disponible ? estimation.estimation : { raison: estimation.raison, message: estimation.message },
    cout_revient_xaf:    estimation.disponible ? estimation.estimation.coutRevientXaf : (estimation.coutRevientXaf ?? null),
    taux_marge_pct:      estimation.disponible ? estimation.estimation.tauxMargePct : null,
    prix_estime_ht_xaf:  estimation.disponible ? estimation.estimation.prixVenteHtXaf : null,
    source:              'web',
    client_id:           clientId,
    client_nom:          body.client.nom,
    client_telephone:    body.client.telephone,
    client_email:        body.client.email ?? null,
    commentaire:         body.commentaire ?? null,
  }
}

async function creerDevisBrouillon(
  modele: ModeleConfigurable,
  evaluation: EvaluationConfiguration,
  numeroConfiguration: string,
  resume: string,
  body: z.infer<typeof demandeSchema>,
  clientId: string | null,
): Promise<{ id: string; numero: string } | null> {
  const { validation, estimation } = evaluation
  const prixUnitaire = estimation.disponible ? estimation.estimation.prixUnitaireHtXaf : 0
  const totalHt      = estimation.disponible ? estimation.estimation.prixVenteHtXaf : 0
  const today    = new Date().toISOString().split('T')[0]
  const validite = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]

  const notes = [
    `[CONFIGURATEUR WEB] ${numeroConfiguration} — ${modele.designation} (${modele.reference})`,
    resume,
    validation.statut === 'hors_limites'
      ? `HORS LIMITES : ${validation.horsLimites.map((h) => `${h.parametre} = ${h.valeur}${h.unite ? ` ${h.unite}` : ''} (plage ${h.min ?? '—'} – ${h.max ?? '—'})`).join(' ; ')} — à chiffrer sur devis.`
      : estimation.disponible
        ? 'Prix issu de l\'estimation automatique, NON contractuel : à valider avant envoi.'
        : `Prix à établir : ${estimation.message}`,
    ...validation.validationsRequises.map((v) => `Validation requise : ${v.raison}`),
    `Téléphone : ${body.client.telephone}`,
    body.client.email ? `Email : ${body.client.email}` : null,
    body.commentaire ? `Commentaire client : ${body.commentaire}` : null,
  ].filter(Boolean).join('\n')

  const { data: condP100 } = await db.from('conditions_paiement').select('id').eq('code', 'P100').maybeSingle()

  const { data: devis, error } = await db
    .from('devis')
    .insert({
      numero:                await genererNumeroDevis(),
      client_id:             clientId,
      client_nom:            body.client.nom,
      statut:                'brouillon',
      date_emission:         today,
      date_validite:         validite,
      validite_jours:        30,
      condition_paiement_id: (condP100 as { id?: string } | null)?.id ?? null,
      notes,
      source_demande:        'web',
      fiche_technique_id:    evaluation.ficheTechniqueId,
      config_snapshot:       { configuration: numeroConfiguration, modele_id: modele.id, valeurs: validation.valeurs, quantite: validation.quantite, statut: validation.statut },
      ressources_snapshot:   estimation.disponible ? estimation.estimation : null,
      total_ht_xaf:          totalHt,
      tva_xaf:               0,
      total_ttc_xaf:         totalHt,
      sync_status:           'synced',
    })
    .select('id, numero')
    .single()

  if (error || !devis) {
    console.error('[configurateur] insert devis:', error)
    return null
  }
  const d = devis as { id: string; numero: string }

  if (validation.statut !== 'hors_limites') {
    const { error: errLigne } = await db.from('devis_lignes').insert({
      devis_id:             d.id,
      designation:          `${modele.designation} (${modele.reference})`,
      description:          resume,
      categorie:            'autre',
      unite:                'unité',
      quantite:             validation.quantite,
      prix_unitaire_ht_xaf: prixUnitaire,
      total_ht_xaf:         totalHt,
      ordre:                0,
      configuration:        { configuration: numeroConfiguration, valeurs: validation.valeurs },
      formule_utilisee:     estimation.disponible ? estimation.estimation.formuleUtilisee : null,
      quantite_calculee:    estimation.disponible ? estimation.estimation.quantiteFacturable : null,
      cout_calcule_xaf:     estimation.disponible ? estimation.estimation.coutRevientXaf : null,
    })
    if (errLigne) console.error('[configurateur] insert ligne devis:', errLigne)
  }

  return d
}

async function creerDemandeDevisWeb(
  modele: ModeleConfigurable,
  numeroConfiguration: string,
  resume: string,
  body: z.infer<typeof demandeSchema>,
  devisId: string | null,
): Promise<string | null> {
  // Phase 6 : un devis pré-rempli existe déjà → la demande est directement « en chiffrage ».
  const statut = devisId ? 'en_chiffrage' : 'nouvelle'
  const { data, error } = await db
    .from('demandes_devis_web')
    .insert({
      nom:          body.client.nom,
      telephone:    body.client.telephone,
      email:        body.client.email ?? null,
      description:  `${numeroConfiguration} — ${resume}${body.commentaire ? `\n${body.commentaire}` : ''}`,
      type_projet:  modele.designation,
      produit_ref:  modele.reference,
      modele_id:    modele.id,
      source:       'configurateur',
      statut,
      erp_devis_id: devisId,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[configurateur] insert demande devis web:', error)
    return null
  }
  const id = (data as { id: string }).id
  const { error: errHisto } = await db.from('demandes_devis_historique').insert({
    demande_id: id, ancien_statut: null, nouveau_statut: statut, par: null,
    commentaire: devisId ? `Configuration ${numeroConfiguration} : devis pré-rempli créé` : `Configuration ${numeroConfiguration} reçue`,
  })
  if (errHisto) console.error('[configurateur] historique demande:', errHisto.message)
  return id
}
