import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ShoppingCart, AlertTriangle, ChevronDown, ChevronRight, Package, RefreshCw, Plus } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, EmptyState, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDateTime } from '@/lib/utils'
import { useBonsAppro, useUpdateStatutAppro, useCreerApproManuel } from '@/hooks/useBonsAppro'
import type { BonAppro, BonApproLigne, StatutAppro } from '@/hooks/useBonsAppro'
import { useStocks } from '@/hooks/useStocks'

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUT_LABELS: Record<StatutAppro, string> = {
  brouillon:   'Brouillon',
  valide:      'Validé',
  envoye:      'Envoyé',
  commande:    'Commandé',
  recu_partiel:'Reçu partiel',
  recu_total:  'Reçu total',
  recu:        'Reçu',
  annule:      'Annulé',
}

const NEXT_STATUT: Partial<Record<StatutAppro, StatutAppro>> = {
  brouillon: 'valide',
  valide:    'commande',
  commande:  'recu',
}

const ALERTE_COLORS: Record<string, string> = {
  rupture:  'text-red-700 bg-red-50 border-red-200',
  critique: 'text-orange-700 bg-orange-50 border-orange-200',
  alerte:   'text-yellow-700 bg-yellow-50 border-yellow-200',
}

type BonRecord = BonAppro & Record<string, unknown>
type Produit   = Record<string, unknown>

interface ApproForm {
  produitId:              string
  quantite:               number
  fournisseurNom:         string
  dateLivraisonSouhaitee: string
  notes:                  string
}

const DEFAULT_APPRO: ApproForm = {
  produitId: '', quantite: 1, fournisseurNom: '', dateLivraisonSouhaitee: '', notes: '',
}

// ── Ligne détail ───────────────────────────────────────────────────────────────

function LigneRow({ ligne }: { ligne: BonApproLigne }) {
  const colorClass = ALERTE_COLORS[ligne.statut_alerte] ?? ALERTE_COLORS.alerte
  return (
    <div className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg border bg-white">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#212121] truncate">{ligne.designation}</div>
        {ligne.fournisseur && (
          <div className="text-xs text-gray-400 mt-0.5">{ligne.fournisseur}</div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className={`text-xs font-semibold px-2 py-0.5 rounded border ${colorClass}`}>
          {ligne.statut_alerte.toUpperCase()}
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Stock actuel</div>
          <div className="text-sm font-bold text-[#C62828]">
            {ligne.stock_actuel_snap} / {ligne.stock_min_snap} {ligne.unite}
          </div>
        </div>
        <div className="text-right min-w-[4rem]">
          <div className="text-xs text-gray-500">À commander</div>
          <div className="text-sm font-bold text-[#212121]">
            {ligne.quantite_a_commander} {ligne.unite}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Panneau détail d'un bon ────────────────────────────────────────────────────

function BonDetail({ bon, onClose }: { bon: BonAppro; onClose: () => void }) {
  const updateStatut = useUpdateStatutAppro()
  const nextStatut   = NEXT_STATUT[bon.statut]

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 shrink-0">
        <div>
          <div className="font-mono text-sm font-bold text-[#212121]">{bon.numero}</div>
          <div className="text-xs text-gray-500 mt-0.5">{formatDateTime(bon.created_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={bon.statut} />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-500"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Lignes */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {bon.notes && (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg px-3 py-2">{bon.notes}</p>
        )}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {bon.bons_approvisionnement_lignes.length} produit(s) à réapprovisionner
        </div>
        {bon.bons_approvisionnement_lignes.map((ligne) => (
          <LigneRow key={ligne.id} ligne={ligne} />
        ))}
      </div>

      {/* Actions */}
      {nextStatut && bon.statut !== 'annule' && (
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex gap-3">
          <Button
            size="sm"
            onClick={() => updateStatut.mutate({ id: bon.id, statut: nextStatut })}
            disabled={updateStatut.isPending}
            className="flex-1"
          >
            {updateStatut.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Passer à « {STATUT_LABELS[nextStatut]} »
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateStatut.mutate({ id: bon.id, statut: 'annule' })}
            disabled={updateStatut.isPending}
            className="text-gray-500"
          >
            Annuler
          </Button>
        </div>
      )}
    </motion.div>
  )
}

// ── Filtres statut ─────────────────────────────────────────────────────────────

const FILTRE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',          label: 'Tous'      },
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'valide',    label: 'Validés'   },
  { value: 'commande',  label: 'Commandés' },
  { value: 'recu',      label: 'Reçus'     },
  { value: 'annule',    label: 'Annulés'   },
]

// ── Page principale ────────────────────────────────────────────────────────────

export default function BonsAppro() {
  const [statutFilter, setStatutFilter] = useState('')
  const [selected, setSelected]         = useState<BonAppro | null>(null)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [approOpen, setApproOpen]       = useState(false)
  const [approForm, setApproForm]       = useState<ApproForm>(DEFAULT_APPRO)

  const { data, isLoading }    = useBonsAppro(statutFilter ? { statut: statutFilter } : undefined)
  const { data: stocksData }   = useStocks()
  const creerAppro             = useCreerApproManuel()

  const bons    = (data?.data ?? []) as BonRecord[]
  const produits = (stocksData?.data ?? []) as unknown as Produit[]

  const openApproModal = useCallback((p?: Produit) => {
    const qteDefaut = p
      ? Math.max(1, Math.ceil((p.stock_min as number) - (p.stock_actuel as number)))
      : 1
    setApproForm({
      ...DEFAULT_APPRO,
      produitId:      (p?.id as string) ?? '',
      quantite:       qteDefaut,
      fournisseurNom: (p?.fournisseur as string | undefined) ?? '',
    })
    setApproOpen(true)
  }, [])

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const brouillons = bons.filter(b => b.statut === 'brouillon').length
  const enCours    = bons.filter(b => ['valide', 'commande'].includes(b.statut as string)).length

  const COLUMNS: Column<BonRecord>[] = [
    {
      id: 'expand',
      header: '',
      accessor: 'id',
      sortable: false,
      csvSkip: true,
      render: (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); toggle(row.id as string) }}
          className="p-1 rounded hover:bg-gray-100 text-gray-400"
        >
          {expanded.has(row.id as string)
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>
      ),
    },
    {
      id: 'numero',
      header: 'Numéro',
      accessor: 'numero',
      render: (v) => <span className="font-mono text-sm font-bold text-[#212121]">{v as string}</span>,
    },
    {
      id: 'statut',
      header: 'Statut',
      accessor: 'statut',
      render: (v) => <StatusBadge status={v as string} />,
    },
    {
      id: 'produits',
      header: 'Produits',
      accessor: 'bons_approvisionnement_lignes',
      sortable: false,
      render: (v) => {
        const lignes = (v as BonApproLigne[]) ?? []
        const nbRupture = lignes.filter(l => l.statut_alerte === 'rupture').length
        const nbCritique = lignes.filter(l => l.statut_alerte === 'critique').length
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{lignes.length} produit(s)</span>
            {nbRupture > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                {nbRupture} rupture{nbRupture > 1 ? 's' : ''}
              </span>
            )}
            {nbCritique > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                {nbCritique} critique{nbCritique > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'date',
      header: 'Créé le',
      accessor: 'created_at',
      render: (v) => <span className="text-xs text-gray-500">{formatDateTime(v as string)}</span>,
    },
    {
      id: 'actions',
      header: '',
      accessor: 'id',
      sortable: false,
      csvSkip: true,
      render: (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); setSelected(row as unknown as BonAppro) }}
          className="text-xs font-medium text-[#C62828] hover:underline"
        >
          Gérer →
        </button>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-6"
    >
      <PageHeader
        title="Bons d'approvisionnement"
        subtitle="Réapprovisionnements automatiques · TAFDIL"
        breadcrumbs={[
          { label: 'FORGE', href: '/' },
          { label: 'Stocks', href: '/stocks' },
          { label: 'Approvisionnement' },
        ]}
        actions={
          <Button size="sm" onClick={() => openApproModal()}>
            <Plus className="h-3.5 w-3.5" />
            Demander appro
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Total</div>
          <div className="text-2xl font-bold text-[#212121]">{data?.total ?? 0}</div>
        </div>
        <div className="bg-white border border-orange-200 rounded-xl p-4">
          <div className="text-xs text-orange-600 mb-1 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Brouillons
          </div>
          <div className="text-2xl font-bold text-orange-700">{brouillons}</div>
        </div>
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <div className="text-xs text-blue-600 mb-1 flex items-center gap-1">
            <ShoppingCart className="h-3.5 w-3.5" /> En cours
          </div>
          <div className="text-2xl font-bold text-blue-700">{enCours}</div>
        </div>
        <div className="bg-white border border-green-200 rounded-xl p-4">
          <div className="text-xs text-green-600 mb-1 flex items-center gap-1">
            <Package className="h-3.5 w-3.5" /> Reçus
          </div>
          <div className="text-2xl font-bold text-green-700">
            {bons.filter(b => b.statut === 'recu').length}
          </div>
        </div>
      </div>

      {/* Filtre */}
      <div className="flex gap-2 flex-wrap">
        {FILTRE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatutFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              statutFilter === opt.value
                ? 'bg-[#C62828] text-white border-[#C62828]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#C62828] hover:text-[#C62828]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table avec lignes expandables */}
      {bons.length === 0 && !isLoading ? (
        <EmptyState
          icon={<Package className="h-10 w-10 text-gray-300" />}
          title="Aucun bon d'approvisionnement"
          description="Ils sont créés automatiquement quand un stock passe sous son seuil minimum après l'exécution d'un bon de sortie."
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <DataTable
            columns={COLUMNS}
            data={bons}
            loading={isLoading}
            onRowClick={(row) => setSelected(row as unknown as BonAppro)}
          />
          {/* Lignes expandables sous chaque bon */}
          {expanded.size > 0 && bons
            .filter(b => expanded.has(b.id as string))
            .map(bon => (
              <div key={bon.id as string} className="border-t border-gray-100 px-6 py-4 bg-gray-50 space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Détail — {bon.numero as string}
                </div>
                {(bon.bons_approvisionnement_lignes as BonApproLigne[]).map(ligne => (
                  <LigneRow key={ligne.id} ligne={ligne} />
                ))}
              </div>
            ))
          }
        </div>
      )}

      {/* Panneau latéral */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelected(null)}
          />
          <BonDetail bon={selected} onClose={() => setSelected(null)} />
        </>
      )}

      {/* Modal — Demander un approvisionnement */}
      <Modal
        isOpen={approOpen}
        onClose={() => setApproOpen(false)}
        title="Demander un approvisionnement"
        size="md"
      >
        <div className="space-y-4">
          {/* Article */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Article *</label>
            <select
              value={approForm.produitId}
              onChange={(e) => {
                const p = produits.find(pr => pr.id === e.target.value)
                setApproForm(f => ({
                  ...f,
                  produitId:      e.target.value,
                  fournisseurNom: p ? (p.fournisseur as string | undefined) ?? '' : f.fournisseurNom,
                  quantite: p
                    ? Math.max(1, Math.ceil((p.stock_min as number) - (p.stock_actuel as number)))
                    : f.quantite,
                }))
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner un article…</option>
              {produits.map((p) => (
                <option key={p.id as string} value={p.id as string}>
                  {p.designation as string}
                  {['alerte', 'critique', 'rupture'].includes(p.statut as string) ? ' ⚠' : ''}
                  {' — stock: '}{p.stock_actuel as number} {p.unite as string}
                </option>
              ))}
            </select>
          </div>

          {/* Quantité */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité à commander *</label>
            <input
              type="number"
              min={1}
              value={approForm.quantite}
              onChange={(e) => setApproForm(f => ({ ...f, quantite: Math.max(1, Number(e.target.value)) }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
            {approForm.produitId && (() => {
              const p = produits.find(pr => pr.id === approForm.produitId)
              return p ? (
                <p className="text-xs text-gray-400 mt-1">
                  Stock actuel : {p.stock_actuel as number} — Seuil min : {p.stock_min as number} {p.unite as string}
                </p>
              ) : null
            })()}
          </div>

          {/* Fournisseur */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur</label>
            <input
              type="text"
              placeholder="Nom du fournisseur"
              value={approForm.fournisseurNom}
              onChange={(e) => setApproForm(f => ({ ...f, fournisseurNom: e.target.value }))}
              list="bonsappro-fournisseurs-list"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
            <datalist id="bonsappro-fournisseurs-list">
              {[...new Set(produits.map(p => p.fournisseur as string | undefined).filter(Boolean))]
                .map(f => <option key={f} value={f} />)}
            </datalist>
          </div>

          {/* Date livraison souhaitée */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de livraison souhaitée</label>
            <input
              type="date"
              value={approForm.dateLivraisonSouhaitee}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setApproForm(f => ({ ...f, dateLivraisonSouhaitee: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Instructions particulières, urgence, etc."
              value={approForm.notes}
              onChange={(e) => setApproForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setApproOpen(false)}>
              Annuler
            </Button>
            <Button
              className="flex-1"
              disabled={!approForm.produitId || approForm.quantite < 1 || creerAppro.isPending}
              loading={creerAppro.isPending}
              onClick={() => {
                creerAppro.mutate(
                  {
                    produit_id:               approForm.produitId,
                    quantite:                 approForm.quantite,
                    fournisseur_nom:          approForm.fournisseurNom || undefined,
                    date_livraison_souhaitee: approForm.dateLivraisonSouhaitee || undefined,
                    notes:                    approForm.notes || undefined,
                  },
                  {
                    onSuccess: () => { setApproOpen(false); setApproForm(DEFAULT_APPRO); setStatutFilter('') },
                  },
                )
              }}
            >
              {creerAppro.isPending ? 'Création…' : "Créer le bon d'appro"}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
