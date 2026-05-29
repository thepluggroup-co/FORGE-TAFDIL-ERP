import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Send, BarChart2, FileText, Bell, AlertTriangle,
  AlertCircle, Info, Zap, MessageCircle, RefreshCw,
  ShoppingBag, TrendingUp, Package, Globe,
} from 'lucide-react'
import { PageHeader, Button } from '@forge/ui'
import { toast } from 'sonner'
import { useAiChat, useAiRecommandations, useAiAlertes } from '@/hooks/useAI'
import type { AiMessage, StockReco, AlerteIA } from '@/hooks/useAI'
import { useCommandesShop } from '@/hooks/useCommandesShop'
import { formatXAF } from '@/lib/utils'
import ShopPerformance from './intelligence/ShopPerformance'

type Tab = 'intelligence' | 'shop'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: Date
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'État des stocks critiques ?',
  'Clients avec crédits en retard ?',
  'Résumé de la semaine',
  'Commandes en retard ?',
]

const INITIAL_CONTENT = `Bonjour ! Je suis **FORGE AI**, votre assistant ERP pour TAFDIL.

Je peux analyser vos données de production, stocks, clients et finances pour vous fournir des insights actionnables.

Que souhaitez-vous analyser aujourd'hui ?`

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

// ── Widget wrapper ─────────────────────────────────────────────────────────────

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

// ── Chat Message ───────────────────────────────────────────────────────────────

const ChatMessage = React.memo(function ChatMessage({ msg }: { msg: Message }) {
  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
  )
})

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Intelligence() {
  const [tab, setTab] = useState<Tab>('intelligence')

  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'assistant', content: INITIAL_CONTENT, ts: new Date() },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)

  const [rapport, setRapport] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

  const aiChat          = useAiChat()
  const rapportMutation = useAiChat()
  const recommandations = useAiRecommandations()
  const alertes         = useAiAlertes()
  const { data: shopData } = useCommandesShop()

  const alertesList: AlerteIA[] = alertes.data?.alertes ?? []
  const recos: StockReco[] | null = recommandations.data?.recommandations ?? null

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

    const history: AiMessage[] = [...messages, userMsg].slice(-20).map((m) => ({ role: m.role, content: m.content }))

    aiChat.mutate(history, {
      onSuccess: (data) => {
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          ts: new Date(),
        }])
        setTyping(false)
      },
      onError: (err: Error) => {
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Désolé, une erreur est survenue : ${err.message}`,
          ts: new Date(),
        }])
        setTyping(false)
      },
    })
  }

  const analyserStocks = () => {
    void recommandations.refetch()
  }

  const genererRapport = () => {
    setGeneratingReport(true)
    setRapport(null)
    rapportMutation.mutate([{
      role: 'user',
      content: 'Génère un rapport hebdomadaire complet de TAFDIL incluant production, finance, stocks et RH.',
    }], {
      onSuccess: (data) => {
        setRapport(data.response)
        setGeneratingReport(false)
      },
      onError: () => setGeneratingReport(false),
    })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Intelligence FORGE"
        subtitle="Assistant IA · Recommandations · Rapports automatiques"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Intelligence' }]}
      />

      {/* ── Onglets ── */}
      <div className="flex gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1 w-fit">
        {([
          { key: 'intelligence', label: 'Intelligence IA', icon: Brain },
          { key: 'shop',        label: 'Performance Shop', icon: ShoppingBag },
        ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              tab === key
                ? 'bg-white text-[#C62828] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'shop' ? (
          <motion.div key="shop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <ShopPerformance />
          </motion.div>
        ) : (
          <motion.div key="intelligence" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Chat Assistant ── */}
        <Widget title="Assistant IA — FORGE AI" icon={<Brain className="h-4 w-4" />}>
          <div className="h-80 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50/50">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} msg={msg} />
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

          <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => sendMessage(q)} disabled={typing}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-[#C62828] hover:text-[#C62828] transition-colors bg-white disabled:opacity-40 disabled:cursor-not-allowed">
                {q}
              </button>
            ))}
          </div>

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
            {alertes.isLoading && (
              <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Chargement…
              </div>
            )}
            {!alertes.isLoading && alertesList.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Aucune alerte active.</p>
            )}
            {alertesList.map((a, i) => {
              const cfg = SEVERITE_CONFIG[a.severite] ?? SEVERITE_CONFIG.info
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
              <Button onClick={analyserStocks} disabled={recommandations.isFetching}>
                {recommandations.isFetching ? (
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

            {!recos && !recommandations.isFetching && (
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
                <Button variant="secondary" size="sm" onClick={() => toast.info('Envoi WhatsApp disponible prochainement')}>
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

      {/* ── Tableau de bord Shop ── */}
      <Widget title="Tableau de bord Shop — FORGE Shop" icon={<Globe className="h-4 w-4" />}>
        <div className="p-5">
          {shopData ? (
            <div className="space-y-4">
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'CA web ce mois', value: formatXAF(shopData.stats.ca_web_mois), icon: TrendingUp, color: '#1d4ed8' },
                  { label: 'Nouvelles aujourd\'hui', value: shopData.stats.nouvelles_ce_jour, icon: ShoppingBag, color: '#C62828' },
                  { label: 'En attente paiement', value: shopData.stats.en_attente_paiement, icon: Globe, color: '#d97706' },
                  { label: 'Commandes confirmées', value: shopData.stats.confirmees, icon: Package, color: '#15803d' },
                ].map((kpi) => {
                  const Icon = kpi.icon
                  return (
                    <div key={kpi.label} className="rounded-xl border border-gray-100 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs text-gray-400">{kpi.label}</span>
                        <div className="rounded-lg p-1.5" style={{ backgroundColor: `${kpi.color}15` }}>
                          <Icon size={13} style={{ color: kpi.color }} />
                        </div>
                      </div>
                      <p className="text-lg font-bold text-[#212121]">{kpi.value}</p>
                    </div>
                  )
                })}
              </div>

              {/* Top produits commandés */}
              {shopData.data.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-gray-400">Dernières commandes web</p>
                  <div className="space-y-1.5">
                    {shopData.data.slice(0, 5).map((cmd) => (
                      <div key={cmd.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                        <div>
                          <span className="font-mono text-xs font-semibold text-[#C62828]">{cmd.ref}</span>
                          <span className="ml-2 text-xs text-gray-500">{cmd.client_nom}</span>
                        </div>
                        <span className="text-xs font-semibold">{formatXAF(cmd.montant_ttc)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shopData.data.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucune commande web reçue.</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#C62828] border-t-transparent" />
            </div>
          )}
        </div>
      </Widget>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
