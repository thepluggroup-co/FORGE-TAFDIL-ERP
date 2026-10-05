/**
 * Parcours de formation d'un apprenant — partagé entre la vue RH (tiroir
 * Historique de Formation.tsx) et la page personnelle du technicien
 * (MonParcours.tsx).
 */
import { ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { Apprenant, FormationSession, ApprenantHistorique } from '@/hooks/useRH'

export const NIVEAU_COLORS: Record<number, string> = { 1: '#C62828', 2: '#d97706', 3: '#0891b2', 4: '#1d4ed8', 5: '#15803d' }

export const STATUS_SESSION: Record<FormationSession['statut'], { label: string; color: string; bg: string }> = {
  planifiee: { label: 'Planifiée',  color: '#1d4ed8', bg: '#dbeafe' },
  en_cours:  { label: 'En cours',  color: '#15803d', bg: '#dcfce7' },
  terminee:  { label: 'Terminée',  color: '#6b7280', bg: '#f3f4f6' },
  annulee:   { label: 'Annulée',   color: '#dc2626', bg: '#fee2e2' },
}

/** Télécharge l'attestation PDF avec le jeton (window.open n'envoie pas l'en-tête Authorization). */
export async function telechargerAttestation(path: string, nom: string) {
  try {
    const blob = await apiClient.getBlob(path)
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `Attestation-${nom.replace(/\s+/g, '-')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Téléchargement impossible')
  }
}

export function ParcoursResume({ apprenant, nbSessions }: { apprenant: Apprenant; nbSessions: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Niveau actuel', value: `${apprenant.niveau}/5`, color: NIVEAU_COLORS[apprenant.niveau] },
        { label: 'Durée totale',  value: `${apprenant.duree_mois} mois`, color: '#1d4ed8' },
        { label: 'Sessions',      value: String(nbSessions), color: '#7c3aed' },
      ].map(k => (
        <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold" style={{ color: k.color }}>{k.value}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">{k.label}</div>
        </div>
      ))}
    </div>
  )
}

export function ParcoursTimeline({ validations, inscriptions }: Pick<ApprenantHistorique, 'validations' | 'inscriptions'>) {
  // Frise chronologique fusionnée et triée
  type TimelineItem =
    | { type: 'niveau'; date: string | null; niveau: number; commentaire: string | null }
    | { type: 'session'; date: string | null; module: string; statut: string; evaluation: number | null; nb_seances: number; formateur?: string | null; lieu?: string | null }

  const timeline: TimelineItem[] = [
    ...validations.map(v => ({
      type:        'niveau' as const,
      date:        v.date_validation,
      niveau:      v.niveau,
      commentaire: v.commentaire,
    })),
    ...inscriptions.map(i => ({
      type:       'session' as const,
      date:       i.date_inscription,
      module:     i.formation_sessions?.module ?? '—',
      statut:     i.statut,
      evaluation: i.evaluation,
      nb_seances: i.nb_seances,
      formateur:  i.formation_sessions?.formateur ?? null,
      lieu:       i.formation_sessions?.lieu ?? null,
    })),
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  if (timeline.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        <ClipboardList className="h-8 w-8 mx-auto mb-2 text-gray-200" />
        Aucune activité enregistrée
      </div>
    )
  }

  return (
    <div className="relative pl-6">
      {/* Ligne verticale */}
      <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gray-200" />

      <div className="space-y-4">
        {timeline.map((item, i) => (
          <div key={i} className="relative">
            {/* Point */}
            <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm flex items-center justify-center"
              style={{ backgroundColor: item.type === 'niveau' ? (NIVEAU_COLORS[item.niveau] ?? '#C62828') : '#7c3aed' }} />

            <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-100">
              {item.type === 'niveau' ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: NIVEAU_COLORS[item.niveau] ?? '#C62828' }}>
                      Niveau {item.niveau} validé
                    </span>
                    {item.date && <span className="text-[11px] text-gray-400">{item.date}</span>}
                  </div>
                  {item.commentaire && (
                    <p className="text-xs text-gray-500 italic">« {item.commentaire} »</p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#212121]">{item.module}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ color: STATUS_SESSION[item.statut as FormationSession['statut']]?.color ?? '#6b7280', backgroundColor: STATUS_SESSION[item.statut as FormationSession['statut']]?.bg ?? '#f3f4f6' }}>
                      {STATUS_SESSION[item.statut as FormationSession['statut']]?.label ?? item.statut}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                    {item.date       && <span>📅 {item.date}</span>}
                    {item.formateur  && <span>👨‍🏫 {item.formateur}</span>}
                    {item.lieu       && <span>📍 {item.lieu}</span>}
                    {item.nb_seances > 0 && <span>✅ {item.nb_seances} séances suivies</span>}
                    {item.evaluation != null && <span>⭐ {item.evaluation}/20</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
