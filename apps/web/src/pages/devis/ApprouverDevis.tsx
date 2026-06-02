import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, XCircle, FileText, AlertTriangle, Loader } from 'lucide-react'
import { API_BASE } from '@/lib/api-client'
import { formatXAF } from '@/lib/utils'

interface DevisPublic {
  id:            string
  numero:        string
  client_nom:    string
  total_ht_xaf:  number
  tva_xaf:       number
  total_ttc_xaf: number
  date_validite: string
  statut:        string
  approuve_par_client: boolean
  devis_lignes:  Array<{ designation: string; quantite: number; prix_unitaire_ht_xaf: number; unite: string }>
}

type PageState = 'loading' | 'ready' | 'success_accept' | 'success_refuse' | 'error' | 'already_done'

export default function ApprouverDevis() {
  const { token } = useParams<{ token: string }>()
  const [state,        setState]        = useState<PageState>('loading')
  const [devis,        setDevis]        = useState<DevisPublic | null>(null)
  const [commentaire,  setCommentaire]  = useState('')
  const [showRefus,    setShowRefus]    = useState(false)
  const [errorMsg,     setErrorMsg]     = useState('')
  const [submitting,   setSubmitting]   = useState(false)

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('Lien invalide.'); return }

    fetch(`${API_BASE}/devis/approuver/${token}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          setErrorMsg(json.error ?? 'Lien invalide ou expiré.')
          setState(res.status === 410 ? 'already_done' : 'error')
          return
        }
        setDevis(json.devis)
        if (json.devis.approuve_par_client) {
          setState('already_done')
          setErrorMsg('Ce devis a déjà été approuvé.')
        } else {
          setState('ready')
        }
      })
      .catch(() => { setErrorMsg('Erreur réseau. Réessayez plus tard.'); setState('error') })
  }, [token])

  const handleDecision = async (decision: 'accepte' | 'refuse') => {
    if (!token) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/devis/approuver/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision, commentaire: commentaire || undefined }),
      })
      const json = await res.json()
      if (!res.ok) { setErrorMsg(json.error ?? 'Erreur.'); setState('error'); return }
      setState(decision === 'accepte' ? 'success_accept' : 'success_refuse')
    } catch {
      setErrorMsg('Erreur réseau. Réessayez plus tard.')
      setState('error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Layouts ────────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader className="h-8 w-8 animate-spin" />
          <p className="text-sm">Chargement du devis…</p>
        </div>
      </div>
    )
  }

  if (state === 'success_accept') {
    return (
      <ResultPage
        icon={<CheckCircle className="h-16 w-16 text-green-500" />}
        titre="Devis approuvé !"
        message="Merci. Votre approbation a bien été enregistrée. Notre équipe vous contactera pour la suite."
        color="green"
      />
    )
  }

  if (state === 'success_refuse') {
    return (
      <ResultPage
        icon={<XCircle className="h-16 w-16 text-red-500" />}
        titre="Devis refusé"
        message="Votre réponse a bien été enregistrée. Notre équipe reviendra vers vous pour discuter de vos besoins."
        color="red"
      />
    )
  }

  if (state === 'already_done' || state === 'error') {
    return (
      <ResultPage
        icon={<AlertTriangle className="h-16 w-16 text-amber-500" />}
        titre={state === 'already_done' ? 'Déjà traité' : 'Lien invalide'}
        message={errorMsg || 'Ce lien n\'est plus valide.'}
        color="amber"
      />
    )
  }

  if (!devis) return null

  const TVA_RATE = 0.1925

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">

        {/* En-tête société */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: '#C62828' }}>
            F
          </div>
          <div>
            <div className="font-bold text-[#212121]">
              <span style={{ color: '#C62828' }}>FOR</span>GE ERP — TAFDIL SARL
            </div>
            <div className="text-xs text-gray-400">Microusine Métallurgique — Douala, Cameroun</div>
          </div>
        </div>

        {/* Card devis */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#C62828]" />
              <span className="font-bold text-[#212121]">{devis.numero}</span>
            </div>
            <span className="text-xs text-gray-400">Valide jusqu'au {devis.date_validite}</span>
          </div>

          <div className="px-6 py-4">
            <p className="text-sm text-gray-600 mb-4">
              Bonjour <strong>{devis.client_nom}</strong>, veuillez consulter et approuver ce devis.
            </p>

            {/* Lignes */}
            <div className="border border-gray-100 rounded-xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-3 py-2 font-semibold">Désignation</th>
                    <th className="text-right px-3 py-2 font-semibold">Qté</th>
                    <th className="text-right px-3 py-2 font-semibold">P.U. HT</th>
                    <th className="text-right px-3 py-2 font-semibold">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {devis.devis_lignes.map((l, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-2.5">{l.designation}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{l.quantite} {l.unite}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{formatXAF(l.prix_unitaire_ht_xaf)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatXAF(l.quantite * l.prix_unitaire_ht_xaf)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totaux */}
            <div className="space-y-1 text-sm ml-auto max-w-xs">
              <div className="flex justify-between text-gray-500">
                <span>Total HT</span>
                <span>{formatXAF(devis.total_ht_xaf)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>TVA {(TVA_RATE * 100).toFixed(2)}%</span>
                <span>{formatXAF(devis.tva_xaf)}</span>
              </div>
              <div className="flex justify-between font-bold text-[#212121] text-base border-t border-gray-200 pt-1 mt-1">
                <span>Total TTC</span>
                <span style={{ color: '#C62828' }}>{formatXAF(devis.total_ttc_xaf)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section décision */}
        {!showRefus ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-5">
            <p className="text-sm text-gray-600 mb-4 font-medium">Votre décision :</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDecision('accepte')}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#15803d' }}
              >
                <CheckCircle className="h-4 w-4" />
                {submitting ? 'Envoi…' : 'J\'approuve ce devis'}
              </button>
              <button
                onClick={() => setShowRefus(true)}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Refuser
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 px-6 py-5">
            <p className="text-sm text-gray-600 mb-3 font-medium">Motif du refus (optionnel) :</p>
            <textarea
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              rows={3}
              placeholder="Expliquez pourquoi vous refusez ce devis…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowRefus(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                onClick={() => handleDecision('refuse')}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Envoi…' : 'Confirmer le refus'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultPage({ icon, titre, message, color }: {
  icon: React.ReactNode; titre: string; message: string; color: string
}) {
  const borderColor = color === 'green' ? '#dcfce7' : color === 'red' ? '#fee2e2' : '#fef3c7'
  const bgColor     = color === 'green' ? '#f0fdf4' : color === 'red' ? '#fff5f5' : '#fffbeb'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full rounded-2xl border p-8 text-center"
        style={{ backgroundColor: bgColor, borderColor }}>
        <div className="flex justify-center mb-4">{icon}</div>
        <h2 className="text-xl font-bold text-[#212121] mb-2">{titre}</h2>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  )
}
