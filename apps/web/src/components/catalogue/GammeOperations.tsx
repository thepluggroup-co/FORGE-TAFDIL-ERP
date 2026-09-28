import React, { useState } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Button, Modal } from '@forge/ui'
import {
  useGammeOperations, useAjouterOperation, useSupprimerOperation,
  usePostesTravail, useEnregistrerPosteTravail,
  type OperationPayload, type PosteTravail,
} from '@/hooks/useCatalogue'
import { useEquipements } from '@/hooks/useEquipements'
import { formatXAF } from '@/lib/utils'

/**
 * Gamme opératoire d'une fiche technique (Catalogue Hybride Phase 5, §21).
 *
 * Chaque opération (10 Découpe, 20 Soudage…) mobilise un poste de travail et/ou
 * un équipement. Son coût = temps × coût horaire, avec temps = temps unitaire ×
 * quantité facturable + temps de préparation (une fois par commande). Il
 * s'ajoute aux ressources de la fiche : ne pas y saisir aussi la même
 * main-d'œuvre, elle serait comptée deux fois.
 */

const CHAMP = 'rounded-lg border border-gray-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#C62828]'

const VIDE: OperationPayload = { numero: 10, libelle: '', poste_id: null, equipement_id: null, temps_unitaire_h: 0, temps_fixe_h: 0 }

export function GammeOperations({ ficheTechniqueId, uniteFacturation }: { ficheTechniqueId: string; uniteFacturation?: string }) {
  const { data: operations = [] } = useGammeOperations(ficheTechniqueId)
  const { data: postes = [] } = usePostesTravail()
  const { data: equipements = [] } = useEquipements()
  const ajouter = useAjouterOperation()
  const supprimer = useSupprimerOperation()
  const [form, setForm] = useState<OperationPayload>(VIDE)
  const [postesOuverts, setPostesOuverts] = useState(false)

  const prochainNumero = (operations.at(-1)?.numero ?? 0) + 10
  const valide = form.numero > 0 && form.libelle.trim() !== '' && (form.poste_id || form.equipement_id)
    && (form.temps_unitaire_h > 0 || form.temps_fixe_h > 0)
  const unite = uniteFacturation ?? 'unité'

  const tauxManquant = (o: typeof operations[number]) =>
    (o.poste_id && o.postes_travail?.cout_horaire_xaf == null) || (o.equipement_id && o.equipements?.cout_horaire_xaf == null)

  return (
    <div className="space-y-2 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gamme opératoire</h3>
        <button onClick={() => setPostesOuverts(true)} className="text-[11px] font-semibold text-[#C62828]">Postes & taux horaires</button>
      </div>

      {operations.length === 0 && (
        <p className="py-2 text-center text-[11px] text-gray-400">Aucune opération : la main-d'œuvre et les machines viennent des seules ressources ci-dessus.</p>
      )}
      {operations.map((o) => (
        <div key={o.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs">
          <span className="w-8 font-mono font-bold text-gray-500">{o.numero}</span>
          <span className="flex-1 truncate font-medium text-[#212121]">{o.libelle}</span>
          <span className="w-40 truncate text-gray-500">
            {[o.postes_travail?.libelle, o.equipements?.designation].filter(Boolean).join(' + ')}
          </span>
          <span className="w-44 text-right text-gray-500">
            {o.temps_unitaire_h} h/{unite}{o.temps_fixe_h > 0 ? ` + ${o.temps_fixe_h} h prépa` : ''}
          </span>
          {tauxManquant(o) && (
            <span title="Coût horaire manquant : aucun prix automatique tant qu'il n'est pas renseigné"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>
          )}
          <button onClick={() => supprimer.mutate({ id: o.id, ficheTechniqueId })} className="rounded p-1 text-red-500 hover:bg-red-50" title="Supprimer">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="grid grid-cols-12 gap-2 rounded-lg bg-gray-50 p-2.5">
        <input className={`${CHAMP} col-span-2`} type="number" min={1} step={10} value={form.numero || prochainNumero}
          onChange={(e) => setForm((f) => ({ ...f, numero: Number(e.target.value) || 0 }))} title="N° d'opération" />
        <input className={`${CHAMP} col-span-4`} placeholder="Opération * (ex. Soudage)" value={form.libelle}
          onChange={(e) => setForm((f) => ({ ...f, libelle: e.target.value }))} />
        <select className={`${CHAMP} col-span-3`} value={form.poste_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, poste_id: e.target.value || null }))}>
          <option value="">Poste…</option>
          {postes.filter((p) => p.actif).map((p) => <option key={p.id} value={p.id}>{p.libelle} ({formatXAF(p.cout_horaire_xaf)}/h)</option>)}
        </select>
        <select className={`${CHAMP} col-span-3`} value={form.equipement_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, equipement_id: e.target.value || null }))}>
          <option value="">Équipement…</option>
          {equipements.map((e) => (
            <option key={e.id} value={e.id}>{e.code} — {e.designation}{e.cout_horaire_xaf == null ? ' (taux ?)' : ''}</option>
          ))}
        </select>
        <label className="col-span-4 text-[11px] text-gray-500">Temps (h) par {unite}
          <input className={`${CHAMP} w-full`} type="number" min={0} step={0.05} value={form.temps_unitaire_h || ''}
            onChange={(e) => setForm((f) => ({ ...f, temps_unitaire_h: Number(e.target.value) || 0 }))} />
        </label>
        <label className="col-span-4 text-[11px] text-gray-500">Préparation (h) par commande
          <input className={`${CHAMP} w-full`} type="number" min={0} step={0.25} value={form.temps_fixe_h || ''}
            onChange={(e) => setForm((f) => ({ ...f, temps_fixe_h: Number(e.target.value) || 0 }))} />
        </label>
        <div className="col-span-4 flex items-end">
          <Button size="sm" className="w-full" disabled={!valide} loading={ajouter.isPending}
            onClick={() => ajouter.mutate(
              { ficheTechniqueId, payload: { ...form, numero: form.numero || prochainNumero, libelle: form.libelle.trim() } },
              { onSuccess: () => setForm({ ...VIDE, numero: 0 }) },
            )}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
      </div>

      <PostesTravailModal isOpen={postesOuverts} onClose={() => setPostesOuverts(false)} postes={postes} />
    </div>
  )
}

/** Postes de travail et leur coût horaire (tout changement de taux est tracé côté serveur). */
function PostesTravailModal({ isOpen, onClose, postes }: { isOpen: boolean; onClose: () => void; postes: PosteTravail[] }) {
  const enregistrer = useEnregistrerPosteTravail()
  const [code, setCode] = useState('')
  const [libelle, setLibelle] = useState('')
  const [taux, setTaux] = useState('')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Postes de travail et taux horaires" size="md">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">Le coût horaire d'un poste chiffre les opérations de gamme qui l'utilisent. Le coût horaire des machines se saisit sur chaque équipement.</p>
        <div className="space-y-1.5">
          {postes.length === 0 && <p className="py-3 text-center text-xs text-gray-400">Aucun poste.</p>}
          {postes.map((p) => (
            <div key={p.id} className={`flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs ${p.actif ? '' : 'opacity-50'}`}>
              <span className="w-20 font-mono text-gray-500">{p.code}</span>
              <span className="flex-1 font-medium text-[#212121]">{p.libelle}</span>
              <input
                type="number" min={0} step={50} defaultValue={p.cout_horaire_xaf}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (e.target.value !== '' && v >= 0 && v !== Number(p.cout_horaire_xaf)) enregistrer.mutate({ id: p.id, payload: { cout_horaire_xaf: v } })
                }}
                className="w-24 rounded border border-gray-200 bg-white px-1.5 py-1 text-right" title="Coût horaire (FCFA)"
              />
              <span className="text-gray-400">/h</span>
              <button onClick={() => enregistrer.mutate({ id: p.id, payload: { actif: !p.actif } })} className="text-[11px] text-gray-500 hover:text-[#C62828]">
                {p.actif ? 'Désactiver' : 'Réactiver'}
              </button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-12 gap-2 border-t border-gray-100 pt-3">
          <input className={`${CHAMP} col-span-3`} placeholder="Code (SOUD)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <input className={`${CHAMP} col-span-4`} placeholder="Libellé (Soudeur)" value={libelle} onChange={(e) => setLibelle(e.target.value)} />
          <input className={`${CHAMP} col-span-3`} type="number" min={0} placeholder="FCFA / h" value={taux} onChange={(e) => setTaux(e.target.value)} />
          <Button size="sm" className="col-span-2" disabled={!code || !libelle || taux === ''} loading={enregistrer.isPending}
            onClick={() => enregistrer.mutate(
              { payload: { code, libelle, cout_horaire_xaf: Number(taux) } },
              { onSuccess: () => { setCode(''); setLibelle(''); setTaux('') } },
            )}>
            Ajouter
          </Button>
        </div>
      </div>
    </Modal>
  )
}
