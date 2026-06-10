import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Store, ShoppingBag, Eye, EyeOff, FileText,
  TrendingUp, Package, Clock, BarChart2,
  CheckCircle, XCircle, Edit2, Image, Upload, Trash2,
  ExternalLink,
} from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { useProduitsShop, useToggleVisibilite, useUpdateVitrineProduit, useUploadImagesProduit } from '@/hooks/useProduitsShop'
import type { ProduitShopErp } from '@/hooks/useProduitsShop'
import { useCommandesShop } from '@/hooks/useCommandesShop'
import type { CommandeShop } from '@/hooks/useCommandesShop'
import { useDevisWeb, useCreerDevisErp, useChangerStatutDevisWeb } from '@/hooks/useDevisWeb'
import type { DevisWeb } from '@/hooks/useDevisWeb'
import { useShopAnalytics } from '@/hooks/useShopAnalytics'

// ── Savoir-faire TAFDIL — pour filtre devis ───────────────────────────────────

const TYPES_PROJET_LABELS = [
  'Charpente / Hangar métallique',
  'Tuyauterie industrielle',
  'Citerne / Bac de stockage',
  'Panneau publicitaire / Kiosque',
  'Portail / Grilles / Ferronnerie',
  'Carrosserie Plateau Camion',
  'Auvent / Couverture métallique',
  'Menuiserie métallique',
  'Mécanosoudure / Tôlerie',
  'Aménagement / Bâtiment',
  'Fournitures industrielles',
  'Produit du catalogue',
  'Autre / Je ne sais pas',
]

// ── Tab type ───────────────────────────────────────────────────────────────────

type Tab = 'catalogue' | 'commandes' | 'devis'

// ── Prix edit modal ────────────────────────────────────────────────────────────

function EditVitrineModal({
  isOpen, onClose, produit,
}: {
  isOpen: boolean
  onClose: () => void
  produit: ProduitShopErp | null
}) {
  const [prix, setPrix] = useState<number>(produit?.prix_public ?? 0)
  const [visible, setVisible] = useState<boolean>(produit?.visible_shop ?? false)
  const [description, setDescription] = useState(produit?.description_longue ?? '')
  const [images, setImages] = useState((produit?.images ?? []).join('\n'))
  const [tags, setTags] = useState((produit?.tags ?? []).join(', '))
  const [delai, setDelai] = useState<number>(produit?.delai_fabrication_jours ?? 7)
  const [minCommande, setMinCommande] = useState<number>(produit?.min_commande ?? 1)
  const updateVitrine = useUpdateVitrineProduit()
  const uploadImages = useUploadImagesProduit()

  React.useEffect(() => {
    if (!produit) return
    setPrix(produit.prix_public ?? 0)
    setVisible(produit.visible_shop)
    setDescription(produit.description_longue ?? '')
    setImages((produit.images ?? []).join('\n'))
    setTags((produit.tags ?? []).join(', '))
    setDelai(produit.delai_fabrication_jours ?? 7)
    setMinCommande(produit.min_commande ?? 1)
  }, [produit])

  if (!produit) return null

  const imageList = images.split('\n').map((url) => url.trim()).filter(Boolean)
  const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean)

  const setImageList = (next: string[]) => setImages(next.join('\n'))

  const handleImageUpload = (files: FileList | null) => {
    if (!produit || !files?.length) return
    uploadImages.mutate(
      { id: produit.id, files: Array.from(files) },
      {
        onSuccess: (res) => {
          setImageList([...imageList, ...res.data.urls])
          toast.success(`${res.data.urls.length} image${res.data.urls.length > 1 ? 's' : ''} ajoutee${res.data.urls.length > 1 ? 's' : ''}`)
        },
      },
    )
  }

  const handleSave = () => {
    updateVitrine.mutate({
      id: produit.id,
      payload: {
        visible_shop: visible,
        prix_public: prix > 0 ? prix : null,
        description_longue: description.trim() || null,
        images: imageList,
        tags: tagList,
        delai_fabrication_jours: delai,
        min_commande: minCommande,
      },
    }, { onSuccess: onClose })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Fiche boutique du produit" size="lg">
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-[#212121]">{produit.nom}</p>
          <p className="text-xs text-gray-400">{produit.ref} · {produit.categorie}</p>
        </div>
        <label className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
          <span>
            <span className="block text-sm font-semibold text-[#212121]">Visible dans le catalogue</span>
            <span className="block text-xs text-gray-400">Le produit reste pilote par le module Stocks.</span>
          </span>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="h-4 w-4 accent-[#C62828]"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Prix public</label>
            <input
              type="number"
              min="0"
              value={prix}
              onChange={(e) => setPrix(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Delai fabrication</label>
            <input
              type="number"
              min="0"
              value={delai}
              onChange={(e) => setDelai(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Min. commande</label>
            <input
              type="number"
              min="1"
              value={minCommande}
              onChange={(e) => setMinCommande(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Description boutique</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Images produit</label>
          <label className="mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-[#C62828] hover:text-[#C62828]">
            <Upload className="h-4 w-4" />
            {uploadImages.isPending ? 'Televersement en cours...' : 'Televerser depuis le PC'}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploadImages.isPending}
              onChange={(e) => {
                handleImageUpload(e.target.files)
                e.currentTarget.value = ''
              }}
              className="hidden"
            />
          </label>
          <textarea
            rows={3}
            value={images}
            onChange={(e) => setImages(e.target.value)}
            placeholder="https://.../image-1.jpg"
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
          {imageList.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {imageList.map((src, index) => (
                <div key={src} className="relative h-16 w-16 flex-shrink-0">
                  <img src={src} alt="" className="h-16 w-16 rounded-lg border border-gray-100 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageList(imageList.filter((_, i) => i !== index))}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-red-600 shadow-sm ring-1 ring-red-100"
                    title="Retirer cette image"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-gray-500">Tags</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="aluminium, portail, sur mesure"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            disabled={updateVitrine.isPending}
            onClick={handleSave}
          >
            {updateVitrine.isPending ? 'Mise a jour...' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── CommandeDetail ─────────────────────────────────────────────────────────────

function CommandeShopDetail({ commande, onClose }: { commande: CommandeShop; onClose: () => void }) {
  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Commande ${commande.ref}`} width="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Client</h3>
            <p className="text-sm font-semibold">{commande.client_nom}</p>
            <p className="text-xs text-gray-500">{commande.client_telephone}</p>
            {commande.client_email && <p className="text-xs text-gray-500">{commande.client_email}</p>}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Livraison</h3>
            <p className="text-sm">{commande.client_adresse}</p>
            {commande.client_ville && <p className="text-xs text-gray-500">{commande.client_ville}</p>}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Articles</h3>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#C62828' }}>
                <tr>
                  {['Désignation', 'Qté', 'P.U.', 'Total'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {commande.lignes.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-sm">{l.designation}</td>
                    <td className="px-3 py-2 text-sm text-center">{l.quantite}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatXAF(l.prix_unitaire)}</td>
                    <td className="px-3 py-2 text-sm font-semibold text-right">{formatXAF(l.total_ht)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bg-gray-50 px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-500"><span>Sous-total HT</span><span>{formatXAF(commande.montant_ht)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>TVA 19.25%</span><span>{formatXAF(commande.tva)}</span></div>
              {commande.frais_livraison > 0 && <div className="flex justify-between text-xs text-gray-500"><span>Frais livraison</span><span>{formatXAF(commande.frais_livraison)}</span></div>}
              <div className="flex justify-between text-sm font-bold text-[#212121]"><span>Total TTC</span><span>{formatXAF(commande.montant_ttc)}</span></div>
            </div>
          </div>
        </div>

        {commande.notes_client && (
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3">
            <p className="text-xs font-semibold text-yellow-700 mb-1">Note client</p>
            <p className="text-xs text-yellow-600">{commande.notes_client}</p>
          </div>
        )}

        <div className="pt-2 border-t border-gray-100">
          <Button className="w-full" variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Conditions de paiement (référentiel migration 0016) ───────────────────────

const CONDITIONS_PAIEMENT = [
  { code: 'P100',    libelle: 'Comptant intégral' },
  { code: 'P30-LIV', libelle: '30% commande + solde à livraison' },
  { code: 'P30-45',  libelle: '30% commande + crédit 45 jours' },
  { code: 'P30-60',  libelle: '30% commande + crédit 60 jours' },
  { code: 'PROJ-3T', libelle: '30% signature + 40% mi-chantier + 30% réception' },
  { code: 'PROJ-DG', libelle: 'Conditions spéciales — accord DG requis' },
]

// ── SlideOver traitement devis ─────────────────────────────────────────────────

function TraiterDevisSlideOver({
  devis,
  onClose,
  onSuccess,
}: {
  devis:     DevisWeb
  onClose:   () => void
  onSuccess: (erpNumero: string) => void
}) {
  const creerDevis = useCreerDevisErp()

  const today30 = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]
  const [montantHt,    setMontantHt]    = useState<string>('')
  const [dateValidite, setDateValidite] = useState<string>(today30)
  const [condCode,     setCondCode]     = useState<string>('P100')
  const [notes,        setNotes]        = useState<string>('')

  const TVA     = 0.1925
  const ht      = parseFloat(montantHt) || 0
  const tva     = Math.round(ht * TVA)
  const ttc     = ht + tva

  const handleSubmit = () => {
    creerDevis.mutate(
      {
        id:                       devis.id,
        montant_ht:               ht || undefined,
        date_validite:            dateValidite || undefined,
        condition_paiement_code:  condCode || undefined,
        notes_commerciales:       notes.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          onSuccess(res.data.numero)
          onClose()
        },
      },
    )
  }

  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Traiter la demande — ${devis.nom}`} width="lg">
      <div className="space-y-6">

        {/* ── Récapitulatif demande ───────────────────────────── */}
        <section className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Demande client</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Contact</p>
              <p className="font-semibold text-[#212121]">{devis.nom}</p>
              <p className="text-gray-500">{devis.telephone}</p>
              {devis.email && <p className="text-gray-400 text-xs">{devis.email}</p>}
            </div>
            {devis.type_projet && (
              <div>
                <p className="text-xs text-gray-400">Type de projet</p>
                <span className="inline-block text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full mt-0.5">
                  {devis.type_projet}
                </span>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Description</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{devis.description}</p>
          </div>
          {(devis as DevisWeb & { fichier_joint?: string }).fichier_joint && (
            <a
              href={(devis as DevisWeb & { fichier_joint?: string }).fichier_joint}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C62828] underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Voir le fichier joint
            </a>
          )}
          <p className="text-xs text-gray-400">Reçue le {formatDate(devis.created_at.split('T')[0])}</p>
        </section>

        {/* ── Formulaire devis ────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Paramètres du devis ERP</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">Montant estimé HT (FCFA)</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={montantHt}
                onChange={(e) => setMontantHt(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
              {ht > 0 && (
                <p className="mt-1 text-xs text-gray-400">
                  TVA 19.25% : {formatXAF(tva)} · TTC : <span className="font-semibold text-[#212121]">{formatXAF(ttc)}</span>
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">Date de validité</label>
              <input
                type="date"
                value={dateValidite}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDateValidite(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">Condition de paiement proposée</label>
            <select
              value={condCode}
              onChange={(e) => setCondCode(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              {CONDITIONS_PAIEMENT.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.libelle}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">Notes commerciales</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observations internes, conditions particulières…"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
        </section>

        {/* ── Actions ─────────────────────────────────────────── */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose} className="flex-1">Annuler</Button>
          <Button
            className="flex-1"
            disabled={creerDevis.isPending}
            onClick={handleSubmit}
          >
            <FileText className="h-4 w-4" />
            {creerDevis.isPending ? 'Création…' : 'Créer le devis ERP'}
          </Button>
        </div>

      </div>
    </SlideOver>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Boutique() {
  const navigate = useNavigate()
  const [tab, setTab]                     = useState<Tab>('catalogue')
  const [editProduit, setEditProduit]     = useState<ProduitShopErp | null>(null)
  const [selectedCommande, setSelectedCommande] = useState<CommandeShop | null>(null)
  const [selectedDevis, setSelectedDevis] = useState<DevisWeb | null>(null)
  const [filtreType, setFiltreType]       = useState<string>('')

  const { data: analytics }                   = useShopAnalytics()
  const { data: produits, isLoading: pLoad }  = useProduitsShop()
  const { data: shopData, isLoading: cLoad }  = useCommandesShop()
  const { data: devisData, isLoading: dLoad } = useDevisWeb()
  const toggleVis          = useToggleVisibilite()
  const changerStatutDevis = useChangerStatutDevisWeb()

  const kpis      = analytics?.kpis
  const produitsList = produits ?? []
  const commandes = shopData?.data ?? []
  const devisList = devisData ?? []
  const devisFiltres = filtreType
    ? devisList.filter((d: DevisWeb) => d.type_projet === filtreType)
    : devisList

  // ── Colonnes produits ──────────────────────────────────────────────────────

  const produitsCols: Column<ProduitShopErp>[] = [
    {
      id: 'nom', header: 'Produit', accessor: 'nom',
      render: (v, row) => (
        <div>
          <div className="text-sm font-semibold">{v as string}</div>
          <div className="text-xs text-gray-400">{row.categorie} · {row.ref}</div>
        </div>
      ),
    },
    { id: 'stock', header: 'Stock', accessor: 'stock_actuel',
      render: (v, row) => (
        <span className="text-sm font-semibold" style={{ color: (v as number) <= (row.stock_min as number) ? '#C62828' : '#15803d' }}>
          {v as number} {row.unite}
        </span>
      ),
    },
    { id: 'prix', header: 'Prix public', accessor: 'prix_public',
      render: (v) => <span className="text-sm font-semibold">{v ? formatXAF(v as number) : <span className="text-gray-300 italic text-xs">Non défini</span>}</span>,
    },
    { id: 'images', header: 'Images', accessor: 'images',
      render: (v) => (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Image className="h-3 w-3" /> {Array.isArray(v) ? v.length : 0}
        </span>
      ),
    },
    {
      id: 'visible', header: 'Visible', accessor: 'visible_shop',
      render: (v, row) => (
        <button
          onClick={() => toggleVis.mutate({ id: row.id, visible: !(v as boolean) })}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all"
          style={{
            backgroundColor: (v as boolean) ? '#dcfce7' : '#f3f4f6',
            color: (v as boolean) ? '#15803d' : '#6b7280',
            borderColor: (v as boolean) ? '#bbf7d0' : '#e5e7eb',
          }}
        >
          {(v as boolean) ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {(v as boolean) ? 'Visible' : 'Masqué'}
        </button>
      ),
    },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <button
          onClick={() => setEditProduit(row)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Edit2 className="h-3 w-3" /> Fiche
        </button>
      ),
    },
  ]

  // ── Colonnes commandes ─────────────────────────────────────────────────────

  const commandesCols: Column<CommandeShop>[] = [
    { id: 'ref', header: 'Réf.', accessor: 'ref', render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span> },
    { id: 'client', header: 'Client', accessor: 'client_nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'montant', header: 'Montant TTC', accessor: 'montant_ttc', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'mode', header: 'Paiement', accessor: 'mode_paiement', render: (v) => <span className="text-xs text-gray-500 capitalize">{(v as string).replace('_', ' ')}</span> },
    { id: 'statut_cmd', header: 'Commande', accessor: 'statut_commande', render: (v) => <StatusBadge status={v as string} /> },
    { id: 'statut_pay', header: 'Paiement', accessor: 'statut_paiement', render: (v) => <StatusBadge status={v as string} /> },
    { id: 'date', header: 'Date', accessor: 'created_at', render: (v) => <span className="text-xs text-gray-400">{formatDate((v as string).split('T')[0])}</span> },
  ]

  // ── Colonnes devis ─────────────────────────────────────────────────────────

  const STATUT_DEVIS_MAP: Record<string, { label: string; color: string; bg: string }> = {
    nouvelle: { label: 'Nouvelle',  color: '#C62828', bg: '#fee2e2' },
    en_cours: { label: 'En cours',  color: '#d97706', bg: '#fef3c7' },
    traitee:  { label: 'Traitée',   color: '#15803d', bg: '#dcfce7' },
    refusee:  { label: 'Refusée',   color: '#6b7280', bg: '#f3f4f6' },
  }

  const devisCols: Column<DevisWeb>[] = [
    { id: 'nom', header: 'Contact', accessor: 'nom', render: (v, row) => (
      <div>
        <div className="text-sm font-semibold">{v as string}</div>
        <div className="text-xs text-gray-400">{row.telephone}</div>
      </div>
    )},
    { id: 'type_projet', header: 'Type de projet', accessor: 'type_projet', render: (v) =>
      v
        ? <span className="inline-block max-w-[180px] truncate text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full" title={v as string}>{v as string}</span>
        : <span className="text-xs text-gray-300 italic">—</span>
    },
    { id: 'description', header: 'Demande', accessor: 'description', render: (v) => <span className="text-sm text-gray-600 line-clamp-2">{v as string}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => {
      const s = STATUT_DEVIS_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    }},
    { id: 'date', header: 'Date', accessor: 'created_at', render: (v) => <span className="text-xs text-gray-400">{formatDate((v as string).split('T')[0])}</span> },
    {
      id: 'traitement', header: 'Actions', accessor: 'id', sortable: false,
      render: (v, row) => (
        <div className="flex flex-wrap gap-1.5">
          {(row.erp_devis_id || row.statut === 'traitee') ? (
            <span className="flex items-center gap-1 text-xs text-[#15803d] font-medium">
              <CheckCircle className="h-3.5 w-3.5" /> Devis ERP créé
            </span>
          ) : (
            <>
              {(row.statut === 'nouvelle' || row.statut === 'en_cours') && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSelectedDevis(row)}
                >
                  <Clock className="h-3 w-3" /> Traiter
                </Button>
              )}
              {row.statut !== 'refusee' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={changerStatutDevis.isPending}
                  onClick={() => changerStatutDevis.mutate({ id: v as string, statut: 'refusee' })}
                >
                  <XCircle className="h-3 w-3" /> Refuser
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ]

  const TABS = [
    { id: 'catalogue' as Tab, label: 'Catalogue', icon: Package, count: produitsList.length },
    { id: 'commandes' as Tab, label: 'Commandes web', icon: ShoppingBag, count: commandes.length },
    { id: 'devis' as Tab, label: 'Demandes devis', icon: FileText, count: devisList.filter((d: DevisWeb) => d.statut === 'nouvelle').length, },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Boutique FORGE"
        subtitle="Vitrine web · Catalogue · Commandes en ligne"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Boutique' }]}
        actions={
          <a
            href={`${import.meta.env.VITE_SHOP_URL ?? 'http://localhost:3002'}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Store className="h-3.5 w-3.5" /> Voir la boutique
          </a>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Commandes aujourd'hui" value={kpis?.commandes_aujourd_hui ?? 0} icon={<ShoppingBag className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="CA du jour" value={formatXAF(kpis?.ca_aujourd_hui ?? 0)} icon={<TrendingUp className="h-5 w-5" />} color="#15803d" delay={0.07} />
        <KpiCard title="Commandes ce mois" value={kpis?.commandes_mois ?? 0} icon={<BarChart2 className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Panier moyen" value={formatXAF(kpis?.panier_moyen ?? 0)} icon={<Store className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors"
              style={{ color: tab === id ? '#C62828' : '#6b7280' }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {count > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold"
                  style={{ backgroundColor: tab === id ? '#C62828' : '#f3f4f6', color: tab === id ? '#fff' : '#374151' }}>
                  {count}
                </span>
              )}
              {tab === id && (
                <motion.div layoutId="boutique-tab" className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: '#C62828' }} />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === 'catalogue' && (
              <div>
                {produitsList.length === 0 && !pLoad && (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <Package className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                    Aucun produit dans la boutique.<br />
                    <span className="text-xs">Ajoutez des produits dans <strong>Stocks</strong> puis activez leur visibilité ici.</span>
                  </div>
                )}
                <DataTable<ProduitShopErp>
                  columns={produitsCols}
                  data={produitsList}
                  keyField="id"
                  loading={pLoad}
                />
              </div>
            )}

            {tab === 'commandes' && (
              <DataTable<CommandeShop>
                columns={commandesCols}
                data={commandes}
                keyField="id"
                loading={cLoad}
                onRowClick={setSelectedCommande}
              />
            )}

            {tab === 'devis' && (
              <>
                <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
                  <select
                    value={filtreType}
                    onChange={(e) => setFiltreType(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 outline-none focus:border-[#C62828] focus:ring-1 focus:ring-[#C62828]"
                  >
                    <option value="">Tous les types de projet</option>
                    {TYPES_PROJET_LABELS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {filtreType && (
                    <button
                      onClick={() => setFiltreType('')}
                      className="text-xs text-[#C62828] underline"
                    >
                      Effacer
                    </button>
                  )}
                  <span className="ml-auto text-xs text-gray-400">
                    {devisFiltres.length} demande{devisFiltres.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <DataTable<DevisWeb>
                  columns={devisCols}
                  data={devisFiltres}
                  keyField="id"
                  loading={dLoad}
                />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Modals */}
      <EditVitrineModal
        isOpen={!!editProduit}
        onClose={() => setEditProduit(null)}
        produit={editProduit}
      />

      {selectedCommande && (
        <CommandeShopDetail
          commande={selectedCommande}
          onClose={() => setSelectedCommande(null)}
        />
      )}

      {selectedDevis && (
        <TraiterDevisSlideOver
          devis={selectedDevis}
          onClose={() => setSelectedDevis(null)}
          onSuccess={(erpNumero) => {
            toast.success(`Devis ERP ${erpNumero} créé`, {
              action: {
                label: 'Voir le devis',
                onClick: () => navigate('/devis'),
              },
            })
          }}
        />
      )}
    </motion.div>
  )
}
