import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, MessageCircle, Mail, ArrowRightLeft, Send,
  FileText, Loader2, Check, X, ChevronLeft, ChevronRight,
  Edit2, Eye, Clock, AlertTriangle, Link, CheckCircle, OctagonX,
  ShieldCheck,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useDevis, useCreateDevis, useUpdateDevis, useDeleteDevis,
  useUpdateStatutDevis, useEnvoyerApprobation, useTransformerDevis,
  useConditionsPaiement,
} from '@/hooks/useDevis'
import { apiClient } from '@/lib/api-client'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import type { Devis as DevisApi, DevisLigne, CreateDevisPayload } from '@/hooks/useDevis'
import type { Client } from '@/hooks/useClients'
import { DevisPreview } from '@/components/devis/DevisPreview'
import { useProduitsShop, type ProduitShopErp } from '@/hooks/useProduitsShop'

// ── Types ──────────────────────────────────────────────────────────────────────

type DevisRecord = DevisApi & Record<string, unknown>
type Categorie = 'materiaux' | 'main-oeuvre' | 'equipement'

// ── Constants ─────────────────────────────────────────────────────────────────

const TVA = 0.1925

const STATUT_COLORS: Record<string, { bg: string; text: string }> = {
  brouillon: { bg: '#f3f4f6', text: '#6b7280' },
  envoye:    { bg: '#dbeafe', text: '#1d4ed8' },
  accepte:   { bg: '#dcfce7', text: '#15803d' },
  refuse:    { bg: '#fee2e2', text: '#dc2626' },
  expire:    { bg: '#fef3c7', text: '#d97706' },
  transforme:{ bg: '#ede9fe', text: '#7c3aed' },
}

// ── Utils ──────────────────────────────────────────────────────────────────────

interface LocalLigne {
  id: string; produitId?: string; designation: string; categorie: Categorie
  quantite: number; prixUnitaire: number; unite: string
}

function calcTotals(lignes: LocalLigne[]) {
  const totalHT = lignes.reduce((s, l) => s + l.quantite * l.prixUnitaire, 0)
  return { totalHT, tva: Math.round(totalHT * TVA), totalTTC: Math.round(totalHT * (1 + TVA)) }
}

function mapCategorie(cat: Categorie): 'materiaux' | 'main_oeuvre' | 'equipement' {
  return cat === 'main-oeuvre' ? 'main_oeuvre' : cat
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const newLine = (): LocalLigne => ({
  id: Math.random().toString(36).slice(2), produitId: '',
  designation: '', categorie: 'materiaux', quantite: 1, prixUnitaire: 0, unite: 'unité',
})

// ── Alerte expiration (banner) ─────────────────────────────────────────────────

function AlerteExpiration({ devis }: { devis: DevisRecord[] }) {
  const expirantBientot = devis.filter((d) => {
    if (['transforme', 'expire', 'refuse'].includes(d.statut as string)) return false
    const jr = d.jours_restants as number | null
    return jr !== null && jr >= 0 && jr <= 7
  })
  const expires = devis.filter((d) => d.expire && !['transforme', 'refuse'].includes(d.statut as string))

  if (expirantBientot.length === 0 && expires.length === 0) return null

  return (
    <div className="space-y-2">
      {expires.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <OctagonX className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">
            <span className="font-bold">{expires.length} devis expiré(s)</span> — ils ne peuvent plus être approuvés par le client.
          </p>
        </motion.div>
      )}
      {expirantBientot.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl"
        >
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700">
            <span className="font-bold">{expirantBientot.length} devis expire{expirantBientot.length > 1 ? 'nt' : ''} dans ≤ 7 jours</span>
            {' '}— {expirantBientot.map((d) => d.reference as string).join(', ')}
          </p>
        </motion.div>
      )}
    </div>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DevisDetailPanel({
  devis, onClose, onEdit, onDelete, role,
}: {
  devis: DevisRecord
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  role: string | null
}) {
  const envoyerApprobation = useEnvoyerApprobation()
  const transformer        = useTransformerDevis()
  const updateStatut       = useUpdateStatutDevis()

  const statut         = devis.statut as string
  const approuve       = devis.approuve_par_client as boolean
  const commentClient  = devis.commentaire_client as string | null
  const pdfUrl         = devis.pdf_url as string | null
  const lignes         = devis.lignes as DevisLigne[]
  const client         = devis.client as DevisApi['client']
  const joursRestants  = devis.jours_restants as number | null
  const canAdmin       = role === 'admin' || role === 'superviseur'
  const canSendApproval = role === 'admin' || role === 'superviseur' || role === 'operateur'
  const canEdit        = canAdmin && ['brouillon', 'envoye', 'refuse', 'accepte'].includes(statut)
  const canDelete      = canAdmin && ['brouillon', 'refuse'].includes(statut)
  const canEnvoyerAppr = canSendApproval && ['brouillon', 'envoye'].includes(statut)
  const canTransformer = canAdmin && statut === 'accepte' && approuve
  const sc             = STATUT_COLORS[statut] ?? STATUT_COLORS.brouillon

  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Devis ${devis.reference as string}`} width="lg">
      <div className="space-y-5">

        {/* Header info */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400 mb-1">{client.nom}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: sc.bg, color: sc.text }}
              >
                {statut.charAt(0).toUpperCase() + statut.slice(1)}
              </span>
              {approuve && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="h-3 w-3" /> Approuvé par le client
                </span>
              )}
              {devis.expire && (
                <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  <OctagonX className="h-3 w-3" /> Expiré
                </span>
              )}
              {!devis.expire && joursRestants !== null && joursRestants <= 7 && joursRestants >= 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  <Clock className="h-3 w-3" /> Expire dans {joursRestants}j
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Total TTC</p>
            <p className="text-lg font-bold text-[#C62828]">{formatXAF(devis.montant_ttc_xaf as number)}</p>
          </div>
        </div>

        {/* Apercu commercial */}
        <DevisPreview
          compact
          devis={{
            numero:             devis.reference as string,
            client_nom:         client.nom,
            date_emission:      devis.date_creation as string | null,
            date_validite:      devis.date_validite as string | null,
            validite_jours:     devis.validite_jours as number,
            acompte_pct:        devis.acompte_pct as number,
            condition_paiement: (devis.condition_paiement as { libelle: string } | null)?.libelle ?? null,
            total_ht_xaf:       devis.total_ht_xaf as number,
            tva_xaf:            devis.tva_xaf as number,
            total_ttc_xaf:      devis.montant_ttc_xaf as number,
            notes:              devis.notes as string | null,
            lignes,
          }}
        />

        {/* Infos client */}
        <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3 text-xs">
          <div><p className="text-gray-400 mb-0.5">Date émission</p><p className="font-medium">{formatDate(devis.date_creation as string)}</p></div>
          <div><p className="text-gray-400 mb-0.5">Validité</p><p className="font-medium">{formatDate(devis.date_validite as string)} ({devis.validite_jours as number} j)</p></div>
          <div><p className="text-gray-400 mb-0.5">Acompte</p><p className="font-medium">{devis.acompte_pct as number}%</p></div>
          <div><p className="text-gray-400 mb-0.5">Conditions</p><p className="font-medium truncate">{(devis.condition_paiement as { libelle: string } | null)?.libelle ?? '—'}</p></div>
          {client.telephone && <div><p className="text-gray-400 mb-0.5">Tél</p><p className="font-medium">{client.telephone}</p></div>}
          {client.email     && <div><p className="text-gray-400 mb-0.5">Email</p><p className="font-medium truncate">{client.email}</p></div>}
        </div>

        {/* Commentaire client si refus */}
        {commentClient && (
          <div className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-xs font-semibold text-red-600 mb-0.5">Commentaire client</p>
            <p className="text-sm text-red-700">"{commentClient}"</p>
          </div>
        )}

        {/* Lignes */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Articles ({lignes.length})</p>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="text-left px-3 py-2 font-semibold">Désignation</th>
                  <th className="text-right px-3 py-2 font-semibold">Qté</th>
                  <th className="text-right px-3 py-2 font-semibold">P.U. HT</th>
                  <th className="text-right px-3 py-2 font-semibold">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={l.id ?? i} className="border-t border-gray-50">
                    <td className="px-3 py-2">{l.designation}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{l.quantite} {l.unite ?? 'u.'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{formatXAF(l.prix_unitaire_ht_xaf)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXAF(l.quantite * l.prix_unitaire_ht_xaf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-gray-500 text-right pr-3">
            <p>Total HT : <span className="font-semibold text-[#212121]">{formatXAF(devis.total_ht_xaf as number)}</span></p>
            <p>TVA {(TVA * 100).toFixed(2)}% : {formatXAF(devis.tva_xaf as number)}</p>
            <p className="text-sm font-bold text-[#C62828]">TTC : {formatXAF(devis.montant_ttc_xaf as number)}</p>
          </div>
        </div>

        {/* PDF */}
        {pdfUrl && (
          <button
            onClick={() => window.open(pdfUrl, '_blank')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-[#C62828] hover:bg-red-50 transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#FFEBEE' }}>
              <FileText className="h-5 w-5" style={{ color: '#C62828' }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#212121]">Voir le PDF</p>
              <p className="text-xs text-gray-400">Ouvrir dans un nouvel onglet</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 ml-auto" />
          </button>
        )}

        {/* Actions principales */}
        <div className="border-t border-gray-100 pt-4 space-y-2">

          {/* Envoyer pour approbation */}
          {canEnvoyerAppr && (
            <button
              onClick={() => {
                envoyerApprobation.mutate(devis.id as string, {
                  onSuccess: (data) => {
                    toast.success('Lien copié dans le presse-papier !')
                    window.open(data.approval_url, '_blank')
                  },
                })
              }}
              disabled={envoyerApprobation.isPending}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left disabled:opacity-50"
            >
              <Link className="h-4 w-4 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-700">
                  {envoyerApprobation.isPending ? 'Génération du lien…' : 'Envoyer lien d\'approbation au client'}
                </p>
                <p className="text-xs text-blue-500">Lien valable 30 jours · copié automatiquement</p>
              </div>
            </button>
          )}

          {canSendApproval && !canEnvoyerAppr && ['accepte', 'refuse', 'expire', 'transforme'].includes(statut) && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
              <AlertTriangle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-gray-700">Lien d'approbation indisponible</p>
                <p className="text-xs text-gray-500">Ce devis est deja {statut}; il ne peut plus recevoir un nouveau lien client.</p>
              </div>
            </div>
          )}

          {/* CMD01 — transformer en commande */}
          {canTransformer && (
            <button
              onClick={() => transformer.mutate(devis.id as string, { onSuccess: onClose })}
              disabled={transformer.isPending}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors text-left disabled:opacity-50"
            >
              <ArrowRightLeft className="h-4 w-4 text-purple-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-purple-700">
                  {transformer.isPending ? 'Création en cours…' : 'Créer la commande (CMD01)'}
                </p>
                <p className="text-xs text-purple-500">Devis approuvé par le client ✓</p>
              </div>
            </button>
          )}

          {/* CMD01 bloqué si pas approuvé */}
          {canAdmin && statut === 'accepte' && !approuve && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-700">Commande impossible (CMD01)</p>
                <p className="text-xs text-amber-600">Le client doit d'abord approuver ce devis via le lien d'approbation.</p>
              </div>
            </div>
          )}

          {/* Partager WhatsApp */}
          {statut !== 'transforme' && (
            <button
              onClick={() => {
                const phone = client.telephone?.replace(/\s+/g, '').replace(/^\+/, '') ?? ''
                const text  = encodeURIComponent(
                  `Bonjour ${client.nom},\n\nVotre devis *${devis.reference as string}* d'un montant de *${formatXAF(devis.montant_ttc_xaf as number)}* TTC est prêt.\n\n${pdfUrl ? `📄 PDF : ${pdfUrl}` : ''}\n\nCordialement,\nFORGE – TAFDIL SARL`
                )
                window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-100 hover:bg-green-50 hover:border-green-200 transition-colors text-left"
            >
              <MessageCircle className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm font-medium text-gray-700">Envoyer sur WhatsApp</span>
            </button>
          )}

          {/* Actions secondaires */}
          <div className="flex gap-2 pt-1">
            {canEdit && (
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" /> Modifier
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </button>
            )}
          </div>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Form multi-étapes (création + édition) ─────────────────────────────────────

const STEPS = ['Client', 'Lignes', 'Conditions', 'Aperçu']
const CAT_LABELS: Record<Categorie, string> = { materiaux: 'Matériaux', 'main-oeuvre': 'Main-d\'œuvre', equipement: 'Équipement' }

interface FormState {
  clientId: string; clientNom: string; clientTel: string; clientEmail: string
  lignes: LocalLigne[]; validite: 15 | 30 | 45; acompte: number; conditionPaiementId: string; notes: string
}

const DEFAULT_FORM: FormState = {
  clientId: '', clientNom: '', clientTel: '', clientEmail: '',
  lignes: [newLine()], validite: 30, acompte: 30,
  conditionPaiementId: '', notes: '',
}

function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 mb-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 transition-colors"
                style={{ backgroundColor: i <= step ? '#C62828' : '#e5e7eb', color: i <= step ? '#fff' : '#9ca3af' }}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className="text-xs font-medium hidden sm:inline" style={{ color: i <= step ? '#C62828' : '#9ca3af' }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px" style={{ backgroundColor: i < step ? '#C62828' : '#e5e7eb' }} />}
          </React.Fragment>
        ))}
      </div>
      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: '#C62828' }}
          animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.3 }} />
      </div>
    </div>
  )
}

function DevisFormPanel({
  editingDevis, onClose,
}: {
  editingDevis?: DevisRecord | null
  onClose: () => void
}) {
  // Use API (not Supabase direct) so the auth Bearer token is always sent
  const { data: clientsData } = useQuery({
    queryKey: ['clients-select'],
    queryFn:  () => apiClient.get<{ data: Client[] }>('/api/clients?per_page=200&statut=actif'),
    staleTime: 60_000,
  })
  const clients = clientsData?.data ?? []

  const createDevis = useCreateDevis()
  const updateDevis = useUpdateDevis()
  const isMutating  = createDevis.isPending || updateDevis.isPending
  const { data: condData } = useConditionsPaiement()
  const conditionsList = condData?.data ?? []
  const { data: produitsCatalogue = [] } = useProduitsShop()

  const [step,    setStep]    = useState(0)
  const [created, setCreated] = useState<{ reference: string; pdf_url: string | null; montantTTC: number } | null>(null)

  // Initialiser le formulaire depuis un devis existant si édition
  const [form, setForm] = useState<FormState>(() => {
    if (!editingDevis) return DEFAULT_FORM
    const lignesExist = (editingDevis.lignes as DevisLigne[]).map((l) => ({
      id:          l.id,
      produitId:   l.produit_id ?? '',
      designation: l.designation,
      categorie:   (l.categorie === 'main_oeuvre' ? 'main-oeuvre' : l.categorie) as Categorie,
      quantite:    l.quantite,
      prixUnitaire:l.prix_unitaire_ht_xaf,
      unite:       l.unite ?? 'unité',
    }))
    const cli = editingDevis.client as DevisApi['client']
    return {
      clientId:           cli.id ?? '',
      clientNom:          cli.nom ?? '',
      clientTel:          cli.telephone ?? '',
      clientEmail:        cli.email ?? '',
      lignes:             lignesExist.length > 0 ? lignesExist : [newLine()],
      validite:           (editingDevis.validite_jours as 15 | 30 | 45) ?? 30,
      acompte:            (editingDevis.acompte_pct as number) ?? 30,
      conditionPaiementId: (editingDevis.condition_paiement_id as string | null) ?? '',
      notes:              (editingDevis.notes as string | null) ?? '',
    }
  })

  const updateLine = (id: string, field: keyof LocalLigne, value: string | number | Categorie) =>
    setForm((f) => ({ ...f, lignes: f.lignes.map((l) => l.id === id ? { ...l, [field]: value } : l) }))

  const categorieFromProduit = (produit: ProduitShopErp): Categorie => {
    if (produit.categorie === 'main_oeuvre') return 'main-oeuvre'
    if (produit.categorie === 'equipement') return 'equipement'
    return 'materiaux'
  }

  const applyProduitToLine = (lineId: string, produitId: string) => {
    const produit = produitsCatalogue.find((p) => p.id === produitId)
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l) => {
        if (l.id !== lineId) return l
        if (!produit) return { ...l, produitId: '' }
        return {
          ...l,
          produitId:    produit.id,
          designation:  produit.nom,
          categorie:    categorieFromProduit(produit),
          unite:        produit.unite || l.unite || 'unité',
          prixUnitaire: produit.prix_public ? Math.round(produit.prix_public / (1 + TVA)) : l.prixUnitaire,
        }
      }),
    }))
  }

  const { totalHT, tva, totalTTC } = calcTotals(form.lignes)

  const stepValid = [
    form.clientNom.trim() !== '',
    form.lignes.some((l) => l.designation && l.prixUnitaire > 0),
    form.conditionPaiementId.trim() !== '',
    form.conditionPaiementId.trim() !== '',
  ][step] ?? true

  async function handleSubmit() {
    if (!form.conditionPaiementId.trim()) {
      toast.error('Selectionnez une condition de paiement')
      setStep(2)
      return
    }

    const today    = new Date().toISOString().slice(0, 10)
    const dateValid = addDays(today, form.validite)

    const payload: CreateDevisPayload = {
      client_id:           form.clientId || undefined,
      client_nom:          form.clientNom.trim(),
      client_telephone:    form.clientTel || undefined,
      client_email:        form.clientEmail || undefined,
      date_emission:       today,
      date_validite:       dateValid,
      validite_jours:      form.validite,
      acompte_pct:           form.acompte,
      condition_paiement_id: form.conditionPaiementId,
      notes:               form.notes || undefined,
      lignes: form.lignes
        .filter((l) => l.designation && l.prixUnitaire > 0)
        .map((l, i) => ({
          produit_id:           l.produitId || undefined,
          designation:          l.designation,
          categorie:            mapCategorie(l.categorie),
          unite:                l.unite || 'unité',
          quantite:             l.quantite,
          prix_unitaire_ht_xaf: l.prixUnitaire,
          ordre:                i,
        })),
    }

    if (editingDevis) {
      updateDevis.mutate({ id: editingDevis.id as string, payload }, { onSuccess: onClose })
    } else {
      const result = await createDevis.mutateAsync(payload)
      setCreated({ reference: result.reference, pdf_url: result.pdf_url, montantTTC: result.montant_ttc_xaf })
    }
  }

  const title = editingDevis
    ? `Modifier ${editingDevis.reference as string}`
    : (created ? 'Devis créé !' : 'Nouveau devis')

  return (
    <SlideOver isOpen={true} onClose={onClose} title={title} width="xl">
      {created ? (
        /* ── Écran succès création ── */
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FFEBEE' }}>
            <Check className="h-8 w-8" style={{ color: '#C62828' }} />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">Devis enregistré !</p>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-mono font-semibold" style={{ color: '#C62828' }}>{created.reference}</span>
              {' · '}<span className="font-semibold">{formatXAF(created.montantTTC)}</span> TTC
            </p>
          </div>
          <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full ${created.pdf_url ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            <FileText className="h-3.5 w-3.5" />
            {created.pdf_url ? 'PDF généré et disponible' : 'PDF en cours de génération…'}
          </div>
          {created.pdf_url && (
            <button onClick={() => window.open(created.pdf_url!, '_blank')}
              className="flex items-center gap-2 text-sm font-semibold text-[#C62828] hover:underline">
              <Eye className="h-4 w-4" /> Ouvrir le PDF
            </button>
          )}
          <button onClick={onClose} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-4 w-4" /> Fermer
          </button>
        </motion.div>
      ) : (
        <>
          <StepProgress step={step} />
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>

              {/* ── Step 0 — Client ── */}
              {step === 0 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client *</label>
                    <select
                      value={form.clientId}
                      onChange={(e) => {
                        const cli = clients.find((c) => c.id === e.target.value)
                        setForm((f) => ({
                          ...f,
                          clientId:    e.target.value,
                          clientNom:   cli?.nom ?? '',
                          clientTel:   cli?.telephone ?? '',
                          clientEmail: cli?.email ?? '',
                        }))
                      }}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    >
                      <option value="">— Sélectionner un client —</option>
                      {clients.filter((c) => c.statut !== 'inactif').map((c) => (
                        <option key={c.id} value={c.id} disabled={c.statut === 'bloque'}>
                          {c.nom}{c.statut === 'bloque' ? ' (bloqué)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Ou saisie libre */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-xs text-gray-400">ou saisie libre</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom du client *</label>
                    <input value={form.clientNom} onChange={(e) => setForm((f) => ({ ...f, clientNom: e.target.value, clientId: e.target.value !== form.clientNom ? '' : f.clientId }))}
                      placeholder="ex. CAMRAIL SA"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Téléphone</label>
                      <input value={form.clientTel} onChange={(e) => setForm((f) => ({ ...f, clientTel: e.target.value }))}
                        placeholder="+237 6XX XXX XXX"
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Email</label>
                      <input type="email" value={form.clientEmail} onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))}
                        placeholder="contact@client.com"
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 1 — Lignes ── */}
              {step === 1 && (
                <div className="space-y-3">
                  {form.lignes.map((ligne) => (
                    <div key={ligne.id} className="border border-gray-100 bg-gray-50 rounded-xl p-3 space-y-2">
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-0.5">Produit catalogue</label>
                        <select
                          value={ligne.produitId ?? ''}
                          onChange={(e) => applyProduitToLine(ligne.id, e.target.value)}
                          className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                        >
                          <option value="">Saisie libre / aucun produit</option>
                          {produitsCatalogue.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.ref ? `${p.ref} - ` : ''}{p.nom} - {p.unite || 'unité'} - stock {p.stock_actuel}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <input value={ligne.designation}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            lignes: f.lignes.map((l) => l.id === ligne.id
                              ? { ...l, produitId: '', designation: e.target.value }
                              : l),
                          }))}
                          placeholder="Désignation *"
                          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                        {form.lignes.length > 1 && (
                          <button onClick={() => setForm((f) => ({ ...f, lignes: f.lignes.filter((l) => l.id !== ligne.id) }))}
                            className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <select value={ligne.categorie} onChange={(e) => updateLine(ligne.id, 'categorie', e.target.value as Categorie)}
                          className="col-span-2 px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                          {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Quantité</label>
                          <input type="number" min="0.01" step="0.01" value={ligne.quantite}
                            onChange={(e) => updateLine(ligne.id, 'quantite', Number(e.target.value))}
                            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Unité</label>
                          <input value={ligne.unite} onChange={(e) => updateLine(ligne.id, 'unite', e.target.value)}
                            placeholder="unité"
                            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-[10px] text-gray-400 mb-0.5">Prix unitaire HT (XAF)</label>
                          <input type="number" min="0" value={ligne.prixUnitaire}
                            onChange={(e) => updateLine(ligne.id, 'prixUnitaire', Number(e.target.value))}
                            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                        </div>
                      </div>
                      {ligne.designation && ligne.prixUnitaire > 0 && (
                        <p className="text-xs text-gray-500 text-right">
                          Sous-total : <span className="font-semibold">{formatXAF(ligne.quantite * ligne.prixUnitaire)}</span>
                        </p>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setForm((f) => ({ ...f, lignes: [...f.lignes, newLine()] }))}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#C62828] hover:underline transition-colors">
                    <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
                  </button>
                  {totalHT > 0 && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs space-y-0.5 text-right">
                      <p>Total HT : <span className="font-semibold">{formatXAF(totalHT)}</span></p>
                      <p>TVA 19.25% : {formatXAF(tva)}</p>
                      <p className="text-sm font-bold text-[#C62828]">TTC : {formatXAF(totalTTC)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 2 — Conditions ── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Durée de validité</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([15, 30, 45] as const).map((v) => (
                        <button key={v} onClick={() => setForm((f) => ({ ...f, validite: v }))}
                          className="py-2.5 rounded-xl border-2 text-sm font-semibold transition-all"
                          style={{ borderColor: form.validite === v ? '#C62828' : '#e5e7eb', backgroundColor: form.validite === v ? '#FFEBEE' : 'transparent', color: form.validite === v ? '#C62828' : '#6b7280' }}>
                          {v} jours
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Acompte (%)</label>
                    <input type="number" min="0" max="100" value={form.acompte}
                      onChange={(e) => setForm((f) => ({ ...f, acompte: Number(e.target.value) }))}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Conditions de paiement *</label>
                    <select value={form.conditionPaiementId} onChange={(e) => setForm((f) => ({ ...f, conditionPaiementId: e.target.value }))}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                      <option value="">— Choisir une condition —</option>
                      {conditionsList.map((cp) => (
                        <option key={cp.id} value={cp.id}>{cp.code} — {cp.libelle}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes internes</label>
                    <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      rows={3} placeholder="Informations complémentaires…"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none" />
                  </div>
                </div>
              )}

              {/* ── Step 3 — Aperçu ── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-semibold">{form.clientNom}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Validité</span><span>{form.validite} jours</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Acompte</span><span>{form.acompte}%</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Articles</span><span>{form.lignes.filter((l) => l.designation && l.prixUnitaire > 0).length}</span></div>
                    <div className="h-px bg-gray-200" />
                    <div className="flex justify-between"><span className="text-gray-500">Total HT</span><span className="font-semibold">{formatXAF(totalHT)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">TVA 19.25%</span><span>{formatXAF(tva)}</span></div>
                    <div className="flex justify-between text-base"><span className="font-bold">Total TTC</span><span className="font-black" style={{ color: '#C62828' }}>{formatXAF(totalTTC)}</span></div>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => step > 0 ? setStep((s) => s - 1) : onClose()}>
              {step === 0 ? 'Annuler' : <><ChevronLeft className="h-3.5 w-3.5" /> Retour</>}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button className="flex-1" disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
                Suivant <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button className="flex-1" disabled={isMutating || !stepValid} onClick={handleSubmit}>
                {isMutating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enregistrement…</> : (editingDevis ? 'Enregistrer les modifications' : 'Créer le devis')}
              </Button>
            )}
          </div>
        </>
      )}
    </SlideOver>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function Devis() {
  const { role } = useAuth()
  const canAdmin = role === 'admin' || role === 'superviseur'

  const [formOpen,      setFormOpen]      = useState(false)
  const [selectedDevis, setSelectedDevis] = useState<DevisRecord | null>(null)
  const [editingDevis,  setEditingDevis]  = useState<DevisRecord | null>(null)
  const [deleteId,      setDeleteId]      = useState<string | null>(null)
  const [filtreStatut,  setFiltreStatut]  = useState('')
  const [search,        setSearch]        = useState('')

  const { data, isLoading } = useDevis({ statut: filtreStatut || undefined, search: search || undefined })
  const deleteDevis         = useDeleteDevis()

  const devis  = (data?.data ?? []) as DevisRecord[]
  const volume = devis.reduce((s, d) => s + (d.montant_ttc_xaf as number), 0)

  // ── Colonnes table ──────────────────────────────────────────────────────────

  const COLUMNS: Column<DevisRecord>[] = useMemo(() => [
    {
      id: 'reference', header: 'Référence', accessor: 'reference',
      render: (v, row) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-bold text-[#212121]">{v as string}</span>
          {(row.source_web as boolean) && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wide">WEB</span>
          )}
        </div>
      ),
    },
    {
      id: 'client', header: 'Client',
      accessor: (r) => (r.client as DevisApi['client']).nom,
      render: (v) => <span className="text-sm font-medium">{v as string}</span>,
    },
    {
      id: 'validite', header: 'Validité', accessor: 'date_validite',
      render: (v, row) => {
        const jr = row.jours_restants as number | null
        const exp = row.expire as boolean
        if (exp) return (
          <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
            <OctagonX className="h-3 w-3" /> Expiré
          </span>
        )
        if (jr !== null && jr <= 7 && jr >= 0) return (
          <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
            <Clock className="h-3 w-3" /> {jr}j restants
          </span>
        )
        return <span className="text-xs text-gray-500">{v ? formatDate(v as string) : '—'}</span>
      },
    },
    {
      id: 'montant', header: 'Total TTC', accessor: 'montant_ttc_xaf',
      render: (v) => <span className="font-semibold text-sm">{formatXAF(v as number)}</span>,
    },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: (v, row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge status={v as string} />
          {(row.approuve_par_client as boolean) && (
            <ShieldCheck className="h-3.5 w-3.5 text-green-500 shrink-0" title="Approuvé par le client" />
          )}
        </div>
      ),
    },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="Voir les détails"
            onClick={() => setSelectedDevis(row)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
            <Eye className="h-3.5 w-3.5" />
          </button>
          {canAdmin && ['brouillon', 'envoye', 'refuse', 'accepte'].includes(row.statut as string) && (
            <button title="Modifier"
              onClick={() => { setEditingDevis(row); setSelectedDevis(null) }}
              className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors">
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )}
          {canAdmin && ['brouillon', 'refuse'].includes(row.statut as string) && (
            <button title="Supprimer"
              onClick={() => setDeleteId(row.id as string)}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ], [canAdmin])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <PageHeader
        title="Devis"
        subtitle={`${data?.total ?? 0} devis · ${formatXAF(volume)} en volume`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Devis' }]}
        actions={
          canAdmin ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nouveau devis
            </Button>
          ) : undefined
        }
      />

      {/* Alertes expiration */}
      <AlerteExpiration devis={devis} />

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un devis…"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] min-w-[200px]" />
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
          <option value="">Tous statuts</option>
          <option value="brouillon">Brouillon</option>
          <option value="envoye">Envoyé</option>
          <option value="accepte">Accepté</option>
          <option value="refuse">Refusé</option>
          <option value="expire">Expiré</option>
          <option value="transforme">Transformé</option>
        </select>
      </div>

      {/* Table */}
      <DataTable<DevisRecord>
        columns={COLUMNS}
        data={devis}
        keyField="id"
        loading={isLoading}
        onRowClick={(row) => setSelectedDevis(row)}
      />

      {/* Panel détail */}
      {selectedDevis && (
        <DevisDetailPanel
          devis={selectedDevis}
          role={role}
          onClose={() => setSelectedDevis(null)}
          onEdit={() => { setEditingDevis(selectedDevis); setSelectedDevis(null) }}
          onDelete={() => { setDeleteId(selectedDevis.id as string); setSelectedDevis(null) }}
        />
      )}

      {/* Formulaire création / édition */}
      {(formOpen || editingDevis) && (
        <DevisFormPanel
          editingDevis={editingDevis}
          onClose={() => { setFormOpen(false); setEditingDevis(null) }}
        />
      )}

      {/* Confirmation suppression */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Supprimer ce devis ?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Cette action est irréversible. Le devis et toutes ses lignes seront supprimés.</p>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setDeleteId(null)}>Annuler</Button>
            <button
              onClick={() => deleteDevis.mutate(deleteId!, { onSuccess: () => setDeleteId(null) })}
              disabled={deleteDevis.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleteDevis.isPending ? 'Suppression…' : 'Confirmer'}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
