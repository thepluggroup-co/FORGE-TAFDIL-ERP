import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, CreditCard, ReceiptText,
  Plus, Download, MessageCircle, Printer,
  AlertCircle, CheckCircle, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, Modal, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface FactureLigne { designation: string; qte: number; puHT: number }

interface Facture extends Record<string, unknown> {
  id: string; ref: string; client: string
  lignes: FactureLigne[]
  dateEmission: string; dateEcheance: string
  statut: string
}

interface Credit extends Record<string, unknown> {
  id: string; ref: string; client: string
  montant: number; dateDebut: string; echeance: string
  soldeRestant: number; statut: string
}

interface GrandLivreLigne {
  date: string; libelle: string
  compte: string; compteLabel: string
  debit: number; credit: number; solde: number
}

interface Declaration extends Record<string, unknown> {
  id: string; type: string; periode: string
  statut: string; montant: number; echeance: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TVA = 0.1925

function totals(lignes: FactureLigne[]) {
  const ht = lignes.reduce((s, l) => s + l.qte * l.puHT, 0)
  return { ht, tva: ht * TVA, ttc: ht * (1 + TVA) }
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const FACTURES: Facture[] = [
  {
    id: '1', ref: 'FACT-2026-047', client: 'SODECOTON', statut: 'envoye',
    dateEmission: '2026-05-15', dateEcheance: '2026-06-15',
    lignes: [
      { designation: 'Fabrication grille métallique 2m×1m', qte: 5, puHT: 45000 },
      { designation: 'Soudure et finition', qte: 5, puHT: 12500 },
    ],
  },
  {
    id: '2', ref: 'FACT-2026-046', client: 'CAMRAIL SA', statut: 'valide',
    dateEmission: '2026-05-14', dateEcheance: '2026-06-14',
    lignes: [
      { designation: 'Profilé aluminium 6060-T5 (6 m)', qte: 20, puHT: 18000 },
      { designation: 'Façonnage et découpe', qte: 20, puHT: 3500 },
    ],
  },
  {
    id: '3', ref: 'FACT-2026-045', client: 'MAETUR', statut: 'paye',
    dateEmission: '2026-05-10', dateEcheance: '2026-06-10',
    lignes: [{ designation: 'Porte métallique sécurisée 90×210 cm', qte: 3, puHT: 125000 }],
  },
  {
    id: '4', ref: 'FACT-2026-044', client: 'Fouda Jean', statut: 'brouillon',
    dateEmission: '2026-05-08', dateEcheance: '2026-05-23',
    lignes: [{ designation: 'Barrière résidentielle 3 m', qte: 2, puHT: 95000 }],
  },
  {
    id: '5', ref: 'FACT-2026-043', client: 'CDE Cameroun', statut: 'paye',
    dateEmission: '2026-04-30', dateEcheance: '2026-05-30',
    lignes: [
      { designation: 'Charpente métallique atelier 10×8 m', qte: 1, puHT: 1850000 },
      { designation: "Main-d'œuvre montage", qte: 1, puHT: 320000 },
    ],
  },
]

const CREDITS: Credit[] = [
  { id: '1', ref: 'CRED-2026-003', client: 'Fouda Jean', montant: 180000, dateDebut: '2026-02-01', echeance: '2026-05-01', soldeRestant: 180000, statut: 'echu' },
  { id: '2', ref: 'CRED-2026-007', client: 'Biyong & Fils', montant: 75000, dateDebut: '2026-03-01', echeance: '2026-06-01', soldeRestant: 75000, statut: 'en_cours' },
  { id: '3', ref: 'CRED-2026-009', client: 'Nguema Paul', montant: 45000, dateDebut: '2026-04-01', echeance: '2026-04-30', soldeRestant: 20000, statut: 'echu' },
  { id: '4', ref: 'CRED-2026-011', client: 'Essomba Marie', montant: 30000, dateDebut: '2026-04-15', echeance: '2026-07-15', soldeRestant: 30000, statut: 'en_cours' },
  { id: '5', ref: 'CRED-2026-001', client: 'SODECOTON', montant: 500000, dateDebut: '2026-01-01', echeance: '2026-03-01', soldeRestant: 0, statut: 'rembourse' },
]

const GRAND_LIVRE: GrandLivreLigne[] = [
  { date: '2026-05-15', libelle: 'Facture FACT-2026-047 SODECOTON', compte: '411', compteLabel: 'Clients', debit: 640000, credit: 0, solde: 640000 },
  { date: '2026-05-15', libelle: 'Ventes fabrication métallique', compte: '701', compteLabel: 'Ventes produits finis', debit: 0, credit: 537225, solde: -537225 },
  { date: '2026-05-15', libelle: 'TVA collectée', compte: '443', compteLabel: 'TVA collectée', debit: 0, credit: 102775, solde: -102775 },
  { date: '2026-05-12', libelle: 'Achat tôles galvanisées SOFAME', compte: '601', compteLabel: 'Achats matières premières', debit: 185000, credit: 0, solde: 185000 },
  { date: '2026-05-12', libelle: 'Fournisseur SOFAME', compte: '401', compteLabel: 'Fournisseurs', debit: 0, credit: 185000, solde: -185000 },
  { date: '2026-05-10', libelle: 'Règlement MAETUR FACT-2026-045', compte: '521', compteLabel: 'Banque', debit: 447187, credit: 0, solde: 447187 },
  { date: '2026-05-10', libelle: 'Apurement client MAETUR', compte: '411', compteLabel: 'Clients', debit: 0, credit: 447187, solde: -447187 },
  { date: '2026-05-05', libelle: 'Salaires mai 2026', compte: '641', compteLabel: 'Charges de personnel', debit: 890000, credit: 0, solde: 890000 },
  { date: '2026-05-05', libelle: 'Virement salaires', compte: '521', compteLabel: 'Banque', debit: 0, credit: 890000, solde: -890000 },
  { date: '2026-05-01', libelle: 'Loyer atelier mai 2026', compte: '612', compteLabel: 'Locations', debit: 250000, credit: 0, solde: 250000 },
  { date: '2026-05-01', libelle: 'Paiement loyer caisse', compte: '571', compteLabel: 'Caisse', debit: 0, credit: 250000, solde: -250000 },
  { date: '2026-04-30', libelle: 'Règlement CDE Cameroun', compte: '521', compteLabel: 'Banque', debit: 2586750, credit: 0, solde: 2586750 },
  { date: '2026-04-30', libelle: 'Apurement client CDE', compte: '411', compteLabel: 'Clients', debit: 0, credit: 2586750, solde: -2586750 },
]

const DECLARATIONS: Declaration[] = [
  { id: '1', type: 'TVA', periode: 'Avril 2026', statut: 'soumis', montant: 425000, echeance: '2026-05-15' },
  { id: '2', type: 'IRCM (Retenues à la source)', periode: 'Avril 2026', statut: 'valide', montant: 89000, echeance: '2026-05-10' },
  { id: '3', type: 'TVA', periode: 'Mai 2026', statut: 'a_declarer', montant: 0, echeance: '2026-06-15' },
  { id: '4', type: 'DSF (Déclaration Statistique et Fiscale)', periode: 'Exercice 2025', statut: 'valide', montant: 0, echeance: '2026-03-31' },
  { id: '5', type: 'IS (Impôt sur les Sociétés)', periode: 'Exercice 2025', statut: 'a_declarer', montant: 0, echeance: '2026-04-30' },
]

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

function InvoicePreview({ facture }: { facture: Facture }) {
  const lignes = facture.lignes as FactureLigne[]
  const { ht, tva, ttc } = totals(lignes)

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
            <div className="text-gray-400 text-xs font-sans">+237 699 001 200 · admin@tafdil.cm</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-sans text-gray-800 tracking-widest uppercase">Facture</div>
            <div className="font-mono font-bold text-[#C62828] text-lg mt-1">{facture.ref as string}</div>
            <div className="mt-2 text-xs font-sans text-gray-500 space-y-0.5">
              <div>Émise le : <span className="font-semibold text-gray-700">{formatDate(facture.dateEmission as string)}</span></div>
              <div>Échéance : <span className="font-semibold text-gray-700">{formatDate(facture.dateEcheance as string)}</span></div>
            </div>
          </div>
        </div>

        {/* Client */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 font-sans">
          <div className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Facturé à</div>
          <div className="font-bold text-gray-800">{facture.client as string}</div>
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
            {lignes.map((l, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2.5 text-gray-800">{l.designation}</td>
                <td className="py-2.5 text-center text-gray-600">{l.qte}</td>
                <td className="py-2.5 text-right text-gray-600">{formatXAF(l.puHT)}</td>
                <td className="py-2.5 text-right font-semibold text-gray-800">{formatXAF(l.qte * l.puHT)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totaux */}
        <div className="mt-4 flex justify-end font-sans">
          <div className="w-64 space-y-1.5">
            <div className="flex justify-between text-sm py-1 border-b border-gray-100">
              <span className="text-gray-500">Sous-total HT</span>
              <span className="font-semibold text-gray-800">{formatXAF(ht)}</span>
            </div>
            <div className="flex justify-between text-sm py-1 border-b border-gray-100">
              <span className="text-gray-500">TVA 19,25 %</span>
              <span className="font-semibold text-gray-800">{formatXAF(tva)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t-2 border-gray-800">
              <span className="font-bold text-gray-800">TOTAL TTC</span>
              <span className="font-black text-[#C62828] text-base">{formatXAF(ttc)}</span>
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
  const [step, setStep] = useState(1)
  const [client, setClient] = useState('')
  const [dateEmission] = useState(new Date().toISOString().split('T')[0])
  const [dateEcheance, setDateEcheance] = useState('')
  const [lignes, setLignes] = useState<FactureLigne[]>([{ designation: '', qte: 1, puHT: 0 }])

  const { ht, tva, ttc } = totals(lignes)

  const previewFacture: Facture = {
    id: 'new', ref: 'FACT-2026-NEW', client, statut: 'brouillon',
    dateEmission, dateEcheance, lignes,
  }

  const updateLigne = (i: number, field: keyof FactureLigne, val: string | number) => {
    const next = [...lignes]
    ;(next[i] as Record<string, unknown>)[field] = val
    setLignes(next)
  }

  const STEPS = ["Client & Dates", "Lignes", "Aperçu"]

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
            <select value={client} onChange={(e) => setClient(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30 bg-white">
              <option value="">— Sélectionner —</option>
              {['SODECOTON', 'CAMRAIL SA', 'MAETUR', 'CDE Cameroun', 'Fouda Jean', 'Biyong & Fils'].map((c) => (
                <option key={c} value={c}>{c}</option>
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
            <Button onClick={() => setStep(2)} disabled={!client || !dateEcheance}>
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
              <input type="number" placeholder="Qté" value={l.qte || ''} onChange={(e) => updateLigne(i, 'qte', +e.target.value)}
                className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
              <input type="number" placeholder="P.U. HT" value={l.puHT || ''} onChange={(e) => updateLigne(i, 'puHT', +e.target.value)}
                className="w-32 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
              <div className="w-28 pt-2 text-sm font-semibold text-right text-gray-700 shrink-0">
                {formatXAF(l.qte * l.puHT)}
              </div>
              {lignes.length > 1 && (
                <button onClick={() => setLignes(lignes.filter((_, j) => j !== i))} className="pt-2.5 text-gray-400 hover:text-[#C62828]">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setLignes([...lignes, { designation: '', qte: 1, puHT: 0 }])}
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
            <Button variant="ghost" onClick={() => setStep(1)}>Retour</Button>
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
            <Button variant="ghost" onClick={() => setStep(2)}>Retour</Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Imprimer
              </Button>
              <Button onClick={onClose}>
                <CheckCircle className="h-3.5 w-3.5" /> Valider
              </Button>
            </div>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

// ── Remboursement Modal ────────────────────────────────────────────────────────

function RemboursementModal({ isOpen, onClose, credit }: { isOpen: boolean; onClose: () => void; credit: Credit | null }) {
  const [type, setType] = useState<'total' | 'partiel'>('total')
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  if (!credit) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enregistrer un remboursement" size="sm">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-sm font-semibold text-amber-800">{credit.client as string} — {credit.ref as string}</div>
          <div className="text-xs text-amber-600 mt-0.5">
            Solde restant : <span className="font-bold">{formatXAF(credit.soldeRestant as number)}</span>
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
              max={credit.soldeRestant as number}
              placeholder={`Max : ${(credit.soldeRestant as number).toLocaleString('fr-CM')}`}
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
          <Button onClick={onClose}><CheckCircle className="h-3.5 w-3.5" /> Enregistrer</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Finance() {
  const [activeTab, setActiveTab] = useState<Tab>('Factures')
  const [showNewFacture, setShowNewFacture] = useState(false)
  const [selectedFacture, setSelectedFacture] = useState<Facture | null>(null)
  const [remboursementCredit, setRemboursementCredit] = useState<Credit | null>(null)
  const [compteFilter, setCompteFilter] = useState('')
  const [periodeFilter, setPeriodeFilter] = useState('')

  const echusCount = CREDITS.filter((c) => c.statut === 'echu').length
  const totalEchus = CREDITS.filter((c) => c.statut === 'echu').reduce((s, c) => s + (c.soldeRestant as number), 0)

  const factureColumns: Column<Facture>[] = [
    { id: 'ref', header: 'Référence', accessor: 'ref', render: (v) => <span className="font-mono text-xs font-semibold text-gray-700">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: 'client', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    {
      id: 'montant', header: 'Montant TTC', accessor: (row) => totals(row.lignes as FactureLigne[]).ttc,
      render: (v) => <span className="text-sm font-bold">{formatXAF(v as number)}</span>,
    },
    { id: 'date', header: 'Émission', accessor: 'dateEmission', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'echeance', header: 'Échéance', accessor: 'dateEcheance', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
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
          <button title="Envoyer WhatsApp" className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors">
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button title="Imprimer" onClick={(e) => { e.stopPropagation(); window.print() }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Printer className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  const creditColumns: Column<Credit>[] = [
    { id: 'ref', header: 'Référence', accessor: 'ref', render: (v) => <span className="font-mono text-xs font-semibold text-gray-700">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: 'client', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'montant', header: 'Montant initial', accessor: 'montant', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'solde', header: 'Solde restant', accessor: 'soldeRestant', render: (v) => <span className="text-sm font-bold" style={{ color: (v as number) > 0 ? '#dc2626' : '#15803d' }}>{formatXAF(v as number)}</span> },
    { id: 'echeance', header: 'Échéance', accessor: 'echeance', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
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
  ]

  const glFiltered = GRAND_LIVRE.filter((l) => {
    if (compteFilter && l.compte !== compteFilter) return false
    if (periodeFilter) {
      const [y, m] = periodeFilter.split('-')
      const [ly, lm] = l.date.split('-')
      if (ly !== y || lm !== m) return false
    }
    return true
  })

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
                      <Button variant="ghost" size="sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</Button>
                      <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Imprimer</Button>
                    </div>
                  </div>
                  <InvoicePreview facture={selectedFacture} />
                </div>
              ) : (
                <DataTable<Facture>
                  columns={factureColumns}
                  data={FACTURES}
                  keyField="id"
                  onRowClick={setSelectedFacture}
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
                <DataTable<Credit> columns={creditColumns} data={CREDITS} keyField="id" />
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
                  <span className="ml-auto text-xs text-gray-400">{glFiltered.length} écriture{glFiltered.length !== 1 ? 's' : ''}</span>
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
                      {glFiltered.map((l, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{formatDate(l.date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{l.libelle}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{l.compte} — {l.compteLabel}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[#1d4ed8]">{l.debit > 0 ? formatXAF(l.debit) : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#15803d]">{l.credit > 0 ? formatXAF(l.credit) : '—'}</td>
                          <td className="px-4 py-3 text-right font-bold" style={{ color: l.solde >= 0 ? '#1d4ed8' : '#15803d' }}>
                            {formatXAF(Math.abs(l.solde))}
                          </td>
                        </tr>
                      ))}
                      {glFiltered.length === 0 && (
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
                  const s = DECL_MAP[d.statut as string] ?? DECL_MAP.a_declarer
                  return (
                    <div key={d.id as string} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 shrink-0">
                          <ReceiptText className="h-5 w-5 text-gray-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-[#212121]">{d.type as string}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            Période : {d.periode as string} · Échéance : {formatDate(d.echeance as string)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {(d.montant as number) > 0 && <span className="text-sm font-bold">{formatXAF(d.montant as number)}</span>}
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
