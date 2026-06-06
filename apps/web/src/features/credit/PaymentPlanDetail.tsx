import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, Clock, AlertTriangle, CreditCard, Loader2, X } from 'lucide-react'
import { Button, Modal, StatusBadge } from '@forge/ui'
import { formatXAF, formatDate, formatDateTime } from '@/lib/utils'
import { usePaymentPlan, useRecordPayment } from '@/hooks/useCredit'
import type { Installment, PaymentMethod } from '@/hooks/useCredit'

interface Props {
  planId: string
  onBack?: () => void
}

const STATUS_MAP = {
  PENDING:  { label: 'En attente', icon: <Clock className="w-4 h-4 text-amber-500" />,  color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  PARTIAL:  { label: 'Partiel',    icon: <Clock className="w-4 h-4 text-blue-500" />,   color: 'text-blue-600',  bg: 'bg-blue-50 border-blue-200' },
  PAID:     { label: 'Payée',      icon: <CheckCircle className="w-4 h-4 text-green-500" />, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  OVERDUE:  { label: 'Retard',     icon: <AlertTriangle className="w-4 h-4 text-red-500" />, color: 'text-red-600',   bg: 'bg-red-50 border-red-200' },
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH',         label: 'Espèces' },
  { value: 'ORANGE_MONEY', label: 'Orange Money' },
  { value: 'MTN_MOMO',     label: 'MTN MoMo' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money (autre)' },
  { value: 'TRANSFER',     label: 'Virement' },
  { value: 'CHECK',        label: 'Chèque' },
]

interface PayModal { open: boolean; installment: Installment | null }

export function PaymentPlanDetail({ planId, onBack }: Props) {
  const { data: plan, installments, loading, refetch } = usePaymentPlan(planId)
  const { pay, loading: paying } = useRecordPayment(planId)

  const [payModal, setPayModal] = useState<PayModal>({ open: false, installment: null })
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH')
  const [payNotes, setPayNotes]   = useState('')

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!payModal.installment) return
    const amt = parseInt(payAmount)
    if (!amt || amt <= 0) return

    await pay(payModal.installment.id, { amount: amt, method: payMethod, notes: payNotes || undefined })
    setPayModal({ open: false, installment: null })
    setPayAmount(''); setPayNotes('')
    refetch()
  }

  function openPayModal(inst: Installment) {
    const remaining = inst.amount_due - inst.amount_paid
    setPayAmount(String(remaining))
    setPayMethod('CASH')
    setPayNotes('')
    setPayModal({ open: true, installment: inst })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement…
      </div>
    )
  }

  if (!plan) {
    return <div className="text-center text-gray-500 py-12">Plan introuvable</div>
  }

  const paidPct = plan.total_amount > 0
    ? Math.round(((plan.total_amount - plan.outstanding_balance) / plan.total_amount) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* En-tête plan */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">
              Plan {plan.commandes?.numero ?? plan.id.slice(0, 8)}
            </h2>
            <p className="text-sm text-gray-500">{plan.clients?.nom}</p>
          </div>
          <StatusBadge status={plan.status} />
        </div>

        {/* Barre de progression */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Encours : {formatXAF(plan.outstanding_balance)}</span>
            <span>{paidPct}% remboursé</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${paidPct}%` }}
              transition={{ duration: 0.6 }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{formatXAF(plan.total_amount - plan.outstanding_balance)} payé</span>
            <span>{formatXAF(plan.total_amount)} total</span>
          </div>
        </div>
      </div>

      {/* Timeline des échéances */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Échéances</h3>
        {installments.map((inst, i) => {
          const s       = STATUS_MAP[inst.status] ?? STATUS_MAP.PENDING
          const canPay  = inst.status !== 'PAID'
          const remaining = inst.amount_due - inst.amount_paid

          return (
            <motion.div
              key={inst.id}
              className={`flex items-center gap-3 p-3 rounded-xl border ${s.bg}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              {s.icon}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">
                    Échéance {inst.installment_number}
                  </span>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${s.bg} ${s.color}`}>
                    {s.label}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Prévu : {inst.due_date}
                  {inst.paid_at && ` · Payé le ${formatDate(inst.paid_at)}`}
                </div>
                <div className="text-xs text-gray-700 mt-0.5">
                  {formatXAF(inst.amount_paid)} / {formatXAF(inst.amount_due)}
                  {remaining > 0 && inst.status !== 'PAID' && (
                    <span className="text-amber-600"> · Reste {formatXAF(remaining)}</span>
                  )}
                </div>
                {inst.payment_method && (
                  <div className="text-xs text-gray-400">{PAYMENT_METHODS.find(m => m.value === inst.payment_method)?.label}</div>
                )}
              </div>
              {canPay && plan.status !== 'CANCELLED' && (
                <Button size="sm" variant="outline" onClick={() => openPayModal(inst)}>
                  <CreditCard className="w-3.5 h-3.5 mr-1" /> Payer
                </Button>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Modal paiement */}
      <Modal
        open={payModal.open}
        onClose={() => setPayModal({ open: false, installment: null })}
        title={`Paiement — Échéance ${payModal.installment?.installment_number}`}
      >
        <form onSubmit={handlePay} className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Montant (FCFA)</label>
            <input
              type="number"
              min={1}
              max={payModal.installment ? payModal.installment.amount_due - payModal.installment.amount_paid : undefined}
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            {payModal.installment && (
              <p className="text-xs text-gray-500 mt-1">
                Maximum : {formatXAF(payModal.installment.amount_due - payModal.installment.amount_paid)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mode de paiement</label>
            <select
              value={payMethod}
              onChange={e => setPayMethod(e.target.value as PaymentMethod)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
            <textarea
              rows={2}
              value={payNotes}
              onChange={e => setPayNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setPayModal({ open: false, installment: null })}>
              Annuler
            </Button>
            <Button type="submit" disabled={paying} loading={paying}>
              Enregistrer le paiement
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
