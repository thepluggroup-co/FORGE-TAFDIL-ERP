import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle, Clock, Package, Plus, Truck, XCircle } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate, formatXAF } from '@/lib/utils'
import {
  useCommandesPretesLivraison,
  useCreateLivraison,
  useLivraisons,
  useUpdateLivraisonStatut,
} from '@/hooks/useOperations'
import type { CommandePreteLivraison, Livraison } from '@/hooks/useOperations'

type LivraisonRecord = Livraison & Record<string, unknown>
type PaiementLivraison = {
  montant_xaf: number
  methode: 'mobile_money' | 'especes'
  reference_ext?: string
}

const TRANSPORTEURS = ['TRANSIT CM', 'CAMTRANS', 'PORT EXPRESS', 'Auto-livraison', 'ELITE TRANSPORT']

const STATUT_LABELS: Partial<Record<Livraison['statut'], string>> = {
  en_preparation: 'En preparation',
  planifiee:  'Planifiée',
  en_transit: 'En transit',
  livree:     'Livrée',
  annulee:    'Annulée',
}

STATUT_LABELS.confirmed = 'Confirmee'
STATUT_LABELS.pret = 'Prete'
STATUT_LABELS.delivered = 'Livree'
STATUT_LABELS.cancelled = 'Annulee'

const NEXT_ACTIONS: Record<Livraison['statut'], Array<{ statut: Livraison['statut']; label: string; icon: JSX.Element }>> = {
  en_preparation: [
    { statut: 'planifiee', label: 'Planifier', icon: <Clock className="h-3.5 w-3.5" /> },
    { statut: 'annulee', label: 'Annuler', icon: <XCircle className="h-3.5 w-3.5" /> },
  ],
  planifiee: [
    { statut: 'en_transit', label: 'Départ', icon: <Truck className="h-3.5 w-3.5" /> },
    { statut: 'annulee', label: 'Annuler', icon: <XCircle className="h-3.5 w-3.5" /> },
  ],
  en_transit: [
    { statut: 'livree', label: 'Livrée', icon: <CheckCircle className="h-3.5 w-3.5" /> },
    { statut: 'annulee', label: 'Annuler', icon: <XCircle className="h-3.5 w-3.5" /> },
  ],
  livree: [],
  annulee: [],
  confirmed: [],
  pret: [],
  delivered: [],
  cancelled: [],
}

interface LivraisonForm {
  commandeId: string
  destination: string
  transporteur: string
  dateDepart: string
  dateLivraison: string
  notes: string
}

const DEFAULT_FORM: LivraisonForm = {
  commandeId: '',
  destination: '',
  transporteur: '',
  dateDepart: new Date().toISOString().split('T')[0],
  dateLivraison: '',
  notes: '',
}

export default function Logistique() {
  const [slideOpen, setSlideOpen] = useState(false)
  const [selected, setSelected] = useState<LivraisonRecord | null>(null)
  const [form, setForm] = useState<LivraisonForm>(DEFAULT_FORM)

  const { data, isLoading } = useLivraisons()
  const { data: commandesPretesData, isLoading: commandesLoading } = useCommandesPretesLivraison()
  const createLivraison = useCreateLivraison()
  const updateStatut = useUpdateLivraisonStatut()

  const livraisons = (data?.data ?? []) as LivraisonRecord[]
  const commandesPretes = commandesPretesData?.data ?? []
  const selectedCommande = commandesPretes.find((c) => c.id === form.commandeId)
  const formValid = Boolean(selectedCommande && form.destination.trim() && form.transporteur && form.dateLivraison)

  const columns = useMemo<Column<LivraisonRecord>[]>(() => [
    {
      id: 'numero',
      header: 'Référence',
      accessor: 'numero',
      render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span>,
    },
    {
      id: 'commande',
      header: 'Commande',
      accessor: 'commande_id',
      render: (_, row) => <span className="font-mono text-xs text-gray-500">{row.commande_id ? 'Liée' : 'Libre'}</span>,
    },
    { id: 'client', header: 'Client', accessor: 'client_nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'destination', header: 'Destination', accessor: 'destination', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
    { id: 'transport', header: 'Transporteur', accessor: 'transporteur', render: (v) => <span className="text-sm">{(v as string) ?? '-'}</span> },
    { id: 'depart', header: 'Départ', accessor: 'date_depart', render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '-'}</span> },
    { id: 'livraison', header: 'Livraison', accessor: 'date_livraison_prevue', render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '-'}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={STATUT_LABELS[v as Livraison['statut']] ?? String(v)} /> },
  ], [])

  const today = new Date().toISOString().split('T')[0]
  const planifiees = livraisons.filter(l => l.statut === 'planifiee').length
  const enTransit = livraisons.filter(l => l.statut === 'en_transit').length
  const livrees = livraisons.filter(l => l.statut === 'livree').length

  const handleCommandeChange = (commandeId: string) => {
    const commande = commandesPretes.find((c) => c.id === commandeId)
    setForm((f) => ({
      ...f,
      commandeId,
      dateLivraison: commande?.date_livraison_prevue ?? f.dateLivraison,
    }))
  }

  const handleCreate = () => {
    if (!formValid || !selectedCommande) return
    createLivraison.mutate(
      {
        commande_id: form.commandeId,
        client_id: selectedCommande.client_id ?? undefined,
        client_nom: selectedCommande.client_nom,
        destination: form.destination,
        transporteur: form.transporteur,
        date_depart: form.dateDepart,
        date_livraison_prevue: form.dateLivraison,
        notes: [
          form.notes,
          `Solde à encaisser livraison : ${formatXAF(Number(selectedCommande.solde_restant_xaf ?? 0))}`,
        ].filter(Boolean).join(' — ') || undefined,
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const handleStatut = (livraison: LivraisonRecord, statut: Livraison['statut']) => {
    let paiement_livraison: PaiementLivraison | undefined
    if (statut === 'livree') {
      const solde = Number(livraison.solde_restant_xaf ?? 0)
      if (solde > 0) {
        const methodeInput = window.prompt(
          `Solde à encaisser : ${formatXAF(solde)}\nMode de paiement : tapez "mobile_money" ou "especes"`,
          'mobile_money',
        )
        if (!methodeInput) return
        const methode = methodeInput === 'especes' ? 'especes' : 'mobile_money'
        const ref = methode === 'mobile_money'
          ? window.prompt('Référence Mobile Money ou numéro de transaction', '')
          : ''
        paiement_livraison = {
          montant_xaf:   solde,
          methode,
          reference_ext: ref || undefined,
        }
      }
    }

    updateStatut.mutate(
      {
        id: livraison.id,
        statut,
        paiement_livraison,
        notes: statut === 'livree'
          ? paiement_livraison
            ? `Livraison confirmée avec paiement ${paiement_livraison.methode} de ${formatXAF(paiement_livraison.montant_xaf)}`
            : 'Livraison confirmée depuis le module logistique'
          : `Statut mis à jour : ${STATUT_LABELS[statut]}`,
      },
      {
        onSuccess: (updated) => setSelected(updated as LivraisonRecord),
      },
    )
  }

  const selectedActions = selected ? (NEXT_ACTIONS[selected.statut] ?? []) : []
  const selectedDocument = selected?.document_requis ?? null
  const selectedBlocked = Boolean(selected?.commande_id && selected?.livrable === false && selectedDocument)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Logistique"
        subtitle="Livraisons · Commandes prêtes · Transporteurs · Historique"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Logistique' }]}
        actions={<Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}><Plus className="h-3.5 w-3.5" /> Planifier livraison</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="À planifier" value={commandesPretes.length} icon={<Package className="h-5 w-5" />} color="#7c3aed" delay={0} />
        <KpiCard title="Planifiées" value={planifiees} icon={<Clock className="h-5 w-5" />} color="#1d4ed8" delay={0.07} />
        <KpiCard title="En transit" value={enTransit} icon={<Truck className="h-5 w-5" />} color="#d97706" delay={0.14} />
        <KpiCard title="Livrées" value={livrees} unit={`/${livraisons.length}`} icon={<CheckCircle className="h-5 w-5" />} color="#15803d" delay={0.21} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-[#212121]">Livraisons - {new Date().toLocaleDateString('fr-CM', { month: 'long', year: 'numeric' })}</h2>
            <div className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3.5 w-3.5" /> En temps réel</div>
          </div>
          <DataTable<LivraisonRecord> columns={columns} data={livraisons} keyField="id" loading={isLoading} onRowClick={setSelected} />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-h-[320px]">
          {selected ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black text-[#212121]">{selected.numero}</h3>
                  <StatusBadge status={STATUT_LABELS[selected.statut] ?? String(selected.statut ?? '-')} />
                </div>
                <p className="mt-1 text-xs text-gray-400">{selected.client_nom} · {selected.destination}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-gray-400">Départ</p>
                  <p className="font-semibold text-gray-700">{selected.date_depart ? formatDate(selected.date_depart) : '-'}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-gray-400">Livraison prévue</p>
                  <p className="font-semibold text-gray-700">{selected.date_livraison_prevue ? formatDate(selected.date_livraison_prevue) : '-'}</p>
                </div>
              </div>

              {selectedBlocked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase text-amber-800">Document requis avant depart</p>
                      <p className="mt-1 text-sm font-semibold text-amber-900">{selectedDocument?.label ?? 'Document requis'}</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {selected.blocage_livraison_message ?? 'La livraison ne peut pas demarrer tant que le document requis n est pas pret.'}
                      </p>
                      <p className="mt-2 text-xs text-amber-700">
                        A traiter dans : <span className="font-semibold">{selectedDocument?.module ?? 'Module concerne'}</span>
                        {selectedDocument?.etat ? ` - etat actuel : ${selectedDocument.etat}` : ''}
                      </p>
                      {selectedDocument?.action && (
                        <p className="mt-1 text-xs text-amber-700">{selectedDocument.action}</p>
                      )}
                      {selectedDocument?.url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 border border-amber-200 bg-white text-amber-800 hover:bg-amber-100"
                          onClick={() => { window.location.href = selectedDocument.url! }}
                        >
                          Ouvrir {selectedDocument.module ?? 'le module'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedActions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedActions.map((action) => (
                    <Button key={action.statut} size="sm" variant={action.statut === 'annulee' ? 'ghost' : 'primary'}
                      disabled={updateStatut.isPending || (selectedBlocked && ['en_transit', 'livree'].includes(action.statut))}
                      title={selectedBlocked && ['en_transit', 'livree'].includes(action.statut) ? 'Document requis avant de continuer' : undefined}
                      onClick={() => handleStatut(selected, action.statut)}>
                      {action.icon} {action.label}
                    </Button>
                  ))}
                </div>
              )}

              <div>
                <h4 className="mb-2 text-xs font-bold uppercase text-gray-400">Historique</h4>
                <div className="space-y-2">
                  {(selected.livraisons_historique ?? []).length === 0 && (
                    <p className="text-xs text-gray-400">Aucun historique disponible.</p>
                  )}
                  {(selected.livraisons_historique ?? [])
                    .slice()
                    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())
                    .map((h) => (
                      <div key={h.id} className="rounded-lg border border-gray-100 px-3 py-2">
                        <p className="text-xs font-semibold text-gray-700">{STATUT_LABELS[h.nouveau_statut as Livraison['statut']] ?? h.nouveau_statut}</p>
                        <p className="text-[11px] text-gray-400">{formatDate(h.changed_at)}{h.commentaire ? ` · ${h.commentaire}` : ''}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
              <Truck className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-semibold text-gray-600">Sélectionnez une livraison</p>
              <p className="mt-1 text-xs text-gray-400">Les actions et l'historique apparaîtront ici.</p>
            </div>
          )}
        </div>
      </div>

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Planifier une livraison" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Commande prête *</label>
            <select value={form.commandeId} onChange={(e) => handleCommandeChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">{commandesLoading ? 'Chargement...' : 'Sélectionner une commande'}</option>
              {commandesPretes.map((commande: CommandePreteLivraison) => (
                <option key={commande.id} value={commande.id}>
                  {commande.numero} - {commande.client_nom} - {formatXAF(Number(commande.total_ttc_xaf ?? 0))}
                  {Number(commande.solde_restant_xaf ?? 0) > 0
                    ? ` - solde ${formatXAF(Number(commande.solde_restant_xaf ?? 0))}`
                    : ' - payée'}
                </option>
              ))}
            </select>
            {commandesPretes.length === 0 && !commandesLoading && (
              <p className="mt-1 text-xs text-amber-600">Aucune commande prête à livrer sans livraison active.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Destination *</label>
            <input value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              placeholder="ex. Douala Akwa" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Transporteur *</label>
            <select value={form.transporteur} onChange={(e) => setForm((f) => ({ ...f, transporteur: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner...</option>
              {TRANSPORTEURS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de départ</label>
              <input type="date" value={form.dateDepart} onChange={(e) => setForm((f) => ({ ...f, dateDepart: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de livraison *</label>
              <input type="date" value={form.dateLivraison} min={form.dateDepart} onChange={(e) => setForm((f) => ({ ...f, dateLivraison: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Instructions de livraison, contact chantier..."
              className="min-h-[90px] w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createLivraison.isPending} onClick={handleCreate}>
              {createLivraison.isPending ? 'Planification...' : 'Planifier'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
