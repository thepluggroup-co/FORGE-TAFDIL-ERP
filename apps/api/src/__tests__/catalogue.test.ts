/**
 * catalogue.test.ts — Arbre de catégorisation du catalogue de produits finis
 * (familles / modèles / spécifications)
 *
 * Couverture :
 * - création famille racine + sous-famille (parent_id correct)
 * - rejet d'une famille orpheline (parent_id inexistant → violation FK)
 * - résolution type_gamme (héritage famille ↔ override modèle)
 * - CRUD modèle + specifications
 * - pagination (contrat total/page/per_page/total_pages)
 * - RBAC : rôle non autorisé ne peut pas créer/modifier une famille
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

vi.mock('@forge/db/supabase', () => {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head','filter','is'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn().mockReturnValue({
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed.pdf' } }),
    }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission } from '../services/rbacService'
import { resolveTypeGamme } from '../routes/catalogue'

/**
 * Route et audit middleware appellent tous deux `db.from(...)` sur la même
 * requête mutante (POST/PUT/DELETE 2xx → auditMiddleware logue en plus dans
 * 'audit_log', best-effort). mockReturnValueOnce empile une file globale
 * partagée entre tests et ne se réinitialise pas avec clearAllMocks() — un
 * appel en plus décale silencieusement la file pour le test suivant. On
 * route donc la réponse mockée par nom de table plutôt que par ordre d'appel.
 */
function mockTables(overrides: Record<string, { data: unknown; count?: number; error?: unknown }>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const response = overrides[table] ?? { data: null, count: 0, error: null }
    return mkChain(response as Record<string, unknown>)
  }) as never)
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FAMILLE_RACINE_ID = '11111111-1111-4111-8111-111111111111'
const FAMILLE_ENFANT_ID = '22222222-2222-4222-8222-222222222222'
const MODELE_ID         = '33333333-3333-4333-8333-333333333333'

const FAMILLE_RACINE = {
  id: FAMILLE_RACINE_ID, nom: 'Menuiserie métallique', parent_id: null,
  type_gamme: 'configuration', ordre: 1, actif: true,
}

const FAMILLE_ENFANT = {
  id: FAMILLE_ENFANT_ID, nom: 'Fenêtres aluminium', parent_id: FAMILLE_RACINE_ID,
  type_gamme: 'configuration', ordre: 1, actif: true,
}

const MODELE = {
  id: MODELE_ID, famille_id: FAMILLE_RACINE_ID, reference: 'PM-01',
  designation: 'Porte métallique standard', unite_facturation: 'm2',
  type_gamme: null, actif: true,
}

beforeEach(() => vi.clearAllMocks())

// ── resolveTypeGamme — fonction pure ────────────────────────────────────────────

describe('resolveTypeGamme', () => {
  it("un modèle sans type_gamme hérite du type_gamme de sa famille", () => {
    const result = resolveTypeGamme(
      { type_gamme: null },
      { type_gamme: 'configuration' },
    )
    expect(result).toBe('configuration')
  })

  it("le type_gamme explicite du modèle l'emporte sur celui de la famille", () => {
    const result = resolveTypeGamme(
      { type_gamme: 'sur_mesure' },
      { type_gamme: 'configuration' },
    )
    expect(result).toBe('sur_mesure')
  })
})

// ── FAMILLES ─────────────────────────────────────────────────────────────────

describe('POST /api/catalogue/familles — création', () => {
  it('crée une famille racine (parent_id absent)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ familles: { data: FAMILLE_RACINE, error: null } })

    const res = await app.request('/api/catalogue/familles', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ nom: 'Menuiserie métallique', type_gamme: 'configuration' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; parent_id: null }
    expect(body.id).toBe(FAMILLE_RACINE_ID)
    expect(body.parent_id).toBeNull()
  })

  it('crée une sous-famille avec un parent_id valide', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ familles: { data: FAMILLE_ENFANT, error: null } })

    const res = await app.request('/api/catalogue/familles', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        nom: 'Fenêtres aluminium', parent_id: FAMILLE_RACINE_ID, type_gamme: 'configuration',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { parent_id: string }
    expect(body.parent_id).toBe(FAMILLE_RACINE_ID)
  })

  it('rejette une famille avec un parent_id inexistant (violation FK)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({
      familles: {
        data: null,
        error: { code: '23503', message: 'insert or update on table "familles" violates foreign key constraint "familles_parent_id_fkey"' },
      },
    })

    const res = await app.request('/api/catalogue/familles', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        nom: 'Famille orpheline', parent_id: '99999999-9999-4999-8999-999999999999', type_gamme: 'catalogue',
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('23503')
  })

  it('retourne 403 si le rôle n\'a pas la permission PRODUCTION:CREATE', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: false, roleName: 'MAGASINIER' })

    const res = await app.request('/api/catalogue/familles', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ nom: 'Tentative non autorisée', type_gamme: 'catalogue' }),
    })

    expect(res.status).toBe(403)
  })
})

describe('PUT /api/catalogue/familles/:id — modification', () => {
  it('retourne 403 si le rôle n\'a pas la permission PRODUCTION:UPDATE', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: false, roleName: 'MAGASINIER' })

    const res = await app.request(`/api/catalogue/familles/${FAMILLE_RACINE_ID}`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ type_gamme: 'sur_mesure' }),
    })

    expect(res.status).toBe(403)
  })

  it('modifie une famille existante', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ familles: { data: { ...FAMILLE_RACINE, type_gamme: 'sur_mesure' }, error: null } })

    const res = await app.request(`/api/catalogue/familles/${FAMILLE_RACINE_ID}`, {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ type_gamme: 'sur_mesure' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { type_gamme: string }
    expect(body.type_gamme).toBe('sur_mesure')
  })
})

describe('GET /api/catalogue/familles — pagination', () => {
  it('retourne data/total/page/per_page/total_pages', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({ familles: { data: [FAMILLE_RACINE, FAMILLE_ENFANT], count: 2, error: null } })

    const res = await app.request('/api/catalogue/familles', {
      method:  'GET',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      data: unknown[]; total: number; page: number; per_page: number; total_pages: number
    }
    expect(body.data).toHaveLength(2)
    expect((body.data[0] as { commercial_mode?: string }).commercial_mode).toBe('CONFIGURABLE')
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.per_page).toBe(20)
    expect(body.total_pages).toBe(1)
  })
})

// ── Catalogue Hybride Phase 1 : hiérarchie Catégorie → Famille → Sous-famille ──

/**
 * `familles` renvoie l'arbre complet (id, parent_id) quand la requête est
 * attendue comme liste (lecture de contrôle) et `ecriture` sur .single()
 * (insert/update). La chaîne insert est renvoyée pour vérifier qu'elle n'a
 * pas été appelée en cas de refus.
 */
function mockFamillesAvecArbre(arbre: Array<{ id: string; parent_id: string | null }>, ecriture: unknown) {
  const chaines: Array<{ insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }> = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table !== 'familles') return mkChain({ data: null, error: null })
    const chain = mkChain({ data: ecriture, error: null }) as Record<string, unknown>
    chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve({ data: arbre, error: null }).then(resolve, reject)
    chaines.push(chain as never)
    return chain
  }) as never)
  return chaines
}

const SOUS_FAMILLE_ID = '44444444-4444-4444-8444-444444444444'
const ARBRE_3_NIVEAUX = [
  { id: FAMILLE_RACINE_ID, parent_id: null },
  { id: FAMILLE_ENFANT_ID, parent_id: FAMILLE_RACINE_ID },
  { id: SOUS_FAMILLE_ID,   parent_id: FAMILLE_ENFANT_ID },
]

describe('Hiérarchie des familles — profondeur max 3 et cycles', () => {
  it('crée une sous-famille (niveau 3)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockFamillesAvecArbre(ARBRE_3_NIVEAUX, { id: 'nouvelle', parent_id: FAMILLE_ENFANT_ID })

    const res = await app.request('/api/catalogue/familles', {
      method: 'POST', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ nom: 'Portails battants', parent_id: FAMILLE_ENFANT_ID, type_gamme: 'configuration' }),
    })
    expect(res.status).toBe(201)
  })

  it('refuse un 4ᵉ niveau (422 PROFONDEUR_MAX_DEPASSEE) sans rien écrire', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    const chaines = mockFamillesAvecArbre(ARBRE_3_NIVEAUX, null)

    const res = await app.request('/api/catalogue/familles', {
      method: 'POST', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ nom: 'Trop profond', parent_id: SOUS_FAMILLE_ID, type_gamme: 'catalogue' }),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('PROFONDEUR_MAX_DEPASSEE')
    expect(chaines.every((ch) => ch.insert.mock.calls.length === 0)).toBe(true)
  })

  it('refuse de placer une famille sous sa propre sous-famille (422 CYCLE_HIERARCHIE)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    const chaines = mockFamillesAvecArbre(ARBRE_3_NIVEAUX, null)

    const res = await app.request(`/api/catalogue/familles/${FAMILLE_RACINE_ID}`, {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ parent_id: SOUS_FAMILLE_ID }),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('CYCLE_HIERARCHIE')
    expect(chaines.every((ch) => ch.update.mock.calls.length === 0)).toBe(true)
  })

  it('un PUT qui ne change pas le parent ne relit pas l’arbre', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    const chaines = mockFamillesAvecArbre(ARBRE_3_NIVEAUX, { ...FAMILLE_RACINE, nom: 'Renommée' })

    const res = await app.request(`/api/catalogue/familles/${FAMILLE_RACINE_ID}`, {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ nom: 'Renommée' }),
    })
    expect(res.status).toBe(200)
    // un seul appel familles : l'update (l'audit middleware écrit dans audit_log, pas familles)
    expect(chaines).toHaveLength(1)
  })
})

// ── MODÈLES ──────────────────────────────────────────────────────────────────

describe('GET /api/catalogue/modeles — pagination + résolution type_gamme', () => {
  it('retourne data/total/page/per_page/total_pages et le type_gamme hérité', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({
      modeles: {
        data: [{ ...MODELE, familles: { type_gamme: 'configuration' } }],
        count: 1,
        error: null,
      },
    })

    const res = await app.request(`/api/catalogue/modeles?famille_id=${FAMILLE_RACINE_ID}`, {
      method:  'GET',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      data: Array<{ type_gamme_effectif: string }>
      total: number; page: number; per_page: number; total_pages: number
    }
    expect(body.data[0].type_gamme_effectif).toBe('configuration')
    expect((body.data[0] as { commercial_mode_effectif?: string }).commercial_mode_effectif).toBe('CONFIGURABLE')
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.per_page).toBe(20)
    expect(body.total_pages).toBe(1)
  })
})

describe('POST /api/catalogue/modeles — création', () => {
  it('crée un modèle rattaché à une famille', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ modeles: { data: MODELE, error: null } })

    const res = await app.request('/api/catalogue/modeles', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        famille_id: FAMILLE_RACINE_ID, reference: 'PM-01',
        designation: 'Porte métallique standard', unite_facturation: 'm2',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { reference: string }
    expect(body.reference).toBe('PM-01')
  })

  it('résout unite_facturation_id depuis le référentiel unites_facturation (§9/10)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'unites_facturation') return mkChain({ data: { id: 'uf-m2-id' }, error: null }) as never
      if (table === 'modeles') {
        return {
          ...mkChain({ data: MODELE, error: null }),
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            expect(row.unite_facturation_id).toBe('uf-m2-id')
            return mkChain({ data: MODELE, error: null })
          }),
        } as never
      }
      return mkChain({ data: null, count: 0, error: null }) as never
    }) as never)

    const res = await app.request('/api/catalogue/modeles', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        famille_id: FAMILLE_RACINE_ID, reference: 'PM-01',
        designation: 'Porte métallique standard', unite_facturation: 'm2',
      }),
    })

    expect(res.status).toBe(201)
  })
})

describe('PUT /api/catalogue/modeles/:id — modification', () => {
  it('modifie un modèle existant', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ modeles: { data: { ...MODELE, designation: 'Porte métallique renforcée' }, error: null } })

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}`, {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ designation: 'Porte métallique renforcée' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { designation: string }
    expect(body.designation).toBe('Porte métallique renforcée')
  })
})

// ── CONFIGURATION (§34) ───────────────────────────────────────────────────────

describe('GET /api/catalogue/modeles/:id/configuration', () => {
  it('retourne les champs de dimension pertinents pour le mode de calcul de la fiche technique active', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({
      modeles: { data: { ...MODELE, familles: { type_gamme: 'configuration' } }, error: null },
      fiche_technique: {
        data: { id: 'ft-001', version: 1, mode_calcul: 'surface', unite_facturation_id: 'uf-m2' },
        error: null,
      },
      modele_specifications: {
        data: [{ id: 'spec-001', modele_id: MODELE_ID, cle: 'couleur', valeur: 'gris RAL 7016', unite: null, ordre: 0 }],
        error: null,
      },
    })

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}/configuration`, {
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      modele: { id: string; type_gamme_effectif: string }
      fiche_technique_disponible: boolean
      mode_calcul: string
      champs_dimensions: Array<{ cle: string }>
      specifications: unknown[]
    }
    expect(body.modele.id).toBe(MODELE_ID)
    expect(body.modele.type_gamme_effectif).toBe('configuration')
    expect(body.fiche_technique_disponible).toBe(true)
    expect(body.mode_calcul).toBe('surface')
    expect(body.champs_dimensions.map((c) => c.cle)).toEqual(['largeur', 'hauteur'])
    expect(body.specifications).toHaveLength(1)
  })

  it('signale l\'absence de fiche technique active sans échouer (§46 — saisie manuelle)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({
      modeles: { data: { ...MODELE, familles: { type_gamme: 'configuration' } }, error: null },
      // fiche_technique et modele_specifications retombent sur le défaut de
      // mockTables() (data: null / []) — aucune fiche active, pas d'erreur.
    })

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}/configuration`, {
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { fiche_technique_disponible: boolean; mode_calcul: string | null; champs_dimensions: unknown[] }
    expect(body.fiche_technique_disponible).toBe(false)
    expect(body.mode_calcul).toBeNull()
    expect(body.champs_dimensions).toEqual([])
  })

  it('retourne 404 si le modèle est introuvable', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({ modeles: { data: null, error: { code: 'PGRST116', message: 'not found' } } })

    const res = await app.request('/api/catalogue/modeles/99999999-9999-4999-8999-999999999999/configuration', {
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(404)
  })
})

// ── SPÉCIFICATIONS ───────────────────────────────────────────────────────────

describe('Spécifications techniques (clé/valeur)', () => {
  it('crée une spécification pour un modèle', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({
      modele_specifications: {
        data: { id: 'spec-001', modele_id: MODELE_ID, cle: 'largeur', valeur: '2', unite: 'm', ordre: 0 },
        error: null,
      },
    })

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}/specifications`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ cle: 'largeur', valeur: '2', unite: 'm' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { cle: string; valeur: string }
    expect(body).toMatchObject({ cle: 'largeur', valeur: '2' })
  })

  it('liste les spécifications d\'un modèle', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'READONLY' })
    mockTables({
      modele_specifications: {
        data: [{ id: 'spec-001', modele_id: MODELE_ID, cle: 'largeur', valeur: '2', unite: 'm', ordre: 0 }],
        error: null,
      },
    })

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}/specifications`, {
      method:  'GET',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('supprime une spécification', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ modele_specifications: { data: null, error: null } })

    const res = await app.request('/api/catalogue/modele-specifications/spec-001', {
      method:  'DELETE',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(204)
  })
})

// ── FICHE TECHNIQUE ──────────────────────────────────────────────────────────

const FICHE_TECHNIQUE_ID = '44444444-4444-4444-8444-444444444444'

describe('POST /api/catalogue/modeles/:id/fiche-technique — création', () => {
  it('crée la première version en brouillon (version=1)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'modeles') return mkChain({ data: { id: MODELE_ID }, error: null }) as never
      if (table === 'fiche_technique') {
        return {
          ...mkChain({ data: null, error: null }),
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            expect(row.version).toBe(1)
            expect(row.statut).toBe('brouillon')
            return mkChain({ data: { id: FICHE_TECHNIQUE_ID, ...row }, error: null })
          }),
        } as never
      }
      return mkChain({ data: null, count: 0, error: null }) as never
    }) as never)

    const res = await app.request(`/api/catalogue/modeles/${MODELE_ID}/fiche-technique`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ mode_calcul: 'surface' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { statut: string; version: number }
    expect(body.statut).toBe('brouillon')
    expect(body.version).toBe(1)
  })

  it('retourne 404 si le modèle est introuvable', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ modeles: { data: null, error: null } })

    const res = await app.request('/api/catalogue/modeles/99999999-9999-4999-8999-999999999999/fiche-technique', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ mode_calcul: 'surface' }),
    })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/catalogue/fiche-technique/:id/activer', () => {
  it('active une fiche brouillon et archive l\'ancienne active du même modèle', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })

    let ficheCalls = 0
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'fiche_technique_ressources') return mkChain({ data: [], count: 1, error: null }) as never
      if (table === 'fiche_technique') {
        ficheCalls++
        if (ficheCalls === 1) return mkChain({ data: { id: FICHE_TECHNIQUE_ID, modele_id: MODELE_ID, statut: 'brouillon' }, error: null }) as never
        if (ficheCalls === 2) return mkChain({ data: null, error: null }) as never // archivage ancienne active
        return mkChain({ data: { id: FICHE_TECHNIQUE_ID, modele_id: MODELE_ID, statut: 'active' }, error: null }) as never
      }
      return mkChain({ data: null, count: 0, error: null }) as never
    }) as never)

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/activer`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('active')
  })

  it('retourne 422 RESSOURCES_MANQUANTES si aucune ressource active', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({
      fiche_technique: { data: { id: FICHE_TECHNIQUE_ID, modele_id: MODELE_ID, statut: 'brouillon' }, error: null },
      fiche_technique_ressources: { data: [], count: 0, error: null },
    })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/activer`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('RESSOURCES_MANQUANTES')
  })

  it('retourne 409 si la fiche est déjà active', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ fiche_technique: { data: { id: FICHE_TECHNIQUE_ID, modele_id: MODELE_ID, statut: 'active' }, error: null } })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/activer`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(409)
  })

  it('retourne 403 si le rôle n\'a pas la permission PRODUCTION:VALIDATE', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: false, roleName: 'MAGASINIER' })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/activer`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
    })

    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/catalogue/fiche-technique/:id', () => {
  it('refuse de supprimer une fiche active', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ fiche_technique: { data: { statut: 'active' }, error: null } })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}`, {
      method:  'DELETE',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FICHE_ACTIVE')
  })

  it('supprime une fiche brouillon', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ fiche_technique: { data: { statut: 'brouillon' }, error: null } })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}`, {
      method:  'DELETE',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(204)
  })
})

// ── RESSOURCES DE LA FICHE TECHNIQUE ─────────────────────────────────────────

describe('POST /api/catalogue/fiche-technique/:id/ressources', () => {
  it('crée une ressource matériau reliée à un vrai produit du stock', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    const PRODUIT_ID = '55555555-5555-4555-8555-555555555555'
    mockTables({
      fiche_technique_ressources: {
        data: { id: 'res-001', fiche_technique_id: FICHE_TECHNIQUE_ID, type: 'materiau', ressource_produit_id: PRODUIT_ID, designation: 'Acier', unite: 'kg', quantite_par_unite: 4, cout_unitaire_reference_xaf: 1200 },
        error: null,
      },
    })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/ressources`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        type: 'materiau', ressource_produit_id: PRODUIT_ID, designation: 'Acier',
        unite: 'kg', quantite_par_unite: 4, cout_unitaire_reference_xaf: 1200,
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { type: string; ressource_produit_id: string }
    expect(body.type).toBe('materiau')
    expect(body.ressource_produit_id).toBe(PRODUIT_ID)
  })

  it('rejette ressource_produit_id sur une ressource main_oeuvre (400)', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })

    const res = await app.request(`/api/catalogue/fiche-technique/${FICHE_TECHNIQUE_ID}/ressources`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        type: 'main_oeuvre', ressource_produit_id: '55555555-5555-4555-8555-555555555555',
        designation: 'Soudeur', unite: 'h', quantite_par_unite: 0.8, cout_unitaire_reference_xaf: 2000,
      }),
    })

    expect(res.status).toBe(400)
  })
})

describe('PUT/DELETE /api/catalogue/ressources/:id', () => {
  it('modifie une ressource existante', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ fiche_technique_ressources: { data: { id: 'res-001', quantite_par_unite: 5 }, error: null } })

    const res = await app.request('/api/catalogue/ressources/res-001', {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ quantite_par_unite: 5 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { quantite_par_unite: number }
    expect(body.quantite_par_unite).toBe(5)
  })

  it('supprime une ressource', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'MANAGER' })
    mockTables({ fiche_technique_ressources: { data: null, error: null } })

    const res = await app.request('/api/catalogue/ressources/res-001', {
      method:  'DELETE',
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(204)
  })
})
