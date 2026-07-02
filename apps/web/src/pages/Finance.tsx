import React, { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, ReceiptText,
  Plus, Download, MessageCircle, Printer,
  AlertCircle, CheckCircle, ChevronLeft, ChevronRight, X,
  Phone, Paperclip, ExternalLink, Loader2, Trash2, RefreshCw,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, Modal, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import {
  useFactures, useCredits, useEcritures, useEnvoyerFacture, useRemboursement, useCreerFacture,
  useUpdateStatutFacture, usePaiementFacture, useFinanceDashboard,
  useDeclarationsFiscales, usePreparerDeclarationTva, useUpdateStatutDeclaration, useRelanceFacture,
  usePlanComptable, useJournauxComptables, useGrandLivre,
  useBilanComptable, useResultatAnalytique,
  useSyntheseComptable, useControlesComptables,
  useClotureComptable,
  useVersementsFacture, useEnregistrerVersement,
  useCharges, useSortiesTresorerie, useChargesDashboard,
  useCreerCharge, useUpdateStatutCharge, useCreerSortieTresorerie,
  useAnnulerSortieTresorerie, useUploadJustificatifCharge, useUploadJustificatifSortie,
  useSynchroniserFactures,
} from '@/hooks/useFinance'
import type { Facture as FactureApi, Credit as CreditApi, FactureLigne, Versement, Charge, SortieTresorerie, ModePaiementSortie } from '@/hooks/useFinance'
import { useClients } from '@/hooks/useClients'
import { useCommandes } from '@/hooks/useCommandes'
import { API_BASE, apiClient } from '@/lib/api-client'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { CreditDashboard, CreditLimitForm, PaymentPlanWizard } from '@/features/credit'
import type { Commande } from '@/hooks/useCommandes'
import { useAllCreditLimits } from '@/hooks/useCredit'
import type { CreditLimitWithClient } from '@/hooks/useCredit'

// ── Types ──────────────────────────────────────────────────────────────────────

type FactureRecord = FactureApi & Record<string, unknown>
type CreditRecord  = CreditApi  & Record<string, unknown>
type ChargeRecord  = Charge     & Record<string, unknown>
type SortieRecord  = SortieTresorerie & Record<string, unknown>

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

const CHARGE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  brouillon: { label: 'Brouillon', color: '#6b7280', bg: '#f3f4f6' },
  a_valider: { label: 'À valider', color: '#d97706', bg: '#fef3c7' },
  validee:   { label: 'Validée',   color: '#1d4ed8', bg: '#dbeafe' },
  payee:     { label: 'Payée',     color: '#15803d', bg: '#dcfce7' },
  annulee:   { label: 'Annulée',   color: '#dc2626', bg: '#fee2e2' },
}

const JUSTIF_MAP: Record<string, { label: string; color: string; bg: string }> = {
  manquant:   { label: 'Manquant', color: '#dc2626', bg: '#fee2e2' },
  recu:       { label: 'Reçu',     color: '#15803d', bg: '#dcfce7' },
  non_requis: { label: 'Non requis', color: '#6b7280', bg: '#f3f4f6' },
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

const TABS = ['Dashboard', 'Factures', 'Crédits', 'Charges', 'Comptabilité', 'Déclarations Fiscales'] as const
type Tab = typeof TABS[number]
type FactureSort = 'recent' | 'oldest' | 'amount-desc' | 'amount-asc' | 'due-asc' | 'client' | 'workflow' | 'paid'

// ── PDF Preview ────────────────────────────────────────────────────────────────

interface PreviewableFacture {
  numero: string
  client: { nom: string }
  date_emission: string
  date_echeance: string
  lignes: FactureLigne[]
  montant_ht_xaf: number
  montant_tva_xaf: number
  frais_livraison_xaf?: number
  montant_ttc_xaf: number
}

function InvoicePreview({ facture }: { facture: PreviewableFacture }) {
  const fraisLivraison = Number(facture.frais_livraison_xaf ?? 0)
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
            {fraisLivraison > 0 && (
              <div className="flex justify-between text-sm py-1 border-b border-gray-100">
                <span className="text-gray-500">Livraison</span>
                <span className="font-semibold text-gray-800">{formatXAF(fraisLivraison)}</span>
              </div>
            )}
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

type FactureMode = 'commande' | 'libre' | null

function NouvelleFactureSlideOver({
  isOpen,
  onClose,
  factureeCommandeIds,
}: {
  isOpen: boolean
  onClose: () => void
  factureeCommandeIds: Set<string>
}) {
  const [step, setStep]                         = useState(1)
  const [mode, setMode]                         = useState<FactureMode>(null)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientNom, setClientNom]               = useState('')
  const [selectedCommandeId, setSelectedCommandeId] = useState('')
  const [dateEmission]                          = useState(new Date().toISOString().split('T')[0])
  const [dateEcheance, setDateEcheance]         = useState('')
  const [lignes, setLignes]                     = useState<FormLigne[]>([{ designation: '', quantite: 1, prix_unitaire_ht_xaf: 0 }])

  const { data: clientsData }   = useClients({ enabled: isOpen })
  const { data: commandesData } = useCommandes({ statut: 'delivered', enabled: isOpen })
  const clients          = clientsData?.data  ?? []
  const commandesLivrees = (commandesData?.data ?? []).filter((c) => !factureeCommandeIds.has(c.id))

  const creerFacture = useCreerFacture()
  const { ht, tva, ttc } = totalsFromLignes(lignes)

  // Réinitialiser le formulaire à chaque ouverture/fermeture
  useEffect(() => {
    if (!isOpen) {
      setStep(1)
      setMode(null)
      setSelectedClientId('')
      setClientNom('')
      setSelectedCommandeId('')
      setDateEcheance('')
      setLignes([{ designation: '', quantite: 1, prix_unitaire_ht_xaf: 0 }])
    }
  }, [isOpen])

  const handleModeSelect = (m: FactureMode) => {
    setMode(m)
    setStep(2)
  }

  const handleCommandeSelect = (cmdId: string) => {
    setSelectedCommandeId(cmdId)
    const cmd = commandesLivrees.find((c) => c.id === cmdId)
    if (cmd) {
      setSelectedClientId(cmd.client.id)
      setClientNom(cmd.client.nom)
      setLignes(cmd.lignes.map((l) => ({
        designation:          l.designation,
        quantite:             l.quantite,
        prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      })))
    }
  }

  const handleClientSelect = (id: string) => {
    setSelectedClientId(id)
    setClientNom(clients.find((c) => c.id === id)?.nom ?? '')
  }

  const updateLigne = (i: number, field: keyof FormLigne, val: string | number) => {
    const next = [...lignes]
    next[i] = { ...next[i], [field]: val }
    setLignes(next)
  }

  const previewFacture: PreviewableFacture = {
    numero: 'FACT-2026-NEW',
    client: { nom: clientNom },
    date_emission: dateEmission,
    date_echeance: dateEcheance,
    lignes,
    montant_ht_xaf:  ht,
    montant_tva_xaf: tva,
    montant_ttc_xaf: ttc,
  }

  const handleValider = () => {
    creerFacture.mutate(
      {
        client_id:   selectedClientId || undefined,
        client_nom:  clientNom,
        commande_id: mode === 'commande' ? selectedCommandeId : undefined,
        date_emission: dateEmission,
        date_echeance: dateEcheance,
        lignes,
      },
      { onSuccess: onClose },
    )
  }

  const STEPS = ['Mode', 'Sélection', 'Lignes', 'Aperçu']

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title="Nouvelle facture" width="xl">

      {/* ── Barre de progression ── */}
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
            {i < 3 && <div className="flex-1 h-px bg-gray-200" />}
          </React.Fragment>
        ))}
      </div>

      {/* ── Étape 1 : Choix du mode ── */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 mb-4">Comment voulez-vous créer cette facture ?</p>

          <button
            onClick={() => handleModeSelect('commande')}
            className="w-full flex items-start gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-[#C62828] hover:bg-red-50/30 transition-colors text-left group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#C62828]/10 shrink-0 mt-0.5 group-hover:bg-[#C62828]/20 transition-colors">
              <FileText className="h-5 w-5 text-[#C62828]" />
            </div>
            <div>
              <div className="font-semibold text-sm text-gray-800">Depuis une commande</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Sélectionnez une commande livrée — client et lignes pré-remplis automatiquement
                {commandesLivrees.length > 0 && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#C62828]/10 text-[#C62828]">
                    {commandesLivrees.length} disponible{commandesLivrees.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </button>

          <button
            onClick={() => handleModeSelect('libre')}
            className="w-full flex items-start gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-colors text-left group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 shrink-0 mt-0.5 group-hover:bg-gray-200 transition-colors">
              <Plus className="h-5 w-5 text-gray-500" />
            </div>
            <div>
              <div className="font-semibold text-sm text-gray-800">Saisie manuelle</div>
              <div className="text-xs text-gray-500 mt-0.5">Prestation ponctuelle, avoir, correction — saisissez les lignes librement</div>
            </div>
          </button>
        </div>
      )}

      {/* ── Étape 2 (mode commande) : Choisir une commande livrée ── */}
      {step === 2 && mode === 'commande' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              Commandes livrées sans facture
            </label>
            {commandesLivrees.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-xl p-8 text-center">
                <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Aucune commande livrée disponible</p>
                <p className="text-xs text-gray-300 mt-0.5">Toutes les commandes ont déjà été facturées</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {commandesLivrees.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => handleCommandeSelect(cmd.id)}
                    className={`w-full flex items-center justify-between p-3 border-2 rounded-xl text-left transition-colors ${
                      selectedCommandeId === cmd.id
                        ? 'border-[#C62828] bg-red-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                      <div>
                        <div className="font-mono text-xs font-bold text-gray-600">{cmd.reference}</div>
                        <div className="text-sm font-semibold text-gray-800 mt-0.5">{cmd.client.nom}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{cmd.date_commande ? formatDate(cmd.date_commande) : '—'}</div>
                      </div>
                    <div className="text-right shrink-0 ml-4">
                      <div className="text-sm font-bold text-gray-800">{formatXAF(cmd.montant_ttc_xaf)}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {cmd.lignes.length} ligne{cmd.lignes.length !== 1 ? 's' : ''}
                      </div>
                      {selectedCommandeId === cmd.id && (
                        <CheckCircle className="h-4 w-4 text-[#C62828] ml-auto mt-1" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCommandeId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'échéance</label>
              <input
                type="date"
                value={dateEcheance}
                onChange={(e) => setDateEcheance(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
              />
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={() => { setStep(1); setSelectedCommandeId('') }}>
              <ChevronLeft className="h-3.5 w-3.5" /> Retour
            </Button>
            <Button onClick={() => setStep(3)} disabled={!selectedCommandeId || !dateEcheance}>
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 2 (mode libre) : Client + Dates ── */}
      {step === 2 && mode === 'libre' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client</label>
            <select
              value={selectedClientId}
              onChange={(e) => handleClientSelect(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white"
            >
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
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Retour
            </Button>
            <Button onClick={() => setStep(3)} disabled={!selectedClientId || !dateEcheance}>
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Lignes (pré-remplies ou manuelles) ── */}
      {step === 3 && (
        <div className="space-y-4">
          {mode === 'commande' && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <CheckCircle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <p className="text-xs text-blue-700">Lignes pré-remplies depuis la commande · Modifiables si besoin</p>
            </div>
          )}
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
            <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft className="h-3.5 w-3.5" /> Retour</Button>
            <Button onClick={() => setStep(4)} disabled={lignes.every((l) => !l.designation)}>
              Aperçu <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 4 : Aperçu + Validation ── */}
      {step === 4 && (
        <div className="space-y-4">
          <InvoicePreview facture={previewFacture} />
          <div className="flex gap-2 justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(3)}><ChevronLeft className="h-3.5 w-3.5" /> Retour</Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Imprimer
              </Button>
              <Button onClick={handleValider} disabled={creerFacture.isPending}>
                <CheckCircle className="h-3.5 w-3.5" />
                {creerFacture.isPending ? 'Enregistrement…' : 'Valider'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

// ── Relance WhatsApp Modal (Gap 2 CDC MOD-04) ──────────────────────────────────

function RelanceModal({ isOpen, onClose, credit }: { isOpen: boolean; onClose: () => void; credit: CreditRecord | null }) {
  const [waUrl, setWaUrl]     = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isOpen || !credit) return
    setLoading(true)
    apiClient.get<{ url: string; message: string }>(`/finance/credits/${credit.id}/relance-url`)
      .then((res) => {
        setWaUrl(res.url)
        setMessage(res.message)
      })
      .catch(() => toast.error('Impossible de générer le lien de relance'))
      .finally(() => setLoading(false))
  }, [isOpen, credit?.id])

  if (!credit) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Relancer le client par WhatsApp" size="sm">
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <div className="text-sm font-semibold text-green-800">{credit.client_nom as string}</div>
          <div className="text-xs text-green-700 mt-0.5">Solde restant : <span className="font-bold">{formatXAF(credit.solde_restant_xaf as number)}</span></div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Message de relance</label>
          <textarea
            value={message}
            onChange={(e) => {
              const encoded = encodeURIComponent(e.target.value)
              const base = waUrl.split('?text=')[0]
              setMessage(e.target.value)
              setWaUrl(`${base}?text=${encoded}`)
            }}
            rows={6}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            disabled={loading || !waUrl}
            onClick={() => { window.open(waUrl, '_blank'); onClose() }}
            style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
            Ouvrir WhatsApp
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Documents justificatifs Modal (Gap 5 CDC MOD-04) ──────────────────────────

interface DocItem { id: string; nom_fichier: string; url: string; taille_bytes: number; created_at: string }

function DocumentsModal({ isOpen, onClose, credit }: { isOpen: boolean; onClose: () => void; credit: CreditRecord | null }) {
  const [docs, setDocs]         = useState<DocItem[]>([])
  const [loading, setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDocs = () => {
    if (!credit) return
    setLoading(true)
    apiClient.get<{ data: DocItem[] }>(`/finance/credits/${credit.id}/documents`)
      .then((res) => setDocs(res.data ?? []))
      .catch(() => toast.error('Erreur lors du chargement des documents'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (isOpen && credit) loadDocs() }, [isOpen, credit?.id])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !credit) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await apiClient.postForm(`/finance/credits/${credit.id}/documents`, form)
      toast.success('Document ajouté')
      loadDocs()
    } catch {
      toast.error('Erreur lors du téléversement')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!credit) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Documents justificatifs" size="sm">
      <div className="space-y-4">
        <div className="text-xs text-gray-500">Crédit : <span className="font-semibold text-gray-700">{credit.numero as string}</span> — {credit.client_nom as string}</div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : docs.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-xl p-6 text-center">
            <Paperclip className="h-6 w-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Aucun document joint</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-2.5 border border-gray-100 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <span className="text-sm truncate font-medium">{doc.nom_fichier}</span>
                  <span className="text-xs text-gray-400 shrink-0">{Math.round(doc.taille_bytes / 1024)} Ko</span>
                </div>
                <a href={doc.url} target="_blank" rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-[#C62828] shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Ajouter un document
          </Button>
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
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

  const [success, setSuccess] = useState(false)

  useEffect(() => { if (isOpen) setSuccess(false) }, [isOpen])

  const handleSubmit = () => {
    const montantFinal = type === 'total' ? (credit.solde_restant_xaf as number) : Number(montant)
    rembourser.mutate(
      { id: credit.id, montant: montantFinal, date_paiement: date, type },
      { onSuccess: () => setSuccess(true) },
    )
  }

  const handleRecu = () => {
    window.open(`/api/finance/credits/${credit.id}/recu`, '_blank')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enregistrer un remboursement" size="sm">
      {success ? (
        <div className="space-y-4 text-center py-2">
          <div className="flex justify-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Remboursement enregistré</p>
            <p className="text-xs text-gray-500 mt-1">Le solde du crédit a été mis à jour.</p>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
            <Button onClick={handleRecu}>
              <Download className="h-3.5 w-3.5" /> Générer le reçu PDF
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="text-sm font-semibold text-amber-800">{credit.client_nom as string} — {credit.numero as string}</div>
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
                placeholder={`Max : ${formatXAF(credit.solde_restant_xaf as number)}`}
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
      )}
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

function PaiementFactureModal({ isOpen, onClose, facture }: { isOpen: boolean; onClose: () => void; facture: FactureRecord | null }) {
  const [type, setType] = useState<'total' | 'partiel'>('total')
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [mode, setMode] = useState<'banque' | 'caisse'>('banque')
  const paiement = usePaiementFacture()

  useEffect(() => {
    if (isOpen) {
      setType('total')
      setMontant('')
      setDate(new Date().toISOString().split('T')[0])
      setMode('banque')
    }
  }, [isOpen, facture?.id])

  if (!facture) return null

  const solde = Number(facture.solde_restant_xaf ?? 0)
  const montantFinal = type === 'total' ? solde : Number(montant)

  const handleSubmit = () => {
    paiement.mutate({
      id: facture.id as string,
      montant_xaf: montantFinal,
      date_paiement: date,
      mode,
    }, {
      onSuccess: () => onClose(),
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Encaisser une facture" size="sm">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-sm font-semibold text-amber-800">{facture.client?.nom as string} - {facture.numero as string}</div>
          <div className="text-xs text-amber-600 mt-0.5">
            Solde restant : <span className="font-bold">{formatXAF(solde)}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Type de paiement</label>
          <div className="flex gap-4">
            {(['total', 'partiel'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={type === t} onChange={() => setType(t)} className="accent-[#C62828]" />
                <span className="text-sm">{t === 'total' ? 'Paiement total' : 'Partiel'}</span>
              </label>
            ))}
          </div>
        </div>

        {type === 'partiel' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant encaisse (FCFA)</label>
            <input type="number" value={montant} onChange={(e) => setMontant(e.target.value)}
              max={solde}
              placeholder={`Max : ${formatXAF(solde)}`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'banque' | 'caisse')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white">
              <option value="banque">Banque</option>
              <option value="caisse">Caisse</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={paiement.isPending || solde <= 0 || montantFinal <= 0 || montantFinal > solde}>
            <CheckCircle className="h-3.5 w-3.5" /> {paiement.isPending ? 'Enregistrement...' : 'Encaisser'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RelanceFactureModal({ isOpen, onClose, facture }: { isOpen: boolean; onClose: () => void; facture: FactureRecord | null }) {
  const [waUrl, setWaUrl] = useState('')
  const [message, setMessage] = useState('')
  const relance = useRelanceFacture()

  useEffect(() => {
    if (!isOpen || !facture) return
    setWaUrl('')
    setMessage('')
    relance.mutate({ id: facture.id as string }, {
      onSuccess: (res) => {
        setWaUrl(res.url)
        setMessage(res.message)
      },
    })
  }, [isOpen, facture?.id])

  if (!facture) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Relancer une facture" size="sm">
      <div className="space-y-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-3">
          <div className="text-sm font-semibold text-red-800">{facture.client?.nom as string} - {facture.numero as string}</div>
          <div className="mt-0.5 text-xs text-red-600">Solde restant : <span className="font-bold">{formatXAF(Number(facture.solde_restant_xaf ?? 0))}</span></div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Message WhatsApp</label>
          <textarea
            value={message}
            onChange={(e) => {
              const next = e.target.value
              setMessage(next)
              const base = waUrl.split('?text=')[0] || 'https://wa.me/'
              setWaUrl(`${base}?text=${encodeURIComponent(next)}`)
            }}
            rows={7}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            disabled={relance.isPending || !waUrl}
            onClick={() => { window.open(waUrl, '_blank'); onClose() }}
          >
            {relance.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
            Ouvrir WhatsApp
          </Button>
        </div>
      </div>
    </Modal>
  )
}

async function downloadFacturePdf(id: string, numero: string) {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  const res = await fetch(`${API_BASE}/api/factures/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('PDF indisponible')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${numero}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function printFacturePdf(id: string) {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  const res = await fetch(`${API_BASE}/api/factures/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('PDF indisponible')
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const win = window.open(blobUrl)
  if (win) {
    win.onload = () => { setTimeout(() => { win.focus(); win.print() }, 400) }
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}

async function downloadFinanceExport(path: string, filename: string) {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Export indisponible')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Plafonds credit list ───────────────────────────────────────────────────────

const ELIGIBILITY_LABELS: Record<string, string> = {
  PROFESSIONAL: 'Professionnel',
  INDIVIDUAL:   'Particulier',
  VIP:          'VIP',
}

function PlafondsList({ onEdit, onNew }: { onEdit: (clientId: string) => void; onNew: () => void }) {
  const { data, loading, refetch } = useAllCreditLimits()

  const plafondColumns = useMemo<Column<CreditLimitWithClient>[]>(() => [
    {
      id:       'client',
      header:   'Client',
      accessor: 'id',
      render:   (_, row) => (
        <div>
          <p className="text-sm font-semibold text-gray-900">{row.clients?.nom ?? '—'}</p>
          {row.clients?.type && <p className="text-xs text-gray-400">{row.clients.type}</p>}
        </div>
      ),
    },
    {
      id:       'plafond',
      header:   'Plafond',
      accessor: 'max_credit_amount',
      render:   (_, row) => (
        <span className="text-sm font-bold text-gray-800">{formatXAF(row.max_credit_amount)}</span>
      ),
    },
    {
      id:       'type',
      header:   'Éligibilité',
      accessor: 'eligibility_type',
      render:   (_, row) => (
        <span className="text-xs font-medium text-gray-600">
          {ELIGIBILITY_LABELS[row.eligibility_type] ?? row.eligibility_type}
        </span>
      ),
    },
    {
      id:       'statut',
      header:   'Statut',
      accessor: 'is_active',
      render:   (_, row) => (
        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {row.is_active ? 'Actif' : 'Inactif'}
        </span>
      ),
    },
    {
      id:       'criteres',
      header:   'Critères min.',
      accessor: 'id',
      render:   (_, row) => (
        <span className="text-xs text-gray-500">
          {row.min_order_history_months}m · {row.min_past_orders_count} cmd
        </span>
      ),
    },
    {
      id:       'actions',
      header:   '',
      accessor: 'id',
      csvSkip:  true,
      render:   (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(row.customer_id) }}
          className="text-xs font-semibold text-[#C62828] hover:underline"
        >
          Modifier
        </button>
      ),
    },
  ], [onEdit])

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
        <p className="text-xs text-gray-500">{data.length} plafond{data.length !== 1 ? 's' : ''} configuré{data.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <button onClick={refetch} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Actualiser
          </button>
          <Button size="sm" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" /> Nouveau plafond
          </Button>
        </div>
      </div>
      <DataTable<CreditLimitWithClient>
        columns={plafondColumns}
        data={data}
        keyField="id"
        loading={loading}
        emptyMessage="Aucun plafond configuré — cliquez sur « Nouveau plafond » pour en créer un"
      />
    </div>
  )
}

// ── Order selector before PaymentPlanWizard ────────────────────────────────────

function OrderSelectorModal({ isOpen, onClose, onSelect }: {
  isOpen:   boolean
  onClose:  () => void
  onSelect: (c: Commande) => void
}) {
  const { data: commandesData } = useCommandes({ enabled: isOpen })
  const [selectedId, setSelectedId] = useState('')

  const commandes = (commandesData?.data ?? []).filter(c => c.statut !== 'cancelled')
  const selected  = commandes.find(c => c.id === selectedId) ?? null

  function handleConfirm() {
    if (selected) { onSelect(selected); setSelectedId('') }
  }

  return (
    <Modal isOpen={isOpen} onClose={() => { setSelectedId(''); onClose() }} title="Sélectionner une commande" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-gray-500 mb-1.5">Commande</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
          >
            <option value="">— Choisir une commande —</option>
            {commandes.map(c => (
              <option key={c.id} value={c.id}>
                {c.reference} — {c.client.nom} — reste {formatXAF(c.solde_restant_xaf)}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm space-y-1">
            <div className="font-semibold text-blue-800">{selected.client.nom}</div>
            <div className="text-xs text-blue-600">Réf : {selected.reference}</div>
            <div className="text-xs text-blue-600">
              Total : {formatXAF(selected.montant_ttc_xaf)}
              {selected.acompte_recu_xaf > 0 && (
                <span> · Acompte : {formatXAF(selected.acompte_recu_xaf)} · <strong>Reste : {formatXAF(selected.solde_restant_xaf)}</strong></span>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => { setSelectedId(''); onClose() }}>Annuler</Button>
          <Button disabled={!selected} onClick={handleConfirm}>
            <Plus className="h-3.5 w-3.5" /> Créer le plan
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const MODE_VERSEMENT_LABELS: Record<Versement['mode_paiement'], string> = {
  orange_money: 'Orange Money',
  mtn_momo:     'MTN MoMo',
  virement:     'Virement',
  especes:      'Espèces',
  cheque:       'Chèque',
  autre:        'Autre',
}

function NouveauVersementModal({
  isOpen,
  onClose,
  facture,
}: {
  isOpen:   boolean
  onClose:  () => void
  facture:  FactureRecord | null
}) {
  const [montant,    setMontant]    = useState('')
  const [date,       setDate]       = useState(new Date().toISOString().split('T')[0])
  const [mode,       setMode]       = useState<Versement['mode_paiement']>('orange_money')
  const [reference,  setReference]  = useState('')
  const [note,       setNote]       = useState('')
  const enregistrer = useEnregistrerVersement()

  useEffect(() => {
    if (isOpen) {
      setMontant('')
      setDate(new Date().toISOString().split('T')[0])
      setMode('orange_money')
      setReference('')
      setNote('')
    }
  }, [isOpen, facture?.id])

  if (!facture) return null

  const solde      = Number(facture.solde_restant_xaf ?? 0)
  const montantNum = Number(montant)

  const handleSubmit = () => {
    enregistrer.mutate(
      {
        factureId:      facture.id as string,
        montant_xaf:    montantNum,
        date_versement: date,
        mode_paiement:  mode,
        reference:      reference || undefined,
        note:           note || undefined,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enregistrer un versement" size="sm">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-sm font-semibold text-amber-800">
            {facture.client?.nom as string} — {facture.numero as string}
          </div>
          <div className="text-xs text-amber-600 mt-0.5">
            Solde restant : <span className="font-bold">{formatXAF(solde)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant (FCFA)</label>
            <input
              type="number"
              value={montant}
              onChange={e => setMontant(e.target.value)}
              max={solde}
              placeholder={`Max : ${formatXAF(solde)}`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mode de paiement</label>
          <select
            value={mode}
            onChange={e => setMode(e.target.value as Versement['mode_paiement'])}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white"
          >
            {(Object.entries(MODE_VERSEMENT_LABELS) as [Versement['mode_paiement'], string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Référence <span className="text-gray-400 font-normal normal-case">(optionnel)</span>
          </label>
          <input
            type="text"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="Ex: MP260601123"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Note <span className="text-gray-400 font-normal normal-case">(optionnel)</span>
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            onClick={handleSubmit}
            disabled={enregistrer.isPending || !montant || montantNum <= 0 || montantNum > solde || !date}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function NouvelleChargeModal({
  isOpen,
  onClose,
  comptesCharges,
}: {
  isOpen: boolean
  onClose: () => void
  comptesCharges: Array<{ compte: string; libelle: string }>
}) {
  const creerCharge = useCreerCharge()
  const today = new Date().toISOString().slice(0, 10)
  const firstCompte = comptesCharges[0]?.compte ?? '601'
  const [form, setForm] = useState({
    fournisseur_nom: '',
    categorie: 'Fournitures',
    compte_charge: firstCompte,
    date_charge: today,
    date_echeance: '',
    montant_ht_xaf: '',
    tva_xaf: '0',
    justificatif_statut: 'manquant' as const,
    description: '',
  })

  useEffect(() => {
    if (isOpen) {
      setForm({
        fournisseur_nom: '',
        categorie: 'Fournitures',
        compte_charge: firstCompte,
        date_charge: today,
        date_echeance: '',
        montant_ht_xaf: '',
        tva_xaf: '0',
        justificatif_statut: 'manquant',
        description: '',
      })
    }
  }, [isOpen, firstCompte, today])

  const ht = Number(form.montant_ht_xaf || 0)
  const tva = Number(form.tva_xaf || 0)
  const total = ht + tva

  const handleSubmit = () => {
    creerCharge.mutate({
      fournisseur_nom: form.fournisseur_nom,
      categorie: form.categorie,
      compte_charge: form.compte_charge,
      date_charge: form.date_charge,
      date_echeance: form.date_echeance || undefined,
      montant_ht_xaf: ht,
      tva_xaf: tva,
      justificatif_statut: form.justificatif_statut,
      description: form.description || undefined,
    }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nouvelle charge" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Fournisseur</label>
            <input value={form.fournisseur_nom} onChange={(e) => setForm({ ...form, fournisseur_nom: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Catégorie</label>
            <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30">
              {['Fournitures', 'Matières premières', 'Transport entreprise', 'Loyer', 'Énergie', 'Maintenance', 'Personnel', 'Services externes', 'Autres'].map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Compte charge</label>
            <select value={form.compte_charge} onChange={(e) => setForm({ ...form, compte_charge: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30">
              {comptesCharges.map((compte) => (
                <option key={compte.compte} value={compte.compte}>{compte.compte} - {compte.libelle}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Justificatif</label>
            <select value={form.justificatif_statut} onChange={(e) => setForm({ ...form, justificatif_statut: e.target.value as typeof form.justificatif_statut })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30">
              <option value="manquant">Manquant</option>
              <option value="recu">Reçu</option>
              <option value="non_requis">Non requis</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Date charge</label>
            <input type="date" value={form.date_charge} onChange={(e) => setForm({ ...form, date_charge: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Échéance</label>
            <input type="date" value={form.date_echeance} onChange={(e) => setForm({ ...form, date_echeance: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Montant HT</label>
            <input type="number" min="0" value={form.montant_ht_xaf} onChange={(e) => setForm({ ...form, montant_ht_xaf: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">TVA déductible</label>
            <input type="number" min="0" value={form.tva_xaf} onChange={(e) => setForm({ ...form, tva_xaf: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Description</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-[76px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-500">Total TTC</span>
          <span className="font-bold text-[#212121]">{formatXAF(total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={creerCharge.isPending || !form.fournisseur_nom || ht <= 0}>
            {creerCharge.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Créer
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function NouvelleSortieModal({
  isOpen,
  onClose,
  charges,
  selectedCharge,
}: {
  isOpen: boolean
  onClose: () => void
  charges: ChargeRecord[]
  selectedCharge: ChargeRecord | null
}) {
  const creerSortie = useCreerSortieTresorerie()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    charge_id: '',
    date_sortie: today,
    beneficiaire: '',
    motif: '',
    montant_xaf: '',
    mode_paiement: 'banque' as ModePaiementSortie,
    compte_tresorerie: '521',
    reference_paiement: '',
    justificatif_statut: 'manquant' as const,
  })

  useEffect(() => {
    if (isOpen) {
      const charge = selectedCharge
      setForm({
        charge_id: charge?.id ?? '',
        date_sortie: today,
        beneficiaire: charge?.fournisseur_nom ?? '',
        motif: charge ? `Paiement ${charge.numero}` : '',
        montant_xaf: charge ? String(Math.max(0, Number(charge.solde_restant_xaf ?? 0))) : '',
        mode_paiement: 'banque',
        compte_tresorerie: '521',
        reference_paiement: '',
        justificatif_statut: 'manquant',
      })
    }
  }, [isOpen, selectedCharge, today])

  const handleModeChange = (mode: ModePaiementSortie) => {
    setForm({ ...form, mode_paiement: mode, compte_tresorerie: mode === 'caisse' ? '571' : '521' })
  }

  const charge = charges.find((item) => item.id === form.charge_id)
  const solde = charge ? Number(charge.solde_restant_xaf ?? 0) : null

  const handleSubmit = () => {
    creerSortie.mutate({
      charge_id: form.charge_id || undefined,
      date_sortie: form.date_sortie,
      beneficiaire: form.beneficiaire,
      motif: form.motif,
      montant_xaf: Number(form.montant_xaf || 0),
      mode_paiement: form.mode_paiement,
      compte_tresorerie: form.compte_tresorerie,
      reference_paiement: form.reference_paiement || undefined,
      justificatif_statut: form.justificatif_statut,
    }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sortie de trésorerie" size="md">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Charge rattachée</label>
          <select value={form.charge_id} onChange={(e) => {
            const next = charges.find((item) => item.id === e.target.value)
            setForm({
              ...form,
              charge_id: e.target.value,
              beneficiaire: next?.fournisseur_nom ?? form.beneficiaire,
              motif: next ? `Paiement ${next.numero}` : form.motif,
              montant_xaf: next ? String(Math.max(0, Number(next.solde_restant_xaf ?? 0))) : form.montant_xaf,
            })
          }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30">
            <option value="">Sortie hors charge validée</option>
            {charges.filter((item) => ['validee', 'payee'].includes(item.statut) && Number(item.solde_restant_xaf ?? 0) > 0).map((item) => (
              <option key={item.id} value={item.id}>{item.numero} - {item.fournisseur_nom} - solde {formatXAF(item.solde_restant_xaf)}</option>
            ))}
          </select>
        </div>
        {solde !== null && (
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Solde de la charge : <span className="font-bold">{formatXAF(solde)}</span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Bénéficiaire</label>
            <input value={form.beneficiaire} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Date sortie</label>
            <input type="date" value={form.date_sortie} onChange={(e) => setForm({ ...form, date_sortie: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Montant</label>
            <input type="number" min="0" value={form.montant_xaf} onChange={(e) => setForm({ ...form, montant_xaf: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Mode</label>
            <select value={form.mode_paiement} onChange={(e) => handleModeChange(e.target.value as ModePaiementSortie)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30">
              <option value="banque">Banque</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="caisse">Caisse</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Compte trésorerie</label>
            <input value={form.compte_tresorerie} onChange={(e) => setForm({ ...form, compte_tresorerie: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Référence paiement</label>
            <input value={form.reference_paiement} onChange={(e) => setForm({ ...form, reference_paiement: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Motif</label>
          <input value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={creerSortie.isPending || !form.beneficiaire || !form.motif || Number(form.montant_xaf || 0) <= 0}>
            {creerSortie.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function JustificatifChargeModal({ charge, onClose }: { charge: ChargeRecord | null; onClose: () => void }) {
  const upload = useUploadJustificatifCharge()
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (charge) {
      setFile(null)
      setDescription('')
    }
  }, [charge?.id])

  if (!charge) return null

  const handleUpload = () => {
    if (!file) return
    upload.mutate({ chargeId: charge.id, file, description: description || undefined }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={!!charge} onClose={onClose} title="Justificatif de charge" size="sm">
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="font-semibold text-[#212121]">{charge.numero} - {charge.fournisseur_nom}</div>
          <div className="mt-0.5 text-xs text-gray-500">{formatXAF(charge.montant_ttc_xaf)}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Fichier PDF ou image</label>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-600" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            className="min-h-[76px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleUpload} disabled={upload.isPending || !file}>
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            Téléverser
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function JustificatifSortieModal({ sortie, onClose }: { sortie: SortieRecord | null; onClose: () => void }) {
  const upload = useUploadJustificatifSortie()
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (sortie) {
      setFile(null)
      setDescription('')
    }
  }, [sortie?.id])

  if (!sortie) return null

  const handleUpload = () => {
    if (!file) return
    upload.mutate({ sortieId: sortie.id, file, description: description || undefined }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={!!sortie} onClose={onClose} title="Justificatif de sortie" size="sm">
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="font-semibold text-[#212121]">{sortie.numero} - {sortie.beneficiaire}</div>
          <div className="mt-0.5 text-xs text-gray-500">{formatXAF(sortie.montant_xaf)}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Fichier PDF ou image</label>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-600" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            className="min-h-[76px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleUpload} disabled={upload.isPending || !file}>
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            Téléverser
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Finance() {
  const [activeTab, setActiveTab]         = useState<Tab>('Dashboard')
  const [creditSubTab, setCreditSubTab]   = useState<'tableau-de-bord' | 'creances' | 'plafonds'>('tableau-de-bord')
  const [editLimitClientId, setEditLimitClientId] = useState<string | null>(null)
  const [showCreditLimitForm, setShowCreditLimitForm] = useState(false)
  const [showOrderSelector, setShowOrderSelector]   = useState(false)
  const [planOrder, setPlanOrder]                   = useState<Commande | null>(null)
  const [showNewFacture, setShowNewFacture] = useState(false)
  const [factureStatusSort, setFactureStatusSort] = useState<FactureSort>('recent')
  const [selectedFacture, setSelectedFacture] = useState<FactureRecord | null>(null)
  const [paiementFacture, setPaiementFacture] = useState<FactureRecord | null>(null)
  const [relanceFacture, setRelanceFacture] = useState<FactureRecord | null>(null)
  const [remboursementCredit, setRemboursementCredit] = useState<CreditRecord | null>(null)
  const [relanceCredit, setRelanceCredit] = useState<CreditRecord | null>(null)
  const [documentsCredit, setDocumentsCredit] = useState<CreditRecord | null>(null)
  const [showNouveauVersement, setShowNouveauVersement] = useState(false)
  const [showNewCharge, setShowNewCharge] = useState(false)
  const [showNewSortie, setShowNewSortie] = useState(false)
  const [sortieCharge, setSortieCharge] = useState<ChargeRecord | null>(null)
  const [documentsCharge, setDocumentsCharge] = useState<ChargeRecord | null>(null)
  const [documentsSortie, setDocumentsSortie] = useState<SortieRecord | null>(null)
  const [compteFilter, setCompteFilter]   = useState('')
  const [periodeFilter, setPeriodeFilter] = useState('')
  const [periodeTva, setPeriodeTva]       = useState(new Date().toISOString().slice(0, 7))
  const exerciceCourant = String(new Date().getFullYear())
  const [exerciceCompta, setExerciceCompta] = useState(exerciceCourant)
  const [grandLivreDebut, setGrandLivreDebut] = useState(`${exerciceCourant}-01-01`)
  const [grandLivreFin, setGrandLivreFin] = useState(`${exerciceCourant}-12-31`)

  const { data: versementsData, isLoading: versementsLoading } = useVersementsFacture(
    selectedFacture?.id as string ?? null,
  )

  const { data: facturesData, isLoading: facturesLoading } = useFactures({ per_page: 500 })
  const { data: creditsData,  isLoading: creditsLoading  } = useCredits()
  const { data: ecrituresData, isLoading: ecrituresLoading } = useEcritures({
    compte: compteFilter || undefined,
    mois:   periodeFilter || undefined,
  })
  const { data: planComptableData } = usePlanComptable()
  const { data: journauxData } = useJournauxComptables()
  const { data: grandLivreData, isLoading: grandLivreLoading } = useGrandLivre({
    compte: compteFilter || undefined,
    debut: grandLivreDebut,
    fin: grandLivreFin,
  })
  const { data: bilanData } = useBilanComptable({ exercice: exerciceCompta })
  const { data: resultatData } = useResultatAnalytique({ exercice: exerciceCompta })
  const { data: syntheseComptableData } = useSyntheseComptable({ exercice: exerciceCompta })
  const { data: controlesComptablesData } = useControlesComptables({ exercice: exerciceCompta })
  const { data: clotureComptableData } = useClotureComptable({ exercice: exerciceCompta })
  const { data: dashboardEcrituresData } = useEcritures()
  const { data: financeDashboardData } = useFinanceDashboard()
  const { data: chargesData, isLoading: chargesLoading } = useCharges()
  const { data: sortiesData, isLoading: sortiesLoading } = useSortiesTresorerie()
  const { data: chargesDashboardData } = useChargesDashboard()
  const { data: declarationsData, isLoading: declarationsLoading } = useDeclarationsFiscales({ type: 'TVA' })
  const envoyerFacture = useEnvoyerFacture()
  const synchroniserFactures = useSynchroniserFactures()
  const updateStatutFacture = useUpdateStatutFacture()
  const updateStatutCharge = useUpdateStatutCharge()
  const annulerSortie = useAnnulerSortieTresorerie()
  const preparerTva = usePreparerDeclarationTva()
  const updateStatutDeclaration = useUpdateStatutDeclaration()

  const factures  = (facturesData?.data  ?? []) as FactureRecord[]
  const credits   = (creditsData?.data   ?? []) as CreditRecord[]
  const charges   = (chargesData?.data   ?? []) as ChargeRecord[]
  const sortiesTresorerie = (sortiesData?.data ?? []) as SortieRecord[]
  const ecritures = ecrituresData?.data  ?? []
  const dashboardEcritures = dashboardEcrituresData?.data ?? []
  const declarations = declarationsData?.data ?? []
  const comptesOptions = planComptableData?.comptes ?? SYSCOHADA.map((c) => ({
    compte: c.code,
    libelle: c.label.replace(`${c.code} — `, ''),
    classe: Number(c.code[0]),
    categorie: 'Comptable',
    nature: 'compte',
    sens_normal: 'debit' as const,
    rubrique: 'Plan comptable',
  }))
  const compteSelectionne = comptesOptions.find((c) => c.compte === compteFilter)
  const comptesCharges = comptesOptions.filter((c) => String(c.compte).startsWith('6'))
  const journaux = journauxData?.data ?? []
  const reglesComptables = journauxData?.regles ?? []

  // IDs des commandes déjà facturées (pour filtrer le picker du slide-over)
  const factureeCommandeIds = useMemo(
    () => new Set(factures.map((f) => f.commande_id as string).filter(Boolean)),
    [factures],
  )
  const facturesTriees = useMemo(() => {
    const order: Record<string, number> = factureStatusSort === 'paid'
      ? { paye: 0, envoye: 1, valide: 2, brouillon: 3, annule: 4 }
      : factureStatusSort === 'workflow'
        ? { brouillon: 0, valide: 1, envoye: 2, paye: 3, annule: 4 }
        : {}

    return [...factures].sort((a, b) => {
      if (factureStatusSort === 'recent') {
        return String(b.date_emission ?? b.created_at ?? '').localeCompare(String(a.date_emission ?? a.created_at ?? ''))
      }
      if (factureStatusSort === 'oldest') {
        return String(a.date_emission ?? a.created_at ?? '').localeCompare(String(b.date_emission ?? b.created_at ?? ''))
      }
      if (factureStatusSort === 'amount-desc') {
        return Number(b.montant_ttc_xaf ?? 0) - Number(a.montant_ttc_xaf ?? 0)
      }
      if (factureStatusSort === 'amount-asc') {
        return Number(a.montant_ttc_xaf ?? 0) - Number(b.montant_ttc_xaf ?? 0)
      }
      if (factureStatusSort === 'due-asc') {
        return String(a.date_echeance ?? '').localeCompare(String(b.date_echeance ?? ''))
      }
      if (factureStatusSort === 'client') {
        const leftClient = String((a.client as { nom?: string } | undefined)?.nom ?? a.client_nom ?? '')
        const rightClient = String((b.client as { nom?: string } | undefined)?.nom ?? b.client_nom ?? '')
        return leftClient.localeCompare(rightClient, 'fr', { sensitivity: 'base' })
      }
      const left = order[String(a.statut ?? '')] ?? 99
      const right = order[String(b.statut ?? '')] ?? 99
      if (left !== right) return left - right
      return String(b.date_emission ?? b.created_at ?? '').localeCompare(String(a.date_emission ?? a.created_at ?? ''))
    })
  }, [factureStatusSort, factures])

  const echusCount = credits.filter((c) => c.statut === 'echu').length
  const totalEchus = credits.filter((c) => c.statut === 'echu').reduce((s, c) => s + (c.solde_restant_xaf as number), 0)
  const financeSummary = useMemo(() => {
    const facturesActives = factures.filter((f) => f.statut !== 'annule')
    const caFacture = facturesActives.reduce((s, f) => s + Number(f.montant_ttc_xaf ?? 0), 0)
    const encaisse = facturesActives.reduce((s, f) => s + Number(f.montant_paye_xaf ?? 0), 0)
    const aRecevoir = facturesActives.reduce((s, f) => s + Number(f.solde_restant_xaf ?? 0), 0)
    const brouillons = facturesActives.filter((f) => f.statut === 'brouillon')
    const aRelancer = facturesActives.filter((f) => ['valide', 'envoye'].includes(f.statut as string) && Number(f.solde_restant_xaf ?? 0) > 0)
    const payees = facturesActives.filter((f) => f.statut === 'paye').length
    const creditsOuverts = credits.filter((c) => c.statut !== 'rembourse')
    const creditsSolde = creditsOuverts.reduce((s, c) => s + Number(c.solde_restant_xaf ?? 0), 0)
    const banqueCaisse = dashboardEcritures
      .filter((e) => ['521', '571'].includes(String(e.compte_syscohada ?? e.compte ?? '')))
      .reduce((s, e) => s + Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0), 0)
    const tauxEncaissement = caFacture > 0 ? Math.round((encaisse / caFacture) * 100) : 0

    const apiKpis = financeDashboardData?.kpis
    return {
      caFacture,
      encaisse,
      aRecevoir,
      brouillons,
      aRelancer,
      payees,
      totalFactures: facturesActives.length,
      creditsSolde,
      banqueCaisse,
      tauxEncaissement,
      apiKpis,
      apiRepartition: financeDashboardData?.repartition_factures,
      apiEcritures: financeDashboardData?.dernieres_ecritures,
    }
  }, [credits, dashboardEcritures, factures, financeDashboardData])

  const dashboardKpis = {
    caFacture: financeSummary.apiKpis?.ca_facture_xaf ?? financeSummary.caFacture,
    encaisse: financeSummary.apiKpis?.encaisse_xaf ?? financeSummary.encaisse,
    aRecevoir: financeSummary.apiKpis?.a_recevoir_xaf ?? financeSummary.aRecevoir,
    banqueCaisse: financeSummary.apiKpis?.banque_caisse_xaf ?? financeSummary.banqueCaisse,
    tauxEncaissement: financeSummary.apiKpis?.taux_encaissement ?? financeSummary.tauxEncaissement,
    totalFactures: financeSummary.apiKpis?.factures_total ?? financeSummary.totalFactures,
    brouillons: financeSummary.apiKpis?.factures_brouillon ?? financeSummary.brouillons.length,
    aRelancer: financeSummary.apiKpis?.factures_a_relancer ?? financeSummary.aRelancer.length,
    enRetard: financeSummary.apiKpis?.factures_en_retard ?? financeSummary.aRelancer.filter((f) => String(f.date_echeance ?? '') < new Date().toISOString().slice(0, 10)).length,
    montantRetard: financeSummary.apiKpis?.montant_retard_xaf ?? financeSummary.aRelancer
      .filter((f) => String(f.date_echeance ?? '') < new Date().toISOString().slice(0, 10))
      .reduce((s, f) => s + Number(f.solde_restant_xaf ?? 0), 0),
    creditsOuverts: financeSummary.apiKpis?.credits_ouverts ?? credits.filter((c) => c.statut !== 'rembourse').length,
    creditsSolde: financeSummary.apiKpis?.credits_solde_xaf ?? financeSummary.creditsSolde,
  }

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
          {row.statut === 'brouillon' && (
            <button title="Valider"
              onClick={(e) => { e.stopPropagation(); updateStatutFacture.mutate({ id: row.id as string, statut: 'valide' }) }}
              disabled={updateStatutFacture.isPending}
              className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50">
              <CheckCircle className="h-3.5 w-3.5" />
            </button>
          )}
          {Number(row.solde_restant_xaf ?? 0) > 0 && row.statut !== 'annule' && (
            <button title="Encaisser"
              onClick={(e) => { e.stopPropagation(); setPaiementFacture(row) }}
              className="p-1.5 rounded hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors">
              <ReceiptText className="h-3.5 w-3.5" />
            </button>
          )}
          {Number(row.solde_restant_xaf ?? 0) > 0 && !['annule', 'paye'].includes(row.statut as string) && (
            <button title="Relancer"
              onClick={(e) => { e.stopPropagation(); setRelanceFacture(row) }}
              className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
              <AlertCircle className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setSelectedFacture(row) }} title="Aperçu"
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button title="Telecharger PDF"
            onClick={(e) => {
              e.stopPropagation()
              downloadFacturePdf(row.id as string, row.numero as string).catch((err: Error) => toast.error(err.message))
            }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button title="Marquer envoyee"
            onClick={(e) => { e.stopPropagation(); envoyerFacture.mutate(row.id as string) }}
            disabled={envoyerFacture.isPending || row.statut === 'annule' || row.statut === 'paye'}
            className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50">
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button title="Imprimer" onClick={(e) => { e.stopPropagation(); printFacturePdf(row.id as string).catch((err: Error) => toast.error(err.message)) }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Printer className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [envoyerFacture.isPending, updateStatutFacture.isPending])

  const creditColumns = useMemo<Column<CreditRecord>[]>(() => [
    { id: 'numero', header: 'Référence', accessor: 'numero', render: (v) => <span className="font-mono text-xs font-semibold text-gray-700">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: 'client_nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'montant', header: 'Montant initial', accessor: 'montant_xaf', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'solde', header: 'Solde restant', accessor: 'solde_restant_xaf', render: (v) => <span className="text-sm font-bold" style={{ color: (v as number) > 0 ? '#dc2626' : '#15803d' }}>{formatXAF(v as number)}</span> },
    { id: 'echeance', header: 'Échéance', accessor: 'echeance', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={v as string} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <div className="flex items-center gap-1">
          {row.statut !== 'rembourse' && (
            <button title="Rembourser"
              onClick={(e) => { e.stopPropagation(); setRemboursementCredit(row) }}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              <CheckCircle className="h-3 w-3" /> Rembourser
            </button>
          )}
          {row.statut !== 'rembourse' && (
            <button title="Relancer le client par WhatsApp"
              onClick={(e) => { e.stopPropagation(); setRelanceCredit(row) }}
              className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors">
              <Phone className="h-3.5 w-3.5" />
            </button>
          )}
          <button title="Documents justificatifs"
            onClick={(e) => { e.stopPropagation(); setDocumentsCredit(row) }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Paperclip className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Finance"
        subtitle="Factures · Crédits · Charges · Comptabilité · Fiscalité"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Finance' }]}
        actions={activeTab === 'Dashboard' ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              const now = new Date()
              const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
              const to = now.toISOString().slice(0, 10)
              downloadFinanceExport(`/api/finance/exports/indicateurs.xls?from=${from}&to=${to}`, `rapport-finance-${from}-${to}.xls`).catch((err: Error) => toast.error(err.message))
            }}>
              <Download className="h-3.5 w-3.5" /> Rapport Finance
            </Button>
            <Button size="sm" variant="ghost" onClick={() =>
              downloadFinanceExport(`/api/finance/exports/tva.xls?periode=${periodeTva}`, `rapport-tva-${periodeTva}.xls`).catch((err: Error) => toast.error(err.message))
            }>
              <Download className="h-3.5 w-3.5" /> TVA
            </Button>
          </div>
        ) : activeTab === 'Factures' ? (
          <Button size="sm" onClick={() => setShowNewFacture(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle facture
          </Button>
        ) : activeTab === 'Charges' ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              const now = new Date()
              const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
              const to = now.toISOString().slice(0, 10)
              downloadFinanceExport(`/api/finance/exports/charges.xls?from=${from}&to=${to}`, `rapport-charges-${from}-${to}.xls`).catch((err: Error) => toast.error(err.message))
            }}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setSortieCharge(null); setShowNewSortie(true) }}>
              <ReceiptText className="h-3.5 w-3.5" /> Sortie
            </Button>
            <Button size="sm" onClick={() => setShowNewCharge(true)}>
              <Plus className="h-3.5 w-3.5" /> Nouvelle charge
            </Button>
          </div>
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
              {tab === 'Factures' && dashboardKpis.brouillons > 0 && (
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold"
                  style={{ backgroundColor: '#d97706' }}
                >
                  {dashboardKpis.brouillons}
                </span>
              )}
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
              {tab === 'Charges' && (chargesDashboardData?.kpis?.charges_a_valider ?? 0) > 0 && (
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold"
                  style={{ backgroundColor: '#d97706' }}
                >
                  {chargesDashboardData?.kpis?.charges_a_valider}
                </span>
              )}
              {activeTab === tab && (
                <motion.div layoutId="finance-tab" className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: '#C62828' }} />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>

            {activeTab === 'Dashboard' && (
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    { label: 'CA facture', value: formatXAF(dashboardKpis.caFacture), hint: `${dashboardKpis.totalFactures} facture${dashboardKpis.totalFactures !== 1 ? 's' : ''}`, color: '#C62828' },
                    { label: 'Encaisse', value: formatXAF(dashboardKpis.encaisse), hint: `${dashboardKpis.tauxEncaissement}% du CA`, color: '#15803d' },
                    { label: 'A recevoir', value: formatXAF(dashboardKpis.aRecevoir), hint: `${dashboardKpis.aRelancer} facture${dashboardKpis.aRelancer !== 1 ? 's' : ''} a suivre`, color: '#d97706' },
                    { label: 'Factures en retard', value: String(dashboardKpis.enRetard), hint: formatXAF(dashboardKpis.montantRetard), color: '#dc2626' },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="text-xs font-semibold uppercase text-gray-400">{kpi.label}</div>
                      <div className="mt-2 text-xl font-black text-[#212121]">{kpi.value}</div>
                      <div className="mt-1 text-xs font-medium" style={{ color: kpi.color }}>{kpi.hint}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="xl:col-span-2 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Priorites finance</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Validation, recouvrement et risques client.</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setActiveTab('Factures')}>
                        <ExternalLink className="h-3.5 w-3.5" /> Factures
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: 'Factures brouillon a valider', count: dashboardKpis.brouillons, amount: financeSummary.brouillons.reduce((s, f) => s + Number(f.montant_ttc_xaf ?? 0), 0), tone: '#1d4ed8' },
                        { label: 'Factures a encaisser ou relancer', count: dashboardKpis.aRelancer, amount: dashboardKpis.aRecevoir, tone: '#d97706' },
                        { label: 'Credits client ouverts', count: dashboardKpis.creditsOuverts, amount: dashboardKpis.creditsSolde, tone: '#dc2626' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-800">{item.label}</div>
                            <div className="text-xs text-gray-400">{item.count} dossier{item.count !== 1 ? 's' : ''}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-black" style={{ color: item.tone }}>{formatXAF(item.amount)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-bold text-[#212121] mb-4">Repartition factures</h3>
                    <div className="space-y-3">
                      {Object.entries(FACT_MAP).filter(([key]) => key !== 'annule').map(([statut, meta]) => {
                        const count = financeSummary.apiRepartition?.find((item) => item.statut === statut)?.count
                          ?? factures.filter((f) => f.statut === statut).length
                        const pct = dashboardKpis.totalFactures > 0 ? Math.round((count / dashboardKpis.totalFactures) * 100) : 0
                        return (
                          <div key={statut}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-semibold text-gray-600">{meta.label}</span>
                              <span className="text-gray-400">{count} - {pct}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Factures en retard</h3>
                        <p className="mt-0.5 text-xs text-gray-400">Priorité de relance et d'encaissement.</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setActiveTab('Factures')}>
                        <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
                      </Button>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {(financeDashboardData?.factures_en_retard ?? []).slice(0, 5).map((facture) => (
                        <div key={facture.id} className="flex items-center justify-between py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-800">{facture.numero} - {facture.client_nom}</div>
                            <div className="text-xs text-gray-400">Échéance {formatDate(facture.date_echeance)}</div>
                          </div>
                          <div className="text-right text-sm font-black text-[#dc2626]">{formatXAF(facture.solde_restant_xaf)}</div>
                        </div>
                      ))}
                      {(financeDashboardData?.factures_en_retard ?? []).length === 0 && (
                        <div className="py-8 text-center text-sm text-gray-400">Aucune facture en retard</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-[#212121]">Top clients débiteurs</h3>
                    <div className="divide-y divide-gray-50">
                      {(financeDashboardData?.top_clients_debiteurs ?? []).slice(0, 5).map((client) => (
                        <div key={client.client_id ?? client.client_nom} className="flex items-center justify-between py-2">
                          <div>
                            <div className="text-sm font-semibold text-gray-800">{client.client_nom}</div>
                            <div className="text-xs text-gray-400">{client.factures} facture{client.factures !== 1 ? 's' : ''} ouverte{client.factures !== 1 ? 's' : ''}</div>
                          </div>
                          <div className="text-right text-sm font-black text-[#d97706]">{formatXAF(client.solde_xaf)}</div>
                        </div>
                      ))}
                      {(financeDashboardData?.top_clients_debiteurs ?? []).length === 0 && (
                        <div className="py-8 text-center text-sm text-gray-400">Aucun solde client ouvert</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#212121]">Dernieres ecritures</h3>
                    <Button size="sm" variant="ghost" onClick={() => setActiveTab('Comptabilité')}>
                      <ExternalLink className="h-3.5 w-3.5" /> Comptabilite
                    </Button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {(financeSummary.apiEcritures ?? dashboardEcritures).slice(0, 5).map((e) => (
                      <div key={e.id} className="flex items-center justify-between py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 truncate">{e.libelle}</div>
                          <div className="text-xs text-gray-400">{formatDate(e.date)} - {e.compte_syscohada} {e.compte_label}</div>
                        </div>
                        <div className="text-right text-xs font-bold">
                          {Number(e.debit_xaf ?? 0) > 0 ? formatXAF(e.debit_xaf) : formatXAF(e.credit_xaf)}
                        </div>
                      </div>
                    ))}
                    {(financeSummary.apiEcritures ?? dashboardEcritures).length === 0 && (
                      <div className="py-8 text-center text-sm text-gray-400">Aucune ecriture comptable disponible</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Factures ── */}
            {activeTab === 'Factures' && (
              selectedFacture ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setSelectedFacture(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
                      <ChevronLeft className="h-4 w-4" /> Retour à la liste
                    </button>
                    <div className="flex gap-2">
                      {Number(selectedFacture.solde_restant_xaf ?? 0) > 0 && selectedFacture.statut !== 'annule' && (
                        <Button variant="ghost" size="sm" onClick={() => setPaiementFacture(selectedFacture)}>
                          <ReceiptText className="h-3.5 w-3.5" /> Encaisser
                        </Button>
                      )}
                      {selectedFacture.statut === 'brouillon' && (
                        <Button variant="ghost" size="sm"
                          onClick={() => updateStatutFacture.mutate({ id: selectedFacture.id as string, statut: 'valide' })}
                          disabled={updateStatutFacture.isPending}>
                          <CheckCircle className="h-3.5 w-3.5" /> Valider
                        </Button>
                      )}
                      <Button variant="ghost" size="sm"
                        onClick={() => downloadFacturePdf(selectedFacture.id as string, selectedFacture.numero as string).catch((err: Error) => toast.error(err.message))}>
                        <Download className="h-3.5 w-3.5" /> PDF
                      </Button>
                      <Button variant="ghost" size="sm"
                        onClick={() => envoyerFacture.mutate(selectedFacture.id as string)}
                        disabled={envoyerFacture.isPending || selectedFacture.statut === 'annule' || selectedFacture.statut === 'paye'}>
                        <MessageCircle className="h-3.5 w-3.5" /> Envoyee
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => printFacturePdf(selectedFacture.id as string).catch((err: Error) => toast.error(err.message))}><Printer className="h-3.5 w-3.5" /> Imprimer</Button>
                    </div>
                  </div>
                  <InvoicePreview facture={selectedFacture as PreviewableFacture} />

                  {/* ── Section versements ── */}
                  <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                    {/* KPIs encaissement */}
                    <div className="p-4 border-b border-gray-50 grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-gray-50 p-3 text-center">
                        <div className="text-xs text-gray-400 mb-1">Total TTC</div>
                        <div className="text-sm font-bold text-gray-800">{formatXAF(Number(selectedFacture.montant_ttc_xaf ?? 0))}</div>
                      </div>
                      <div className="rounded-lg bg-green-50 p-3 text-center">
                        <div className="text-xs text-green-600 mb-1">Encaissé</div>
                        <div className="text-sm font-bold text-green-700">{formatXAF(Number(selectedFacture.montant_paye_xaf ?? 0))}</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 p-3 text-center">
                        <div className="text-xs text-amber-600 mb-1">Solde restant</div>
                        <div className="text-sm font-bold text-amber-700">{formatXAF(Number(selectedFacture.solde_restant_xaf ?? 0))}</div>
                      </div>
                    </div>

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                      <h3 className="text-sm font-bold text-[#212121]">Historique des versements</h3>
                      {Number(selectedFacture.solde_restant_xaf ?? 0) > 0 && selectedFacture.statut !== 'annule' && (
                        <Button size="sm" onClick={() => setShowNouveauVersement(true)}>
                          <Plus className="h-3.5 w-3.5" /> Enregistrer un versement
                        </Button>
                      )}
                    </div>

                    {/* Liste */}
                    {versementsLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                      </div>
                    ) : (versementsData ?? []).length === 0 ? (
                      <div className="p-8 text-center">
                        <ReceiptText className="h-7 w-7 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Aucun versement enregistré</p>
                        <p className="text-xs text-gray-300 mt-0.5">Les paiements partiels apparaîtront ici</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {(versementsData ?? []).map((v) => (
                          <div key={v.id} className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 shrink-0">
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-gray-800">+{formatXAF(v.montant_xaf)}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                                    {MODE_VERSEMENT_LABELS[v.mode_paiement]}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  {formatDate(v.date_versement)}
                                  {v.reference && (
                                    <span className="ml-2 font-mono text-gray-500">Réf: {v.reference}</span>
                                  )}
                                </div>
                                {v.note && (
                                  <div className="text-xs text-gray-400 mt-0.5 italic truncate">{v.note}</div>
                                )}
                              </div>
                            </div>
                            {v.enregistre_par && (
                              <div className="text-right text-xs text-gray-300 shrink-0 ml-4">
                                {v.enregistre_par.split('@')[0]}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {financeSummary.brouillons.length > 0 && (
                    <div className="mx-4 mt-3 mb-1 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-amber-800">
                          {financeSummary.brouillons.length} facture{financeSummary.brouillons.length > 1 ? 's' : ''} brouillon{financeSummary.brouillons.length > 1 ? 's' : ''} à valider
                        </span>
                        <span className="ml-2 text-xs text-amber-600 hidden sm:inline">
                          {financeSummary.brouillons.slice(0, 3).map((f) => String(f.numero ?? '')).filter(Boolean).join(', ')}
                          {financeSummary.brouillons.length > 3 ? '…' : ''}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="mx-4 mt-3 mb-1 flex flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={synchroniserFactures.isPending}
                      onClick={() => synchroniserFactures.mutate()}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${synchroniserFactures.isPending ? 'animate-spin' : ''}`} />
                      Synchroniser factures
                    </Button>
                    <label className="text-xs font-semibold uppercase text-gray-400" htmlFor="facture-status-sort">
                      Tri
                    </label>
                    <select
                      id="facture-status-sort"
                      value={factureStatusSort}
                      onChange={(e) => setFactureStatusSort(e.target.value as FactureSort)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    >
                      <option value="recent">Plus recentes</option>
                      <option value="oldest">Plus anciennes</option>
                      <option value="amount-desc">Montant decroissant</option>
                      <option value="amount-asc">Montant croissant</option>
                      <option value="due-asc">Echeance proche</option>
                      <option value="client">Client A-Z</option>
                      <option value="workflow">Brouillon vers paye</option>
                      <option value="paid">Payees d'abord</option>
                    </select>
                  </div>
                  <DataTable<FactureRecord>
                    columns={factureColumns}
                    data={facturesTriees}
                    keyField="id"
                    onRowClick={setSelectedFacture}
                    loading={facturesLoading}
                    initialPageSize="all"
                    pageSizeOptions={['all', 10, 25, 50]}
                  />
                </>
              )
            )}

            {/* ── Crédits ── */}
            {activeTab === 'Crédits' && (
              <div>
                {/* Sub-tab navigation */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <div className="flex gap-1">
                    {([
                      { key: 'tableau-de-bord', label: 'Tableau de bord' },
                      { key: 'creances',        label: 'Créances clients' },
                      { key: 'plafonds',        label: 'Plafonds crédit' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setCreditSubTab(key)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          creditSubTab === key
                            ? 'bg-[#C62828] text-white'
                            : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowCreditLimitForm(true)}>
                      <Plus className="h-3.5 w-3.5" /> Limite crédit
                    </Button>
                    <Button size="sm" onClick={() => setShowOrderSelector(true)}>
                      <Plus className="h-3.5 w-3.5" /> Nouveau plan
                    </Button>
                  </div>
                </div>

                {/* Tableau de bord — nouveau module crédit */}
                {creditSubTab === 'tableau-de-bord' && (
                  <CreditDashboard />
                )}

                {/* Créances clients — vue legacy */}
                {creditSubTab === 'creances' && (
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

                {/* Plafonds crédit */}
                {creditSubTab === 'plafonds' && (
                  <PlafondsList
                    onEdit={(clientId) => setEditLimitClientId(clientId)}
                    onNew={() => setShowCreditLimitForm(true)}
                  />
                )}

                {/* Modal limite de crédit — nouveau ou édition */}
                <CreditLimitForm
                  open={showCreditLimitForm || !!editLimitClientId}
                  customerId={editLimitClientId ?? undefined}
                  onClose={() => { setShowCreditLimitForm(false); setEditLimitClientId(null) }}
                  onSaved={() => { setShowCreditLimitForm(false); setEditLimitClientId(null) }}
                />

                {/* Sélection commande → wizard plan */}
                <OrderSelectorModal
                  isOpen={showOrderSelector}
                  onClose={() => setShowOrderSelector(false)}
                  onSelect={(c) => { setPlanOrder(c); setShowOrderSelector(false) }}
                />
                {planOrder && (
                  <PaymentPlanWizard
                    open={true}
                    orderId={planOrder.id}
                    customerId={planOrder.client.id}
                    orderAmount={planOrder.solde_restant_xaf > 0 ? planOrder.solde_restant_xaf : planOrder.montant_ttc_xaf}
                    orderRef={planOrder.reference}
                    onClose={() => setPlanOrder(null)}
                    onCreated={() => setPlanOrder(null)}
                  />
                )}
              </div>
            )}

            {/* ── Charges ── */}
            {activeTab === 'Charges' && (
              <div className="p-5 space-y-5">
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <span className="font-semibold">Règle comptable :</span> les frais de livraison facturés au client restent hors charges. Seuls les frais réellement supportés par l'entreprise sont enregistrés ici.
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: 'Charges période', value: formatXAF(chargesDashboardData?.kpis?.total_charges_xaf ?? 0), tone: '#C62828' },
                    { label: 'Sorties argent', value: formatXAF(chargesDashboardData?.kpis?.sorties_xaf ?? 0), tone: '#1d4ed8' },
                    { label: 'Reste à payer', value: formatXAF(chargesDashboardData?.kpis?.charges_a_payer_xaf ?? 0), tone: '#d97706' },
                    { label: 'TVA déductible', value: formatXAF(chargesDashboardData?.kpis?.tva_deductible_xaf ?? 0), tone: '#15803d' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="text-xs font-semibold uppercase text-gray-400">{item.label}</div>
                      <div className="mt-2 text-xl font-black" style={{ color: item.tone }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
                  <div className="rounded-xl border border-gray-100 bg-white">
                    <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Charges entreprise</h3>
                        <p className="mt-0.5 text-xs text-gray-500">Brouillon, validation, paiement et justificatif.</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{charges.length} charge{charges.length !== 1 ? 's' : ''}</span>
                        {(chargesDashboardData?.kpis?.justificatifs_manquants ?? 0) > 0 && (
                          <span className="rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700">
                            {chargesDashboardData?.kpis?.justificatifs_manquants} justificatif{(chargesDashboardData?.kpis?.justificatifs_manquants ?? 0) > 1 ? 's' : ''} manquant{(chargesDashboardData?.kpis?.justificatifs_manquants ?? 0) > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50">
                            {['Date', 'Numéro', 'Fournisseur', 'Compte', 'TTC', 'Payé', 'Statut', 'Justif.', ''].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {chargesLoading && (
                            <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">Chargement des charges...</td></tr>
                          )}
                          {!chargesLoading && charges.map((charge) => (
                            <tr key={charge.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(charge.date_charge)}</td>
                              <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">{charge.numero}</td>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-[#212121]">{charge.fournisseur_nom}</div>
                                <div className="text-xs text-gray-400">{charge.categorie}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{charge.compte_charge}</span>
                              </td>
                              <td className="px-4 py-3 font-bold text-[#212121] whitespace-nowrap">{formatXAF(charge.montant_ttc_xaf)}</td>
                              <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatXAF(charge.montant_paye_xaf)}</td>
                              <td className="px-4 py-3"><Badge statut={charge.statut} map={CHARGE_MAP} /></td>
                              <td className="px-4 py-3"><Badge statut={charge.justificatif_statut} map={JUSTIF_MAP} /></td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  {charge.statut === 'brouillon' && (
                                    <button title="Soumettre"
                                      onClick={() => updateStatutCharge.mutate({ id: charge.id, statut: 'a_valider' })}
                                      disabled={updateStatutCharge.isPending}
                                      className="p-1.5 rounded text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50">
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {['brouillon', 'a_valider'].includes(charge.statut) && (
                                    <button title="Valider"
                                      onClick={() => updateStatutCharge.mutate({ id: charge.id, statut: 'validee' })}
                                      disabled={updateStatutCharge.isPending}
                                      className="p-1.5 rounded text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50">
                                      <CheckCircle className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {['validee', 'payee'].includes(charge.statut) && Number(charge.solde_restant_xaf ?? 0) > 0 && (
                                    <button title="Enregistrer une sortie"
                                      onClick={() => { setSortieCharge(charge); setShowNewSortie(true) }}
                                      className="p-1.5 rounded text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600">
                                      <ReceiptText className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <button title="Justificatif"
                                    onClick={() => setDocumentsCharge(charge)}
                                    className="p-1.5 rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                                    <Paperclip className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!chargesLoading && charges.length === 0 && (
                            <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">Aucune charge enregistrée</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-gray-100 bg-white p-4">
                      <h3 className="text-sm font-bold text-[#212121]">Répartition</h3>
                      <div className="mt-3 space-y-2">
                        {(chargesDashboardData?.repartition_categories ?? []).slice(0, 6).map((row) => (
                          <div key={row.categorie} className="rounded-lg bg-gray-50 p-3 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-gray-700">{row.categorie}</span>
                              <span className="font-bold text-[#212121]">{formatXAF(row.total_xaf)}</span>
                            </div>
                            <div className="mt-0.5 text-gray-400">{row.count} charge{row.count !== 1 ? 's' : ''}</div>
                          </div>
                        ))}
                        {(chargesDashboardData?.repartition_categories ?? []).length === 0 && (
                          <div className="py-6 text-center text-sm text-gray-400">Aucune donnée</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-white p-4">
                      <h3 className="text-sm font-bold text-[#212121]">Sorties récentes</h3>
                      <div className="mt-3 divide-y divide-gray-50">
                        {sortiesLoading && <div className="py-6 text-center text-sm text-gray-400">Chargement...</div>}
                        {!sortiesLoading && sortiesTresorerie.slice(0, 6).map((sortie) => (
                          <div key={sortie.id} className="py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[#212121]">{sortie.beneficiaire}</div>
                                <div className="mt-0.5 text-xs text-gray-400">{sortie.numero} - {formatDate(sortie.date_sortie)}</div>
                              </div>
                              <div className="text-right text-sm font-bold text-[#C62828] whitespace-nowrap">{formatXAF(sortie.montant_xaf)}</div>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="min-w-0 text-xs text-gray-500">
                                <div className="truncate">{sortie.motif}</div>
                                <div className="mt-1"><Badge statut={sortie.justificatif_statut} map={JUSTIF_MAP} /></div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button title="Justificatif"
                                  onClick={() => setDocumentsSortie(sortie)}
                                  className="p-1.5 rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                                  <Paperclip className="h-3.5 w-3.5" />
                                </button>
                                <button title="Annuler la sortie"
                                  onClick={() => annulerSortie.mutate(sortie.id)}
                                  disabled={annulerSortie.isPending}
                                  className="p-1.5 rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {!sortiesLoading && sortiesTresorerie.length === 0 && (
                          <div className="py-6 text-center text-sm text-gray-400">Aucune sortie enregistrée</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Comptabilité ── */}
            {activeTab === 'Comptabilité' && (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Socle comptable</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          Plan SYSCOHADA, journaux et règles de saisie utilisés par les écritures.
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                        {planComptableData?.total ?? comptesOptions.length} comptes
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {journaux.map((journal) => (
                        <span key={journal.code} className="rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600">
                          {journal.code} · {journal.label}
                        </span>
                      ))}
                    </div>
                    {reglesComptables.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {reglesComptables.slice(0, 3).map((regle) => (
                          <div key={regle} className="text-xs text-gray-500">• {regle}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-gray-100 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Grand livre général</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          Solde progressif par compte sur la période sélectionnée.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (!compteFilter) {
                            toast.error('Sélectionnez un compte')
                            return
                          }
                          downloadFinanceExport(
                            `/api/rapports/grand-livre.xls?compte=${compteFilter}&debut=${grandLivreDebut}&fin=${grandLivreFin}`,
                            `grand-livre-${compteFilter}.xls`,
                          ).catch((err: Error) => toast.error(err.message))
                        }}
                      >
                        <Download className="h-3.5 w-3.5" /> Export
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        type="date"
                        value={grandLivreDebut}
                        onChange={(e) => setGrandLivreDebut(e.target.value)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30"
                      />
                      <input
                        type="date"
                        value={grandLivreFin}
                        onChange={(e) => setGrandLivreFin(e.target.value)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30"
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Débit</div>
                        <div className="mt-1 font-bold text-[#1d4ed8]">{formatXAF(grandLivreData?.total_debit_xaf ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Crédit</div>
                        <div className="mt-1 font-bold text-[#15803d]">{formatXAF(grandLivreData?.total_credit_xaf ?? 0)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-100 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-[#212121]">États comptables</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Bilan et compte de résultat générés depuis les écritures, avec rapprochement Finance.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        value={exerciceCompta}
                        onChange={(e) => setExerciceCompta(e.target.value)}
                        className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/30"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadFinanceExport(`/api/rapports/bilan.xls?exercice=${exerciceCompta}`, `bilan-${exerciceCompta}.xls`).catch((err: Error) => toast.error(err.message))}
                      >
                        <Download className="h-3.5 w-3.5" /> Bilan
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadFinanceExport(`/api/rapports/resultat.xls?exercice=${exerciceCompta}`, `resultat-${exerciceCompta}.xls`).catch((err: Error) => toast.error(err.message))}
                      >
                        <Download className="h-3.5 w-3.5" /> Résultat
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase text-gray-400">Bilan comptable</div>
                          <div className="mt-1 text-sm font-bold text-[#212121]">
                            {bilanData?.equilibre ? 'Équilibré' : 'À contrôler'}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${bilanData?.equilibre ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                          Écart {formatXAF(Math.abs(bilanData?.ecart_xaf ?? 0))}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">Actif</div>
                          <div className="mt-1 font-bold text-[#1d4ed8]">{formatXAF(bilanData?.total_actif_xaf ?? 0)}</div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">Passif</div>
                          <div className="mt-1 font-bold text-[#15803d]">{formatXAF(bilanData?.total_passif_xaf ?? 0)}</div>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(bilanData?.actif ?? []).slice(0, 3).map((section) => (
                          <div key={`actif-${section.rubrique}`} className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">{section.rubrique}</span>
                            <span className="font-semibold text-gray-700">{formatXAF(section.total_xaf)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase text-gray-400">Compte de résultat</div>
                          <div className="mt-1 text-sm font-bold text-[#212121]">
                            {resultatData?.beneficiaire ? 'Bénéficiaire' : 'Déficitaire'}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${(resultatData?.resultat_net_xaf ?? 0) >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {formatXAF(resultatData?.resultat_net_xaf ?? 0)}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">Produits</div>
                          <div className="mt-1 font-bold text-[#15803d]">{formatXAF(resultatData?.total_produits_xaf ?? 0)}</div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">Charges</div>
                          <div className="mt-1 font-bold text-[#C62828]">{formatXAF(resultatData?.total_charges_xaf ?? 0)}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">CA facturé HT</div>
                          <div className="mt-1 font-semibold text-gray-700">{formatXAF(resultatData?.finance?.ca_facture_ht_xaf ?? 0)}</div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-gray-400">Reste à encaisser</div>
                          <div className="mt-1 font-semibold text-gray-700">{formatXAF(resultatData?.finance?.reste_a_encaisser_xaf ?? 0)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-gray-100 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Synthèse Finance-Comptabilité</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          Lecture croisée entre factures, encaissements et écritures comptables.
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${syntheseComptableData?.comptabilite?.balance_equilibree ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        Balance {syntheseComptableData?.comptabilite?.balance_equilibree ? 'OK' : 'à contrôler'}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Comptes mouvementés</div>
                        <div className="mt-1 font-bold text-[#212121]">{syntheseComptableData?.comptabilite?.comptes_mouvementes ?? 0}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Factures</div>
                        <div className="mt-1 font-bold text-[#212121]">{syntheseComptableData?.finance?.factures ?? 0}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Débit total</div>
                        <div className="mt-1 font-semibold text-[#1d4ed8]">{formatXAF(syntheseComptableData?.comptabilite?.total_debit_xaf ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-gray-400">Crédit total</div>
                        <div className="mt-1 font-semibold text-[#15803d]">{formatXAF(syntheseComptableData?.comptabilite?.total_credit_xaf ?? 0)}</div>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-500">Écart CA comptable / CA facturé HT</span>
                        <span className="font-bold text-[#212121]">{formatXAF(syntheseComptableData?.rapprochement?.ecart_ca_xaf ?? 0)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#212121]">Contrôles avant clôture</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          Vérifications automatiques sur la balance, le plan, le CA et la TVA.
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        controlesComptablesData?.statut_global === 'ok'
                          ? 'bg-green-50 text-green-700'
                          : controlesComptablesData?.statut_global === 'alerte'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}>
                        {controlesComptablesData?.statut_global ?? '...'}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {(controlesComptablesData?.controles ?? []).map((controle) => (
                        <div key={controle.code} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-3 text-xs">
                          <div>
                            <div className="font-semibold text-[#212121]">{controle.label}</div>
                            <div className="mt-0.5 text-gray-500">{controle.details}</div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                            controle.statut === 'ok'
                              ? 'bg-green-50 text-green-700'
                              : controle.statut === 'alerte'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-700'
                          }`}>
                            {controle.statut}
                          </span>
                        </div>
                      ))}
                    </div>
                    {(controlesComptablesData?.recommandations ?? []).length > 0 && (
                      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                        {(controlesComptablesData?.recommandations ?? []).slice(0, 2).map((rec) => (
                          <div key={rec} className="text-xs text-gray-500">• {rec}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-100 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-[#212121]">Pré-clôture comptable</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Dossier annuel consolidé, prêt pour revue finance et archivage.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        clotureComptableData?.statut === 'pret'
                          ? 'bg-green-50 text-green-700'
                          : clotureComptableData?.statut === 'bloque'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}>
                        {clotureComptableData?.statut ?? '...'}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadFinanceExport(`/api/rapports/dossier-cloture.xls?exercice=${exerciceCompta}`, `dossier-cloture-${exerciceCompta}.xls`).catch((err: Error) => toast.error(err.message))}
                      >
                        <Download className="h-3.5 w-3.5" /> Dossier
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-400">Comptes</div>
                      <div className="mt-1 font-bold text-[#212121]">{clotureComptableData?.resume?.comptes_mouvementes ?? 0}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-400">Résultat net</div>
                      <div className="mt-1 font-bold text-[#212121]">{formatXAF(clotureComptableData?.resume?.resultat_net_xaf ?? 0)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-400">Encaisse</div>
                      <div className="mt-1 font-bold text-[#15803d]">{formatXAF(clotureComptableData?.resume?.encaisse_xaf ?? 0)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-400">Reste à encaisser</div>
                      <div className="mt-1 font-bold text-[#C62828]">{formatXAF(clotureComptableData?.resume?.reste_a_encaisser_xaf ?? 0)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {(clotureComptableData?.etapes ?? []).map((etape) => (
                      <div key={etape.code} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-3 text-xs">
                        <div>
                          <div className="font-semibold text-[#212121]">{etape.label}</div>
                          <div className="mt-0.5 text-gray-500">{etape.details}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                          etape.statut === 'ok'
                            ? 'bg-green-50 text-green-700'
                            : etape.statut === 'bloquant'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}>
                          {etape.statut}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-center">
                  <select value={compteFilter} onChange={(e) => setCompteFilter(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white">
                    <option value="">Tous les comptes</option>
                    {comptesOptions.map((c) => <option key={c.compte} value={c.compte}>{c.compte} — {c.libelle}</option>)}
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

                {compteSelectionne && grandLivreData && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="font-mono font-bold text-[#212121]">{compteSelectionne.compte}</span>
                      <span>{compteSelectionne.libelle}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-semibold">{grandLivreData.categorie}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-semibold">Solde {grandLivreData.solde_sens}</span>
                      <span className="ml-auto font-bold text-[#212121]">{formatXAF(grandLivreData.solde_final_xaf)}</span>
                    </div>
                  </div>
                )}

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
                      {compteFilter && grandLivreLoading && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Chargement…</td></tr>
                      )}
                      {compteFilter && !grandLivreLoading && (grandLivreData?.lignes ?? []).map((l, i) => (
                        <tr key={l.id ?? i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{formatDate(l.date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{l.libelle}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{compteFilter} — {grandLivreData?.compte_label ?? compteSelectionne?.libelle}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[#1d4ed8]">{l.debit_xaf > 0 ? formatXAF(l.debit_xaf) : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#15803d]">{l.credit_xaf > 0 ? formatXAF(l.credit_xaf) : '—'}</td>
                          <td className="px-4 py-3 text-right font-bold" style={{ color: l.solde_xaf >= 0 ? '#1d4ed8' : '#15803d' }}>
                            {formatXAF(Math.abs(l.solde_xaf))}
                          </td>
                        </tr>
                      ))}
                      {compteFilter && !grandLivreLoading && (grandLivreData?.lignes ?? []).length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Aucune ligne dans le grand livre pour cette période</td></tr>
                      )}
                      {!compteFilter && ecrituresLoading && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Chargement…</td></tr>
                      )}
                      {!compteFilter && !ecrituresLoading && ecritures.map((l, i) => (
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
                      {!compteFilter && !ecrituresLoading && ecritures.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Aucune écriture pour ces critères</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Déclarations ── */}
            {activeTab === 'Déclarations Fiscales' && (
              <div className="p-5 space-y-4">
                <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#212121]">TVA mensuelle</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Prépare la TVA nette à partir des factures non annulées et de la TVA déductible des charges validées. La livraison client reste hors base TVA.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="month"
                      value={periodeTva}
                      onChange={(e) => setPeriodeTva(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#C62828]/20"
                    />
                    <Button size="sm" onClick={() => preparerTva.mutate({ periode: periodeTva })} disabled={preparerTva.isPending}>
                      {preparerTva.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
                      Préparer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() =>
                      downloadFinanceExport(`/api/finance/exports/tva.xls?periode=${periodeTva}`, `rapport-tva-${periodeTva}.xls`).catch((err: Error) => toast.error(err.message))
                    }>
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                </div>

                {declarationsLoading && (
                  <div className="flex items-center justify-center rounded-xl border border-gray-100 p-8 text-sm text-gray-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement des déclarations...
                  </div>
                )}

                {!declarationsLoading && declarations.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
                    <ReceiptText className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="mt-2 text-sm font-semibold text-gray-500">Aucune déclaration TVA préparée</p>
                    <p className="mt-1 text-xs text-gray-400">Choisissez une période puis cliquez sur Préparer.</p>
                  </div>
                )}

                {declarations.map((d) => {
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
                          {d.notes && <div className="mt-1 text-xs text-gray-400">{d.notes}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {Number(d.montant_xaf ?? 0) > 0 && <span className="text-sm font-bold">{formatXAF(d.montant_xaf)}</span>}
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
                        {d.statut === 'a_declarer' && (
                          <Button size="sm" onClick={() => updateStatutDeclaration.mutate({ id: d.id, statut: 'soumis' })} disabled={updateStatutDeclaration.isPending}>
                            Soumettre
                          </Button>
                        )}
                        {d.statut === 'soumis' && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatutDeclaration.mutate({ id: d.id, statut: 'valide' })} disabled={updateStatutDeclaration.isPending}>
                            Valider
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      <NouvelleFactureSlideOver
        isOpen={showNewFacture}
        onClose={() => setShowNewFacture(false)}
        factureeCommandeIds={factureeCommandeIds}
      />
      <NouveauVersementModal isOpen={showNouveauVersement} onClose={() => setShowNouveauVersement(false)} facture={selectedFacture} />
      <PaiementFactureModal isOpen={!!paiementFacture} onClose={() => setPaiementFacture(null)} facture={paiementFacture} />
      <RelanceFactureModal isOpen={!!relanceFacture} onClose={() => setRelanceFacture(null)} facture={relanceFacture} />
      <RemboursementModal isOpen={!!remboursementCredit} onClose={() => setRemboursementCredit(null)} credit={remboursementCredit} />
      <RelanceModal isOpen={!!relanceCredit} onClose={() => setRelanceCredit(null)} credit={relanceCredit} />
      <DocumentsModal isOpen={!!documentsCredit} onClose={() => setDocumentsCredit(null)} credit={documentsCredit} />
      <NouvelleChargeModal isOpen={showNewCharge} onClose={() => setShowNewCharge(false)} comptesCharges={comptesCharges} />
      <NouvelleSortieModal
        isOpen={showNewSortie}
        onClose={() => { setShowNewSortie(false); setSortieCharge(null) }}
        charges={charges}
        selectedCharge={sortieCharge}
      />
      <JustificatifChargeModal charge={documentsCharge} onClose={() => setDocumentsCharge(null)} />
      <JustificatifSortieModal sortie={documentsSortie} onClose={() => setDocumentsSortie(null)} />
    </motion.div>
  )
}


