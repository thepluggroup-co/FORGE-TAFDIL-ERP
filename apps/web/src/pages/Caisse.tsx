import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Minus, Trash2, Star, Search, Printer, Lock, X, MessageCircle, History } from 'lucide-react'
import { PageHeader, Button, Modal } from '@forge/ui'
import { formatXAF, formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { useStocks } from '@/hooks/useStocks'
import { useSearchClients, type Client } from '@/hooks/useClients'
import {
  useSessionCourante, useOuvrirSession, useFermerSession,
  useCreerTicket, useHistoriqueTickets, useTicketDetail, useEnvoyerRecu,
  type ModePaiementCaisse, type LigneTicketPayload, type PaiementTicketPayload, type TicketVente, type RapportZ,
} from '@/hooks/useCaisse'

// ── Constantes ─────────────────────────────────────────────────────────────────
// TVA désactivée temporairement (demande explicite) — doit rester alignée sur
// apps/api/src/routes/caisse.ts (TVA_RATE). Affichage uniquement, le total
// encaissable fait foi côté serveur.
const TVA_RATE = 0
// Doit rester alignée sur CAISSIER_REMISE_MAX_PCT (apps/api/src/services/rbacService.ts) —
// le serveur revalide de toute façon, ceci n'est qu'un garde-fou d'affichage.
const CAISSIER_REMISE_MAX_PCT = 5
const UNITES_CAISSE = ['unité', 'm', 'kg', 'm²', 'litre']
const FAVORIS_KEY = 'forge_caisse_favoris'

const MODES: { value: ModePaiementCaisse; label: string; color: string }[] = [
  { value: 'espece',       label: 'Espèces',       color: '#15803d' },
  { value: 'orange_money', label: 'Orange Money',  color: '#f97316' },
  { value: 'mtn_momo',     label: 'MTN MoMo',      color: '#facc15' },
  { value: 'credit',       label: 'Crédit',        color: '#7c3aed' },
  { value: 'carte',        label: 'Carte',         color: '#1d4ed8' },
]

interface TicketLigneUI {
  key:               string
  produit_id?:       string
  designation:       string
  unite:             string
  quantite:          number
  prix_unitaire_xaf: number
  prix_catalogue_xaf: number
}

interface PaiementUI {
  key:               string
  mode:              ModePaiementCaisse
  montant_xaf:       number
  montant_recu_xaf?: number
  reference?:        string
}

function newKey() {
  return crypto.randomUUID()
}

// ── Écran : ouverture de session ────────────────────────────────────────────────

function OuvertureSession() {
  const [fond, setFond] = useState<number>(0)
  const ouvrir = useOuvrirSession()

  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-sm p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-[#C62828]/10 mb-3">
            <Lock className="h-6 w-6 text-[#C62828]" />
          </div>
          <h2 className="text-lg font-semibold text-[#212121]">Ouverture de caisse</h2>
          <p className="text-sm text-gray-500">Saisissez le fond de caisse pour commencer la vente.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fond de caisse (FCFA)</label>
          <input
            type="number"
            min={0}
            value={fond}
            onChange={(e) => setFond(Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-3 text-lg font-semibold text-center border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            autoFocus
          />
        </div>
        <Button
          className="w-full justify-center"
          disabled={ouvrir.isPending}
          onClick={() => ouvrir.mutate(fond)}
        >
          {ouvrir.isPending ? 'Ouverture…' : 'Ouvrir la caisse'}
        </Button>
      </div>
    </div>
  )
}

// ── Écran : rapport Z ────────────────────────────────────────────────────────────

function RapportZView({ rapport, onNouvelleSession }: { rapport: RapportZ; onNouvelleSession: () => void }) {
  const ecart = rapport.ecart_xaf ?? 0
  return (
    <div className="flex flex-col items-center py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-[#212121]">Rapport Z — clôture de caisse</h2>
          <p className="text-xs text-gray-400 mt-1">{new Date(rapport.session.date_fermeture ?? Date.now()).toLocaleString('fr-CM')}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400 uppercase">Tickets</div>
            <div className="text-lg font-semibold">{rapport.tickets_count}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400 uppercase">Total vendu</div>
            <div className="text-lg font-semibold">{formatXAF(rapport.total_ttc_xaf)}</div>
          </div>
        </div>

        <div className="space-y-1.5 text-sm">
          {MODES.map((m) => (
            <div key={m.value} className="flex justify-between py-1 border-b border-gray-50">
              <span className="text-gray-500">{m.label}</span>
              <span className="font-medium">{formatXAF(rapport.par_mode[m.value] ?? 0)}</span>
            </div>
          ))}
        </div>

        <div className={`rounded-lg p-3 text-center ${ecart === 0 ? 'bg-green-50' : Math.abs(ecart) < 500 ? 'bg-amber-50' : 'bg-red-50'}`}>
          <div className="text-xs uppercase text-gray-500">Écart de caisse</div>
          <div className={`text-xl font-bold ${ecart === 0 ? 'text-green-700' : Math.abs(ecart) < 500 ? 'text-amber-700' : 'text-red-700'}`}>
            {ecart > 0 ? '+' : ''}{formatXAF(ecart)}
          </div>
        </div>

        {rapport.ventes_oversell > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
            ⚠ {rapport.ventes_oversell} vente(s) au-delà du stock disponible — réappro alerté.
          </p>
        )}

        <Button className="w-full justify-center" onClick={onNouvelleSession}>Nouvelle session</Button>
      </div>
    </div>
  )
}

// ── Écran : reçu ──────────────────────────────────────────────────────────────

function RecuView({ ticket, onNouvelleVente, actionLabel = 'Nouvelle vente' }: {
  ticket: TicketVente
  onNouvelleVente: () => void
  actionLabel?: string
}) {
  return (
    <div className="flex flex-col items-center py-6">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #recu-imprimable, #recu-imprimable * { visibility: visible; }
          #recu-imprimable { position: absolute; top: 0; left: 0; width: 320px; }
        }
      `}</style>

      <div id="recu-imprimable" className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-sm p-6 font-mono text-sm">
        <div className="text-center mb-4">
          <p className="font-bold text-base">FORGE by TAFDIL</p>
          <p className="text-xs text-gray-500">Reçu de vente comptoir</p>
          <p className="text-xs text-gray-400 mt-1">{ticket.numero_facture}</p>
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

        <div className="py-2 space-y-1">
          <div className="flex justify-between text-gray-500"><span>Total HT</span><span>{formatXAF(ticket.total_ht_xaf)}</span></div>
          {ticket.tva_xaf > 0 && (
            <div className="flex justify-between text-gray-500"><span>TVA</span><span>{formatXAF(ticket.tva_xaf)}</span></div>
          )}
          {ticket.remise_xaf > 0 && (
            <div className="flex justify-between text-gray-500"><span>Remise</span><span>-{formatXAF(ticket.remise_xaf)}</span></div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-1">
            <span>TOTAL TTC</span><span>{formatXAF(ticket.total_ttc_xaf)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-gray-300 pt-2 space-y-1">
          {ticket.paiements.map((p, i) => (
            <div key={i} className="flex justify-between text-gray-600">
              <span>{MODES.find((m) => m.value === p.mode)?.label ?? p.mode}</span>
              <span>{formatXAF(p.montant_xaf)}</span>
            </div>
          ))}
          <div className="flex justify-between font-semibold border-t border-gray-100 pt-1">
            <span>Montant payé par le client</span>
            <span>{formatXAF(ticket.paiements.reduce((s, p) => s + (p.montant_recu_xaf ?? p.montant_xaf), 0))}</span>
          </div>
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

        <p className="text-center text-xs text-gray-400 mt-4">Merci de votre confiance !</p>
      </div>

      <div className="flex gap-3 mt-5 no-print">
        <Button variant="ghost" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Imprimer
        </Button>
        <Button onClick={onNouvelleVente}>{actionLabel}</Button>
      </div>

      <EnvoyerRecu ticket={ticket} />
    </div>
  )
}

// ── Envoi du reçu par WhatsApp ou SMS ────────────────────────────────────────────

function EnvoyerRecu({ ticket }: { ticket: TicketVente }) {
  const [telephone, setTelephone] = useState('')
  const envoyer = useEnvoyerRecu()
  // Si le ticket a un client identifié, l'API retrouve son téléphone toute
  // seule (apps/api/src/routes/caisse.ts) — sinon on doit en saisir un.
  const needsPhone = !ticket.client_id

  return (
    <div className="w-full max-w-sm mt-5 border-t border-gray-100 pt-4 no-print">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Envoyer le reçu au client</p>
      {needsPhone && (
        <input
          type="tel"
          placeholder="Numéro de téléphone (ex. 6XXXXXXXX)"
          value={telephone}
          onChange={(e) => setTelephone(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2
            focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        />
      )}
      <div className="flex gap-2">
        <Button
          variant="ghost" size="sm" className="flex-1"
          disabled={envoyer.isPending || (needsPhone && !telephone.trim())}
          onClick={() => envoyer.mutate({ ticketId: ticket.id, canal: 'whatsapp', telephone: telephone.trim() || undefined })}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </Button>
        <Button
          variant="ghost" size="sm" className="flex-1"
          disabled={envoyer.isPending || (needsPhone && !telephone.trim())}
          onClick={() => envoyer.mutate({ ticketId: ticket.id, canal: 'sms', telephone: telephone.trim() || undefined })}
        >
          SMS
        </Button>
      </div>
    </div>
  )
}

// ── Écran principal : vente ──────────────────────────────────────────────────────

function VenteScreen({ sessionId, isResponsable }: { sessionId: string; isResponsable: boolean }) {
  const [search, setSearch]           = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categorie, setCategorie]     = useState('')
  const [favoris, setFavoris]         = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORIS_KEY) ?? '[]') } catch { return [] }
  })

  const [lignes, setLignes]       = useState<TicketLigneUI[]>([])
  const [remiseXaf, setRemiseXaf] = useState(0)
  const [clientQuery, setClientQuery]     = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [opId, setOpId]           = useState(() => newKey())

  const [paiementModalOpen, setPaiementModalOpen] = useState(false)
  const [paiements, setPaiements] = useState<PaiementUI[]>([])
  const [fermetureOpen, setFermetureOpen] = useState(false)

  const [ticketConfirme, setTicketConfirme] = useState<TicketVente | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    localStorage.setItem(FAVORIS_KEY, JSON.stringify(favoris))
  }, [favoris])

  const { data: stocksData, isLoading: stocksLoading } = useStocks({ search: debouncedSearch, categorie })
  const { data: clientsData } = useSearchClients(clientQuery)
  const creerTicket = useCreerTicket()
  const fermerSession = useFermerSession()

  const produits = stocksData?.data ?? []
  const categories = useMemo(() => [...new Set(produits.map((p) => p.categorie))], [produits])
  const produitsFavoris = useMemo(() => produits.filter((p) => favoris.includes(p.id)), [produits, favoris])

  // ── Totaux ────────────────────────────────────────────────────────────────
  const brutHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_xaf, 0)
  const remiseMaxXaf = isResponsable ? Infinity : Math.floor(brutHt * CAISSIER_REMISE_MAX_PCT / 100)
  const remiseAppliquee = Math.min(remiseXaf, isResponsable ? remiseXaf : remiseMaxXaf)
  const totalHt = Math.max(0, Math.round(brutHt) - remiseAppliquee)
  const tva = Math.round(totalHt * TVA_RATE)
  const totalTtc = totalHt + tva

  // Pour un paiement "espèce", le caissier ne saisit QUE ce que le client lui
  // tend (montant_recu_xaf) — le montant réellement appliqué au ticket est
  // plafonné par ce qu'il reste à encaisser, le surplus devient le rendu.
  // Il n'y a plus de champ "montant" séparé à recaler à la main pour l'espèce :
  // c'était la source du bug "reste à encaisser" bloqué en négatif.
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

  function resetTicket() {
    setLignes([])
    setRemiseXaf(0)
    setSelectedClient(null)
    setClientQuery('')
    setPaiements([])
    setOpId(newKey())
    setTicketConfirme(null)
  }

  function ajouterProduit(p: { id: string; designation: string; unite: string; prix_unitaire_xaf: number }) {
    setLignes((prev) => {
      const existante = prev.find((l) => l.produit_id === p.id)
      if (existante) {
        return prev.map((l) => l.produit_id === p.id ? { ...l, quantite: l.quantite + 1 } : l)
      }
      return [...prev, {
        key: newKey(), produit_id: p.id, designation: p.designation, unite: p.unite,
        quantite: 1, prix_unitaire_xaf: p.prix_unitaire_xaf, prix_catalogue_xaf: p.prix_unitaire_xaf,
      }]
    })
  }

  function toggleFavori(id: string) {
    setFavoris((prev) => prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id])
  }

  function updateLigne(key: string, patch: Partial<TicketLigneUI>) {
    setLignes((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l))
  }

  function removeLigne(key: string) {
    setLignes((prev) => prev.filter((l) => l.key !== key))
  }

  function ouvrirPaiement() {
    if (lignes.length === 0) { toast.error('Le ticket est vide'); return }
    setPaiements([{ key: newKey(), mode: 'espece', montant_xaf: totalTtc, montant_recu_xaf: totalTtc }])
    setPaiementModalOpen(true)
  }

  function validerEncaissement() {
    if (resteAEncaisser > 0) {
      toast.error(`Il manque ${formatXAF(resteAEncaisser)} pour couvrir le total du ticket (${formatXAF(totalTtc)})`)
      return
    }
    if (resteAEncaisser < 0) {
      toast.error(`Le montant encaissé dépasse le total du ticket de ${formatXAF(-resteAEncaisser)}`)
      return
    }
    const creditPaiement = paiements.find((p) => p.mode === 'credit')
    if (creditPaiement && !selectedClient) {
      toast.error('Sélectionnez un client pour une vente à crédit')
      return
    }

    const lignesPayload: LigneTicketPayload[] = lignes.map((l) => ({
      produit_id:        l.produit_id,
      designation:       l.designation,
      unite:             l.unite,
      quantite:          l.quantite,
      prix_unitaire_xaf: l.prix_unitaire_xaf,
    }))
    // montant_xaf envoyé = le montant réellement APPLIQUÉ (paiementsCalcules),
    // pas le brut saisi — pour l'espèce, le surplus reçu est du rendu, pas de l'encaissement.
    const paiementsPayload: PaiementTicketPayload[] = paiementsCalcules.map((p) => ({
      mode:             p.mode,
      montant_xaf:       p.montant_applique,
      montant_recu_xaf:  p.mode === 'espece' ? p.montant_recu_xaf : undefined,
      reference:         p.reference,
    }))

    creerTicket.mutate({
      op_id:       opId,
      session_id:  sessionId,
      client_id:   selectedClient?.id,
      client_nom:  selectedClient?.nom,
      remise_xaf:  remiseAppliquee,
      lignes:      lignesPayload,
      paiements:   paiementsPayload,
    }, {
      onSuccess: (ticket) => {
        setPaiementModalOpen(false)
        setTicketConfirme(ticket)
      },
      // op_id n'est PAS régénéré ici — un retry après échec réseau reste idempotent.
    })
  }

  if (ticketConfirme) {
    return <RecuView ticket={ticketConfirme} onNouvelleVente={resetTicket} />
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
      {/* ── Colonne recherche articles ── */}
      <div className="space-y-4">
        {produitsFavoris.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {produitsFavoris.map((p) => (
              <button
                key={p.id}
                onClick={() => ajouterProduit(p)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50
                  text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
              >
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {p.designation}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="search"
              autoFocus
              placeholder="Rechercher un article (nom, référence)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
          <select
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          >
            <option value="">Toutes catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm max-h-[60vh] overflow-y-auto">
          {stocksLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin h-6 w-6 rounded-full border-2 border-[#C62828] border-t-transparent" />
            </div>
          ) : produits.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">Aucun article trouvé</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {produits.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/60 transition-colors">
                  <button className="flex-1 text-left" onClick={() => ajouterProduit(p)}>
                    <div className="text-sm font-medium text-[#212121]">{p.designation}</div>
                    <div className="text-xs text-gray-400">
                      {p.ref} · Stock : {p.stock_actuel} {p.unite} · {formatXAF(p.prix_unitaire_xaf)}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleFavori(p.id)} title="Favori" className="p-1.5 rounded-lg hover:bg-gray-100">
                      <Star className={`h-4 w-4 ${favoris.includes(p.id) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                    </button>
                    <Button size="xs" onClick={() => ajouterProduit(p)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Colonne ticket ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4 h-fit sticky top-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#212121]">Ticket en cours</h3>
          <button onClick={() => setFermetureOpen(true)} className="text-xs text-gray-400 hover:text-[#C62828] underline">
            Fermer la caisse
          </button>
        </div>

        {lignes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun article — cliquez sur un produit pour l'ajouter</p>
        ) : (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {lignes.map((l) => (
              <div key={l.key} className="border border-gray-100 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-[#212121] flex-1">{l.designation}</span>
                  <button onClick={() => removeLigne(l.key)} className="text-gray-300 hover:text-[#C62828]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateLigne(l.key, { quantite: Math.max(0.01, +(l.quantite - 1).toFixed(2)) })}
                    className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-50"
                  ><Minus className="h-3 w-3" /></button>
                  <input
                    type="number" min={0.01} step={0.01} value={l.quantite}
                    onChange={(e) => updateLigne(l.key, { quantite: Math.max(0.01, Number(e.target.value)) })}
                    className="w-14 text-center text-sm border border-gray-200 rounded py-1"
                  />
                  <button
                    onClick={() => updateLigne(l.key, { quantite: +(l.quantite + 1).toFixed(2) })}
                    className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-50"
                  ><Plus className="h-3 w-3" /></button>
                  <select
                    value={l.unite}
                    onChange={(e) => updateLigne(l.key, { unite: e.target.value })}
                    className="text-xs border border-gray-200 rounded px-1.5 py-1"
                  >
                    {UNITES_CAISSE.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {isResponsable ? (
                    <input
                      type="number" min={0} value={l.prix_unitaire_xaf}
                      onChange={(e) => updateLigne(l.key, { prix_unitaire_xaf: Math.max(0, Number(e.target.value)) })}
                      className="w-20 ml-auto text-right text-sm border border-gray-200 rounded py-1 px-1.5"
                    />
                  ) : (
                    <span className="ml-auto text-sm font-medium">{formatXAF(l.prix_unitaire_xaf)}</span>
                  )}
                </div>
                <div className="text-right text-xs text-gray-400">
                  = {formatXAF(l.quantite * l.prix_unitaire_xaf)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Client (crédit) */}
        <div className="border-t border-gray-100 pt-3">
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Client <span className="normal-case font-normal text-gray-300">(optionnel — requis pour crédit)</span>
          </label>
          {selectedClient ? (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
              <span className="font-medium">{selectedClient.nom}</span>
              <button onClick={() => setSelectedClient(null)}><X className="h-3.5 w-3.5 text-gray-400" /></button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                placeholder="Rechercher un client…"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
              {clientQuery.trim().length >= 2 && (clientsData?.data?.length ?? 0) > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {clientsData!.data.map((cl) => (
                    <button
                      key={cl.id}
                      onClick={() => { setSelectedClient(cl); setClientQuery('') }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {cl.nom}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Remise */}
        <div className="border-t border-gray-100 pt-3">
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Remise (FCFA) {!isResponsable && brutHt > 0 && <span className="normal-case font-normal text-gray-300">— max {formatXAF(remiseMaxXaf)}</span>}
          </label>
          <input
            type="number" min={0} value={remiseXaf}
            onChange={(e) => setRemiseXaf(Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
          {!isResponsable && remiseXaf > remiseMaxXaf && (
            <p className="text-xs text-[#C62828] mt-1">Remise limitée à {CAISSIER_REMISE_MAX_PCT}% — un responsable doit valider au-delà.</p>
          )}
        </div>

        {/* Totaux */}
        <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500"><span>Total HT</span><span>{formatXAF(totalHt)}</span></div>
          {tva > 0 && (
            <div className="flex justify-between text-gray-500"><span>TVA</span><span>{formatXAF(tva)}</span></div>
          )}
          <div className="flex justify-between text-lg font-bold text-[#212121]"><span>Total TTC</span><span>{formatXAF(totalTtc)}</span></div>
        </div>

        <Button className="w-full justify-center" disabled={lignes.length === 0} onClick={ouvrirPaiement}>
          Encaisser
        </Button>
      </div>

      {/* ── Modal paiement ── */}
      <Modal isOpen={paiementModalOpen} onClose={() => setPaiementModalOpen(false)} title="Encaissement" size="md">
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase">Total à encaisser</p>
            <p className="text-2xl font-bold text-[#212121]">{formatXAF(totalTtc)}</p>
          </div>

          <div className="space-y-3">
            {paiementsCalcules.map((p, i) => (
              <div key={p.key} className="border border-gray-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {MODES.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, mode: m.value } : x))}
                        disabled={m.value === 'credit' && !selectedClient}
                        className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        style={p.mode === m.value
                          ? { backgroundColor: m.color, borderColor: m.color, color: '#fff' }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {paiements.length > 1 && (
                    <button onClick={() => setPaiements((prev) => prev.filter((_, xi) => xi !== i))}>
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-[#C62828]" />
                    </button>
                  )}
                </div>

                {p.mode === 'espece' ? (
                  // Un seul champ : ce que le client tend. Le montant appliqué au
                  // ticket est calculé (plafonné au reste dû) — jamais saisi à part.
                  <>
                    <input
                      type="number" min={0} value={p.montant_recu_xaf ?? ''}
                      onChange={(e) => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, montant_recu_xaf: Math.max(0, Number(e.target.value)) } : x))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                      placeholder="Montant reçu du client"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Appliqué au ticket : <strong className="text-[#212121]">{formatXAF(p.montant_applique)}</strong></span>
                      {p.rendu > 0 && <span className="text-green-700 font-semibold">Rendu : {formatXAF(p.rendu)}</span>}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0} value={p.montant_xaf}
                      onChange={(e) => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, montant_xaf: Math.max(0, Number(e.target.value)) } : x))}
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
                      placeholder="Montant"
                    />
                    {(p.mode === 'orange_money' || p.mode === 'mtn_momo') && (
                      <input
                        type="text" value={p.reference ?? ''}
                        onChange={(e) => setPaiements((prev) => prev.map((x, xi) => xi === i ? { ...x, reference: e.target.value } : x))}
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
                        placeholder="Réf. transaction"
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setPaiements((prev) => [
              ...prev,
              { key: newKey(), mode: 'espece', montant_xaf: Math.max(0, resteAEncaisser), montant_recu_xaf: Math.max(0, resteAEncaisser) },
            ])}
            className="text-xs font-medium text-[#C62828] hover:underline"
          >
            + Ajouter un mode de paiement (fractionné)
          </button>

          <div className={`text-center text-sm font-semibold ${resteAEncaisser === 0 ? 'text-green-700' : 'text-[#C62828]'}`}>
            {resteAEncaisser === 0
              ? 'Montant complet'
              : resteAEncaisser > 0
                ? `Reste à encaisser : ${formatXAF(resteAEncaisser)}`
                : `Trop encaissé de ${formatXAF(-resteAEncaisser)}`}
          </div>

          <Button
            className="w-full justify-center"
            disabled={resteAEncaisser !== 0 || creerTicket.isPending}
            onClick={validerEncaissement}
          >
            {creerTicket.isPending ? 'Enregistrement…' : 'Valider l\'encaissement'}
          </Button>
        </div>
      </Modal>

      {/* ── Modal fermeture session ── */}
      <FermetureModal
        isOpen={fermetureOpen}
        onClose={() => setFermetureOpen(false)}
        sessionId={sessionId}
        fermerSession={fermerSession}
      />
    </div>
  )
}

function FermetureModal({
  isOpen, onClose, sessionId, fermerSession,
}: {
  isOpen: boolean
  onClose: () => void
  sessionId: string
  fermerSession: ReturnType<typeof useFermerSession>
}) {
  const [fondFermeture, setFondFermeture] = useState<number>(0)
  const [rapport, setRapport] = useState<RapportZ | null>(null)

  if (rapport) {
    return (
      <Modal isOpen={isOpen} onClose={() => { setRapport(null); onClose(); window.location.reload() }} title="Session fermée" size="md">
        <RapportZView rapport={rapport} onNouvelleSession={() => { setRapport(null); onClose(); window.location.reload() }} />
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Fermer la caisse" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Comptez les espèces en caisse et saisissez le montant exact.</p>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant compté (FCFA)</label>
          <input
            type="number" min={0} value={fondFermeture} autoFocus
            onChange={(e) => setFondFermeture(Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-3 text-lg font-semibold text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button
            className="flex-1"
            disabled={fermerSession.isPending}
            onClick={() => fermerSession.mutate(
              { sessionId, fond_fermeture_xaf: fondFermeture },
              { onSuccess: (r) => setRapport(r) },
            )}
          >
            {fermerSession.isPending ? 'Fermeture…' : 'Confirmer la fermeture'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Détail d'un ticket depuis l'historique — voir / imprimer / renvoyer ────────

function TicketDetailModal({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { data: ticket, isLoading } = useTicketDetail(ticketId)

  return (
    <Modal isOpen={Boolean(ticketId)} onClose={onClose} title="Détail du ticket" size="md">
      {isLoading || !ticket ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-[#C62828] border-t-transparent" />
        </div>
      ) : (
        <RecuView ticket={ticket} onNouvelleVente={onClose} actionLabel="Fermer" />
      )}
    </Modal>
  )
}

// ── Écran : historique des ventes ────────────────────────────────────────────────

const STATUT_STYLE: Record<string, string> = {
  paye:       'text-green-700 bg-green-50',
  annule:     'text-red-600 bg-red-50',
  rembourse:  'text-amber-700 bg-amber-50',
}

function HistoriqueScreen() {
  const [page, setPage]           = useState(1)
  const [statut, setStatut]       = useState('')
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin]     = useState('')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)

  const { data, isLoading } = useHistoriqueTickets({
    page, per_page: 20,
    statut:     statut || undefined,
    date_debut: dateDebut || undefined,
    date_fin:   dateFin || undefined,
  })

  const tickets = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date" value={dateDebut}
          onChange={(e) => { setDateDebut(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          title="Date début"
        />
        <input
          type="date" value={dateFin} min={dateDebut}
          onChange={(e) => { setDateFin(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          title="Date fin"
        />
        <select
          value={statut}
          onChange={(e) => { setStatut(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        >
          <option value="">Tous statuts</option>
          <option value="paye">Payé</option>
          <option value="annule">Annulé</option>
          <option value="rembourse">Remboursé</option>
        </select>
        {(dateDebut || dateFin || statut) && (
          <Button variant="ghost" size="sm" onClick={() => { setDateDebut(''); setDateFin(''); setStatut(''); setPage(1) }}>
            Réinitialiser
          </Button>
        )}
        {data && (
          <span className="ml-auto text-xs text-gray-400">
            {data.total} ticket{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center items-center py-16">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-[#C62828] border-t-transparent" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-gray-400">
            <History className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">Aucune vente trouvée</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ticket</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Client</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total TTC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.numero_facture ?? t.numero_local ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                  <td className="px-4 py-3 text-sm text-[#212121]">{t.client_nom ?? 'Comptoir'}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold">{formatXAF(t.total_ttc_xaf)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUT_STYLE[t.statut] ?? 'text-gray-600 bg-gray-100'}`}>
                      {t.statut}{t.oversell ? ' · oversell' : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Page {page} / {data.total_pages}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Précédent</Button>
            <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Suivant →</Button>
          </div>
        </div>
      )}

      <TicketDetailModal ticketId={selectedTicketId} onClose={() => setSelectedTicketId(null)} />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Caisse() {
  const { role } = useAuth()
  const isResponsable = role === 'admin' || role === 'superviseur'
  const { data: session, isLoading } = useSessionCourante()
  const [tab, setTab] = useState<'vente' | 'historique'>('vente')

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-6"
    >
      <PageHeader
        title="Caisse"
        subtitle="Vente au comptoir · TAFDIL"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Caisse' }]}
      />

      <div className="flex border-b border-gray-200">
        {([
          { key: 'vente' as const, label: 'Vente', icon: null },
          { key: 'historique' as const, label: 'Historique', icon: <History className="h-3.5 w-3.5" /> },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-[#C62828] text-[#C62828]'
                : 'border-transparent text-gray-500 hover:text-[#212121]'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === 'historique' ? (
        <HistoriqueScreen />
      ) : isLoading ? (
        <div className="flex justify-center py-24">
          <div className="animate-spin h-8 w-8 rounded-full border-2 border-[#C62828] border-t-transparent" />
        </div>
      ) : !session ? (
        <OuvertureSession />
      ) : (
        <VenteScreen sessionId={session.id} isResponsable={isResponsable} />
      )}
    </motion.div>
  )
}
