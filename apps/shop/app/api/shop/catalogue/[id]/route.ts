import { NextRequest, NextResponse } from 'next/server'
import { fetchCatalogueProduit } from '@/lib/catalogue'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const produit = await fetchCatalogueProduit(params.id)
  if (!produit) {
    return NextResponse.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, { status: 404 })
  }
  return NextResponse.json({ data: produit })
}
