/**
 * Cron de relances automatiques WhatsApp — MOD-04 CDC TAFDIL
 *
 * Exécuté chaque matin à 8h.
 * Détecte les crédits :
 *   - À J-7 : échéance dans exactement 7 jours → relance préventive
 *   - À J=0 : échéance aujourd'hui              → relance urgente
 *   - Échus  : statut 'echu'                    → relance mensuelle (1x/mois)
 *
 * Utilise CallMeBot pour l'envoi WhatsApp.
 * Trace chaque envoi dans la table `relances_log` pour éviter les doublons.
 */

import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

// ── Helpers ────────────────────────────────────────────────────────────────────

function xaf(n: number): string {
  return n.toLocaleString('fr-FR') + ' XAF'
}

async function envoyerWhatsApp(phone: string, message: string): Promise<boolean> {
  const apiKey = process.env.CALLMEBOT_APIKEY
  if (!apiKey || apiKey === 'REMPLACER') {
    console.warn('[relances] CALLMEBOT_APIKEY non configuré — simulation envoi pour:', phone)
    return true   // simulation en dev
  }

  const url = new URL('https://api.callmebot.com/whatsapp.php')
  url.searchParams.set('phone',  phone.replace(/\D/g, ''))
  url.searchParams.set('text',   message)
  url.searchParams.set('apikey', apiKey)

  try {
    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    const ok   = res.ok || text.toLowerCase().includes('queued')
    if (!ok) console.warn('[relances] CallMeBot erreur:', text.slice(0, 200))
    return ok
  } catch (e) {
    console.error('[relances] CallMeBot fetch error:', e)
    return false
  }
}

/** Vérifie si une relance a déjà été envoyée aujourd'hui pour ce crédit+type. */
async function dejaEnvoye(creditId: string, type: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await db
    .from('relances_log')
    .select('*', { count: 'exact', head: true })
    .eq('credit_id', creditId)
    .eq('type_relance', type)
    .gte('created_at', `${today}T00:00:00.000Z`)
  return (count ?? 0) > 0
}

/** Enregistre l'envoi dans le log. */
async function logRelance(creditId: string, type: string, phone: string, message: string): Promise<void> {
  await db.from('relances_log').insert({
    credit_id:    creditId,
    type_relance: type,
    telephone:    phone,
    message,
  }).catch(e => console.error('[relances] log insert error:', e))
}

// ── Logique principale ─────────────────────────────────────────────────────────

export async function lancerRelances(): Promise<{ envoyes: number; erreurs: number }> {
  const today  = new Date()
  const todayS = today.toISOString().slice(0, 10)
  const in7j   = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10)

  console.info('[relances] démarrage cron —', todayS)

  // Récupérer les crédits concernés : échus OU échéance aujourd'hui OU dans 7 jours
  const { data: credits, error } = await db
    .from('credits')
    .select('id, numero, client_nom, client_id, solde_restant_xaf, echeance, statut')
    .or(`statut.eq.echu,and(statut.eq.en_cours,echeance.lte.${in7j})`)
    .order('echeance')

  if (error) {
    console.error('[relances] Erreur lecture crédits:', error.message)
    return { envoyes: 0, erreurs: 1 }
  }

  let envoyes = 0
  let erreurs = 0

  for (const c of (credits ?? []) as Array<{
    id: string; numero: string; client_nom: string; client_id: string | null
    solde_restant_xaf: number; echeance: string; statut: string
  }>) {
    // Déterminer le type de relance
    let typeRelance: string
    if (c.statut === 'echu') {
      typeRelance = 'echu'
      // Pour les échus, une relance par mois maximum
      const debutMois = `${todayS.slice(0, 7)}-01T00:00:00.000Z`
      const { count } = await db.from('relances_log').select('*', { count: 'exact', head: true })
        .eq('credit_id', c.id).eq('type_relance', 'echu').gte('created_at', debutMois)
      if ((count ?? 0) > 0) continue
    } else if (c.echeance === todayS) {
      typeRelance = 'echeance_aujourdhui'
    } else if (c.echeance === in7j) {
      typeRelance = 'j_moins_7'
    } else {
      continue
    }

    // Vérifier doublon du jour (sauf pour "echu" déjà géré ci-dessus)
    if (typeRelance !== 'echu' && await dejaEnvoye(c.id, typeRelance)) continue

    // Récupérer le téléphone du client
    let telephone: string | null = null
    if (c.client_id) {
      const { data: client } = await db.from('clients').select('telephone').eq('id', c.client_id).single()
      telephone = (client as { telephone?: string } | null)?.telephone ?? null
    }

    if (!telephone) {
      console.warn(`[relances] Pas de téléphone pour client "${c.client_nom}" (crédit ${c.numero})`)
      continue
    }

    // Construire le message
    let message: string
    if (typeRelance === 'echu') {
      message = `⚠️ Rappel TAFDIL\n\nBonjour ${c.client_nom},\n\nVotre crédit n° ${c.numero} est *échu*.\nMontant restant dû : *${xaf(c.solde_restant_xaf)}*\n\nMerci de régulariser votre situation.\nContact : +237 695 884 528 — TAFDIL SARL`
    } else if (typeRelance === 'echeance_aujourdhui') {
      message = `🔔 Échéance aujourd'hui — TAFDIL\n\nBonjour ${c.client_nom},\n\nVotre crédit n° ${c.numero} arrive à échéance *aujourd'hui*.\nMontant restant dû : *${xaf(c.solde_restant_xaf)}*\n\nContact : +237 695 884 528 — TAFDIL SARL`
    } else {
      message = `📅 Rappel échéance — TAFDIL\n\nBonjour ${c.client_nom},\n\nVotre crédit n° ${c.numero} arrive à échéance dans *7 jours* (${c.echeance}).\nMontant restant dû : *${xaf(c.solde_restant_xaf)}*\n\nContact : +237 695 884 528 — TAFDIL SARL`
    }

    const ok = await envoyerWhatsApp(telephone, message)
    if (ok) {
      await logRelance(c.id, typeRelance, telephone, message)
      envoyes++
      console.info(`[relances] ✅ ${typeRelance} envoyé → ${c.client_nom} (${telephone})`)
    } else {
      erreurs++
      console.warn(`[relances] ❌ Échec envoi → ${c.client_nom} (${telephone})`)
    }

    // Petite pause pour ne pas saturer CallMeBot
    await new Promise(r => setTimeout(r, 2000))
  }

  console.info(`[relances] terminé — ${envoyes} envoyés, ${erreurs} erreurs`)
  return { envoyes, erreurs }
}

// ── Démarrage du cron ─────────────────────────────────────────────────────────

let cronTimer: ReturnType<typeof setInterval> | null = null

/**
 * Lance le cron qui s'exécute chaque jour à 8h00.
 * Appelé une fois au démarrage de l'API.
 */
export function demarrerCronRelances(): void {
  const planifierProchainLancement = () => {
    const now     = new Date()
    const prochainLancement = new Date(now)

    prochainLancement.setHours(8, 0, 0, 0)
    if (prochainLancement <= now) {
      // Si 8h est déjà passé aujourd'hui, programmer pour demain
      prochainLancement.setDate(prochainLancement.getDate() + 1)
    }

    const delai = prochainLancement.getTime() - now.getTime()
    const heure = prochainLancement.toLocaleString('fr-CM', { timeZone: 'Africa/Douala' })
    console.info(`[relances] cron programmé pour ${heure} (dans ${Math.round(delai / 60000)} min)`)

    cronTimer = setTimeout(async () => {
      await lancerRelances().catch(e => console.error('[relances] cron error:', e))
      planifierProchainLancement()   // re-programmer pour le lendemain
    }, delai)
  }

  planifierProchainLancement()
}

export function arreterCronRelances(): void {
  if (cronTimer) { clearTimeout(cronTimer); cronTimer = null }
}
