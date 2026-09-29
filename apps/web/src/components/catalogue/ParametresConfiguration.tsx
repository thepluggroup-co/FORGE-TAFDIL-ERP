import React, { useEffect, useState } from 'react'
import { Plus, Trash2, Save, Calculator } from 'lucide-react'
import { Modal, Button } from '@forge/ui'
import {
  useParametresModele, useEnregistrerParametres, useEstimerInterne,
  type Modele, type ParametreConfiguration, type ParametrePayload, type TypeParametre, type RoleCalcul, type EstimationInterne,
  type CategorieCout,
} from '@/hooks/useCatalogue'
import { formatXAF } from '@/lib/utils'

/**
 * Éditeur du configurateur d'un modèle CONFIGURABLE (Catalogue Hybride Phase 3).
 *
 * - Les limites min/max d'un paramètre numérique définissent la gamme
 *   fabricable : au-delà, la demande client bascule automatiquement en devis.
 * - Les coûts d'options sont des COÛTS DE REVIENT par unité (jamais montrés au
 *   client) ; le prix de vente = coût × (1 + taux de marge).
 * - Zone « Tester » : même calcul que le site, avec le détail interne.
 */

const CHAMP = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#C62828]'

function versPayload(p: ParametreConfiguration): ParametrePayload {
  return {
    code: p.code, libelle: p.libelle, type: p.type, obligatoire: p.obligatoire,
    unite: p.unite ?? null, min: p.min ?? null, max: p.max ?? null, pas: p.pas ?? null,
    role_calcul: p.roleCalcul ?? null, cout_si_oui_xaf: p.coutSiOuiXaf ?? 0,
    categorie_cout: p.categorieCout ?? 'option', cout_par_commande: p.coutParCommande ?? false,
    valeurs: (p.valeurs ?? []).map((v) => ({
      code: v.code, libelle: v.libelle, cout_supplementaire_xaf: v.coutSupplementaireXaf, validation_requise: v.validationRequise,
      categorie_cout: v.categorieCout ?? 'option', cout_par_commande: v.coutParCommande ?? false,
    })),
  }
}

const nouveauParametre = (): ParametrePayload => ({
  code: '', libelle: '', type: 'nombre', obligatoire: true, unite: 'mm', min: null, max: null, pas: null,
  role_calcul: null, cout_si_oui_xaf: 0, categorie_cout: 'option', cout_par_commande: false, valeurs: [],
})

const nombreOuNull = (v: string) => (v.trim() === '' ? null : Number(v))

export function ParametresConfigurationModal({ modele, onClose }: { modele: Modele | null; onClose: () => void }) {
  const { data } = useParametresModele(modele?.id ?? null)
  const enregistrer = useEnregistrerParametres()
  const [parametres, setParametres] = useState<ParametrePayload[]>([])

  useEffect(() => { setParametres((data?.data ?? []).map(versPayload)) }, [data])

  const maj = (i: number, patch: Partial<ParametrePayload>) =>
    setParametres((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const majValeur = (i: number, k: number, patch: Partial<ParametrePayload['valeurs'][number]>) =>
    maj(i, { valeurs: parametres[i].valeurs.map((v, j) => (j === k ? { ...v, ...patch } : v)) })

  return (
    <Modal isOpen={Boolean(modele)} onClose={onClose} title={modele ? `Configurateur — ${modele.designation}` : 'Configurateur'} size="lg">
      {modele && (
        <div className="space-y-5">
          <p className="text-xs text-gray-500">
            Définissez les champs proposés au client. Hors des limites min/max, aucun prix automatique : la demande part en devis.
            Les coûts saisis sont des coûts de revient par unité, jamais affichés au client.
          </p>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {parametres.length === 0 && <p className="py-4 text-center text-xs text-gray-400">Aucun champ : ajoutez largeur, hauteur, options…</p>}
            {parametres.map((p, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-gray-100 p-3">
                <div className="grid grid-cols-12 gap-2">
                  <input className={`${CHAMP} col-span-3`} placeholder="code (ex. largeur)" value={p.code}
                    onChange={(e) => maj(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
                  <input className={`${CHAMP} col-span-4`} placeholder="Libellé client" value={p.libelle} onChange={(e) => maj(i, { libelle: e.target.value })} />
                  <select className={`${CHAMP} col-span-2`} value={p.type} onChange={(e) => maj(i, { type: e.target.value as TypeParametre })}>
                    <option value="nombre">Nombre</option>
                    <option value="choix">Choix</option>
                    <option value="booleen">Option oui/non</option>
                  </select>
                  <label className="col-span-2 flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={p.obligatoire} onChange={(e) => maj(i, { obligatoire: e.target.checked })} /> Obligatoire
                  </label>
                  <button type="button" onClick={() => setParametres((ps) => ps.filter((_, j) => j !== i))}
                    className="col-span-1 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50" title="Supprimer le champ">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {p.type === 'nombre' && (
                  <div className="grid grid-cols-5 gap-2">
                    <select className={CHAMP} value={p.unite ?? ''} onChange={(e) => maj(i, { unite: (e.target.value || null) as ParametrePayload['unite'] })}>
                      <option value="">sans unité</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
                    </select>
                    <input className={CHAMP} type="number" placeholder="min" value={p.min ?? ''} onChange={(e) => maj(i, { min: nombreOuNull(e.target.value) })} />
                    <input className={CHAMP} type="number" placeholder="max" value={p.max ?? ''} onChange={(e) => maj(i, { max: nombreOuNull(e.target.value) })} />
                    <input className={CHAMP} type="number" placeholder="pas" value={p.pas ?? ''} onChange={(e) => maj(i, { pas: nombreOuNull(e.target.value) })} />
                    <select className={CHAMP} value={p.role_calcul ?? ''} onChange={(e) => maj(i, { role_calcul: (e.target.value || null) as RoleCalcul | null })}
                      title="Dimension transmise au moteur de calcul de la fiche technique">
                      <option value="">— calcul —</option>
                      <option value="largeur">largeur</option><option value="hauteur">hauteur</option><option value="longueur">longueur</option>
                      <option value="epaisseur">épaisseur</option><option value="diametre">diamètre</option><option value="poids">poids</option>
                    </select>
                  </div>
                )}

                {p.type === 'booleen' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    Coût de revient si coché (FCFA)
                    <input className={`${CHAMP} w-32`} type="number" min={0} value={p.cout_si_oui_xaf} onChange={(e) => maj(i, { cout_si_oui_xaf: Number(e.target.value) || 0 })} />
                    <NatureCout
                      categorie={p.categorie_cout} parCommande={p.cout_par_commande}
                      onChange={(patch) => maj(i, patch)}
                    />
                  </div>
                )}

                {p.type === 'choix' && (
                  <div className="space-y-1.5">
                    {p.valeurs.map((v, k) => (
                      <div key={k} className="grid grid-cols-12 items-center gap-2">
                        <input className={`${CHAMP} col-span-2`} placeholder="code" value={v.code}
                          onChange={(e) => majValeur(i, k, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
                        <input className={`${CHAMP} col-span-3`} placeholder="Libellé" value={v.libelle} onChange={(e) => majValeur(i, k, { libelle: e.target.value })} />
                        <input className={`${CHAMP} col-span-2`} type="number" min={0} placeholder="coût +" value={v.cout_supplementaire_xaf}
                          onChange={(e) => majValeur(i, k, { cout_supplementaire_xaf: Number(e.target.value) || 0 })} />
                        <div className="col-span-3">
                          <NatureCout
                            categorie={v.categorie_cout} parCommande={v.cout_par_commande}
                            onChange={(patch) => majValeur(i, k, patch)}
                          />
                        </div>
                        <label className="col-span-1 flex items-center gap-1 text-[11px] text-gray-600" title="Ce choix exige une validation technique humaine">
                          <input type="checkbox" checked={v.validation_requise} onChange={(e) => majValeur(i, k, { validation_requise: e.target.checked })} /> À valider
                        </label>
                        <button type="button" onClick={() => maj(i, { valeurs: p.valeurs.filter((_, j) => j !== k) })}
                          className="col-span-1 flex items-center justify-center text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => maj(i, { valeurs: [...p.valeurs, { code: '', libelle: '', cout_supplementaire_xaf: 0, validation_requise: false, categorie_cout: 'option', cout_par_commande: false }] })}
                      className="text-[11px] font-semibold text-[#C62828]">+ Ajouter un choix</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <Button size="sm" variant="secondary" onClick={() => setParametres((ps) => [...ps, nouveauParametre()])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter un champ
            </Button>
            <Button size="sm" loading={enregistrer.isPending} onClick={() => enregistrer.mutate({ modeleId: modele.id, parametres })}>
              <Save className="h-3.5 w-3.5" /> Enregistrer
            </Button>
          </div>

          <TesteurConfiguration modeleId={modele.id} parametres={data?.data ?? []} />
        </div>
      )}
    </Modal>
  )
}

/**
 * Nature d'un coût d'option (Phase 4) : option produit, transport ou
 * installation ; par unité commandée ou forfait unique par commande.
 */
function NatureCout({ categorie, parCommande, onChange }: {
  categorie: CategorieCout
  parCommande: boolean
  onChange: (patch: { categorie_cout?: CategorieCout; cout_par_commande?: boolean }) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <select className={CHAMP} value={categorie} onChange={(e) => onChange({ categorie_cout: e.target.value as CategorieCout })}
        title="Nature du coût dans le coût de revient">
        <option value="option">Option</option>
        <option value="transport">Transport</option>
        <option value="installation">Installation</option>
      </select>
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-gray-600" title="Coché : compté une seule fois par commande, quelle que soit la quantité">
        <input type="checkbox" checked={parCommande} onChange={(e) => onChange({ cout_par_commande: e.target.checked })} /> /cde
      </label>
    </div>
  )
}

/** Essai interne : même calcul que le site, avec coût de revient et marge visibles. */
function TesteurConfiguration({ modeleId, parametres }: { modeleId: string; parametres: ParametreConfiguration[] }) {
  const estimer = useEstimerInterne()
  const [valeurs, setValeurs] = useState<Record<string, unknown>>({})
  const [quantite, setQuantite] = useState(1)
  const [resultat, setResultat] = useState<EstimationInterne | null>(null)

  if (parametres.length === 0) return null

  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Tester (configuration enregistrée)</p>
      <div className="grid grid-cols-3 gap-2">
        {parametres.map((p) => (
          <label key={p.code} className="text-[11px] text-gray-600">
            {p.libelle}{p.unite ? ` (${p.unite})` : ''}
            {p.type === 'nombre' && (
              <input className={CHAMP} type="number" onChange={(e) => setValeurs((v) => ({ ...v, [p.code]: nombreOuNull(e.target.value) }))} />
            )}
            {p.type === 'choix' && (
              <select className={CHAMP} defaultValue="" onChange={(e) => setValeurs((v) => ({ ...v, [p.code]: e.target.value || null }))}>
                <option value="">—</option>
                {(p.valeurs ?? []).map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}
              </select>
            )}
            {p.type === 'booleen' && (
              <input type="checkbox" className="ml-2" onChange={(e) => setValeurs((v) => ({ ...v, [p.code]: e.target.checked }))} />
            )}
          </label>
        ))}
        <label className="text-[11px] text-gray-600">Quantité
          <input className={CHAMP} type="number" min={1} value={quantite} onChange={(e) => setQuantite(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
      </div>
      <Button size="xs" className="mt-2" loading={estimer.isPending}
        onClick={() => estimer.mutate({ modeleId, valeurs, quantite }, { onSuccess: setResultat })}>
        <Calculator className="h-3 w-3" /> Calculer
      </Button>

      {resultat && (
        <div className="mt-3 space-y-1 text-xs">
          <p><span className="font-semibold">Statut :</span> {resultat.validation.statut}</p>
          {resultat.validation.erreurs.map((e) => <p key={e.parametre} className="text-red-600">{e.message}</p>)}
          {resultat.validation.horsLimites.map((h) => <p key={h.parametre} className="text-amber-700">{h.parametre} = {h.valeur} hors plage {h.min ?? '…'} – {h.max ?? '…'} → devis</p>)}
          {resultat.estimation.disponible ? (
            <div className="grid grid-cols-2 gap-x-4 rounded-lg bg-white p-2">
              {([
                ['Matériaux', resultat.estimation.estimation.coutMateriauxXaf],
                ['Consommables', resultat.estimation.estimation.coutConsommablesXaf],
                ["Main-d'œuvre", resultat.estimation.estimation.coutMainOeuvreXaf],
                ['Équipements', resultat.estimation.estimation.coutEquipementsXaf],
                ['Sous-traitance', resultat.estimation.estimation.coutSousTraitanceXaf],
                ['Options', resultat.estimation.estimation.coutOptionsXaf],
                ...resultat.estimation.estimation.lignesFraisIndirects.map((l) => [`Frais indirects — ${l.libelle}`, l.montantXaf] as const),
                ['Transport', resultat.estimation.estimation.coutTransportXaf],
                ['Installation', resultat.estimation.estimation.coutInstallationXaf],
              ] as const).filter(([, montant]) => montant > 0).map(([libelle, montant]) => (
                <React.Fragment key={libelle}>
                  <span>{libelle}</span><span className="text-right">{formatXAF(montant)}</span>
                </React.Fragment>
              ))}
              <span className="font-semibold">Coût de revient</span><span className="text-right font-semibold">{formatXAF(resultat.estimation.estimation.coutRevientXaf)}</span>
              <span>Marge ({resultat.estimation.estimation.tauxMargePct} %)</span><span className="text-right">{formatXAF(resultat.estimation.estimation.margeXaf)}</span>
              <span className="font-bold text-[#C62828]">Prix de vente HT</span><span className="text-right font-bold text-[#C62828]">{formatXAF(resultat.estimation.estimation.prixVenteHtXaf)}</span>
            </div>
          ) : (
            <p className="text-gray-600">{resultat.estimation.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
