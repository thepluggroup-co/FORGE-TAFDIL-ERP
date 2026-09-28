import React, { useState } from 'react'
import { Percent, Ban } from 'lucide-react'
import { Modal, Button } from '@forge/ui'
import {
  useReglesMarge, useCreerRegleMarge, useDesactiverRegleMarge,
  type Famille, type Modele, type RegleMarge,
} from '@/hooks/useCatalogue'
import { formatDate } from '@/lib/utils'

/**
 * Taux de marge saisis par l'utilisateur (décision D4) — jamais codés en dur.
 * Priorité au calcul : modèle > famille la plus proche > global. Sans règle
 * applicable, le configurateur ne donne pas de prix automatique.
 * Enregistrer un nouveau taux pour une cible désactive l'ancien (historique conservé, audit).
 */
export function ReglesMargeModal({ isOpen, onClose, familles, modeles }: {
  isOpen: boolean; onClose: () => void; familles: Famille[]; modeles: Modele[]
}) {
  const { data: regles = [] } = useReglesMarge()
  const creer = useCreerRegleMarge()
  const desactiver = useDesactiverRegleMarge()
  const [portee, setPortee] = useState<RegleMarge['portee']>('global')
  const [cible, setCible] = useState('')
  const [taux, setTaux] = useState('')
  const [notes, setNotes] = useState('')

  const tauxValide = taux !== '' && Number(taux) >= 0 && Number(taux) <= 500
  const cibleRequise = portee !== 'global'

  const libelleCible = (r: RegleMarge) =>
    r.portee === 'global' ? 'Tous les produits'
      : r.portee === 'famille' ? `Famille : ${r.familles?.nom ?? r.famille_id}`
      : `Modèle : ${r.modeles ? `${r.modeles.reference} — ${r.modeles.designation}` : r.modele_id}`

  const enregistrer = () => {
    creer.mutate({
      portee,
      famille_id: portee === 'famille' ? cible : null,
      modele_id:  portee === 'modele' ? cible : null,
      taux_pct:   Number(taux),
      notes:      notes.trim() || undefined,
    }, { onSuccess: () => { setTaux(''); setNotes('') } })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Taux de marge" size="lg">
      <div className="space-y-5">
        <p className="text-xs text-gray-500">
          Prix de vente = coût de revient × (1 + taux). Priorité : modèle, puis famille la plus proche, puis taux global.
        </p>

        <div className="grid grid-cols-12 gap-2 rounded-xl border border-gray-100 p-3">
          <select value={portee} onChange={(e) => { setPortee(e.target.value as RegleMarge['portee']); setCible('') }}
            className="col-span-3 rounded-lg border border-gray-200 px-2.5 py-2 text-xs">
            <option value="global">Global</option>
            <option value="famille">Famille</option>
            <option value="modele">Modèle</option>
          </select>
          <select value={cible} onChange={(e) => setCible(e.target.value)} disabled={!cibleRequise}
            className="col-span-5 rounded-lg border border-gray-200 px-2.5 py-2 text-xs disabled:bg-gray-50">
            <option value="">{cibleRequise ? 'Choisir…' : 'Tous les produits'}</option>
            {portee === 'famille' && familles.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            {portee === 'modele' && modeles.map((m) => <option key={m.id} value={m.id}>{m.reference} — {m.designation}</option>)}
          </select>
          <div className="col-span-2 flex items-center gap-1">
            <input type="number" min={0} max={500} step={0.5} value={taux} onChange={(e) => setTaux(e.target.value)}
              placeholder="taux" className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-xs" />
            <Percent className="h-3.5 w-3.5 text-gray-400" />
          </div>
          <Button size="sm" className="col-span-2" loading={creer.isPending}
            disabled={!tauxValide || (cibleRequise && !cible)} onClick={enregistrer}>
            Enregistrer
          </Button>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motif (optionnel)"
            className="col-span-12 rounded-lg border border-gray-200 px-2.5 py-2 text-xs" />
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {regles.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-400">
              Aucun taux défini : le configurateur ne calcule pas encore de prix automatique.
            </p>
          )}
          {regles.map((r) => (
            <div key={r.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${r.actif ? 'bg-gray-50' : 'opacity-50'}`}>
              <div>
                <span className="font-semibold text-[#212121]">{libelleCible(r)}</span>
                <span className="ml-2 font-bold text-[#C62828]">{Number(r.taux_pct)} %</span>
                {r.notes && <span className="ml-2 text-gray-500">— {r.notes}</span>}
                <span className="ml-2 text-gray-400">{formatDate(r.created_at)}{r.actif ? '' : ' · remplacée'}</span>
              </div>
              {r.actif && (
                <button onClick={() => desactiver.mutate(r.id)} title="Désactiver" className="rounded p-1 text-red-500 hover:bg-red-50">
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
