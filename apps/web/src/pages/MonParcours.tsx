/**
 * Mon parcours — vue Formation du technicien.
 * N'affiche que l'apprenant rattaché au compte connecté : l'API filtre sur
 * apprenants.profile_id = utilisateur courant, aucun identifiant n'est passé.
 */
import { Download, AlertCircle } from 'lucide-react'
import { PageHeader, Button } from '@forge/ui'
import { useMonParcours } from '@/hooks/useRH'
import {
  NIVEAU_COLORS, ParcoursResume, ParcoursTimeline, telechargerAttestation,
} from '@/components/formation/ParcoursTimeline'

const STATUT_LABELS: Record<string, string> = {
  actif:    'En formation',
  suspendu: 'Suspendu',
  diplome:  'Diplômé',
  recrute:  'Recruté',
}

export default function MonParcours() {
  const { data, isLoading, error } = useMonParcours()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mon parcours" subtitle="Formation" breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Mon parcours' }]} />
        <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-sm text-gray-500">
          <AlertCircle className="h-8 w-8 mx-auto mb-3 text-gray-300" />
          {error instanceof Error ? error.message : 'Parcours indisponible'}
        </div>
      </div>
    )
  }

  const { apprenant, validations, inscriptions } = data
  const termine = apprenant.statut === 'diplome' || apprenant.statut === 'recrute'

  return (
    <div className="space-y-6">
      <PageHeader title="Mon parcours" subtitle={apprenant.specialite} breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Mon parcours' }]} />

      <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-5 max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-[#212121]">{apprenant.nom}</div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white mt-1 inline-block"
              style={{ backgroundColor: NIVEAU_COLORS[apprenant.niveau] ?? '#C62828' }}>
              {STATUT_LABELS[apprenant.statut] ?? apprenant.statut}
            </span>
          </div>
          <Button
            variant="secondary" size="sm" disabled={!termine}
            title={termine ? 'Télécharger mon attestation' : 'Disponible une fois la formation terminée'}
            onClick={() => void telechargerAttestation('/api/formation/mon-parcours/attestation', apprenant.nom)}
          >
            <Download className="h-3.5 w-3.5" /> Attestation
          </Button>
        </div>

        <ParcoursResume apprenant={apprenant} nbSessions={inscriptions.length} />
        <ParcoursTimeline validations={validations} inscriptions={inscriptions} />
      </div>
    </div>
  )
}
