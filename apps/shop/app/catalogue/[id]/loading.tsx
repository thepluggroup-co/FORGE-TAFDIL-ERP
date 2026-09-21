export default function ProduitLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 animate-pulse">
      {/* Fil d'Ariane */}
      <div className="mb-6 flex items-center gap-2">
        <div className="h-3 w-16 rounded bg-gray-100" />
        <div className="h-3 w-2 rounded bg-gray-100" />
        <div className="h-3 w-20 rounded bg-gray-100" />
        <div className="h-3 w-2 rounded bg-gray-100" />
        <div className="h-3 w-32 rounded bg-gray-200" />
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Galerie image */}
        <div className="space-y-3">
          <div className="aspect-square rounded-2xl bg-gray-100" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 w-16 rounded-xl bg-gray-100" />
            ))}
          </div>
        </div>

        {/* Contenu */}
        <div className="space-y-4">
          <div className="h-3 w-20 rounded bg-gray-100" />
          <div className="h-8 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-100" />
          <div className="h-4 w-2/3 rounded bg-gray-100" />
          <div className="mt-4 h-8 w-32 rounded bg-gray-200" />
          <div className="mt-6 h-12 w-full rounded-xl bg-gray-200" />
          <div className="h-12 w-full rounded-xl bg-gray-100" />
        </div>
      </div>
    </main>
  )
}
