/**
 * Configurateur.tsx — UI Configurateur Produit (Master Prompt V3, §40)
 *
 *   Choisir le modèle → Saisir dimensions → Saisir quantité → Choisir options
 *   → Calculer → afficher unité de facturation + quantité calculée
 *   → Voir le détail technique (matériaux / main-d'œuvre / équipements)
 *
 * Câble le moteur de calcul déjà existant côté API (POST /devis/calculate,
 * §13/§35 — apps/api/src/services/devis-calculation.service.ts) : jusqu'ici
 * cet endpoint n'était appelé par aucune interface. Ce composant est la
 * première UI à l'utiliser.
 *
 * Si le produit n'a pas de fiche technique active, l'API répond
 * FICHE_TECHNIQUE_INTROUVABLE (422) — ce n'est pas une erreur réseau, c'est
 * une invitation explicite à basculer en saisie manuelle (§46, rétrocompatibilité).
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Calculator, Loader2, AlertTriangle, Check, X } from 'lucide-react'
import { Modal, Button } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useCalculerDevis, type PropositionDevis, type DimensionsInput } from '@/hooks/useDevis'
import type { ProduitShopErp } from '@/hooks/useProduitsShop'

interface ConfigurateurProps {
  isOpen: boolean
  onClose: () => void
  produit: ProduitShopErp
  onApply: (proposition: PropositionDevis) => void
}

const DIMENSION_FIELDS: Array<{ key: keyof DimensionsInput; label: string; unite: string }> = [
  { key: 'largeur',   label: 'Largeur',   unite: 'm' },
  { key: 'hauteur',   label: 'Hauteur',   unite: 'm' },
  { key: 'longueur',  label: 'Longueur',  unite: 'm' },
  { key: 'epaisseur', label: 'Épaisseur', unite: 'm' },
  { key: 'diametre',  label: 'Diamètre',  unite: 'm' },
  { key: 'poids',     label: 'Poids',     unite: 'kg' },
]

const RESSOURCE_LABELS: Record<string, string> = {
  materiau:     'Matériaux',
  main_oeuvre:  "Main-d'œuvre",
  equipement:   'Équipements',
}

export function Configurateur({ isOpen, onClose, produit, onApply }: ConfigurateurProps) {
  const [dimensions, setDimensions] = useState<DimensionsInput>({})
  const [quantite,   setQuantite]   = useState(1)
  const [detailOuvert, setDetailOuvert] = useState(false)

  const calculer = useCalculerDevis()
  const proposition = calculer.data

  function handleCalculer() {
    setDetailOuvert(false)
    calculer.mutate({
      produitId: produit.id,
      quantite,
      dimensions: Object.fromEntries(
        Object.entries(dimensions).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v)),
      ),
    })
  }

  function handleApply() {
    if (!proposition) return
    onApply(proposition)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Configurer — ${produit.nom}`} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Saisissez les dimensions et la quantité, puis lancez le calcul automatique à partir
          de la fiche technique active du modèle <span className="font-mono">{produit.ref}</span>.
        </p>

        {/* ── Dimensions ── */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Dimensions</label>
          <div className="grid grid-cols-3 gap-2">
            {DIMENSION_FIELDS.map(({ key, label, unite }) => (
              <div key={key}>
                <label className="block text-[10px] text-gray-400 mb-0.5">{label} ({unite})</label>
                <input
                  type="number" min="0" step="0.01"
                  value={dimensions[key] ?? ''}
                  onChange={(e) => setDimensions((d) => ({
                    ...d, [key]: e.target.value === '' ? undefined : Number(e.target.value),
                  }))}
                  className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Quantité ── */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Quantité (nombre de pièces)</label>
          <input
            type="number" min="1" step="1" value={quantite}
            onChange={(e) => setQuantite(Number(e.target.value))}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>

        <Button onClick={handleCalculer} disabled={calculer.isPending} className="w-full">
          {calculer.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calcul en cours…</>
            : <><Calculator className="h-3.5 w-3.5" /> Calculer</>}
        </Button>

        {/* ── Erreur (ex. fiche technique introuvable → §46 saisie manuelle) ── */}
        {calculer.isError && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-700">
              <p className="font-semibold">Calcul automatique indisponible</p>
              <p>{calculer.error?.message ?? 'Erreur inconnue'} — utilisez la saisie manuelle de la ligne.</p>
            </div>
          </div>
        )}

        {/* ── Résultat ── */}
        {proposition && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="border border-gray-100 bg-gray-50 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase">Quantité facturable</p>
                <p className="text-lg font-bold text-gray-900">
                  {proposition.quantiteFacturable} {produit.unite || ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase">Montant brut (HT)</p>
                <p className="text-lg font-bold" style={{ color: '#C62828' }}>{formatXAF(proposition.totalHtXaf)}</p>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 font-mono">{proposition.formuleUtilisee}</p>

            <button onClick={() => setDetailOuvert((v) => !v)}
              className="text-xs font-medium text-[#C62828] hover:underline">
              {detailOuvert ? 'Masquer' : 'Voir'} le détail technique
            </button>

            {detailOuvert && (
              <div className="space-y-2">
                {(['materiau', 'main_oeuvre', 'equipement'] as const).map((type) => {
                  const lignesType = proposition.lignes.filter((l) => l.type === type)
                  if (lignesType.length === 0) return null
                  return (
                    <div key={type}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{RESSOURCE_LABELS[type]}</p>
                      <div className="space-y-1">
                        {lignesType.map((l) => (
                          <div key={l.ressourceId} className="flex items-center justify-between text-xs bg-white rounded-lg px-2.5 py-1.5">
                            <span className="text-gray-700">{l.designation}</span>
                            <span className="text-gray-500">{l.quantiteCalculee} {l.unite}</span>
                            <span className="font-semibold text-gray-900">{formatXAF(l.totalXaf)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                <div className="h-px bg-gray-200 my-1" />
                <div className="text-xs space-y-0.5 text-right">
                  <p>Matériaux : {formatXAF(proposition.totalMateriauxXaf)}</p>
                  <p>Main-d'œuvre : {formatXAF(proposition.totalMainOeuvreXaf)}</p>
                  <p>Équipements : {formatXAF(proposition.totalEquipementsXaf)}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                <X className="h-3.5 w-3.5" /> Annuler
              </Button>
              <Button className="flex-1" onClick={handleApply}>
                <Check className="h-3.5 w-3.5" /> Appliquer à la ligne
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </Modal>
  )
}
