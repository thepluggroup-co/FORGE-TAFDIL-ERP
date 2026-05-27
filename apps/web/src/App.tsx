import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'

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
const Account       = lazy(() => import('@/pages/Account'))
const AdminSettings = lazy(() => import('@/pages/AdminSettings'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 rounded-full border-2 border-[#C62828] border-t-transparent animate-spin" />
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

          {/* Account / settings */}
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="/admin"   element={<Shell><AdminSettings /></Shell>} />

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
    <AuthProvider>
      <AppRoutes />
      <Toaster richColors position="top-right" expand closeButton />
    </AuthProvider>
  )
}
