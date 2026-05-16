import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import cron from 'node-cron'
import { supabase } from '@forge/db'
import { anthropic, FORGE_MODEL } from '@forge/ai'
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

// ── Contexte live FORGE ────────────────────────────────────────────────────────

interface ForgeContext {
  produits_critiques: unknown[]
  credits_echus: { count: number; montant_total_xaf: number; liste: unknown[] }
  commandes_en_cours: { count: number; valeur_xaf: number }
  ca_mois_en_cours_xaf: number
  ca_mois_precedent_xaf: number
  date_contexte: string
}

async function fetchForgeContext(): Promise<ForgeContext> {
  const today    = new Date()
  const debutMois = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const debutMoisPrec = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)
  const finMoisPrec   = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10)

  const [critiqueRes, creditsRes, commandesRes, caMoisRes, caPrecRes] = await Promise.allSettled([
    supabase.from('produits').select('ref, designation, stock_actuel, stock_critique, stock_min, statut, categorie')
      .in('statut', ['critique', 'rupture']).order('stock_actuel').limit(5),
    supabase.from('credits').select('numero, client_nom, montant_xaf, solde_restant_xaf, echeance, statut')
      .or(`statut.eq.echu,and(statut.eq.en_cours,echeance.lt.${today.toISOString().slice(0, 10)})`),
    supabase.from('commandes').select('id, total_ttc_xaf').in('statut', ['confirmed', 'in_production', 'pret']),
    supabase.from('factures').select('total_ttc_xaf').eq('statut', 'paye').gte('date_emission', debutMois),
    supabase.from('factures').select('total_ttc_xaf').eq('statut', 'paye').gte('date_emission', debutMoisPrec).lte('date_emission', finMoisPrec),
  ])

  const critiques = critiqueRes.status === 'fulfilled' ? (critiqueRes.value.data ?? []) : []
  const credits   = creditsRes.status  === 'fulfilled' ? (creditsRes.value.data ?? [])  : []
  const commandes = commandesRes.status === 'fulfilled' ? (commandesRes.value.data ?? []) : []
  const caMois    = caMoisRes.status    === 'fulfilled' ? (caMoisRes.value.data ?? [])    : []
  const caPrec    = caPrecRes.status    === 'fulfilled' ? (caPrecRes.value.data ?? [])    : []

  type Fin = { total_ttc_xaf: number }

  return {
    produits_critiques: critiques,
    credits_echus: {
      count:             credits.length,
      montant_total_xaf: (credits as Array<{ solde_restant_xaf: number }>).reduce((s, c) => s + c.solde_restant_xaf, 0),
      liste:             credits,
    },
    commandes_en_cours: {
      count:      commandes.length,
      valeur_xaf: (commandes as Array<{ total_ttc_xaf: number }>).reduce((s, c) => s + c.total_ttc_xaf, 0),
    },
    ca_mois_en_cours_xaf:  (caMois as Fin[]).reduce((s, f) => s + f.total_ttc_xaf, 0),
    ca_mois_precedent_xaf: (caPrec as Fin[]).reduce((s, f) => s + f.total_ttc_xaf, 0),
    date_contexte:         today.toISOString(),
  }
}

// ── System prompt avec contexte live ──────────────────────────────────────────

function buildSystemPrompt(ctx: ForgeContext): string {
  return `Tu es l'assistant IA de FORGE, l'ERP de TAFDIL, microusine métallurgique à Douala, Cameroun.
Réponds TOUJOURS en français. Sois concis et actionnable. La devise est le FCFA (XAF).

Données actuelles de l'entreprise (${ctx.date_contexte}) :
${JSON.stringify({
  produits_critiques:   ctx.produits_critiques,
  credits_echus:        ctx.credits_echus,
  commandes_en_cours:   ctx.commandes_en_cours,
  ca_mois_en_cours_xaf: ctx.ca_mois_en_cours_xaf,
  ca_mois_precedent_xaf: ctx.ca_mois_precedent_xaf,
}, null, 2)}`
}

// ── Envoi WhatsApp CallMeBot ───────────────────────────────────────────────────

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const apiKey = process.env.CALLMEBOT_APIKEY ?? ''
  if (!apiKey || !phone) return

  const url = new URL('https://api.callmebot.com/whatsapp.php')
  url.searchParams.set('phone',  phone)
  url.searchParams.set('text',   message)
  url.searchParams.set('apikey', apiKey)

  try {
    await fetch(url.toString())
  } catch (e) {
    console.error('[ai] WhatsApp send error:', e)
  }
}

// ── Rapport hebdomadaire ───────────────────────────────────────────────────────

async function genererRapportHebdo(): Promise<string> {
  const ctx = await fetchForgeContext()

  // KPIs semaine
  const lundi = new Date()
  lundi.setDate(lundi.getDate() - lundi.getDay() + 1)
  const lundiStr = lundi.toISOString().slice(0, 10)

  const [commandesSemRes, facturesSemRes, bonsSemRes, mouvSemRes] = await Promise.allSettled([
    supabase.from('commandes').select('id, total_ttc_xaf, statut').gte('created_at', lundiStr),
    supabase.from('factures').select('id, total_ttc_xaf').eq('statut', 'paye').gte('date_emission', lundiStr),
    supabase.from('bons_sortie').select('id, statut').gte('created_at', lundiStr),
    supabase.from('mouvements_stock').select('id, type').gte('created_at', lundiStr),
  ])

  const commandesSem = commandesSemRes.status === 'fulfilled' ? (commandesSemRes.value.data ?? []) : []
  const facturesSem  = facturesSemRes.status  === 'fulfilled' ? (facturesSemRes.value.data ?? [])  : []
  const bonsSem      = bonsSemRes.status       === 'fulfilled' ? (bonsSemRes.value.data ?? [])      : []
  const mouvSem      = mouvSemRes.status       === 'fulfilled' ? (mouvSemRes.value.data ?? [])      : []

  const kpis = {
    semaine_du: lundiStr,
    nouvelles_commandes:  commandesSem.length,
    ca_facture_xaf:       (facturesSem as Array<{ total_ttc_xaf: number }>).reduce((s, f) => s + f.total_ttc_xaf, 0),
    bons_sortie:          bonsSem.length,
    mouvements_stock:     mouvSem.length,
    produits_critiques:   ctx.produits_critiques.length,
    credits_echus_xaf:    ctx.credits_echus.montant_total_xaf,
    ca_mois_en_cours_xaf: ctx.ca_mois_en_cours_xaf,
    variation_ca_pct:     ctx.ca_mois_precedent_xaf > 0
      ? Math.round((ctx.ca_mois_en_cours_xaf - ctx.ca_mois_precedent_xaf) / ctx.ca_mois_precedent_xaf * 100)
      : null,
  }

  const prompt = `Génère un rapport hebdomadaire concis pour le directeur de TAFDIL.
KPIs de la semaine : ${JSON.stringify(kpis, null, 2)}
Format : bullet points structurés, max 400 mots, mets en évidence les alertes urgentes.`

  const response = await anthropic.messages.create({
    model:      FORGE_MODEL,
    max_tokens: 800,
    temperature: 0.3,
    system:     buildSystemPrompt(ctx),
    messages:   [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  return block.type === 'text' ? block.text : ''
}

// ── Cron : rapport lundi 8h WAT (UTC+1) ───────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 7 * * 1', async () => {   // 7h UTC = 8h WAT
    console.info('[ai-cron] Génération rapport hebdomadaire...')
    try {
      const rapport  = await genererRapportHebdo()
      const directeurPhone = process.env.DIRECTEUR_WHATSAPP_PHONE ?? ''
      if (directeurPhone) {
        await sendWhatsApp(directeurPhone, `📊 Rapport FORGE — Semaine du ${new Date().toLocaleDateString('fr-FR')}\n\n${rapport}`)
      }
      console.info('[ai-cron] Rapport envoyé.')
    } catch (e) {
      console.error('[ai-cron] Erreur rapport:', e)
    }
  })
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
  })).default([]),
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /ai/chat — Chat avec contexte live
// ══════════════════════════════════════════════════════════════════════════════

router.post('/ai/chat', zValidator('json', chatSchema), async (c) => {
  const body = c.req.valid('json')

  let ctx: ForgeContext | null = null
  try {
    ctx = await fetchForgeContext()
  } catch {
    // Contexte non bloquant
  }

  const systemPrompt = ctx ? buildSystemPrompt(ctx) :
    `Tu es l'assistant IA de FORGE, ERP de TAFDIL (microusine métallurgique, Douala, Cameroun). Réponds en français.`

  const response = await anthropic.messages.create({
    model:       FORGE_MODEL,
    max_tokens:  1500,
    temperature: 0.3,
    system:      systemPrompt,
    messages: [
      ...body.history,
      { role: 'user', content: body.message },
    ],
  })

  const block = response.content[0]
  const reply = block.type === 'text' ? block.text : ''

  return c.json({
    reply,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    contexte_charge: ctx !== null,
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /ai/recommandations/stock
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ai/recommandations/stock', requireRole(['directeur', 'admin']), async (c) => {
  const since90j = new Date(Date.now() - 90 * 86400000).toISOString()

  const [produitsRes, mouvRes] = await Promise.all([
    supabase.from('produits').select('id, ref, designation, categorie, stock_actuel, stock_min, stock_critique, prix_unitaire_xaf, statut'),
    supabase.from('mouvements_stock').select('produit_id, type, quantite, created_at').gte('created_at', since90j),
  ])

  if (produitsRes.error) return c.json({ error: produitsRes.error.message }, 500)

  type Prod = { id: string; ref: string; designation: string; categorie: string; stock_actuel: number; stock_min: number; stock_critique: number; prix_unitaire_xaf: number; statut: string }
  type Mouv = { produit_id: string; type: string; quantite: number }

  const produits  = (produitsRes.data ?? []) as Prod[]
  const mouvements = (mouvRes.data ?? []) as Mouv[]

  // Calcul consommation par produit
  const consoMap = new Map<string, number>()
  for (const m of mouvements) {
    if (m.type === 'sortie') {
      consoMap.set(m.produit_id, (consoMap.get(m.produit_id) ?? 0) + m.quantite)
    }
  }

  const produitsAvecConso = produits.map(p => ({
    ...p,
    consommation_90j: consoMap.get(p.id) ?? 0,
    consommation_mois: Math.round((consoMap.get(p.id) ?? 0) / 3 * 10) / 10,
  }))

  const prompt = `Analyse l'état des stocks de TAFDIL et retourne UNIQUEMENT un tableau JSON valide.
Données produits (${produitsAvecConso.length} références) :
${JSON.stringify(produitsAvecConso, null, 2)}

Retourne STRICTEMENT ce format JSON (tableau, aucun texte avant/après) :
[
  {
    "produit_id": "...",
    "nom": "...",
    "quantite_suggeree": 50,
    "urgence": "critique" | "important" | "conseil",
    "raison": "explication courte"
  }
]
Inclure seulement les produits qui nécessitent une action. Maximum 10 recommandations.`

  const response = await anthropic.messages.create({
    model:       FORGE_MODEL,
    max_tokens:  1500,
    temperature: 0.1,
    messages:    [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  const text  = block.type === 'text' ? block.text : '[]'

  let recommandations: unknown[] = []
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) recommandations = JSON.parse(jsonMatch[0])
  } catch {
    recommandations = []
  }

  return c.json({
    recommandations,
    nb_produits_analyses: produits.length,
    periode_analyse:      '90 derniers jours',
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /ai/rapport-hebdo — Déclenchement manuel
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ai/rapport-hebdo', requireRole(['directeur']), async (c) => {
  const rapport       = await genererRapportHebdo()
  const envoiWhatsApp = c.req.query('whatsapp') === 'true'

  if (envoiWhatsApp) {
    const phone = c.req.query('phone') ?? process.env.DIRECTEUR_WHATSAPP_PHONE ?? ''
    if (phone) {
      await sendWhatsApp(phone, `📊 Rapport FORGE\n${new Date().toLocaleDateString('fr-FR')}\n\n${rapport}`)
    }
  }

  return c.json({ rapport, envoye_whatsapp: envoiWhatsApp })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /ai/alertes — Agrégation intelligente de toutes les alertes
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ai/alertes', async (c) => {
  const today  = new Date().toISOString().slice(0, 10)
  const in7j   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const in30j  = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  const [stocksRes, creditsRes, commandesRes, machinesRes, capteursRes] = await Promise.allSettled([
    supabase.from('produits').select('id, ref, designation, stock_actuel, stock_critique, statut').in('statut', ['critique', 'rupture', 'alerte']),
    supabase.from('credits').select('id, numero, client_nom, solde_restant_xaf, echeance, statut').or(`statut.eq.echu,and(statut.eq.en_cours,echeance.lte.${in7j})`),
    supabase.from('commandes').select('id, numero, client_nom, statut, date_livraison_prevue').in('statut', ['confirmed', 'in_production', 'pret']).lte('date_livraison_prevue', in7j).not('date_livraison_prevue', 'is', null),
    supabase.from('machines').select('id, nom, statut, prochaine_maintenance').in('statut', ['maintenance', 'panne']),
    supabase.from('capteurs_iot').select('id, nom, zone, statut, batterie_pct').or('statut.eq.alerte,statut.eq.hors_ligne,batterie_pct.lte.20'),
  ])

  type Alerte = {
    id:       string
    module:   string
    urgence:  'critique' | 'important' | 'info'
    titre:    string
    message:  string
    lien?:    string
  }

  const alertes: Alerte[] = []

  // Stocks
  for (const p of (stocksRes.status === 'fulfilled' ? stocksRes.value.data ?? [] : []) as Array<{ id: string; ref: string; designation: string; stock_actuel: number; statut: string }>) {
    alertes.push({
      id:      `stock-${p.id}`,
      module:  'stocks',
      urgence: p.statut === 'rupture' ? 'critique' : p.statut === 'critique' ? 'important' : 'info',
      titre:   `Stock ${p.statut} — ${p.ref}`,
      message: `${p.designation} : ${p.stock_actuel} unité(s) restante(s)`,
      lien:    `/stocks/${p.id}`,
    })
  }

  // Crédits
  for (const cr of (creditsRes.status === 'fulfilled' ? creditsRes.value.data ?? [] : []) as Array<{ id: string; numero: string; client_nom: string; solde_restant_xaf: number; echeance: string; statut: string }>) {
    const echu = cr.statut === 'echu' || cr.echeance < today
    alertes.push({
      id:      `credit-${cr.id}`,
      module:  'finance',
      urgence: echu ? 'critique' : 'important',
      titre:   echu ? `Crédit échu — ${cr.numero}` : `Crédit expire bientôt — ${cr.numero}`,
      message: `${cr.client_nom} : ${cr.solde_restant_xaf.toLocaleString('fr-FR')} XAF — échéance ${cr.echeance}`,
      lien:    `/credits/${cr.id}`,
    })
  }

  // Commandes
  for (const cmd of (commandesRes.status === 'fulfilled' ? commandesRes.value.data ?? [] : []) as Array<{ id: string; numero: string; client_nom: string; statut: string; date_livraison_prevue: string }>) {
    alertes.push({
      id:      `commande-${cmd.id}`,
      module:  'commerce',
      urgence: cmd.date_livraison_prevue <= today ? 'critique' : 'important',
      titre:   `Livraison imminente — ${cmd.numero}`,
      message: `${cmd.client_nom} — statut : ${cmd.statut} — prévue le ${cmd.date_livraison_prevue}`,
      lien:    `/commandes/${cmd.id}`,
    })
  }

  // Machines
  for (const m of (machinesRes.status === 'fulfilled' ? machinesRes.value.data ?? [] : []) as Array<{ id: string; nom: string; statut: string; prochaine_maintenance: string | null }>) {
    alertes.push({
      id:      `machine-${m.id}`,
      module:  'production',
      urgence: m.statut === 'panne' ? 'critique' : 'important',
      titre:   `Machine ${m.statut} — ${m.nom}`,
      message: m.prochaine_maintenance ? `Prochaine maintenance : ${m.prochaine_maintenance}` : 'Aucune maintenance planifiée',
    })
  }

  // Capteurs IoT
  for (const cap of (capteursRes.status === 'fulfilled' ? capteursRes.value.data ?? [] : []) as Array<{ id: string; nom: string; zone: string; statut: string; batterie_pct: number }>) {
    alertes.push({
      id:      `iot-${cap.id}`,
      module:  'iot',
      urgence: cap.statut === 'hors_ligne' ? 'critique' : 'important',
      titre:   `Capteur ${cap.statut} — ${cap.nom}`,
      message: `Zone : ${cap.zone} — Batterie : ${cap.batterie_pct}%`,
    })
  }

  // Trier par urgence
  const SCORE: Record<string, number> = { critique: 3, important: 2, info: 1 }
  alertes.sort((a, b) => (SCORE[b.urgence] ?? 0) - (SCORE[a.urgence] ?? 0))

  return c.json({
    alertes,
    total:     alertes.length,
    critiques: alertes.filter(a => a.urgence === 'critique').length,
    importants: alertes.filter(a => a.urgence === 'important').length,
    par_module: Object.fromEntries(
      ['stocks', 'finance', 'commerce', 'production', 'iot'].map(m => [m, alertes.filter(a => a.module === m).length])
    ),
  })
})

export { router as aiRouter }
