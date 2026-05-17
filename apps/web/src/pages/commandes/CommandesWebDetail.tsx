import React, { useState } from 'react'
import {
  Phone, Mail, MapPin, ExternalLink, MessageCircle,
  Loader2, AlertTriangle, CheckCircle, Package, Truck,
} from 'lucide-react'
import { SlideOver, Button, StatusBadge } from '@forge/ui'
import { formatXAF, formatDateTime } from '@/lib/utils'
import { useStatutCommandeShop } from '@/hooks/useCommandesShop'
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
    .replace('{ttc}', commande.montant_ttc?.toLocaleString('fr-CM') ?? '')
  const phone = commande.client_telephone.replace(/\D/g, '')
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

// ── Actions disponibles selon le statut ───────────────────────────────────────

interface Action {
  label: string
  icon: React.ElementType
  nextStatut: StatutCommandeShop
  nextPaiement?: 'paye'
  variant?: 'primary' | 'secondary'
  confirmText?: string
}

function getActions(commande: CommandeShop): Action[] {
  const { statut_commande, statut_paiement } = commande
  const actions: Action[] = []

  if (statut_commande === 'recue') {
    if (statut_paiement === 'en_attente') {
      actions.push({
        label: 'Confirmer sans paiement',
        icon: CheckCircle,
        nextStatut: 'confirmee',
        variant: 'secondary',
        confirmText: 'Confirmer la commande sans paiement reçu ?',
      })
    }
    if (statut_paiement === 'paye') {
      actions.push({
        label: 'Lancer la préparation',
        icon: Package,
        nextStatut: 'en_preparation',
        variant: 'primary',
      })
    }
  }

  if (statut_commande === 'confirmee') {
    actions.push({
      label: 'Lancer la préparation',
      icon: Package,
      nextStatut: 'en_preparation',
      variant: 'primary',
    })
  }

  if (statut_commande === 'en_preparation') {
    actions.push({
      label: 'Marquer comme prête',
      icon: CheckCircle,
      nextStatut: 'expediee',
      variant: 'primary',
    })
  }

  if (statut_commande === 'expediee') {
    actions.push({
      label: 'Confirmer la livraison',
      icon: Truck,
      nextStatut: 'livree',
      variant: 'primary',
    })
  }

  return actions
}

// ── Composant principal ────────────────────────────────────────────────────────

interface Props {
  commande: CommandeShop
  onClose: () => void
}

export function CommandesWebDetail({ commande, onClose }: Props) {
  const [confirming, setConfirming] = useState<Action | null>(null)
  const statutMutation = useStatutCommandeShop()

  const actions = getActions(commande)

  const handleAction = (action: Action) => {
    if (action.confirmText) {
      setConfirming(action)
    } else {
      executeAction(action)
    }
  }

  const executeAction = (action: Action) => {
    statutMutation.mutate(
      {
        id:              commande.id,
        statut_commande: action.nextStatut,
        statut_paiement: action.nextPaiement,
      },
      { onSuccess: () => { setConfirming(null); onClose() } }
    )
  }

  const totalHT = commande.montant_ht ?? 0
  const tva     = commande.tva ?? 0
  const ttc     = commande.montant_ttc ?? 0

  return (
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

        {/* Confirmation modale inline */}
        {confirming && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-500" />
              <p className="text-sm font-medium text-orange-800">{confirming.confirmText}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => executeAction(confirming)} disabled={statutMutation.isPending}>
                {statutMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Confirmer'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>Annuler</Button>
            </div>
          </div>
        )}

        {/* Actions workflow */}
        {actions.length > 0 && !confirming && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-gray-400">Actions</h3>
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <Button
                  key={action.nextStatut}
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

        <Button variant="secondary" className="w-full" onClick={onClose}>Fermer</Button>
      </div>
    </SlideOver>
  )
}
