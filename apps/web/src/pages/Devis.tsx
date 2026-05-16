import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, MessageCircle, ArrowRightLeft, Copy, Archive, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useDevis, useTransformerDevis } from '@/hooks/useDevis'
import { useClients } from '@/hooks/useClients'
import type { Devis as DevisApi, DevisLigne } from '@/hooks/useDevis'

// ── Types ──────────────────────────────────────────────────────────────────────

type DevisRecord = DevisApi & Record<string, unknown>
type DevisStatut = 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'expire'
type Categorie = 'materiaux' | 'main-oeuvre' | 'equipement'

// ── Constants ─────────────────────────────────────────────────────────────────

const TVA = 0.1925
const PRODUITS_CATALOG = ['Châssis métallique', 'Porte en fer forgé', 'Grille sécurité fenêtre', 'Portail coulissant', 'Escalier métallique', 'Structure acier soudée', 'Clôture grillagée', 'Tôle galvanisée', 'Aluminium 6060 T5', 'Fer plat 40×4']

// ── Utils ──────────────────────────────────────────────────────────────────────

interface LocalLigne { id: string; designation: string; categorie: Categorie; quantite: number; prixUnitaire: number }

function calcTotals(lignes: LocalLigne[]) {
  const totalHT = lignes.reduce((s, l) => s + l.quantite * l.prixUnitaire, 0)
  return { totalHT, tva: totalHT * TVA, totalTTC: totalHT * (1 + TVA) }
}

function devisTotalTTC(d: DevisRecord) {
  return d.montant_ttc_xaf as number
}

// ── Table columns ─────────────────────────────────────────────────────────────

function buildTableCols(onTransformer: (id: string) => void): Column<DevisRecord>[] {
  return [
    { id: 'reference', header: 'Référence', accessor: 'reference',     render: (v) => <span className="font-mono text-xs font-semibold">{v as string}</span> },
    { id: 'client',    header: 'Client',    accessor: (r) => r.client.nom, render: (v) => <span className="font-medium text-sm">{v as string}</span> },
    { id: 'date',      header: 'Date',      accessor: 'date_creation',  render: (v) => <span className="text-xs text-gray-500">{formatDate(v as string)}</span> },
    { id: 'validite',  header: 'Validité',  accessor: 'validite_jours', render: (v) => <span className="text-xs">{v as number} jours</span> },
    { id: 'montant',   header: 'Total TTC', accessor: 'montant_ttc_xaf', render: (v) => <span className="font-semibold">{formatXAF(v as number)}</span> },
    { id: 'statut',    header: 'Statut',    accessor: 'statut',          render: (v) => <StatusBadge status={v as string} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="WhatsApp PDF" className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors"><MessageCircle className="h-3.5 w-3.5" /></button>
          {(row.statut === 'accepte') && (
            <button title="Transformer en commande" onClick={() => onTransformer(row.id as string)}
              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <button title="Dupliquer"  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Copy    className="h-3.5 w-3.5" /></button>
          <button title="Archiver"   className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><Archive className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  ]
}

// ── Multi-step form ───────────────────────────────────────────────────────────

const STEPS = ['Client', 'Lignes', 'Conditions', 'Aperçu']
const CAT_LABELS: Record<Categorie, string> = { materiaux: 'Matériaux', 'main-oeuvre': 'Main-d\'œuvre', equipement: 'Équipement' }

interface FormState {
  clientMode: 'existing' | 'new'
  clientId: string
  clientNom: string
  newClient: { nom: string; tel: string; type: string }
  lignes: LocalLigne[]
  validite: 15 | 30 | 45
  acompte: number
  conditionsPaiement: string
}

const newLine = (): LocalLigne => ({ id: Math.random().toString(36).slice(2), designation: '', categorie: 'materiaux', quantite: 1, prixUnitaire: 0 })

const DEFAULT_FORM: FormState = {
  clientMode: 'existing', clientId: '', clientNom: '',
  newClient: { nom: '', tel: '', type: 'entreprise' },
  lignes: [newLine()], validite: 30, acompte: 30, conditionsPaiement: 'Acompte + solde à la livraison',
}

function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 transition-colors"
                style={{ backgroundColor: i <= step ? '#C62828' : '#e5e7eb', color: i <= step ? '#fff' : '#9ca3af' }}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className="text-xs font-medium hidden sm:inline" style={{ color: i <= step ? '#C62828' : '#9ca3af' }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px" style={{ backgroundColor: i < step ? '#C62828' : '#e5e7eb' }} />}
          </React.Fragment>
        ))}
      </div>
      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: '#C62828' }}
          animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.3 }} />
      </div>
    </div>
  )
}

function DevisForm({ onClose }: { onClose: () => void }) {
  const { data: clientsData } = useClients()
  const clients = clientsData?.data ?? []

  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)

  const stepValid = [
    form.clientMode === 'existing' ? form.clientId !== '' : form.newClient.nom !== '',
    form.lignes.some((l) => l.designation && l.prixUnitaire > 0),
    true,
    true,
  ][step] ?? true

  const updateLine = (id: string, field: keyof LocalLigne, value: string | number | Categorie) =>
    setForm((f) => ({ ...f, lignes: f.lignes.map((l) => l.id === id ? { ...l, [field]: value } : l) }))

  const { totalHT, tva, totalTTC } = calcTotals(form.lignes)
  const client = form.clientMode === 'existing' ? form.clientNom : form.newClient.nom

  return (
    <SlideOver isOpen={true} onClose={onClose} title="Créer un devis" width="xl">
      <StepProgress step={step} />

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
          {/* Step 0 — Client */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['existing', 'new'] as const).map((mode) => (
                  <button key={mode} onClick={() => setForm((f) => ({ ...f, clientMode: mode }))}
                    className="py-2.5 rounded-xl border-2 text-sm font-medium transition-all"
                    style={{ borderColor: form.clientMode === mode ? '#C62828' : '#e5e7eb', backgroundColor: form.clientMode === mode ? '#FFEBEE' : 'transparent', color: form.clientMode === mode ? '#C62828' : '#6b7280' }}>
                    {mode === 'existing' ? 'Client existant' : 'Nouveau client'}
                  </button>
                ))}
              </div>
              {form.clientMode === 'existing' ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client</label>
                  <select value={form.clientId}
                    onChange={(e) => {
                      const c = clients.find((cl) => cl.id === e.target.value)
                      setForm((f) => ({ ...f, clientId: e.target.value, clientNom: c?.nom ?? '' }))
                    }}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                    <option value="">Sélectionner un client...</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
              ) : (
                <div className="space-y-3 p-3 bg-gray-50 rounded-xl">
                  {[{ label: 'Nom / Raison sociale', key: 'nom', type: 'text', placeholder: 'Ex : SARL Biyong' }, { label: 'Téléphone', key: 'tel', type: 'tel', placeholder: '+237 6XX XXX XXX' }].map(({ label, key, type, placeholder }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{label}</label>
                      <input type={type} placeholder={placeholder} value={form.newClient[key as keyof typeof form.newClient]}
                        onChange={(e) => setForm((f) => ({ ...f, newClient: { ...f.newClient, [key]: e.target.value } }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1 — Lignes */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                {form.lignes.map((ligne) => (
                  <div key={ligne.id} className="p-3 bg-gray-50 rounded-xl space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input type="text" list={`catalog-${ligne.id}`} placeholder="Désignation..." value={ligne.designation}
                          onChange={(e) => updateLine(ligne.id, 'designation', e.target.value)}
                          className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                        <datalist id={`catalog-${ligne.id}`}>{PRODUITS_CATALOG.map((p) => <option key={p} value={p} />)}</datalist>
                      </div>
                      {form.lignes.length > 1 && (
                        <button onClick={() => setForm((f) => ({ ...f, lignes: f.lignes.filter((l) => l.id !== ligne.id) }))}
                          className="text-gray-300 hover:text-[#C62828] transition-colors p-1">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <select value={ligne.categorie} onChange={(e) => updateLine(ligne.id, 'categorie', e.target.value as Categorie)}
                        className="col-span-2 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                        {(Object.entries(CAT_LABELS) as [Categorie, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input type="number" min="1" value={ligne.quantite} placeholder="Qté"
                        onChange={(e) => updateLine(ligne.id, 'quantite', Math.max(1, Number(e.target.value)))}
                        className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                      <input type="number" min="0" value={ligne.prixUnitaire || ''} placeholder="P.U."
                        onChange={(e) => updateLine(ligne.id, 'prixUnitaire', Number(e.target.value))}
                        className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                    </div>
                    <div className="text-right text-xs font-semibold text-[#212121]">= {formatXAF(ligne.quantite * ligne.prixUnitaire)}</div>
                  </div>
                ))}
                <button onClick={() => setForm((f) => ({ ...f, lignes: [...f.lignes, newLine()] }))}
                  className="flex items-center gap-1.5 text-sm text-[#C62828] hover:underline font-medium">
                  <Plus className="h-4 w-4" /> Ajouter une ligne
                </button>
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-4 py-3 space-y-1">
                  <div className="flex justify-between text-sm text-gray-500"><span>Total HT</span><span>{formatXAF(totalHT)}</span></div>
                  <div className="flex justify-between text-sm text-gray-500"><span>TVA 19.25%</span><span>{formatXAF(tva)}</span></div>
                  <div className="flex justify-between text-base font-bold text-[#212121]"><span>Total TTC</span><span style={{ color: '#C62828' }}>{formatXAF(totalTTC)}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Conditions */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Validité du devis</label>
                <div className="grid grid-cols-3 gap-2">
                  {([15, 30, 45] as const).map((v) => (
                    <button key={v} onClick={() => setForm((f) => ({ ...f, validite: v }))}
                      className="py-2.5 rounded-xl border-2 text-sm font-medium transition-all"
                      style={{ borderColor: form.validite === v ? '#C62828' : '#e5e7eb', backgroundColor: form.validite === v ? '#FFEBEE' : 'transparent', color: form.validite === v ? '#C62828' : '#6b7280' }}>
                      {v} jours
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Acompte requis : <span className="text-[#C62828] font-bold">{form.acompte}%</span>
                  {' '}= {formatXAF(totalTTC * form.acompte / 100)}
                </label>
                <input type="range" min="0" max="100" step="5" value={form.acompte}
                  onChange={(e) => setForm((f) => ({ ...f, acompte: Number(e.target.value) }))}
                  className="w-full accent-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Conditions de paiement</label>
                <select value={form.conditionsPaiement} onChange={(e) => setForm((f) => ({ ...f, conditionsPaiement: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                  {['Comptant à la commande', 'Acompte + solde à la livraison', '30 jours facture', '60 jours facture', 'À définir'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 3 — Aperçu */}
          {step === 3 && (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 space-y-4 text-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-black" style={{ color: '#C62828' }}>FORGE</div>
                  <div className="text-xs text-gray-400">TAFDIL · Douala, Cameroun</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-[#212121]">DEVIS</div>
                  <div className="text-xs text-gray-400">{new Date().toLocaleDateString('fr-CM', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 uppercase font-semibold mb-0.5">Client</div>
                <div className="font-semibold text-[#212121]">{client || '—'}</div>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: '#C62828' }}>
                    {['Désignation', 'Qté', 'P.U.', 'Total HT'].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left text-xs font-semibold text-white">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.lignes.filter((l) => l.designation).map((l) => (
                    <tr key={l.id} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-xs">{l.designation} <span className="text-gray-400">({CAT_LABELS[l.categorie]})</span></td>
                      <td className="px-2 py-1.5 text-xs text-center">{l.quantite}</td>
                      <td className="px-2 py-1.5 text-xs text-right">{formatXAF(l.prixUnitaire)}</td>
                      <td className="px-2 py-1.5 text-xs text-right font-semibold">{formatXAF(l.quantite * l.prixUnitaire)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-500"><span>Total HT</span><span>{formatXAF(totalHT)}</span></div>
                <div className="flex justify-between text-gray-500"><span>TVA 19.25%</span><span>{formatXAF(tva)}</span></div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-gray-200">
                  <span>Total TTC</span><span style={{ color: '#C62828' }}>{formatXAF(totalTTC)}</span>
                </div>
              </div>
              <div className="text-xs text-gray-400 pt-1 border-t border-gray-100">
                Validité : {form.validite} jours · Conditions : {form.conditionsPaiement}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
        <Button variant="ghost" className="flex-1" onClick={() => step > 0 ? setStep((s) => s - 1) : onClose()}>
          {step > 0 ? <><ChevronLeft className="h-4 w-4" /> Retour</> : 'Annuler'}
        </Button>
        {step < 3 ? (
          <Button className="flex-1" disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
            Suivant <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="flex-1" onClick={onClose}>
            <Check className="h-4 w-4" /> Enregistrer le devis
          </Button>
        )}
      </div>
    </SlideOver>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Devis() {
  const [formOpen, setFormOpen] = useState(false)

  const { data, isLoading } = useDevis()
  const transformer = useTransformerDevis()

  const devis     = (data?.data ?? []) as DevisRecord[]
  const volume    = devis.reduce((s, d) => s + devisTotalTTC(d), 0)
  const tableCols = useMemo(() => buildTableCols((id) => transformer.mutate(id)), [transformer])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Devis"
        subtitle={`${data?.total ?? 0} devis · ${formatXAF(volume)} en volume`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Devis' }]}
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouveau devis
          </Button>
        }
      />

      <DataTable<DevisRecord> columns={tableCols} data={devis} keyField="id" loading={isLoading} />

      {formOpen && <DevisForm onClose={() => setFormOpen(false)} />}
    </motion.div>
  )
}
