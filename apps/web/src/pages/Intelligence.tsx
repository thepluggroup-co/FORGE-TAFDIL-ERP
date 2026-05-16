import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Send, BarChart2, FileText, Bell, AlertTriangle,
  AlertCircle, Info, Zap, MessageCircle, RefreshCw,
} from 'lucide-react'
import { PageHeader, Button } from '@forge/ui'
import { formatXAF } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: Date
}

interface StockReco {
  produit: string; urgence: 'critique' | 'important' | 'conseil'
  message: string; action: string
}

interface AlerteIA {
  id: string; titre: string; description: string
  severite: 'critique' | 'alerte' | 'info'; icone: 'alert' | 'warning' | 'info' | 'zap'
  ts: string
}

// ── Mock AI responses ──────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'État des stocks critiques ?',
  'Clients avec crédits en retard ?',
  'Résumé de la semaine',
  'Commandes en retard ?',
]

const AI_RESPONSES: Record<string, string> = {
  default: `Bonjour ! Je suis **FORGE AI**, votre assistant ERP pour TAFDIL.

Je peux analyser vos données de production, stocks, clients et finances pour vous fournir des insights actionnables.

Que souhaitez-vous analyser aujourd'hui ?`,

  stocks: `## Analyse des stocks TAFDIL

**3 ruptures imminentes** détectées sur 10 produits suivis :

- **ALU-6060-T5** — Stock critique : 2 barres restantes (seuil : 10). Commande urgente chez ALCAM recommandée.
- **TOL-NOIR-2MM** — Niveau bas : 8 feuilles. Seuil d'alerte franchi.
- **ELEC-CÂBLE-6** — Stock épuisé depuis 3 jours. Blocage production possible.

**Montant estimé à commander : 485 000 FCFA**`,

  credits: `## Clients avec crédits en retard

**2 clients** présentent des impayés à recouvrer :

- **Fouda Jean** — 180 000 FCFA · Retard de 15 jours (échéance : 1er mai 2026)
- **Nguema Paul** — 20 000 FCFA · Retard de 16 jours (échéance : 30 avril 2026)

**Total à recouvrer : 200 000 FCFA**

Je recommande des relances WhatsApp personnalisées aujourd'hui.`,

  semaine: `## Rapport hebdomadaire — Semaine 20 / 2026

### Production
- **12 commandes** traitées — Taux de livraison dans les délais : **91,7 %**
- CMD-2026-045 (MAETUR) en retard de 2 jours

### Finance
- **CA hebdomadaire : 1 250 000 FCFA** (+12 % vs semaine précédente)
- 4 factures émises — 2 payées, 2 en attente
- Crédits échus à recouvrer : **200 000 FCFA**

### Stocks
- 3 alertes de rupture détectées
- 2 bons de réception validés

### RH
- Présence : **95 %** (1 absence maladie)
- **Mbarga Jean-Pierre** atteint niveau 5 — candidat recrutement`,

  commandes: `## Commandes en retard

**1 commande** présente un retard de livraison :

- **CMD-2026-045** (MAETUR) — Production démarrée le 10 mai, livraison prévue le 13 mai.
  Retard actuel : **3 jours**. Cause : pénurie tôles noires 2 mm.

### Actions recommandées
- Déclencher la commande de tôles (voir alerte stock)
- Informer MAETUR du décalage par WhatsApp
- Envisager une livraison partielle si possible`,
}

function pickResponse(q: string): string {
  const lower = q.toLowerCase()
  if (lower.includes('stock')) return AI_RESPONSES.stocks
  if (lower.includes('crédit') || lower.includes('retard') && lower.includes('client')) return AI_RESPONSES.credits
  if (lower.includes('semaine') || lower.includes('rapport') || lower.includes('résumé')) return AI_RESPONSES.semaine
  if (lower.includes('commande')) return AI_RESPONSES.commandes
  return `Je n'ai pas encore de données précises pour cette question, mais je peux analyser vos **stocks**, **crédits clients**, **commandes en retard** ou générer un **résumé hebdomadaire**. Essayez une de ces suggestions !`
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function renderMd(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('## '))
      return <h3 key={i} className="font-bold text-sm text-[#212121] mt-3 mb-1 first:mt-0">{line.slice(3)}</h3>
    if (line.startsWith('### '))
      return <h4 key={i} className="font-semibold text-xs text-[#37474F] uppercase tracking-wide mt-2 mb-0.5">{line.slice(4)}</h4>
    if (line.startsWith('- '))
      return <li key={i} className="ml-4 text-sm text-gray-700 list-disc">{inlineMd(line.slice(2))}</li>
    if (line.trim() === '')
      return <div key={i} className="h-1.5" />
    return <p key={i} className="text-sm text-gray-700">{inlineMd(line)}</p>
  })
}

function inlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="font-semibold text-[#212121]">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

// ── Mock stock recommendations ─────────────────────────────────────────────────

const INITIAL_RECOS: StockReco[] = [
  { produit: 'ALU-6060-T5', urgence: 'critique', message: 'Stock critique : 2 barres restantes sur 10 min.', action: 'Commander 50 barres chez ALCAM — ~245 000 FCFA' },
  { produit: 'TOL-NOIR-2MM', urgence: 'important', message: 'Niveau bas : 8 feuilles. Seuil d'alerte franchi.', action: 'Commander 30 feuilles — ~150 000 FCFA' },
  { produit: 'ELEC-CÂBLE-6', urgence: 'critique', message: 'Rupture de stock. Blocage production CNC.', action: 'Commander en urgence — ~90 000 FCFA' },
  { produit: 'VIS-INOX-M8', urgence: 'conseil', message: 'Consommation supérieure à la moyenne (+40 %).', action: 'Prévoir réapprovisionnement prochaine semaine' },
]

// ── Proactive alerts ───────────────────────────────────────────────────────────

const ALERTES: AlerteIA[] = [
  { id: '1', titre: 'Stock critique détecté', description: 'ALU-6060-T5 : 2 unités restantes. Production à risque dans 48 h.', severite: 'critique', icone: 'alert', ts: '2026-05-16 09:15' },
  { id: '2', titre: 'Crédit échu — Fouda Jean', description: '180 000 FCFA impayés depuis 15 jours. Relance recommandée.', severite: 'alerte', icone: 'warning', ts: '2026-05-16 08:30' },
  { id: '3', titre: 'Commande en retard', description: 'CMD-2026-045 (MAETUR) dépasse la date de livraison prévue de 3 jours.', severite: 'alerte', icone: 'warning', ts: '2026-05-15 17:00' },
  { id: '4', titre: 'Apprenant prêt au recrutement', description: 'Mbarga Jean-Pierre — Niveau 5, 9 mois de formation. Dossier disponible.', severite: 'info', icone: 'zap', ts: '2026-05-15 14:20' },
  { id: '5', titre: 'Déclaration TVA à soumettre', description: 'TVA mai 2026 — Échéance le 15 juin. Pensez à la préparer.', severite: 'info', icone: 'info', ts: '2026-05-14 09:00' },
]

const URGENCE_CONFIG = {
  critique: { color: '#dc2626', bg: '#fee2e2', border: '#fecaca', label: 'Critique' },
  important: { color: '#d97706', bg: '#fef3c7', border: '#fde68a', label: 'Important' },
  conseil:   { color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe', label: 'Conseil' },
}

const SEVERITE_CONFIG = {
  critique: { color: '#dc2626', bg: '#fee2e2', icon: AlertCircle },
  alerte:   { color: '#d97706', bg: '#fef3c7', icon: AlertTriangle },
  info:     { color: '#1d4ed8', bg: '#dbeafe', icon: Info },
}

// ── Typing indicator ───────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full bg-gray-300"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  )
}

// ── Widget wrappers ────────────────────────────────────────────────────────────

function Widget({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <span className="text-[#C62828]">{icon}</span>
        <h2 className="font-semibold text-sm text-[#212121]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Intelligence() {
  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'assistant', content: AI_RESPONSES.default, ts: new Date() },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)

  // Stock widget state
  const [recos, setRecos] = useState<StockReco[] | null>(null)
  const [analyzingStocks, setAnalyzingStocks] = useState(false)

  // Report widget state
  const [rapport, setRapport] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  const sendMessage = (text: string) => {
    const q = text.trim()
    if (!q) return
    setInput('')

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: q, ts: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setTyping(true)

    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: pickResponse(q),
        ts: new Date(),
      }
      setMessages((prev) => [...prev, aiMsg])
      setTyping(false)
    }, 1400 + Math.random() * 600)
  }

  const analyserStocks = () => {
    setAnalyzingStocks(true)
    setRecos(null)
    setTimeout(() => {
      setRecos(INITIAL_RECOS)
      setAnalyzingStocks(false)
    }, 1800)
  }

  const genererRapport = () => {
    setGeneratingReport(true)
    setRapport(null)
    setTimeout(() => {
      setRapport(AI_RESPONSES.semaine)
      setGeneratingReport(false)
    }, 2200)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Intelligence FORGE"
        subtitle="Assistant IA · Recommandations · Rapports automatiques"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Intelligence' }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Chat Assistant ── */}
        <Widget title="Assistant IA — FORGE AI" icon={<Brain className="h-4 w-4" />}>
          {/* Messages */}
          <div className="h-80 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50/50">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-[#C62828] flex items-center justify-center text-white shrink-0 mr-2 mt-0.5">
                    <Brain className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-[#C62828] text-white rounded-tr-sm'
                      : 'bg-white border border-gray-100 shadow-sm rounded-tl-sm'
                  }`}
                >
                  {msg.role === 'assistant' ? renderMd(msg.content) : msg.content}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-[#C62828] flex items-center justify-center text-white shrink-0 mr-2 mt-0.5">
                  <Brain className="h-3.5 w-3.5" />
                </div>
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-tl-sm">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          {/* Suggested questions */}
          <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => sendMessage(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-[#C62828] hover:text-[#C62828] transition-colors bg-white">
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-4 pb-4 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
              placeholder="Posez une question à FORGE AI…"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
            />
            <Button onClick={() => sendMessage(input)} disabled={!input.trim() || typing}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Widget>

        {/* ── Alertes Proactives ── */}
        <Widget title="Alertes proactives" icon={<Bell className="h-4 w-4" />}>
          <div className="p-4 space-y-3 max-h-[464px] overflow-y-auto">
            {ALERTES.map((a, i) => {
              const cfg = SEVERITE_CONFIG[a.severite]
              const Icon = cfg.icon
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="flex items-start gap-3 p-3 rounded-xl border"
                  style={{ backgroundColor: cfg.bg, borderColor: cfg.bg }}
                >
                  <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: cfg.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold" style={{ color: cfg.color }}>{a.titre}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{a.description}</div>
                    <div className="text-xs text-gray-400 mt-1">{a.ts}</div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </Widget>

        {/* ── Recommandations Stock ── */}
        <Widget title="Recommandations stock" icon={<BarChart2 className="h-4 w-4" />}>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Button onClick={analyserStocks} disabled={analyzingStocks}>
                {analyzingStocks ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Analyse en cours…</>
                ) : (
                  <><Zap className="h-3.5 w-3.5" /> Analyser les stocks</>
                )}
              </Button>
              {recos && <span className="text-xs text-gray-400">{recos.length} recommandation(s) générée(s)</span>}
            </div>

            <AnimatePresence>
              {recos && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                  {recos.map((r, i) => {
                    const cfg = URGENCE_CONFIG[r.urgence]
                    return (
                      <motion.div
                        key={r.produit}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="p-3 rounded-xl border"
                        style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs font-semibold text-gray-700">{r.produit}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ color: cfg.color, backgroundColor: `${cfg.color}20` }}>
                            {cfg.label.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">{r.message}</p>
                        <p className="text-xs font-semibold mt-1" style={{ color: cfg.color }}>→ {r.action}</p>
                      </motion.div>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {!recos && !analyzingStocks && (
              <p className="text-sm text-gray-400">Cliquez sur "Analyser les stocks" pour obtenir des recommandations basées sur vos niveaux actuels.</p>
            )}
          </div>
        </Widget>

        {/* ── Rapport Hebdomadaire ── */}
        <Widget title="Rapport hebdomadaire" icon={<FileText className="h-4 w-4" />}>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Button onClick={genererRapport} disabled={generatingReport}>
                {generatingReport ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Génération…</>
                ) : (
                  <><FileText className="h-3.5 w-3.5" /> Générer le rapport</>
                )}
              </Button>
              {rapport && (
                <Button variant="secondary" size="sm">
                  <MessageCircle className="h-3.5 w-3.5" /> Envoyer WhatsApp
                </Button>
              )}
            </div>

            <AnimatePresence>
              {rapport && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gray-50 rounded-xl border border-gray-200 p-4 max-h-72 overflow-y-auto space-y-1"
                >
                  {renderMd(rapport)}
                </motion.div>
              )}
            </AnimatePresence>

            {!rapport && !generatingReport && (
              <p className="text-sm text-gray-400">Le rapport synthétise automatiquement la production, finances, stocks et RH de la semaine.</p>
            )}
          </div>
        </Widget>
      </div>
    </motion.div>
  )
}
