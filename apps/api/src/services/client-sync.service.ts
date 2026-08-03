import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

export interface EnsureClientInput {
  clientId?: string | null
  nom: string
  telephone?: string | null
  email?: string | null
  adresse?: string | null
  ville?: string | null
  pays?: string | null
  type?: 'entreprise' | 'particulier' | 'institution'
  createdBy?: string | null
}

function clean(value?: string | null) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function phoneDigits(value?: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 6 ? digits : null
}

function mergeMissing<T extends Record<string, unknown>>(existing: T, update: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined || value === '') continue
    if (existing[key] === null || existing[key] === undefined || existing[key] === '') patch[key] = value
  }
  return patch
}

function normalizeScoreFiabilite(value: unknown): 'nouveau' | 'bon' | 'tres_bon' | 'vip' | 'bloque' {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'tres-bon' || normalized === 'tres bon' || normalized === 'très_bon' || normalized === 'très bon') return 'tres_bon'
    if (['nouveau', 'bon', 'tres_bon', 'vip', 'bloque'].includes(normalized)) {
      return normalized as 'nouveau' | 'bon' | 'tres_bon' | 'vip' | 'bloque'
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 80) return 'vip'
    if (value >= 60) return 'tres_bon'
    if (value >= 40) return 'bon'
    return 'nouveau'
  }

  return 'nouveau'
}

export async function ensureClient(input: EnsureClientInput): Promise<string | null> {
  const nom = clean(input.nom)
  if (!nom) return input.clientId ?? null

  const telephone = clean(input.telephone)
  const telDigits = phoneDigits(telephone)
  const email = clean(input.email)?.toLowerCase() ?? null
  const adresse = clean(input.adresse)
  const ville = clean(input.ville)
  const pays = clean(input.pays) ?? 'Cameroun'
  const type = input.type ?? 'particulier'

  let existing: Record<string, unknown> | null = null

  if (input.clientId) {
    const { data } = await db
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, pays, type, statut')
      .eq('id', input.clientId)
      .maybeSingle()
    existing = (data as Record<string, unknown> | null) ?? null
  }

  if (!existing && telDigits) {
    const { data } = await db
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, pays, type, statut')
      .ilike('telephone', `%${telDigits.slice(-8)}%`)
      .limit(1)
      .maybeSingle()
    existing = (data as Record<string, unknown> | null) ?? null
  }

  if (!existing && email) {
    const { data } = await db
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, pays, type, statut')
      .eq('email', email)
      .maybeSingle()
    existing = (data as Record<string, unknown> | null) ?? null
  }

  if (!existing) {
    const { data } = await db
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, pays, type, statut')
      .ilike('nom', nom)
      .limit(1)
      .maybeSingle()
    existing = (data as Record<string, unknown> | null) ?? null
  }

  if (existing?.id) {
    const patch = mergeMissing(existing, {
      nom,
      telephone,
      email,
      adresse,
      ville,
      pays,
      type,
      updated_at: new Date().toISOString(),
    })
    if (Object.keys(patch).length > 0) {
      await db.from('clients').update(patch).eq('id', existing.id as string)
    }
    return existing.id as string
  }

  const { data, error } = await db
    .from('clients')
    .insert({
      nom,
      type,
      telephone,
      email,
      adresse,
      ville,
      pays,
      statut: 'actif',
      score_fiabilite: normalizeScoreFiabilite('nouveau'),
      created_by: input.createdBy ?? null,
      sync_status: 'synced',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Erreur creation client')
  }

  return (data as { id: string }).id
}
