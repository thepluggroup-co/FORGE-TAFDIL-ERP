import React from 'react'
import { motion } from 'framer-motion'
import { Wifi, Activity, AlertTriangle, Database } from 'lucide-react'
import { PageHeader, KpiCard, DataTable } from '@forge/ui'
import type { Column } from '@forge/ui'

interface Capteur extends Record<string, unknown> {
  id: string; nom: string; type: string; zone: string
  valeur: string; unite: string; batterie: number
  derniereSynchro: string; statut: string
}

const CAPTEURS: Capteur[] = [
  { id: '1', nom: 'TEMP-ATL-01', type: 'Température', zone: 'Atelier soudure', valeur: '34.2', unite: '°C', batterie: 87, derniereSynchro: '2026-05-16 09:52', statut: 'actif' },
  { id: '2', nom: 'TEMP-ATL-02', type: 'Température', zone: 'Atelier CNC', valeur: '28.7', unite: '°C', batterie: 62, derniereSynchro: '2026-05-16 09:51', statut: 'actif' },
  { id: '3', nom: 'VIBR-CNC-01', type: 'Vibration', zone: 'Machine CNC Deckel', valeur: '4.2', unite: 'mm/s', batterie: 91, derniereSynchro: '2026-05-16 09:53', statut: 'alerte' },
  { id: '4', nom: 'HUMI-STOCK-01', type: 'Humidité', zone: 'Stock matières', valeur: '68.4', unite: '%RH', batterie: 45, derniereSynchro: '2026-05-16 09:40', statut: 'actif' },
  { id: '5', nom: 'ELEC-COMP-01', type: 'Consommation électrique', zone: 'Tableau général', valeur: '42.8', unite: 'kW', batterie: 100, derniereSynchro: '2026-05-16 09:53', statut: 'actif' },
  { id: '6', nom: 'BRUIT-ATL-01', type: 'Niveau sonore', zone: 'Atelier soudure', valeur: '94.5', unite: 'dB', batterie: 73, derniereSynchro: '2026-05-16 09:50', statut: 'alerte' },
  { id: '7', nom: 'GAZ-ATL-01', type: 'Détection gaz', zone: 'Atelier soudure', valeur: 'OK', unite: '—', batterie: 88, derniereSynchro: '2026-05-16 09:52', statut: 'actif' },
  { id: '8', nom: 'PRES-COMP-01', type: 'Pression compresseur', zone: 'Salle compresseurs', valeur: '6.8', unite: 'bar', batterie: 0, derniereSynchro: '2026-05-14 15:30', statut: 'hors_ligne' },
]

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  actif:      { label: 'Actif',      color: '#15803d', bg: '#dcfce7' },
  alerte:     { label: 'Alerte',     color: '#dc2626', bg: '#fee2e2' },
  hors_ligne: { label: 'Hors ligne', color: '#6b7280', bg: '#f3f4f6' },
}

const columns: Column<Capteur>[] = [
  {
    id: 'nom', header: 'Capteur', accessor: 'nom',
    render: (v, row) => (
      <div>
        <div className="font-mono text-xs font-semibold text-gray-700">{v as string}</div>
        <div className="text-xs text-gray-400 mt-0.5">{row.type as string}</div>
      </div>
    ),
  },
  { id: 'zone', header: 'Zone', accessor: 'zone', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  {
    id: 'valeur', header: 'Dernière valeur', accessor: (row) => `${row.valeur} ${row.unite}`,
    render: (v, row) => (
      <span className="text-sm font-bold" style={{ color: row.statut === 'alerte' ? '#dc2626' : '#212121' }}>
        {row.valeur as string} <span className="text-gray-400 font-normal text-xs">{row.unite as string}</span>
      </span>
    ),
  },
  {
    id: 'batterie', header: 'Batterie', accessor: 'batterie',
    render: (v) => {
      const pct = v as number
      const color = pct > 50 ? '#15803d' : pct > 20 ? '#d97706' : '#dc2626'
      return (
        <div className="flex items-center gap-2 w-24">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color }}>{pct}%</span>
        </div>
      )
    },
  },
  { id: 'synchro', header: 'Dernière synchro', accessor: 'derniereSynchro', render: (v) => <span className="text-xs text-gray-400 font-mono">{v as string}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

export default function IoT() {
  const actifs = CAPTEURS.filter(c => c.statut === 'actif').length
  const alertes = CAPTEURS.filter(c => c.statut === 'alerte').length
  const totalDonnees = '2 847'

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="IoT — Capteurs"
        subtitle="Monitoring en temps réel · Atelier TAFDIL"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'IoT' }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Capteurs actifs" value={`${actifs}/${CAPTEURS.length}`} icon={<Wifi className="h-5 w-5" />} color="#15803d" delay={0} />
        <KpiCard title="Alertes actives" value={alertes} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trend={alertes > 0 ? 'down' : 'neutral'} trendValue={alertes > 0 ? 'Vérification requise' : 'RAS'} delay={0.07} />
        <KpiCard title="Uptime moyen" value="99.2" unit="%" icon={<Activity className="h-5 w-5" />} color="#1d4ed8" trend="up" trendValue="SLA respecté" delay={0.14} />
        <KpiCard title="Mesures / 24h" value={totalDonnees} icon={<Database className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      {alertes > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[#dc2626] shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[#dc2626] text-sm">{alertes} capteur(s) en alerte</div>
            <div className="text-xs text-red-600 mt-0.5">
              VIBR-CNC-01 : Vibration anormale (4,2 mm/s &gt; seuil 3,5) · BRUIT-ATL-01 : Niveau sonore critique (94,5 dB &gt; seuil 90)
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-[#212121]">Tous les capteurs</h2>
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="flex items-center gap-1.5 text-xs text-[#15803d] font-medium"
          >
            <div className="w-2 h-2 rounded-full bg-[#15803d]" />
            En direct
          </motion.div>
        </div>
        <DataTable<Capteur> columns={columns} data={CAPTEURS} keyField="id" />
      </div>
    </motion.div>
  )
}
