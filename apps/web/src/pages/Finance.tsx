import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, CreditCard, ReceiptText,
  Plus, Download, MessageCircle, Printer,
  AlertCircle, CheckCircle, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, Modal, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import {
  useFactures, useCredits, useEcritures, useEnvoyerFacture, useRemboursement, useCreerFacture,
} from '@/hooks/useFinance'
import type { Facture as FactureApi, Credit as CreditApi, FactureLigne } from '@/hooks/useFinance'
import { useClients } from '@/hooks/useClients'

// ── Types ──────────────────────────────────────────────────────────────────────

type FactureRecord = FactureApi & Record<string, unknown>
type CreditRecord  = CreditApi  & Record<string, unknown>

// Local form ligne (matches API shape for simplicity)
interface FormLigne { designation: string; quantite: number; prix_unitaire_ht_xaf: number }

// ── Constants ──────────────────────────────────────────────────────────────────

const TVA = 0.1925

function totalsFromLignes(lignes: FormLigne[]) {
  const ht = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  return { ht, tva: ht * TVA, ttc: ht * (1 + TVA) }
}

const SYSCOHADA = [
  { code: '411', label: '411 — Clients' },
  { code: '401', label: '401 — Fournisseurs' },
  { code: '521', label: '521 — Banque' },
  { code: '571', label: '571 — Caisse' },
  { code: '601', label: '601 — Achats matières premières' },
  { code: '641', label: '641 — Charges de personnel' },
  { code: '701', label: '701 — Ventes produits finis' },
  { code: '443', label: '443 — TVA collectée' },
  { code: '612', label: '612 — Locations' },
]

// ── Static fiscal declarations (no API endpoint yet) ───────────────────────────

const DECLARATIONS = [
  { id: '1', type: 'TVA', periode: 'Avril 2026', statut: 'soumis', montant: 425000, echeance: '2026-05-15' },
  { id: '2', type: 'IRCM (Retenues à la source)', periode: 'Avril 2026', statut: 'valide', montant: 89000, echeance: '2026-05-10' },
  { id: '3', type: 'TVA', periode: 'Mai 2026', statut: 'a_declarer', montant: 0, echeance: '2026-06-15' },
  { id: '4', type: 'DSF (Déclaration Statistique et Fiscale)', periode: 'Exercice 2025', statut: 'valide', montant: 0, echeance: '2026-03-31' },
  { id: '5', type: 'IS (Impôt sur les Sociétés)', periode: 'Exercice 2025', statut: 'a_declarer', montant: 0, echeance: '2026-04-30' },
]

// ── Status helpers ─────────────────────────────────────────────────────────────

const FACT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  brouillon: { label: 'Brouillon', color: '#6b7280', bg: '#f3f4f6' },
  valide:    { label: 'Validée',   color: '#1d4ed8', bg: '#dbeafe' },
  envoye:    { label: 'Envoyée',   color: '#d97706', bg: '#fef3c7' },
  paye:      { label: 'Payée',     color: '#15803d', bg: '#dcfce7' },
  annule:    { label: 'Annulée',   color: '#dc2626', bg: '#fee2e2' },
}

const DECL_MAP: Record<string, { label: string; color: string; bg: string }> = {
  a_declarer: { label: 'À déclarer', color: '#dc2626', bg: '#fee2e2' },
  soumis:     { label: 'Soumise',    color: '#d97706', bg: '#fef3c7' },
  valide:     { label: 'Validée',    color: '#15803d', bg: '#dcfce7' },
}

function Badge({ statut, map }: { statut: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[statut] ?? { label: statut, color: '#6b7280', bg: '#f3f4f6' }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>
      {s.label}
    </span>
  )
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = ['Factures', 'Crédits', 'Comptabilité', 'Déclarations Fiscales'] as const
type Tab = typeof TABS[number]

// ── PDF Preview ────────────────────────────────────────────────────────────────

interface PreviewableFacture {
  numero: string
  client: { nom: string }
  date_emission: string
  date_echeance: string
  lignes: FactureLigne[]
  montant_ht_xaf: number
  montant_tva_xaf: number
  montant_ttc_xaf: number
}

function InvoicePreview({ facture }: { facture: PreviewableFacture }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-inner" style={{ fontFamily: 'Georgia, serif' }}>
      <div className="p-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <div className="font-black text-3xl text-[#C62828] tracking-tight">FORGE</div>
            <div className="text-gray-600 text-sm font-sans font-semibold mt-1">TAFDIL SARL</div>
            <div className="text-gray-400 text-xs font-sans mt-0.5">Zone Industrielle de Bassa, Douala</div>
            <div className="text-gray-400 text-xs font-sans">RC : DLA-2020-B-1234 · NINEA : 123456789</div>
            <div className="text-gray-400 text-xs font-sans">+237 699 001 200 · admin@tafdil.com</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-sans text-gray-800 tracking-widest uppercase">Facture</div>
            <div className="font-mono font-bold text-[#C62828] text-lg mt-1">{facture.numero}</div>
            <div className="mt-2 text-xs font-sans text-gray-500 space-y-0.5">
              <div>Émise le : <span className="font-semibold text-gray-700">{formatDate(facture.date_emission)}</span></div>
              <div>Échéance : <span className="font-semibold text-gray-700">{formatDate(facture.date_echeance)}</span></div>
            </div>
          </div>
        </div>

        {/* Client */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 font-sans">
          <div className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Facturé à</div>
          <div className="font-bold text-gray-800">{facture.client.nom}</div>
          <div className="text-sm text-gray-500">Cameroun</div>
        </div>

        {/* Lignes */}
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="text-left py-2 text-xs uppercase text-gray-500 font-semibold">Désignation</th>
              <th className="text-center py-2 text-xs uppercase text-gray-500 font-semibold w-16">Qté</th>
              <th className="text-right py-2 text-xs uppercase text-gray-500 font-semibold w-28">P.U. HT</th>
              <th className="text-right py-2 text-xs uppercase text-gray-500 font-semibold w-28">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {facture.lignes.map((l, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2.5 text-gray-800">{l.designation}</td>
                <td className="py-2.5 text-center text-gray-600">{l.quantite}</td>
                <td className="py-2.5 text-right text-gray-600">{formatXAF(l.prix_unitaire_ht_xaf)}</td>
                <td className="py-2.5 text-right font-semibold text-gray-800">{formatXAF(l.quantite * l.prix_unitaire_ht_xaf)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totaux */}
        <div className="mt-4 flex justify-end font-sans">
          <div className="w-64 space-y-1.5">
            <div className="flex justify-between text-sm py-1 border-b border-gray-100">
              <span className="text-gray-500">Sous-total HT</span>
              <span className="font-semibold text-gray-800">{formatXAF(facture.montant_ht_xaf)}</span>
            </div>
            <div className="flex justify-between text-sm py-1 border-b border-gray-100">
              <span className="text-gray-500">TVA 19,25 %</span>
              <span className="font-semibold text-gray-800">{formatXAF(facture.montant_tva_xaf)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t-2 border-gray-800">
              <span className="font-bold text-gray-800">TOTAL TTC</span>
              <span className="font-black text-[#C62828] text-base">{formatXAF(facture.montant_ttc_xaf)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-4 bg-gray-50 border-t border-gray-200 font-sans">
        <div className="flex justify-between items-start text-xs text-gray-400">
          <div>
            <div className="font-semibold text-gray-500 mb-1">Modalités de paiement</div>
            <div>Virement bancaire — UBA Cameroun</div>
            <div className="font-mono">IBAN : CM21 1000 2016 0010 1234 5678 901</div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-gray-500 mb-1">Pénalités de retard</div>
            <div>3× taux légal en vigueur</div>
            <div>Indemnité forfaitaire : 40 000 FCFA</div>
          </div>
        </div>
        <div className="text-center text-xs text-gray-300 mt-3 border-t border-gray-200 pt-3">
          TAFDIL SARL — Capital social : 5 000 000 FCFA — RCCM Douala 2020 B 1234
        </div>
      </div>
    </div>
  )
}

// ── Nouvelle Facture Slide-over ────────────────────────────────────────────────

function NouvelleFactureSlideOver({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep]           = useState(1)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [dateEmission]            = useState(new Date().toISOString().split('T')[0])
  const [dateEcheance, setDateEcheance] = useState('')
  const [lignes, setLignes]       = useState<FormLigne[]>([{ designation: '', quantite: 1, prix_unitaire_ht_xaf: 0 }])

  const { data: clientsData } = useClients()
  const clients = clientsData?.data ?? []
  const selectedClientNom = clients.find((c) => c.id === selectedClientId)?.nom ?? ''
  const creerFacture = useCreerFacture()

  const { ht, tva, ttc } = totalsFromLignes(lignes)

  const previewFacture: PreviewableFacture = {
    numero: 'FACT-2026-NEW',
    client: { nom: selectedClientNom },
    date_emission: dateEmission,
    date_echeance: dateEcheance,
    lignes,
    montant_ht_xaf:  ht,
    montant_tva_xaf: tva,
    montant_ttc_xaf: ttc,
  }

  const updateLigne = (i: number, field: keyof FormLigne, val: string | number) => {
    const next = [...lignes]
    next[i] = { ...next[i], [field]: val }
    setLignes(next)
  }

  const STEPS = ['Client & Dates', 'Lignes', 'Aperçu']

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title="Nouvelle facture" width="xl">
      {/* Progress */}
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <React.Fragment key={i}>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                style={{
                  backgroundColor: step > i + 1 ? '#15803d' : step === i + 1 ? '#C62828' : '#e5e7eb',
                  color: step >= i + 1 ? '#fff' : '#9ca3af',
                }}
              >
                {step > i + 1 ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className="text-xs font-medium whitespace-nowrap" style={{ color: step === i + 1 ? '#C62828' : '#9ca3af' }}>{s}</span>
            </div>
            {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client</label>
            <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white">
              <option value="">— Sélectionner —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'émission</label>
              <input type="date" value={dateEmission} readOnly
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'échéance</label>
              <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setStep(2)} disabled={!selectedClientId || !dateEcheance}>
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-4">
          {lignes.map((l, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1">
                <input placeholder="Désignation" value={l.designation} onChange={(e) => updateLigne(i, 'designation', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
              </div>
              <input type="number" placeholder="Qté" value={l.quantite || ''} onChange={(e) => updateLigne(i, 'quantite', +e.target.value)}
                className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
              <input type="number" placeholder="P.U. HT" value={l.prix_unitaire_ht_xaf || ''} onChange={(e) => updateLigne(i, 'prix_unitaire_ht_xaf', +e.target.value)}
                className="w-32 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
              <div className="w-28 pt-2 text-sm font-semibold text-right text-gray-700 shrink-0">
                {formatXAF(l.quantite * l.prix_unitaire_ht_xaf)}
              </div>
              {lignes.length > 1 && (
                <button onClick={() => setLignes(lignes.filter((_, j) => j !== i))} className="pt-2.5 text-gray-400 hover:text-[#C62828]">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setLignes([...lignes, { designation: '', quantite: 1, prix_unitaire_ht_xaf: 0 }])}
            className="text-sm text-[#C62828] font-medium hover:underline flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
          </button>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Total HT</span><span className="font-semibold">{formatXAF(ht)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">TVA 19,25 %</span><span className="font-semibold">{formatXAF(tva)}</span></div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-2">
              <span>Total TTC</span><span className="text-[#C62828]">{formatXAF(ttc)}</span>
            </div>
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft className="h-3.5 w-3.5" /> Retour</Button>
            <Button onClick={() => setStep(3)} disabled={lignes.every((l) => !l.designation)}>
              Aperçu <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-4">
          <InvoicePreview facture={previewFacture} />
          <div className="flex gap-2 justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft className="h-3.5 w-3.5" /> Retour</Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Imprimer
              </Button>
              <Button
                onClick={() => creerFacture.mutate(
                  { client_id: selectedClientId, date_emission: dateEmission, date_echeance: dateEcheance, lignes },
                  { onSuccess: onClose },
                )}
                disabled={creerFacture.isPending}
              >
                <CheckCircle className="h-3.5 w-3.5" /> {creerFacture.isPending ? 'Enregistrement…' : 'Valider'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

// ── Remboursement Modal ────────────────────────────────────────────────────────

function RemboursementModal({ isOpen, onClose, credit }: { isOpen: boolean; onClose: () => void; credit: CreditRecord | null }) {
  const [type, setType]     = useState<'total' | 'partiel'>('total')
  const [montant, setMontant] = useState('')
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0])
  const rembourser = useRemboursement()

  useEffect(() => {
    if (isOpen) {
      setType('total')
      setMontant('')
      setDate(new Date().toISOString().split('T')[0])
    }
  }, [isOpen, credit?.id])

  if (!credit) return null

  const handleSubmit = () => {
    const montantFinal = type === 'total' ? (credit.solde_restant_xaf as number) : Number(montant)
    rembourser.mutate({ id: credit.id, montant: montantFinal }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enregistrer un remboursement" size="sm">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-sm font-semibold text-amber-800">{(credit.client as { nom: string }).nom} — {credit.reference as string}</div>
          <div className="text-xs text-amber-600 mt-0.5">
            Solde restant : <span className="font-bold">{formatXAF(credit.solde_restant_xaf as number)}</span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Type de remboursement</label>
          <div className="flex gap-4">
            {(['total', 'partiel'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={type === t} onChange={() => setType(t)} className="accent-[#C62828]" />
                <span className="text-sm capitalize">{t === 'total' ? 'Remboursement total' : 'Partiel'}</span>
              </label>
            ))}
          </div>
        </div>
        {type === 'partiel' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant remboursé (FCFA)</label>
            <input type="number" value={montant} onChange={(e) => setMontant(e.target.value)}
              max={credit.solde_restant_xaf as number}
              placeholder={`Max : ${(credit.solde_restant_xaf as number).toLocaleString('fr-CM')}`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de paiement</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={rembourser.isPending || (type === 'partiel' && !montant)}>
            <CheckCircle className="h-3.5 w-3.5" /> {rembourser.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Finance() {
  const [activeTab, setActiveTab]         = useState<Tab>('Factures')
  const [showNewFacture, setShowNewFacture] = useState(false)
  const [selectedFacture, setSelectedFacture] = useState<FactureRecord | null>(null)
  const [remboursementCredit, setRemboursementCredit] = useState<CreditRecord | null>(null)
  const [compteFilter, setCompteFilter]   = useState('')
  const [periodeFilter, setPeriodeFilter] = useState('')

  const { data: facturesData, isLoading: facturesLoading } = useFactures()
  const { data: creditsData,  isLoading: creditsLoading  } = useCredits()
  const { data: ecrituresData, isLoading: ecrituresLoading } = useEcritures({
    compte: compteFilter || undefined,
    mois:   periodeFilter || undefined,
  })
  const envoyerFacture = useEnvoyerFacture()

  const factures  = (facturesData?.data  ?? []) as FactureRecord[]
  const credits   = (creditsData?.data   ?? []) as CreditRecord[]
  const ecritures = ecrituresData?.data  ?? []

  const echusCount = credits.filter((c) => c.statut === 'echu').length
  const totalEchus = credits.filter((c) => c.statut === 'echu').reduce((s, c) => s + (c.solde_restant_xaf as number), 0)

  const factureColumns = useMemo<Column<FactureRecord>[]>(() => [
    { id: 'numero', header: 'Référence', accessor: 'numero', render: (v) => <span className="font-mono text-xs font-semibold text-gray-700">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: (row) => (row.client as { nom: string }).nom, render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'montant', header: 'Montant TTC', accessor: 'montant_ttc_xaf', render: (v) => <span className="text-sm font-bold">{formatXAF(v as number)}</span> },
    { id: 'date', header: 'Émission', accessor: 'date_emission', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'echeance', header: 'Échéance', accessor: 'date_echeance', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <Badge statut={v as string} map={FACT_MAP} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <div className="flex gap-1">
          <button onClick={(e) => { e.stopPropagation(); setSelectedFacture(row) }} title="Aperçu"
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button title="Télécharger PDF" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button title="Envoyer WhatsApp"
            onClick={(e) => { e.stopPropagation(); envoyerFacture.mutate(row.id as string) }}
            disabled={envoyerFacture.isPending}
            className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50">
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button title="Imprimer" onClick={(e) => { e.stopPropagation(); window.print() }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Printer className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [envoyerFacture.isPending])

  const creditColumns = useMemo<Column<CreditRecord>[]>(() => [
    { id: 'reference', header: 'Référence', accessor: 'reference', render: (v) => <span className="font-mono text-xs font-semibold text-gray-700">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: (row) => (row.client as { nom: string }).nom, render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'montant', header: 'Montant initial', accessor: 'montant_initial_xaf', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'solde', header: 'Solde restant', accessor: 'solde_restant_xaf', render: (v) => <span className="text-sm font-bold" style={{ color: (v as number) > 0 ? '#dc2626' : '#15803d' }}>{formatXAF(v as number)}</span> },
    { id: 'echeance', header: 'Échéance', accessor: 'date_echeance', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={v as string} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => row.statut !== 'rembourse' ? (
        <button
          onClick={(e) => { e.stopPropagation(); setRemboursementCredit(row) }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          <CheckCircle className="h-3 w-3" /> Rembourser
        </button>
      ) : null,
    },
  ], [])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Finance"
        subtitle="Factures · Crédits · Comptabilité · Fiscalité"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Finance' }]}
        actions={activeTab === 'Factures' ? (
          <Button size="sm" onClick={() => setShowNewFacture(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle facture
          </Button>
        ) : undefined}
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative flex items-center gap-2"
              style={{ color: activeTab === tab ? '#C62828' : '#6b7280' }}
            >
              {tab}
              {tab === 'Crédits' && echusCount > 0 && (
                <motion.span
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold"
                  style={{ backgroundColor: '#dc2626' }}
                >
                  {echusCount}
                </motion.span>
              )}
              {activeTab === tab && (
                <motion.div layoutId="finance-tab" className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: '#C62828' }} />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>

            {/* ── Factures ── */}
            {activeTab === 'Factures' && (
              selectedFacture ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setSelectedFacture(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
                      <ChevronLeft className="h-4 w-4" /> Retour à la liste
                    </button>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /> PDF</Button>
                      <Button variant="ghost" size="sm"
                        onClick={() => envoyerFacture.mutate(selectedFacture.id as string)}
                        disabled={envoyerFacture.isPending}>
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Imprimer</Button>
                    </div>
                  </div>
                  <InvoicePreview facture={selectedFacture as PreviewableFacture} />
                </div>
              ) : (
                <DataTable<FactureRecord>
                  columns={factureColumns}
                  data={factures}
                  keyField="id"
                  onRowClick={setSelectedFacture}
                  loading={facturesLoading}
                />
              )
            )}

            {/* ── Crédits ── */}
            {activeTab === 'Crédits' && (
              <div>
                {echusCount > 0 && (
                  <div className="mx-5 mt-5 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                    <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 shrink-0">
                      <AlertCircle className="h-5 w-5 text-[#dc2626]" />
                    </motion.div>
                    <div>
                      <div className="font-bold text-[#dc2626] text-sm">
                        {echusCount} crédit{echusCount > 1 ? 's' : ''} échu{echusCount > 1 ? 's' : ''} — action requise
                      </div>
                      <div className="text-xs text-red-500 mt-0.5">{formatXAF(totalEchus)} à recouvrer</div>
                    </div>
                  </div>
                )}
                <DataTable<CreditRecord> columns={creditColumns} data={credits} keyField="id" loading={creditsLoading} />
              </div>
            )}

            {/* ── Comptabilité ── */}
            {activeTab === 'Comptabilité' && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <select value={compteFilter} onChange={(e) => setCompteFilter(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white">
                    <option value="">Tous les comptes</option>
                    {SYSCOHADA.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                  <input type="month" value={periodeFilter} onChange={(e) => setPeriodeFilter(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
                  {(compteFilter || periodeFilter) && (
                    <button onClick={() => { setCompteFilter(''); setPeriodeFilter('') }}
                      className="flex items-center gap-1 text-sm text-[#C62828] font-medium hover:underline">
                      <X className="h-3.5 w-3.5" /> Effacer
                    </button>
                  )}
                  <span className="ml-auto text-xs text-gray-400">{ecritures.length} écriture{ecritures.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {['Date', 'Libellé', 'Compte', 'Débit', 'Crédit', 'Solde'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ecrituresLoading && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Chargement…</td></tr>
                      )}
                      {!ecrituresLoading && ecritures.map((l, i) => (
                        <tr key={l.id ?? i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{formatDate(l.date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{l.libelle}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{l.compte} — {l.compte_label}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[#1d4ed8]">{l.debit_xaf > 0 ? formatXAF(l.debit_xaf) : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#15803d]">{l.credit_xaf > 0 ? formatXAF(l.credit_xaf) : '—'}</td>
                          <td className="px-4 py-3 text-right font-bold" style={{ color: l.solde_xaf >= 0 ? '#1d4ed8' : '#15803d' }}>
                            {formatXAF(Math.abs(l.solde_xaf))}
                          </td>
                        </tr>
                      ))}
                      {!ecrituresLoading && ecritures.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Aucune écriture pour ces critères</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Déclarations ── */}
            {activeTab === 'Déclarations Fiscales' && (
              <div className="p-5 space-y-3">
                {DECLARATIONS.map((d) => {
                  const s = DECL_MAP[d.statut] ?? DECL_MAP.a_declarer
                  return (
                    <div key={d.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 shrink-0">
                          <ReceiptText className="h-5 w-5 text-gray-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-[#212121]">{d.type}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            Période : {d.periode} · Échéance : {formatDate(d.echeance)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {d.montant > 0 && <span className="text-sm font-bold">{formatXAF(d.montant)}</span>}
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
                        {d.statut === 'a_declarer' && <Button size="sm">Déclarer</Button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      <NouvelleFactureSlideOver isOpen={showNewFacture} onClose={() => setShowNewFacture(false)} />
      <RemboursementModal isOpen={!!remboursementCredit} onClose={() => setRemboursementCredit(null)} credit={remboursementCredit} />
    </motion.div>
  )
}
