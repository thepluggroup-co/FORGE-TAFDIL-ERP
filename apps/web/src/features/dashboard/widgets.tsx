/**
 * Indicateurs et listes du tableau de bord. Chaque widget charge ses propres
 * données (React Query déduplique les appels partagés) et n'est monté que si
 * layouts.ts l'a retenu pour le rôle ET les permissions de l'utilisateur.
 */
import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, ShoppingCart, Package, GraduationCap, AlertTriangle, ArrowRight, Loader2, Receipt,
  Wallet, Clock, FileText, PackageCheck, ClipboardList, Truck, Wrench, Cog, CalendarDays, Award,
  Banknote, CheckCircle2,
} from 'lucide-react'
import { KpiCard, StatusBadge } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useDashboardKpis, useFinanceDashboard } from '@/hooks/useFinance'
import { useAiAlertes } from '@/hooks/useAI'
import { useSessionCourante } from '@/hooks/useCaisse'
import { useDevis } from '@/hooks/useDevis'
import { useCommandes } from '@/hooks/useCommandes'
import { useStockAlertes, useMouvementsStock } from '@/hooks/useStocks'
import { useBonsEnAttente } from '@/hooks/useBons'
import { useJobs, useLivraisons } from '@/hooks/useOperations'
import type { Livraison } from '@/hooks/useOperations'
import { useIndicateursProduction } from '@/hooks/useControleCouts'
import { useApprenants, useFormationSessions, useMonParcours } from '@/hooks/useRH'
import { NAV_GROUPS } from '@/components/layout/Sidebar'
import type { RbacModule } from '@/hooks/useRbac'
import type { Can, KpiId, PanelId } from './layouts'
import {
  usePreparationResume, useMesLivraisons, useCreancesResume, useEcheancesEnRetard, useVentesCaisseDuJour,
} from './hooks'

const ICON = 'h-5 w-5'
const COLORS = {
  red: '#C62828', green: '#16a34a', blue: '#1d4ed8', cyan: '#0891b2', violet: '#6d28d9', amber: '#d97706',
}

interface KpiProps { delay: number }

/** Valeur d'un indicateur : « … » pendant le chargement, « — » si la donnée est indisponible. */
function val(loading: boolean, value: string | number | null | undefined): string | number {
  if (loading) return '…'
  return value ?? '—'
}

// ══════════════════════════════════════════════════════════════════════════════
// INDICATEURS
// ══════════════════════════════════════════════════════════════════════════════

// ── Synthèse entreprise ───────────────────────────────────────────────────────

function useCaTendance() {
  const { data, isLoading } = useDashboardKpis()
  const caMois = data?.ca_mensuel?.at(-1)?.ca ?? 0
  // Tendance CA : 3 derniers mois vs 3 premiers mois
  const tendance = useMemo(() => {
    const series = data?.ca_mensuel
    if (!series || series.length < 6) return null
    const recent = series.slice(3).reduce((s, m) => s + m.ca, 0)
    const old    = series.slice(0, 3).reduce((s, m) => s + m.ca, 0)
    if (old === 0) return null
    const pct = Math.round(((recent - old) / old) * 100)
    return pct >= 0 ? `+${pct}% vs M-3` : `${pct}% vs M-3`
  }, [data?.ca_mensuel])
  return { data, isLoading, caMois, tendance }
}

function KpiCaisseJour({ delay }: KpiProps) {
  const { data, isLoading } = useDashboardKpis()
  const count = data?.kpis.caisse_ventes_jour_count ?? 0
  return (
    <KpiCard
      title="Ventes caisse (jour)"
      value={val(isLoading, data && formatXAF(data.kpis.caisse_ventes_jour_xaf ?? 0))}
      trend={count > 0 ? 'up' : 'neutral'}
      trendValue={isLoading ? '' : `${count} transaction(s)`}
      icon={<Receipt className={ICON} />} color={COLORS.cyan} delay={delay}
    />
  )
}

function KpiCaMois({ delay }: KpiProps) {
  const { data, isLoading, caMois, tendance } = useCaTendance()
  return (
    <KpiCard
      title="CA du mois"
      value={val(isLoading, data && formatXAF(caMois))}
      trend={tendance?.startsWith('-') ? 'down' : caMois > 0 ? 'up' : 'neutral'}
      trendValue={isLoading ? '' : tendance ?? 'Aucune donnée'}
      icon={<TrendingUp className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

function KpiCommandesActivesGlobal({ delay }: KpiProps) {
  const { data, isLoading } = useDashboardKpis()
  return (
    <KpiCard
      title="Commandes en cours"
      value={val(isLoading, data?.kpis.commandes_actives)}
      trend="neutral" trendValue="Confirmées · en prod · prêtes"
      icon={<ShoppingCart className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

function KpiStocksCritiquesGlobal({ delay }: KpiProps) {
  const { data, isLoading } = useDashboardKpis()
  const n = data?.kpis.stocks_en_alerte ?? 0
  return (
    <KpiCard
      title="Stocks critiques" unit="produits"
      value={val(isLoading, data?.kpis.stocks_en_alerte)}
      trend={n ? 'down' : 'neutral'}
      trendValue={isLoading ? '' : n ? 'Alerte active' : 'Niveaux OK'}
      icon={<Package className={ICON} />} color={COLORS.red} delay={delay}
    />
  )
}

function KpiApprenantsGlobal({ delay }: KpiProps) {
  const { data, isLoading } = useDashboardKpis()
  return (
    <KpiCard
      title="Apprenants actifs"
      value={val(isLoading, data?.kpis.apprenants_actifs)}
      trend="neutral" trendValue="En formation TAFDIL"
      icon={<GraduationCap className={ICON} />} color={COLORS.violet} delay={delay}
    />
  )
}

// ── Finance / créances ────────────────────────────────────────────────────────

function KpiFinanceARecevoir({ delay }: KpiProps) {
  const { data, isLoading } = useFinanceDashboard()
  return (
    <KpiCard
      title="À recevoir (factures)"
      value={val(isLoading, data && formatXAF(data.kpis.a_recevoir_xaf))}
      trend={data && data.kpis.factures_en_retard > 0 ? 'down' : 'neutral'}
      trendValue={data ? `${data.kpis.taux_encaissement}% encaissé` : ''}
      icon={<Wallet className={ICON} />} color={COLORS.amber} delay={delay}
    />
  )
}

function KpiFinanceRetards({ delay }: KpiProps) {
  const { data, isLoading } = useFinanceDashboard()
  const n = data?.kpis.factures_en_retard ?? 0
  return (
    <KpiCard
      title="Factures en retard"
      value={val(isLoading, data?.kpis.factures_en_retard)}
      trend={n ? 'down' : 'neutral'}
      trendValue={data ? (n ? formatXAF(data.kpis.montant_retard_xaf) : 'Aucun retard') : ''}
      icon={<Clock className={ICON} />} color={COLORS.red} delay={delay}
    />
  )
}

function KpiCreancesEncours({ delay }: KpiProps) {
  const { data, isLoading } = useCreancesResume()
  return (
    <KpiCard
      title="Encours crédit clients"
      value={val(isLoading, data && formatXAF(data.totalEncours))}
      trend="neutral" trendValue={data ? `${data.activeClients} client(s)` : ''}
      icon={<Wallet className={ICON} />} color={COLORS.amber} delay={delay}
    />
  )
}

function KpiCreancesRetards({ delay }: KpiProps) {
  const { data, isLoading } = useCreancesResume()
  const n = data?.overdueCount ?? 0
  return (
    <KpiCard
      title="Échéances en retard"
      value={val(isLoading, data?.overdueCount)}
      trend={n ? 'down' : 'neutral'}
      trendValue={data ? (n ? 'À relancer' : 'Aucun retard') : ''}
      icon={<Clock className={ICON} />} color={COLORS.red} delay={delay}
    />
  )
}

// ── Caisse ────────────────────────────────────────────────────────────────────

function KpiCaisseSession({ delay }: KpiProps) {
  const { data: session, isLoading } = useSessionCourante()
  return (
    <KpiCard
      title="Ma session de caisse"
      value={val(isLoading, session ? 'Ouverte' : 'Fermée')}
      trend={session ? 'up' : 'neutral'}
      trendValue={isLoading ? '' : session ? `Fond ${formatXAF(session.fond_ouverture_xaf)}` : 'À ouvrir avant de vendre'}
      icon={<Banknote className={ICON} />} color={session ? COLORS.green : COLORS.amber} delay={delay}
    />
  )
}

function KpiCaisseMesVentes({ delay }: KpiProps) {
  const { isLoading, isError, total, count } = useVentesCaisseDuJour()
  return (
    <KpiCard
      title="Mes ventes du jour"
      value={val(isLoading, isError ? null : formatXAF(total))}
      trend={count > 0 ? 'up' : 'neutral'}
      trendValue={isLoading || isError ? '' : `${count} ticket(s)`}
      icon={<Receipt className={ICON} />} color={COLORS.cyan} delay={delay}
    />
  )
}

function KpiCaisseTicketMoyen({ delay }: KpiProps) {
  const { isLoading, isError, total, count } = useVentesCaisseDuJour()
  return (
    <KpiCard
      title="Ticket moyen"
      value={val(isLoading, isError || count === 0 ? null : formatXAF(Math.round(total / count)))}
      trend="neutral" trendValue="Aujourd'hui"
      icon={<TrendingUp className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

// ── Commercial ────────────────────────────────────────────────────────────────

function KpiDevisAttente({ delay }: KpiProps) {
  const { data, isLoading } = useDevis({ statut: 'envoye' })
  const devis = data?.data ?? []
  const montant = devis.reduce((s, d) => s + Number(d.montant_ttc_xaf ?? 0), 0)
  return (
    <KpiCard
      title="Devis en attente client"
      value={val(isLoading, data && devis.length)}
      trend="neutral" trendValue={data ? formatXAF(montant) : ''}
      icon={<FileText className={ICON} />} color={COLORS.violet} delay={delay}
    />
  )
}

function useCommandesOuvertes() {
  const { data, isLoading } = useCommandes()
  const commandes = data?.data ?? []
  return {
    loaded: !!data, isLoading,
    actives: commandes.filter((c) => ['confirmed', 'in_production', 'pret'].includes(c.statut)),
    pretes:  commandes.filter((c) => c.statut === 'pret'),
  }
}

function KpiCommandesActives({ delay }: KpiProps) {
  const { loaded, isLoading, actives } = useCommandesOuvertes()
  const enProd = actives.filter((c) => c.statut === 'in_production').length
  return (
    <KpiCard
      title="Commandes en cours"
      value={val(isLoading, loaded ? actives.length : null)}
      trend="neutral" trendValue={loaded ? `${enProd} en production` : ''}
      icon={<ShoppingCart className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

function KpiCommandesPretes({ delay }: KpiProps) {
  const { loaded, isLoading, pretes } = useCommandesOuvertes()
  const solde = pretes.reduce((s, c) => s + Number(c.solde_restant_xaf ?? 0), 0)
  return (
    <KpiCard
      title="Commandes prêtes"
      value={val(isLoading, loaded ? pretes.length : null)}
      trend={pretes.length ? 'up' : 'neutral'}
      trendValue={loaded ? (solde > 0 ? `${formatXAF(solde)} à encaisser` : 'À livrer') : ''}
      icon={<PackageCheck className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

// ── Stock / logistique ────────────────────────────────────────────────────────

function KpiStockAlertes({ delay }: KpiProps) {
  const { data, isLoading } = useStockAlertes()
  const produits = data?.data ?? []
  const ruptures = produits.filter((p) => p.statut === 'rupture').length
  return (
    <KpiCard
      title="Produits en alerte"
      value={val(isLoading, data && produits.length)}
      trend={produits.length ? 'down' : 'neutral'}
      trendValue={data ? (produits.length ? `${ruptures} en rupture` : 'Niveaux OK') : ''}
      icon={<Package className={ICON} />} color={COLORS.red} delay={delay}
    />
  )
}

function KpiBonsAttente({ delay }: KpiProps) {
  const { data, isLoading } = useBonsEnAttente()
  return (
    <KpiCard
      title="Bons de sortie en attente"
      value={val(isLoading, data)}
      trend={data ? 'down' : 'neutral'}
      trendValue={data === undefined ? '' : data ? 'À traiter' : 'Rien en attente'}
      icon={<ClipboardList className={ICON} />} color={COLORS.amber} delay={delay}
    />
  )
}

function KpiAPreparer({ delay }: KpiProps) {
  const { data, isLoading } = usePreparationResume()
  return (
    <KpiCard
      title="Bons à préparer"
      value={val(isLoading, data?.a_preparer)}
      trend="neutral" trendValue={data ? `${data.en_cours} en préparation` : ''}
      icon={<ClipboardList className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

function KpiPretALivrer({ delay }: KpiProps) {
  const { data, isLoading } = usePreparationResume()
  return (
    <KpiCard
      title="Prêts à livrer"
      value={val(isLoading, data?.pret_a_livrer)}
      trend={data?.pret_a_livrer ? 'up' : 'neutral'} trendValue="Préparation terminée"
      icon={<PackageCheck className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

function KpiLivraisonsPlanifiees({ delay }: KpiProps) {
  const { data, isLoading } = usePreparationResume()
  return (
    <KpiCard
      title="Livraisons planifiées"
      value={val(isLoading, data?.planifiee)}
      trend="neutral" trendValue="En attente de départ"
      icon={<Truck className={ICON} />} color={COLORS.cyan} delay={delay}
    />
  )
}

const LIVRAISON_CLOSE = ['livree', 'delivered', 'annulee', 'cancelled', 'echec_livraison']
const LIVRAISON_EN_ROUTE = ['en_route', 'en_transit']

function useMesLivraisonsResume() {
  const { data, isLoading } = useMesLivraisons()
  const livraisons = data?.data ?? []
  const today = new Date().toDateString()
  return {
    loaded: !!data, isLoading, livraisons,
    aLivrer: livraisons.filter((l) => !LIVRAISON_CLOSE.includes(l.statut) && !LIVRAISON_EN_ROUTE.includes(l.statut)),
    enRoute: livraisons.filter((l) => LIVRAISON_EN_ROUTE.includes(l.statut)),
    livreesJour: livraisons.filter((l) =>
      ['livree', 'delivered'].includes(l.statut)
      && !!l.date_livraison_reelle && new Date(l.date_livraison_reelle).toDateString() === today),
  }
}

function KpiLivreurALivrer({ delay }: KpiProps) {
  const { loaded, isLoading, aLivrer } = useMesLivraisonsResume()
  return (
    <KpiCard
      title="À livrer" value={val(isLoading, loaded ? aLivrer.length : null)}
      trend="neutral" trendValue="Assignées, pas encore parties"
      icon={<ClipboardList className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

function KpiLivreurEnRoute({ delay }: KpiProps) {
  const { loaded, isLoading, enRoute } = useMesLivraisonsResume()
  return (
    <KpiCard
      title="En route" value={val(isLoading, loaded ? enRoute.length : null)}
      trend="neutral" trendValue="En cours de livraison"
      icon={<Truck className={ICON} />} color={COLORS.amber} delay={delay}
    />
  )
}

function KpiLivreurLivrees({ delay }: KpiProps) {
  const { loaded, isLoading, livreesJour } = useMesLivraisonsResume()
  return (
    <KpiCard
      title="Livrées aujourd'hui" value={val(isLoading, loaded ? livreesJour.length : null)}
      trend={livreesJour.length ? 'up' : 'neutral'} trendValue="Signées par le client"
      icon={<CheckCircle2 className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

// ── Atelier ───────────────────────────────────────────────────────────────────

function KpiOfEnCours({ delay }: KpiProps) {
  const { data, isLoading } = useIndicateursProduction()
  return (
    <KpiCard
      title="OF en cours" value={val(isLoading, data?.of_en_cours)}
      trend="neutral" trendValue={data ? `${data.of_a_lancer} à lancer` : ''}
      icon={<Wrench className={ICON} />} color={COLORS.blue} delay={delay}
    />
  )
}

function KpiOfEnRetard({ delay }: KpiProps) {
  const { data, isLoading } = useIndicateursProduction()
  const n = data?.of_en_retard ?? 0
  return (
    <KpiCard
      title="OF en retard" value={val(isLoading, data?.of_en_retard)}
      trend={n ? 'down' : 'neutral'}
      trendValue={data ? (n ? 'Date de fin dépassée' : 'Dans les délais') : ''}
      icon={<Clock className={ICON} />} color={COLORS.red} delay={delay}
    />
  )
}

function KpiMachines({ delay }: KpiProps) {
  const { data, isLoading } = useIndicateursProduction()
  const m = data?.machines
  return (
    <KpiCard
      title="Machines opérationnelles"
      value={val(isLoading, m && `${m.operationnelles}/${m.total}`)}
      trend={m?.en_panne ? 'down' : 'neutral'}
      trendValue={m ? (m.en_panne ? `${m.en_panne} en panne` : `${m.en_maintenance} en maintenance`) : ''}
      icon={<Cog className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

// ── Formation ─────────────────────────────────────────────────────────────────

const NIVEAU_MAX = 5

function KpiApprenants({ delay }: KpiProps) {
  const { data, isLoading } = useApprenants({ statut: 'actif' })
  return (
    <KpiCard
      title="Apprenants actifs" value={val(isLoading, data && data.data.length)}
      trend="neutral" trendValue="En formation TAFDIL"
      icon={<GraduationCap className={ICON} />} color={COLORS.violet} delay={delay}
    />
  )
}

function KpiNiveauFinal({ delay }: KpiProps) {
  const { data, isLoading } = useApprenants({ statut: 'actif' })
  const n = data?.data.filter((a) => a.niveau >= NIVEAU_MAX).length
  return (
    <KpiCard
      title={`Niveau ${NIVEAU_MAX} atteint`} value={val(isLoading, n)}
      trend={n ? 'up' : 'neutral'} trendValue="Prêts à recruter"
      icon={<Award className={ICON} />} color={COLORS.green} delay={delay}
    />
  )
}

function KpiSessions({ delay, statut }: KpiProps & { statut: 'en_cours' | 'planifiee' }) {
  const { data, isLoading } = useFormationSessions({ statut })
  const sessions = data?.data ?? []
  const inscrits = sessions.reduce((s, x) => s + (x.nb_inscrits ?? 0), 0)
  return (
    <KpiCard
      title={statut === 'en_cours' ? 'Sessions en cours' : 'Sessions planifiées'}
      value={val(isLoading, data && sessions.length)}
      trend="neutral" trendValue={data ? `${inscrits} inscrit(s)` : ''}
      icon={<CalendarDays className={ICON} />} color={statut === 'en_cours' ? COLORS.blue : COLORS.cyan} delay={delay}
    />
  )
}

function KpiMonNiveau({ delay }: KpiProps) {
  // 404 APPRENANT_NON_LIE si le compte n'est rattaché à aucun apprenant → « — ».
  const { data, isLoading } = useMonParcours()
  return (
    <KpiCard
      title="Mon niveau de formation"
      value={val(isLoading, data && `${data.apprenant.niveau}/${NIVEAU_MAX}`)}
      trend="neutral" trendValue={data ? data.apprenant.specialite : 'Compte non rattaché'}
      icon={<Award className={ICON} />} color={COLORS.violet} delay={delay}
    />
  )
}

export const KPI_COMPONENTS: Record<KpiId, React.ComponentType<KpiProps>> = {
  'reports.caisse_jour':           KpiCaisseJour,
  'reports.ca_mois':               KpiCaMois,
  'reports.commandes_actives':     KpiCommandesActivesGlobal,
  'reports.stocks_critiques':      KpiStocksCritiquesGlobal,
  'reports.apprenants':            KpiApprenantsGlobal,
  'finance.a_recevoir':            KpiFinanceARecevoir,
  'finance.retards':               KpiFinanceRetards,
  'creances.encours':              KpiCreancesEncours,
  'creances.retards':              KpiCreancesRetards,
  'caisse.session':                KpiCaisseSession,
  'caisse.mes_ventes':             KpiCaisseMesVentes,
  'caisse.ticket_moyen':           KpiCaisseTicketMoyen,
  'commercial.devis_attente':      KpiDevisAttente,
  'commercial.commandes_actives':  KpiCommandesActives,
  'commercial.commandes_pretes':   KpiCommandesPretes,
  'stock.alertes':                 KpiStockAlertes,
  'stock.bons_attente':            KpiBonsAttente,
  'logistique.a_preparer':         KpiAPreparer,
  'logistique.pret_a_livrer':      KpiPretALivrer,
  'logistique.planifiees':         KpiLivraisonsPlanifiees,
  'livreur.a_livrer':              KpiLivreurALivrer,
  'livreur.en_route':              KpiLivreurEnRoute,
  'livreur.livrees':               KpiLivreurLivrees,
  'production.of_en_cours':        KpiOfEnCours,
  'production.of_en_retard':       KpiOfEnRetard,
  'production.machines':           KpiMachines,
  'formation.apprenants':          KpiApprenants,
  'formation.sessions_en_cours':   (p) => <KpiSessions {...p} statut="en_cours" />,
  'formation.sessions_planifiees': (p) => <KpiSessions {...p} statut="planifiee" />,
  'formation.niveau_final':        KpiNiveauFinal,
  'parcours.niveau':               KpiMonNiveau,
}

// ══════════════════════════════════════════════════════════════════════════════
// LISTES D'ACTIVITÉ
// ══════════════════════════════════════════════════════════════════════════════

interface PanelProps { delay: number; can: Can }

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />
}

const MAX_ROWS = 5

/** Cadre commun : titre, lien « Voir tout », états chargement / vide. */
function Panel({
  title, icon, badge, link, delay, loading, empty, children,
}: {
  title: string
  icon?: React.ReactNode
  badge?: number
  link?: string
  delay: number
  loading?: boolean
  /** Message affiché à la place du contenu quand il n'y a rien à montrer. */
  empty?: string | false
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm"
    >
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        {icon}
        <h2 className="text-sm font-semibold text-[#212121]">{title}</h2>
        {!!badge && (
          <span className="flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-[#C62828] text-white text-xs font-bold">
            {badge}
          </span>
        )}
        {link && (
          <button
            type="button"
            onClick={() => navigate(link)}
            className="ml-auto text-xs text-[#C62828] hover:underline font-medium"
          >
            Voir tout →
          </button>
        )}
      </div>
      {loading ? (
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center py-10 px-5 text-sm text-gray-400 text-center">{empty}</div>
      ) : (
        <div className="divide-y divide-gray-50">{children}</div>
      )}
    </motion.div>
  )
}

/** Ligne standard : libellé + sous-libellé à gauche, valeur + détail à droite. */
function Row({ title, subtitle, value, detail, valueClass }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  value?: React.ReactNode
  detail?: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#212121] truncate">{title}</div>
        {subtitle && <div className="text-xs text-gray-400 truncate mt-0.5">{subtitle}</div>}
      </div>
      {(value || detail) && (
        <div className="text-right shrink-0">
          {value && <div className={`text-sm font-semibold ${valueClass ?? 'text-[#212121]'}`}>{value}</div>}
          {detail && <div className="text-xs text-gray-400">{detail}</div>}
        </div>
      )}
    </div>
  )
}

function dateCourte(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : '—'
}

// ── Alertes prioritaires ──────────────────────────────────────────────────────

// Module RBAC d'une page, d'après la sidebar — une alerte dont la page n'est pas
// accessible à l'utilisateur n'est pas proposée (le clic renverrait au dashboard).
const MODULE_PAR_PAGE = new Map<string, RbacModule | undefined>(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.path, i.requiredModule]),
)

function peutOuvrir(link: string, can: Can): boolean {
  const page = `/${link.split('/')[1] ?? ''}`
  const module = MODULE_PAR_PAGE.get(page)
  return !module || can(module, 'READ')
}

type DashboardAlert = { id: string; level: 'critique' | 'danger' | 'warning'; message: string; link: string }

function PanelAlertes({ delay, can }: PanelProps) {
  const navigate = useNavigate()
  const { data: dashboard, isLoading } = useDashboardKpis()
  const { data: aiData, isLoading: aiLoading } = useAiAlertes()

  // Alertes dérivées des KPIs réels
  const derivees = useMemo(() => {
    if (!dashboard?.kpis) return []
    const { stocks_en_alerte, credits_echus, bons_en_attente } = dashboard.kpis
    const result: DashboardAlert[] = []
    if (stocks_en_alerte > 0)
      result.push({ id: 'stock',  level: 'critique', message: `${stocks_en_alerte} produit(s) en alerte de stock`, link: '/stocks' })
    if (credits_echus > 0)
      result.push({ id: 'credit', level: 'danger',   message: `${credits_echus} crédit(s) client échu(s) en attente`, link: '/finance' })
    if (bons_en_attente > 0)
      result.push({ id: 'bons',   level: 'warning',  message: `${bons_en_attente} bon(s) de sortie en attente de validation`, link: '/stocks/bons-sortie' })
    return result
  }, [dashboard?.kpis])

  const alertes = useMemo(() => {
    const ai: DashboardAlert[] = (aiData?.alertes ?? []).map((a) => ({
      id:      a.id,
      level:   a.severite === 'critique' ? 'critique' : a.severite === 'alerte' ? 'danger' : 'warning',
      message: `${a.titre} - ${a.description}`,
      link:    a.lien ?? '/intelligence',
    }))
    const base = ai.length > 0 ? ai : derivees
    const bons = derivees.find((a) => a.id === 'bons')
    const merged = bons && !base.some((a) => a.id === 'bons') ? [...base, bons] : base
    return merged.filter((a) => peutOuvrir(a.link, can)).slice(0, 6)
  }, [aiData?.alertes, derivees, can])

  return (
    <Panel
      title="Alertes prioritaires" delay={delay} badge={alertes.length}
      icon={<AlertTriangle className="h-4 w-4 text-[#C62828]" />}
      loading={isLoading || (aiLoading && alertes.length === 0)}
      empty={alertes.length === 0 && 'Aucune alerte active'}
    >
      {alertes.map((alert) => (
        <button
          key={alert.id}
          type="button"
          onClick={() => navigate(alert.link)}
          className="flex items-start gap-3 w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors group"
        >
          <span className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5 ${
            alert.level === 'critique' ? 'bg-red-100' : alert.level === 'danger' ? 'bg-amber-100' : 'bg-orange-50'
          }`}>
            <AlertTriangle className={`h-3.5 w-3.5 ${
              alert.level === 'critique' ? 'text-red-600' : alert.level === 'danger' ? 'text-amber-600' : 'text-orange-600'
            }`} />
          </span>
          <span className="text-sm text-[#212121] flex-1 leading-snug">{alert.message}</span>
          <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-[#C62828] transition-colors shrink-0 mt-0.5" />
        </button>
      ))}
    </Panel>
  )
}

// ── Chiffre d'affaires 6 mois ─────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-[#212121]">{formatXAF(payload[0].value)}</p>
    </div>
  )
}

function PanelCaChart({ delay }: PanelProps) {
  const { data, isLoading, tendance } = useCaTendance()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-[#212121]">Chiffre d'affaires — 6 derniers mois</h2>
        {tendance && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            tendance.startsWith('+') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'
          }`}>
            {tendance}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center h-[200px]">
          <Loader2 className="h-6 w-6 text-gray-300 animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data?.ca_mensuel ?? []} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8f8f8' }} />
            <Bar dataKey="ca" fill="#C62828" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </motion.div>
  )
}

// ── Commercial / finance ──────────────────────────────────────────────────────

function PanelCommandesRecentes({ delay }: PanelProps) {
  const { data, isLoading } = useDashboardKpis()
  const commandes = data?.recent_commandes ?? []
  return (
    <Panel title="Dernières commandes" link="/commandes" delay={delay} loading={isLoading}
      empty={commandes.length === 0 && 'Aucune commande'}>
      {commandes.map((order) => (
        <Row
          key={order.id}
          title={order.client_nom}
          subtitle={<span className="inline-flex items-center gap-2"><span className="font-mono">{order.numero}</span><StatusBadge status={order.statut} /></span>}
          value={formatXAF(order.total_ttc_xaf)}
          detail={dateCourte(order.date_commande)}
        />
      ))}
    </Panel>
  )
}

function PanelDevisSuivi({ delay }: PanelProps) {
  const { data, isLoading } = useDevis({ statut: 'envoye' })
  // Les plus proches de l'expiration d'abord : ce sont ceux à relancer.
  const devis = [...(data?.data ?? [])]
    .sort((a, b) => (a.jours_restants ?? Infinity) - (b.jours_restants ?? Infinity))
    .slice(0, MAX_ROWS)
  return (
    <Panel title="Devis à relancer" link="/devis" delay={delay} loading={isLoading}
      empty={devis.length === 0 && 'Aucun devis en attente de réponse client'}>
      {devis.map((d) => {
        const urgent = d.expire || (d.jours_restants !== null && d.jours_restants <= 3)
        return (
          <Row
            key={d.id}
            title={d.client?.nom ?? 'Client'}
            subtitle={<span className="font-mono">{d.reference}</span>}
            value={formatXAF(d.montant_ttc_xaf)}
            detail={
              <span className={urgent ? 'text-red-600 font-medium' : undefined}>
                {d.expire ? 'Expiré' : d.jours_restants !== null ? `Expire dans ${d.jours_restants} j` : 'Sans échéance'}
              </span>
            }
          />
        )
      })}
    </Panel>
  )
}

function PanelFacturesRetard({ delay }: PanelProps) {
  const { data, isLoading } = useFinanceDashboard()
  const factures = (data?.factures_en_retard ?? []).slice(0, MAX_ROWS)
  return (
    <Panel title="Factures en retard" link="/finance" delay={delay} loading={isLoading}
      badge={data?.kpis.factures_en_retard}
      empty={factures.length === 0 && 'Aucune facture en retard'}>
      {factures.map((f) => (
        <Row
          key={f.id}
          title={f.client_nom}
          subtitle={<span className="font-mono">{f.numero}</span>}
          value={formatXAF(f.solde_restant_xaf)} valueClass="text-red-600"
          detail={`Échue le ${dateCourte(f.date_echeance)}`}
        />
      ))}
    </Panel>
  )
}

function PanelCreancesRetard({ delay, can }: PanelProps) {
  const { data, isLoading } = useEcheancesEnRetard()
  const echeances = (data ?? []).slice(0, MAX_ROWS)
  return (
    <Panel title="Échéances clients en retard" delay={delay} loading={isLoading}
      link={can('FINANCE') ? '/finance' : undefined} badge={data?.length}
      empty={echeances.length === 0 && 'Aucune échéance en retard'}>
      {echeances.map((e) => (
        <Row
          key={e.id}
          title={e.payment_plans?.clients?.nom ?? 'Client'}
          subtitle={e.payment_plans?.clients?.telephone ?? `Échéance n° ${e.installment_number}`}
          value={formatXAF(Number(e.amount_due) - Number(e.amount_paid ?? 0))} valueClass="text-red-600"
          detail={`${e.days_late} j de retard`}
        />
      ))}
    </Panel>
  )
}

// ── Caisse ────────────────────────────────────────────────────────────────────

function PanelCaisseVentes({ delay }: PanelProps) {
  const { tickets, isLoading } = useVentesCaisseDuJour()
  return (
    <Panel title="Mes ventes du jour" link="/caisse" delay={delay} loading={isLoading}
      empty={tickets.length === 0 && "Aucune vente enregistrée aujourd'hui"}>
      {tickets.slice(0, MAX_ROWS).map((t) => (
        <Row
          key={t.id}
          title={t.client_nom ?? 'Client comptoir'}
          subtitle={<span className="font-mono">{t.numero_facture ?? t.numero_local ?? '—'}</span>}
          value={formatXAF(t.total_ttc_xaf)}
          detail={new Date(t.created_at).toLocaleTimeString('fr-CM', { hour: '2-digit', minute: '2-digit' })}
        />
      ))}
    </Panel>
  )
}

// ── Stock / logistique ────────────────────────────────────────────────────────

function PanelStockAlertes({ delay }: PanelProps) {
  const { data, isLoading } = useStockAlertes()
  // L'API trie déjà du stock le plus bas au plus haut.
  const produits = data?.data ?? []
  return (
    <Panel title="Produits en alerte" link="/stocks" delay={delay} loading={isLoading} badge={produits.length}
      empty={produits.length === 0 && 'Tous les niveaux de stock sont corrects'}>
      {produits.slice(0, MAX_ROWS).map((p) => (
        <Row
          key={p.id}
          title={p.designation}
          subtitle={<span className="font-mono">{p.ref}</span>}
          value={p.stock_actuel <= 0 ? 'Rupture' : `${p.stock_actuel} ${p.unite}`}
          valueClass={p.statut === 'alerte' ? 'text-amber-600' : 'text-red-600'}
          detail={`Seuil ${p.stock_min} ${p.unite}`}
        />
      ))}
    </Panel>
  )
}

function PanelMouvements({ delay }: PanelProps) {
  const { data, isLoading } = useMouvementsStock()
  const mouvements = (data?.data ?? []).slice(0, MAX_ROWS)
  return (
    <Panel title="Derniers mouvements stock" link="/stocks" delay={delay} loading={isLoading}
      empty={mouvements.length === 0 && 'Aucun mouvement récent'}>
      {mouvements.map((mv) => {
        const entree = mv.type === 'entree'
        return (
          <div key={mv.id} className="flex items-center gap-3 px-5 py-3">
            <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
              entree ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}>
              {entree ? '↓' : '↑'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[#212121] truncate">
                {mv.produits?.designation ?? 'Produit supprimé'}
              </div>
              <div className="text-xs text-gray-400">
                {new Date(mv.created_at).toLocaleString('fr-CM', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
            <div className={`text-sm font-semibold shrink-0 ${entree ? 'text-green-700' : 'text-red-600'}`}>
              {entree ? '+' : '-'}{mv.quantite} {mv.produits?.unite ?? ''}
            </div>
          </div>
        )
      })}
    </Panel>
  )
}

// StatusBadge (@forge/ui) ne connaît pas les statuts de livraison.
const LIVRAISON_STATUT: Record<string, { label: string; className: string }> = {
  en_preparation:  { label: 'En préparation', className: 'bg-gray-100 text-gray-600' },
  confirmed:       { label: 'En préparation', className: 'bg-gray-100 text-gray-600' },
  pret:            { label: 'Prête',          className: 'bg-purple-50 text-purple-700' },
  planifiee:       { label: 'Planifiée',      className: 'bg-blue-50 text-blue-700' },
  en_route:        { label: 'En route',       className: 'bg-amber-50 text-amber-700' },
  en_transit:      { label: 'En route',       className: 'bg-amber-50 text-amber-700' },
  livree:          { label: 'Livrée',         className: 'bg-green-50 text-green-700' },
  delivered:       { label: 'Livrée',         className: 'bg-green-50 text-green-700' },
  echec_livraison: { label: 'Échec',          className: 'bg-red-50 text-red-600' },
  annulee:         { label: 'Annulée',        className: 'bg-red-50 text-red-600' },
  cancelled:       { label: 'Annulée',        className: 'bg-red-50 text-red-600' },
}

function LivraisonStatut({ statut }: { statut: string }) {
  const s = LIVRAISON_STATUT[statut] ?? { label: statut, className: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${s.className}`}>{s.label}</span>
}

function LivraisonRows({ livraisons }: { livraisons: Livraison[] }) {
  return (
    <>
      {livraisons.map((l) => (
        <Row
          key={l.id}
          title={l.client_nom}
          subtitle={l.destination}
          value={<LivraisonStatut statut={l.statut} />}
          detail={l.date_livraison_prevue ? `Prévue le ${dateCourte(l.date_livraison_prevue)}` : <span className="font-mono">{l.numero}</span>}
        />
      ))}
    </>
  )
}

function PanelLivraisons({ delay }: PanelProps) {
  const { data, isLoading } = useLivraisons({ per_page: 50 })
  const ouvertes = (data?.data ?? []).filter((l) => !LIVRAISON_CLOSE.includes(l.statut))
  return (
    <Panel title="Livraisons en cours" link="/logistique" delay={delay} loading={isLoading} badge={ouvertes.length}
      empty={ouvertes.length === 0 && 'Aucune livraison en cours'}>
      <LivraisonRows livraisons={ouvertes.slice(0, MAX_ROWS)} />
    </Panel>
  )
}

function PanelMesLivraisons({ delay }: PanelProps) {
  const { isLoading, aLivrer, enRoute } = useMesLivraisonsResume()
  const ouvertes = [...enRoute, ...aLivrer]
  return (
    <Panel title="Mes livraisons" link="/logistique" delay={delay} loading={isLoading} badge={ouvertes.length}
      empty={ouvertes.length === 0 && 'Aucune livraison assignée pour le moment'}>
      <LivraisonRows livraisons={ouvertes.slice(0, 8)} />
    </Panel>
  )
}

// ── Atelier ───────────────────────────────────────────────────────────────────

function PanelOfEnCours({ delay }: PanelProps) {
  const { data, isLoading } = useJobs({ statut: 'in_production' })
  // En retard d'abord, puis par date de fin prévue.
  const jobs = [...(data?.data ?? [])]
    .sort((a, b) =>
      Number(!!b.en_retard) - Number(!!a.en_retard)
      || (a.date_fin_prevue ?? '9999').localeCompare(b.date_fin_prevue ?? '9999'))
    .slice(0, MAX_ROWS)
  return (
    <Panel title="Ordres de fabrication en cours" link="/production" delay={delay} loading={isLoading}
      empty={jobs.length === 0 && 'Aucun OF en production'}>
      {jobs.map((j) => (
        <Row
          key={j.id}
          title={j.produit_designation}
          subtitle={[j.numero, j.technicien_nom, j.machine_nom].filter(Boolean).join(' · ')}
          value={`${j.avancement_pct}%`}
          valueClass={j.en_retard ? 'text-red-600' : undefined}
          detail={j.en_retard ? 'En retard' : j.date_fin_prevue ? `Fin ${dateCourte(j.date_fin_prevue)}` : undefined}
        />
      ))}
    </Panel>
  )
}

// ── Formation ─────────────────────────────────────────────────────────────────

function PanelFormationSessions({ delay }: PanelProps) {
  const { data, isLoading } = useFormationSessions()
  const sessions = (data?.data ?? [])
    .filter((s) => s.statut === 'en_cours' || s.statut === 'planifiee')
    .sort((a, b) => (a.date_debut ?? '9999').localeCompare(b.date_debut ?? '9999'))
    .slice(0, MAX_ROWS)
  return (
    <Panel title="Sessions de formation" link="/formation" delay={delay} loading={isLoading}
      empty={sessions.length === 0 && 'Aucune session en cours ou planifiée'}>
      {sessions.map((s) => (
        <Row
          key={s.id}
          title={s.module}
          subtitle={`Niveau ${s.niveau}${s.formateur ? ` · ${s.formateur}` : ''}${s.lieu ? ` · ${s.lieu}` : ''}`}
          value={`${s.nb_inscrits}/${s.capacite_max}`}
          detail={s.statut === 'en_cours' ? 'En cours' : `Début ${dateCourte(s.date_debut)}`}
        />
      ))}
    </Panel>
  )
}

function PanelFormationApprenants({ delay }: PanelProps) {
  const { data, isLoading } = useApprenants({ statut: 'actif' })
  const apprenants = data?.data ?? []
  const niveaux = Array.from({ length: NIVEAU_MAX }, (_, i) => i + 1)
  return (
    <Panel title="Apprenants par niveau" link="/formation" delay={delay} loading={isLoading}
      empty={apprenants.length === 0 && 'Aucun apprenant actif'}>
      {niveaux.map((n) => {
        const count = apprenants.filter((a) => a.niveau === n).length
        return (
          <div key={n} className="flex items-center gap-3 px-5 py-3">
            <span className="text-sm font-medium text-[#212121] w-20 shrink-0">Niveau {n}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-[#6d28d9]" style={{ width: `${(count / apprenants.length) * 100}%` }} />
            </div>
            <span className="text-sm font-semibold text-[#212121] tabular-nums w-8 text-right">{count}</span>
          </div>
        )
      })}
    </Panel>
  )
}

function PanelMonParcours({ delay }: PanelProps) {
  const { data, isLoading } = useMonParcours()
  const inscriptions = (data?.inscriptions ?? [])
    .filter((i) => i.statut === 'inscrit' || i.statut === 'en_cours')
    .slice(0, MAX_ROWS)
  return (
    <Panel title="Mon parcours de formation" link="/formation" delay={delay} loading={isLoading}
      empty={
        !data ? "Votre compte n'est rattaché à aucun parcours de formation"
        : inscriptions.length === 0 && 'Aucune session en cours — consultez votre parcours complet'
      }>
      {inscriptions.map((i) => (
        <Row
          key={i.id}
          title={i.formation_sessions?.module ?? 'Session'}
          subtitle={`Niveau ${i.formation_sessions?.niveau ?? '—'}${i.formation_sessions?.formateur ? ` · ${i.formation_sessions.formateur}` : ''}`}
          value={`${i.nb_seances} séance(s)`}
          detail={i.statut === 'en_cours' ? 'En cours' : 'Inscrit'}
        />
      ))}
    </Panel>
  )
}

export const PANEL_COMPONENTS: Record<PanelId, React.ComponentType<PanelProps>> = {
  alertes:              PanelAlertes,
  ca_chart:             PanelCaChart,
  commandes_recentes:   PanelCommandesRecentes,
  factures_retard:      PanelFacturesRetard,
  creances_retard:      PanelCreancesRetard,
  caisse_ventes:        PanelCaisseVentes,
  devis_suivi:          PanelDevisSuivi,
  stock_alertes:        PanelStockAlertes,
  mouvements:           PanelMouvements,
  livraisons:           PanelLivraisons,
  mes_livraisons:       PanelMesLivraisons,
  of_en_cours:          PanelOfEnCours,
  formation_sessions:   PanelFormationSessions,
  formation_apprenants: PanelFormationApprenants,
  mon_parcours:         PanelMonParcours,
}
