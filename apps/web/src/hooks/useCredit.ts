/**
 * FORGE ERP — Hooks React pour le module Crédit / Plans de paiement.
 * Utilise apiClient + TanStack Query (si disponible) ou useState/useEffect natif.
 */
import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

// ── Types API ─────────────────────────────────────────────────────────────────

export type EligibilityType   = 'PROFESSIONAL' | 'INDIVIDUAL' | 'VIP'
export type PlanStatus        = 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
export type PaymentMethod     = 'CASH' | 'MOBILE_MONEY' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'TRANSFER' | 'CHECK'

export interface CreditLimit {
  id:                       string
  customer_id:              string
  max_credit_amount:        number
  is_active:                boolean
  eligibility_type:         EligibilityType
  min_order_history_months: number
  min_past_orders_count:    number
  created_at:               string
  updated_at:               string
}

export interface EligibilityCheck {
  eligible:        boolean
  availableCredit: number
  reason?:         string
  details: {
    accountAgeMonths:      number
    completedOrdersCount:  number
    outstandingBalance:    number
    creditLimit:           number
    outstandingRatio:      number
  }
}

export interface Installment {
  id:                 string
  payment_plan_id:    string
  installment_number: number
  due_date:           string
  amount_due:         number
  amount_paid:        number
  paid_at:            string | null
  payment_method:     PaymentMethod | null
  status:             InstallmentStatus
  notes:              string | null
}

export interface PaymentPlan {
  id:                  string
  order_id:            string
  customer_id:         string
  total_amount:        number
  outstanding_balance: number
  status:              PlanStatus
  created_at:          string
  updated_at:          string
  clients?:            { id: string; nom: string; telephone?: string }
  commandes?:          { id: string; numero: string; total_ttc_xaf: number }
  installments?:       Installment[]
}

export interface CreditDashboard {
  totalEncours:  number
  activeClients: number
  overdueCount:  number
  recoveryRate:  number
  monthlyTrend:  Array<{ month: string; amount: number }>
}

export interface OverdueRow extends Installment {
  days_late:    number
  payment_plans?: {
    id:           string
    customer_id:  string
    total_amount: number
    outstanding_balance: number
    clients?: { id: string; nom: string; telephone?: string }
  }
}

// ── useCreditLimit ────────────────────────────────────────────────────────────

export function useCreditLimit(customerId: string | null) {
  const [data, setData]     = useState<CreditLimit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (!customerId) return
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: CreditLimit[] }>(`/api/credit/limits/${customerId}`)
      setData(res.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { fetch_() }, [fetch_])
  return { data, loading, error, refetch: fetch_ }
}

// ── useEligibilityCheck ───────────────────────────────────────────────────────

export function useEligibilityCheck(customerId: string | null) {
  const [data, setData]       = useState<EligibilityCheck | null>(null)
  const [loading, setLoading] = useState(false)

  const check = useCallback(async (id?: string) => {
    const cid = id ?? customerId
    if (!cid) return
    setLoading(true)
    try {
      const res = await apiClient.get<EligibilityCheck>(`/api/credit/limits/${cid}/check`)
      setData(res)
      return res
    } catch (e) {
      toast.error(`Vérification éligibilité : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  return { data, loading, check }
}

// ── useCreateCreditLimit ──────────────────────────────────────────────────────

export function useCreateCreditLimit() {
  const [loading, setLoading] = useState(false)

  const create = async (body: {
    customer_id:              string
    max_credit_amount:        number
    eligibility_type:         EligibilityType
    min_order_history_months: number
    min_past_orders_count:    number
    is_active:                boolean
  }) => {
    setLoading(true)
    try {
      const res = await apiClient.post<{ data: CreditLimit }>('/api/credit/limits', body)
      toast.success('Plafond de crédit enregistré')
      return res.data
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
      throw e
    } finally {
      setLoading(false)
    }
  }

  return { create, loading }
}

// ── usePaymentPlans ───────────────────────────────────────────────────────────

export function usePaymentPlans(customerId?: string, status?: string) {
  const [data, setData]       = useState<PaymentPlan[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (customerId) params.set('customerId', customerId)
      if (status)     params.set('status', status)
      const res = await apiClient.get<{ data: PaymentPlan[]; total: number }>(
        `/api/credit/plans?${params.toString()}`,
      )
      setData(res.data)
      setTotal(res.total)
    } catch (e) {
      toast.error(`Erreur chargement plans : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [customerId, status])

  useEffect(() => { fetch_() }, [fetch_])
  return { data, total, loading, refetch: fetch_ }
}

// ── usePaymentPlan ────────────────────────────────────────────────────────────

export function usePaymentPlan(planId: string | null) {
  const [data, setData]       = useState<PaymentPlan | null>(null)
  const [installments, setInstallments] = useState<Installment[]>([])
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    if (!planId) return
    setLoading(true)
    try {
      const [planRes, instRes] = await Promise.all([
        apiClient.get<{ data: PaymentPlan }>(`/api/credit/plans/${planId}`),
        apiClient.get<{ data: Installment[] }>(`/api/credit/plans/${planId}/installments`),
      ])
      setData(planRes.data)
      setInstallments(instRes.data)
    } catch (e) {
      toast.error(`Erreur chargement plan : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => { fetch_() }, [fetch_])
  return { data, installments, loading, refetch: fetch_ }
}

// ── useCreatePaymentPlan ──────────────────────────────────────────────────────

export function useCreatePaymentPlan() {
  const [loading, setLoading] = useState(false)

  const create = async (body: {
    order_id:              string
    customer_id:           string
    total_amount:          number
    installments_count:    2 | 3 | 4 | 6
    first_payment_percent: number
  }) => {
    setLoading(true)
    try {
      const res = await apiClient.post<{ plan: PaymentPlan; installments: Installment[] }>(
        '/api/credit/plans',
        body,
      )
      toast.success('Plan de paiement créé')
      return res
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
      throw e
    } finally {
      setLoading(false)
    }
  }

  return { create, loading }
}

// ── useRecordPayment ──────────────────────────────────────────────────────────

export function useRecordPayment(planId: string) {
  const [loading, setLoading] = useState(false)

  const pay = async (installmentId: string, body: { amount: number; method: PaymentMethod; notes?: string }) => {
    setLoading(true)
    try {
      const res = await apiClient.post<{ newStatus: string; newOutstanding: number; planStatus: string }>(
        `/api/credit/plans/${planId}/installments/${installmentId}/pay`,
        body,
      )
      toast.success('Paiement enregistré')
      return res
    } catch (e) {
      toast.error(`Erreur paiement : ${(e as Error).message}`)
      throw e
    } finally {
      setLoading(false)
    }
  }

  return { pay, loading }
}

// ── useCancelPlan ─────────────────────────────────────────────────────────────

export function useCancelPlan() {
  const [loading, setLoading] = useState(false)

  const cancel = async (planId: string) => {
    setLoading(true)
    try {
      await apiClient.patch(`/api/credit/plans/${planId}/cancel`, {})
      toast.success('Plan annulé')
    } catch (e) {
      toast.error(`Erreur annulation : ${(e as Error).message}`)
      throw e
    } finally {
      setLoading(false)
    }
  }

  return { cancel, loading }
}

// ── useCreditDashboard ────────────────────────────────────────────────────────

export function useCreditDashboard() {
  const [data, setData]       = useState<CreditDashboard | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<CreditDashboard>('/api/credit/dashboard')
      setData(res)
    } catch (e) {
      toast.error(`Erreur dashboard crédit : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_() }, [fetch_])
  return { data, loading, refetch: fetch_ }
}

// ── useOverdueInstallments ────────────────────────────────────────────────────

export function useOverdueInstallments() {
  const [data, setData]       = useState<OverdueRow[]>([])
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: OverdueRow[] }>('/api/credit/overdue')
      setData(res.data)
    } catch (e) {
      toast.error(`Erreur chargement impayés : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_() }, [fetch_])
  return { data, loading, refetch: fetch_ }
}
