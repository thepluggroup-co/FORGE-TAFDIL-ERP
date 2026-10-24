import React from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PermissionsProvider, usePermissions } from './context/PermissionsContext'
import { NotificationsProvider } from './context/NotificationsContext'
import { BottomNav } from './components/BottomNav'
import { OfflineBanner } from './components/OfflineBanner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { OrdersPage } from './pages/OrdersPage'
import { StocksPage } from './pages/StocksPage'
import { StockDetailPage } from './pages/StockDetailPage'
import { ModulesPage } from './pages/ModulesPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { FacturesPage } from './pages/FacturesPage'
import { PerformancePage } from './pages/PerformancePage'
import { ProfilePage } from './pages/ProfilePage'
import { ApprobationPage } from './pages/ApprobationPage'
import { LivreurPage } from './pages/LivreurPage'
import { CaissePage } from './pages/CaissePage'

function AuthenticatedApp() {
  const { source, canScreen } = usePermissions()

  // Permissions pas encore connues : rien de privilégié ne s'affiche (même principe que le web).
  if (source === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <OfflineBanner />
      <main className="flex-1 overflow-y-auto pb-nav">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {canScreen('orders') && <Route path="/orders" element={<OrdersPage />} />}
          {canScreen('approbation') && <Route path="/approbation" element={<ApprobationPage />} />}
          {canScreen('stocks') && <Route path="/stocks" element={<StocksPage />} />}
          {canScreen('stocks') && <Route path="/stocks/:id" element={<StockDetailPage />} />}
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          {canScreen('factures') && <Route path="/factures" element={<FacturesPage />} />}
          {canScreen('performance') && <Route path="/performance" element={<PerformancePage />} />}
          <Route path="/profile" element={<ProfilePage />} />
          {canScreen('livraisons') && <Route path="/livraisons" element={<LivreurPage />} />}
          {canScreen('caisse') && <Route path="/caisse" element={<CaissePage />} />}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  return user ? <AuthenticatedApp /> : <LoginPage />
}

export default function App() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <NotificationsProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </NotificationsProvider>
      </PermissionsProvider>
    </AuthProvider>
  )
}
