// FORGE — Demandes de devis (Catalogue Hybride Phase 6)
//
// Demande → qualification → chiffrage → devis → acceptation → conversion.
// Les statuts et transitions viennent de @forge/shared (même règle que l'API) ;
// le devis lui-même reste celui du module Devis : aucun second système.

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Clock, FileText, Paperclip, History, ExternalLink } from 'lucide-react'
import { DataTable, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { toast } from 'sonner'
import {
  LIBELLES_STATUT_DEMANDE, normaliserStatutDemande, STATUTS_DEMANDE, type StatutDemande,
} from '@forge/shared'
import { formatDate } from '@/lib/utils'
import {
  useDevisWeb, useDemandeDevisDetail, useCreerDevisErp, useChangerStatutDevisWeb, useQualifierDemande,
  type DevisWeb, type StatutDevisWeb,
} from '@/hooks/useDevisWeb'
import { useConditionsPaiement } from '@/hooks/useDevis'
import { useFamilles, useModeles } from '@/hooks/useCatalogue'

const COULEURS_STATUT: Record<StatutDemande, { color: string; bg: string }> = {
  nouvelle:         { color: '#C62828', bg: '#fee2e2' },
  en_qualification: { color: '#d97706', bg: '#fef3c7' },
  infos_requises:   { color: '#9333ea', bg: '#f3e8ff' },
  en_chiffrage:     { color: '#1d4ed8', bg: '#dbeafe' },
  devis_envoye:     { color: '#0e7490', bg: '#cffafe' },
  acceptee:         { color: '#15803d', bg: '#dcfce7' },
  refusee:          { color: '#6b7280', bg: '#f3f4f6' },
  expiree:          { color: '#6b7280', bg: '#f3f4f6' },
  convertie:        { color: '#166534', bg: '#bbf7d0' },
}

/** Libellés des actions manuelles (les passages liés au devis sont automatiques). */
const ACTIONS_MANUELLES: Partial<Record<StatutDemande, string>> = {
  en_qualification: 'Qualifier',
  infos_requises:   'Demander des informations',
  refusee:          'Refuser',
  expiree:          'Classer expirée',
}
const MOTIF_REQUIS: StatutDemande[] = ['refusee', 'infos_requises']

export function BadgeStatutDemande({ statut }: { statut: StatutDevisWeb }) {
  const s = normaliserStatutDemande(statut)
  const c = s ? COULEURS_STATUT[s] : { color: '#6b7280', bg: '#f3f4f6' }
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: c.color, backgroundColor: c.bg }}>
      {s ? LIBELLES_STATUT_DEMANDE[s] : statut}
    </span>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]'

// ── Qualification ──────────────────────────────────────────────────────────────

function FormulaireQualification({ demande }: { demande: DevisWeb }) {
  const qualifier = useQualifierDemande()
  const { data: famillesData } = useFamilles({ actif: true })
  const [f, setF] = useState({
    famille_id:     demande.famille_id ?? '',
    modele_id:      demande.modele_id ?? '',
    quantite:       demande.quantite != null ? String(demande.quantite) : '',
    dimensions:     demande.dimensions ?? '',
    materiau:       demande.materiau ?? '',
    localisation:   demande.localisation ?? '',
    delai_souhaite: demande.delai_souhaite ?? '',
    notes_internes: demande.notes_internes ?? '',
  })
  const { data: modelesData } = useModeles({ famille_id: f.famille_id || undefined, actif: true, enabled: !!f.famille_id })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value, ...(k === 'famille_id' ? { modele_id: '' } : {}) }))

  const enregistrer = () => {
    const quantite = f.quantite.trim() ? Number(f.quantite) : null
    if (quantite !== null && !(quantite > 0)) { toast.error('Quantité invalide'); return }
    qualifier.mutate({
      id: demande.id,
      famille_id:     f.famille_id || null,
      modele_id:      f.modele_id || null,
      quantite,
      dimensions:     f.dimensions.trim() || null,
      materiau:       f.materiau.trim() || null,
      localisation:   f.localisation.trim() || null,
      delai_souhaite: f.delai_souhaite || null,
      notes_internes: f.notes_internes.trim() || null,
    })
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Qualification</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Famille</label>
          <select className={`${inputCls} bg-white`} value={f.famille_id} onChange={set('famille_id')}>
            <option value="">—</option>
            {(famillesData?.data ?? []).map((fam) => <option key={fam.id} value={fam.id}>{fam.nom}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Modèle</label>
          <select className={`${inputCls} bg-white`} value={f.modele_id} onChange={set('modele_id')} disabled={!f.famille_id}>
            <option value="">—</option>
            {(modelesData?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.reference} — {m.designation}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Quantité</label>
          <input className={inputCls} type="number" min="0" step="any" value={f.quantite} onChange={set('quantite')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Dimensions</label>
          <input className={inputCls} maxLength={300} value={f.dimensions} onChange={set('dimensions')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Matériau</label>
          <input className={inputCls} maxLength={100} value={f.materiau} onChange={set('materiau')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Localisation</label>
          <input className={inputCls} maxLength={200} value={f.localisation} onChange={set('localisation')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Délai souhaité</label>
          <input className={inputCls} type="date" value={f.delai_souhaite} onChange={set('delai_souhaite')} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Notes internes (non visibles du client)</label>
        <textarea className={`${inputCls} resize-none`} rows={2} maxLength={3000} value={f.notes_internes} onChange={set('notes_internes')} />
      </div>
      <Button size="sm" variant="secondary" disabled={qualifier.isPending} onClick={enregistrer}>
        {qualifier.isPending ? 'Enregistrement…' : 'Enregistrer la qualification'}
      </Button>
    </section>
  )
}

// ── Création du devis (chiffrage) ──────────────────────────────────────────────

function CreationDevis({ demande, onCree }: { demande: DevisWeb; onCree: (numero: string) => void }) {
  const creerDevis = useCreerDevisErp()
  const { data: conditionsData } = useConditionsPaiement()
  const [montantHt, setMontantHt] = useState('')
  const [dateValidite, setDateValidite] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0])
  const [condCode, setCondCode] = useState('P100')
  const [notes, setNotes] = useState('')

  const creer = () => {
    creerDevis.mutate(
      {
        id: demande.id,
        montant_ht:              Number(montantHt) > 0 ? Math.round(Number(montantHt)) : undefined,
        date_validite:           dateValidite || undefined,
        condition_paiement_code: condCode || undefined,
        notes_commerciales:      notes.trim() || undefined,
      },
      { onSuccess: (res) => onCree(res.data.numero) },
    )
  }

  return (
    <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Chiffrage — créer le devis</h3>
      <p className="text-xs text-gray-500">
        Le devis est créé en brouillon dans le module Devis, avec le besoin qualifié repris dans ses notes.
        Montants sans TVA (appliquée à la facture).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Montant estimé (FCFA)</label>
          <input className={inputCls} type="number" min="0" value={montantHt} onChange={(e) => setMontantHt(e.target.value)} placeholder="Optionnel" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Date de validité</label>
          <input className={inputCls} type="date" min={new Date().toISOString().split('T')[0]} value={dateValidite} onChange={(e) => setDateValidite(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Condition de paiement proposée</label>
        <select className={`${inputCls} bg-white`} value={condCode} onChange={(e) => setCondCode(e.target.value)}>
          {(conditionsData?.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.libelle}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Notes commerciales</label>
        <textarea className={`${inputCls} resize-none`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button size="sm" disabled={creerDevis.isPending} onClick={creer}>
        <FileText className="h-4 w-4" /> {creerDevis.isPending ? 'Création…' : 'Créer le devis'}
      </Button>
    </section>
  )
}

// ── Détail ─────────────────────────────────────────────────────────────────────

function DetailDemande({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: demande, isLoading } = useDemandeDevisDetail(id)
  const changerStatut = useChangerStatutDevisWeb()
  const [action, setAction] = useState<StatutDemande | null>(null)
  const [motif, setMotif] = useState('')
  useEffect(() => { setAction(null); setMotif('') }, [id])

  const statut = demande ? normaliserStatutDemande(demande.statut) : null
  const actions = (demande?.transitions_possibles ?? []).filter((t) => ACTIONS_MANUELLES[t])
  const peutChiffrer = !!demande && !demande.erp_devis_id && !!statut && ['nouvelle', 'en_qualification', 'infos_requises'].includes(statut)

  const confirmer = () => {
    if (!demande || !action) return
    if (MOTIF_REQUIS.includes(action) && !motif.trim()) { toast.error('Indiquez le motif'); return }
    changerStatut.mutate(
      { id: demande.id, statut: action, commentaire: motif.trim() || undefined },
      { onSuccess: () => { setAction(null); setMotif('') } },
    )
  }

  return (
    <SlideOver isOpen onClose={onClose} title={demande?.numero ? `Demande ${demande.numero}` : 'Demande de devis'} width="lg">
      {isLoading || !demande ? (
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <BadgeStatutDemande statut={demande.statut} />
              <span className="text-xs text-gray-400">
                Reçue le {formatDate(demande.created_at.split('T')[0])}{demande.source ? ` · ${demande.source}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400">Contact</p>
                <p className="font-semibold text-[#212121]">{demande.nom}</p>
                <p className="text-gray-500">{demande.telephone}</p>
                {demande.email && <p className="text-xs text-gray-400">{demande.email}</p>}
              </div>
              {demande.type_projet && (
                <div>
                  <p className="text-xs text-gray-400">Type de projet</p>
                  <p className="text-sm text-gray-700">{demande.type_projet}</p>
                  {demande.produit_ref && <p className="text-xs text-gray-400">Réf. {demande.produit_ref}</p>}
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-400">Description</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{demande.description}</p>
            </div>
            {demande.erp_devis_id && (
              <button
                onClick={() => navigate('/devis')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C62828] underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Devis lié : voir le module Devis
              </button>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Paperclip className="h-3.5 w-3.5" /> Pièces jointes ({demande.documents.length})
            </h3>
            {demande.documents.length === 0 ? (
              <p className="text-xs italic text-gray-400">Aucun fichier joint.</p>
            ) : (
              <ul className="space-y-1">
                {demande.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    {d.url
                      ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="truncate text-[#C62828] underline">{d.nom_fichier}</a>
                      : <span className="truncate text-gray-500">{d.nom_fichier}</span>}
                    <span className="ml-2 shrink-0 text-xs text-gray-400">{Math.max(1, Math.round(d.taille_octets / 1024))} Ko</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {statut && !['refusee', 'expiree', 'convertie'].includes(statut) && (
            <FormulaireQualification key={demande.id} demande={demande} />
          )}

          {peutChiffrer && <CreationDevis demande={demande} onCree={(n) => toast.success(`Devis ${n} créé — demande en chiffrage`)} />}

          {actions.length > 0 && (
            <section className="space-y-2 border-t border-gray-100 pt-4">
              <div className="flex flex-wrap gap-2">
                {actions.map((t) => (
                  <Button key={t} size="sm" variant={action === t ? 'secondary' : 'ghost'} onClick={() => setAction(t)}>
                    {ACTIONS_MANUELLES[t]}
                  </Button>
                ))}
              </div>
              {action && (
                <div className="space-y-2">
                  <textarea
                    className={`${inputCls} resize-none`} rows={2} value={motif} onChange={(e) => setMotif(e.target.value)}
                    placeholder={MOTIF_REQUIS.includes(action) ? 'Motif (obligatoire)' : 'Commentaire (facultatif)'}
                  />
                  <Button size="sm" disabled={changerStatut.isPending} onClick={confirmer}>
                    Confirmer : {LIBELLES_STATUT_DEMANDE[action]}
                  </Button>
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <History className="h-3.5 w-3.5" /> Historique
            </h3>
            <ol className="space-y-2 border-l border-gray-200 pl-4">
              {demande.historique.map((h, i) => (
                <li key={i} className="text-xs">
                  <span className="text-gray-400">{new Date(h.created_at).toLocaleString('fr-FR')}</span>{' '}
                  <span className="font-medium text-gray-700">
                    {h.ancien_statut ? `${libelle(h.ancien_statut)} → ` : ''}{libelle(h.nouveau_statut)}
                  </span>
                  {h.commentaire && <p className="text-gray-500">{h.commentaire}</p>}
                </li>
              ))}
              {demande.historique.length === 0 && <li className="text-xs italic text-gray-400">Aucun événement enregistré.</li>}
            </ol>
          </section>
        </div>
      )}
    </SlideOver>
  )
}

function libelle(statut: string): string {
  const s = normaliserStatutDemande(statut)
  return s ? LIBELLES_STATUT_DEMANDE[s] : statut
}

// ── Liste ──────────────────────────────────────────────────────────────────────

export function DemandesDevis({ typesProjet }: { typesProjet: string[] }) {
  const { data, isLoading } = useDevisWeb()
  const [filtreType, setFiltreType] = useState('')
  const [filtreStatut, setFiltreStatut] = useState<StatutDemande | ''>('')
  const [selection, setSelection] = useState<string | null>(null)

  const demandes = (data ?? []).filter((d) =>
    (!filtreType || d.type_projet === filtreType) &&
    (!filtreStatut || normaliserStatutDemande(d.statut) === filtreStatut))

  const colonnes: Column<DevisWeb>[] = [
    { id: 'numero', header: 'N°', accessor: 'numero', render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{(v as string) ?? '—'}</span> },
    { id: 'nom', header: 'Contact', accessor: 'nom', render: (v, row) => (
      <div>
        <div className="text-sm font-semibold">{v as string}</div>
        <div className="text-xs text-gray-400">{row.telephone}</div>
      </div>
    )},
    { id: 'type_projet', header: 'Type de projet', accessor: 'type_projet', render: (v) =>
      v
        ? <span className="inline-block max-w-[180px] truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700" title={v as string}>{v as string}</span>
        : <span className="text-xs italic text-gray-300">—</span>,
    },
    { id: 'description', header: 'Demande', accessor: 'description', render: (v, row) => (
      <div>
        <span className="line-clamp-2 text-sm text-gray-600">{v as string}</span>
        {(row.nb_documents ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Paperclip className="h-3 w-3" /> {row.nb_documents}</span>
        )}
      </div>
    )},
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <BadgeStatutDemande statut={v as StatutDevisWeb} /> },
    { id: 'date', header: 'Date', accessor: 'created_at', render: (v) => <span className="text-xs text-gray-400">{formatDate((v as string).split('T')[0])}</span> },
    { id: 'suivi', header: '', accessor: 'erp_devis_id', sortable: false, render: (v) =>
      v
        ? <span className="flex items-center gap-1 text-xs font-medium text-[#15803d]"><CheckCircle className="h-3.5 w-3.5" /> Devis lié</span>
        : <span className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3.5 w-3.5" /> À traiter</span>,
    },
  ]

  const selectCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 outline-none focus:border-[#C62828] focus:ring-1 focus:ring-[#C62828]'

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as StatutDemande | '')} className={selectCls}>
          <option value="">Tous les statuts</option>
          {STATUTS_DEMANDE.map((s) => <option key={s} value={s}>{LIBELLES_STATUT_DEMANDE[s]}</option>)}
        </select>
        <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)} className={selectCls}>
          <option value="">Tous les types de projet</option>
          {typesProjet.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filtreType || filtreStatut) && (
          <button onClick={() => { setFiltreType(''); setFiltreStatut('') }} className="text-xs text-[#C62828] underline">Effacer</button>
        )}
        <span className="ml-auto text-xs text-gray-400">{demandes.length} demande{demandes.length !== 1 ? 's' : ''}</span>
      </div>
      <DataTable<DevisWeb>
        columns={colonnes}
        data={demandes}
        keyField="id"
        loading={isLoading}
        onRowClick={(row) => setSelection(row.id)}
      />
      {selection && <DetailDemande id={selection} onClose={() => setSelection(null)} />}
    </>
  )
}
