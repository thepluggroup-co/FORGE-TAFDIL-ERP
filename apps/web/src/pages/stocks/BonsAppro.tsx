import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Package,
  Plus,
  RefreshCw,
  Save,
  ShoppingCart,
} from 'lucide-react'
import { Button, DataTable, EmptyState, Modal, PageHeader } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDateTime } from '@/lib/utils'
import {
  useBonsAppro,
  useCreerApproManuel,
  useReceptionAppro,
  useUpdateApproDetails,
  useUpdateStatutAppro,
} from '@/hooks/useBonsAppro'
import type { BonAppro, BonApproLigne, StatutAppro } from '@/hooks/useBonsAppro'
import { useFournisseurs } from '@/hooks/useFournisseurs'
import { useStocks } from '@/hooks/useStocks'

const STATUT_LABELS: Record<StatutAppro, string> = {
  brouillon:    'Brouillon',
  valide:       'Valide',
  envoye:       'Envoye',
  commande:     'Commande',
  recu_partiel: 'Recu partiel',
  recu_total:   'Recu total',
  recu:         'Recu',
  annule:       'Annule',
}

const NEXT_STATUT: Partial<Record<StatutAppro, StatutAppro>> = {
  brouillon: 'valide',
  valide:    'envoye',
  envoye:    'commande',
}

const ALERTE_COLORS: Record<string, string> = {
  rupture:  'text-red-700 bg-red-50 border-red-200',
  critique: 'text-orange-700 bg-orange-50 border-orange-200',
  alerte:   'text-yellow-700 bg-yellow-50 border-yellow-200',
}

const FILTRE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',             label: 'Tous' },
  { value: 'brouillon',    label: 'Brouillon' },
  { value: 'valide',       label: 'Valides' },
  { value: 'envoye',       label: 'Envoyes' },
  { value: 'commande',     label: 'Commandes' },
  { value: 'recu_partiel', label: 'Recus partiels' },
  { value: 'recu_total',   label: 'Recus' },
  { value: 'annule',       label: 'Annules' },
]

type BonRecord = BonAppro & Record<string, unknown>
type Produit = Record<string, unknown>

interface ApproForm {
  produitId: string
  quantite: number
  fournisseurNom: string
  dateLivraisonSouhaitee: string
  notes: string
}

const DEFAULT_APPRO: ApproForm = {
  produitId: '',
  quantite: 1,
  fournisseurNom: '',
  dateLivraisonSouhaitee: '',
  notes: '',
}

function n(value: unknown) {
  return Number(value ?? 0)
}

function ApproStatusPill({ statut }: { statut: StatutAppro }) {
  const styles: Record<StatutAppro, string> = {
    brouillon:    'bg-orange-100 text-orange-700',
    valide:       'bg-blue-100 text-blue-700',
    envoye:       'bg-sky-100 text-sky-700',
    commande:     'bg-indigo-100 text-indigo-700',
    recu_partiel: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    recu_total:   'bg-green-100 text-green-700',
    recu:         'bg-green-100 text-green-700',
    annule:       'bg-gray-100 text-gray-600',
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles[statut]}`}>
      {STATUT_LABELS[statut]}
    </span>
  )
}

function LigneRow({ ligne }: { ligne: BonApproLigne }) {
  const colorClass = ALERTE_COLORS[ligne.statut_alerte] ?? ALERTE_COLORS.alerte
  return (
    <div className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg border bg-white">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#212121] truncate">{ligne.designation}</div>
        {ligne.fournisseur && <div className="text-xs text-gray-400 mt-0.5">{ligne.fournisseur}</div>}
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
          <div className="text-xs text-gray-500">A commander</div>
          <div className="text-sm font-bold text-[#212121]">{ligne.quantite_a_commander} {ligne.unite}</div>
        </div>
        <div className="text-right min-w-[4rem]">
          <div className="text-xs text-gray-500">Recu</div>
          <div className="text-sm font-bold text-emerald-700">{n(ligne.quantite_recue)} {ligne.unite}</div>
        </div>
      </div>
    </div>
  )
}

function BonDetail({
  bon,
  onClose,
  onChanged,
}: {
  bon: BonAppro
  onClose: () => void
  onChanged: (bon: BonAppro) => void
}) {
  const updateStatut = useUpdateStatutAppro()
  const updateDetails = useUpdateApproDetails()
  const reception = useReceptionAppro()
  const { data: fournisseurs = [] } = useFournisseurs()
  const nextStatut = NEXT_STATUT[bon.statut]
  const lignes = bon.bons_approvisionnement_lignes ?? []
  const receptionAllowed = ['valide', 'envoye', 'commande', 'recu_partiel'].includes(bon.statut)

  const [fournisseurId, setFournisseurId] = useState(bon.fournisseur_id ?? '')
  const [fournisseurNom, setFournisseurNom] = useState(bon.fournisseur_nom ?? '')
  const [dateLivraison, setDateLivraison] = useState(bon.date_livraison_souhaitee ?? '')
  const [notes, setNotes] = useState(bon.notes ?? '')
  const [quantites, setQuantites] = useState<Record<string, number>>({})
  const [quantitesRecues, setQuantitesRecues] = useState<Record<string, number>>({})
  const [commentaireReception, setCommentaireReception] = useState('')

  useEffect(() => {
    setFournisseurId(bon.fournisseur_id ?? '')
    setFournisseurNom(bon.fournisseur_nom ?? '')
    setDateLivraison(bon.date_livraison_souhaitee ?? '')
    setNotes(bon.notes ?? '')
    setQuantites(Object.fromEntries(lignes.map(l => [l.id, n(l.quantite_a_commander)])))
    setQuantitesRecues(Object.fromEntries(lignes.map(l => [l.id, n(l.quantite_recue)])))
    setCommentaireReception('')
  }, [bon.id, bon.fournisseur_id, bon.fournisseur_nom, bon.date_livraison_souhaitee, bon.notes, lignes])

  const fournisseurOk = Boolean(fournisseurId || fournisseurNom.trim())
  const lignesOk = lignes.length > 0 && lignes.every(l => n(quantites[l.id]) > 0)
  const canAdvance = Boolean(nextStatut) && fournisseurOk && lignesOk && !updateDetails.isPending && !updateStatut.isPending
  const canReceive = receptionAllowed && fournisseurOk && lignes.some(l => n(quantitesRecues[l.id]) > n(l.quantite_recue))

  const buildDetailsPayload = () => ({
    id:                       bon.id,
    fournisseur_id:           fournisseurId || null,
    fournisseur_nom:          fournisseurNom.trim() || null,
    date_livraison_souhaitee: dateLivraison || null,
    notes:                    notes || null,
    lignes: lignes.map(l => ({
      id: l.id,
      quantite_a_commander: n(quantites[l.id]),
    })),
  })

  const handleSave = async () => {
    const updated = await updateDetails.mutateAsync(buildDetailsPayload())
    onChanged(updated)
  }

  const handleAdvance = async () => {
    if (!nextStatut) return
    const updated = await updateDetails.mutateAsync(buildDetailsPayload())
    const advanced = await updateStatut.mutateAsync({ id: updated.id, statut: nextStatut })
    onChanged({ ...updated, ...advanced })
  }

  const handleReception = async () => {
    const updated = await updateDetails.mutateAsync(buildDetailsPayload())
    const received = await reception.mutateAsync({
      id:              updated.id,
      fournisseur_id:  fournisseurId || null,
      fournisseur_nom: fournisseurNom.trim() || null,
      commentaire:     commentaireReception || undefined,
      lignes: lignes.map(l => ({ id: l.id, quantite_recue: n(quantitesRecues[l.id]) })),
    })
    onChanged(received)
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 shrink-0">
        <div>
          <div className="font-mono text-sm font-bold text-[#212121]">{bon.numero}</div>
          <div className="text-xs text-gray-500 mt-0.5">{formatDateTime(bon.created_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          <ApproStatusPill statut={bon.statut} />
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-500">
            X
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fournisseur *</label>
            <select
              value={fournisseurId}
              onChange={(e) => {
                const id = e.target.value
                const f = fournisseurs.find(item => item.id === id)
                setFournisseurId(id)
                setFournisseurNom(f?.nom ?? '')
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Selectionner un fournisseur</option>
              {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Date souhaitee</label>
            <input
              type="date"
              value={dateLivraison}
              onChange={(e) => setDateLivraison(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
        </div>

        {!fournisseurOk && (
          <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            Selectionner un fournisseur avant validation du bon.
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {lignes.length} produit(s) a approvisionner
          </div>
          <div className="space-y-3">
            {lignes.map((ligne) => {
              const colorClass = ALERTE_COLORS[ligne.statut_alerte] ?? ALERTE_COLORS.alerte
              return (
                <div key={ligne.id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#212121] truncate">{ligne.designation}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Stock actuel {ligne.stock_actuel_snap} / seuil {ligne.stock_min_snap} {ligne.unite}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${colorClass}`}>
                      {ligne.statut_alerte.toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Quantite a approvisionner</label>
                      <input
                        type="number"
                        min={1}
                        value={quantites[ligne.id] ?? ligne.quantite_a_commander}
                        onChange={(e) => setQuantites(prev => ({ ...prev, [ligne.id]: Math.max(1, Number(e.target.value)) }))}
                        disabled={['recu', 'recu_total', 'annule'].includes(bon.statut)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Quantite recue</label>
                      <input
                        type="number"
                        min={n(ligne.quantite_recue)}
                        value={quantitesRecues[ligne.id] ?? n(ligne.quantite_recue)}
                        onChange={(e) => setQuantitesRecues(prev => ({
                          ...prev,
                          [ligne.id]: Math.max(n(ligne.quantite_recue), Number(e.target.value)),
                        }))}
                        disabled={!receptionAllowed}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Deja recu : {n(ligne.quantite_recue)} {ligne.unite}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes internes</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
          />
        </div>

        {receptionAllowed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              Reception fournisseur
            </div>
            <textarea
              rows={2}
              value={commentaireReception}
              onChange={(e) => setCommentaireReception(e.target.value)}
              placeholder="Commentaire de reception, BL fournisseur, ecart constate..."
              className="w-full px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
            <Button
              size="sm"
              onClick={handleReception}
              disabled={!canReceive || reception.isPending || updateDetails.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
            >
              {reception.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Enregistrer la reception
            </Button>
          </div>
        )}
      </div>

      {bon.statut !== 'annule' && !['recu', 'recu_total'].includes(bon.statut) && (
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex gap-3">
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={updateDetails.isPending}>
            {updateDetails.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer
          </Button>
          {nextStatut && (
            <Button size="sm" onClick={handleAdvance} disabled={!canAdvance} className="flex-1">
              {updateStatut.isPending || updateDetails.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <ChevronRight className="h-3.5 w-3.5" />}
              Passer a "{STATUT_LABELS[nextStatut]}"
            </Button>
          )}
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

export default function BonsAppro() {
  const [statutFilter, setStatutFilter] = useState('')
  const [selected, setSelected] = useState<BonAppro | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [approOpen, setApproOpen] = useState(false)
  const [approForm, setApproForm] = useState<ApproForm>(DEFAULT_APPRO)

  const { data, isLoading, isError, error } = useBonsAppro(statutFilter ? { statut: statutFilter } : undefined)
  const { data: stocksData } = useStocks()
  const creerAppro = useCreerApproManuel()

  const bons = (data?.data ?? []) as BonRecord[]
  const produits = (stocksData?.data ?? []) as unknown as Produit[]

  const openApproModal = useCallback((p?: Produit) => {
    const qteDefaut = p ? Math.max(1, Math.ceil(n(p.stock_min) - n(p.stock_actuel))) : 1
    setApproForm({
      ...DEFAULT_APPRO,
      produitId:      (p?.id as string) ?? '',
      quantite:       qteDefaut,
      fournisseurNom: (p?.fournisseur as string | undefined) ?? '',
    })
    setApproOpen(true)
  }, [])

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const brouillons = bons.filter(b => b.statut === 'brouillon').length
  const enCours = bons.filter(b => ['valide', 'envoye', 'commande', 'recu_partiel'].includes(b.statut as string)).length
  const recus = bons.filter(b => ['recu', 'recu_total'].includes(b.statut as string)).length

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
          {expanded.has(row.id as string) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ),
    },
    {
      id: 'numero',
      header: 'Numero',
      accessor: 'numero',
      render: (v) => <span className="font-mono text-sm font-bold text-[#212121]">{v as string}</span>,
    },
    {
      id: 'statut',
      header: 'Statut',
      accessor: 'statut',
      render: (v) => <ApproStatusPill statut={v as StatutAppro} />,
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
            {nbRupture > 0 && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{nbRupture} rupture{nbRupture > 1 ? 's' : ''}</span>}
            {nbCritique > 0 && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{nbCritique} critique{nbCritique > 1 ? 's' : ''}</span>}
          </div>
        )
      },
    },
    {
      id: 'date',
      header: 'Cree le',
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
          Gerer
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
        subtitle="Reapprovisionnements automatiques - TAFDIL"
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
            <Package className="h-3.5 w-3.5" /> Recus
          </div>
          <div className="text-2xl font-bold text-green-700">{recus}</div>
        </div>
      </div>

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

      {isError ? (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-medium">Impossible de charger les bons d'approvisionnement.</span>
            {error instanceof Error && <span className="font-mono text-xs text-red-600 break-words">{error.message}</span>}
          </div>
        </div>
      ) : bons.length === 0 && !isLoading ? (
        <EmptyState
          icon={<Package className="h-10 w-10 text-gray-300" />}
          title="Aucun bon d'approvisionnement"
          description="Ils sont crees automatiquement quand un stock passe sous son seuil minimum apres l'execution d'un bon de sortie."
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <DataTable columns={COLUMNS} data={bons} loading={isLoading} onRowClick={(row) => setSelected(row as unknown as BonAppro)} />
          {expanded.size > 0 && bons
            .filter(b => expanded.has(b.id as string))
            .map(bon => (
              <div key={bon.id as string} className="border-t border-gray-100 px-6 py-4 bg-gray-50 space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Detail - {bon.numero as string}
                </div>
                {(bon.bons_approvisionnement_lignes as BonApproLigne[]).map(ligne => <LigneRow key={ligne.id} ligne={ligne} />)}
              </div>
            ))}
        </div>
      )}

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelected(null)} />
          <BonDetail bon={selected} onClose={() => setSelected(null)} onChanged={setSelected} />
        </>
      )}

      <Modal isOpen={approOpen} onClose={() => setApproOpen(false)} title="Demander un approvisionnement" size="md">
        <div className="space-y-4">
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
                  quantite:       p ? Math.max(1, Math.ceil(n(p.stock_min) - n(p.stock_actuel))) : f.quantite,
                }))
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Selectionner un article...</option>
              {produits.map((p) => (
                <option key={p.id as string} value={p.id as string}>
                  {p.designation as string} - stock: {p.stock_actuel as number} {p.unite as string}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantite a commander *</label>
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
                  Stock actuel : {p.stock_actuel as number} - Seuil min : {p.stock_min as number} {p.unite as string}
                </p>
              ) : null
            })()}
          </div>

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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de livraison souhaitee</label>
            <input
              type="date"
              value={approForm.dateLivraisonSouhaitee}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setApproForm(f => ({ ...f, dateLivraisonSouhaitee: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Instructions particulieres, urgence, etc."
              value={approForm.notes}
              onChange={(e) => setApproForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setApproOpen(false)}>Annuler</Button>
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
                  { onSuccess: () => { setApproOpen(false); setApproForm(DEFAULT_APPRO); setStatutFilter('') } },
                )
              }}
            >
              {creerAppro.isPending ? 'Creation...' : "Creer le bon d'appro"}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
