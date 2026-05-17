import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  ShoppingBag, TrendingUp, Package, Globe, Eye, EyeOff,
  Edit2, Check, X, RefreshCw, FileText, Clock, CheckCircle2,
  Upload, Image as ImageIcon, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { formatXAF } from '@/lib/utils'
import { useShopAnalytics } from '@/hooks/useShopAnalytics'
import { useProduitsShop, useToggleVisibilite, useUpdatePrix } from '@/hooks/useProduitsShop'
import { useDevisWeb, useCreerDevisErp } from '@/hooks/useDevisWeb'
import type { CommandeShop } from '@/hooks/useCommandesShop'

// ── Palette constante ──────────────────────────────────────────────────────────

const RED       = '#C62828'
const RED_LIGHT = '#EF9A9A'
const DARK      = '#212121'
const STEEL     = '#37474F'

// ── Helpers ────────────────────────────────────────────────────────────────────

function moisCourt(mois: string): string {
  const [year, month] = mois.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('fr-CM', { month: 'short' })
}

function statutColor(statut: string): string {
  const map: Record<string, string> = {
    recue:          '#3b82f6',
    confirmee:      '#8b5cf6',
    en_preparation: '#f59e0b',
    expediee:       '#10b981',
    livree:         '#15803d',
    annulee:        '#ef4444',
  }
  return map[statut] ?? '#94a3b8'
}

function stockBadge(stock: number, min: number, critique: number) {
  if (stock <= 0)        return { label: 'Rupture', color: '#ef4444', bg: '#fee2e2' }
  if (stock <= critique) return { label: 'Critique', color: '#dc2626', bg: '#fee2e2' }
  if (stock <= min)      return { label: 'Alerte',   color: '#f59e0b', bg: '#fef3c7' }
  return                        { label: 'OK',       color: '#15803d', bg: '#dcfce7' }
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, color,
}: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}18` }}>
          <Icon size={13} style={{ color }} />
        </div>
      </div>
      <p className="text-lg font-bold" style={{ color: DARK }}>{value}</p>
    </div>
  )
}

// ── Tooltip recharts ───────────────────────────────────────────────────────────

function CaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-semibold text-gray-800">{formatXAF(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Prix inline editor ─────────────────────────────────────────────────────────

function PrixEditor({ id, prix }: { id: string; prix: number | null }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(String(prix ?? ''))
  const updatePrix            = useUpdatePrix()
  const inputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const save = () => {
    const n = Number(val)
    if (!isNaN(n) && n >= 0) {
      updatePrix.mutate({ id, prix: n }, { onSuccess: () => setEditing(false) })
    } else {
      toast.error('Prix invalide')
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className="w-24 rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-[#C62828] focus:outline-none"
        />
        <button onClick={save} className="text-green-600 hover:text-green-700">
          <Check size={13} />
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-[#C62828] group"
    >
      {prix != null ? formatXAF(prix) : <span className="text-gray-300 italic">—</span>}
      <Edit2 size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

// ── Photos réalisations ────────────────────────────────────────────────────────

function PhotosRealisation() {
  const [photos, setPhotos] = useState<{ id: string; url: string; alt: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadPhotos()
  }, [])

  const loadPhotos = async () => {
    const { data } = await supabase.storage.from('realisations').list('', {
      limit: 12, sortBy: { column: 'created_at', order: 'desc' },
    })
    if (!data) return
    const base = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/realisations`
    setPhotos(
      data
        .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
        .map((f) => ({
          id:  f.id ?? f.name,
          url: `${base}/${f.name}`,
          alt: f.name.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, ''),
        }))
    )
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const ext  = file.name.split('.').pop()
      const name = `realisation-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('realisations').upload(name, file)
      if (error) toast.error(`Erreur upload : ${file.name}`)
    }
    setUploading(false)
    await loadPhotos()
    toast.success(`${files.length} photo(s) uploadée(s)`)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-gray-400">Réalisations</p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-[#C62828] hover:text-[#C62828] transition disabled:opacity-50"
        >
          {uploading ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
          Ajouter
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 py-8 text-gray-300">
          <ImageIcon size={28} />
          <span className="text-xs">Aucune photo</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <img key={p.id} src={p.url} alt={p.alt}
              className="aspect-square w-full rounded-xl object-cover border border-gray-100" />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Flux commandes temps réel ──────────────────────────────────────────────────

function FluxCommandes() {
  const [commandes, setCommandes] = useState<CommandeShop[]>([])

  useEffect(() => {
    // Charger les 8 dernières
    void supabase
      .from('commandes_shop')
      .select('id, ref, client_nom, montant_ttc, statut_commande, created_at')
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setCommandes((data as CommandeShop[]) ?? []))

    // Écouter les nouvelles
    const channel = supabase
      .channel('flux-commandes-erp')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'commandes_shop',
      }, (payload) => {
        const cmd = payload.new as CommandeShop
        setCommandes((prev) => [cmd, ...prev].slice(0, 8))
        toast.info(`Nouvelle commande web : ${cmd.ref}`)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="space-y-1.5">
      {commandes.length === 0 && (
        <p className="py-4 text-center text-xs text-gray-400">Aucune commande web récente.</p>
      )}
      <AnimatePresence initial={false}>
        {commandes.map((cmd) => (
          <motion.div
            key={cmd.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statutColor(cmd.statut_commande) }}
              />
              <span className="font-mono text-xs font-semibold" style={{ color: RED }}>{cmd.ref}</span>
              <span className="text-xs text-gray-500 truncate max-w-[100px]">{cmd.client_nom}</span>
            </div>
            <span className="text-xs font-semibold text-gray-700">{formatXAF(cmd.montant_ttc)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── Gestion devis web ──────────────────────────────────────────────────────────

function GestionDevisWeb() {
  const { data: devisData, isLoading } = useDevisWeb()
  const creerDevis = useCreerDevisErp()
  const devisList  = devisData ?? []

  return (
    <div className="space-y-2">
      {isLoading && (
        <div className="flex items-center justify-center py-6 text-gray-400 text-xs">
          <RefreshCw size={13} className="animate-spin mr-2" /> Chargement…
        </div>
      )}
      {!isLoading && devisList.length === 0 && (
        <p className="py-4 text-center text-xs text-gray-400">Aucune demande de devis web.</p>
      )}
      <AnimatePresence>
        {devisList.map((d, i) => (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-xl border border-gray-100 bg-gray-50 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-gray-800">{d.nom}</span>
                  <span className="text-[10px] text-gray-400">{d.telephone}</span>
                </div>
                <p className="text-[11px] text-gray-500 line-clamp-2">{d.description}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {d.statut === 'nouvelle' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">Nouvelle</span>
                  )}
                  {d.statut === 'traitee' && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">
                      <CheckCircle2 size={9} /> Traitée
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {new Date(d.created_at).toLocaleDateString('fr-CM')}
                  </span>
                </div>
              </div>
              <div className="shrink-0 flex flex-col gap-1.5">
                {d.erp_devis_id ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-green-700">
                    <ExternalLink size={9} /> ERP créé
                  </span>
                ) : (
                  <button
                    onClick={() => creerDevis.mutate(d.id)}
                    disabled={creerDevis.isPending}
                    className="flex items-center gap-1 rounded-lg bg-[#C62828] px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {creerDevis.isPending ? <RefreshCw size={9} className="animate-spin" /> : <FileText size={9} />}
                    Créer devis ERP
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── Tableau produits shop ──────────────────────────────────────────────────────

function TableauProduitsShop() {
  const { data: produits, isLoading, refetch, isFetching } = useProduitsShop()
  const toggleVis = useToggleVisibilite()
  const [search, setSearch] = useState('')

  const filtered = (produits ?? []).filter(
    (p) =>
      !search ||
      p.nom.toLowerCase().includes(search.toLowerCase()) ||
      p.ref.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrer…"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:outline-none focus:border-[#C62828]"
        />
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:text-[#C62828] transition"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-gray-400 text-xs">
          <RefreshCw size={13} className="animate-spin mr-2" /> Chargement…
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500">Produit</th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-500">Stock</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500">Prix shop</th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-500">Visible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((p) => {
              const badge = stockBadge(p.stock_actuel, p.stock_min, p.stock_critique)
              return (
                <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-gray-800 truncate max-w-[160px]">{p.nom}</div>
                    <div className="font-mono text-[10px] text-gray-400">{p.ref}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ color: badge.color, backgroundColor: badge.bg }}
                    >
                      {p.stock_actuel} {p.unite}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <PrixEditor id={p.id} prix={p.prix_public} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleVis.mutate({ id: p.id, visible: !p.visible_shop })}
                      disabled={toggleVis.isPending}
                      title={p.visible_shop ? 'Masquer du shop' : 'Afficher sur le shop'}
                      className="transition-colors"
                    >
                      {p.visible_shop
                        ? <Eye size={14} style={{ color: RED }} />
                        : <EyeOff size={14} className="text-gray-300" />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="py-5 text-center text-xs text-gray-400">
            {search ? 'Aucun résultat.' : 'Aucun produit shop configuré.'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Widget wrapper local ───────────────────────────────────────────────────────

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
        <span style={{ color: RED }}>{icon}</span>
        <h3 className="text-sm font-semibold" style={{ color: DARK }}>{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export default function ShopPerformance() {
  const { data: analytics, isLoading: analyticsLoading, refetch } = useShopAnalytics()

  const kpis       = analytics?.kpis
  const caMensuel  = (analytics?.ca_mensuel ?? []).map((m) => ({
    ...m,
    moisCourt: moisCourt(m.mois),
  }))

  return (
    <div className="space-y-5">
      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {analyticsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 animate-pulse">
              <div className="h-3 w-24 rounded bg-gray-100 mb-3" />
              <div className="h-6 w-20 rounded bg-gray-200" />
            </div>
          ))
        ) : (
          <>
            <KpiCard label="Commandes aujourd'hui" value={kpis?.commandes_aujourd_hui ?? 0} icon={ShoppingBag} color={RED} />
            <KpiCard label="CA aujourd'hui" value={formatXAF(kpis?.ca_aujourd_hui ?? 0)} icon={TrendingUp} color="#1d4ed8" />
            <KpiCard label="Panier moyen" value={formatXAF(kpis?.panier_moyen ?? 0)} icon={Globe} color="#7c3aed" />
            <KpiCard label="CA ce mois" value={formatXAF(kpis?.ca_mois ?? 0)} icon={Package} color="#15803d" />
          </>
        )}
      </div>

      {/* ── CA Mensuel Chart ── */}
      <Panel
        title="CA mensuel — ERP vs Shop (6 mois)"
        icon={<TrendingUp size={14} />}
      >
        {caMensuel.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-gray-400">
            <RefreshCw size={13} className="animate-spin mr-2" /> Chargement…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={caMensuel} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="moisCourt" tick={{ fontSize: 11, fill: STEEL }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: STEEL }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip content={<CaTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: STEEL }}
              />
              <Bar dataKey="ca_erp"  name="CA ERP"  stackId="ca" fill={RED}       radius={[0, 0, 4, 4]} />
              <Bar dataKey="ca_shop" name="CA Shop" stackId="ca" fill={RED_LIGHT} radius={[4, 4, 0, 0]} />
              <Line dataKey="ca_total" name="Total" type="monotone" stroke={DARK} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* ── Grille 2 colonnes ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Flux commandes */}
        <Panel title="Flux commandes web" icon={<ShoppingBag size={14} />}>
          <FluxCommandes />
        </Panel>

        {/* Devis web */}
        <Panel title="Demandes de devis web" icon={<FileText size={14} />}>
          <GestionDevisWeb />
        </Panel>

        {/* Tableau produits */}
        <div className="lg:col-span-2">
          <Panel title="Produits shop — visibilité & prix" icon={<Package size={14} />}>
            <TableauProduitsShop />
          </Panel>
        </div>

        {/* Réalisations */}
        <Panel title="Photos réalisations" icon={<ImageIcon size={14} />}>
          <PhotosRealisation />
        </Panel>

        {/* Stock cross-platform */}
        <Panel title="Alertes stock cross-platform" icon={<AlertTriangle size={14} />}>
          <StockAlerts />
        </Panel>
      </div>
    </div>
  )
}

// ── Stock cross-platform alerts (Realtime) ─────────────────────────────────────

function StockAlerts() {
  const [alerts, setAlerts] = useState<Array<{
    id: string; nom: string; ref: string; stock: number; seuil: number; ts: Date
  }>>([])

  useEffect(() => {
    const channel = supabase
      .channel('stock-alerts-erp')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'produits',
      }, (payload) => {
        const p = payload.new as any
        const isShopVisible = true // nous allons juste filtrer côté UI après fetch
        if (p.stock_actuel <= p.stock_critique && isShopVisible) {
          setAlerts((prev) => [{
            id:     p.id,
            nom:    p.designation,
            ref:    p.ref,
            stock:  p.stock_actuel,
            seuil:  p.stock_critique,
            ts:     new Date(),
          }, ...prev].slice(0, 10))
          toast.warning(`Stock critique : ${p.designation} (${p.stock_actuel} restant)`)
        }
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="space-y-2">
      {alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-gray-300">
          <CheckCircle2 size={24} />
          <span className="text-xs">Aucune alerte stock en temps réel.</span>
          <span className="text-[10px] text-gray-300">Les alertes apparaissent ici dès qu'un stock passe en dessous du seuil critique.</span>
        </div>
      )}
      <AnimatePresence>
        {alerts.map((a) => (
          <motion.div
            key={`${a.id}-${a.ts.getTime()}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5"
          >
            <AlertTriangle size={14} className="shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-red-700 truncate">{a.nom}</div>
              <div className="text-[10px] text-red-500">
                {a.ref} — {a.stock} restant (seuil : {a.seuil})
              </div>
            </div>
            <span className="text-[10px] text-red-400 shrink-0">
              {a.ts.toLocaleTimeString('fr-CM', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
