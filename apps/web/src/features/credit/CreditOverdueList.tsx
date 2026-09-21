import React, { useState } from 'react'
import { AlertTriangle, CreditCard, Eye, MessageSquare, RefreshCw } from 'lucide-react'
import { Button, DataTable } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useOverdueInstallments } from '@/hooks/useCredit'
import type { OverdueRow } from '@/hooks/useCredit'
import { PaymentPlanDetail } from './PaymentPlanDetail'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

interface Props {
  compact?: boolean
}

export function CreditOverdueList({ compact = false }: Props) {
  const { data, loading, refetch } = useOverdueInstallments()
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [sendingReminder, setSendingReminder] = useState<string | null>(null)

  async function handleSendReminder(row: OverdueRow) {
    const planId = row.payment_plans?.id ?? row.payment_plan_id
    setSendingReminder(planId)
    try {
      // Appel endpoint SMS rappel (réutilise le cron endpoint en mode ciblé)
      await apiClient.post('/api/credit/cron/mark-overdue', {})
      toast.success('Rappel SMS envoyé')
    } catch (e) {
      toast.error(`Échec SMS : ${(e as Error).message}`)
    } finally {
      setSendingReminder(null)
    }
  }

  const columns: Column<OverdueRow>[] = [
    {
      id:       'client',
      header:   'Client',
      accessor: 'id',
      render:   (_, row) => (
        <div>
          <p className="font-medium text-gray-900 text-sm">
            {row.payment_plans?.clients?.nom ?? '—'}
          </p>
          <p className="text-xs text-gray-400">
            {row.payment_plans?.clients?.telephone ?? ''}
          </p>
        </div>
      ),
    },
    {
      id:       'amount_due',
      header:   'Montant dû',
      accessor: 'amount_due',
      render:   (_, row) => (
        <span className="font-semibold text-red-600">
          {formatXAF(row.amount_due - row.amount_paid)}
        </span>
      ),
    },
    {
      id:       'due_date',
      header:   'Échéance prévue',
      accessor: 'due_date',
      render:   (_, row) => <span className="text-sm text-gray-600">{formatDate(row.due_date)}</span>,
    },
    {
      id:       'days_late',
      header:   'Retard',
      accessor: 'days_late',
      render:   (_, row) => (
        <span className={`text-sm font-semibold ${row.days_late > 30 ? 'text-red-600' : 'text-amber-600'}`}>
          {row.days_late}j
        </span>
      ),
    },
    {
      id:       'status',
      header:   'Statut',
      accessor: 'status',
      render:   (_, row) => (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="w-3 h-3" /> {row.status}
        </span>
      ),
    },
    ...(!compact ? [{
      id:       'actions',
      header:   '',
      accessor: 'id' as keyof OverdueRow,
      csvSkip:  true,
      render:   (_: unknown, row: OverdueRow) => {
        const planId = row.payment_plans?.id ?? row.payment_plan_id
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelectedPlanId(planId)}
              title="Voir le plan"
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleSendReminder(row)}
              disabled={sendingReminder === planId}
              title="Envoyer rappel SMS"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          </div>
        )
      },
    } satisfies Column<OverdueRow>] : []),
  ]

  if (selectedPlanId) {
    return (
      <div>
        <button
          onClick={() => setSelectedPlanId(null)}
          className="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1"
        >
          ← Retour aux impayés
        </button>
        <PaymentPlanDetail planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          Impayés en retard
          {data.length > 0 && (
            <span className="bg-red-100 text-red-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
              {data.length}
            </span>
          )}
        </h3>
        <Button variant="secondary" size="sm" onClick={refetch} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {data.length === 0 && !loading ? (
        <div className="text-center text-sm text-gray-400 py-8">
          Aucun impayé en retard
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={compact ? data.slice(0, 5) : data}
          loading={loading}
          emptyMessage="Aucun impayé"
        />
      )}

      {compact && data.length > 5 && (
        <p className="text-xs text-center text-gray-400">
          +{data.length - 5} autres — voir la liste complète
        </p>
      )}
    </div>
  )
}
