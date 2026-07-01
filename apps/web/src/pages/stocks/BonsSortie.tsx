import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Plus, Check, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, Minus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, DataTable, StatusBadge, SlideOver, Modal, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDateTime } from '@/lib/utils'
import {
  useAssignPreparateurBon,
  useBackfillBons,
  useBons,
  useCreateBon,
  useExecuteBon,
  useMarquerBonPret,
  usePreparateursBons,
  useValidateBon,
  useVerifierStockBon,
} from '@/hooks/useBons'
import { useStocks } from '@/hooks/useStocks'
import { useEmployes } from '@/hooks/useRH'
import type { BonSortie as BonApi, BonLigne } from '@/hooks/useBons'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

type BonRecord = BonApi & Record<string, unknown>

type BonStatus = 'soumis' | 'valide' | 'execute'
type PreparationStatus = 'a_preparer' | 'en_cours' | 'pret'

const STEP_LABELS: Record<BonStatus, string> = { soumis: 'En attente', valide: 'Validé', execute: 'Exécuté' }
const STEPS: BonStatus[] = ['soumis', 'valide', 'execute']
const PREPARATION_LABELS: Record<PreparationStatus, string> = {
  a_preparer: 'A preparer',
  en_cours:   'En cours',
  pret:       'Pret',
}

function lignesDuBon(bon: Partial<BonRecord> | null | undefined): BonLigne[] {
  if (!bon) return []
  const lignes = bon.lignes ?? bon.bons_sortie_lignes
  return Array.isArray(lignes) ? (lignes as BonLigne[]) : []
}

function quantiteLigne(ligne: BonLigne) {
  return ligne.quantite_demandee ?? ligne.quantite ?? 0
}

function quantiteServieLigne(ligne: BonLigne, statut: string) {
  const servie = Number(ligne.quantite_servie ?? 0)
  if (servie > 0) return servie
  return statut === 'execute' ? quantiteLigne(ligne) : '-'
}

function commandeLabel(bon: BonRecord) {
  if (bon.type === 'commande') return bon.demandeur || bon.commande_id || ''
  return bon.commande_id ?? ''
}

function preparateurLabel(bon: BonRecord) {
  const preparateur = bon.preparateur as BonApi['preparateur'] | undefined
  return preparateur?.nom ?? ''
}

function preparationStatus(bon: BonRecord): PreparationStatus | null {
  if (bon.statut_preparation) return bon.statut_preparation as PreparationStatus
  return bon.statut === 'valide' ? 'a_preparer' : null
}

function peutExecuterBon(bon: BonRecord) {
  return Boolean(bon.preparateur_id) && preparationStatus(bon) === 'pret'
}

// ── Stepper ────────────────────────────────────────────────────────────────────

function WorkflowStepper({ status }: { status: string }) {
  const normalized = (status === 'en_attente' ? 'soumis' : status) as BonStatus
  const currentIdx = STEPS.indexOf(normalized)
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
  const [selectedBon, setSelectedBon] = useState<BonRecord | null>(null)
  const [execBonId, setExecBonId]       = useState<string | null>(null)
  const [execBonNumero, setExecBonNumero] = useState('')
  const [codeInput, setCodeInput]       = useState('')
  const [assignBon, setAssignBon]       = useState<BonRecord | null>(null)
  const [preparateurId, setPreparateurId] = useState('')

  const { data, isLoading } = useBons()
  const validateBon  = useValidateBon()
  const executeBon   = useExecuteBon()
  const backfillBons = useBackfillBons()
  const assignPreparateur = useAssignPreparateurBon()
  const marquerPret = useMarquerBonPret()
  const { data: preparateursData } = usePreparateursBons()
  const { data: stockCheck, isLoading: stockCheckLoading } = useVerifierStockBon(execBonId)
  const preparateurs = preparateursData?.data ?? []

  const bons = useMemo(
    () => ((data?.data ?? []) as BonRecord[]).map((bon) => ({
      ...bon,
      lignes: lignesDuBon(bon),
    })),
    [data?.data],
  )
  const enAttente = bons.filter((b) => b.statut === 'soumis' || b.statut === 'en_attente').length

  function ouvrirExecution(bon: BonRecord) {
    if (!peutExecuterBon(bon)) {
      toast.error('Assignez un preparateur et marquez la preparation comme prete avant execution.')
      return
    }
    setExecBonId(bon.id)
    setExecBonNumero(bon.numero)
    setCodeInput('')
  }

  function fermerExecution() {
    setExecBonId(null)
    setExecBonNumero('')
    setCodeInput('')
  }

  function confirmerExecution() {
    if (!execBonId || !codeInput) return
    const nbArticles = stockCheck?.lignes.filter((l) => !l.sans_produit).length ?? 0
    executeBon.mutate(
      { id: execBonId, code_unique: codeInput, nb_articles: nbArticles },
      { onSuccess: fermerExecution },
    )
  }

  function ouvrirAssignation(bon: BonRecord) {
    setAssignBon(bon)
    setPreparateurId((bon.preparateur_id as string | null | undefined) ?? '')
  }

  function fermerAssignation() {
    setAssignBon(null)
    setPreparateurId('')
  }

  function confirmerAssignation() {
    if (!assignBon || !preparateurId) return
    assignPreparateur.mutate(
      { id: assignBon.id, preparateur_id: preparateurId },
      { onSuccess: fermerAssignation },
    )
  }

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
      render: (v) => <WorkflowStepper status={v as string} />,
    },
    {
      id: 'preparateur',
      header: 'Préparateur',
      accessor: 'preparateur_id',
      render: (_v, row) => {
        const nom = preparateurLabel(row)
        if (!nom) return <span className="text-xs text-gray-400 italic">A assigner</span>
        return (
          <div>
            <span className="text-sm font-medium text-[#212121]">{nom}</span>
            {row.preparateur?.poste && <div className="text-xs text-gray-400">{row.preparateur.poste}</div>}
          </div>
        )
      },
    },
    {
      id: 'statut_preparation',
      header: 'Préparation',
      accessor: 'statut_preparation',
      render: (_v, row) => {
        const statutPrep = preparationStatus(row)
        if (!statutPrep) return <span className="text-xs text-gray-400 italic">—</span>
        const cls =
          statutPrep === 'pret' ? 'bg-green-50 text-green-700 border-green-200'
          : statutPrep === 'en_cours' ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
        return (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
            {PREPARATION_LABELS[statutPrep]}
          </span>
        )
      },
    },
    {
      id: 'badge',
      header: 'Statut',
      accessor: 'statut',
      render: (v) => <StatusBadge status={v === 'en_attente' ? 'soumis' : v as string} />,
    },
    {
      id: 'produits',
      header: 'Articles',
      accessor: 'lignes',
      sortable: false,
      render: (v) => {
        const lignes = (v as BonLigne[] | null | undefined) ?? []
        if (lignes.length === 0) return <span className="text-xs text-gray-400 italic">—</span>
        return (
          <div>
            <span className="text-sm font-semibold text-[#212121]">
              {lignes.length} article{lignes.length > 1 ? 's' : ''}
            </span>
            <div className="text-xs text-gray-400 truncate max-w-48 mt-0.5">
              {lignes.map((l) => `${quantiteLigne(l)} × ${l.designation}`).join(' · ')}
            </div>
          </div>
        )
      },
    },
    {
      id: 'montant_total_xaf',
      header: 'Montant',
      accessor: 'montant_total_xaf',
      render: (v) => v != null
        ? <span className="text-sm font-semibold">{formatXAF(v as number)}</span>
        : <span className="text-xs text-gray-400 italic">Sur devis</span>,
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
          {(v === 'soumis' || v === 'en_attente') && (
            <button
              disabled={validateBon.isPending}
              onClick={() => validateBon.mutate({ id: row.id as string })}
              className="px-2 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              Valider
            </button>
          )}
          {v === 'valide' && (
            <>
              {(!row.preparateur_id || preparationStatus(row) === 'a_preparer') && (
                <button
                  disabled={assignPreparateur.isPending}
                  onClick={() => ouvrirAssignation(row)}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  Assigner préparateur
                </button>
              )}
              {row.preparateur_id && preparationStatus(row) === 'en_cours' && (
                <button
                  disabled={marquerPret.isPending}
                  onClick={() => marquerPret.mutate({ id: row.id as string })}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                  Marquer prêt
                </button>
              )}
              {peutExecuterBon(row) && (
                <button
                  disabled={executeBon.isPending}
                  onClick={() => ouvrirExecution(row)}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  Exécuter
                </button>
              )}
            </>
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
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={backfillBons.isPending}
              onClick={() => backfillBons.mutate()}
              title="Importer les commandes web en préparation sans bon de sortie"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${backfillBons.isPending ? 'animate-spin' : ''}`} />
              Synchroniser
            </Button>
            <Button size="sm" onClick={() => setNouveauOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Nouveau Bon
            </Button>
          </div>
        }
      />

      <DataTable<BonRecord>
        columns={COLUMNS}
        data={bons}
        keyField="id"
        loading={isLoading}
        onRowClick={setSelectedBon}
      />

      <Modal
        isOpen={!!assignBon}
        onClose={fermerAssignation}
        title={`Assigner préparateur ${assignBon?.numero ?? ''}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Préparateur responsable <span className="text-red-500">*</span>
            </label>
            <select
              value={preparateurId}
              onChange={(e) => setPreparateurId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner...</option>
              {preparateurs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom} {p.poste ? `- ${p.poste}` : ''}{p.departement ? ` (${p.departement})` : ''}
                </option>
              ))}
            </select>
            {preparateurs.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">Aucun employe RH actif disponible pour l'assignation.</p>
            )}
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={fermerAssignation} disabled={assignPreparateur.isPending}>
              Annuler
            </Button>
            <Button
              className="flex-1"
              disabled={!preparateurId || assignPreparateur.isPending}
              onClick={confirmerAssignation}
            >
              {assignPreparateur.isPending ? 'Assignation...' : 'Assigner'}
            </Button>
          </div>
        </div>
      </Modal>

      {nouveauOpen && <NouveauBonSlideOver open={nouveauOpen} onClose={() => setNouveauOpen(false)} />}
      {selectedBon && (
        <BonDetailSlideOver
          bon={selectedBon}
          onClose={() => setSelectedBon(null)}
          onValidate={(arg) => validateBon.mutate(arg)}
          onExecute={(bon) => {
            setSelectedBon(null)
            ouvrirExecution(bon)
          }}
          validatePending={validateBon.isPending}
          executePending={executeBon.isPending}
        />
      )}

      {/* Modal d'exécution avec vérification de stock */}
      <Modal
        isOpen={!!execBonId}
        onClose={fermerExecution}
        title={`Exécuter le bon ${execBonNumero}`}
      >
        <div className="space-y-4">
          {/* Tableau de vérification des stocks */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Vérification des stocks</p>
            {stockCheckLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                Vérification en cours…
              </div>
            ) : stockCheck ? (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Article</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Demandé</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Disponible</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">État</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stockCheck.lignes.map((ligne, i) => (
                      <tr key={i} className={!ligne.suffisant ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2 text-xs text-gray-700 font-medium">{ligne.designation}</td>
                        <td className="px-3 py-2 text-xs text-right text-gray-600">{ligne.quantite_demandee}</td>
                        <td className="px-3 py-2 text-xs text-right">
                          {ligne.sans_produit
                            ? <span className="text-gray-400">—</span>
                            : <span className={ligne.suffisant ? 'text-green-700' : 'text-red-600 font-semibold'}>{ligne.stock_disponible}</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-center">
                          {ligne.sans_produit
                            ? <Minus className="h-3.5 w-3.5 text-gray-300 mx-auto" />
                            : ligne.suffisant
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />
                              : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Avertissement stock insuffisant */}
            {stockCheck && !stockCheck.toutSuffisant && (
              <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Stock insuffisant pour {stockCheck.lignes.filter((l) => !l.suffisant).length} article(s).
                  L'exécution risque d'échouer.
                </p>
              </div>
            )}
          </div>

          {/* Saisie du code unique */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Code unique du bon <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={execBonNumero}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] font-mono"
            />
            <p className="mt-1 text-xs text-gray-400">Saisir le numéro exact du bon pour confirmer</p>
          </div>

          {/* Boutons */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={fermerExecution} disabled={executeBon.isPending}>
              Annuler
            </Button>
            <Button
              className="flex-1"
              disabled={!codeInput || executeBon.isPending || stockCheckLoading}
              onClick={confirmerExecution}
            >
              {executeBon.isPending ? 'Exécution…' : 'Confirmer l\'exécution'}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}

function BonDetailSlideOver({
  bon,
  onClose,
  onValidate,
  onExecute,
  validatePending,
  executePending,
}: {
  bon: BonRecord
  onClose: () => void
  onValidate: (arg: { id: string; nature_transaction?: 'comptant' | 'credit' | 'deduction_acompte'; imputation_payeur?: 'entreprise_tafdil' | 'atelier' | 'administration' }) => void
  onExecute: (bon: BonRecord) => void
  validatePending: boolean
  executePending: boolean
}) {
  const lignes = lignesDuBon(bon)
  const statut = bon.statut === 'en_attente' ? 'soumis' : bon.statut
  const canValidate = bon.statut === 'soumis' || bon.statut === 'en_attente'
  const canExecute = bon.statut === 'valide'
  const executionReady = peutExecuterBon(bon)

  const missingNature = canValidate && !bon.nature_transaction
  const missingPayeur = canValidate && !bon.imputation_payeur

  const [nature, setNature] = useState<'comptant' | 'credit' | 'deduction_acompte'>(
    (bon.nature_transaction as 'comptant' | 'credit' | 'deduction_acompte') ?? 'comptant'
  )
  const [payeur, setPayeur] = useState<'entreprise_tafdil' | 'atelier' | 'administration'>(
    (bon.imputation_payeur as 'entreprise_tafdil' | 'atelier' | 'administration') ?? 'atelier'
  )

  const selectCls = 'w-full px-3 py-2 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] bg-amber-50'

  function handleValidate() {
    onValidate({
      id: bon.id,
      ...(missingNature ? { nature_transaction: nature } : {}),
      ...(missingPayeur ? { imputation_payeur: payeur } : {}),
    })
  }

  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Bon de sortie ${bon.numero}`} width="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div>
            <p className="font-mono text-sm font-semibold text-[#212121]">{bon.numero}</p>
            <p className="mt-1 text-xs text-gray-500">{formatDateTime(bon.created_at)}</p>
          </div>
          <StatusBadge status={statut} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DetailItem label="Demandeur" value={bon.demandeur} />
          <DetailItem label="Type" value={bon.type ?? 'manuel'} />
          <DetailItem label="Commande" value={commandeLabel(bon)} />
          <DetailItem label="Préparateur" value={preparateurLabel(bon) || 'A assigner'} />
          <DetailItem
            label="Préparation"
            value={preparationStatus(bon) ? PREPARATION_LABELS[preparationStatus(bon)!] : '-'}
          />
          <DetailItem
            label="Montant"
            value={bon.montant_total_xaf != null ? formatXAF(Number(bon.montant_total_xaf)) : 'Sur devis'}
          />
          {!missingNature ? (
            <DetailItem
              label="Nature transaction"
              value={
                bon.nature_transaction === 'comptant'             ? 'Comptant'
                : bon.nature_transaction === 'credit'            ? 'Crédit'
                : bon.nature_transaction === 'deduction_acompte' ? 'Déduction acompte'
                : '—'
              }
            />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase text-amber-700 mb-1">Nature transaction <span className="text-red-500">*</span></p>
              <select value={nature} onChange={(e) => setNature(e.target.value as typeof nature)} className={selectCls}>
                <option value="comptant">Comptant</option>
                <option value="credit">Crédit</option>
                <option value="deduction_acompte">Déduction acompte</option>
              </select>
            </div>
          )}
          {!missingPayeur ? (
            <DetailItem
              label="Imputation payeur"
              value={
                bon.imputation_payeur === 'atelier'             ? 'Atelier'
                : bon.imputation_payeur === 'entreprise_tafdil' ? 'Entreprise TAFDIL'
                : bon.imputation_payeur === 'administration'    ? 'Administration'
                : '—'
              }
            />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase text-amber-700 mb-1">Imputation payeur <span className="text-red-500">*</span></p>
              <select value={payeur} onChange={(e) => setPayeur(e.target.value as typeof payeur)} className={selectCls}>
                <option value="atelier">Atelier</option>
                <option value="entreprise_tafdil">Entreprise TAFDIL</option>
                <option value="administration">Administration</option>
              </select>
            </div>
          )}
        </div>

        {(missingNature || missingPayeur) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Ce bon a été créé sans nature de transaction ou imputation payeur.
              Veuillez renseigner ces champs avant de valider.
            </p>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase text-gray-500">Motif</p>
          <p className="mt-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {bon.motif || 'Aucun motif renseigne'}
          </p>
        </div>

        {bon.notes && (
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Notes</p>
            <p className="mt-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {bon.notes}
            </p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-gray-500">Articles</p>
            <span className="text-xs text-gray-400">
              {lignes.length} article{lignes.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Designation</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Demandee</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Servie</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Unite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lignes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-400">
                      Aucun article rattache a ce bon.
                    </td>
                  </tr>
                ) : (
                  lignes.map((ligne, index) => (
                    <tr key={ligne.id ?? `${ligne.designation}-${index}`}>
                      <td className="px-3 py-2 font-medium text-gray-700">{ligne.designation}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{quantiteLigne(ligne)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{quantiteServieLigne(ligne, bon.statut)}</td>
                      <td className="px-3 py-2 text-gray-500">{ligne.unite}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {(canValidate || canExecute) && (
          <div className="flex gap-3 border-t border-gray-100 pt-4">
            {canValidate && (
              <Button className="flex-1" disabled={validatePending} onClick={handleValidate}>
                Valider le bon
              </Button>
            )}
            {canExecute && (
              <Button
                className="flex-1"
                disabled={executePending || !executionReady}
                onClick={() => onExecute(bon)}
                title={!executionReady ? 'Préparateur et préparation prête requis' : undefined}
              >
                Executer le bon
              </Button>
            )}
          </div>
        )}
      </div>
    </SlideOver>
  )
}

function DetailItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-[#212121]">{value || '-'}</p>
    </div>
  )
}

// ── Nouveau bon form ───────────────────────────────────────────────────────────

type TypeSource = 'manuel' | 'commande' | 'devis'
interface CommandeOption { id: string; numero: string; client_nom: string }
interface DevisOption    { id: string; reference: string }

function NouveauBonSlideOver({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: stocksData } = useStocks()
  const { data: empData }    = useEmployes()
  const createBon = useCreateBon()

  const produits    = stocksData?.data ?? []
  const techniciens = (empData?.data ?? []).map((e) => e.nom)

  const [typeSrc, setTypeSrc]     = useState<TypeSource>('manuel')
  const [sourceId, setSourceId]   = useState('')
  const [cmdOptions, setCmdOptions] = useState<CommandeOption[]>([])
  const [devOptions, setDevOptions] = useState<DevisOption[]>([])
  const [nature, setNature]   = useState<'comptant' | 'credit' | 'deduction_acompte'>('comptant')
  const [payeur, setPayeur]   = useState<'entreprise_tafdil' | 'atelier' | 'administration'>('atelier')

  const [form, setForm] = useState({
    technicien_nom: '',
    lignes: [{ produit_id: '', quantite: 1, unite: 'kg' }],
  })

  useEffect(() => {
    setSourceId('')
    if (typeSrc === 'commande') {
      void supabase.from('commandes').select('id, numero, client_nom')
        .in('statut', ['confirmed', 'in_production'])
        .then(({ data }) => setCmdOptions((data ?? []) as CommandeOption[]))
    } else if (typeSrc === 'devis') {
      void supabase.from('devis').select('id, reference')
        .eq('statut', 'accepte')
        .then(({ data }) => setDevOptions((data ?? []) as DevisOption[]))
    }
  }, [typeSrc])

  const addLigne    = () => setForm((f) => ({ ...f, lignes: [...f.lignes, { produit_id: '', quantite: 1, unite: 'kg' }] }))
  const removeLigne = (i: number) => setForm((f) => ({ ...f, lignes: f.lignes.filter((_, idx) => idx !== i) }))
  const updateLigne = (i: number, field: string, value: string | number) =>
    setForm((f) => ({ ...f, lignes: f.lignes.map((l, idx) => idx === i ? { ...l, [field]: value } : l) }))

  const lignesValid  = form.lignes.every((l) => l.produit_id !== '' && l.quantite > 0)
  const sourceValid  = typeSrc === 'manuel' ? form.technicien_nom !== '' : sourceId !== ''
  const hasCommande  = typeSrc === 'commande' && sourceId !== ''
  const natureValid  = nature === 'comptant' || hasCommande
  const valid        = lignesValid && sourceValid && natureValid

  const handleSubmit = () => {
    const lignes = form.lignes.map((l) => {
      const produit = produits.find((p) => p.id === l.produit_id)
      return { produit_id: l.produit_id, quantite: l.quantite, unite: produit?.unite ?? l.unite }
    })

    const sourceRef =
      typeSrc === 'commande' ? (cmdOptions.find((c) => c.id === sourceId)?.numero ?? '')
      : typeSrc === 'devis'  ? (devOptions.find((d) => d.id === sourceId)?.reference ?? '')
      : ''

    createBon.mutate({
      type:              typeSrc,
      demandeur:         typeSrc !== 'manuel' ? sourceRef : undefined,
      technicien_nom:    typeSrc === 'manuel' ? form.technicien_nom : undefined,
      motif:
        typeSrc === 'commande' ? `Préparation commande ${sourceRef}`
        : typeSrc === 'devis'  ? `Sortie devis ${sourceRef}`
        : 'Sortie de stock',
      commande_id:        typeSrc === 'commande' ? sourceId : undefined,
      devis_id:           typeSrc === 'devis'    ? sourceId : undefined,
      nature_transaction: nature,
      imputation_payeur:  payeur,
      lignes,
    }, { onSuccess: onClose })
  }

  const selectCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]'

  return (
    <SlideOver isOpen={open} onClose={onClose} title="Nouveau bon de sortie" width="lg">
      <div className="space-y-5">
        {/* Type de source */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type de source</label>
          <div className="flex gap-2">
            {(['manuel', 'commande', 'devis'] as TypeSource[]).map((t) => (
              <button
                key={t}
                onClick={() => setTypeSrc(t)}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors capitalize ${
                  typeSrc === t
                    ? 'bg-[#C62828] text-white border-[#C62828]'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-[#C62828] hover:text-[#C62828]'
                }`}
              >
                {t === 'manuel' ? 'Manuel' : t === 'commande' ? 'Commande' : 'Devis'}
              </button>
            ))}
          </div>
        </div>

        {/* Source selector */}
        {typeSrc === 'manuel' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Technicien</label>
            <select
              value={form.technicien_nom}
              onChange={(e) => setForm((f) => ({ ...f, technicien_nom: e.target.value }))}
              className={selectCls}
            >
              <option value="">Sélectionner...</option>
              {techniciens.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        {typeSrc === 'commande' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Commande associée</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectCls}>
              <option value="">Sélectionner une commande...</option>
              {cmdOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.numero} — {c.client_nom}</option>
              ))}
            </select>
            {cmdOptions.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">Aucune commande en cours trouvée.</p>
            )}
          </div>
        )}

        {typeSrc === 'devis' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Devis associé</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectCls}>
              <option value="">Sélectionner un devis...</option>
              {devOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.reference}</option>
              ))}
            </select>
            {devOptions.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">Aucun devis accepté trouvé.</p>
            )}
          </div>
        )}

        {/* Nature de la transaction */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nature de la transaction</label>
          <select
            value={nature}
            onChange={(e) => setNature(e.target.value as typeof nature)}
            className={selectCls}
          >
            <option value="comptant">Comptant — paiement immédiat</option>
            <option value="credit" disabled={!hasCommande}>Crédit — vente à crédit{!hasCommande ? ' (commande requise)' : ''}</option>
            <option value="deduction_acompte" disabled={!hasCommande}>Déduction acompte{!hasCommande ? ' (commande requise)' : ''}</option>
          </select>
          {!natureValid && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Nature "{nature}" requiert une commande liée — sélectionnez une commande ci-dessus.
            </div>
          )}
        </div>

        {/* Imputation payeur */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Imputation payeur</label>
          <select
            value={payeur}
            onChange={(e) => setPayeur(e.target.value as typeof payeur)}
            className={selectCls}
          >
            <option value="atelier">Atelier</option>
            <option value="entreprise_tafdil">Entreprise TAFDIL</option>
            <option value="administration">Administration</option>
          </select>
        </div>

        {/* Lignes produits */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase">Produits à sortir</label>
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
