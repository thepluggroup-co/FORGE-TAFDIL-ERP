/**
 * FORGE ERP — Score de fiabilité crédit comptoir (module Caisse)
 *
 * Règle métier :
 *   - Tout client démarre avec un score sur 10 (SCORE_INITIAL).
 *   - Chaque échéance crédit comptoir (paiements_ticket.mode='credit') non
 *     honorée sous DELAI_ECHEANCE_JOURS jours fait perdre SCORE_PENALITE_RETARD
 *     point(s) — détecté par checkOverdueCaisseCredits (cron quotidien).
 *   - Sous SCORE_SEUIL_BLOCAGE/10 : crédit comptoir bloqué pour ce client
 *     pendant BLOCAGE_DUREE_JOURS jours (paiement cash uniquement).
 *   - Une fois le blocage expiré, le score repart à SCORE_INITIAL à la
 *     prochaine tentative de vente à crédit (verifierEligibiliteCreditCaisse).
 *
 * Distinct de clients.score_fiabilite (module crédit commercial existant,
 * apps/api/src/services/credit-eligibility.service.ts) — mécanisme séparé,
 * propre au comptoir.
 */
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

export const SCORE_INITIAL          = 10
export const SCORE_SEUIL_BLOCAGE    = 5
export const SCORE_PENALITE_RETARD  = 1
export const DELAI_ECHEANCE_JOURS   = 30
export const BLOCAGE_DUREE_JOURS    = 30

export interface EligibiliteCreditCaisse {
  eligible: boolean
  raison?:  string
  score?:   number
}

interface ClientCreditRow {
  score_fiabilite_caisse:        number
  credit_caisse_bloque_jusqu_au: string | null
}

/**
 * Vérifie si un client peut payer une part de ticket en 'credit'.
 * Si un blocage antérieur est expiré, remet le score à SCORE_INITIAL et lève
 * le blocage avant de statuer (nouveau départ après les 30 jours cash).
 */
export async function verifierEligibiliteCreditCaisse(clientId: string): Promise<EligibiliteCreditCaisse> {
  const { data: client, error } = await db
    .from('clients')
    .select('score_fiabilite_caisse, credit_caisse_bloque_jusqu_au')
    .eq('id', clientId)
    .single()

  if (error || !client) {
    return { eligible: false, raison: 'Client introuvable' }
  }

  const c = client as ClientCreditRow
  let score = c.score_fiabilite_caisse ?? SCORE_INITIAL

  if (c.credit_caisse_bloque_jusqu_au) {
    const bloqueJusquAu = new Date(c.credit_caisse_bloque_jusqu_au)

    if (bloqueJusquAu > new Date()) {
      return {
        eligible: false,
        score,
        raison: `Crédit comptoir bloqué jusqu'au ${bloqueJusquAu.toLocaleDateString('fr-CM')} — paiement cash uniquement (score de fiabilité insuffisant).`,
      }
    }

    // Blocage expiré — nouveau départ
    score = SCORE_INITIAL
    const { error: resetErr } = await db
      .from('clients')
      .update({ score_fiabilite_caisse: SCORE_INITIAL, credit_caisse_bloque_jusqu_au: null, updated_at: new Date().toISOString() })
      .eq('id', clientId)

    if (resetErr) {
      console.error('[caisse-credit] reset score après blocage expiré:', resetErr.message)
    } else {
      console.info('[caisse-credit] blocage expiré, score remis à', SCORE_INITIAL, { clientId })
    }
  }

  if (score < SCORE_SEUIL_BLOCAGE) {
    return {
      eligible: false,
      score,
      raison: `Score de fiabilité caisse insuffisant (${score}/10, minimum ${SCORE_SEUIL_BLOCAGE}/10) — crédit comptoir refusé.`,
    }
  }

  return { eligible: true, score }
}

/**
 * Pénalise le score de fiabilité caisse d'un client pour un retard constaté
 * (échéance dépassée, remboursée ou non). Partagée par checkOverdueCaisseCredits
 * (cron) et le remboursement manuel (PATCH /paiements/:id/rembourser) — un
 * client qui règle en retard AVANT le passage du cron doit être pénalisé tout
 * autant qu'un client jamais relancé.
 */
export async function penaliserRetardCaisse(clientId: string, contexte?: string): Promise<{ nouveauScore: number; bloque: boolean }> {
  const { data: client } = await db
    .from('clients')
    .select('score_fiabilite_caisse')
    .eq('id', clientId)
    .single()

  const scoreActuel  = (client as { score_fiabilite_caisse?: number } | null)?.score_fiabilite_caisse ?? SCORE_INITIAL
  const nouveauScore = Math.max(0, scoreActuel - SCORE_PENALITE_RETARD)

  const updates: Record<string, unknown> = {
    score_fiabilite_caisse: nouveauScore,
    updated_at:             new Date().toISOString(),
  }

  const bloque = nouveauScore < SCORE_SEUIL_BLOCAGE
  if (bloque) {
    const bloqueJusquAu = new Date(Date.now() + BLOCAGE_DUREE_JOURS * 86_400_000)
    updates.credit_caisse_bloque_jusqu_au = bloqueJusquAu.toISOString()
    console.warn('[caisse-credit] client bloqué (score < seuil)', { clientId, nouveauScore, bloqueJusquAu: bloqueJusquAu.toISOString(), contexte })
  }

  const { error } = await db.from('clients').update(updates).eq('id', clientId)
  if (error) console.error('[caisse-credit] pénalité score échouée:', error.message, { clientId })

  return { nouveauScore, bloque }
}

interface OverduePaiementRow {
  id:         string
  ticket_id:  string
  montant_xaf: number
  tickets_vente: { client_id: string | null; numero_facture: string | null } | null
}

/**
 * Cron quotidien : marque en_retard les échéances crédit comptoir dépassées
 * et non remboursées, puis pénalise le score de fiabilité caisse du client.
 * Sous le seuil, bloque le crédit comptoir pour BLOCAGE_DUREE_JOURS jours.
 */
export async function checkOverdueCaisseCredits(): Promise<{ marked: number; blocked: number; errors: string[] }> {
  const today  = new Date().toISOString().slice(0, 10)
  const errors: string[] = []

  const { data: overdueRows, error } = await db
    .from('paiements_ticket')
    .select('id, ticket_id, montant_xaf, tickets_vente(client_id, numero_facture)')
    .eq('mode', 'credit')
    .eq('statut_remboursement', 'en_attente')
    .lt('date_echeance', today)

  if (error) {
    console.error('[caisse-credit:cron] erreur lecture échéances', { error: error.message })
    return { marked: 0, blocked: 0, errors: [error.message] }
  }

  const rows = (overdueRows ?? []) as unknown as OverduePaiementRow[]
  let marked  = 0
  let blocked = 0

  for (const row of rows) {
    const { error: upErr } = await db
      .from('paiements_ticket')
      .update({ statut_remboursement: 'en_retard' })
      .eq('id', row.id)

    if (upErr) {
      errors.push(`paiement ${row.id}: ${upErr.message}`)
      continue
    }
    marked++

    const clientId = row.tickets_vente?.client_id
    if (!clientId) continue   // vente comptoir anonyme — pas de score à pénaliser

    const { bloque } = await penaliserRetardCaisse(clientId, row.tickets_vente?.numero_facture ?? row.ticket_id)
    if (bloque) blocked++
  }

  console.info('[caisse-credit:cron] terminé', { marked, blocked, errors: errors.length })
  return { marked, blocked, errors }
}
