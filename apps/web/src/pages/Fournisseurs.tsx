import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Plus, Search, X, Mail, MessageCircle, Phone, MapPin,
  Tag, Edit2, Trash2, ChevronDown, ChevronUp, Send, Loader2,
} from 'lucide-react'
import {
  useFournisseurs, useCreateFournisseur, useUpdateFournisseur,
  useDeleteFournisseur, useEnvoyerBon,
  type Fournisseur, type CreateFournisseurPayload,
} from '@/hooks/useFournisseurs'
import { useBonsAppro, type BonAppro } from '@/hooks/useBonsAppro'

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUT_LABEL: Record<string, string> = {
  brouillon:    'Brouillon',
  valide:       'Validé',
  envoye:       'Envoyé',
  commande:     'Commandé',
  recu_partiel: 'Reçu partiel',
  recu_total:   'Reçu total',
  recu:         'Reçu',
  annule:       'Annulé',
}

const STATUT_COLOR: Record<string, string> = {
  brouillon:    'bg-gray-100 text-gray-600',
  valide:       'bg-blue-100 text-blue-700',
  envoye:       'bg-amber-100 text-amber-700',
  commande:     'bg-purple-100 text-purple-700',
  recu_partiel: 'bg-orange-100 text-orange-700',
  recu_total:   'bg-green-100 text-green-700',
  recu:         'bg-green-100 text-green-700',
  annule:       'bg-red-100 text-red-600',
}

// ── SlideOver formulaire fournisseur ──────────────────────────────────────────

interface FournisseurFormProps {
  initial?: Fournisseur | null
  onClose: () => void
}

const EMPTY: CreateFournisseurPayload = {
  nom: '', telephone: '', email: '', whatsapp: '',
  adresse: '', produits_fournis: [], notes: '', actif: true,
}

function FournisseurSlideOver({ initial, onClose }: FournisseurFormProps) {
  const create = useCreateFournisseur()
  const update = useUpdateFournisseur()
  const busy   = create.isPending || update.isPending

  const [form, setForm]   = useState<CreateFournisseurPayload>(
    initial
      ? { ...initial, email: initial.email ?? '', produits_fournis: initial.produits_fournis ?? [] }
      : EMPTY,
  )
  const [tagInput, setTagInput] = useState('')

  function set(k: keyof CreateFournisseurPayload, v: unknown) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function addTag(raw: string) {
    const tag = raw.trim()
    if (!tag) return
    if (!(form.produits_fournis ?? []).includes(tag)) {
      set('produits_fournis', [...(form.produits_fournis ?? []), tag])
    }
    setTagInput('')
  }

  function removeTag(tag: string) {
    set('produits_fournis', (form.produits_fournis ?? []).filter(t => t !== tag))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nom.trim()) { toast.error('Le nom est requis'); return }

    const payload = { ...form, email: form.email || undefined }

    if (initial) {
      await update.mutateAsync({ id: initial.id, ...payload })
    } else {
      await create.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="text-lg font-black text-[#111827]">
          {initial ? 'Modifier fournisseur' : 'Nouveau fournisseur'}
        </h2>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex-1 space-y-5 px-6 py-6">
          {/* Nom */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              value={form.nom}
              onChange={e => set('nom', e.target.value)}
              placeholder="Ex : Ets NDOUMOU Aciers"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
            />
          </div>

          {/* Téléphone + WhatsApp */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Téléphone</label>
              <input
                value={form.telephone ?? ''}
                onChange={e => set('telephone', e.target.value)}
                placeholder="+237 6XX XXX XXX"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#374151]">WhatsApp</label>
              <input
                value={form.whatsapp ?? ''}
                onChange={e => set('whatsapp', e.target.value)}
                placeholder="+237 6XX XXX XXX"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Email</label>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={e => set('email', e.target.value)}
              placeholder="contact@fournisseur.cm"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
            />
          </div>

          {/* Adresse */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Adresse</label>
            <input
              value={form.adresse ?? ''}
              onChange={e => set('adresse', e.target.value)}
              placeholder="Quartier, Ville"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
            />
          </div>

          {/* Produits fournis — tags */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Produits / catégories fournis</label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) } }}
                placeholder="Acier, Tôle… Entrée pour ajouter"
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
              />
              <button
                type="button"
                onClick={() => addTag(tagInput)}
                className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-[#374151] hover:bg-gray-200 transition-colors"
              >
                +
              </button>
            </div>
            {(form.produits_fournis ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(form.produits_fournis ?? []).map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-[#C62828]/10 px-2.5 py-1 text-xs font-semibold text-[#C62828]"
                  >
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-800">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Notes</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              placeholder="Délais, conditions, remarques…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t px-6 py-4">
          <button
            type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-[#6B7280] hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit" disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#C62828] py-2.5 text-sm font-bold text-white transition hover:bg-[#B71C1C] disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {initial ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </motion.div>
  )
}

// ── Modal envoi bon d'appro ───────────────────────────────────────────────────

interface EnvoyerBonModalProps {
  fournisseur: Fournisseur
  onClose:     () => void
}

function EnvoyerBonModal({ fournisseur, onClose }: EnvoyerBonModalProps) {
  const { data: bons, isLoading } = useBonsAppro({ statut: 'valide' })
  const envoyer = useEnvoyerBon()

  const [bonId,    setBonId]    = useState('')
  const [canal,    setCanal]    = useState<'email' | 'whatsapp'>('email')
  const [message,  setMessage]  = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!bonId) { toast.error('Sélectionnez un bon d\'approvisionnement'); return }

    const result = await envoyer.mutateAsync({
      fournisseurId:        fournisseur.id,
      bon_appro_id:         bonId,
      canal,
      message_personnalise: message || undefined,
    })

    if (result.canal === 'whatsapp' && result.wa_link) {
      window.open(result.wa_link, '_blank', 'noopener,noreferrer')
      toast.success('Lien WhatsApp ouvert — envoyez le message au fournisseur')
    } else {
      toast.success(`Bon envoyé par email à ${fournisseur.email}`)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="font-black text-[#111827]">Envoyer un bon d'appro</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          <p className="text-sm text-[#6B7280]">
            Fournisseur : <strong className="text-[#111827]">{fournisseur.nom}</strong>
          </p>

          {/* Sélection bon */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">
              Bon d'approvisionnement <span className="text-red-500">*</span>
            </label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Loader2 size={14} className="animate-spin" /> Chargement…
              </div>
            ) : (
              <select
                value={bonId}
                onChange={e => setBonId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
              >
                <option value="">-- Sélectionner --</option>
                {(bons?.data ?? []).map((b: BonAppro) => (
                  <option key={b.id} value={b.id}>
                    {b.numero} — {STATUT_LABEL[b.statut] ?? b.statut}
                  </option>
                ))}
              </select>
            )}
            {!isLoading && (bons?.data ?? []).length === 0 && (
              <p className="mt-1 text-xs text-[#9CA3AF]">Aucun bon validé disponible</p>
            )}
          </div>

          {/* Canal */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-[#374151]">Canal d'envoi</label>
            <div className="grid grid-cols-2 gap-2">
              {([['email', 'Email', Mail], ['whatsapp', 'WhatsApp', MessageCircle]] as const).map(([val, label, Icon]) => (
                <button
                  key={val} type="button"
                  onClick={() => setCanal(val)}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors ${
                    canal === val
                      ? 'border-[#C62828] bg-[#C62828]/5 text-[#C62828]'
                      : 'border-gray-200 text-[#6B7280] hover:border-gray-300'
                  }`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            {canal === 'email' && !fournisseur.email && (
              <p className="mt-1.5 text-xs text-amber-600">⚠️ Ce fournisseur n'a pas d'email enregistré</p>
            )}
            {canal === 'whatsapp' && !fournisseur.whatsapp && !fournisseur.telephone && (
              <p className="mt-1.5 text-xs text-amber-600">⚠️ Ce fournisseur n'a pas de numéro WhatsApp</p>
            )}
            {canal === 'whatsapp' && (
              <p className="mt-1.5 text-xs text-[#9CA3AF]">
                Un lien WhatsApp s'ouvrira — le PDF ne peut pas être joint automatiquement, envoyez-le manuellement si nécessaire.
              </p>
            )}
          </div>

          {/* Message personnalisé */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#374151]">Message personnalisé (optionnel)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="Laissez vide pour utiliser le message par défaut"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-[#6B7280] hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit" disabled={envoyer.isPending || !bonId}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#C62828] py-2.5 text-sm font-bold text-white transition hover:bg-[#B71C1C] disabled:opacity-50"
            >
              {envoyer.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Envoyer
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ── Carte fournisseur ─────────────────────────────────────────────────────────

interface FournisseurCardProps {
  f:         Fournisseur
  onEdit:    (f: Fournisseur) => void
  onDelete:  (f: Fournisseur) => void
  onEnvoyer: (f: Fournisseur) => void
}

function FournisseurCard({ f, onEdit, onDelete, onEnvoyer }: FournisseurCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3 p-4">
        {/* Infos principales */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-[#111827]">{f.nom}</h3>
            {!f.actif && (
              <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                Inactif
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
            {f.telephone && (
              <span className="flex items-center gap-1">
                <Phone size={11} /> {f.telephone}
              </span>
            )}
            {f.email && (
              <span className="flex items-center gap-1 truncate max-w-[160px]">
                <Mail size={11} /> {f.email}
              </span>
            )}
            {f.adresse && (
              <span className="flex items-center gap-1">
                <MapPin size={11} /> {f.adresse}
              </span>
            )}
          </div>

          {(f.produits_fournis ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(f.produits_fournis ?? []).slice(0, 3).map(tag => (
                <span key={tag} className="flex items-center gap-0.5 rounded-full bg-[#C62828]/8 px-2 py-0.5 text-[10px] font-semibold text-[#C62828]">
                  <Tag size={9} /> {tag}
                </span>
              ))}
              {(f.produits_fournis ?? []).length > 3 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                  +{(f.produits_fournis ?? []).length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 flex-col gap-1.5">
          <button
            onClick={() => onEdit(f)}
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-gray-100 hover:text-[#111827] transition-colors"
            title="Modifier"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(f)}
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Désactiver"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-gray-100 transition-colors"
            title={expanded ? 'Réduire' : 'Développer'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Section envoi bon — toujours visible */}
      <div className="flex gap-2 border-t border-gray-50 px-4 py-3">
        <button
          onClick={() => { setExpanded(false); onEnvoyer(f) }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#C62828] py-2 text-xs font-bold text-[#C62828] transition hover:bg-[#C62828] hover:text-white"
        >
          <Mail size={13} /> Envoyer bon d'appro
        </button>
        {(f.whatsapp || f.telephone) && (
          <a
            href={`https://wa.me/${(f.whatsapp ?? f.telephone ?? '').replace(/\D/g, '')}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 transition hover:bg-green-100"
            title="Contacter sur WhatsApp"
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
        )}
      </div>

      {/* Notes développées */}
      <AnimatePresence>
        {expanded && f.notes && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-50 px-4 pb-4 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF]">Notes</p>
              <p className="mt-1 text-sm text-[#374151]">{f.notes}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Fournisseurs() {
  const [search,        setSearch]        = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [slideOver,     setSlideOver]     = useState<'create' | Fournisseur | null>(null)
  const [envoyerTarget, setEnvoyerTarget] = useState<Fournisseur | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Fournisseur | null>(null)

  const deleteMutation = useDeleteFournisseur()

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const { data: fournisseurs, isLoading } = useFournisseurs(debouncedSearch || undefined)

  async function handleDelete() {
    if (!confirmDelete) return
    await deleteMutation.mutateAsync(confirmDelete.id)
    setConfirmDelete(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#111827]">Fournisseurs</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Gérez vos fournisseurs et envoyez des bons de commande
          </p>
        </div>
        <button
          onClick={() => setSlideOver('create')}
          className="flex items-center gap-2 rounded-xl bg-[#C62828] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#B71C1C] active:scale-[0.98]"
        >
          <Plus size={16} /> Nouveau fournisseur
        </button>
      </div>

      {/* ── Barre de recherche ── */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher par nom, email, téléphone…"
          className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-[#C62828] focus:ring-2 focus:ring-[#C62828]/10"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#374151]"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Contenu ── */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C62828] border-t-transparent" />
        </div>
      ) : (fournisseurs ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
            <Tag size={28} className="text-gray-300" />
          </div>
          <p className="font-bold text-[#111827]">
            {search ? 'Aucun fournisseur trouvé' : 'Aucun fournisseur enregistré'}
          </p>
          <p className="text-sm text-[#6B7280]">
            {search ? 'Essayez un autre terme de recherche' : 'Créez votre premier fournisseur pour commencer'}
          </p>
          {!search && (
            <button
              onClick={() => setSlideOver('create')}
              className="flex items-center gap-2 rounded-xl bg-[#C62828] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#B71C1C]"
            >
              <Plus size={15} /> Créer un fournisseur
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(fournisseurs ?? []).map(f => (
            <FournisseurCard
              key={f.id}
              f={f}
              onEdit={setSlideOver}
              onDelete={setConfirmDelete}
              onEnvoyer={setEnvoyerTarget}
            />
          ))}
        </div>
      )}

      {/* ── SlideOver ── */}
      <AnimatePresence>
        {slideOver !== null && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setSlideOver(null)}
            />
            <FournisseurSlideOver
              initial={slideOver === 'create' ? null : slideOver}
              onClose={() => setSlideOver(null)}
            />
          </>
        )}
      </AnimatePresence>

      {/* ── Modal envoi bon ── */}
      <AnimatePresence>
        {envoyerTarget && (
          <EnvoyerBonModal
            fournisseur={envoyerTarget}
            onClose={() => setEnvoyerTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Confirm suppression ── */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
              className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            >
              <h3 className="font-black text-[#111827]">Désactiver ce fournisseur ?</h3>
              <p className="mt-2 text-sm text-[#6B7280]">
                <strong>{confirmDelete.nom}</strong> sera masqué de la liste mais conservé dans la base de données.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-[#6B7280] hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Désactiver
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
