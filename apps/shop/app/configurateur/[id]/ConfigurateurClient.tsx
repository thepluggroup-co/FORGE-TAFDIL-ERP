'use client'

// Configurateur client (Catalogue Hybride Phase 3).
// Le navigateur n'envoie que la saisie : validation, prix et limites sont
// TOUJOURS décidés par l'API. Aucun coût interne n'est reçu ni affiché.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Calculator, CheckCircle, AlertTriangle, Send, ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// ── Types (réponses de /api/shop/configurateur) ────────────────────────────────

interface ParametrePublic {
  code: string
  libelle: string
  type: 'nombre' | 'choix' | 'booleen'
  obligatoire: boolean
  unite: string | null
  min: number | null
  max: number | null
  pas: number | null
  valeurs?: Array<{ code: string; libelle: string; validation_requise: boolean }>
}

interface SchemaPublic {
  modele: {
    id: string; reference: string; designation: string; description: string | null
    images: string[]; delai_fabrication_jours: number | null
  }
  parametres: ParametrePublic[]
}

type Statut = 'valide' | 'invalide' | 'a_valider' | 'hors_limites'

interface Resultat {
  statut: Statut
  erreurs: Array<{ parametre: string; message: string }>
  hors_limites: Array<{ parametre: string; valeur: number; min: number | null; max: number | null; unite: string | null }>
  validations_requises: Array<{ parametre: string; raison: string }>
  estimation:
    | { disponible: true; quantite: number; prix_unitaire_ht_xaf: number; prix_ht_xaf: number; delai_fabrication_jours: number | null }
    | { disponible: false; raison: string; message: string }
}

interface Confirmation { numero: string; statut: Statut; message: string }

type Valeur = string | number | boolean | null

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`

// ── Composant ──────────────────────────────────────────────────────────────────

export function ConfigurateurClient({ modeleId }: { modeleId: string }) {
  const [schema, setSchema]         = useState<SchemaPublic | null>(null)
  const [introuvable, setIntrouvable] = useState(false)
  const [valeurs, setValeurs]       = useState<Record<string, Valeur>>({})
  const [quantite, setQuantite]     = useState(1)
  const [resultat, setResultat]     = useState<Resultat | null>(null)
  const [calcul, setCalcul]         = useState(false)
  const [client, setClient]         = useState({ nom: '', telephone: '', email: '', commentaire: '' })
  const [envoi, setEnvoi]           = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  useEffect(() => {
    fetch(`/api/shop/configurateur/${modeleId}`)
      .then(async (res) => {
        if (!res.ok) { setIntrouvable(true); return }
        const json = await res.json() as { data: SchemaPublic }
        setSchema(json.data)
        // valeurs initiales : premier choix proposé, options décochées
        const init: Record<string, Valeur> = {}
        for (const p of json.data.parametres) {
          if (p.type === 'choix' && p.obligatoire) init[p.code] = p.valeurs?.[0]?.code ?? null
          if (p.type === 'booleen') init[p.code] = false
        }
        setValeurs(init)
      })
      .catch(() => setIntrouvable(true))
  }, [modeleId])

  const modifier = (code: string, v: Valeur) => {
    setValeurs((prev) => ({ ...prev, [code]: v }))
    setResultat(null) // toute modification invalide l'estimation affichée
  }

  const estimer = async () => {
    setCalcul(true)
    try {
      const res = await fetch(`/api/shop/configurateur/${modeleId}/estimer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valeurs, quantite }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Calcul impossible'); return }
      setResultat(json.data as Resultat)
    } catch {
      toast.error('Service indisponible, réessayez')
    } finally {
      setCalcul(false)
    }
  }

  const envoyer = async () => {
    if (client.nom.trim().length < 2 || client.telephone.trim().length < 8) {
      toast.error('Indiquez votre nom et un numéro de téléphone valide')
      return
    }
    setEnvoi(true)
    try {
      const res = await fetch(`/api/shop/configurateur/${modeleId}/demande`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valeurs, quantite,
          client: { nom: client.nom.trim(), telephone: client.telephone.trim(), email: client.email.trim() || undefined },
          commentaire: client.commentaire.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.details) setResultat(json.details as Resultat)
        toast.error(json.error ?? 'Envoi impossible')
        return
      }
      setConfirmation(json.data as Confirmation)
    } catch {
      toast.error('Service indisponible, réessayez')
    } finally {
      setEnvoi(false)
    }
  }

  if (introuvable) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-lg font-bold text-forge-dark">Ce produit n'est pas disponible à la configuration.</p>
        <Link href="/catalogue" className="mt-4 inline-block text-sm font-semibold text-forge-red">Retour au catalogue</Link>
      </div>
    )
  }

  if (!schema) {
    return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-forge-steel" /></div>
  }

  if (confirmation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-600" />
        <h1 className="mt-4 text-2xl font-black text-forge-dark">Demande enregistrée</h1>
        <p className="mt-2 text-sm text-forge-steel">{confirmation.message}</p>
        <p className="mt-6 inline-block rounded-xl bg-white px-6 py-3 text-lg font-black tracking-wide text-forge-dark shadow-sm">
          Référence : {confirmation.numero}
        </p>
        <p className="mt-3 text-xs text-gray-400">Conservez cette référence : elle vous sera demandée par votre conseiller.</p>
        <Link href="/catalogue" className="mt-8 inline-block text-sm font-semibold text-forge-red">Retour au catalogue</Link>
      </div>
    )
  }

  const { modele, parametres } = schema
  const erreurDe = (code: string) => resultat?.erreurs.find((e) => e.parametre === code)?.message
  const horsLimite = (code: string) => resultat?.hors_limites.find((h) => h.parametre === code)
  const surDevis = resultat?.statut === 'hors_limites'

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <section>
        <Link href="/catalogue" className="inline-flex items-center gap-1 text-xs font-semibold text-forge-steel hover:text-forge-red">
          <ArrowLeft size={14} /> Catalogue
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-forge-red">Produit configurable · {modele.reference}</p>
        <h1 className="text-3xl font-black text-forge-dark">{modele.designation}</h1>
        {modele.description && <p className="mt-2 max-w-2xl text-sm text-forge-steel">{modele.description}</p>}

        {modele.images[0] && (
          <div className="relative mt-6 h-64 overflow-hidden rounded-2xl bg-white">
            <Image src={modele.images[0]} alt={modele.designation} fill sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" />
          </div>
        )}

        <div className="mt-8 grid gap-5 rounded-2xl bg-white p-6 shadow-sm sm:grid-cols-2">
          {parametres.map((p) => (
            <Champ
              key={p.code} parametre={p} valeur={valeurs[p.code] ?? null}
              onChange={(v) => modifier(p.code, v)}
              erreur={erreurDe(p.code)}
              horsLimite={Boolean(horsLimite(p.code))}
            />
          ))}
          <label className="block">
            <span className="text-xs font-semibold uppercase text-gray-500">Quantité</span>
            <input
              type="number" min={1} step={1} value={quantite}
              onChange={(e) => { setQuantite(Math.max(1, Math.floor(Number(e.target.value) || 1))); setResultat(null) }}
              className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>
        </div>

        <button
          type="button" onClick={estimer} disabled={calcul}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-forge-dark px-6 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
        >
          {calcul ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />} Calculer
        </button>
      </section>

      <aside className="space-y-5">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-forge-dark">Estimation</h2>
          {!resultat && <p className="mt-3 text-sm text-forge-steel">Renseignez votre configuration puis cliquez sur « Calculer ».</p>}
          {resultat && <BlocResultat resultat={resultat} />}
        </div>

        {resultat && resultat.statut !== 'invalide' && (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-forge-dark">
              {surDevis ? 'Demander un devis' : 'Demander la validation'}
            </h2>
            <p className="mt-1 text-xs text-forge-steel">
              {surDevis
                ? 'Nos équipes étudient votre projet et vous rappellent avec un devis.'
                : 'Un conseiller confirme le prix, le délai et les conditions avant toute commande.'}
            </p>
            <div className="mt-4 space-y-3">
              <input placeholder="Nom complet *" value={client.nom} onChange={(e) => setClient({ ...client, nom: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
              <input placeholder="Téléphone *" value={client.telephone} onChange={(e) => setClient({ ...client, telephone: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
              <input placeholder="Email (optionnel)" type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
              <textarea placeholder="Précisions (lieu de pose, contraintes…)" rows={3} value={client.commentaire}
                onChange={(e) => setClient({ ...client, commentaire: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
              <button
                type="button" onClick={envoyer} disabled={envoi}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red px-6 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {envoi ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {surDevis ? 'Envoyer ma demande de devis' : 'Demander validation'}
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

// ── Sous-composants ────────────────────────────────────────────────────────────

function Champ({ parametre: p, valeur, onChange, erreur, horsLimite }: {
  parametre: ParametrePublic; valeur: Valeur; onChange: (v: Valeur) => void; erreur?: string; horsLimite: boolean
}) {
  const bordure = erreur || horsLimite ? 'border-red-300 bg-red-50' : 'border-gray-200'

  if (p.type === 'booleen') {
    return (
      <label className="flex items-center gap-3 self-end rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
        <input type="checkbox" checked={valeur === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="font-semibold text-forge-dark">{p.libelle}</span>
      </label>
    )
  }

  const plage = p.type === 'nombre' && (p.min !== null || p.max !== null)
    ? `${p.min ?? '…'} – ${p.max ?? '…'}${p.unite ? ` ${p.unite}` : ''}`
    : null

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-gray-500">
        {p.libelle}{p.unite ? ` (${p.unite})` : ''}{p.obligatoire ? ' *' : ''}
      </span>
      {p.type === 'nombre' ? (
        <input
          type="number" inputMode="decimal" step={p.pas ?? 'any'}
          value={valeur === null || valeur === undefined ? '' : String(valeur)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm ${bordure}`}
        />
      ) : (
        <select
          value={valeur === null ? '' : String(valeur)} onChange={(e) => onChange(e.target.value || null)}
          className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm ${bordure}`}
        >
          {!p.obligatoire && <option value="">—</option>}
          {(p.valeurs ?? []).map((v) => (
            <option key={v.code} value={v.code}>{v.libelle}{v.validation_requise ? ' (sur validation)' : ''}</option>
          ))}
        </select>
      )}
      {plage && <span className="mt-1 block text-[11px] text-gray-400">Dimensions standard : {plage}</span>}
      {erreur && <span className="mt-1 block text-[11px] font-semibold text-red-600">{erreur}</span>}
    </label>
  )
}

function BlocResultat({ resultat }: { resultat: Resultat }) {
  if (resultat.statut === 'invalide') {
    return <p className="mt-3 text-sm font-semibold text-red-600">Corrigez les champs signalés puis recalculez.</p>
  }

  if (resultat.statut === 'hors_limites') {
    return (
      <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
        <p className="flex items-center gap-2 font-bold"><AlertTriangle size={16} /> Projet hors dimensions standard</p>
        <ul className="mt-2 list-disc pl-5 text-xs">
          {resultat.hors_limites.map((h) => (
            <li key={h.parametre}>{h.parametre} : {h.valeur}{h.unite ? ` ${h.unite}` : ''} (standard : {h.min ?? '…'} – {h.max ?? '…'})</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">Pas de prix automatique : votre projet sera chiffré sur devis par nos équipes.</p>
      </div>
    )
  }

  const e = resultat.estimation
  return (
    <div className="mt-3 space-y-3">
      {e.disponible ? (
        <>
          <p className="text-3xl font-black text-forge-dark">{fcfa(e.prix_ht_xaf)} <span className="text-xs font-semibold text-forge-steel">HT</span></p>
          <p className="text-xs text-forge-steel">
            {e.quantite} × {fcfa(e.prix_unitaire_ht_xaf)} HT · TVA en sus
            {e.delai_fabrication_jours ? ` · fabrication ~${e.delai_fabrication_jours} jours` : ''}
          </p>
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
            Estimation indicative, non contractuelle : le prix définitif est confirmé par un conseiller TAFDIL.
          </p>
        </>
      ) : (
        <p className="text-sm text-forge-steel">{e.message}</p>
      )}
      {resultat.validations_requises.length > 0 && (
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
          {resultat.validations_requises.map((v) => <p key={v.parametre}>{v.raison}</p>)}
        </div>
      )}
    </div>
  )
}
