import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Check, ChevronRight } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, SlideOver, Button, EmptyState } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDateTime } from '@/lib/utils'
import { useBons, useCreateBon, useValidateBon, useExecuteBon } from '@/hooks/useBons'
import { useStocks } from '@/hooks/useStocks'
import { useEmployes } from '@/hooks/useRH'
import type { BonSortie as BonApi, BonLigne } from '@/hooks/useBons'

// ── Types ──────────────────────────────────────────────────────────────────────

type BonRecord = BonApi & Record<string, unknown>

type BonStatus = 'soumis' | 'valide' | 'execute'

const STEP_LABELS: Record<BonStatus, string> = { soumis: 'Soumis', valide: 'Validé', execute: 'Exécuté' }
const STEPS: BonStatus[] = ['soumis', 'valide', 'execute']

// ── Stepper ────────────────────────────────────────────────────────────────────

function WorkflowStepper({ status }: { status: BonStatus }) {
  const currentIdx = STEPS.indexOf(status)
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => (
        <React.Fragment key={step}>
          <div className="flex items-center gap-1">
            <div
              className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0"
              style={{ backgroundColor: i <= currentIdx ? '#C62828' : '#e5e7eb', color: i <= currentIdx ? '#fff' : '#9ca3af' }}
            >
              {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className="text-xs font-medium hidden sm:inline" style={{ color: i <= currentIdx ? '#C62828' : '#9ca3af' }}>
              {STEP_LABELS[step]}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <ChevronRight className="h-3 w-3 mx-0.5 shrink-0" style={{ color: i < currentIdx ? '#C62828' : '#d1d5db' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BonsSortie() {
  const [nouveauOpen, setNouveauOpen] = useState(false)

  const { data, isLoading } = useBons()
  const validateBon = useValidateBon()
  const executeBon  = useExecuteBon()

  const bons = (data?.data ?? []) as BonRecord[]
  const enAttente = bons.filter((b) => b.statut === 'soumis').length

  const COLUMNS: Column<BonRecord>[] = [
    {
      id: 'numero',
      header: 'Code',
      accessor: 'numero',
      render: (v) => <span className="font-mono text-sm font-semibold text-[#212121]">{v as string}</span>,
    },
    {
      id: 'technicien_nom',
      header: 'Demandeur',
      accessor: 'demandeur',
      render: (v) => {
        const nom = (v as string | null | undefined) ?? ''
        if (!nom) return <span className="text-xs text-gray-400 italic">—</span>
        return (
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold shrink-0"
              style={{ backgroundColor: '#C62828' }}
            >
              {nom.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm">{nom}</span>
          </div>
        )
      },
    },
    {
      id: 'statut_workflow',
      header: 'Workflow',
      accessor: 'statut',
      render: (v) => <WorkflowStepper status={v as BonStatus} />,
    },
    {
      id: 'badge',
      header: 'Statut',
      accessor: 'statut',
      render: (v) => <StatusBadge status={v as string} />,
    },
    {
      id: 'produits',
      header: 'Produits',
      accessor: 'lignes',
      sortable: false,
      render: (v) => {
        const lignes = (v as BonLigne[] | null | undefined) ?? []
        return (
          <div>
            <span className="text-sm font-medium">{lignes.length} article{lignes.length > 1 ? 's' : ''}</span>
            <div className="text-xs text-gray-400 truncate max-w-40">
              {lignes.map((l) => l.designation).join(', ')}
            </div>
          </div>
        )
      },
    },
    {
      id: 'cout_total_xaf',
      header: 'Montant',
      accessor: 'cout_total_xaf',
      render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span>,
    },
    {
      id: 'created_at',
      header: 'Date',
      accessor: 'created_at',
      render: (v) => <span className="text-xs text-gray-500">{formatDateTime(v as string)}</span>,
    },
    {
      id: 'actions',
      header: '',
      accessor: 'statut',
      sortable: false,
      render: (v, row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {v === 'soumis' && (
            <button
              disabled={validateBon.isPending}
              onClick={() => validateBon.mutate(row.id as string)}
              className="px-2 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              Valider
            </button>
          )}
          {v === 'valide' && (
            <button
              disabled={executeBon.isPending}
              onClick={() => {
                const code = window.prompt(`Entrez le code unique du bon ${row.numero as string} :`)
                if (code) executeBon.mutate({ id: row.id as string, code_unique: code })
              }}
              className="px-2 py-1 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
            >
              Exécuter
            </button>
          )}
        </div>
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
        title="Bons de Sortie"
        subtitle={enAttente > 0 ? `${enAttente} bon${enAttente > 1 ? 's' : ''} en attente de validation` : 'Aucun bon en attente'}
        breadcrumbs={[
          { label: 'FORGE', href: '/' },
          { label: 'Stocks', href: '/stocks' },
          { label: 'Bons de sortie' },
        ]}
        actions={
          <Button size="sm" onClick={() => setNouveauOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nouveau Bon
          </Button>
        }
      />

      <DataTable<BonRecord>
        columns={COLUMNS}
        data={bons}
        keyField="id"
        loading={isLoading}
      />

      {nouveauOpen && <NouveauBonSlideOver open={nouveauOpen} onClose={() => setNouveauOpen(false)} />}
    </motion.div>
  )
}

// ── Nouveau bon form ───────────────────────────────────────────────────────────

function NouveauBonSlideOver({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: stocksData } = useStocks()
  const { data: empData }    = useEmployes()
  const createBon = useCreateBon()

  const produits   = stocksData?.data ?? []
  const techniciens = (empData?.data ?? []).map((e) => e.nom)

  const [form, setForm] = useState({
    technicien_nom: '',
    lignes: [{ produit_id: '', quantite: 1, unite: 'kg' }],
  })

  const addLigne    = () => setForm((f) => ({ ...f, lignes: [...f.lignes, { produit_id: '', quantite: 1, unite: 'kg' }] }))
  const removeLigne = (i: number) => setForm((f) => ({ ...f, lignes: f.lignes.filter((_, idx) => idx !== i) }))
  const updateLigne = (i: number, field: string, value: string | number) =>
    setForm((f) => ({ ...f, lignes: f.lignes.map((l, idx) => idx === i ? { ...l, [field]: value } : l) }))

  const valid = form.technicien_nom !== '' && form.lignes.every((l) => l.produit_id !== '' && l.quantite > 0)

  const handleSubmit = () => {
    const lignes = form.lignes.map((l) => {
      const produit = produits.find((p) => p.id === l.produit_id)
      return { produit_id: l.produit_id, quantite: l.quantite, unite: produit?.unite ?? l.unite }
    })
    createBon.mutate({ technicien_nom: form.technicien_nom, lignes }, { onSuccess: onClose })
  }

  return (
    <SlideOver isOpen={open} onClose={onClose} title="Nouveau bon de sortie" width="lg">
      <div className="space-y-5">
        {/* Technicien */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Technicien</label>
          <select
            value={form.technicien_nom}
            onChange={(e) => setForm((f) => ({ ...f, technicien_nom: e.target.value }))}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          >
            <option value="">Sélectionner...</option>
            {techniciens.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Lignes produits */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase">Produits</label>
            <button onClick={addLigne} className="text-xs text-[#C62828] hover:underline font-medium flex items-center gap-1">
              <Plus className="h-3 w-3" /> Ajouter
            </button>
          </div>
          <div className="space-y-2">
            {form.lignes.map((ligne, i) => {
              const produit = produits.find((p) => p.id === ligne.produit_id)
              return (
                <div key={i} className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 space-y-2">
                    <select
                      value={ligne.produit_id}
                      onChange={(e) => updateLigne(i, 'produit_id', e.target.value)}
                      className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    >
                      <option value="">Produit...</option>
                      {produits.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.designation} — {p.stock_actuel} {p.unite}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        min="1"
                        max={produit?.stock_actuel}
                        value={ligne.quantite}
                        onChange={(e) => updateLigne(i, 'quantite', Math.max(1, Number(e.target.value)))}
                        className="w-20 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                      <span className="text-xs text-gray-400">{produit?.unite ?? '—'}</span>
                    </div>
                  </div>
                  {form.lignes.length > 1 && (
                    <button onClick={() => removeLigne(i)} className="text-gray-300 hover:text-[#C62828] transition-colors mt-1">
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button className="flex-1" disabled={!valid || createBon.isPending} onClick={handleSubmit}>
            {createBon.isPending ? 'Envoi…' : 'Soumettre le bon'}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}
