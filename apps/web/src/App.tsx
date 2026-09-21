import React, { lazy, Suspense, Component, useState, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'
import { usePermissions } from '@/hooks/useRbac'
import type { RbacModule } from '@/hooks/useRbac'

// ── Error Boundary global ──────────────────────────────────────────────────────
// Attrape les erreurs non gérées dans l'arbre React et affiche un message
// lisible au lieu d'un écran blanc. Sans ça, un import manquant ou une prop
// undefined plante toute l'app silencieusement.

interface EBState { hasError: boolean; message: string }

class AppErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, message: '' }

  static getDerivedStateFromError(err: unknown): EBState {
    const message = err instanceof Error ? err.message : String(err)
    return { hasError: true, message }
  }

  componentDidCatch(err: unknown, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', err, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh',
        background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'sans-serif', padding: 40,
      }}>
        <h2 style={{ color: '#ef4444', marginBottom: 16 }}>Une erreur s'est produite</h2>
        <pre style={{
          background: '#2a2a3e', padding: '12px 20px', borderRadius: 8,
          maxWidth: 600, overflowX: 'auto', color: '#fca5a5', fontSize: 13,
        }}>
          {this.state.message}
        </pre>
        <button
          onClick={() => { this.setState({ hasError: false, message: '' }); window.location.href = '/login' }}
          style={{
            marginTop: 24, background: '#ef4444', color: 'white', border: 'none',
            padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 14,
          }}
        >
          Retour à la connexion
        </button>
      </div>
    )
  }
}

// Pages
const Login        = lazy(() => import('@/pages/Login'))
const SetPassword  = lazy(() => import('@/pages/SetPassword'))
const SetPin       = lazy(() => import('@/pages/SetPin'))
const Dashboard    = lazy(() => import('@/pages/Dashboard'))
const Stocks       = lazy(() => import('@/pages/Stocks'))
const Caisse       = lazy(() => import('@/pages/Caisse'))
const BonsSortie   = lazy(() => import('@/pages/stocks/BonsSortie'))
const BonsAppro    = lazy(() => import('@/pages/stocks/BonsAppro'))
const Commandes    = lazy(() => import('@/pages/Commandes'))
const Devis        = lazy(() => import('@/pages/Devis'))
const Clients      = lazy(() => import('@/pages/Clients'))
const ClientDetail = lazy(() => import('@/pages/clients/ClientDetail'))
const Finance      = lazy(() => import('@/pages/Finance'))
const RH           = lazy(() => import('@/pages/RH'))
const Intelligence = lazy(() => import('@/pages/Intelligence'))
const Production   = lazy(() => import('@/pages/Production'))
const Projets      = lazy(() => import('@/pages/Projets'))
const Logistique   = lazy(() => import('@/pages/Logistique'))
const Marketing    = lazy(() => import('@/pages/Marketing'))
const Securite     = lazy(() => import('@/pages/Securite'))
const IoT          = lazy(() => import('@/pages/IoT'))
const Formation    = lazy(() => import('@/pages/Formation'))
const Boutique     = lazy(() => import('@/pages/Boutique'))
const ModulePage   = lazy(() => import('@/pages/ModulePage'))
const Account           = lazy(() => import('@/pages/Account'))
const AdminSettings     = lazy(() => import('@/pages/AdminSettings'))
const Equipements       = lazy(() => import('@/pages/Equipements'))
const ApprouverDevis    = lazy(() => import('@/pages/devis/ApprouverDevis'))
const Fournisseurs      = lazy(() => import('@/pages/Fournisseurs'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 rounded-full border-2 border-[#C62828] border-t-transparent animate-spin" />
    </div>
  )
}

// ── Bannière mode hors-ligne ───────────────────────────────────────────────────

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [justBack, setJustBack] = useState(false)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline  = () => {
      setOffline(false)
      setJustBack(true)
      setTimeout(() => setJustBack(false), 4000)
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online',  goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online',  goOnline)
    }
  }, [])

  if (!offline && !justBack) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] text-center py-2 px-4 text-xs font-semibold text-white transition-all"
      style={{ backgroundColor: offline ? '#dc2626' : '#15803d' }}
    >
      {offline
        ? '⚠️ Mode hors-ligne — Les données sont enregistrées localement et synchronisées à la reconnexion.'
        : '✅ Connexion rétablie — Synchronisation en cours…'}
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, passwordMustChange, pinMustChange } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace />
  // Invitation/reset non finalisés : bloque tout le reste de l'app tant que
  // le mot de passe n'a pas été choisi — sans ça un utilisateur peut fermer
  // l'onglet de l'email et naviguer avec une session "à moitié" configurée.
  if (passwordMustChange && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />
  }
  // Même logique pour le PIN téléphone temporaire (généré par un admin ou par
  // l'activation self-service) — cf. apps/web/src/pages/SetPin.tsx.
  if (pinMustChange && location.pathname !== '/set-pin') {
    return <Navigate to="/set-pin" replace />
  }
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// Garde de route par permission RBAC — jusqu'ici SEULE la sidebar cachait les
// liens vers les modules sans permission ; rien n'empêchait une navigation
// directe par URL (ex: caissier tapant /finance dans la barre d'adresse).
// N'affiche rien tant que les permissions ne sont pas chargées (jamais de
// flash de contenu privilégié), redirige vers /dashboard une fois résolu si
// la permission manque — même mapping module que Sidebar.tsx.
function RequirePermission({ module, children }: { module: RbacModule; children: React.ReactNode }) {
  const { hasPermission, loading } = usePermissions()
  if (loading) return <PageLoader />
  if (!hasPermission(module, 'READ')) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function Shell({ children, requiredModule }: { children: React.ReactNode; requiredModule?: RbacModule }) {
  return (
    <ProtectedRoute>
      {requiredModule
        ? <RequirePermission module={requiredModule}><AppShell>{children}</AppShell></RequirePermission>
        : <AppShell>{children}</AppShell>}
    </ProtectedRoute>
  )
}

const PLACEHOLDER_MODULES = [] as const

const MODULE_LABELS: Record<string, string> = {}

function AppRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<PageLoader />}>
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

          {/* Première connexion (invitation) / reset mot de passe — gère elle-même
              le cas "pas de session" (lien expiré/déjà utilisé), donc ni Public
              ni Protected : ProtectedRoute y redirige explicitement plus haut. */}
          <Route path="/set-password" element={<SetPassword />} />

          {/* Choix du PIN téléphone (4 chiffres) — nécessite une session déjà
              établie (email, ou PIN temporaire déjà échangé), donc Protected
              contrairement à /set-password. */}
          <Route path="/set-pin" element={<ProtectedRoute><SetPin /></ProtectedRoute>} />

          {/* Redirect racine */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Dashboard */}
          <Route path="/dashboard" element={<Shell><Dashboard /></Shell>} />

          {/* Caisse — vente au comptoir */}
          <Route path="/caisse" element={<Shell requiredModule="CAISSE"><Caisse /></Shell>} />

          {/* Stocks + sous-routes */}
          <Route path="/stocks" element={<Shell requiredModule="STOCK"><Stocks /></Shell>} />
          <Route path="/stocks/bons-sortie"        element={<Shell requiredModule="STOCK"><BonsSortie /></Shell>} />
          <Route path="/stocks/approvisionnement" element={<Shell requiredModule="STOCK"><BonsAppro /></Shell>} />

          {/* Module commercial */}
          <Route path="/commandes" element={<Shell requiredModule="COMMERCIAL"><Commandes /></Shell>} />
          <Route path="/devis" element={<Shell requiredModule="COMMERCIAL"><Devis /></Shell>} />
          <Route path="/clients" element={<Shell requiredModule="COMMERCIAL"><Clients /></Shell>} />
          <Route path="/clients/:id" element={<Shell requiredModule="COMMERCIAL"><ClientDetail /></Shell>} />

          {/* Modules réels */}
          <Route path="/finance" element={<Shell requiredModule="FINANCE"><Finance /></Shell>} />
          <Route path="/rh" element={<Shell requiredModule="HR"><RH /></Shell>} />
          <Route path="/intelligence" element={<Shell requiredModule="REPORTS"><Intelligence /></Shell>} />
          <Route path="/production" element={<Shell requiredModule="PRODUCTION"><Production /></Shell>} />
          <Route path="/projets" element={<Shell requiredModule="PRODUCTION"><Projets /></Shell>} />
          <Route path="/logistique" element={<Shell requiredModule="LOGISTICS"><Logistique /></Shell>} />
          <Route path="/marketing" element={<Shell requiredModule="COMMERCIAL"><Marketing /></Shell>} />
          <Route path="/securite" element={<Shell requiredModule="HR"><Securite /></Shell>} />
          <Route path="/iot" element={<Shell requiredModule="PRODUCTION"><IoT /></Shell>} />
          <Route path="/formation" element={<Shell requiredModule="HR"><Formation /></Shell>} />
          <Route path="/boutique" element={<Shell requiredModule="COMMERCIAL"><Boutique /></Shell>} />

          {/* Équipements */}
          <Route path="/equipements" element={<Shell requiredModule="PRODUCTION"><Equipements /></Shell>} />

          {/* Fournisseurs */}
          <Route path="/fournisseurs" element={<Shell requiredModule="STOCK"><Fournisseurs /></Shell>} />

          {/* Account / settings — accessible à tout utilisateur authentifié */}
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="/admin"   element={<Shell requiredModule="ADMIN"><AdminSettings /></Shell>} />

          {/* Route publique — approbation devis (hors Shell/auth) */}
          <Route path="/devis/approuver/:token" element={<Suspense fallback={<PageLoader />}><ApprouverDevis /></Suspense>} />

          {/* Autres modules (placeholder) */}
          {PLACEHOLDER_MODULES.map((mod) => (
            <Route
              key={mod}
              path={`/${mod}`}
              element={<Shell><ModulePage title={MODULE_LABELS[mod]} /></Shell>}
            />
          ))}

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <OfflineBanner />
        <AppRoutes />
        <Toaster richColors position="top-right" expand closeButton />
      </AuthProvider>
    </AppErrorBoundary>
  )
}
