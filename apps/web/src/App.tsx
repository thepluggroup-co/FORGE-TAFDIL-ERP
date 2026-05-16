import { APP_NAME, COMPANY_NAME } from '@forge/shared'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-orange-500">{APP_NAME}</h1>
        <p className="mt-2 text-gray-400">ERP natif pour {COMPANY_NAME}</p>
        <p className="mt-1 text-sm text-gray-600">Douala, Cameroun</p>
      </div>
    </div>
  )
}
