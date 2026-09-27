import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Plus, ChevronRight, ChevronDown, FolderTree, Pencil, Trash2, Layers, Ban, CheckCircle2,
  FileCog, Search, ShieldCheck, Archive,
} from 'lucide-react'
import { PageHeader, Button, SlideOver, Modal, StatusBadge, EmptyState, DataTable } from '@forge/ui'
import type { Column, StatusMap } from '@forge/ui'
import {
  useFamilles, useCreateFamille, useUpdateFamille,
  useModeles, useCreateModele, useUpdateModele,
  useModeleSpecifications, useCreateSpecification, useDeleteSpecification,
  useFichesTechniques, useCreateFicheTechnique, useUpdateFicheTechnique,
  useActiverFicheTechnique, useDeleteFicheTechnique,
  useFicheTechniqueRessources, useCreateRessource, useUpdateRessource, useDeleteRessource,
} from '@/hooks/useCatalogue'
import type {
  Famille, Modele, CreateFamillePayload, CreateModelePayload, TypeGamme,
  ModeCalcul, TypeRessource, CreateRessourcePayload,
} from '@/hooks/useCatalogue'
import { useStocks } from '@/hooks/useStocks'
import { formatXAF } from '@/lib/utils'
import { uniteOptions } from '@/lib/constants'
import {
  LIBELLES_MODE_COMMERCIAL, modeCommercialDepuisTypeGamme, libelleNiveauFamille, PROFONDEUR_MAX_FAMILLES,
} from '@forge/shared'

// ── Constantes ─────────────────────────────────────────────────────────────────

// Libellés issus du mode commercial (Standard / Configurable / Sur devis) :
// la valeur stockée reste type_gamme, la correspondance vit dans @forge/shared.
const libelleGamme = (t: TypeGamme) => LIBELLES_MODE_COMMERCIAL[modeCommercialDepuisTypeGamme(t)].libelle

const TYPE_GAMME_LABELS: Record<TypeGamme, string> = {
  catalogue:     libelleGamme('catalogue'),
  configuration: libelleGamme('configuration'),
  sur_mesure:    libelleGamme('sur_mesure'),
}

const TYPE_GAMME_MAP: StatusMap = {
  catalogue:     { label: TYPE_GAMME_LABELS.catalogue,     color: '#1d4ed8', bgColor: '#dbeafe' },
  configuration: { label: TYPE_GAMME_LABELS.configuration, color: '#15803d', bgColor: '#dcfce7' },
  sur_mesure:    { label: TYPE_GAMME_LABELS.sur_mesure,    color: '#6d28d9', bgColor: '#ede9fe' },
}

const DEFAULT_FAMILLE_FORM: CreateFamillePayload = { nom: '', type_gamme: 'catalogue', parent_id: null }
const DEFAULT_MODELE_FORM: CreateModelePayload = {
  famille_id: '', reference: '', designation: '', description: '', unite_facturation: 'unité',
}

const MODE_CALCUL_LABELS: Record<ModeCalcul, string> = {
  quantitatif: 'Quantité',
  surface:     'Surface (m²)',
  lineaire:    'Linéaire (m)',
  volume:      'Volume (m³)',
  poids:       'Poids (kg)',
  forfait:     'Forfait',
  qualitatif:  'Qualitatif',
}

const TYPE_RESSOURCE_LABELS: Record<TypeRessource, string> = {
  materiau:    'Matériau',
  main_oeuvre: "Main-d'œuvre",
  equipement:  'Équipement',
}

const STATUT_FICHE_MAP: StatusMap = {
  brouillon: { label: 'Brouillon', color: '#6b7280', bgColor: '#f3f4f6' },
  active:    { label: 'Active',    color: '#15803d', bgColor: '#dcfce7' },
  archivee:  { label: 'Archivée',  color: '#92400e', bgColor: '#fef3c7' },
}

const DEFAULT_RESSOURCE_FORM: CreateRessourcePayload = {
  type: 'materiau', ressource_produit_id: undefined, designation: '', unite: 'kg',
  quantite_par_unite: 1, cout_unitaire_reference_xaf: 0, temps_reference_h: undefined,
}

interface FamilleTreeNode extends Famille {
  children: FamilleTreeNode[]
}

function buildTree(familles: Famille[]): FamilleTreeNode[] {
  const nodes = new Map<string, FamilleTreeNode>(familles.map((f) => [f.id, { ...f, children: [] }]))
  const roots: FamilleTreeNode[] = []
  for (const f of familles) {
    const node = nodes.get(f.id)!
    if (f.parent_id && nodes.has(f.parent_id)) {
      nodes.get(f.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortByOrdre = (list: FamilleTreeNode[]) => {
    list.sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom))
    list.forEach((n) => sortByOrdre(n.children))
  }
  sortByOrdre(roots)
  return roots
}

// ── Nœud de l'arbre ────────────────────────────────────────────────────────────

function FamilleNodeRow({
  node, depth, expanded, onToggle, selectedId, onSelect, onAddChild, onEdit,
}: {
  node: FamilleTreeNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onAddChild: (parent: Famille) => void
  onEdit: (famille: Famille) => void
}) {
  const isExpanded = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-[#FFEBEE]' : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
          className="shrink-0 text-gray-400 hover:text-gray-600"
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <span className={`text-sm truncate ${isSelected ? 'font-semibold text-[#C62828]' : 'text-[#212121]'} ${!node.actif ? 'opacity-40' : ''}`}>
          {node.nom}
        </span>

        <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{libelleNiveauFamille(depth + 1)}</span>
        <StatusBadge status={node.type_gamme} map={TYPE_GAMME_MAP} />
        {!node.actif && <span title="Inactive"><Ban className="h-3 w-3 text-gray-400" /></span>}

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {depth + 1 < PROFONDEUR_MAX_FAMILLES && (
            <button onClick={() => onAddChild(node)} title={`Ajouter : ${libelleNiveauFamille(depth + 2)}`} className="p-1 rounded hover:bg-gray-200 text-gray-500">
              <Plus className="h-3 w-3" />
            </button>
          )}
          <button onClick={() => onEdit(node)} title="Modifier" className="p-1 rounded hover:bg-gray-200 text-gray-500">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {isExpanded && node.children.map((child) => (
        <FamilleNodeRow
          key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle}
          selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onEdit={onEdit}
        />
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Catalogue() {
  const { data: famillesData, isLoading: famillesLoading } = useFamilles()
  const familles = useMemo(() => famillesData?.data ?? [], [famillesData])
  const tree = useMemo(() => buildTree(familles), [familles])

  const createFamille = useCreateFamille()
  const updateFamille  = useUpdateFamille()

  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const selectedFamille = familles.find((f) => f.id === selectedId) ?? null

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Famille : création / édition ──────────────────────────────────────────
  const [familleSlideOpen, setFamilleSlideOpen] = useState(false)
  const [familleForm, setFamilleForm]           = useState<CreateFamillePayload>(DEFAULT_FAMILLE_FORM)
  const [editingFamilleId, setEditingFamilleId] = useState<string | null>(null)
  const [familleFormError, setFamilleFormError] = useState<string | null>(null)

  const openNewFamille = (parent?: Famille) => {
    setEditingFamilleId(null)
    setFamilleForm({ ...DEFAULT_FAMILLE_FORM, parent_id: parent?.id ?? null, type_gamme: parent?.type_gamme ?? 'catalogue' })
    setFamilleFormError(null)
    setFamilleSlideOpen(true)
    if (parent) setExpanded((prev) => new Set(prev).add(parent.id))
  }

  const openEditFamille = (famille: Famille) => {
    setEditingFamilleId(famille.id)
    setFamilleForm({ nom: famille.nom, type_gamme: famille.type_gamme, parent_id: famille.parent_id, ordre: famille.ordre, actif: famille.actif })
    setFamilleFormError(null)
    setFamilleSlideOpen(true)
  }

  const handleSaveFamille = () => {
    if (!familleForm.nom.trim()) { setFamilleFormError('Le nom est obligatoire'); return }
    setFamilleFormError(null)

    if (editingFamilleId) {
      updateFamille.mutate(
        { id: editingFamilleId, payload: familleForm },
        { onSuccess: () => setFamilleSlideOpen(false), onError: (err: Error) => setFamilleFormError(err.message) },
      )
    } else {
      createFamille.mutate(
        familleForm,
        {
          onSuccess: (created) => { setFamilleSlideOpen(false); setSelectedId(created.id) },
          onError: (err: Error) => setFamilleFormError(err.message),
        },
      )
    }
  }

  // ── Modèles de la famille sélectionnée ─────────────────────────────────────
  const { data: modelesData, isLoading: modelesLoading } = useModeles({ famille_id: selectedId ?? undefined, enabled: !!selectedId })
  const modeles = modelesData?.data ?? []

  const createModele = useCreateModele()
  const updateModele  = useUpdateModele()

  const [modeleSlideOpen, setModeleSlideOpen] = useState(false)
  const [modeleForm, setModeleForm]           = useState<CreateModelePayload>(DEFAULT_MODELE_FORM)
  const [editingModeleId, setEditingModeleId] = useState<string | null>(null)
  const [modeleFormError, setModeleFormError] = useState<string | null>(null)

  const openNewModele = () => {
    if (!selectedId) return
    setEditingModeleId(null)
    setModeleForm({ ...DEFAULT_MODELE_FORM, famille_id: selectedId })
    setModeleFormError(null)
    setModeleSlideOpen(true)
  }

  const openEditModele = (modele: Modele) => {
    setEditingModeleId(modele.id)
    setModeleForm({
      famille_id: modele.famille_id, reference: modele.reference, designation: modele.designation,
      description: modele.description ?? '', unite_facturation: modele.unite_facturation,
      type_gamme: modele.type_gamme ?? undefined, actif: modele.actif,
    })
    setModeleFormError(null)
    setModeleSlideOpen(true)
  }

  const handleSaveModele = () => {
    if (!modeleForm.reference.trim() || !modeleForm.designation.trim()) {
      setModeleFormError('Référence et désignation sont obligatoires')
      return
    }
    setModeleFormError(null)

    if (editingModeleId) {
      updateModele.mutate(
        { id: editingModeleId, payload: modeleForm },
        { onSuccess: () => setModeleSlideOpen(false), onError: (err: Error) => setModeleFormError(err.message) },
      )
    } else {
      createModele.mutate(
        modeleForm,
        { onSuccess: () => setModeleSlideOpen(false), onError: (err: Error) => setModeleFormError(err.message) },
      )
    }
  }

  // ── Spécifications d'un modèle ──────────────────────────────────────────────
  const [specsModeleId, setSpecsModeleId] = useState<string | null>(null)
  const specsModele = modeles.find((m) => m.id === specsModeleId) ?? null
  const { data: specsData } = useModeleSpecifications(specsModeleId)
  const specs = specsData?.data ?? []
  const createSpec = useCreateSpecification()
  const deleteSpec  = useDeleteSpecification()

  const [specForm, setSpecForm] = useState({ cle: '', valeur: '', unite: '' })

  const handleAddSpec = () => {
    if (!specsModeleId || !specForm.cle.trim() || !specForm.valeur.trim()) return
    createSpec.mutate(
      { modeleId: specsModeleId, payload: { cle: specForm.cle.trim(), valeur: specForm.valeur.trim(), unite: specForm.unite.trim() || undefined } },
      { onSuccess: () => setSpecForm({ cle: '', valeur: '', unite: '' }) },
    )
  }

  // ── Fiche technique + ressources d'un modèle ────────────────────────────────
  const [ficheModeleId, setFicheModeleId]     = useState<string | null>(null)
  const ficheModele = modeles.find((m) => m.id === ficheModeleId) ?? null
  const { data: fichesData } = useFichesTechniques(ficheModeleId)
  const fiches = useMemo(() => fichesData?.data ?? [], [fichesData])

  const [selectedFicheId, setSelectedFicheId] = useState<string | null>(null)
  useEffect(() => {
    if (!ficheModeleId) { setSelectedFicheId(null); return }
    const active = fiches.find((f) => f.statut === 'active')
    setSelectedFicheId((current) => {
      if (current && fiches.some((f) => f.id === current)) return current
      return active?.id ?? fiches[0]?.id ?? null
    })
  }, [ficheModeleId, fiches])

  const selectedFiche = fiches.find((f) => f.id === selectedFicheId) ?? null

  const createFiche  = useCreateFicheTechnique()
  const updateFiche   = useUpdateFicheTechnique()
  const activerFiche  = useActiverFicheTechnique()
  const deleteFiche    = useDeleteFicheTechnique()

  const [nouvelleFicheOuverte, setNouvelleFicheOuverte] = useState(false)
  const [nouveauModeCalcul, setNouveauModeCalcul]       = useState<ModeCalcul>('surface')
  const [ficheNotes, setFicheNotes]                     = useState('')

  useEffect(() => {
    setFicheNotes(selectedFiche?.notes ?? '')
  }, [selectedFiche?.id, selectedFiche?.notes])

  const { data: ressourcesData } = useFicheTechniqueRessources(selectedFicheId)
  const ressources = ressourcesData?.data ?? []
  const createRessource = useCreateRessource()
  const updateRessource = useUpdateRessource()
  const deleteRessource = useDeleteRessource()

  const [ressourceForm, setRessourceForm] = useState<CreateRessourcePayload>(DEFAULT_RESSOURCE_FORM)
  const [produitQuery, setProduitQuery]   = useState('')
  const [produitQueryDebounced, setProduitQueryDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setProduitQueryDebounced(produitQuery), 300)
    return () => clearTimeout(t)
  }, [produitQuery])
  // `limit` n'est pas un paramètre lu par GET /stocks (page/per_page seulement,
  // cf. stocks.ts) — la recherche retombe sur la pagination par défaut (20).
  const { data: produitsRecherche } = useStocks({ search: produitQueryDebounced || undefined })
  const produitsTrouves = produitQueryDebounced.trim().length >= 2 ? (produitsRecherche?.data ?? []) : []

  const handleCreerNouvelleFiche = () => {
    if (!ficheModeleId) return
    createFiche.mutate(
      { modeleId: ficheModeleId, payload: { mode_calcul: nouveauModeCalcul } },
      { onSuccess: (created) => { setNouvelleFicheOuverte(false); setSelectedFicheId(created.id) } },
    )
  }

  const handleAddRessource = () => {
    if (!selectedFicheId || !ressourceForm.designation.trim() || ressourceForm.quantite_par_unite <= 0) return
    createRessource.mutate(
      { ficheTechniqueId: selectedFicheId, payload: ressourceForm },
      {
        onSuccess: () => {
          setRessourceForm(DEFAULT_RESSOURCE_FORM)
          setProduitQuery('')
        },
      },
    )
  }

  const modeleColumns: Column<Modele>[] = [
    { id: 'reference', header: 'Réf.', accessor: 'reference', render: (v) => <span className="font-mono text-xs text-gray-500">{v as string}</span> },
    { id: 'designation', header: 'Désignation', accessor: 'designation' },
    { id: 'unite', header: 'Unité', accessor: 'unite_facturation', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
    {
      id: 'type_gamme', header: 'Type de gamme', accessor: 'type_gamme_effectif', sortable: false,
      render: (v) => <StatusBadge status={(v as TypeGamme) ?? 'catalogue'} map={TYPE_GAMME_MAP} />,
    },
    {
      id: 'actif', header: 'Statut', accessor: 'actif', sortable: false,
      render: (v) => v
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="h-3 w-3" />Actif</span>
        : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400"><Ban className="h-3 w-3" />Inactif</span>,
    },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false, csvSkip: true,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setSpecsModeleId(row.id)} title="Spécifications techniques"
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-[#C62828] transition-colors">
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setFicheModeleId(row.id)} title="Fiche technique (recette de calcul)"
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-[#C62828] transition-colors">
            <FileCog className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => openEditModele(row)} title="Modifier"
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-[#C62828] transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Catalogue produits finis"
        subtitle="Familles, modèles et spécifications techniques"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Catalogue' }]}
        actions={
          <Button size="sm" onClick={() => openNewFamille()}>
            <Plus className="h-3.5 w-3.5" /> Nouvelle famille
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Arbre des familles ── */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
          <h2 className="px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Familles</h2>
          {famillesLoading ? (
            <div className="py-8 text-center text-sm text-gray-400">Chargement…</div>
          ) : tree.length === 0 ? (
            <EmptyState
              icon={<FolderTree className="h-6 w-6" />}
              title="Aucune famille"
              description="Créez la première famille racine du catalogue."
              action={<Button size="sm" onClick={() => openNewFamille()}><Plus className="h-3.5 w-3.5" /> Nouvelle famille</Button>}
            />
          ) : (
            <div className="space-y-0.5">
              {tree.map((node) => (
                <FamilleNodeRow
                  key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleExpanded}
                  selectedId={selectedId} onSelect={setSelectedId} onAddChild={openNewFamille} onEdit={openEditFamille}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Modèles de la famille sélectionnée ── */}
        <div className="lg:col-span-3 space-y-3">
          {!selectedFamille ? (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
              <EmptyState
                icon={<Layers className="h-6 w-6" />}
                title="Sélectionnez une famille"
                description="Choisissez une famille dans l'arbre pour voir et gérer ses modèles."
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[#212121]">{selectedFamille.nom}</h2>
                  <p className="text-xs text-gray-400">{modeles.length} modèle(s) · {TYPE_GAMME_LABELS[selectedFamille.type_gamme]}</p>
                </div>
                <Button size="sm" onClick={openNewModele}>
                  <Plus className="h-3.5 w-3.5" /> Nouveau modèle
                </Button>
              </div>

              <DataTable<Modele>
                columns={modeleColumns}
                data={modeles}
                keyField="id"
                loading={modelesLoading}
              />
            </>
          )}
        </div>
      </div>

      {/* ── SlideOver Famille ── */}
      <SlideOver
        isOpen={familleSlideOpen}
        onClose={() => setFamilleSlideOpen(false)}
        title={editingFamilleId ? 'Modifier la famille' : familleForm.parent_id ? 'Nouvelle sous-famille' : 'Nouvelle famille racine'}
        width="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom *</label>
            <input
              value={familleForm.nom}
              onChange={(e) => setFamilleForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="ex. Menuiserie métallique"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Nature commerciale</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_GAMME_LABELS) as TypeGamme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFamilleForm((f) => ({ ...f, type_gamme: t }))}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-xs font-medium transition-all"
                  style={{
                    borderColor: familleForm.type_gamme === t ? '#C62828' : '#e5e7eb',
                    backgroundColor: familleForm.type_gamme === t ? '#FFEBEE' : 'transparent',
                    color: familleForm.type_gamme === t ? '#C62828' : '#6b7280',
                  }}
                >
                  {TYPE_GAMME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {editingFamilleId && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={familleForm.actif ?? true}
                onChange={(e) => setFamilleForm((f) => ({ ...f, actif: e.target.checked }))}
              />
              Famille active
            </label>
          )}

          {familleFormError && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-700">
              {familleFormError}
            </div>
          )}

          <Button className="w-full" onClick={handleSaveFamille} loading={createFamille.isPending || updateFamille.isPending}>
            {editingFamilleId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </SlideOver>

      {/* ── SlideOver Modèle ── */}
      <SlideOver
        isOpen={modeleSlideOpen}
        onClose={() => setModeleSlideOpen(false)}
        title={editingModeleId ? 'Modifier le modèle' : 'Nouveau modèle'}
        width="md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Référence *</label>
              <input
                value={modeleForm.reference}
                onChange={(e) => setModeleForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="ex. PM-01"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Unité de facturation</label>
              <input
                value={modeleForm.unite_facturation}
                onChange={(e) => setModeleForm((f) => ({ ...f, unite_facturation: e.target.value }))}
                placeholder="unité, m2, ml…"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Désignation *</label>
            <input
              value={modeleForm.designation}
              onChange={(e) => setModeleForm((f) => ({ ...f, designation: e.target.value }))}
              placeholder="ex. Porte métallique standard"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Description</label>
            <textarea
              value={modeleForm.description}
              onChange={(e) => setModeleForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              Type de gamme <span className="normal-case font-normal text-gray-400">(vide = hérite de la famille)</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => setModeleForm((f) => ({ ...f, type_gamme: undefined }))}
                className="flex flex-col items-center gap-1 py-2 rounded-xl border-2 text-xs font-medium transition-all"
                style={{
                  borderColor: !modeleForm.type_gamme ? '#C62828' : '#e5e7eb',
                  backgroundColor: !modeleForm.type_gamme ? '#FFEBEE' : 'transparent',
                  color: !modeleForm.type_gamme ? '#C62828' : '#6b7280',
                }}
              >
                Hérité
              </button>
              {(Object.keys(TYPE_GAMME_LABELS) as TypeGamme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setModeleForm((f) => ({ ...f, type_gamme: t }))}
                  className="flex flex-col items-center gap-1 py-2 rounded-xl border-2 text-xs font-medium transition-all"
                  style={{
                    borderColor: modeleForm.type_gamme === t ? '#C62828' : '#e5e7eb',
                    backgroundColor: modeleForm.type_gamme === t ? '#FFEBEE' : 'transparent',
                    color: modeleForm.type_gamme === t ? '#C62828' : '#6b7280',
                  }}
                >
                  {TYPE_GAMME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {modeleFormError && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-700">
              {modeleFormError}
            </div>
          )}

          <Button className="w-full" onClick={handleSaveModele} loading={createModele.isPending || updateModele.isPending}>
            {editingModeleId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </SlideOver>

      {/* ── Modal Spécifications ── */}
      <Modal isOpen={!!specsModeleId} onClose={() => setSpecsModeleId(null)} title={specsModele ? `Spécifications — ${specsModele.designation}` : 'Spécifications'} size="md">
        <div className="space-y-4">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {specs.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Aucune spécification renseignée.</p>}
            {specs.map((spec) => (
              <div key={spec.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                <div className="text-sm">
                  <span className="font-medium text-[#212121]">{spec.cle}</span>
                  <span className="text-gray-500"> : {spec.valeur}{spec.unite ? ` ${spec.unite}` : ''}</span>
                </div>
                <button
                  onClick={() => specsModeleId && deleteSpec.mutate({ id: spec.id, modeleId: specsModeleId })}
                  className="p-1 rounded hover:bg-red-50 text-red-500"
                  title="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-2 pt-3 border-t border-gray-100">
            <input
              value={specForm.cle}
              onChange={(e) => setSpecForm((f) => ({ ...f, cle: e.target.value }))}
              placeholder="Clé (ex. largeur)"
              className="col-span-2 px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
            <input
              value={specForm.valeur}
              onChange={(e) => setSpecForm((f) => ({ ...f, valeur: e.target.value }))}
              placeholder="Valeur"
              className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
            <input
              value={specForm.unite}
              onChange={(e) => setSpecForm((f) => ({ ...f, unite: e.target.value }))}
              placeholder="Unité"
              className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
            <Button size="sm" onClick={handleAddSpec} loading={createSpec.isPending}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Fiche technique + ressources ── */}
      <Modal
        isOpen={!!ficheModeleId}
        onClose={() => { setFicheModeleId(null); setNouvelleFicheOuverte(false) }}
        title={ficheModele ? `Fiche technique — ${ficheModele.designation}` : 'Fiche technique'}
        size="xl"
      >
        <div className="space-y-4">
          {/* ── Versions ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {fiches.map((f) => (
              <button
                key={f.id}
                onClick={() => { setSelectedFicheId(f.id); setNouvelleFicheOuverte(false) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                style={{
                  borderColor: selectedFicheId === f.id ? '#C62828' : '#e5e7eb',
                  backgroundColor: selectedFicheId === f.id ? '#FFEBEE' : 'transparent',
                  color: selectedFicheId === f.id ? '#C62828' : '#6b7280',
                }}
              >
                v{f.version} <StatusBadge status={f.statut} map={STATUT_FICHE_MAP} />
              </button>
            ))}
            <button
              onClick={() => setNouvelleFicheOuverte((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
            >
              <Plus className="h-3 w-3" /> Nouvelle version
            </button>
          </div>

          {nouvelleFicheOuverte && (
            <div className="flex items-end gap-2 p-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Mode de calcul</label>
                <select
                  value={nouveauModeCalcul}
                  onChange={(e) => setNouveauModeCalcul(e.target.value as ModeCalcul)}
                  className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                >
                  {(Object.keys(MODE_CALCUL_LABELS) as ModeCalcul[]).map((m) => (
                    <option key={m} value={m}>{MODE_CALCUL_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              <Button size="sm" onClick={handleCreerNouvelleFiche} loading={createFiche.isPending}>
                Créer (brouillon)
              </Button>
            </div>
          )}

          {!selectedFiche && !nouvelleFicheOuverte && (
            <EmptyState
              icon={<FileCog className="h-6 w-6" />}
              title="Aucune fiche technique"
              description="Créez une première version pour permettre le calcul automatique de devis sur ce modèle."
              action={<Button size="sm" onClick={() => setNouvelleFicheOuverte(true)}><Plus className="h-3.5 w-3.5" /> Nouvelle version</Button>}
            />
          )}

          {selectedFiche && (
            <>
              <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Mode de calcul</label>
                  <select
                    value={selectedFiche.mode_calcul}
                    onChange={(e) => updateFiche.mutate({ id: selectedFiche.id, modeleId: selectedFiche.modele_id, payload: { mode_calcul: e.target.value as ModeCalcul } })}
                    className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  >
                    {(Object.keys(MODE_CALCUL_LABELS) as ModeCalcul[]).map((m) => (
                      <option key={m} value={m}>{MODE_CALCUL_LABELS[m]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 shrink-0">
                  {selectedFiche.statut !== 'active' && (
                    <Button
                      size="sm"
                      onClick={() => activerFiche.mutate({ id: selectedFiche.id, modeleId: selectedFiche.modele_id })}
                      loading={activerFiche.isPending}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Activer
                    </Button>
                  )}
                  {selectedFiche.statut !== 'active' && (
                    <button
                      onClick={() => deleteFiche.mutate({ id: selectedFiche.id, modeleId: selectedFiche.modele_id })}
                      title="Supprimer cette version"
                      className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Notes</label>
                <div className="flex gap-2">
                  <textarea
                    value={ficheNotes}
                    onChange={(e) => setFicheNotes(e.target.value)}
                    rows={2}
                    className="flex-1 px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
                  />
                  {ficheNotes !== (selectedFiche.notes ?? '') && (
                    <Button
                      size="sm"
                      onClick={() => updateFiche.mutate({ id: selectedFiche.id, modeleId: selectedFiche.modele_id, payload: { notes: ficheNotes } })}
                      loading={updateFiche.isPending}
                    >
                      Enregistrer
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Ressources ── */}
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Ressources (recette par unité facturable)</p>

                {ressources.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-3">Aucune ressource — la fiche ne pourra pas être activée sans au moins une ligne.</p>
                )}

                {ressources.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded-lg text-xs">
                    <span className="w-24 shrink-0">
                      <StatusBadge
                        status={r.type}
                        map={{
                          materiau:    { label: 'Matériau',     color: '#1d4ed8', bgColor: '#dbeafe' },
                          main_oeuvre: { label: "Main-d'œuvre", color: '#6d28d9', bgColor: '#ede9fe' },
                          equipement:  { label: 'Équipement',   color: '#c2410c', bgColor: '#ffedd5' },
                        }}
                      />
                    </span>
                    <span className="flex-1 truncate font-medium text-[#212121]">{r.designation}</span>
                    <input
                      type="number" step="0.001" defaultValue={r.quantite_par_unite}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (v > 0 && v !== r.quantite_par_unite) {
                          updateRessource.mutate({ id: r.id, ficheTechniqueId: r.fiche_technique_id, payload: { quantite_par_unite: v } })
                        }
                      }}
                      className="w-20 px-1.5 py-1 text-xs border border-gray-200 rounded bg-white text-right"
                      title="Quantité par unité facturable"
                    />
                    <span className="w-14 text-gray-400">{r.unite}</span>
                    <input
                      type="number" step="1" defaultValue={r.cout_unitaire_reference_xaf}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (v >= 0 && v !== r.cout_unitaire_reference_xaf) {
                          updateRessource.mutate({ id: r.id, ficheTechniqueId: r.fiche_technique_id, payload: { cout_unitaire_reference_xaf: v } })
                        }
                      }}
                      className="w-24 px-1.5 py-1 text-xs border border-gray-200 rounded bg-white text-right"
                      title="Coût unitaire de référence (XAF)"
                    />
                    <button
                      onClick={() => deleteRessource.mutate({ id: r.id, ficheTechniqueId: r.fiche_technique_id })}
                      className="p-1 rounded hover:bg-red-50 text-red-500 shrink-0"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* ── Ajout d'une ressource ── */}
                <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(TYPE_RESSOURCE_LABELS) as TypeRessource[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setRessourceForm((f) => ({ ...f, type: t, ressource_produit_id: undefined }))}
                        className="py-1.5 rounded-lg border-2 text-xs font-medium transition-all"
                        style={{
                          borderColor: ressourceForm.type === t ? '#C62828' : '#e5e7eb',
                          backgroundColor: ressourceForm.type === t ? '#FFEBEE' : 'transparent',
                          color: ressourceForm.type === t ? '#C62828' : '#6b7280',
                        }}
                      >
                        {TYPE_RESSOURCE_LABELS[t]}
                      </button>
                    ))}
                  </div>

                  {ressourceForm.type === 'materiau' && (
                    <div className="relative">
                      <div className="flex items-center gap-1.5 px-2.5 py-2 bg-white border border-gray-200 rounded-lg">
                        <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <input
                          value={produitQuery}
                          onChange={(e) => setProduitQuery(e.target.value)}
                          placeholder="Chercher un article du stock (2 caractères min.)…"
                          className="flex-1 text-xs focus:outline-none"
                        />
                      </div>
                      {produitsTrouves.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                          {produitsTrouves.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setRessourceForm((f) => ({
                                  ...f, ressource_produit_id: p.id, designation: p.designation,
                                  unite: p.unite || f.unite, cout_unitaire_reference_xaf: p.prix_unitaire_xaf,
                                }))
                                setProduitQuery(p.designation)
                              }}
                              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0"
                            >
                              <span className="font-mono text-gray-400">{p.ref}</span> {p.designation} — {formatXAF(p.prix_unitaire_xaf)}/{p.unite}
                            </button>
                          ))}
                        </div>
                      )}
                      {ressourceForm.ressource_produit_id && (
                        <p className="text-[10px] text-green-700 mt-1">✓ Article relié — le coût de référence sera repris du stock (modifiable ci-dessous).</p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2">
                    <input
                      value={ressourceForm.designation}
                      onChange={(e) => setRessourceForm((f) => ({ ...f, designation: e.target.value }))}
                      placeholder="Désignation *"
                      className="col-span-2 px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    />
                    <select
                      value={ressourceForm.unite}
                      onChange={(e) => setRessourceForm((f) => ({ ...f, unite: e.target.value }))}
                      className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    >
                      {uniteOptions(ressourceForm.unite).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input
                      type="number" step="0.001" min="0"
                      value={ressourceForm.quantite_par_unite}
                      onChange={(e) => setRessourceForm((f) => ({ ...f, quantite_par_unite: Number(e.target.value) }))}
                      placeholder="Qté/unité *"
                      className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number" step="1" min="0"
                      value={ressourceForm.cout_unitaire_reference_xaf}
                      onChange={(e) => setRessourceForm((f) => ({ ...f, cout_unitaire_reference_xaf: Number(e.target.value) }))}
                      placeholder="Coût unitaire (XAF)"
                      className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    />
                    {ressourceForm.type !== 'materiau' && (
                      <input
                        type="number" step="0.01" min="0"
                        value={ressourceForm.temps_reference_h ?? ''}
                        onChange={(e) => setRessourceForm((f) => ({ ...f, temps_reference_h: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        placeholder="Temps (h) — optionnel"
                        className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                    )}
                  </div>
                  <Button size="sm" className="w-full" onClick={handleAddRessource} loading={createRessource.isPending}>
                    <Plus className="h-3.5 w-3.5" /> Ajouter la ressource
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </motion.div>
  )
}
