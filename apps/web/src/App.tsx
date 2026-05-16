import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'

// Pages
const Login       = lazy(() => import('@/pages/Login'))
const Dashboard   = lazy(() => import('@/pages/Dashboard'))
const Stocks      = lazy(() => import('@/pages/Stocks'))
const BonsSortie  = lazy(() => import('@/pages/stocks/BonsSortie'))
const ModulePage  = lazy(() => import('@/pages/ModulePage'))

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  )
}

const PLACEHOLDER_MODULES = [
  'production', 'commandes', 'devis', 'finance', 'rh',
  'formation', 'projets', 'logistique', 'marketing',
  'securite', 'intelligence', 'iot', 'boutique',
] as const

const MODULE_LABELS: Record<string, string> = {
  production: 'Production', commandes: 'Commandes', devis: 'Devis',
  finance: 'Finance', rh: 'RH', formation: 'Formation',
  projets: 'Projets', logistique: 'Logistique', marketing: 'Marketing',
  securite: 'Sécurité', intelligence: 'Intelligence', iot: 'IoT', boutique: 'Boutique',
}

function AppRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<PageLoader />}>
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Redirect racine */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Dashboard */}
          <Route path="/dashboard" element={<Shell><Dashboard /></Shell>} />

          {/* Stocks + sous-routes */}
          <Route path="/stocks" element={<Shell><Stocks /></Shell>} />
          <Route path="/stocks/bons-sortie" element={<Shell><BonsSortie /></Shell>} />

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
