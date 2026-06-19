import React, { useState } from 'react'
import {
  Phone, Mail, MapPin, ExternalLink, MessageCircle,
  Loader2, AlertTriangle, CheckCircle, Package, Truck, CreditCard, XCircle,
} from 'lucide-react'
import { SlideOver, Button, StatusBadge, Modal } from '@forge/ui'
import { formatXAF, formatNombre, formatDateTime } from '@/lib/utils'
import { useStatutCommandeShop, useAnnulerCommandeShop } from '@/hooks/useCommandesShop'
import type { CommandeShop, StatutCommandeShop } from '@/hooks/useCommandesShop'

// ── Labels ──────────────────────────────────────────────────────────────────────

const LABELS_PAIEMENT: Record<string, string> = {
  en_attente: 'En attente',
  paye:       'Payé',
  echec:      'Échec',
  rembourse:  'Remboursé',
}

const COLORS_PAIEMENT: Record<string, string> = {
  en_attente: '#d97706',
  paye:       '#15803d',
  echec:      '#dc2626',
  rembourse:  '#6b7280',
}

const LABELS_MODE: Record<string, string> = {
  mtn_momo:     'MTN MoMo',
  orange_money: 'Orange Money',
  livraison:    'Paiement à la livraison',
}

const WHATSAPP_TEMPLATES: Record<StatutCommandeShop, string> = {
  recue:          'Bonjour {nom}, votre commande {ref} a bien été reçue. Nous la traitons dans les plus brefs délais. — TAFDIL',
  confirmee:      'Bonjour {nom}, votre commande {ref} est confirmée. Montant : {ttc} FCFA. — TAFDIL',
  en_preparation: 'Bonjour {nom}, votre commande {ref} est en cours de préparation. — TAFDIL',
  expediee:       'Bonjour {nom}, votre commande {ref} est en route ! Livraison sous 24-48h. — TAFDIL',
  livree:         'Bonjour {nom}, votre commande {ref} a été livrée. Merci de votre confiance ! — TAFDIL',
  annulee:        'Bonjour {nom}, votre commande {ref} a été annulée. Contactez-nous pour plus d\'informations. — TAFDIL',
}

function buildWhatsAppUrl(commande: CommandeShop): string {
  const template = WHATSAPP_TEMPLATES[commande.statut_commande]
  const message = template
    .replace('{nom}', commande.client_nom)
    .replace('{ref}', commande.ref)
    .replace('{ttc}', commande.montant_ttc != null ? formatNombre(commande.montant_ttc) : '')
  const phone = commande.client_telephone.replace(/\D/g, '')
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

// ── Actions disponibles selon le statut ───────────────────────────────────────

interface Action {
  label: string
  icon: React.ElementType
  nextStatut: StatutCommandeShop
  nextPaiement?: 'paye'
  requiresRef?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  confirmText?: string
}

const PAIEMENT_EN_LIGNE: string[] = ['mtn_momo', 'orange_money']

function getActions(commande: CommandeShop): Action[] {
  const { statut_commande, statut_paiement, mode_paiement } = commande
  const actions: Action[] = []
  const paiementEnLigne = PAIEMENT_EN_LIGNE.includes(mode_paiement)

  if (statut_commande === 'recue') {
    if (statut_paiement === 'en_attente') {
      if (paiementEnLigne) {
        actions.push({
          label:       'Paiement reçu — Lancer la préparation',
          icon:        CreditCard,
          nextStatut:  'en_preparation',
          nextPaiement: 'paye',
          requiresRef: true,
          variant:     'primary',
        })
      }
      actions.push({
        label:       'Confirmer sans paiement',
        icon:        CheckCircle,
        nextStatut:  'confirmee',
        variant:     'secondary',
        confirmText: 'Confirmer la commande sans paiement reçu ?',
      })
    }
    if (statut_paiement === 'paye') {
      actions.push({
        label:      'Lancer la préparation',
        icon:       Package,
        nextStatut: 'en_preparation',
        variant:    'primary',
      })
    }
  }

  if (statut_commande === 'confirmee') {
    if (statut_paiement === 'en_attente' && paiementEnLigne) {
      actions.push({
        label:        'Confirmer paiement reçu',
        icon:         CreditCard,
        nextStatut:   'confirmee',
        nextPaiement: 'paye',
        requiresRef:  true,
        variant:      'primary',
      })
    }
    actions.push({
      label:      'Lancer la préparation',
      icon:       Package,
      nextStatut: 'en_preparation',
      variant:    statut_paiement === 'paye' ? 'primary' : 'secondary',
    })
  }

  if (statut_commande === 'en_preparation') {
    actions.push({
      label:      'Marquer comme prête — Expédier',
      icon:       CheckCircle,
      nextStatut: 'expediee',
      variant:    'primary',
    })
  }

  if (statut_commande === 'expediee') {
    actions.push({
      label:        'Confirmer la livraison',
      icon:         Truck,
      nextStatut:   'livree',
      nextPaiement: mode_paiement === 'livraison' ? 'paye' : undefined,
      variant:      'primary',
    })
  }

  return actions
}

// ── Composant principal ────────────────────────────────────────────────────────

interface Props {
  commande: CommandeShop
  onClose: () => void
}

const MOTIFS_ANNULATION = [
  'Rupture de stock',
  'Demande client',
  'Erreur de commande',
  'Autre',
]

export function CommandesWebDetail({ commande, onClose }: Props) {
  const [confirming, setConfirming]         = useState<Action | null>(null)
  const [paymentRef, setPaymentRef]         = useState('')
  const [showAnnuler, setShowAnnuler]       = useState(false)
  const [motifAnnulation, setMotifAnnulation] = useState(MOTIFS_ANNULATION[0])
  const statutMutation  = useStatutCommandeShop()
  const annulerMutation = useAnnulerCommandeShop()

  const peutAnnuler = commande.statut_commande !== 'livree' && commande.statut_commande !== 'annulee'

  const actions = getActions(commande)

  const handleAction = (action: Action) => {
    if (action.requiresRef || action.confirmText) {
      setConfirming(action)
      setPaymentRef('')
    } else {
      executeAction(action, '')
    }
  }

  const executeAction = (action: Action, ref: string) => {
    statutMutation.mutate(
      {
        id:                commande.id,
        statut_commande:   action.nextStatut,
        statut_paiement:   action.nextPaiement,
        payment_reference: ref || undefined,
      },
      { onSuccess: () => { setConfirming(null); setPaymentRef(''); onClose() } }
    )
  }

  const totalHT = commande.montant_ht ?? 0
  const tva     = commande.tva ?? 0
  const ttc     = commande.montant_ttc ?? 0

  return (
    <>
    <SlideOver isOpen={true} onClose={onClose} title={`Commande ${commande.ref}`} width="lg">
      <div className="space-y-6">

        {/* Bandeau statuts */}
        <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-1">Statut commande</p>
            <StatusBadge status={commande.statut_commande} />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-1">Paiement</p>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                backgroundColor: `${COLORS_PAIEMENT[commande.statut_paiement]}20`,
                color: COLORS_PAIEMENT[commande.statut_paiement],
              }}
            >
              {LABELS_PAIEMENT[commande.statut_paiement]}
            </span>
          </div>
          {commande.payment_reference && (
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-1">Réf. paiement</p>
              <span className="font-mono text-xs text-[#C62828]">{commande.payment_reference}</span>
            </div>
          )}
        </div>

        {/* Client */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Client</h3>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-[#212121]">{commande.client_nom}</p>
            <a
              href={`tel:${commande.client_telephone}`}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#C62828]"
            >
              <Phone size={13} /> {commande.client_telephone}
            </a>
            {commande.client_email && (
              <a
                href={`mailto:${commande.client_email}`}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#C62828]"
              >
                <Mail size={13} /> {commande.client_email}
              </a>
            )}
            <p className="flex items-start gap-2 text-sm text-gray-600">
              <MapPin size={13} className="mt-0.5 shrink-0" />
              {commande.client_adresse}
              {commande.client_ville ? `, ${commande.client_ville}` : ''}
            </p>
          </div>
        </div>

        {/* Mode paiement */}
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-400">Mode de paiement</h3>
          <p className="text-sm text-[#212121]">{LABELS_MODE[commande.mode_paiement] ?? commande.mode_paiement}</p>
        </div>

        {/* Lignes */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Lignes commandées</h3>
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#C62828' }}>
                <tr>
                  {['Désignation', 'Qté', 'P.U.', 'Total HT'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {commande.lignes.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{l.designation}</td>
                    <td className="px-3 py-2 text-center">{l.quantite}</td>
                    <td className="px-3 py-2 text-right">{formatXAF(l.prix_unitaire)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatXAF(l.total_ht)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 bg-gray-50 px-3 py-2">
              {commande.frais_livraison > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Frais de livraison</span>
                  <span>{formatXAF(commande.frais_livraison)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Total HT</span><span>{formatXAF(totalHT)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>TVA 19.25%</span><span>{formatXAF(tva)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-[#212121]">
                <span>Total TTC</span><span>{formatXAF(ttc)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes client */}
        {commande.notes_client && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-gray-400">Notes client</h3>
            <p className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">{commande.notes_client}</p>
          </div>
        )}

        {/* Lien commande ERP */}
        {commande.erp_commande_id && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-gray-400">Commande ERP liée</h3>
            <a
              href={`/commandes`}
              className="inline-flex items-center gap-1.5 text-sm text-[#C62828] hover:underline"
            >
              <ExternalLink size={13} /> Voir dans le module Commandes
            </a>
          </div>
        )}

        {/* Timestamps */}
        <div className="flex gap-6 text-xs text-gray-400">
          <span>Créée le {formatDateTime(commande.created_at)}</span>
          <span>Mise à jour {formatDateTime(commande.updated_at)}</span>
        </div>

        {/* Confirmation / saisie référence paiement */}
        {confirming && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-500" />
              <p className="text-sm font-medium text-orange-800">
                {confirming.confirmText ?? `Confirmer : ${confirming.label} ?`}
              </p>
            </div>
            {confirming.requiresRef && (
              <div>
                <label className="mb-1 block text-xs font-medium text-orange-700">
                  Référence paiement {PAIEMENT_EN_LIGNE.includes(commande.mode_paiement) ? '(MoMo / OM)' : ''} — optionnel
                </label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="ex: CI240608001234"
                  className="w-full rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm font-mono outline-none focus:border-orange-400"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => executeAction(confirming, paymentRef)} disabled={statutMutation.isPending}>
                {statutMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Confirmer'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { setConfirming(null); setPaymentRef('') }}>Annuler</Button>
            </div>
          </div>
        )}

        {/* Actions workflow */}
        {actions.length > 0 && !confirming && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-gray-400">Actions</h3>
            {actions.map((action, i) => {
              const Icon = action.icon
              return (
                <Button
                  key={`${action.nextStatut}-${i}`}
                  variant={action.variant === 'secondary' ? 'secondary' : 'primary'}
                  className="w-full justify-center gap-2"
                  onClick={() => handleAction(action)}
                  disabled={statutMutation.isPending}
                >
                  {statutMutation.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Icon size={14} />
                  }
                  {action.label}
                </Button>
              )
            })}
          </div>
        )}

        {/* WhatsApp */}
        <div className="border-t border-gray-100 pt-4">
          <a
            href={buildWhatsAppUrl(commande)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800 transition-colors hover:bg-green-100"
          >
            <MessageCircle size={15} />
            Envoyer message WhatsApp au client
          </a>
        </div>

        {/* Annulation */}
        {peutAnnuler && (
          <div className="border-t border-red-100 pt-4">
            <button
              onClick={() => { setMotifAnnulation(MOTIFS_ANNULATION[0]); setShowAnnuler(true) }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              <XCircle size={15} />
              Annuler la commande
            </button>
          </div>
        )}

        <Button variant="secondary" className="w-full" onClick={onClose}>Fermer</Button>
      </div>
    </SlideOver>

    {/* Modal de confirmation d'annulation */}
    <Modal
      isOpen={showAnnuler}
      onClose={() => setShowAnnuler(false)}
      title="Annuler la commande"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Confirmer l'annulation de la commande{' '}
          <span className="font-mono font-semibold text-[#C62828]">#{commande.ref}</span> ?{' '}
          Cette action est irréversible.
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">
            Motif d'annulation
          </label>
          <select
            value={motifAnnulation}
            onChange={(e) => setMotifAnnulation(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-1 focus:ring-[#C62828]/20"
          >
            {MOTIFS_ANNULATION.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setShowAnnuler(false)}
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Conserver
          </button>
          <button
            disabled={annulerMutation.isPending}
            onClick={() =>
              annulerMutation.mutate(
                { id: commande.id, motif: motifAnnulation },
                { onSuccess: () => { setShowAnnuler(false); onClose() } }
              )
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {annulerMutation.isPending
              ? <Loader2 size={14} className="animate-spin" />
              : <XCircle size={14} />
            }
            Annuler la commande
          </button>
        </div>
      </div>
    </Modal>
    </>
  )
}
