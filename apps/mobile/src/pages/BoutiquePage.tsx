import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { TopBar } from '../components/TopBar'
import { createShopCommande, fetchShopCommandes, fetchStockDetail, fetchStocks, type ApiShopCommandeClient, type ApiStock } from '../lib/api'

function formatXAF(amount: number) {
  return new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 }).format(amount) + ' FCFA'
}

interface BoutiqueCartLine {
  product: ApiStock
  quantite: number
  prix_unitaire: number
}

export function BoutiquePage() {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ApiStock[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ApiStock | null>(null)
  const [qty, setQty] = useState(1)
  const [prixVente, setPrixVente] = useState<number | undefined>(undefined)
  const [paid, setPaid] = useState<number | undefined>(undefined)
  const [clientName, setClientName] = useState('Client Boutique')
  const [clientPhone, setClientPhone] = useState('')
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const [cartItems, setCartItems] = useState<BoutiqueCartLine[]>([])
  const [processing, setProcessing] = useState(false)
  const [receipt, setReceipt] = useState<any | null>(null)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [salesHistory, setSalesHistory] = useState<ApiShopCommandeClient[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [paymentMode, setPaymentMode] = useState<'especes' | 'mtn_momo' | 'orange_money' | 'livraison'>('especes')
  const [advancePct, setAdvancePct] = useState<30 | 50 | 70 | null>(null)
  const [paymentNote, setPaymentNote] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!search) return setResults([])
      setLoading(true)
      try {
        const res = await fetchStocks({ search, per_page: 20 })
        if (!cancelled) setResults(res.data)
      } catch (e) {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  function normalizeScanValue(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return ''

    if (/^[0-9a-fA-F-]{10,}$/.test(trimmed)) {
      return trimmed
    }

    try {
      const url = new URL(trimmed)
      const queryId = url.searchParams.get('id') || url.searchParams.get('ref') || url.searchParams.get('code')
      if (queryId) return queryId.trim()
      const pathValue = url.pathname.split('/').filter(Boolean).pop()
      if (pathValue) return pathValue.trim()
    } catch {
      // not a full URL
    }

    return trimmed
  }

  async function fetchProductFromCode(code: string) {
    const normalized = normalizeScanValue(code)
    if (!normalized) {
      setSearchError('Valeur de code invalide.')
      return
    }
    setSearchError('')

    const byRefOrName = await fetchStocks({ search: normalized, per_page: 20 })
    const exactMatch = byRefOrName.data.find((product) =>
      product.ref?.toLowerCase() === normalized.toLowerCase() ||
      product.designation?.toLowerCase() === normalized.toLowerCase(),
    )
    if (exactMatch) {
      setSelected(exactMatch)
      setResults([])
      return
    }

    if (/^[0-9a-fA-F-]{10,}$/.test(normalized)) {
      try {
        const detail = await fetchStockDetail(normalized)
        if (detail) {
          setSelected(detail)
          setResults([])
          return
        }
      } catch {
        // ignore not found
      }
    }

    if (byRefOrName.data.length === 1) {
      setSelected(byRefOrName.data[0])
      setResults([])
      return
    }

    if (byRefOrName.data.length === 0) {
      setSearchError('Aucun produit trouvé pour ce code ou cette référence.')
      setResults([])
      return
    }

    setResults(byRefOrName.data)
  }

  useEffect(() => {
    if (!scannerActive || !videoRef.current) return

    const codeReader = new BrowserMultiFormatReader()
    setScannerError('')
    let active = true

    codeReader.decodeOnceFromVideoDevice(undefined, videoRef.current)
      .then((result) => {
        if (!active) return
        const text = result.getText().trim()
        setSearch(text)
        if (text) {
          fetchProductFromCode(text)
        }
        setScannerActive(false)
      })
      .catch((err) => {
        if (!active) return
        if (err instanceof NotFoundException) {
          setScannerError('Aucun QR code détecté pour le moment. Orientez la caméra vers le code.')
        } else {
          setScannerError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      active = false
      codeReader.reset()
    }
  }, [scannerActive])

  useEffect(() => {
    setPrixVente(selected ? selected.prix_unitaire_xaf : undefined)
    setQty(1)
    setPaid(undefined)
    setError('')
    setReceipt(null)
    setSelectedImage(selected?.image_url ?? null)
  }, [selected])

  const total = useMemo(() => {
    return Math.round((prixVente ?? 0) * (qty || 1))
  }, [prixVente, qty])

  const cartTotal = useMemo(() => {
    return cartItems.reduce((sum, line) => sum + line.quantite * line.prix_unitaire, 0)
  }, [cartItems])

  const paidAmount = useMemo(() => {
    if (paid === undefined || paid === null) return cartTotal
    return Math.round(paid)
  }, [paid, cartTotal])

  const dueAmount = useMemo(() => {
    return Math.max(0, cartTotal - paidAmount)
  }, [paidAmount, cartTotal])

  const change = useMemo(() => {
    return Math.max(0, paidAmount - cartTotal)
  }, [paidAmount, cartTotal])

  function addSelectedToCart() {
    if (!selected) return setError('Sélectionnez un produit à ajouter.')
    if (prixVente === undefined || prixVente <= 0) return setError('Entrez un prix de vente valide.')
    if (qty < 1) return setError('La quantité doit être au moins 1.')

    setCartItems((current) => {
      const existingIndex = current.findIndex(
        (line) => line.product.id === selected.id && line.prix_unitaire === prixVente,
      )
      if (existingIndex >= 0) {
        const next = [...current]
        next[existingIndex] = {
          ...next[existingIndex],
          quantite: next[existingIndex].quantite + qty,
        }
        return next
      }
      return [...current, { product: selected, quantite: qty, prix_unitaire: prixVente }]
    })

    setSelected(null)
    setSearch('')
    setResults([])
    setPrixVente(undefined)
    setQty(1)
    setSelectedImage(null)
    setError('')
    setSearchError('')
  }

  function removeCartItem(index: number) {
    setCartItems((current) => current.filter((_, i) => i !== index))
  }

  async function submitSale() {
    if (cartItems.length === 0) return setError('Ajoutez au moins un produit à la vente.')
    setProcessing(true)
    setError('')
    try {
      const totalAmount = cartTotal
      const paidAmount = paid === undefined ? cartTotal : paid

      if (paymentMode === 'livraison') {
        if (advancePct === null) {
          throw new Error('Sélectionnez un pourcentage d\'avance : 30 %, 50 % ou 70 %.')
        }
        const expected = Math.round(totalAmount * (advancePct / 100))
        if (paidAmount !== expected) {
          throw new Error('Pour un paiement partiel, le montant payé doit correspondre à l\'avance sélectionnée.')
        }
      } else if (paidAmount < totalAmount) {
        throw new Error('Le montant payé doit couvrir le total de la vente. Pour un paiement partiel, choisissez Paiement partiel.')
      }

      const lignes = cartItems.map((line) => ({
        product_id: line.product.id,
        designation: line.product.designation,
        quantite: line.quantite,
        prix_unitaire: line.prix_unitaire,
      }))

      const body = {
        client_nom: clientName || 'Client Boutique',
        client_telephone: clientPhone || null,
        client_email: null,
        client_adresse: null,
        client_ville: null,
        lignes,
        mode_paiement: paymentMode,
        mode_livraison: 'retrait_boutique',
        frais_livraison: 0,
        avance_livraison_pct: paymentMode === 'livraison' ? advancePct ?? undefined : undefined,
        condition_paiement_code: 'P100',
        notes_client: paymentNote || undefined,
      }

      const data = await createShopCommande(body)
      // build receipt object with invoice and client details
      const rec = {
        ref: data.ref ?? '—',
        montant: data.montant_ttc ?? totalAmount,
        lignes: cartItems.map((line) => ({
          designation: line.product.designation,
          quantite: line.quantite,
          prix_unitaire: line.prix_unitaire,
          montant: line.quantite * line.prix_unitaire,
        })),
        paid: paidAmount,
        change: paidAmount - totalAmount,
        clientName: clientName || 'Client Boutique',
        clientPhone: clientPhone || 'non spécifié',
      }
      setReceipt(rec)
      setInvoiceNumber(data.ref ?? null)
      // clear form
      setSelected(null)
      setSearch('')
      setResults([])
      setPrixVente(undefined)
      setPaid(undefined)
      setCartItems([])
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : JSON.stringify(e, Object.getOwnPropertyNames(e))
      setError(message)
    } finally {
      setProcessing(false)
    }
  }

  function printReceipt() {
    if (!receipt) return
    const linesHtml = receipt.lignes.map((line: any) => `
      <tr>
        <td style="padding: 10px 0;">${line.designation}</td>
        <td align="right" style="padding: 10px 0;">${line.quantite}</td>
        <td align="right" style="padding: 10px 0;">${formatXAF(line.prix_unitaire)}</td>
        <td align="right" style="padding: 10px 0;">${formatXAF(line.montant)}</td>
      </tr>
    `).join('')
    const html = `
      <html>
      <head><meta charset="utf-8"><title>Facture ${receipt.ref}</title></head>
      <body style="font-family: Inter, sans-serif; color: #111; margin: 24px;">
        <h2 style="margin-bottom: 8px;">Facture Boutique — ${receipt.ref}</h2>
        <div style="font-size: 14px; color: #555; margin-bottom: 18px;">
          <div><strong>Client :</strong> ${receipt.clientName}</div>
          <div><strong>Téléphone :</strong> ${receipt.clientPhone}</div>
          <div><strong>Date :</strong> ${new Date().toLocaleString('fr-FR')}</div>
        </div>
        <table width="100%" style="border-collapse: collapse; margin-bottom: 18px;">
          <thead>
            <tr>
              <th align="left" style="border-bottom: 1px solid #ddd; padding: 8px 0;">Produit</th>
              <th align="right" style="border-bottom: 1px solid #ddd; padding: 8px 0;">Qté</th>
              <th align="right" style="border-bottom: 1px solid #ddd; padding: 8px 0;">Prix</th>
              <th align="right" style="border-bottom: 1px solid #ddd; padding: 8px 0;">Total</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
        <div style="font-size: 14px; margin-bottom: 4px;"><strong>Total :</strong> ${formatXAF(receipt.montant)}</div>
        <div style="font-size: 14px; margin-bottom: 4px;"><strong>Payé :</strong> ${formatXAF(receipt.paid)}</div>
        <div style="font-size: 14px; margin-bottom: 18px;"><strong>Rendu :</strong> ${formatXAF(receipt.change)}</div>
        <p style="font-size: 14px; color: #555; margin: 0;">Merci pour votre achat. Conservez ce reçu comme preuve d'achat.</p>
      </body>
      </html>
    `
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.print()
  }

  function sendWhatsapp() {
    if (!receipt) return
    const linesText = receipt.lignes.map((line: any) => `${line.designation} x${line.quantite} ${formatXAF(line.prix_unitaire)} = ${formatXAF(line.montant)}`).join(' \n')
    const msg = `Facture ${receipt.ref} \nClient: ${receipt.clientName} \nTéléphone: ${receipt.clientPhone} \n${linesText} \nTotal: ${formatXAF(receipt.montant)} \nPayé: ${formatXAF(receipt.paid)} \nRendu: ${formatXAF(receipt.change)} \nN° facture: ${receipt.ref} \nMerci pour votre achat.`
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
  }

  useEffect(() => {
    setHistoryLoading(true)
    fetchShopCommandes({ per_page: 10 })
      .then((res) => setSalesHistory(res.data))
      .catch(() => setSalesHistory([]))
      .finally(() => setHistoryLoading(false))
  }, [])

  const latestSales = useMemo(() => {
    return [...salesHistory].sort((a, b) => new Date(b.date_commande).getTime() - new Date(a.date_commande).getTime())
  }, [salesHistory])

  return (
    <div>
      <TopBar title="Boutique" subtitle="Vente en boutique" />
      <div className="px-4 py-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="search"
            placeholder="Scanner QR ou rechercher produit par nom / ref"
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setSearchError('')
            }}
            className="col-span-2 w-full rounded-2xl border border-gray-200 px-4 py-3"
          />
          <button type="button" className="rounded-2xl bg-[#C62828] text-white py-3 px-4" onClick={() => setScannerActive(true)}>Scanner QR</button>
        </div>
        {searchError && <div className="text-sm text-red-600">{searchError}</div>}
        {scannerActive && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="w-full max-w-xl rounded-3xl bg-white overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div>
                  <h2 className="text-base font-semibold">Scanner QR</h2>
                  <p className="text-xs text-gray-500">Placez le code QR devant la caméra.</p>
                </div>
                <button type="button" onClick={() => setScannerActive(false)} className="text-gray-500 hover:text-gray-900">Fermer</button>
              </div>
              <div className="p-4">
                <video ref={videoRef} className="h-72 w-full rounded-3xl bg-black" muted playsInline />
                {scannerError && <div className="mt-3 text-sm text-red-600">{scannerError}</div>}
                <p className="mt-2 text-sm text-gray-500">Le scanner s’arrête dès qu’un code est lu.</p>
              </div>
            </div>
          </div>
        )}

        {loading && <div className="text-sm text-gray-500">Recherche…</div>}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map(p => (
              <div key={p.id} className="bg-white rounded-xl p-3 border" onClick={() => setSelected(p)}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{p.designation}</div>
                    <div className="text-xs text-gray-500">{p.ref} · {p.categorie}</div>
                  </div>
                  <div className="text-sm font-bold text-[#C62828]">{formatXAF(p.prix_unitaire_xaf)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selected ? (
          <div className="bg-white rounded-2xl p-4 space-y-3 border">
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 rounded-3xl bg-gray-100 overflow-hidden flex items-center justify-center">
                {selectedImage ? (
                  <img src={selectedImage} alt={selected.designation} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-gray-400">Aucune image</span>
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{selected.designation}</div>
                <div className="text-xs text-gray-500">{selected.ref}</div>
                <div className="mt-2 text-xs text-gray-500">Catégorie: {selected.categorie}</div>
                <div className="mt-1 text-xs text-gray-500">Stock actuel: {selected.stock_actuel}</div>
              </div>
              <div className="text-sm font-bold text-[#C62828]">{formatXAF(selected.prix_unitaire_xaf)}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-gray-600">
                Qté
                <input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))} className="w-full rounded-2xl border px-3 py-2" />
              </label>
              <label className="space-y-1 text-xs text-gray-600">
                Prix de vente
                <input type="number" min={0} value={prixVente ?? 0} onChange={e => setPrixVente(Number(e.target.value))} className="w-full rounded-2xl border px-3 py-2" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-gray-600">
                Nom client
                <input value={clientName} onChange={e => setClientName(e.target.value)} className="w-full rounded-2xl border px-3 py-2" />
              </label>
              <label className="space-y-1 text-xs text-gray-600">
                Téléphone
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} className="w-full rounded-2xl border px-3 py-2" />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-lg font-bold">{formatXAF(total)}</div>
              </div>
            </div>

            {paymentMode === 'livraison' && advancePct !== null && (
              <div className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                Paiement partiel actif — {advancePct}% d'avance
              </div>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex gap-3">
              <button type="button" onClick={addSelectedToCart} disabled={processing} className="flex-1 rounded-2xl bg-[#C62828] text-white py-3">{processing ? 'Ajout…' : 'Enregistrer vente'}</button>
              <button type="button" onClick={() => { setSelected(null); setError('') }} className="flex-1 rounded-2xl border py-3">Annuler</button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Sélectionnez un produit pour démarrer la vente</div>
        )}

        {cartItems.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Panier de vente</div>
                <div className="text-xs text-gray-500">{cartItems.length} produit(s) ajoutés</div>
              </div>
              <div className="text-lg font-bold">{formatXAF(cartTotal)}</div>
            </div>
            <div className="space-y-2">
              {cartItems.map((line, index) => (
                <div key={`${line.product.id}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl border p-3">
                  <div>
                    <div className="font-semibold">{line.product.designation}</div>
                    <div className="text-xs text-gray-500">{line.product.ref} · {line.product.categorie}</div>
                    <div className="text-xs text-gray-500">{line.quantite} × {formatXAF(line.prix_unitaire)} = {formatXAF(line.quantite * line.prix_unitaire)}</div>
                  </div>
                  <button type="button" onClick={() => removeCartItem(index)} className="text-sm text-red-600">Supprimer</button>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setPaymentMode('especes')} className={`rounded-2xl border px-3 py-2 text-left ${paymentMode === 'especes' ? 'border-[#C62828] bg-[#fee2e2]' : 'border-gray-200 bg-white'}`}>
                  <div className="text-sm font-semibold">Espèces</div>
                  <div className="text-xs text-gray-500">Paiement cash</div>
                </button>
                <button type="button" onClick={() => setPaymentMode('mtn_momo')} className={`rounded-2xl border px-3 py-2 text-left ${paymentMode === 'mtn_momo' ? 'border-[#C62828] bg-[#fee2e2]' : 'border-gray-200 bg-white'}`}>
                  <div className="text-sm font-semibold">MTN MoMo</div>
                  <div className="text-xs text-gray-500">Paiement mobile</div>
                </button>
                <button type="button" onClick={() => setPaymentMode('orange_money')} className={`rounded-2xl border px-3 py-2 text-left ${paymentMode === 'orange_money' ? 'border-[#C62828] bg-[#fee2e2]' : 'border-gray-200 bg-white'}`}>
                  <div className="text-sm font-semibold">Orange Money</div>
                  <div className="text-xs text-gray-500">Paiement mobile</div>
                </button>
                <button type="button" onClick={() => setPaymentMode('livraison')} className={`rounded-2xl border px-3 py-2 text-left ${paymentMode === 'livraison' ? 'border-[#C62828] bg-[#fee2e2]' : 'border-gray-200 bg-white'}`}>
                  <div className="text-sm font-semibold">Paiement partiel</div>
                  <div className="text-xs text-gray-500">Avance 30 / 50 / 70%</div>
                </button>
              </div>

              {paymentMode === 'livraison' && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500">Sélectionnez le pourcentage d'avance</div>
                  <div className="flex gap-2 flex-wrap">
                    {[30, 50, 70].map((pct) => (
                      <button key={pct} type="button" onClick={() => setAdvancePct(pct as 30 | 50 | 70)} className={`rounded-2xl border px-4 py-2 text-sm ${advancePct === pct ? 'border-[#C62828] bg-[#fee2e2]' : 'border-gray-200 bg-white'}`}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="space-y-1 text-xs text-gray-600">
                Montant payé
                <input type="number" min={0} value={paid ?? ''} onChange={e => setPaid(e.target.value === '' ? undefined : Number(e.target.value))} className="w-full rounded-2xl border px-3 py-2" />
              </label>
              <label className="space-y-1 text-xs text-gray-600">
                Note paiement
                <input value={paymentNote} onChange={e => setPaymentNote(e.target.value)} className="w-full rounded-2xl border px-3 py-2" placeholder="Notes ou référence" />
              </label>
              <div className="rounded-2xl border p-3 bg-gray-50">
                <div className="text-xs text-gray-500">{paymentMode === 'livraison' ? 'Reste à payer' : 'Rendu'}</div>
                <div className="text-lg font-semibold">{formatXAF(paymentMode === 'livraison' ? dueAmount : change)}</div>
              </div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex gap-3">
              <button type="button" onClick={submitSale} disabled={processing} className="flex-1 rounded-2xl bg-[#0f766e] text-white py-3">{processing ? 'Validation…' : 'Valider la vente'}</button>
              <button type="button" onClick={() => { setCartItems([]); setError(''); setPaid(undefined) }} className="flex-1 rounded-2xl border py-3">Annuler</button>
            </div>
          </div>
        )}

        {salesHistory.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Historique des ventes</div>
                <div className="text-xs text-gray-500">Dernières ventes enregistrées</div>
              </div>
              <button type="button" onClick={() => navigate('/orders')} className="rounded-full border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Voir tout</button>
            </div>
            <div className="space-y-2">
              {latestSales.slice(0, 5).map((order) => (
                <div key={order.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl border p-3">
                  <div>
                    <div className="font-semibold text-sm truncate">{order.ref} — {order.client.nom}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleDateString('fr-FR')} · {order.mode_paiement === 'livraison' ? `Acompte ${order.avance_livraison_pct ?? 0}%` : order.mode_paiement}
                    </div>
                    <div className="text-xs text-gray-500">{order.statut_commande} / {order.statut_paiement}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[#C62828]">{formatXAF(order.montant_ttc)}</div>
                    {order.mode_paiement === 'livraison' && order.statut_paiement !== 'paye' ? (
                      <div className="text-xs text-gray-500">Restant: {formatXAF(order.reste_montant)}</div>
                    ) : (
                      <div className="text-xs text-gray-500">{order.statut_paiement === 'paye' ? 'Payé' : 'À régler'}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {receipt && (
          <div className="mt-4 bg-white rounded-2xl p-4 border space-y-2">
            <div className="text-sm">Reçu: <strong>{receipt.ref}</strong></div>
            <div className="text-sm">Total: <strong>{formatXAF(receipt.montant)}</strong></div>
            <div className="flex gap-3">
              <button onClick={printReceipt} className="rounded-2xl border py-2 px-3">Imprimer</button>
              <button onClick={sendWhatsapp} className="rounded-2xl bg-green-600 text-white py-2 px-3">Envoyer WhatsApp</button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
