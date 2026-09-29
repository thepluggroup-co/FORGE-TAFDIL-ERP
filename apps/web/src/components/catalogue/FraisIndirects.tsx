import React, { useState } from 'react'
import { Ban } from 'lucide-react'
import { Modal, Button } from '@forge/ui'
import {
  useFraisIndirects, useCreerFraisIndirects, useDesactiverFraisIndirects,
  type Famille, type Modele, type FraisIndirects, type FraisIndirectsPayload,
} from '@/hooks/useCatalogue'
import { formatXAF } from '@/lib/utils'

/**
 * Frais indirects paramétrables (Catalogue Hybride Phase 4, §19) — jamais codés en dur.
 *
 * Contrairement au taux de marge, TOUTES les règles applicables s'additionnent
 * au coût de revient : globales, de la famille (et de ses familles parentes) et
 * du modèle, dans leur période de validité.
 */

const LIBELLE_MODE: Record<FraisIndirects['mode'], string> = {
  pourcentage:       '% d’une assiette',
  fixe_par_unite:    'FCFA par unité',
  fixe_par_commande: 'FCFA par commande',
}

const LIBELLE_BASE: Record<NonNullable<FraisIndirects['base']>, string> = {
  cout_direct: 'coût direct',
  main_oeuvre: 'main-d’œuvre',
  materiaux:   'matières + consommables',
}

const CHAMP = 'rounded-lg border border-gray-200 px-2.5 py-2 text-xs'

const VIDE: FraisIndirectsPayload = {
  libelle: '', centre_cout: null, mode: 'pourcentage', valeur: 0, base: 'cout_direct',
  portee: 'global', famille_id: null, modele_id: null, date_debut: null, date_fin: null, notes: null,
}

export function FraisIndirectsModal({ isOpen, onClose, familles, modeles }: {
  isOpen: boolean; onClose: () => void; familles: Famille[]; modeles: Modele[]
}) {
  const { data: frais = [] } = useFraisIndirects()
  const creer = useCreerFraisIndirects()
  const desactiver = useDesactiverFraisIndirects()
  const [form, setForm] = useState<FraisIndirectsPayload>(VIDE)
  const maj = (patch: Partial<FraisIndirectsPayload>) => setForm((f) => ({ ...f, ...patch }))

  const valide = form.libelle.trim().length > 0 && form.valeur >= 0
    && (form.mode !== 'pourcentage' || (form.base !== null && form.valeur <= 200))
    && (form.portee !== 'famille' || !!form.famille_id)
    && (form.portee !== 'modele' || !!form.modele_id)

  const valeurLisible = (f: FraisIndirects) => f.mode === 'pourcentage'
    ? `${Number(f.valeur)} % du ${LIBELLE_BASE[f.base ?? 'cout_direct']}`
    : `${formatXAF(Number(f.valeur))} ${f.mode === 'fixe_par_unite' ? 'par unité' : 'par commande'}`

  const cible = (f: FraisIndirects) => f.portee === 'global' ? 'Tous les produits'
    : f.portee === 'famille' ? `Famille : ${f.familles?.nom ?? f.famille_id}`
    : `Modèle : ${f.modeles ? `${f.modeles.reference}` : f.modele_id}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Frais indirects" size="lg">
      <div className="space-y-5">
        <p className="text-xs text-gray-500">
          Ajoutés au coût de revient avant la marge. Toutes les règles applicables se cumulent
          (globales, famille et familles parentes, modèle), dans leur période de validité.
        </p>

        <div className="grid grid-cols-12 gap-2 rounded-xl border border-gray-100 p-3">
          <input className={`${CHAMP} col-span-5`} placeholder="Libellé * (ex. Frais atelier)" value={form.libelle} onChange={(e) => maj({ libelle: e.target.value })} />
          <input className={`${CHAMP} col-span-3`} placeholder="Centre de coût" value={form.centre_cout ?? ''} onChange={(e) => maj({ centre_cout: e.target.value || null })} />
          <select className={`${CHAMP} col-span-4`} value={form.mode}
            onChange={(e) => maj({ mode: e.target.value as FraisIndirects['mode'], base: e.target.value === 'pourcentage' ? (form.base ?? 'cout_direct') : null })}>
            {Object.entries(LIBELLE_MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>

          <input className={`${CHAMP} col-span-3`} type="number" min={0} step={form.mode === 'pourcentage' ? 0.5 : 1}
            placeholder={form.mode === 'pourcentage' ? 'taux %' : 'montant FCFA'} value={form.valeur || ''}
            onChange={(e) => maj({ valeur: Number(e.target.value) || 0 })} />
          <select className={`${CHAMP} col-span-4`} value={form.base ?? ''} disabled={form.mode !== 'pourcentage'}
            onChange={(e) => maj({ base: e.target.value as FraisIndirects['base'] })}>
            {form.mode !== 'pourcentage' && <option value="">—</option>}
            {Object.entries(LIBELLE_BASE).map(([k, v]) => <option key={k} value={k}>de : {v}</option>)}
          </select>
          <select className={`${CHAMP} col-span-2`} value={form.portee}
            onChange={(e) => maj({ portee: e.target.value as FraisIndirects['portee'], famille_id: null, modele_id: null })}>
            <option value="global">Global</option>
            <option value="famille">Famille</option>
            <option value="modele">Modèle</option>
          </select>
          <select className={`${CHAMP} col-span-3`} disabled={form.portee === 'global'}
            value={(form.portee === 'famille' ? form.famille_id : form.modele_id) ?? ''}
            onChange={(e) => maj(form.portee === 'famille' ? { famille_id: e.target.value || null } : { modele_id: e.target.value || null })}>
            <option value="">{form.portee === 'global' ? 'Tous' : 'Choisir…'}</option>
            {form.portee === 'famille' && familles.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            {form.portee === 'modele' && modeles.map((m) => <option key={m.id} value={m.id}>{m.reference} — {m.designation}</option>)}
          </select>

          <label className="col-span-4 text-[11px] text-gray-500">Du
            <input className={`${CHAMP} w-full`} type="date" value={form.date_debut ?? ''} onChange={(e) => maj({ date_debut: e.target.value || null })} />
          </label>
          <label className="col-span-4 text-[11px] text-gray-500">Au
            <input className={`${CHAMP} w-full`} type="date" value={form.date_fin ?? ''} onChange={(e) => maj({ date_fin: e.target.value || null })} />
          </label>
          <div className="col-span-4 flex items-end">
            <Button size="sm" className="w-full" disabled={!valide} loading={creer.isPending}
              onClick={() => creer.mutate({ ...form, libelle: form.libelle.trim() }, { onSuccess: () => setForm(VIDE) })}>
              Enregistrer
            </Button>
          </div>
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {frais.length === 0 && <p className="py-4 text-center text-xs text-gray-400">Aucun frais indirect : le coût de revient ne comprend que les coûts directs.</p>}
          {frais.map((f) => (
            <div key={f.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${f.actif ? 'bg-gray-50' : 'opacity-50'}`}>
              <div>
                <span className="font-semibold text-[#212121]">{f.libelle}</span>
                {f.centre_cout && <span className="ml-1 text-gray-400">[{f.centre_cout}]</span>}
                <span className="ml-2 font-bold text-[#C62828]">{valeurLisible(f)}</span>
                <span className="ml-2 text-gray-500">{cible(f)}</span>
                {(f.date_debut || f.date_fin) && <span className="ml-2 text-gray-400">{f.date_debut ?? '…'} → {f.date_fin ?? '…'}</span>}
                {!f.actif && <span className="ml-2 text-gray-400">· désactivé</span>}
              </div>
              {f.actif && (
                <button onClick={() => desactiver.mutate(f.id)} title="Désactiver" className="rounded p-1 text-red-500 hover:bg-red-50">
                  <Ban className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
