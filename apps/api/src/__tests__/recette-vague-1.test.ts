/**
 * recette-vague-1.test.ts — non-régression des retours de recette du 2026-10-07
 *
 *  AD-04  invitation livreur (rôle legacy), PIN généré et renvoyé à l'admin
 *  AD-06  désactivation depuis l'onglet RBAC = compte bloqué partout
 *  AD-12  PDF facture toujours régénéré, avec les coordonnées du client
 *  AD-14  envoi WhatsApp d'une facture, soldée comprise
 *  Devis  PDF régénéré (lien signé expiré), décision du client saisie en interne
 *
 * Mock Supabase piloté par table + filtres (le vrai rbacService interroge aussi
 * supabase.from() et décalerait une file mockReturnValueOnce).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHeaders } from './helpers'

const etat = vi.hoisted(() => ({
  resolver: null as null | ((table: string, f: Record<string, unknown>, op: string) => { data: unknown; error: unknown }),
  ecritures: [] as Array<{ table: string; op: string; payload: unknown; filtres: Record<string, unknown> }>,
  authUpdates: [] as Array<{ id: string; attrs: Record<string, unknown> }>,
  authCreate:  [] as Array<Record<string, unknown>>,
}))

vi.mock('@forge/db/supabase', () => {
  const chain = (table: string) => {
    const f: Record<string, unknown> = {}
    let op = 'select'
    let payload: unknown
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'or', 'gte', 'lte', 'lt', 'gt', 'not', 'ilike', 'like', 'order', 'range', 'limit', 'head', 'filter', 'is'])
      c[m] = () => c
    c.eq  = (k: string, v: unknown) => { f[k] = v; return c }
    c.neq = (k: string, v: unknown) => { f[`!${k}`] = v; return c }
    for (const m of ['update', 'insert', 'upsert', 'delete'])
      c[m] = (p?: unknown) => { op = m; payload = p; return c }
    const res = () => {
      if (op !== 'select') etat.ecritures.push({ table, op, payload, filtres: { ...f } })
      return etat.resolver?.(table, f, op) ?? { data: null, error: null }
    }
    c.single = () => Promise.resolve(res())
    c.maybeSingle = () => Promise.resolve(res())
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(res()).then(ok)
    return c
  }
  const client = {
    from: (t: string) => chain(t),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ send: () => Promise.resolve('ok') }),
    auth: { admin: {
      updateUserById: (id: string, attrs: Record<string, unknown>) => { etat.authUpdates.push({ id, attrs }); return Promise.resolve({ data: {}, error: null }) },
      createUser: (attrs: Record<string, unknown>) => { etat.authCreate.push(attrs); return Promise.resolve({ data: { user: { id: 'new-user-id' } }, error: null }) },
      inviteUserByEmail: () => Promise.resolve({ data: { user: { id: 'new-user-id' } }, error: null }),
    } },
    storage: { from: () => ({
      download: () => { throw new Error('Storage ne doit plus être lu pour le PDF facture') },
    }) },
  }
  return { supabase: client, supabaseAdmin: client }
})

vi.mock('../services/sms.service', async (orig) => ({
  ...(await orig<typeof import('../services/sms.service')>()),
  sendSms: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('../services/email-queue.service', () => ({ notifyWhatsApp: vi.fn(), enqueueEmail: vi.fn(), sendEmailDirect: vi.fn() }))
vi.mock('../services/pdf.service', () => ({
  generateFacturePDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 facture')),
  generateRecuPDF:    vi.fn(),
  generateDevisPDF:   vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 devis')),
  generateAttestationPDF: vi.fn(),
  uploadPDF: vi.fn().mockResolvedValue('https://supabase.test/storage/v1/object/sign/factures/FAC-2026-0042.pdf?token=abc'),
}))

import app from '../app'
import { generateFacturePDF } from '../services/pdf.service'

const ADMIN_ID  = '00000000-0000-4000-8000-0000000000ad'
const CIBLE_ID  = '00000000-0000-4000-8000-0000000000c1'
const AUTRE_ID  = '00000000-0000-4000-8000-0000000000c2'
const FACT_ID   = '00000000-0000-4000-8000-0000000000f1'
const CLIENT_ID = '00000000-0000-4000-8000-00000000c11e'

const admin = () => authHeaders('admin', ADMIN_ID)

beforeEach(() => {
  etat.resolver = null; etat.ecritures = []; etat.authUpdates = []; etat.authCreate = []
  vi.mocked(generateFacturePDF).mockClear()
})

// ── AD-06 : activation synchronisée ─────────────────────────────────────────

describe('AD-06 — désactivation depuis l\'onglet RBAC', () => {
  it('bloque le compte dans Auth et met profiles.actif + rbac is_active à false', async () => {
    const res = await app.request(`/api/admin/rbac/users/${CIBLE_ID}/deactivate`, { method: 'PATCH', headers: admin() })
    expect(res.status).toBe(200)
    expect(etat.authUpdates).toContainEqual({ id: CIBLE_ID, attrs: { ban_duration: '876000h' } })
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'profiles', op: 'update', payload: { actif: false } }))
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'rbac_user_profiles', op: 'update', payload: { is_active: false } }))
  })

  it('réactivation via PATCH isActive:true lève le blocage Auth', async () => {
    const res = await app.request(`/api/admin/rbac/users/${CIBLE_ID}`, {
      method: 'PATCH', headers: admin(), body: JSON.stringify({ isActive: true }),
    })
    expect(res.status).toBe(200)
    expect(etat.authUpdates).toContainEqual({ id: CIBLE_ID, attrs: { ban_duration: 'none' } })
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'profiles', payload: { actif: true } }))
  })

  it('changer de rôle ne réactive pas un compte désactivé', async () => {
    etat.resolver = (t, f) => {
      if (t === 'rbac_user_profiles' && f.profile_id === CIBLE_ID) return { data: { role_id: 'r-old', is_active: false }, error: null }
      if (t === 'rbac_roles' && f.name === 'COMMERCIAL') return { data: { id: 'r-com' }, error: null }
      return { data: null, error: null }
    }
    const res = await app.request(`/api/admin/rbac/users/${CIBLE_ID}`, {
      method: 'PATCH', headers: admin(), body: JSON.stringify({ rbacRoleName: 'COMMERCIAL' }),
    })
    expect(res.status).toBe(200)
    const upsert = etat.ecritures.find(e => e.table === 'rbac_user_profiles' && e.op === 'upsert')
    expect(upsert?.payload).toMatchObject({ role_id: 'r-com', is_active: false })
  })

  it('refuse de se désactiver soi-même', async () => {
    const res = await app.request(`/api/admin/rbac/users/${ADMIN_ID}/deactivate`, { method: 'PATCH', headers: admin() })
    expect(res.status).toBe(400)
    expect(etat.authUpdates).toHaveLength(0)
  })
})

// ── AD-04 : invitation et PIN ───────────────────────────────────────────────

describe('AD-04 — invitation et PIN de connexion', () => {
  it('un livreur invité reçoit le rôle legacy livreur (et non operateur)', async () => {
    const res = await app.request('/api/admin/users/invite', {
      method: 'POST', headers: admin(),
      body: JSON.stringify({ email: 'liv@tafdil.local', nom: 'Liv', rbacRoleName: 'LIVREUR', password: 'Secret-123' }),
    })
    expect(res.status).toBe(200)
    expect(etat.authCreate[0]).toMatchObject({ app_metadata: { role: 'livreur' } })
  })

  it('invitation avec téléphone : numéro normalisé et PIN renvoyé à l\'admin', async () => {
    const res = await app.request('/api/admin/users/invite', {
      method: 'POST', headers: admin(),
      body: JSON.stringify({ email: 'op@tafdil.local', nom: 'Op', rbacRoleName: 'COMMERCIAL', password: 'Secret-123', phone: '695 88 45 28' }),
    })
    const body = await res.json() as { pin?: string; smsEnvoye?: boolean }
    expect(body.pin).toMatch(/^\d{4}$/)
    expect(body.smsEnvoye).toBe(true)
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'profiles', op: 'upsert', payload: expect.objectContaining({ telephone: '+237695884528' }) }))
  })

  it('POST /users/:id/pin : enregistre le numéro et renvoie un PIN à 4 chiffres', async () => {
    etat.resolver = (t, f) => (t === 'profiles' && f.id === CIBLE_ID) ? { data: { id: CIBLE_ID, telephone: null }, error: null } : { data: null, error: null }
    const res = await app.request(`/api/admin/users/${CIBLE_ID}/pin`, {
      method: 'POST', headers: admin(), body: JSON.stringify({ telephone: '676397691' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { pin: string; telephone: string }
    expect(body.pin).toMatch(/^\d{4}$/)
    expect(body.telephone).toBe('+237676397691')
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'user_pins', op: 'upsert' }))
  })

  it('POST /users/:id/pin : 409 si le numéro appartient à un autre compte', async () => {
    etat.resolver = (t, f) => {
      if (t === 'profiles' && f.id === CIBLE_ID) return { data: { id: CIBLE_ID, telephone: null }, error: null }
      if (t === 'profiles' && f.telephone === '+237676397691') return { data: { id: AUTRE_ID }, error: null }
      return { data: null, error: null }
    }
    const res = await app.request(`/api/admin/users/${CIBLE_ID}/pin`, {
      method: 'POST', headers: admin(), body: JSON.stringify({ telephone: '676397691' }),
    })
    expect(res.status).toBe(409)
    expect(etat.ecritures.find(e => e.table === 'user_pins')).toBeUndefined()
  })
})

// ── AD-12 / AD-14 : factures ────────────────────────────────────────────────

function facture(statut: string, paye: number) {
  return (t: string, f: Record<string, unknown>) => {
    if (t === 'factures' && f.id === FACT_ID) return { data: {
      id: FACT_ID, numero: 'FAC-2026-0042', client_id: CLIENT_ID, client_nom: 'Société Test', statut,
      date_emission: '2026-10-01', date_echeance: '2026-10-31',
      total_ht_xaf: 100000, tva_xaf: 19250, total_ttc_xaf: 119250, montant_paye_xaf: paye, factures_lignes: [],
    }, error: null }
    if (t === 'clients') return { data: [{ id: CLIENT_ID, nom: 'Société Test', email: 'compta@test.cm', telephone: '699112233', niu: 'M0123', adresse: 'Akwa', ville: 'Douala', type: 'entreprise' }], error: null }
    return { data: null, error: null }
  }
}

describe('AD-12 — PDF facture', () => {
  it('régénère toujours le PDF avec email, téléphone et NIU du client', async () => {
    etat.resolver = facture('valide', 0)
    const res = await app.request(`/api/factures/${FACT_ID}/pdf`, { headers: admin() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(vi.mocked(generateFacturePDF).mock.calls[0][1]).toMatchObject({
      nom: 'Société Test', email: 'compta@test.cm', telephone: '699112233', niu: 'M0123', adresse: 'Akwa, Douala',
    })
  })
})

describe('AD-14 — envoi WhatsApp d\'une facture', () => {
  it('facture soldée : envoi possible, message de facture réglée, lien signé', async () => {
    etat.resolver = facture('paye', 119250)
    const res = await app.request(`/api/factures/${FACT_ID}/envoi-whatsapp`, { method: 'POST', headers: admin(), body: '{}' })
    expect(res.status).toBe(200)
    const body = await res.json() as { url: string; message: string }
    expect(body.url.startsWith('https://wa.me/237699112233?text=')).toBe(true)
    expect(body.message).toContain('entièrement réglée')
    expect(body.message).toContain('token=abc')
  })

  it('facture valide : passe « envoyée »', async () => {
    etat.resolver = facture('valide', 0)
    const res = await app.request(`/api/factures/${FACT_ID}/envoi-whatsapp`, { method: 'POST', headers: admin(), body: '{}' })
    expect(res.status).toBe(200)
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'factures', op: 'update', payload: expect.objectContaining({ statut: 'envoye' }) }))
  })

  it('facture annulée : refusée', async () => {
    etat.resolver = facture('annule', 0)
    const res = await app.request(`/api/factures/${FACT_ID}/envoi-whatsapp`, { method: 'POST', headers: admin(), body: '{}' })
    expect(res.status).toBe(422)
  })
})

// ── Devis : PDF à la demande et décision saisie au nom du client ────────────

const DEVIS_ID = '00000000-0000-4000-8000-0000000000d1'
const demain   = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const hier     = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

function devis(statut: string, dateValidite = demain) {
  return (t: string, f: Record<string, unknown>) => {
    if (t === 'devis' && f.id === DEVIS_ID) return { data: {
      id: DEVIS_ID, numero: 'DEV-2026-0007', statut, date_validite: dateValidite, client_nom: 'Société Test', client_id: null,
      date_emission: '2026-10-01', validite_jours: 30, total_ht_xaf: 100000, tva_xaf: 19250, total_ttc_xaf: 119250,
      notes: null, ressources_snapshot: null, cp: null, devis_lignes: [],
    }, error: null }
    return { data: null, error: null }
  }
}

describe('Devis — PDF régénéré à la demande', () => {
  it('GET /devis/:id/pdf renvoie un PDF sans passer par le lien stocké', async () => {
    etat.resolver = devis('envoye')
    const res = await app.request(`/api/devis/${DEVIS_ID}/pdf`, { headers: admin() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })
})

describe('Devis — décision du client saisie par le personnel', () => {
  const decider = (body: unknown, role: 'admin' | 'operateur' | 'apprenant' = 'admin') =>
    app.request(`/api/devis/${DEVIS_ID}/decision-client`, {
      method: 'POST', headers: authHeaders(role, role === 'admin' ? ADMIN_ID : CIBLE_ID), body: JSON.stringify(body),
    })

  it('accepte : même effet que le lien public, auteur et canal tracés', async () => {
    etat.resolver = devis('envoye')
    const res = await decider({ decision: 'accepte', canal: 'telephone', commentaire: 'Accord de M. Ngono' })
    expect(res.status).toBe(200)
    const maj = etat.ecritures.find(e => e.table === 'devis' && e.op === 'update')
    expect(maj?.payload).toMatchObject({ statut: 'accepte', approuve_par_client: true, token_approbation: null })
    const commentaire = (maj?.payload as { commentaire_client: string }).commentaire_client
    expect(commentaire).toContain('Accord de M. Ngono')
    expect(commentaire).toContain('par téléphone')
    expect(commentaire).toContain('test@tafdil.cm')
  })

  it('devis expiré : refusé', async () => {
    etat.resolver = devis('envoye', hier)
    const res = await decider({ decision: 'accepte', canal: 'presence' })
    expect(res.status).toBe(422)
  })

  it('technicien (lecture seule) : 403', async () => {
    etat.resolver = devis('envoye')
    const res = await decider({ decision: 'accepte', canal: 'telephone' }, 'apprenant')
    expect(res.status).toBe(403)
  })
})
