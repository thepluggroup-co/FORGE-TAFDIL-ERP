export default function SuiviLoading() {
  return (
    <main className="mx-auto max-w-lg animate-pulse px-4 py-8 space-y-5">
      {/* En-tête */}
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="h-7 w-40 rounded bg-gray-200" />
          <div className="h-3 w-32 rounded bg-gray-100" />
        </div>
        <div className="h-6 w-20 rounded-xl bg-gray-100" />
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-9 w-9 flex-shrink-0 rounded-full bg-gray-100" />
            <div className="flex-1 space-y-1.5 pt-2">
              <div className="h-4 w-32 rounded bg-gray-200" />
              {i === 0 && <div className="h-3 w-48 rounded bg-gray-100" />}
            </div>
          </div>
        ))}
      </div>

      {/* Lignes commande */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-3">
        <div className="h-3 w-28 rounded bg-gray-100" />
        {[1, 2].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-4 w-20 rounded bg-gray-100" />
          </div>
        ))}
        <div className="border-t border-gray-100 pt-3 flex justify-between">
          <div className="h-5 w-20 rounded bg-gray-200" />
          <div className="h-5 w-28 rounded bg-gray-200" />
        </div>
      </div>
    </main>
  )
}
