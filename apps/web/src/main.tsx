import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import { setupRealtime } from './lib/realtime'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function RealtimeSetup() {
  const qc = useQueryClient()
  useEffect(() => setupRealtime(qc), [qc])
  return null
}

// In Electron (file:// protocol) BrowserRouter can't match routes because
// window.location.pathname is the full OS path. Use MemoryRouter instead.
const isElectron = typeof window !== 'undefined' && 'forge' in window
const Router = isElectron ? MemoryRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <RealtimeSetup />
        <App />
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
)
