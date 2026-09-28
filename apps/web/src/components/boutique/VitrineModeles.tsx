import React, { useRef, useState } from 'react'
import { Factory, ImagePlus, X } from 'lucide-react'
import { Button, EmptyState } from '@forge/ui'
import {
  useModelesShop, useUpdateVitrineModele, useUploadImagesModele,
  type ModeleShopErp, type VitrineModelePayload,
} from '@/hooks/useProduitsShop'
import { formatXAF } from '@/lib/utils'

/**
 * Vitrine web des produits finis STANDARD (Catalogue Hybride Phase 2).
 *
 * Seuls les modèles dont le mode commercial effectif est STANDARD sont listés
 * (filtre serveur). Le prix saisi ici est le prix de VENTE public HT ; le
 * serveur refuse une mise en vente sans prix et trace chaque changement de prix.
 */
export function VitrineModeles() {
  const { data: modeles = [], isLoading, error } = useModelesShop()

  if (isLoading) {
    return <p className="p-6 text-sm text-gray-500">Chargement des produits finis…</p>
  }

  // Ne jamais afficher « aucun produit » quand l'API a échoué : c'est typiquement
  // le cas d'une API déployée sans les routes /shop-erp/modeles (version antérieure).
  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        Impossible de charger les produits finis : {(error as Error).message}.
        Vérifiez que l'API déployée contient la vitrine des produits finis (Catalogue Hybride Phase 2).
      </div>
    )
  }

  if (modeles.length === 0) {
    return (
      <EmptyState
        icon={<Factory className="h-8 w-8" />}
        title="Aucun produit fini standard"
        description="Passez un modèle en mode « Standard » dans le Catalogue pour pouvoir le vendre en ligne."
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Modèle</th>
            <th className="px-4 py-3">Images</th>
            <th className="px-4 py-3">Famille</th>
            <th className="px-4 py-3">Prix public HT (FCFA)</th>
            <th className="px-4 py-3">Délai (jours)</th>
            <th className="px-4 py-3">Min.</th>
            <th className="px-4 py-3">En ligne</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {modeles.map((m) => <LigneModele key={m.id} modele={m} />)}
        </tbody>
      </table>
    </div>
  )
}

function LigneModele({ modele }: { modele: ModeleShopErp }) {
  const update = useUpdateVitrineModele()
  const v = modele.vitrine
  const [prix, setPrix]       = useState(String(v?.prix_public ?? ''))
  const [delai, setDelai]     = useState(String(v?.delai_fabrication_jours ?? ''))
  const [min, setMin]         = useState(String(v?.min_commande ?? 1))
  const [visible, setVisible] = useState(v?.visible_shop ?? false)

  const prixNombre = Number(prix)
  const prixValide = prix !== '' && Number.isInteger(prixNombre) && prixNombre >= 0

  const enregistrer = () => {
    const payload: VitrineModelePayload = {
      visible_shop:            visible,
      min_commande:            Math.max(1, Number(min) || 1),
      delai_fabrication_jours: delai === '' ? null : Math.max(0, Number(delai) || 0),
    }
    if (prixValide) payload.prix_public = prixNombre
    update.mutate({ id: modele.id, payload })
  }

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3">
        <p className="font-semibold text-[#212121]">{modele.designation}</p>
        <p className="text-xs text-gray-400">{modele.reference} · {modele.unite_facturation ?? 'unite'}</p>
      </td>
      <td className="px-4 py-3">
        <ImagesModele modeleId={modele.id} images={v?.images ?? []} />
      </td>
      <td className="px-4 py-3 text-gray-600">{modele.famille ?? '—'}</td>
      <td className="px-4 py-3">
        <input
          type="number" min={0} step={1} value={prix} onChange={(e) => setPrix(e.target.value)}
          className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-right"
          aria-label={`Prix public de ${modele.designation}`}
        />
        {v?.prix_public ? <p className="mt-1 text-[11px] text-gray-400">Actuel : {formatXAF(v.prix_public)}</p> : null}
      </td>
      <td className="px-4 py-3">
        <input
          type="number" min={0} step={1} value={delai} onChange={(e) => setDelai(e.target.value)}
          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right"
          aria-label={`Délai de fabrication de ${modele.designation}`}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number" min={1} step={1} value={min} onChange={(e) => setMin(e.target.value)}
          className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-right"
          aria-label={`Quantité minimale de ${modele.designation}`}
        />
      </td>
      <td className="px-4 py-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          {visible ? 'Visible' : 'Masqué'}
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" onClick={enregistrer} loading={update.isPending} disabled={visible && !prixValide}>
          Enregistrer
        </Button>
      </td>
    </tr>
  )
}

/** Miniatures + ajout (vérifié côté serveur par signature de fichier) et retrait d'images. */
function ImagesModele({ modeleId, images }: { modeleId: string; images: string[] }) {
  const upload = useUploadImagesModele()
  const update = useUpdateVitrineModele()
  const inputRef = useRef<HTMLInputElement>(null)

  const retirer = (url: string) => {
    update.mutate({ id: modeleId, payload: { images: images.filter((i) => i !== url) } })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {images.map((url) => (
        <div key={url} className="group relative h-10 w-10 overflow-hidden rounded-md border border-gray-100">
          <img src={url} alt="" className="h-full w-full object-cover" />
          <button
            type="button" onClick={() => retirer(url)} title="Retirer l'image"
            className="absolute right-0 top-0 hidden rounded-bl bg-black/60 p-0.5 text-white group-hover:block"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {images.length < 12 && (
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={upload.isPending}
          title="Ajouter des images (JPG, PNG, WEBP, HEIC — 5 Mo max)"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-400 hover:border-[#C62828] hover:text-[#C62828] disabled:opacity-40"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
      )}
      <input
        ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) upload.mutate({ id: modeleId, files })
          e.target.value = ''
        }}
      />
    </div>
  )
}
