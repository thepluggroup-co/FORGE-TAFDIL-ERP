import React from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BottomNav } from './components/BottomNav'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { OrdersPage } from './pages/OrdersPage'
import { StocksPage } from './pages/StocksPage'
import { StockDetailPage } from './pages/StockDetailPage'
import { BoutiquePage } from './pages/BoutiquePage'
import { ProfilePage } from './pages/ProfilePage'
import { ApprobationPage } from './pages/ApprobationPage'
import { LivreurPage } from './pages/LivreurPage'

function AuthenticatedApp() {
  const { user } = useAuth()

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <main className="flex-1 overflow-y-auto pb-nav">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/boutique" element={<BoutiquePage />} />
          <Route path="/approbation" element={<ApprobationPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stocks/:id" element={<StockDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {user?.role === 'livreur' && (
            <Route path="/livraisons" element={<LivreurPage />} />
          )}
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
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  )
}
