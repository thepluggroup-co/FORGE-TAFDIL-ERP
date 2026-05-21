import { useEffect, useState } from 'react'

interface HealthStatus {
  status: string
  version: string
  app: string
  company: string
  timestamp: string
}

interface ConnectionState {
  loading: boolean
  health: HealthStatus | null
  error: string | null
  connected: boolean
}

export function APIHealthCheck() {
  const [state, setState] = useState<ConnectionState>({
    loading: true,
    health: null,
    error: null,
    connected: false,
  })

  useEffect(() => {
    const checkConnection = async () => {
      try {
        console.log('[v0] Checking API connection to http://localhost:3001/health')
        
        const response = await fetch('http://localhost:3001/health')
        
        console.log('[v0] Health check response status:', response.status)
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        const health = (await response.json()) as HealthStatus
        
        console.log('[v0] Health check successful:', health)
        
        setState({
          loading: false,
          health,
          error: null,
          connected: true,
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('[v0] API health check failed:', errorMsg)
        
        setState({
          loading: false,
          health: null,
          error: errorMsg,
          connected: false,
        })
      }
    }

    checkConnection()
    
    // Retry every 5 seconds
    const interval = setInterval(checkConnection, 5000)
    return () => clearInterval(interval)
  }, [])

  const containerClass = `
    p-4 rounded-lg border-2 transition-all
    ${state.connected 
      ? 'bg-green-50 border-green-300' 
      : state.error 
        ? 'bg-red-50 border-red-300'
        : 'bg-yellow-50 border-yellow-300'
    }
  `

  const statusClass = `
    font-semibold text-lg
    ${state.connected 
      ? 'text-green-700' 
      : state.error 
        ? 'text-red-700'
        : 'text-yellow-700'
    }
  `

  return (
    <div className={containerClass}>
      <div className={statusClass}>
        {state.loading && '⏳ Checking API connection...'}
        {state.connected && '✓ API Connected'}
        {state.error && '✗ API Disconnected'}
      </div>

      {state.health && (
        <div className="mt-3 space-y-2 text-sm text-gray-700">
          <div><strong>App:</strong> {state.health.app}</div>
          <div><strong>Company:</strong> {state.health.company}</div>
          <div><strong>Version:</strong> {state.health.version}</div>
          <div><strong>Status:</strong> {state.health.status}</div>
          <div><strong>Time:</strong> {new Date(state.health.timestamp).toLocaleString()}</div>
        </div>
      )}

      {state.error && (
        <div className="mt-3 text-sm text-red-700">
          <div><strong>Error:</strong> {state.error}</div>
          <div className="mt-2 text-xs text-red-600">
            Make sure the API server is running:
            <br />
            <code className="bg-red-100 px-1 rounded">pnpm dev --filter @forge/api</code>
          </div>
        </div>
      )}

      {state.loading && (
        <div className="mt-3 text-sm text-yellow-700">
          Attempting to connect to http://localhost:3001/health
        </div>
      )}
    </div>
  )
}
