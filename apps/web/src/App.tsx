import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
        <Route path="/orders" element={<PlaceholderPage title="Commandes" />} />
        <Route path="/production" element={<PlaceholderPage title="Production" />} />
        <Route path="/inventory" element={<PlaceholderPage title="Inventaire" />} />
        <Route path="/clients" element={<PlaceholderPage title="Clients" />} />
        <Route path="*" element={<PlaceholderPage title="404" />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  )
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="text-center">
        <div className="text-5xl font-bold mb-2" style={{ color: '#C62828' }}>FORGE</div>
        <div className="text-xl font-medium mb-1" style={{ color: '#212121' }}>{title}</div>
        <div className="text-sm" style={{ color: '#37474F' }}>TAFDIL · Douala, Cameroun</div>
      </div>
    </div>
  )
}
