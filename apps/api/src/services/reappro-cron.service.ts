/**
 * Cron réapprovisionnement stock — FORGE ERP
 *
 * Scan quotidien (heure configurable via REAPPRO_CRON_HOUR, défaut 7h00).
 *
 * Algorithme :
 *   1. Détecte tous les produits avec statut IN ('alerte','critique','rupture')
 *   2. Exclut ceux déjà couverts par un bon d'approvisionnement ouvert
 *      (statut IN 'brouillon','valide','commande') — même déduplication que
 *      stock-alerts.service.ts déclenché sur exécution de bon de sortie
 *   3. Crée un brouillon groupé APPRO-* si au moins un produit est concerné
 *   4. Notifie le responsable stock via WhatsApp (CallMeBot) — même canal que
 *      les autres crons internes (paie, équipements, devis)
 *   5. Trace l'exécution dans reappro_cron_log
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  INVARIANT IMMUABLE                                                     ║
 * ║  Ce service ne valide, n'exécute et n'envoie JAMAIS une commande        ║
 * ║  fournisseur. Tout bon créé reste en statut 'brouillon' jusqu'à        ║
 * ║  validation humaine par MAGASINIER ou MANAGER dans l'interface.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { supabaseAdmin } from '@forge/db'
import { notifyWhatsApp } from './email-queue.service'

const db = supabaseAdmin!

// ── Helpers ────────────────────────────────────────────────────────────────────

interface ProduitSousSeuilRow {
  id: string
  designation: string
  unite: string
  stock_actuel: number
  stock_min: number
  statut: 'alerte' | 'critique' | 'rupture'
  fournisseur: string | null
}

async function genererNumeroAppro(): Promise<string> {
  const today     = new Date()
  const yyyymmdd  = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('bons_approvisionnement')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `APPRO-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

async function dejaGenereAujourdhui(): Promise<boolean> {
  const today    = new Date().toISOString().slice(0, 10)
  const { count } = await db
    .from('reappro_cron_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00.000Z`)
  return (count ?? 0) > 0
}

async function logExecution(entry: {
  bon_appro_id:    string | null
  numero:          string | null
  nb_produits:     number
  produits_alertes: unknown[]
  notification_ok: boolean
}): Promise<void> {
  const { error } = await db.from('reappro_cron_log').insert(entry)
  if (error) console.error('[reappro-cron] log insert error:', error.message)
}

// ── Logique principale ─────────────────────────────────────────────────────────

export interface ReapproResult {
  created:     boolean
  bon_id?:     string
  numero?:     string
  nb_produits: number
  erreurs:     number
}

export async function lancerCronReappro(): Promise<ReapproResult> {
  const todayS = new Date().toISOString().slice(0, 10)
  console.info('[reappro-cron] démarrage scan —', todayS)

  // Garde anti-doublon : ne pas générer deux fois dans la même journée
  if (await dejaGenereAujourdhui()) {
    console.info('[reappro-cron] déjà exécuté aujourd\'hui — ignoré')
    return { created: false, nb_produits: 0, erreurs: 0 }
  }

  // ── 1. Produits effectivement sous seuil ──────────────────────────────────
  const { data: produits, error: fetchErr } = await db
    .from('produits')
    .select('id, designation, unite, stock_actuel, stock_min, statut, fournisseur')
    .in('statut', ['alerte', 'critique', 'rupture'])
    .order('statut')  // rupture en premier, puis critique, puis alerte

  if (fetchErr) {
    console.error('[reappro-cron] lecture produits:', fetchErr.message)
    return { created: false, nb_produits: 0, erreurs: 1 }
  }

  if (!produits || produits.length === 0) {
    console.info('[reappro-cron] aucun produit sous seuil — rien à faire')
    await logExecution({
      bon_appro_id:    null,
      numero:          null,
      nb_produits:     0,
      produits_alertes: [],
      notification_ok: false,
    })
    return { created: false, nb_produits: 0, erreurs: 0 }
  }

  // ── 2. Déduplication : produits déjà couverts par un bon ouvert ───────────
  const alreadyCovered = new Set<string>()

  const { data: openBons } = await db
    .from('bons_approvisionnement')
    .select('id')
    .in('statut', ['brouillon', 'valide', 'commande'])

  if (openBons && openBons.length > 0) {
    const openIds = (openBons as Array<{ id: string }>).map(b => b.id)
    const { data: coveredLignes } = await db
      .from('bons_approvisionnement_lignes')
      .select('produit_id')
      .in('bon_id', openIds)
      .in('produit_id', (produits as ProduitSousSeuilRow[]).map(p => p.id))

    for (const l of (coveredLignes ?? []) as Array<{ produit_id: string }>) {
      alreadyCovered.add(l.produit_id)
    }
  }

  const toOrder = (produits as ProduitSousSeuilRow[]).filter(p => !alreadyCovered.has(p.id))

  if (toOrder.length === 0) {
    console.info('[reappro-cron] tous les produits sous seuil sont déjà couverts par un appro ouvert')
    await logExecution({
      bon_appro_id:    null,
      numero:          null,
      nb_produits:     0,
      produits_alertes: [],
      notification_ok: false,
    })
    return { created: false, nb_produits: 0, erreurs: 0 }
  }

  // ── 3. Créer le bon d'approvisionnement brouillon ─────────────────────────
  // INVARIANT : statut = 'brouillon' uniquement. Ce code ne contient aucun
  // appel à valider, executer, commande ou équivalent.
  const numero = await genererNumeroAppro()

  // Récupérer un userId système (premier admin/manager actif)
  const { data: adminRow } = await db
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'superviseur'])
    .eq('actif', true)
    .limit(1)
    .single()
  const systemUserId = (adminRow as { id: string } | null)?.id ?? null

  const { data: bon, error: bonErr } = await db
    .from('bons_approvisionnement')
    .insert({
      numero,
      statut:        'brouillon',   // INVARIANT — jamais autre chose ici
      bon_sortie_id: null,          // généré par cron, pas par un bon de sortie
      notes:         'Généré automatiquement par le cron de réapprovisionnement quotidien',
      created_by:    systemUserId,
      sync_status:   'synced',
    })
    .select()
    .single()

  if (bonErr || !bon) {
    console.error('[reappro-cron] création bon:', bonErr?.message)
    return { created: false, nb_produits: 0, erreurs: 1 }
  }

  const bonId = (bon as { id: string }).id

  const lignes = toOrder.map(p => ({
    bon_id:               bonId,
    produit_id:           p.id,
    designation:          p.designation,
    unite:                p.unite,
    quantite_a_commander: Math.max(1, Math.ceil(p.stock_min - p.stock_actuel)),
    stock_actuel_snap:    p.stock_actuel,
    stock_min_snap:       p.stock_min,
    statut_alerte:        p.statut,
    fournisseur:          p.fournisseur ?? null,
  }))

  const { error: lignesErr } = await db.from('bons_approvisionnement_lignes').insert(lignes)
  if (lignesErr) {
    // Rollback du bon orphelin
    await db.from('bons_approvisionnement').delete().eq('id', bonId)
    console.error('[reappro-cron] insertion lignes:', lignesErr.message)
    return { created: false, nb_produits: 0, erreurs: 1 }
  }

  console.info(`[reappro-cron] ✅ bon appro ${numero} créé — ${toOrder.length} produit(s) sous seuil`)

  // ── 4. Notification WhatsApp responsable stock ────────────────────────────
  const phone = process.env.RESPONSABLE_STOCK_PHONE ?? process.env.DIRECTEUR_WHATSAPP_PHONE ?? ''

  const statutCounts = {
    rupture:  toOrder.filter(p => p.statut === 'rupture').length,
    critique: toOrder.filter(p => p.statut === 'critique').length,
    alerte:   toOrder.filter(p => p.statut === 'alerte').length,
  }

  const listeStr = toOrder
    .slice(0, 10)
    .map(p => `• ${p.designation} (${p.statut === 'rupture' ? '⛔ rupture' : p.statut === 'critique' ? '🔴 critique' : '🟠 alerte'}) — stock: ${p.stock_actuel} / min: ${p.stock_min}`)
    .join('\n')

  const message =
    `📦 Réapprovisionnement TAFDIL\n\n` +
    `Scan du ${todayS} : *${toOrder.length} produit(s)* sous seuil détecté(s).\n` +
    (statutCounts.rupture > 0 ? `⛔ Rupture : ${statutCounts.rupture}\n` : '') +
    (statutCounts.critique > 0 ? `🔴 Critique : ${statutCounts.critique}\n` : '') +
    (statutCounts.alerte > 0 ? `🟠 Alerte : ${statutCounts.alerte}\n` : '') +
    `\n${listeStr}` +
    (toOrder.length > 10 ? `\n… +${toOrder.length - 10} autre(s)` : '') +
    `\n\nBon brouillon *${numero}* en attente de validation.\nConnectez-vous à FORGE pour valider.`

  let notifOk = false
  try {
    await notifyWhatsApp(phone, message)
    notifOk = true
    console.info('[reappro-cron] notification WhatsApp envoyée')
  } catch (e) {
    console.warn('[reappro-cron] notification WhatsApp échouée:', (e as Error).message)
  }

  // ── 5. Trace ──────────────────────────────────────────────────────────────
  await logExecution({
    bon_appro_id:    bonId,
    numero,
    nb_produits:     toOrder.length,
    produits_alertes: toOrder.map(p => ({
      id:           p.id,
      designation:  p.designation,
      statut:       p.statut,
      stock_actuel: p.stock_actuel,
      stock_min:    p.stock_min,
    })),
    notification_ok: notifOk,
  })

  return { created: true, bon_id: bonId, numero, nb_produits: toOrder.length, erreurs: 0 }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _cronTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Lance le cron de réapprovisionnement quotidien.
 * L'heure est configurable via REAPPRO_CRON_HOUR (défaut : 7).
 * Appelé une fois au démarrage depuis app.ts.
 */
export function demarrerCronReappro(): void {
  const heureCible = Math.min(23, Math.max(0, parseInt(process.env.REAPPRO_CRON_HOUR ?? '7', 10)))

  const planifier = () => {
    const now    = new Date()
    const target = new Date(now)
    target.setHours(heureCible, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)

    const delai = target.getTime() - now.getTime()
    const heure = target.toLocaleString('fr-CM', { timeZone: 'Africa/Douala' })
    console.info(`[reappro-cron] programmé pour ${heure} (dans ${Math.round(delai / 60000)} min)`)

    _cronTimer = setTimeout(async () => {
      await lancerCronReappro().catch(e => console.error('[reappro-cron] erreur:', e))
      planifier()   // re-programmer pour le lendemain
    }, delai)
  }

  planifier()
}

export function arreterCronReappro(): void {
  if (_cronTimer) { clearTimeout(_cronTimer); _cronTimer = null }
}
