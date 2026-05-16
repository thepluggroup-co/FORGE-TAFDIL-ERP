import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'

const Login = lazy(() => import('@/pages/Login'))
const ModulePage = lazy(() => import('@/pages/ModulePage'))

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

const MODULES = [
  { path: '/production',   label: 'Production' },
  { path: '/stocks',       label: 'Stocks' },
  { path: '/commandes',    label: 'Commandes' },
  { path: '/devis',        label: 'Devis' },
  { path: '/finance',      label: 'Finance' },
  { path: '/rh',           label: 'RH' },
  { path: '/formation',    label: 'Formation' },
  { path: '/projets',      label: 'Projets' },
  { path: '/logistique',   label: 'Logistique' },
  { path: '/marketing',    label: 'Marketing' },
  { path: '/securite',     label: 'Sécurité' },
  { path: '/intelligence', label: 'Intelligence' },
  { path: '/iot',          label: 'IoT' },
  { path: '/boutique',     label: 'Boutique' },
] as const

function AppRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<PageLoader />}>
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected modules — AppShell wraps each */}
          <Route path="/" element={<Navigate to="/production" replace />} />
          {MODULES.map(({ path, label }) => (
            <Route
              key={path}
              path={path}
              element={
                <ProtectedRoute>
                  <AppShell>
                    <ModulePage title={label} />
                  </AppShell>
                </ProtectedRoute>
              }
            />
          ))}

          {/* Sub-routes (e.g. /commandes/123) */}
          {MODULES.map(({ path, label }) => (
            <Route
              key={`${path}/*`}
              path={`${path}/*`}
              element={
                <ProtectedRoute>
                  <AppShell>
                    <ModulePage title={label} />
                  </AppShell>
                </ProtectedRoute>
              }
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
