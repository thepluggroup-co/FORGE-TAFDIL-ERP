/**
 * Diagnostic Supabase — FORGE ERP
 * Usage : node scripts/check-supabase.mjs
 *
 * Vérifie :
 *   1. Variables d'environnement présentes
 *   2. Format de l'URL
 *   3. Connectivité REST API (anon key)
 *   4. Connectivité admin (service role key)
 *   5. Tables principales accessibles
 *   6. JWT Secret configuré
 *   7. Auth : inscription test anonyme
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// Charger le .env de l'API
try {
  const env = readFileSync(resolve(__dir, '../.env'), 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.trim().split('=')
    if (k && !k.startsWith('#') && v.length) process.env[k] = v.join('=')
  }
} catch { /* pas de .env — utiliser les vars système */ }

const URL   = process.env.SUPABASE_URL        ?? ''
const ANON  = process.env.SUPABASE_ANON_KEY   ?? ''
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? ''
const JWT   = process.env.SUPABASE_JWT_SECRET ?? ''

const OK  = '✅'
const ERR = '❌'
const WRN = '⚠️ '

let errors = 0
function pass(msg)  { console.log(`  ${OK}  ${msg}`) }
function fail(msg)  { console.log(`  ${ERR}  ${msg}`); errors++ }
function warn(msg)  { console.log(`  ${WRN} ${msg}`) }
function head(msg)  { console.log(`\n── ${msg} ──`) }

// ── 1. Variables ──────────────────────────────────────────────────────────────
head('1. Variables d\'environnement')

if (URL)  pass(`SUPABASE_URL           = ${URL}`)
else      fail('SUPABASE_URL           manquante')

if (ANON) pass('SUPABASE_ANON_KEY      présente')
else      fail('SUPABASE_ANON_KEY      manquante')

if (SVC)  pass('SUPABASE_SERVICE_ROLE_KEY présente')
else      fail('SUPABASE_SERVICE_ROLE_KEY manquante (supabaseAdmin sera null)')

if (JWT && !JWT.startsWith('<')) pass('SUPABASE_JWT_SECRET    présente')
else      fail('SUPABASE_JWT_SECRET    manquante ou non remplie — AUTH NE FONCTIONNERA PAS')

// ── 2. Format URL ─────────────────────────────────────────────────────────────
head('2. Format URL')

if (!URL) {
  fail('URL vide — impossible de tester')
} else if (URL.includes('/rest/v1')) {
  fail(`URL contient "/rest/v1" — retirer ce suffixe. Correct : ${URL.split('/rest')[0]}`)
} else if (!URL.startsWith('https://')) {
  fail(`URL doit commencer par https://`)
} else {
  pass(`URL valide : ${URL}`)
}

// ── 3. Connectivité REST (anon) ───────────────────────────────────────────────
head('3. Connectivité REST API (anon key)')

async function testRest() {
  if (!URL || !ANON) return fail('Variables manquantes — test ignoré')
  const base = URL.endsWith('/') ? URL.slice(0, -1) : URL
  try {
    // Tester sur une table concrète (root retourne 401 même avec anon key valide)
    const res = await fetch(`${base}/rest/v1/produits?limit=1&select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    })
    if (res.status === 200 || res.status === 206) {
      pass(`Anon key valide — connexion REST établie (status ${res.status})`)
    } else if (res.status === 401) {
      fail(`Anon key invalide ou expirée (${res.status})`)
    } else {
      warn(`Anon key REST réponse ${res.status}`)
    }
  } catch (e) {
    fail(`Impossible de joindre Supabase : ${e.message}`)
  }
}

// ── 4. Connectivité admin (service role) ──────────────────────────────────────
head('4. Connectivité admin (service role)')

async function testAdmin() {
  if (!URL || !SVC) return fail('SERVICE_ROLE_KEY manquante — test ignoré')
  const base = URL.endsWith('/') ? URL.slice(0, -1) : URL
  try {
    const res = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
    })
    if (res.ok || res.status === 200) {
      pass(`Admin REST réponse ${res.status} — service role OK`)
    } else {
      warn(`Admin REST réponse ${res.status}`)
    }
  } catch (e) {
    fail(`Impossible de joindre Supabase en admin : ${e.message}`)
  }
}

// ── 5. Tables accessibles ─────────────────────────────────────────────────────
head('5. Tables principales (lecture via anon key)')

const TABLES = ['clients', 'produits', 'commandes', 'factures', 'employes']

async function testTable(table) {
  if (!URL || !ANON) return
  const base = URL.endsWith('/') ? URL.slice(0, -1) : URL
  try {
    const res = await fetch(`${base}/rest/v1/${table}?limit=1&select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Range': '0-0' },
    })
    if (res.status === 200 || res.status === 206) {
      pass(`Table "${table}" accessible (${res.status})`)
    } else if (res.status === 401) {
      warn(`Table "${table}" — non autorisée avec anon key (RLS actif ?)`)
    } else if (res.status === 404) {
      fail(`Table "${table}" introuvable — vérifier le schéma Supabase`)
    } else {
      warn(`Table "${table}" — réponse ${res.status}`)
    }
  } catch (e) {
    fail(`Table "${table}" — ${e.message}`)
  }
}

// ── 6. JWT Secret ─────────────────────────────────────────────────────────────
head('6. JWT Secret')

function testJwt() {
  if (!JWT || JWT.startsWith('<')) {
    fail('JWT Secret non configuré — récupérer depuis Supabase Dashboard')
    console.log('       → Dashboard → Project Settings → API → JWT Secret')
    return
  }
  if (JWT.length < 32) {
    fail(`JWT Secret trop court (${JWT.length} chars) — vérifier la valeur`)
    return
  }
  pass(`JWT Secret configuré (${JWT.length} chars)`)
}

// ── 7. Auth health ────────────────────────────────────────────────────────────
head('7. Auth service')

async function testAuth() {
  if (!URL || !ANON) return
  const base = URL.endsWith('/') ? URL.slice(0, -1) : URL
  try {
    const res = await fetch(`${base}/auth/v1/settings`, {
      headers: { apikey: ANON },
    })
    if (res.ok) {
      const data = await res.json()
      pass(`Auth service OK — signups: ${data.disable_signup ? 'désactivés' : 'activés'}`)
    } else {
      warn(`Auth service réponse ${res.status}`)
    }
  } catch (e) {
    fail(`Auth service injoignable : ${e.message}`)
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
testJwt()
await testRest()
await testAdmin()
for (const t of TABLES) await testTable(t)
await testAuth()

// ── Bilan ─────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50))
if (errors === 0) {
  console.log(`\n${OK} Tous les tests passent — Supabase correctement connecté.\n`)
} else {
  console.log(`\n${ERR} ${errors} problème(s) détecté(s) — voir les messages ci-dessus.\n`)
  process.exit(1)
}
