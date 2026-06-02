import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { z } from 'zod'

const devisSchema = z.object({
  nom:         z.string().min(2).max(200),
  telephone:   z.string().min(8).max(20),
  email:       z.string().email().optional(),
  description: z.string().min(10).max(2000),
  type_projet: z.string().max(100).optional(),
  produit_ref: z.string().max(50).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = devisSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const data_in = parsed.data
    const db = createServiceClient()

    const { data, error } = await db
      .from('demandes_devis_web')
      .insert({
        nom:         data_in.nom,
        telephone:   data_in.telephone,
        email:       data_in.email ?? null,
        description: data_in.description,
        type_projet: data_in.type_projet ?? null,
        produit_ref: data_in.produit_ref ?? null,
        statut:      'nouvelle',
      })
      .select('id, created_at')
      .single()

    if (error || !data) {
      console.error('[shop/devis] insert:', error)
      return NextResponse.json({ error: 'Erreur enregistrement', code: 'DB_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ id: data.id, statut: 'nouvelle', created_at: data.created_at }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
