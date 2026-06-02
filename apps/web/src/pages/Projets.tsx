import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Kanban, DollarSign, AlertTriangle, TrendingUp, Plus, Users, Package,
  Wrench, Truck, X, Trash2, Check, ChevronRight, UserCheck,
} from 'lucide-react'
import { PageHeader, KpiCard, DataTable, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useProjets, useCreateProjet, useUpdateProjetStatut, useProjetById,
  useProjetMembres, useAddMembreProjet, useRemoveMembreProjet,
  useProjetRessources, useAddRessourceProjet, useUpdateRessourceStatut, useDeleteRessourceProjet,
  useAddTacheProjet, useUpdateTacheStatut,
} from '@/hooks/useOperations'
import type { Projet, ProjetMembre, ProjetRessource, AddRessourcePayload } from '@/hooks/useOperations'
import { useClients } from '@/hooks/useClients'
import { useEmployes } from '@/hooks/useRH'
import { useAuth } from '@/context/AuthContext'
import { ClientCombobox } from '@/components/shared/ClientCombobox'
import type { Client } from '@/hooks/useClients'

// ── Types ──────────────────────────────────────────────────────────────────────

type ProjetRecord = Projet & Record<string, unknown>

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  planifie: { label: 'Planifié',  color: '#6b7280', bg: '#f3f4f6' },
  en_cours: { label: 'En cours',  color: '#d97706', bg: '#fef3c7' },
  suspendu: { label: 'Suspendu',  color: '#dc2626', bg: '#fee2e2' },
  livre:    { label: 'Livré',     color: '#15803d', bg: '#dcfce7' },
  annule:   { label: 'Annulé',    color: '#6b7280', bg: '#f3f4f6' },
}

const TYPE_RESSOURCE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  main_oeuvre:  { label: 'Main-d\'œuvre',  icon: Users,   color: '#1d4ed8' },
  intrant:      { label: 'Intrant',         icon: Package, color: '#15803d' },
  consommable:  { label: 'Consommable',     icon: Package, color: '#d97706' },
  equipement:   { label: 'Équipement',      icon: Wrench,  color: '#7c3aed' },
  sous_traitant:{ label: 'Sous-traitant',   icon: Truck,   color: '#dc2626' },
}

const STATUT_RESS_COLORS: Record<string, { bg: string; text: string }> = {
  planifie:   { bg: '#f3f4f6', text: '#6b7280' },
  disponible: { bg: '#dcfce7', text: '#15803d' },
  en_cours:   { bg: '#dbeafe', text: '#1d4ed8' },
  utilise:    { bg: '#ede9fe', text: '#7c3aed' },
  manquant:   { bg: '#fee2e2', text: '#dc2626' },
}

// ── Onglet Ressources ─────────────────────────────────────────────────────────

function OngletRessources({ projetId, canEdit }: { projetId: string; canEdit: boolean }) {
  const { data: employes }    = useEmployes()
  const { data: ressData, isLoading } = useProjetRessources(projetId)
  const addRessource          = useAddRessourceProjet()
  const deleteRessource       = useDeleteRessourceProjet()
  const updateStatut          = useUpdateRessourceStatut()

  const [showForm,  setShowForm]  = useState(false)
  const [typeForm,  setTypeForm]  = useState<AddRessourcePayload['type']>('main_oeuvre')
  const [form, setForm] = useState({
    designation: '', employe_id: '', quantite: 1, unite: 'unité',
    cout_unitaire_xaf: 0, notes: '',
  })

  const ressources = ressData?.data ?? []
  const totalCout  = ressData?.total_cout_xaf ?? 0

  const handleAdd = () => {
    if (!form.designation.trim() && typeForm !== 'main_oeuvre') {
      toast.error('La désignation est obligatoire')
      return
    }

    let designation = form.designation.trim()
    // Pour main-d'œuvre, utiliser le nom de l'employé si sélectionné
    if (typeForm === 'main_oeuvre' && form.employe_id) {
      const emp = (employes?.data ?? []).find((e) => e.id === form.employe_id)
      if (emp && !designation) designation = emp.nom
    }

    addRessource.mutate(
      {
        projetId,
        payload: {
          type:              typeForm,
          designation:       designation || `${TYPE_RESSOURCE[typeForm]?.label} #${ressources.length + 1}`,
          employe_id:        typeForm === 'main_oeuvre' ? (form.employe_id || undefined) : undefined,
          quantite:          form.quantite,
          unite:             form.unite,
          cout_unitaire_xaf: form.cout_unitaire_xaf,
          notes:             form.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          setShowForm(false)
          setForm({ designation: '', employe_id: '', quantite: 1, unite: 'unité', cout_unitaire_xaf: 0, notes: '' })
        },
      },
    )
  }

  // Grouper par type
  const grouped = useMemo(() => {
    const g: Record<string, ProjetRessource[]> = {}
    for (const r of ressources) {
      if (!g[r.type]) g[r.type] = []
      g[r.type].push(r)
    }
    return g
  }, [ressources])

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Chargement…</div>

  return (
    <div className="space-y-4">
      {/* Récap budget */}
      {totalCout > 0 && (
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">Coût total des ressources</span>
          <span className="text-sm font-bold text-[#C62828]">{formatXAF(totalCout)}</span>
        </div>
      )}

      {/* Bouton ajouter */}
      {canEdit && (
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-[#C62828] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter une ressource
        </button>
      )}

      {/* Formulaire ajout */}
      {showForm && canEdit && (
        <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
          {/* Type */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(TYPE_RESSOURCE).map(([k, v]) => (
              <button key={k} onClick={() => setTypeForm(k as AddRessourcePayload['type'])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all"
                style={{
                  borderColor: typeForm === k ? v.color : '#e5e7eb',
                  backgroundColor: typeForm === k ? `${v.color}15` : 'transparent',
                  color: typeForm === k ? v.color : '#6b7280',
                }}>
                <v.icon className="h-3 w-3" /> {v.label}
              </button>
            ))}
          </div>

          {/* Employé si main-d'œuvre */}
          {typeForm === 'main_oeuvre' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Employé</label>
              <select value={form.employe_id}
                onChange={(e) => {
                  const emp = (employes?.data ?? []).find((x) => x.id === e.target.value)
                  setForm((f) => ({
                    ...f,
                    employe_id:        e.target.value,
                    designation:       emp?.nom ?? '',
                    cout_unitaire_xaf: emp?.salaire_base_xaf ? Math.round(emp.salaire_base_xaf / 22) : 0,
                    unite:             'jour',
                  }))
                }}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                <option value="">— Sélectionner un employé —</option>
                {(employes?.data ?? []).filter((e) => e.statut === 'actif').map((e) => (
                  <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>
                ))}
              </select>
            </div>
          )}

          {/* Désignation */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              Désignation {typeForm !== 'main_oeuvre' && '*'}
            </label>
            <input value={form.designation}
              onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
              placeholder={typeForm === 'main_oeuvre' ? 'Auto depuis employé ou saisir' : 'ex. Ciment Portland 42.5'}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Quantité</label>
              <input type="number" min="0.01" step="0.01" value={form.quantite}
                onChange={(e) => setForm((f) => ({ ...f, quantite: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Unité</label>
              <input value={form.unite}
                onChange={(e) => setForm((f) => ({ ...f, unite: e.target.value }))}
                placeholder="jour, kg, m²…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">P.U. (XAF)</label>
              <input type="number" min="0" value={form.cout_unitaire_xaf}
                onChange={(e) => setForm((f) => ({ ...f, cout_unitaire_xaf: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          {form.quantite > 0 && form.cout_unitaire_xaf > 0 && (
            <p className="text-xs text-gray-500 text-right">
              Coût total : <span className="font-semibold text-[#212121]">{formatXAF(form.quantite * form.cout_unitaire_xaf)}</span>
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button onClick={handleAdd} disabled={addRessource.isPending}
              className="flex-1 px-3 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#C62828' }}>
              {addRessource.isPending ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </div>
      )}

      {/* Liste par type */}
      {ressources.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Package className="h-8 w-8 mx-auto mb-2 text-gray-200" />
          Aucune ressource assignée
        </div>
      ) : (
        Object.entries(grouped).map(([type, items]) => {
          const meta = TYPE_RESSOURCE[type] ?? { label: type, icon: Package, color: '#6b7280' }
          const sousTotal = items.reduce((s, r) => s + r.quantite * r.cout_unitaire_xaf, 0)
          return (
            <div key={type} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <meta.icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                  <span className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="text-xs text-gray-400">({items.length})</span>
                </div>
                <span className="text-xs font-semibold text-gray-500">{formatXAF(sousTotal)}</span>
              </div>
              {items.map((r) => {
                const sc = STATUT_RESS_COLORS[r.statut] ?? STATUT_RESS_COLORS.planifie
                return (
                  <div key={r.id} className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#212121] truncate">{r.designation}</p>
                      <p className="text-xs text-gray-400">{r.quantite} {r.unite} × {formatXAF(r.cout_unitaire_xaf)}</p>
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: sc.bg, color: sc.text }}>
                      {r.statut}
                    </span>
                    {canEdit && (
                      <div className="flex gap-1 shrink-0">
                        {r.statut !== 'utilise' && (
                          <button title="Marquer utilisé"
                            onClick={() => updateStatut.mutate({ projetId, ressourceId: r.id, statut: 'utilise' })}
                            className="p-1 rounded text-green-500 hover:bg-green-50 transition-colors">
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                        <button title="Supprimer"
                          onClick={() => deleteRessource.mutate({ projetId, ressourceId: r.id })}
                          className="p-1 rounded text-red-400 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Onglet Tâches ─────────────────────────────────────────────────────────────

const PRIORITE_COLORS: Record<string, { bg: string; text: string }> = {
  basse:    { bg: '#f3f4f6', text: '#6b7280' },
  normale:  { bg: '#dbeafe', text: '#1d4ed8' },
  haute:    { bg: '#fef3c7', text: '#d97706' },
  critique: { bg: '#fee2e2', text: '#dc2626' },
}

const STATUT_TACHE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  todo:     { bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
  en_cours: { bg: '#fef3c7', text: '#d97706', dot: '#d97706' },
  done:     { bg: '#dcfce7', text: '#15803d', dot: '#15803d' },
  bloque:   { bg: '#fee2e2', text: '#dc2626', dot: '#dc2626' },
}

const STATUT_TACHE_LABELS: Record<string, string> = {
  todo: 'À faire', en_cours: 'En cours', done: 'Terminé', bloque: 'Bloqué',
}

function OngletTaches({
  projetId, taches, canEdit,
}: {
  projetId: string
  taches: Array<{ id: string; titre: string; statut: string; priorite: string; date_echeance?: string | null }>
  canEdit: boolean
}) {
  const addTache     = useAddTacheProjet()
  const updateStatut = useUpdateTacheStatut()

  const [showForm,   setShowForm]   = useState(false)
  const [titre,      setTitre]      = useState('')
  const [priorite,   setPriorite]   = useState('normale')
  const [echeance,   setEcheance]   = useState('')
  const [description,setDescription]= useState('')

  const handleAdd = () => {
    if (!titre.trim()) { return }
    addTache.mutate(
      {
        projetId,
        payload: {
          titre:        titre.trim(),
          description:  description || undefined,
          priorite,
          date_echeance: echeance || undefined,
        },
      },
      {
        onSuccess: () => {
          setShowForm(false)
          setTitre(''); setPriorite('normale'); setEcheance(''); setDescription('')
        },
      },
    )
  }

  const sorted = [...taches].sort((a, b) => {
    const order: Record<string, number> = { critique: 0, haute: 1, normale: 2, basse: 3 }
    return (order[a.priorite] ?? 99) - (order[b.priorite] ?? 99)
  })

  return (
    <div className="space-y-3">
      {/* Résumé */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs">
          {Object.entries(STATUT_TACHE_LABELS).map(([k, l]) => {
            const count = taches.filter((t) => t.statut === k).length
            const sc    = STATUT_TACHE_COLORS[k]
            return count > 0 ? (
              <span key={k} className="flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: sc.bg, color: sc.text }}>
                {count} {l}
              </span>
            ) : null
          })}
        </div>
        {canEdit && (
          <button onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-[#C62828] hover:underline">
            <Plus className="h-3.5 w-3.5" /> Nouvelle tâche
          </button>
        )}
      </div>

      {/* Formulaire ajout */}
      {showForm && canEdit && (
        <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Titre *</label>
            <input value={titre} onChange={(e) => setTitre(e.target.value)}
              placeholder="ex. Réaliser les fondations"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Priorité</label>
              <select value={priorite} onChange={(e) => setPriorite(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
                <option value="critique">Critique</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Échéance</label>
              <input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="Détails optionnels…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button onClick={handleAdd} disabled={!titre.trim() || addTache.isPending}
              className="flex-1 px-3 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#C62828' }}>
              {addTache.isPending ? 'Ajout…' : 'Ajouter la tâche'}
            </button>
          </div>
        </div>
      )}

      {/* Liste tâches */}
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Kanban className="h-8 w-8 mx-auto mb-2 text-gray-200" />
          Aucune tâche — cliquez sur "Nouvelle tâche" pour commencer
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => {
            const sc = STATUT_TACHE_COLORS[t.statut] ?? STATUT_TACHE_COLORS.todo
            const pc = PRIORITE_COLORS[t.priorite]  ?? PRIORITE_COLORS.normale
            return (
              <div key={t.id}
                className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sc.dot }} />
                <p className="text-sm flex-1 text-[#212121]" style={{ textDecoration: t.statut === 'done' ? 'line-through' : 'none', opacity: t.statut === 'done' ? 0.5 : 1 }}>
                  {t.titre}
                </p>
                {t.date_echeance && (
                  <span className="text-[10px] text-gray-400 shrink-0">{t.date_echeance}</span>
                )}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: pc.bg, color: pc.text }}>
                  {t.priorite}
                </span>
                {canEdit && (
                  <select value={t.statut}
                    onChange={(e) => updateStatut.mutate({ projetId, tacheId: t.id, statut: e.target.value })}
                    className="text-[10px] border border-gray-200 rounded-lg px-1.5 py-0.5 bg-white focus:outline-none shrink-0"
                    style={{ color: sc.text }}>
                    {Object.entries(STATUT_TACHE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Onglet Équipe ─────────────────────────────────────────────────────────────

const ROLE_PROJET_LABELS: Record<string, string> = {
  chef_projet:   'Chef de projet', assistant: 'Assistant', technicien: 'Technicien',
  stagiaire:     'Stagiaire',       sous_traitant: 'Sous-traitant',
}

function OngletEquipe({ projetId, canEdit }: { projetId: string; canEdit: boolean }) {
  const { data: employes } = useEmployes()
  const { data: membresData, isLoading } = useProjetMembres(projetId)
  const addMembre    = useAddMembreProjet()
  const removeMembre = useRemoveMembreProjet()

  const [showForm,     setShowForm]     = useState(false)
  const [employeId,    setEmployeId]    = useState('')
  const [roleProjet,   setRoleProjet]   = useState('technicien')
  const [heuresPlan,   setHeuresPlan]   = useState(0)

  const membres = membresData?.data ?? []

  const handleAdd = () => {
    if (!employeId) { toast.error('Sélectionnez un employé'); return }
    addMembre.mutate(
      { projetId, employe_id: employeId, role_projet: roleProjet, heures_planifiees: heuresPlan },
      { onSuccess: () => { setShowForm(false); setEmployeId(''); setHeuresPlan(0) } },
    )
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Chargement…</div>

  return (
    <div className="space-y-3">
      {canEdit && (
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-[#C62828] hover:underline">
          <Plus className="h-3.5 w-3.5" /> Ajouter un membre
        </button>
      )}

      {showForm && canEdit && (
        <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Employé *</label>
            <select value={employeId} onChange={(e) => setEmployeId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">— Sélectionner —</option>
              {(employes?.data ?? []).filter((e) => e.statut === 'actif').map((e) => (
                <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Rôle</label>
              <select value={roleProjet} onChange={(e) => setRoleProjet(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                {Object.entries(ROLE_PROJET_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Heures planifiées</label>
              <input type="number" min="0" value={heuresPlan} onChange={(e) => setHeuresPlan(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              Annuler
            </button>
            <button onClick={handleAdd} disabled={addMembre.isPending}
              className="flex-1 px-3 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#C62828' }}>
              {addMembre.isPending ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </div>
      )}

      {membres.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Users className="h-8 w-8 mx-auto mb-2 text-gray-200" />
          Aucun membre assigné
        </div>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          {membres.map((m: ProjetMembre) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
              <div className="w-8 h-8 rounded-full bg-[#ECEFF1] flex items-center justify-center text-[#37474F] text-xs font-bold shrink-0">
                {(m.employes?.nom ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#212121] truncate">{m.employes?.nom ?? '—'}</p>
                <p className="text-xs text-gray-400">{m.employes?.poste} · {ROLE_PROJET_LABELS[m.role_projet] ?? m.role_projet}</p>
              </div>
              {m.heures_planifiees > 0 && (
                <span className="text-xs text-gray-400 shrink-0">{m.heures_planifiees}h</span>
              )}
              {canEdit && (
                <button onClick={() => removeMembre.mutate({ projetId, employeId: m.employe_id })}
                  className="p-1 rounded text-red-400 hover:bg-red-50 transition-colors shrink-0">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panneau détail projet ──────────────────────────────────────────────────────

function ProjetDetailPanel({
  projet, onClose, role,
}: {
  projet: ProjetRecord; onClose: () => void; role: string | null
}) {
  const [activeTab, setActiveTab] = useState<'infos' | 'equipe' | 'ressources' | 'taches'>('infos')
  const updateStatut = useUpdateProjetStatut()
  const canEdit = role === 'admin' || role === 'superviseur'
  const sc = STATUT_MAP[projet.statut as string] ?? STATUT_MAP.planifie

  // Charger le détail du projet (avec tâches à jour)
  const { data: projetDetail } = useProjetById(projet.id as string)
  const taches = ((projetDetail?.taches_projet ?? projet.taches_projet ?? []) as Array<{ id: string; titre: string; statut: string; priorite: string; date_echeance?: string | null }>)

  const TABS = [
    { id: 'infos',     label: 'Infos' },
    { id: 'equipe',    label: 'Équipe' },
    { id: 'ressources',label: 'Ressources' },
    { id: 'taches',    label: `Tâches${taches.length > 0 ? ` (${taches.length})` : ''}` },
  ] as const

  return (
    <SlideOver isOpen={true} onClose={onClose} title={projet.nom as string} width="lg">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400">{(projet.client_nom as string) ?? '—'}</p>
            <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full mt-1"
              style={{ backgroundColor: sc.bg, color: sc.color }}>{sc.label}</span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Budget</p>
            <p className="text-base font-bold text-[#C62828]">{formatXAF(projet.budget_xaf as number)}</p>
            {(projet.depense_xaf as number) > 0 && (
              <p className="text-xs text-gray-400">Dépensé : {formatXAF(projet.depense_xaf as number)}</p>
            )}
          </div>
        </div>

        {/* Avancement */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Avancement</span>
            <span className="font-semibold">{projet.avancement_pct as number}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${projet.avancement_pct as number}%`, backgroundColor: '#C62828' }} />
          </div>
        </div>

        {/* Changement statut (admin/directeur) */}
        {canEdit && !['livre', 'annule'].includes(projet.statut as string) && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STATUT_MAP).filter(([k]) => k !== projet.statut && !['planifie'].includes(k)).map(([k, v]) => (
              <button key={k}
                onClick={() => updateStatut.mutate({ id: projet.id as string, statut: k as Projet['statut'] }, { onSuccess: onClose })}
                disabled={updateStatut.isPending}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors"
                style={{ borderColor: v.color, color: v.color, backgroundColor: `${v.color}15` }}>
                → {v.label}
              </button>
            ))}
          </div>
        )}

        {/* Onglets */}
        <div className="border-b border-gray-100">
          <div className="flex gap-4">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className="pb-2 text-xs font-semibold border-b-2 transition-colors"
                style={{ borderColor: activeTab === t.id ? '#C62828' : 'transparent', color: activeTab === t.id ? '#C62828' : '#9ca3af' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>

            {activeTab === 'infos' && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: 'Client',       value: (projet.client_nom as string) ?? '—' },
                  { label: 'Chef projet',  value: (projet.chef_projet_nom as string) ?? '—' },
                  { label: 'Début',        value: projet.date_debut ? formatDate(projet.date_debut as string) : '—' },
                  { label: 'Échéance',     value: projet.deadline ? formatDate(projet.deadline as string) : '—' },
                  { label: 'Budget',       value: formatXAF(projet.budget_xaf as number) },
                  { label: 'Dépenses',     value: formatXAF(projet.depense_xaf as number) },
                  { label: 'Avancement',   value: `${projet.avancement_pct as number}%` },
                  { label: 'Statut',       value: sc.label },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">{label}</p>
                    <p className="font-semibold text-[#212121]">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'equipe' && (
              <OngletEquipe projetId={projet.id as string} canEdit={canEdit} />
            )}

            {activeTab === 'ressources' && (
              <OngletRessources projetId={projet.id as string} canEdit={canEdit} />
            )}

            {activeTab === 'taches' && (
              <OngletTaches
                projetId={projet.id as string}
                taches={taches}
                canEdit={canEdit}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </SlideOver>
  )
}

// ── Formulaire création projet ─────────────────────────────────────────────────

function NouveauProjetForm({ onClose }: { onClose: () => void }) {
  const { data: employes } = useEmployes()
  const createProjet = useCreateProjet()

  const [clientNom,   setClientNom]   = useState('')
  const [clientId,    setClientId]    = useState<string | undefined>()
  const [chefId,      setChefId]      = useState('')
  const [chefNom,     setChefNom]     = useState('')
  const [nom,         setNom]         = useState('')
  const [description, setDescription] = useState('')
  const [budget,      setBudget]      = useState(0)
  const [dateDebut,   setDateDebut]   = useState('')
  const [deadline,    setDeadline]    = useState('')

  const formValid = nom.trim() !== '' && clientNom.trim() !== '' && deadline !== ''

  const handleCreate = () => {
    if (!formValid) return
    createProjet.mutate({
      nom:              nom.trim(),
      description:      description || undefined,
      client_id:        clientId,
      client_nom:       clientNom.trim(),
      chef_projet_id:   chefId   || undefined,
      chef_projet_nom:  chefNom  || undefined,
      budget_xaf:       budget,
      date_debut:       dateDebut || undefined,
      deadline,
    }, { onSuccess: onClose })
  }

  return (
    <SlideOver isOpen={true} onClose={onClose} title="Nouveau projet" width="md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom du projet *</label>
          <input value={nom} onChange={(e) => setNom(e.target.value)}
            placeholder="ex. Hangar industriel Bassa"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client *</label>
          <ClientCombobox
            value={clientNom}
            onChange={setClientNom}
            onClientSelect={(c: Client | null) => { setClientId(c?.id); setClientNom(c?.nom ?? clientNom) }}
            placeholder="Rechercher un client…"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Chef de projet</label>
          <select value={chefId}
            onChange={(e) => {
              const emp = (employes?.data ?? []).find((x) => x.id === e.target.value)
              setChefId(e.target.value)
              setChefNom(emp?.nom ?? '')
            }}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
            <option value="">— Sélectionner —</option>
            {(employes?.data ?? []).filter((e) => e.statut === 'actif').map((e) => (
              <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="Objectif, périmètre du projet…"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Budget (XAF)</label>
            <input type="number" min="0" value={budget} onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Début</label>
            <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Échéance *</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
        </div>

        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button className="flex-1" disabled={!formValid || createProjet.isPending} onClick={handleCreate}>
            {createProjet.isPending ? 'Création…' : 'Créer le projet'}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function Projets() {
  const { role } = useAuth()
  const canAdmin = role === 'admin' || role === 'superviseur'

  const [formOpen,      setFormOpen]      = useState(false)
  const [selectedProjet,setSelectedProjet]= useState<ProjetRecord | null>(null)
  const [filtreStatut,  setFiltreStatut]  = useState('')

  const { data, isLoading } = useProjets({ statut: filtreStatut || undefined })
  const projets = (data?.data ?? []) as ProjetRecord[]

  const budgetTotal = projets.reduce((s, p) => s + p.budget_xaf, 0)
  const enRetard    = projets.filter((p) => p.statut === 'en_cours' && (p.avancement_pct as number) < 50).length
  const avgPct      = projets.length > 0
    ? Math.round(projets.reduce((s, p) => s + (p.avancement_pct as number), 0) / projets.length)
    : 0

  const COLUMNS: Column<ProjetRecord>[] = useMemo(() => [
    {
      id: 'nom', header: 'Projet', accessor: 'nom',
      render: (v, row) => (
        <div>
          <p className="text-sm font-semibold text-[#212121]">{v as string}</p>
          {(row.client_nom as string) && <p className="text-xs text-gray-400">{row.client_nom as string}</p>}
        </div>
      ),
    },
    {
      id: 'chef', header: 'Chef de projet', accessor: 'chef_projet_nom',
      render: (v) => <span className="text-sm text-gray-600">{(v as string) ?? '—'}</span>,
    },
    {
      id: 'budget', header: 'Budget', accessor: 'budget_xaf',
      render: (v, row) => {
        const alerte = row.alerte_budget as boolean
        return (
          <div>
            <span className="text-sm font-semibold">{formatXAF(v as number)}</span>
            {alerte && <AlertTriangle className="h-3 w-3 text-red-500 inline ml-1" title="Budget dépassé" />}
          </div>
        )
      },
    },
    {
      id: 'avancement', header: 'Avancement', accessor: 'avancement_pct',
      render: (v) => {
        const pct   = (v as number) ?? 0
        const color = pct === 100 ? '#15803d' : pct >= 50 ? '#d97706' : '#C62828'
        return (
          <div className="flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs font-semibold shrink-0" style={{ color }}>{pct}%</span>
          </div>
        )
      },
    },
    {
      id: 'deadline', header: 'Échéance', accessor: 'deadline',
      render: (v) => <span className="text-xs text-gray-500">{v ? formatDate(v as string) : '—'}</span>,
    },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: (v) => {
        const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
        return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
      },
    },
  ], [])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }} className="space-y-6">

      <PageHeader
        title="Projets"
        subtitle={`${projets.length} projets · Budget total : ${formatXAF(budgetTotal)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Projets' }]}
        actions={
          canAdmin ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nouveau projet
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Projets actifs"    value={projets.filter((p) => p.statut === 'en_cours').length}  icon={<Kanban className="h-5 w-5" />}    color="#C62828" delay={0} />
        <KpiCard title="Budget total"      value={formatXAF(budgetTotal)}                                 icon={<DollarSign className="h-5 w-5" />} color="#15803d" delay={0.07} />
        <KpiCard title="En retard"         value={enRetard}                                               icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trendValue={enRetard > 0 ? 'Attention' : 'RAS'} trend={enRetard > 0 ? 'down' : 'neutral'} delay={0.14} />
        <KpiCard title="Avancement moyen"  value={avgPct} unit="%"                                        icon={<TrendingUp className="h-5 w-5" />} color="#1d4ed8" delay={0.21} />
      </div>

      {/* Filtre */}
      <div className="flex gap-3">
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
          <option value="">Tous statuts</option>
          {Object.entries(STATUT_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <DataTable<ProjetRecord>
          columns={COLUMNS} data={projets} keyField="id" loading={isLoading}
          onRowClick={(row) => setSelectedProjet(row)}
        />
      </div>

      {/* Panneau détail */}
      {selectedProjet && (
        <ProjetDetailPanel
          projet={selectedProjet}
          role={role}
          onClose={() => setSelectedProjet(null)}
        />
      )}

      {/* Formulaire création */}
      {formOpen && <NouveauProjetForm onClose={() => setFormOpen(false)} />}
    </motion.div>
  )
}
