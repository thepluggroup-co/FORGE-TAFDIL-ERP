import { NextRequest, NextResponse } from 'next/server'
import { fetchCatalogueProduits } from '@/lib/catalogue'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const produits = await fetchCatalogueProduits({
    categorie: searchParams.get('categorie') ?? undefined,
    q: searchParams.get('q') ?? undefined,
  })

  return NextResponse.json(
    { data: produits, total: produits.length },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' } }
  )
}
