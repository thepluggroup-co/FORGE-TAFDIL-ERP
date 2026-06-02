import React, { lazy, Suspense, Component, useState, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'

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
const Dashboard    = lazy(() => import('@/pages/Dashboard'))
const Stocks       = lazy(() => import('@/pages/Stocks'))
const BonsSortie   = lazy(() => import('@/pages/stocks/BonsSortie'))
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
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
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

          {/* Redirect racine */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Dashboard */}
          <Route path="/dashboard" element={<Shell><Dashboard /></Shell>} />

          {/* Stocks + sous-routes */}
          <Route path="/stocks" element={<Shell><Stocks /></Shell>} />
          <Route path="/stocks/bons-sortie" element={<Shell><BonsSortie /></Shell>} />

          {/* Module commercial */}
          <Route path="/commandes" element={<Shell><Commandes /></Shell>} />
          <Route path="/devis" element={<Shell><Devis /></Shell>} />
          <Route path="/clients" element={<Shell><Clients /></Shell>} />
          <Route path="/clients/:id" element={<Shell><ClientDetail /></Shell>} />

          {/* Modules réels */}
          <Route path="/finance" element={<Shell><Finance /></Shell>} />
          <Route path="/rh" element={<Shell><RH /></Shell>} />
          <Route path="/intelligence" element={<Shell><Intelligence /></Shell>} />
          <Route path="/production" element={<Shell><Production /></Shell>} />
          <Route path="/projets" element={<Shell><Projets /></Shell>} />
          <Route path="/logistique" element={<Shell><Logistique /></Shell>} />
          <Route path="/marketing" element={<Shell><Marketing /></Shell>} />
          <Route path="/securite" element={<Shell><Securite /></Shell>} />
          <Route path="/iot" element={<Shell><IoT /></Shell>} />
          <Route path="/formation" element={<Shell><Formation /></Shell>} />
          <Route path="/boutique" element={<Shell><Boutique /></Shell>} />

          {/* Équipements */}
          <Route path="/equipements" element={<Shell><Equipements /></Shell>} />

          {/* Account / settings */}
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="/admin"   element={<Shell><AdminSettings /></Shell>} />

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
