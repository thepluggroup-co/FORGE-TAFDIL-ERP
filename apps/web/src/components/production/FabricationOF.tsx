// FORGE — Fabrication d'un OF (Catalogue Hybride Phase 7)
//
// Étapes reprises de la gamme (poste, équipement, temps prévu), saisie du temps
// réel et du technicien par étape, consommations prévues / réelles de matières.

import React, { useState } from 'react'
import { Play, CheckCircle2, SkipForward, RotateCcw, Layers, Plus } from 'lucide-react'
import { SlideOver, Button } from '@forge/ui'
import { toast } from 'sonner'
import { LIBELLES_STATUT_OPERATION, type StatutOperationOF } from '@forge/shared'
import {
  useFabricationOF, useChargerGammeOF, useMajOperationOF, useSaisirConsommationOF, useAjouterConsommationOF,
  type OperationOF, type ConsommationOF,
} from '@/hooks/useFabricationOF'
import { useTechniciens } from '@/hooks/useEquipements'
import { useModeles } from '@/hooks/useCatalogue'

const inputCls = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]'
const OF_CLOS = ['delivered', 'cancelled']

const COULEURS: Record<StatutOperationOF, string> = {
  a_faire:  'bg-gray-100 text-gray-600',
  en_cours: 'bg-amber-100 text-amber-700',
  terminee: 'bg-green-100 text-green-700',
  sautee:   'bg-gray-100 text-gray-400 line-through',
}

const h = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`)
const q = (v: number | null | undefined, unite: string) => (v == null ? '—' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${unite}`)

// ── Chargement de la gamme ────────────────────────────────────────────────────

function ChargerGamme({ jobId, depuisCommande }: { jobId: string; depuisCommande: boolean }) {
  const charger = useChargerGammeOF(jobId)
  const { data: modelesData } = useModeles({ actif: true })
  const [modeleId, setModeleId] = useState('')
  const [quantite, setQuantite] = useState('')

  const chargerModele = () => {
    const qf = Number(quantite)
    if (!modeleId) { toast.error('Choisissez un modèle'); return }
    if (!(qf > 0)) { toast.error('Quantité facturable invalide'); return }
    charger.mutate({ modele_id: modeleId, quantite_facturable: qf })
  }

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4">
      <p className="text-sm text-gray-600">
        Cet OF n'a pas encore d'étapes. Chargez la gamme de la fiche technique : étapes, temps prévus et matières.
      </p>
      {depuisCommande && (
        <Button size="sm" variant="secondary" disabled={charger.isPending} onClick={() => charger.mutate({})}>
          <Layers className="h-3.5 w-3.5" /> Depuis le devis de la commande
        </Button>
      )}
      <div className="grid grid-cols-3 gap-2">
        <select className={`${inputCls} col-span-2 bg-white`} value={modeleId} onChange={(e) => setModeleId(e.target.value)}>
          <option value="">Modèle (fiche active)…</option>
          {(modelesData?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.reference} — {m.designation}</option>)}
        </select>
        <input className={inputCls} type="number" min="0" step="any" placeholder="Qté facturable" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
      </div>
      <Button size="sm" disabled={charger.isPending} onClick={chargerModele}>
        {charger.isPending ? 'Chargement…' : 'Charger la gamme du modèle'}
      </Button>
    </section>
  )
}

// ── Une étape ─────────────────────────────────────────────────────────────────

function LigneOperation({ jobId, op, ouvert }: { jobId: string; op: OperationOF; ouvert: boolean }) {
  const maj = useMajOperationOF(jobId)
  const { data: techniciens = [] } = useTechniciens()
  const [temps, setTemps] = useState(op.temps_reel_h != null ? String(op.temps_reel_h) : '')

  const changer = (statut: StatutOperationOF) => {
    const t = temps.trim() ? Number(temps) : undefined
    if (statut === 'terminee' && !(Number(t) > 0)) { toast.error('Saisissez le temps réellement passé'); return }
    maj.mutate({ opId: op.id, statut, temps_reel_h: t })
  }
  const ecart = op.temps_reel_h != null && op.temps_prevu_h > 0 ? op.temps_reel_h - op.temps_prevu_h : null

  return (
    <li className="space-y-2 rounded-lg border border-gray-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">{op.numero} — {op.libelle}</p>
          <p className="text-xs text-gray-400">
            {[op.poste_libelle, op.equipement_designation].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${COULEURS[op.statut]}`}>{LIBELLES_STATUT_OPERATION[op.statut]}</span>
      </div>

      <div className="grid grid-cols-3 items-center gap-2 text-xs">
        <div>
          <p className="text-gray-400">Prévu</p>
          <p className="font-semibold text-gray-700">{h(op.temps_prevu_h)}</p>
        </div>
        <div>
          <p className="text-gray-400">Réel (h)</p>
          {ouvert && op.statut !== 'sautee'
            ? <input className={inputCls} type="number" min="0" step="0.25" value={temps} onChange={(e) => setTemps(e.target.value)}
                onBlur={() => { if (temps.trim() && Number(temps) !== op.temps_reel_h) maj.mutate({ opId: op.id, temps_reel_h: Number(temps) }) }} />
            : <p className="font-semibold text-gray-700">{h(op.temps_reel_h)}</p>}
        </div>
        <div>
          <p className="text-gray-400">Écart</p>
          <p className={`font-semibold ${ecart == null ? 'text-gray-300' : ecart > 0 ? 'text-red-600' : 'text-green-700'}`}>
            {ecart == null ? '—' : `${ecart > 0 ? '+' : ''}${h(ecart)}`}
          </p>
        </div>
      </div>

      {ouvert && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputCls} max-w-[200px] bg-white`} value={op.technicien_id ?? ''}
            onChange={(e) => maj.mutate({ opId: op.id, technicien_id: e.target.value || null })}
          >
            <option value="">Technicien…</option>
            {techniciens.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
          {op.transitions_possibles.includes('en_cours') && (
            <Button size="sm" variant="secondary" disabled={maj.isPending} onClick={() => changer('en_cours')}>
              {op.statut === 'terminee' ? <><RotateCcw className="h-3 w-3" /> Rouvrir</> : <><Play className="h-3 w-3" /> Démarrer</>}
            </Button>
          )}
          {op.transitions_possibles.includes('terminee') && (
            <Button size="sm" disabled={maj.isPending} onClick={() => changer('terminee')}>
              <CheckCircle2 className="h-3 w-3" /> Terminer
            </Button>
          )}
          {op.transitions_possibles.includes('sautee') && (
            <Button size="sm" variant="ghost" disabled={maj.isPending} onClick={() => changer('sautee')}>
              <SkipForward className="h-3 w-3" /> Sauter
            </Button>
          )}
          {op.transitions_possibles.includes('a_faire') && (
            <Button size="sm" variant="ghost" disabled={maj.isPending} onClick={() => changer('a_faire')}>
              Remettre à faire
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

// ── Une consommation ──────────────────────────────────────────────────────────

function LigneConsommation({ jobId, conso, ouvert }: { jobId: string; conso: ConsommationOF; ouvert: boolean }) {
  const saisir = useSaisirConsommationOF(jobId)
  const [reel, setReel] = useState(conso.quantite_reelle != null ? String(conso.quantite_reelle) : '')
  const [sortir, setSortir] = useState(!!conso.produit_id)

  const enregistrer = () => {
    const v = Number(reel)
    if (!reel.trim() || !(v >= 0)) { toast.error('Quantité invalide'); return }
    saisir.mutate({ cId: conso.id, quantite_reelle: v, sortir_stock: sortir && !!conso.produit_id })
  }
  const ecart = conso.quantite_reelle != null ? conso.quantite_reelle - conso.quantite_prevue : null

  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="py-2 pr-2">
        <p className="text-sm text-gray-800">{conso.designation}</p>
        <p className="text-xs text-gray-400">
          {conso.type === 'consommable' ? 'Consommable' : 'Matière'}
          {conso.quantite_prevue === 0 ? ' · imprévue' : ''}
          {conso.quantite_sortie_stock > 0 ? ` · déstocké ${q(conso.quantite_sortie_stock, conso.unite)}` : ''}
        </p>
      </td>
      <td className="py-2 pr-2 text-sm text-gray-600">{q(conso.quantite_prevue, conso.unite)}</td>
      <td className="py-2 pr-2">
        {ouvert ? (
          <div className="space-y-1">
            <input className={inputCls} type="number" min="0" step="any" value={reel} onChange={(e) => setReel(e.target.value)} />
            {conso.produit_id && (
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <input type="checkbox" checked={sortir} onChange={(e) => setSortir(e.target.checked)} /> sortir du stock
              </label>
            )}
          </div>
        ) : <span className="text-sm text-gray-700">{q(conso.quantite_reelle, conso.unite)}</span>}
      </td>
      <td className={`py-2 pr-2 text-sm font-semibold ${ecart == null ? 'text-gray-300' : ecart > 0 ? 'text-red-600' : 'text-green-700'}`}>
        {ecart == null ? '—' : `${ecart > 0 ? '+' : ''}${q(ecart, conso.unite)}`}
      </td>
      <td className="py-2">
        {ouvert && <Button size="sm" variant="ghost" disabled={saisir.isPending} onClick={enregistrer}>OK</Button>}
      </td>
    </tr>
  )
}

function AjoutConsommation({ jobId }: { jobId: string }) {
  const ajouter = useAjouterConsommationOF(jobId)
  const [f, setF] = useState({ type: 'materiau' as 'materiau' | 'consommable', designation: '', unite: '', quantite: '' })
  const valider = () => {
    const v = Number(f.quantite)
    if (!f.designation.trim() || !f.unite.trim() || !(v > 0)) { toast.error('Désignation, unité et quantité requises'); return }
    ajouter.mutate(
      { type: f.type, designation: f.designation.trim(), unite: f.unite.trim(), quantite_reelle: v },
      { onSuccess: () => setF({ type: 'materiau', designation: '', unite: '', quantite: '' }) },
    )
  }
  return (
    <div className="grid grid-cols-12 gap-2 pt-2">
      <select className={`${inputCls} col-span-3 bg-white`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'materiau' | 'consommable' })}>
        <option value="materiau">Matière</option>
        <option value="consommable">Consommable</option>
      </select>
      <input className={`${inputCls} col-span-4`} placeholder="Désignation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
      <input className={`${inputCls} col-span-2`} placeholder="Unité" value={f.unite} onChange={(e) => setF({ ...f, unite: e.target.value })} />
      <input className={`${inputCls} col-span-2`} type="number" min="0" step="any" placeholder="Qté" value={f.quantite} onChange={(e) => setF({ ...f, quantite: e.target.value })} />
      <Button size="sm" variant="ghost" className="col-span-1" disabled={ajouter.isPending} onClick={valider}><Plus className="h-3.5 w-3.5" /></Button>
    </div>
  )
}

// ── Panneau ───────────────────────────────────────────────────────────────────

export function FabricationOFPanel({ jobId, titre, aCommande, onClose }: { jobId: string; titre: string; aCommande: boolean; onClose: () => void }) {
  const { data, isLoading } = useFabricationOF(jobId)
  const ouvert = !!data && !OF_CLOS.includes(data.job.statut)
  const operationsOuvertes = ouvert && data?.job.statut === 'in_production'
  const sansGamme = !!data && data.operations.length === 0 && data.consommations.length === 0

  return (
    <SlideOver isOpen onClose={onClose} title={`Fabrication — ${titre}`} width="lg">
      {isLoading || !data ? (
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
      ) : (
        <div className="space-y-6">
          <section className="grid grid-cols-3 gap-3 rounded-xl bg-gray-50 p-4 text-sm">
            <div>
              <p className="text-xs text-gray-400">Temps prévu / réel</p>
              <p className="font-semibold text-gray-800">{h(data.resume.tempsPrevuH)} / {h(data.resume.tempsReelH)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Étapes terminées</p>
              <p className="font-semibold text-gray-800">{data.resume.operationsTerminees} / {data.resume.operationsTotal}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Consommations saisies</p>
              <p className="font-semibold text-gray-800">{data.resume.consommationsSaisies} / {data.resume.consommationsTotal}</p>
            </div>
            {data.job.quantite_facturable != null && (
              <p className="col-span-3 text-xs text-gray-400">
                Planifié sur {data.job.quantite_facturable.toLocaleString('fr-FR')} unité(s) facturable(s) de la fiche technique figée au devis.
              </p>
            )}
          </section>

          {sansGamme && ouvert && <ChargerGamme jobId={jobId} depuisCommande={aCommande} />}

          {data.operations.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Étapes</h3>
              {ouvert && !operationsOuvertes && (
                <p className="text-xs text-amber-700">Lancez l'OF (« Lancer ») pour démarrer les étapes.</p>
              )}
              <ul className="space-y-2">
                {data.operations.map((op) => <LigneOperation key={op.id} jobId={jobId} op={op} ouvert={operationsOuvertes} />)}
              </ul>
              {operationsOuvertes && data.resume.operationsTotal > 0 && data.resume.operationsTerminees === data.resume.operationsTotal && (
                <p className="text-xs font-medium text-green-700">Toutes les étapes sont terminées : l'OF peut passer à « Prêt » (bouton Terminer).</p>
              )}
            </section>
          )}

          {(data.consommations.length > 0 || (ouvert && !sansGamme)) && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Matières et consommables</h3>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-400">
                    <th className="pb-1 font-medium">Article</th><th className="pb-1 font-medium">Prévu</th>
                    <th className="pb-1 font-medium">Réel</th><th className="pb-1 font-medium">Écart</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.consommations.map((k) => <LigneConsommation key={k.id} jobId={jobId} conso={k} ouvert={ouvert} />)}
                </tbody>
              </table>
              {ouvert && <AjoutConsommation jobId={jobId} />}
            </section>
          )}
        </div>
      )}
    </SlideOver>
  )
}
