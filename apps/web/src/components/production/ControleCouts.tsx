// FORGE — Contrôle des coûts (Catalogue Hybride Phase 8)
//
// Marge prévue au devis vs marge réelle (temps et matières réellement
// consommés, valorisés aux taux figés au lancement des OF), par commande.
// Visible uniquement avec le droit COMMERCIAL:CONFIGURE (comme les règles de marge).

import React, { useState } from 'react'
import { TrendingDown, AlertTriangle } from 'lucide-react'
import type { CoutsOF, PosteCouts } from '@forge/shared'
import { formatXAF } from '@/lib/utils'
import { useSyntheseControleCouts, type LigneControleCommande } from '@/hooks/useControleCouts'

const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR')} %`)
const couleurEcart = (v: number | null) => (v == null ? 'text-gray-400' : v > 0 ? 'text-red-600' : 'text-green-700')

// ── Détail d'un OF (utilisé dans le panneau Étapes) ───────────────────────────

const POSTES: Array<[keyof PosteCouts, string]> = [
  ['mainOeuvreXaf', 'Main-d\'œuvre'], ['machinesXaf', 'Machines'],
  ['matieresXaf', 'Matières'], ['consommablesXaf', 'Consommables'], ['totalXaf', 'Total fabrication'],
]

export function CoutsOFTableau({ couts }: { couts: CoutsOF }) {
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400">
            <th className="pb-1 font-medium">Poste</th><th className="pb-1 text-right font-medium">Prévu</th>
            <th className="pb-1 text-right font-medium">{couts.complet ? 'Réel' : 'Réel (estimé)'}</th>
            <th className="pb-1 text-right font-medium">Écart</th>
          </tr>
        </thead>
        <tbody>
          {POSTES.map(([cle, libelle]) => {
            const ecart = couts.reel[cle] - couts.prevu[cle]
            const total = cle === 'totalXaf'
            return (
              <tr key={cle} className={`border-t border-gray-100 ${total ? 'font-semibold' : ''}`}>
                <td className="py-1.5">{libelle}</td>
                <td className="py-1.5 text-right">{formatXAF(couts.prevu[cle])}</td>
                <td className="py-1.5 text-right">{formatXAF(couts.reel[cle])}</td>
                <td className={`py-1.5 text-right ${couleurEcart(ecart === 0 ? null : ecart)}`}>
                  {ecart === 0 ? '—' : `${ecart > 0 ? '+' : ''}${formatXAF(ecart)}`}
                  {total && couts.ecartPct != null ? ` (${pct(couts.ecartPct)})` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!couts.complet && (
        <p className="text-xs text-gray-400">
          OF en cours : les étapes non terminées comptent pour leur temps prévu (ou le temps déjà passé s'il est supérieur),
          les consommations non saisies pour leur quantité prévue.
        </p>
      )}
      {couts.alertes.map((a) => (
        <p key={a} className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3 w-3 shrink-0" /> {a}</p>
      ))}
    </div>
  )
}

// ── Synthèse par commande ─────────────────────────────────────────────────────

function LigneCommande({ l }: { l: LigneControleCommande }) {
  const m = l.marge
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="py-2 pr-2">
        <p className="font-mono text-xs font-semibold text-gray-700">{l.numero}</p>
        <p className="text-xs text-gray-400">{l.client_nom ?? '—'} · {l.nb_of} OF{!m.complet ? ' · en cours' : ''}</p>
      </td>
      <td className="py-2 pr-2 text-right text-sm">{formatXAF(m.prixVenteHtXaf)}</td>
      <td className="py-2 pr-2 text-right text-sm">{m.coutRevientPrevuXaf == null ? '—' : formatXAF(m.coutRevientPrevuXaf)}</td>
      <td className="py-2 pr-2 text-right text-sm">{formatXAF(m.coutRevientReelXaf)}</td>
      <td className="py-2 pr-2 text-right text-sm">{m.margePrevueXaf == null ? '—' : formatXAF(m.margePrevueXaf)}</td>
      <td className={`py-2 pr-2 text-right text-sm font-semibold ${m.margeReelleXaf < 0 ? 'text-red-600' : 'text-gray-800'}`}>
        {formatXAF(m.margeReelleXaf)}
        <span className="block text-xs font-normal text-gray-400">{m.tauxMargeReellePct == null ? '' : `${m.tauxMargeReellePct.toLocaleString('fr-FR')} %`}</span>
      </td>
      <td className={`py-2 text-right text-sm ${couleurEcart(m.ecartMargeXaf == null ? null : -m.ecartMargeXaf)}`}>
        {m.ecartMargeXaf == null ? '—' : `${m.ecartMargeXaf > 0 ? '+' : ''}${formatXAF(m.ecartMargeXaf)}`}
        {m.alertes.length > 0 && (
          <span className="mt-0.5 flex justify-end" title={m.alertes.join('\n')}><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span>
        )}
      </td>
    </tr>
  )
}

export function ControleCouts() {
  const [jours, setJours] = useState(90)
  const { data, isLoading, error } = useSyntheseControleCouts(jours, true)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Contrôle des coûts — marge prévue / réelle</h2>
          <p className="text-xs text-gray-400">Commandes ayant des OF · les moins rentables d'abord</p>
        </div>
        <select
          value={jours} onChange={(e) => setJours(Number(e.target.value))}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600"
        >
          <option value={30}>30 jours</option>
          <option value={90}>90 jours</option>
          <option value={365}>12 mois</option>
        </select>
      </div>

      {error ? (
        <p className="px-5 py-6 text-sm text-gray-400">Contrôle des coûts indisponible : {(error as Error).message}</p>
      ) : isLoading || !data ? (
        <div className="m-5 h-32 animate-pulse rounded-lg bg-gray-100" />
      ) : data.data.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-400">Aucune commande avec OF sur la période.</p>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Chiffre libelle="Chiffre d'affaires HT" valeur={formatXAF(data.totaux.prix_vente_ht_xaf)} />
            <Chiffre libelle="Coût de revient réel" valeur={formatXAF(data.totaux.cout_revient_reel_xaf)} />
            <Chiffre
              libelle="Marge réelle" valeur={formatXAF(data.totaux.marge_reelle_xaf)}
              detail={data.totaux.taux_marge_reelle_pct == null ? undefined : `${data.totaux.taux_marge_reelle_pct.toLocaleString('fr-FR')} % du CA`}
            />
            <Chiffre
              libelle="Commandes déficitaires" valeur={String(data.totaux.commandes_deficitaires)}
              alerte={data.totaux.commandes_deficitaires > 0}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="text-right text-xs text-gray-400">
                  <th className="pb-1 text-left font-medium">Commande</th>
                  <th className="pb-1 font-medium">Vendu HT</th>
                  <th className="pb-1 font-medium">Coût prévu</th>
                  <th className="pb-1 font-medium">Coût réel</th>
                  <th className="pb-1 font-medium">Marge prévue</th>
                  <th className="pb-1 font-medium">Marge réelle</th>
                  <th className="pb-1 font-medium">Écart</th>
                </tr>
              </thead>
              <tbody>{data.data.map((l) => <LigneCommande key={l.commande_id} l={l} />)}</tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Coût réel = temps et matières réellement consommés dans les OF, aux taux figés à leur lancement,
            + frais indirects, transport, installation et sous-traitance prévus au devis (non suivis en atelier).
          </p>
        </div>
      )}
    </div>
  )
}

function Chiffre({ libelle, valeur, detail, alerte }: { libelle: string; valeur: string; detail?: string; alerte?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-400">{libelle}</p>
      <p className={`flex items-center gap-1 text-base font-semibold ${alerte ? 'text-red-600' : 'text-gray-800'}`}>
        {alerte && <TrendingDown className="h-4 w-4" />} {valeur}
      </p>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </div>
  )
}
