import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { TopBar } from '../components/TopBar'
import { useAuth } from '../context/AuthContext'
import {
  fetchStocks, fetchSessionCourante, openCaisseSession, closeCaisseSession, createTicket,
  searchClients,
  type ApiStock, type CaisseSession, type MobileClient, type ModePaiementCaisse,
  type LigneTicketPayload, type PaiementTicketPayload, type TicketVente, type RapportZ,
} from '../lib/api'

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 }).format(amount) + ' FCFA'
}

const MODES: { value: ModePaiementCaisse; label: string }[] = [
  { value: 'espece',       label: 'Espèces' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'mtn_momo',     label: 'MTN MoMo' },
  { value: 'credit',       label: 'Crédit' },
  { value: 'carte',        label: 'Carte' },
]

interface TicketLigneUI {
  key:               string
  produit_id?:       string
  designation:       string
  unite:             string
  quantite:          number
  prix_unitaire_xaf: number
}

function newKey() { return crypto.randomUUID() }

// ── Écran : ouverture de session ────────────────────────────────────────────

function OuvertureSession({ onOuverte }: { onOuverte: (s: CaisseSession) => void }) {
  const [fond, setFond] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function ouvrir() {
    setLoading(true)
    setError('')
    try {
      const session = await openCaisseSession(fond)
      onOuverte(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur ouverture session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-5 flex flex-col items-center justify-center flex-1">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm p-6 space-y-5">
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-900">Ouverture de caisse</h2>
          <p className="text-sm text-gray-500 mt-1">Saisissez le fond de caisse pour commencer.</p>
        </div>
        <input
          type="number"
          inputMode="numeric"
          value={fond}
          onChange={(e) => setFond(Math.max(0, Number(e.target.value)))}
          className="w-full text-center text-2xl font-bold py-4 rounded-2xl border border-gray-200"
          placeholder="0"
        />
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <button
          type="button"
          disabled={loading}
          onClick={ouvrir}
          className="w-full rounded-2xl bg-[#C62828] text-white py-4 text-base font-semibold disabled:opacity-50"
        >
          {loading ? 'Ouverture…' : 'Ouvrir la caisse'}
        </button>
      </div>
    </div>
  )
}

// ── Écran : reçu ──────────────────────────────────────────────────────────────

function RecuScreen({ ticket, onNouvelleVente }: { ticket: TicketVente; onNouvelleVente: () => void }) {
  return (
    <div className="p-4 flex flex-col items-center flex-1 overflow-y-auto">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm p-5 font-mono text-sm">
        <div className="text-center mb-3">
          <p className="font-bold text-base">FORGE by TAFDIL</p>
          <p className="text-xs text-gray-500">Reçu de vente comptoir</p>
          <p className="text-xs text-gray-400 mt-1">{ticket.numero_facture ?? ticket.numero_local ?? '—'}</p>
          <p className="text-xs text-gray-400">{new Date().toLocaleString('fr-CM')}</p>
        </div>
        <div className="border-t border-b border-dashed border-gray-300 py-2 space-y-1">
          {ticket.lignes.map((l, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="flex-1 truncate">{l.quantite} {l.unite} × {l.designation}</span>
              <span>{formatXAF(l.total_ligne_xaf)}</span>
            </div>
          ))}
        </div>
        <div className="py-2 flex justify-between font-bold text-base">
          <span>TOTAL TTC</span><span>{formatXAF(ticket.total_ttc_xaf)}</span>
        </div>
        <div className="border-t border-dashed border-gray-300 pt-2 space-y-1">
          {ticket.paiements.map((p, i) => (
            <div key={i} className="flex justify-between text-gray-600">
              <span>{MODES.find((m) => m.value === p.mode)?.label ?? p.mode}</span>
              <span>{formatXAF(p.montant_xaf)}</span>
            </div>
          ))}
          {ticket.paiements.some((p) => p.rendu_xaf) && (
            <div className="flex justify-between font-semibold">
              <span>Rendu</span>
              <span>{formatXAF(ticket.paiements.reduce((s, p) => s + (p.rendu_xaf ?? 0), 0))}</span>
            </div>
          )}
        </div>
        {ticket.oversell && (
          <p className="text-xs text-amber-700 mt-2 text-center">⚠ Vente au-delà du stock disponible</p>
        )}
      </div>
      <button
        type="button"
        onClick={onNouvelleVente}
        className="w-full max-w-sm mt-5 rounded-2xl bg-[#C62828] text-white py-4 text-base font-semibold"
      >
        Nouvelle vente
      </button>
    </div>
  )
}

// ── Écran : fermeture de session ────────────────────────────────────────────

function FermetureScreen({ session, onFermee, onCancel }: {
  session: CaisseSession
  onFermee: () => void
  onCancel: () => void
}) {
  const [fond, setFond] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rapport, setRapport] = useState<RapportZ | null>(null)

  async function fermer() {
    setLoading(true)
    setError('')
    try {
      const r = await closeCaisseSession(session.id, fond)
      setRapport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur fermeture session')
    } finally {
      setLoading(false)
    }
  }

  if (rapport) {
    const ecart = rapport.ecart_xaf ?? 0
    return (
      <div className="p-4 flex flex-col items-center flex-1 overflow-y-auto">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm p-5 space-y-4">
          <h2 className="text-lg font-bold text-center">Rapport Z</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 uppercase">Tickets</p>
              <p className="text-lg font-semibold">{rapport.tickets_count}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 uppercase">Total vendu</p>
              <p className="text-lg font-semibold">{formatXAF(rapport.total_ttc_xaf)}</p>
            </div>
          </div>
          <div className={`rounded-xl p-3 text-center ${ecart === 0 ? 'bg-green-50' : 'bg-amber-50'}`}>
            <p className="text-xs uppercase text-gray-500">Écart de caisse</p>
            <p className={`text-xl font-bold ${ecart === 0 ? 'text-green-700' : 'text-amber-700'}`}>
              {ecart > 0 ? '+' : ''}{formatXAF(ecart)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onFermee}
          className="w-full max-w-sm mt-5 rounded-2xl bg-[#C62828] text-white py-4 text-base font-semibold"
        >
          Terminé
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end">
      <div className="w-full bg-white rounded-t-3xl p-5 space-y-4 safe-bottom">
        <h2 className="text-base font-semibold text-center">Fermer la caisse</h2>
        <p className="text-sm text-gray-500 text-center">Comptez les espèces et saisissez le montant exact.</p>
        <input
          type="number"
          inputMode="numeric"
          value={fond}
          onChange={(e) => setFond(Math.max(0, Number(e.target.value)))}
          className="w-full text-center text-2xl font-bold py-4 rounded-2xl border border-gray-200"
        />
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-2xl border border-gray-200 py-3 font-medium">Annuler</button>
          <button
            type="button" disabled={loading} onClick={fermer}
            className="flex-1 rounded-2xl bg-[#C62828] text-white py-3 font-semibold disabled:opacity-50"
          >
            {loading ? '…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Écran principal : vente ──────────────────────────────────────────────────

function VenteScreen({ session, onFermerCaisse }: { session: CaisseSession; onFermerCaisse: () => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ApiStock[]>([])
  const [searching, setSearching] = useState(false)
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [lignes, setLignes] = useState<TicketLigneUI[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<MobileClient[]>([])
  const [selectedClient, setSelectedClient] = useState<MobileClient | null>(null)
  const [opId, setOpId] = useState(() => newKey())

  const [paiementOpen, setPaiementOpen] = useState(false)
  const [paiements, setPaiements] = useState<PaiementTicketPayload[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [ticketConfirme, setTicketConfirme] = useState<TicketVente | null>(null)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetchStocks({ search, per_page: 20 })
        if (!cancelled) setResults(res.data)
      } catch { if (!cancelled) setResults([]) } finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  useEffect(() => {
    if (clientQuery.trim().length < 2) { setClientResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await searchClients(clientQuery)
        if (!cancelled) setClientResults(res)
      } catch { if (!cancelled) setClientResults([]) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [clientQuery])

  // Scan code-barres — même mécanisme que BoutiquePage.tsx
  useEffect(() => {
    if (!scannerActive || !videoRef.current) return
    const codeReader = new BrowserMultiFormatReader()
    setScannerError('')
    let active = true

    codeReader.decodeOnceFromVideoDevice(undefined, videoRef.current)
      .then(async (result) => {
        if (!active) return
        const code = result.getText().trim()
        setScannerActive(false)
        try {
          const res = await fetchStocks({ search: code, per_page: 5 })
          const exact = res.data.find((p) => p.ref?.toLowerCase() === code.toLowerCase()) ?? res.data[0]
          if (exact) ajouterProduit(exact)
          else setError(`Aucun produit trouvé pour le code "${code}"`)
        } catch {
          setError('Erreur lors de la recherche du produit scanné')
        }
      })
      .catch((err) => {
        if (!active) return
        if (err instanceof NotFoundException) {
          setScannerError('Aucun code détecté — orientez la caméra vers le code-barres.')
        } else {
          setScannerError(err instanceof Error ? err.message : String(err))
        }
      })

    // BrowserMultiFormatReader n'expose pas .reset() dans la version de types
    // installée (même limitation que BoutiquePage.tsx) — le flag `active`
    // suffit à ignorer un résultat de scan après démontage/fermeture.
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerActive])

  const totalTtc = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_xaf, 0)

  // Pour un paiement "espèce", le caissier ne saisit QUE ce que le client lui
  // tend (montant_recu_xaf) — le montant réellement appliqué au ticket est
  // plafonné par ce qu'il reste à encaisser, le surplus devient le rendu.
  // (même correctif que apps/web/src/pages/Caisse.tsx : un champ "montant"
  // distinct à recaler à la main était la source du "reste" bloqué en négatif.)
  const paiementsCalcules = useMemo(() => {
    const nonEspeceTotal = paiements.filter((p) => p.mode !== 'espece').reduce((s, p) => s + p.montant_xaf, 0)
    let restant = Math.max(0, totalTtc - nonEspeceTotal)
    return paiements.map((p) => {
      if (p.mode !== 'espece') return { ...p, montant_applique: p.montant_xaf, rendu: 0 }
      const recu = p.montant_recu_xaf ?? 0
      const applique = Math.min(recu, restant)
      restant -= applique
      return { ...p, montant_applique: applique, rendu: Math.max(0, recu - applique) }
    })
  }, [paiements, totalTtc])

  const sommePaiements = paiementsCalcules.reduce((s, p) => s + p.montant_applique, 0)
  const resteAEncaisser = totalTtc - sommePaiements

  function ajouterProduit(p: ApiStock) {
    setLignes((prev) => {
      const existante = prev.find((l) => l.produit_id === p.id)
      if (existante) return prev.map((l) => l.produit_id === p.id ? { ...l, quantite: l.quantite + 1 } : l)
      return [...prev, {
        key: newKey(), produit_id: p.id, designation: p.designation, unite: p.unite,
        quantite: 1, prix_unitaire_xaf: p.prix_unitaire_xaf,
      }]
    })
    setSearch('')
    setResults([])
  }

  function retirerLigne(key: string) {
    setLignes((prev) => prev.filter((l) => l.key !== key))
  }

  function majQuantite(key: string, delta: number) {
    setLignes((prev) => prev.map((l) => l.key === key ? { ...l, quantite: Math.max(0.01, +(l.quantite + delta).toFixed(2)) } : l))
  }

  function ouvrirPaiement() {
    if (lignes.length === 0) { setError('Le ticket est vide'); return }
    setError('')
    setPaiements([{ mode: 'espece', montant_xaf: totalTtc, montant_recu_xaf: totalTtc }])
    setPaiementOpen(true)
  }

  function resetTicket() {
    setLignes([])
    setSelectedClient(null)
    setClientQuery('')
    setPaiements([])
    setOpId(newKey())
    setTicketConfirme(null)
    setError('')
  }

  async function validerEncaissement() {
    if (sommePaiements !== totalTtc) {
      setError(`Le total encaissé (${formatXAF(sommePaiements)}) ne correspond pas au total (${formatXAF(totalTtc)})`)
      return
    }
    const creditPaiement = paiements.find((p) => p.mode === 'credit')
    if (creditPaiement && !selectedClient) {
      setError('Sélectionnez un client pour une vente à crédit')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const ticket = await createTicket({
        op_id:       opId,
        session_id:  session.id,
        client_id:   selectedClient?.id,
        client_nom:  selectedClient?.nom,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id, designation: l.designation, unite: l.unite,
          quantite: l.quantite, prix_unitaire_xaf: l.prix_unitaire_xaf,
        })),
        // montant_xaf envoyé = le montant réellement APPLIQUÉ (paiementsCalcules),
        // pas le brut saisi — sinon un espèce avec rendu enverrait un montant
        // supérieur au total et le serveur rejetterait (PAYMENT_MISMATCH).
        paiements: paiementsCalcules.map((p) => ({
          mode:             p.mode,
          montant_xaf:      p.montant_applique,
          montant_recu_xaf: p.mode === 'espece' ? p.montant_recu_xaf : undefined,
          reference:        p.reference,
        })),
      })
      setPaiementOpen(false)
      setTicketConfirme(ticket)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'encaissement')
      // op_id conservé — un nouvel essai reste idempotent côté serveur.
    } finally {
      setSubmitting(false)
    }
  }

  if (ticketConfirme) return <RecuScreen ticket={ticketConfirme} onNouvelleVente={resetTicket} />

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="p-4 space-y-3 flex-1 overflow-y-auto pb-40">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">Session ouverte</h2>
          <button type="button" onClick={onFermerCaisse} className="text-xs text-[#C62828] underline">Fermer la caisse</button>
        </div>

        <div className="flex gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un article…"
            className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-base"
          />
          <button
            type="button"
            onClick={() => setScannerActive(true)}
            className="rounded-2xl bg-gray-900 text-white px-4 py-3"
            aria-label="Scanner"
          >
            📷
          </button>
        </div>

        {searching && <p className="text-xs text-gray-400">Recherche…</p>}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => ajouterProduit(p)}
                className="w-full text-left px-4 py-3 active:bg-gray-50"
              >
                <p className="font-medium text-gray-900">{p.designation}</p>
                <p className="text-xs text-gray-400">{p.ref} · Stock {p.stock_actuel} {p.unite} · {formatXAF(p.prix_unitaire_xaf)}</p>
              </button>
            ))}
          </div>
        )}

        {/* Ticket */}
        <div className="bg-white rounded-2xl shadow-sm p-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Ticket ({lignes.length})</h3>
          {lignes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Aucun article</p>
          ) : (
            <div className="space-y-2">
              {lignes.map((l) => (
                <div key={l.key} className="flex items-center gap-2 border border-gray-100 rounded-xl p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.designation}</p>
                    <p className="text-xs text-gray-400">{formatXAF(l.prix_unitaire_xaf)} / {l.unite}</p>
                  </div>
                  <button type="button" onClick={() => majQuantite(l.key, -1)} className="w-8 h-8 rounded-lg bg-gray-100 font-bold">−</button>
                  <span className="w-8 text-center text-sm font-semibold">{l.quantite}</span>
                  <button type="button" onClick={() => majQuantite(l.key, 1)} className="w-8 h-8 rounded-lg bg-gray-100 font-bold">+</button>
                  <button type="button" onClick={() => retirerLigne(l.key)} className="text-red-500 text-xs ml-1">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Client (crédit) */}
        <div className="bg-white rounded-2xl shadow-sm p-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Client (optionnel — requis pour crédit)</h3>
          {selectedClient ? (
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="text-sm font-medium">{selectedClient.nom}</span>
              <button type="button" onClick={() => setSelectedClient(null)} className="text-gray-400">✕</button>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                placeholder="Rechercher un client…"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
              {clientResults.length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-xl divide-y divide-gray-50">
                  {clientResults.map((c) => (
                    <button
                      key={c.id} type="button"
                      onClick={() => { setSelectedClient(c); setClientQuery(''); setClientResults([]) }}
                      className="w-full text-left px-3 py-2 text-sm"
                    >
                      {c.nom}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </div>

      {/* Barre totale fixe */}
      <div className="fixed bottom-16 inset-x-0 bg-white border-t border-gray-200 p-4 safe-bottom">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">Total</span>
          <span className="text-xl font-bold">{formatXAF(totalTtc)}</span>
        </div>
        <button
          type="button"
          disabled={lignes.length === 0}
          onClick={ouvrirPaiement}
          className="w-full rounded-2xl bg-[#C62828] text-white py-4 text-base font-semibold disabled:opacity-40"
        >
          Encaisser
        </button>
      </div>

      {/* Scanner */}
      {scannerActive && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold">Scanner un article</h2>
                <p className="text-xs text-gray-500">Placez le code-barres devant la caméra.</p>
              </div>
              <button type="button" onClick={() => setScannerActive(false)} className="text-gray-500">Fermer</button>
            </div>
            <div className="p-4">
              <video ref={videoRef} className="h-72 w-full rounded-3xl bg-black" muted playsInline />
              {scannerError && <div className="mt-3 text-sm text-red-600">{scannerError}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Modal paiement */}
      {paiementOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end">
          <div className="w-full bg-white rounded-t-3xl p-5 space-y-4 safe-bottom max-h-[85vh] overflow-y-auto">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase">Total à encaisser</p>
              <p className="text-2xl font-bold">{formatXAF(totalTtc)}</p>
            </div>

            {paiementsCalcules.map((p, i) => (
              <div key={i} className="border border-gray-100 rounded-2xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      disabled={m.value === 'credit' && !selectedClient}
                      onClick={() => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, mode: m.value } : x))}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border disabled:opacity-30 ${
                        p.mode === m.value ? 'bg-[#C62828] border-[#C62828] text-white' : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {p.mode === 'espece' ? (
                  // Un seul champ : ce que le client tend. Le montant appliqué au
                  // ticket est calculé (plafonné au reste dû) — jamais saisi à part.
                  <>
                    <input
                      type="number" inputMode="numeric" value={p.montant_recu_xaf ?? ''}
                      onChange={(e) => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, montant_recu_xaf: Math.max(0, Number(e.target.value)) } : x))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      placeholder="Montant reçu du client"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Appliqué au ticket : <strong className="text-gray-900">{formatXAF(p.montant_applique)}</strong></span>
                      {p.rendu > 0 && <span className="text-green-700 font-semibold">Rendu : {formatXAF(p.rendu)}</span>}
                    </div>
                  </>
                ) : (
                  <input
                    type="number" inputMode="numeric" value={p.montant_xaf}
                    onChange={(e) => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, montant_xaf: Math.max(0, Number(e.target.value)) } : x))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2"
                    placeholder="Montant"
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => setPaiements((prev) => [...prev, { mode: 'espece', montant_xaf: Math.max(0, resteAEncaisser), montant_recu_xaf: Math.max(0, resteAEncaisser) }])}
              className="text-sm text-[#C62828] font-medium"
            >
              + Fractionner le paiement
            </button>

            <p className={`text-center text-sm font-semibold ${resteAEncaisser === 0 ? 'text-green-700' : 'text-[#C62828]'}`}>
              {resteAEncaisser === 0 ? 'Montant complet' : resteAEncaisser > 0 ? `Reste : ${formatXAF(resteAEncaisser)}` : `Trop encaissé de ${formatXAF(-resteAEncaisser)}`}
            </p>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setPaiementOpen(false)} className="flex-1 rounded-2xl border border-gray-200 py-3 font-medium">Annuler</button>
              <button
                type="button"
                disabled={resteAEncaisser !== 0 || submitting}
                onClick={validerEncaissement}
                className="flex-1 rounded-2xl bg-[#C62828] text-white py-3 font-semibold disabled:opacity-50"
              >
                {submitting ? '…' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CaissePage() {
  const { user } = useAuth()
  const [session, setSession] = useState<CaisseSession | null | undefined>(undefined)
  const [fermetureOpen, setFermetureOpen] = useState(false)

  useEffect(() => {
    fetchSessionCourante().then(setSession).catch(() => setSession(null))
  }, [])

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Caisse" subtitle={user?.name ?? 'FORGE'} />

      {session === undefined ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !session ? (
        <OuvertureSession onOuverte={setSession} />
      ) : (
        <VenteScreen session={session} onFermerCaisse={() => setFermetureOpen(true)} />
      )}

      {fermetureOpen && session && (
        <FermetureScreen
          session={session}
          onCancel={() => setFermetureOpen(false)}
          onFermee={() => { setFermetureOpen(false); setSession(null) }}
        />
      )}
    </div>
  )
}
