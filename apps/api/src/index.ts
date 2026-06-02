import { serve } from '@hono/node-server'
import cron from 'node-cron'
import { supabaseAdmin } from '@forge/db'
import app from './app'
import { processBatchEmails, notifyWhatsApp } from './services/email-queue.service'
import { genererBulletinsMois } from './routes/rh'

const db   = supabaseAdmin!
const port = Number(process.env.PORT ?? 3001)

// Startup diagnostics
console.log('[boot] SUPABASE_URL        :', process.env.SUPABASE_URL ? 'SET' : 'MISSING')
console.log('[boot] SUPABASE_ANON_KEY   :', process.env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING')
console.log('[boot] SERVICE_ROLE_KEY    :', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
console.log('[boot] supabaseAdmin       :', supabaseAdmin ? 'INITIALIZED' : 'NULL — routes will all 500')

// ── Cron 1 : Traitement batch emails (toutes les 4h) ────────────────────────
cron.schedule('0 */4 * * *', async () => {
  console.info('[cron] Traitement batch emails…')
  try {
    await processBatchEmails(5)
  } catch (e) {
    console.error('[cron] Erreur batch emails:', e)
  }
})

// ── Cron 2 : Alertes devis expirant (tous les matins 08h00) ─────────────────
cron.schedule('0 8 * * *', async () => {
  console.info('[cron] Vérification devis expirant…')
  try {
    const today    = new Date()
    const demain   = new Date(today); demain.setDate(today.getDate() + 1)
    const dans3j   = new Date(today); dans3j.setDate(today.getDate() + 3)
    const demainStr = demain.toISOString().slice(0, 10)
    const dans3jStr = dans3j.toISOString().slice(0, 10)

    const { data } = await db
      .from('devis')
      .select('id, numero, client_nom, date_validite, total_ttc_xaf')
      .eq('statut', 'envoye')
      .in('date_validite', [demainStr, dans3jStr])

    for (const d of data ?? []) {
      const dv = d as { id: string; numero: string; client_nom: string; date_validite: string; total_ttc_xaf: number }
      const joursRestants = Math.round(
        (new Date(dv.date_validite).getTime() - today.getTime()) / 86400000
      )

      const directeurEmail = process.env.DIRECTEUR_EMAIL ?? ''
      if (directeurEmail) {
        const { enqueueEmail } = await import('./services/email-queue.service')
        await enqueueEmail({
          destinataire:   directeurEmail,
          sujet:          `⚠️ Devis ${dv.numero} expire dans ${joursRestants}j`,
          corps_html:     `<p>Le devis <strong>${dv.numero}</strong> pour <strong>${dv.client_nom}</strong> (${dv.total_ttc_xaf.toLocaleString('fr-FR')} XAF) expire le ${dv.date_validite}.</p>`,
          priorite:       joursRestants <= 1 ? 'critique' : 'haute',
          reference_type: 'devis',
          reference_id:   dv.id,
        })
      }

      await notifyWhatsApp(
        process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
        `⚠️ Devis ${dv.numero} (${dv.client_nom}) expire dans ${joursRestants}j`,
      )
    }
    console.info(`[cron] ${(data ?? []).length} devis alertés`)
  } catch (e) {
    console.error('[cron] Erreur alertes devis:', e)
  }
})

// ── Cron 3 : Génération automatique paie (le 28 de chaque mois à 06h00) ─────
cron.schedule('0 6 28 * *', async () => {
  const mois = new Date().toISOString().slice(0, 7) // YYYY-MM
  console.info(`[cron] Génération automatique paie ${mois}…`)
  try {
    const { count } = await db
      .from('bulletins_paie')
      .select('*', { count: 'exact', head: true })
      .eq('mois', mois)

    if ((count ?? 0) > 0) {
      console.info(`[cron] Paie ${mois} déjà générée (${count} bulletins) — ignoré`)
      return
    }

    // Utiliser un userId système pour le cron (premier admin trouvé)
    const { data: admin } = await db
      .from('profiles')
      .select('id')
      .in('role', ['directeur', 'admin'])
      .eq('actif', true)
      .limit(1)
      .single()

    const systemUserId = (admin as { id: string } | null)?.id ?? 'system'
    const result = await genererBulletinsMois(mois, systemUserId, false)

    await notifyWhatsApp(
      process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
      `✅ Paie ${mois} générée automatiquement : ${result.bulletins.length} bulletins en attente de validation.\n` +
      `Masse salariale nette : ${result.recapitulatif.masse_salariale_nette_xaf.toLocaleString('fr-FR')} XAF`,
    )
    console.info(`[cron] Paie ${mois} : ${result.bulletins.length} bulletins générés`)
  } catch (e) {
    console.error('[cron] Erreur génération paie:', e)
  }
})

// ── Cron 4 : Alertes révision équipements (tous les lundis à 09h00) ──────────
cron.schedule('0 9 * * 1', async () => {
  console.info('[cron] Vérification révisions équipements…')
  try {
    const dans30j = new Date()
    dans30j.setDate(dans30j.getDate() + 30)
    const limitDate = dans30j.toISOString().slice(0, 10)

    const { data } = await db
      .from('equipements')
      .select('id, code, designation, prochaine_revision, statut')
      .lte('prochaine_revision', limitDate)
      .not('statut', 'eq', 'hors_service')

    if ((data ?? []).length > 0) {
      const liste = (data ?? [])
        .map((e: Record<string, unknown>) => `• ${e.code} — ${e.designation} (${e.prochaine_revision})`)
        .join('\n')

      await notifyWhatsApp(
        process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
        `🔧 ${(data ?? []).length} équipement(s) à réviser dans les 30 prochains jours :\n${liste}`,
      )
    }
  } catch (e) {
    console.error('[cron] Erreur alertes équipements:', e)
  }
})

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`FORGE API  →  http://localhost:${info.port}`)
})

export default app
