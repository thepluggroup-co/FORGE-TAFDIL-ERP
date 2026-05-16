import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { setupRealtime } from './lib/realtime'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

function RealtimeSetup() {
  const qc = useQueryClient()
  useEffect(() => setupRealtime(qc), [qc])
  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RealtimeSetup />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
