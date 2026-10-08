'use client'

/**
 * Suivi des devis établis par TAFDIL pour le client connecté : avancement
 * (préparation → validation → fabrication → livraison), détail, PDF, et
 * validation ou refus en ligne quand le devis attend sa réponse.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, FileDown, Loader2, Clock } from 'lucide-react'

export interface DevisErp {
  id:                  string
  numero:              string
  statut:              string   // brouillon | envoye | accepte | refuse | expire | transforme
  date_emission:       string
  date_validite:       string
  total_ht_xaf:        number
  tva_xaf:             number
  total_ttc_xaf:       number
  approuve_par_client: boolean | null
  approuve_at:         string | null
  devis_lignes:        Array<{ designation: string; quantite: number; unite: string; total_ht_xaf: number; ordre: number | null }>
  commande:            { numero: string; statut: string } | null
}

const ETAPES = ['Préparation', 'À valider', 'Validé', 'Fabrication', 'Livraison'] as const

/** Étape atteinte (index dans ETAPES), ou null pour un devis refusé / expiré. */
function etape(d: DevisErp): number | null {
  if (d.statut === 'refuse' || d.statut === 'expire') return null
  if (d.commande) {
    if (d.commande.statut === 'delivered') return 4
    if (['in_production', 'pret'].includes(d.commande.statut)) return 3
    return 2
  }
  return { brouillon: 0, envoye: 1, accepte: 2, transforme: 2 }[d.statut] ?? 0
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(Number(n ?? 0))
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

function Avancement({ devis }: { devis: DevisErp }) {
  const atteinte = etape(devis)
  if (atteinte === null) {
    return (
      <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${devis.statut === 'refuse' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
        {devis.statut === 'refuse' ? 'Devis refusé.' : 'Devis expiré — contactez-nous pour le renouveler.'}
      </p>
    )
  }
  return (
    <ol className="flex items-start">
      {ETAPES.map((libelle, i) => (
        <li key={libelle} className="flex flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <span className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : i <= atteinte ? 'bg-forge-red' : 'bg-gray-200'}`} />
            <span className={`h-3 w-3 shrink-0 rounded-full ${i <= atteinte ? 'bg-forge-red' : 'bg-gray-200'} ${i === atteinte ? 'ring-4 ring-red-100' : ''}`} />
            <span className={`h-0.5 flex-1 ${i === ETAPES.length - 1 ? 'invisible' : i < atteinte ? 'bg-forge-red' : 'bg-gray-200'}`} />
          </div>
          <span className={`mt-1.5 text-[10px] font-semibold leading-tight ${i <= atteinte ? 'text-forge-dark' : 'text-gray-400'}`}>{libelle}</span>
        </li>
      ))}
    </ol>
  )
}

function DevisErpCard({ devis }: { devis: DevisErp }) {
  const router = useRouter()
  const [envoi, setEnvoi]           = useState<'accepte' | 'refuse' | null>(null)
  const [refusOuvert, setRefusOuvert] = useState(false)
  const [motif, setMotif]           = useState('')
  const [erreur, setErreur]         = useState('')

  const decider = async (decision: 'accepte' | 'refuse') => {
    setEnvoi(decision); setErreur('')
    try {
      const res = await fetch(`/api/compte/devis/${devis.id}/decision`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision, commentaire: motif.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErreur(json.error ?? 'Action impossible pour le moment'); return }
      router.refresh()
    } catch {
      setErreur('Impossible de contacter le serveur')
    } finally {
      setEnvoi(null)
    }
  }

  const lignes = [...devis.devis_lignes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))

  return (
    <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold text-forge-steel">{devis.numero}</p>
          <p className="text-lg font-black text-forge-dark">{fmt(devis.total_ttc_xaf)} <span className="text-xs font-semibold text-gray-400">TTC</span></p>
          <p className="text-[11px] text-gray-400">Émis le {fmtDate(devis.date_emission)} · valable jusqu'au {fmtDate(devis.date_validite)}</p>
        </div>
        <a
          href={`/api/compte/devis/${devis.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs font-bold text-forge-red hover:underline"
        >
          <FileDown size={14} /> PDF
        </a>
      </div>

      <Avancement devis={devis} />

      {devis.commande && (
        <p className="text-xs text-forge-steel">Commande <span className="font-mono font-bold">{devis.commande.numero}</span> en cours.</p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-forge-steel">Détail ({lignes.length} ligne{lignes.length > 1 ? 's' : ''})</summary>
        <ul className="mt-2 divide-y divide-gray-50">
          {lignes.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5 text-xs">
              <span className="text-forge-dark">{l.designation} <span className="text-gray-400">× {l.quantite} {l.unite}</span></span>
              <span className="shrink-0 font-semibold">{fmt(l.total_ht_xaf)} HT</span>
            </li>
          ))}
        </ul>
      </details>

      {devis.statut === 'envoye' && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800"><Clock size={13} /> Ce devis attend votre réponse</p>
          {refusOuvert && (
            <textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={2}
              placeholder="Motif du refus (facultatif) — nous pourrons vous proposer une alternative"
              className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-forge-red"
            />
          )}
          {erreur && <p className="text-xs font-semibold text-red-600">{erreur}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={envoi !== null}
              onClick={() => (refusOuvert ? decider('refuse') : setRefusOuvert(true))}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white py-2.5 text-sm font-bold text-red-600 disabled:opacity-50"
            >
              {envoi === 'refuse' ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
              {refusOuvert ? 'Confirmer le refus' : 'Refuser'}
            </button>
            <button
              type="button"
              disabled={envoi !== null}
              onClick={() => decider('accepte')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-forge-red py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {envoi === 'accepte' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Valider le devis
            </button>
          </div>
        </div>
      )}

      {devis.approuve_par_client && devis.approuve_at && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
          <CheckCircle2 size={13} /> Validé le {fmtDate(devis.approuve_at)}
        </p>
      )}
    </div>
  )
}

export function DevisSuivi({ devis }: { devis: DevisErp[] }) {
  if (devis.length === 0) return null
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-forge-steel">Vos devis TAFDIL</h3>
      {devis.map((d) => <DevisErpCard key={d.id} devis={d} />)}
    </section>
  )
}
