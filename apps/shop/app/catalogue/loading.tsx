function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <div className="aspect-[4/3] bg-gray-100" />
      <div className="p-4 space-y-2">
        <div className="h-3 w-16 rounded bg-gray-100" />
        <div className="h-4 w-3/4 rounded bg-gray-200" />
        <div className="h-3 w-1/2 rounded bg-gray-100" />
        <div className="mt-3 flex items-center justify-between">
          <div className="h-5 w-24 rounded bg-gray-200" />
          <div className="h-8 w-8 rounded-full bg-gray-100" />
        </div>
      </div>
    </div>
  )
}

export default function CatalogueLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* Filtres skeleton */}
      <div className="mb-6 flex animate-pulse gap-2">
        {[80, 96, 72, 88].map((w) => (
          <div key={w} className={`h-8 w-${w} rounded-full bg-gray-100`} />
        ))}
      </div>
      {/* Grille */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    </main>
  )
}
