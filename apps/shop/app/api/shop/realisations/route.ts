import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const limit = Math.min(30, Math.max(1, parseInt(new URL(req.url).searchParams.get('limit') ?? '10')))

  try {
    const db = createPublicClient()
    const { data, error } = await db.storage
      .from('realisations')
      .list('', { limit, sortBy: { column: 'created_at', order: 'desc' } })

    if (error) return NextResponse.json({ data: [] })

    const baseUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/realisations`
    const realisations = (data ?? [])
      .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
      .map((f) => ({
        id:        f.id ?? f.name,
        url:       `${baseUrl}/${f.name}`,
        alt:       f.name.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, ''),
        categorie: null as string | null,
      }))

    return NextResponse.json(
      { data: realisations, total: realisations.length },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    )
  } catch {
    return NextResponse.json({ data: [] })
  }
}
