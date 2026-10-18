import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── Tableau de bord par rôle ──────────────────────────────────────────────────
// Ouvre /dashboard sous chaque rôle RBAC, vérifie que seuls les indicateurs du
// poste s'affichent, et enregistre une capture (test-results/dashboards/<rôle>.png).
// Aucune dépendance à Supabase ni à l'API : la session est posée dans le
// localStorage et tous les appels réseau sont simulés avec des données fictives.

// La clé de session Supabase dépend de la référence du projet (sb-<ref>-auth-token).
function supabaseRef(): string {
  const fromEnv = process.env.VITE_SUPABASE_URL
  const url = fromEnv ?? (() => {
    for (const file of ['../.env.development.local', '../.env.local', '../.env']) {
      try {
        const match = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').match(/^VITE_SUPABASE_URL=(.+)$/m)
        if (match) return match[1].trim()
      } catch { /* fichier absent */ }
    }
    return 'https://localhost.supabase.co'
  })()
  return new URL(url).hostname.split('.')[0]
}

type Perm = { module: string; action: string }
const read = (...modules: string[]): Perm[] => modules.map((module) => ({ module, action: 'READ' }))
const ALL_MODULES = ['STOCK', 'COMMERCIAL', 'FINANCE', 'HR', 'PRODUCTION', 'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES', 'CAISSE']
const ALL_ACTIONS = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'CONFIGURE', 'EXPORT']

interface RoleCase {
  rbac: string
  legacy: string
  nom: string
  permissions: Perm[]
  /** Titres d'indicateurs attendus. */
  visible: string[]
  /** Titres qui ne doivent jamais apparaître pour ce rôle. */
  absent: string[]
}

const ROLES: RoleCase[] = [
  {
    rbac: 'SUPER_ADMIN', legacy: 'admin', nom: 'Aïcha Directrice',
    permissions: ALL_MODULES.flatMap((module) => ALL_ACTIONS.map((action) => ({ module, action }))),
    visible: ['Ventes caisse (jour)', 'CA du mois', 'À recevoir (factures)', 'Apprenants actifs', 'Factures en retard'],
    absent: ['Ma session de caisse', 'Mon niveau de formation'],
  },
  {
    rbac: 'MANAGER', legacy: 'manager', nom: 'Bruno Manager',
    permissions: ALL_MODULES.filter((m) => m !== 'ADMIN')
      .flatMap((module) => ALL_ACTIONS.filter((a) => a !== 'CONFIGURE').map((action) => ({ module, action }))),
    visible: ['Commandes en cours', 'OF en retard', 'Bons de sortie en attente', 'Stocks critiques'],
    absent: ['À recevoir (factures)', 'Ma session de caisse'],
  },
  {
    rbac: 'COMMERCIAL', legacy: 'operateur', nom: 'Carine Commerciale',
    permissions: [...read('COMMERCIAL', 'STOCK', 'REPORTS'), { module: 'COMMERCIAL', action: 'CREATE' }, { module: 'COMMERCIAL', action: 'UPDATE' }],
    visible: ['Devis en attente client', 'Commandes prêtes', 'CA du mois', 'Devis à relancer'],
    absent: ['Ventes caisse (jour)', 'Apprenants actifs', 'OF en retard'],
  },
  {
    rbac: 'CAISSIER', legacy: 'caissier', nom: 'Daniel Caissier',
    permissions: [...read('CAISSE', 'RECEIVABLES', 'STOCK'), { module: 'CAISSE', action: 'CREATE' }, { module: 'CAISSE', action: 'UPDATE' }],
    visible: ['Ma session de caisse', 'Mes ventes du jour', 'Ticket moyen', 'Échéances en retard'],
    absent: ['CA du mois', 'Commandes en cours', 'Alertes prioritaires'],
  },
  {
    rbac: 'MAGASINIER', legacy: 'operateur', nom: 'Émile Magasinier',
    permissions: [...read('STOCK', 'LOGISTICS'), { module: 'STOCK', action: 'CREATE' }, { module: 'STOCK', action: 'UPDATE' }],
    visible: ['Produits en alerte', 'Bons de sortie en attente', 'Bons à préparer', 'Prêts à livrer', 'Livraisons planifiées'],
    absent: ['CA du mois', 'Commandes en cours', 'Alertes prioritaires'],
  },
  {
    rbac: 'LIVREUR', legacy: 'operateur', nom: 'Fabrice Livreur',
    permissions: read('LOGISTICS'),
    visible: ['À livrer', 'En route', "Livrées aujourd'hui", 'Mes livraisons'],
    absent: ['CA du mois', 'Produits en alerte'],
  },
  {
    rbac: 'FORMATEUR', legacy: 'operateur', nom: 'Gisèle Formatrice',
    permissions: [...read('HR', 'REPORTS'), { module: 'HR', action: 'CREATE' }, { module: 'HR', action: 'UPDATE' }],
    visible: ['Apprenants actifs', 'Sessions en cours', 'Sessions planifiées', 'Niveau 5 atteint', 'Apprenants par niveau'],
    absent: ['CA du mois', 'Produits en alerte', 'Alertes prioritaires'],
  },
  {
    rbac: 'READONLY', legacy: 'technicien', nom: 'Hervé Technicien',
    permissions: read('STOCK', 'COMMERCIAL', 'PRODUCTION', 'LOGISTICS', 'REPORTS', 'RECEIVABLES'),
    visible: ['OF en cours', 'OF en retard', 'Machines opérationnelles', 'Mon niveau de formation', 'Mon parcours de formation'],
    absent: ['CA du mois', 'Ventes caisse (jour)', 'Commandes en cours'],
  },
]

// ── Données fictives ──────────────────────────────────────────────────────────

const now = new Date()
const iso = (offsetDays = 0, hour = 10) => {
  const d = new Date(now)
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hour, 15, 0, 0)
  return d.toISOString()
}
const day = (offsetDays = 0) => iso(offsetDays).slice(0, 10)

const produitsAlerte = [
  { id: 'p1', ref: 'TUB-40x40', designation: 'Tube carré 40x40 acier', categorie: 'acier', unite: 'barre', stock_actuel: 0, stock_min: 20, stock_critique: 5, prix_unitaire_xaf: 8500, statut: 'rupture', updated_at: iso() },
  { id: 'p2', ref: 'ELEC-E6013', designation: 'Électrodes E6013 Ø3.2', categorie: 'consommable', unite: 'paquet', stock_actuel: 3, stock_min: 15, stock_critique: 5, prix_unitaire_xaf: 4200, statut: 'critique', updated_at: iso() },
  { id: 'p3', ref: 'TOLE-2MM', designation: 'Tôle noire 2 mm', categorie: 'acier', unite: 'feuille', stock_actuel: 8, stock_min: 12, stock_critique: 4, prix_unitaire_xaf: 32000, statut: 'alerte', updated_at: iso() },
]

const commandes = [
  { id: 'c1', reference: 'CMD-2026-0412', statut: 'in_production', date_commande: day(-6), date_livraison_prevue: day(4), montant_ttc_xaf: 1850000, acompte_recu_xaf: 900000, solde_restant_xaf: 950000, client: { id: 'cl1', nom: 'Hôtel La Falaise', telephone: '699000001' }, lignes: [], historique: [] },
  { id: 'c2', reference: 'CMD-2026-0415', statut: 'pret', date_commande: day(-9), date_livraison_prevue: day(1), montant_ttc_xaf: 640000, acompte_recu_xaf: 320000, solde_restant_xaf: 320000, client: { id: 'cl2', nom: 'Mme Ngo Bassa', telephone: '677000002' }, lignes: [], historique: [] },
  { id: 'c3', reference: 'CMD-2026-0418', statut: 'confirmed', date_commande: day(-2), date_livraison_prevue: day(12), montant_ttc_xaf: 2400000, acompte_recu_xaf: 1200000, solde_restant_xaf: 1200000, client: { id: 'cl3', nom: 'SCI Bonapriso', telephone: '655000003' }, lignes: [], historique: [] },
  { id: 'c4', reference: 'CMD-2026-0401', statut: 'delivered', date_commande: day(-20), date_livraison_prevue: day(-5), montant_ttc_xaf: 480000, acompte_recu_xaf: 480000, solde_restant_xaf: 0, client: { id: 'cl4', nom: 'M. Tchoumi', telephone: '690000004' }, lignes: [], historique: [] },
]

const livraisons = [
  { id: 'l1', numero: 'LIV-20261012-0001', client_nom: 'Mme Ngo Bassa', destination: 'Bonamoussadi, Douala', statut: 'en_route', date_livraison_prevue: day(0), date_livraison_reelle: null, created_at: iso(-1) },
  { id: 'l2', numero: 'LIV-20261012-0002', client_nom: 'Hôtel La Falaise', destination: 'Bonanjo, Douala', statut: 'planifiee', date_livraison_prevue: day(1), date_livraison_reelle: null, created_at: iso(-1) },
  { id: 'l3', numero: 'LIV-20261011-0004', client_nom: 'M. Tchoumi', destination: 'Akwa, Douala', statut: 'livree', date_livraison_prevue: day(0), date_livraison_reelle: iso(0, 9), created_at: iso(-2) },
]

const apprenants = [
  { id: 'a1', nom: 'Junior Mbarga', specialite: 'Soudure', niveau: 5, duree_mois: 9, statut: 'actif' },
  { id: 'a2', nom: 'Sandrine Eyenga', specialite: 'Menuiserie métallique', niveau: 3, duree_mois: 5, statut: 'actif' },
  { id: 'a3', nom: 'Patrick Fouda', specialite: 'Soudure', niveau: 2, duree_mois: 3, statut: 'actif' },
  { id: 'a4', nom: 'Lionel Atangana', specialite: 'Ferronnerie', niveau: 2, duree_mois: 4, statut: 'actif' },
  { id: 'a5', nom: 'Estelle Manga', specialite: 'Soudure', niveau: 1, duree_mois: 1, statut: 'actif' },
]

const sessions = [
  { id: 's1', module: 'Soudure à l\'arc — perfectionnement', niveau: 3, statut: 'en_cours', date_debut: day(-7), date_fin: day(7), formateur: 'M. Essomba', lieu: 'Atelier A', capacite_max: 8, horaires: [], description: null, nb_inscrits: 6 },
  { id: 's2', module: 'Lecture de plans', niveau: 2, statut: 'planifiee', date_debut: day(5), date_fin: day(12), formateur: 'Mme Biloa', lieu: 'Salle 1', capacite_max: 12, horaires: [], description: null, nb_inscrits: 4 },
  { id: 's3', module: 'Sécurité atelier & EPI', niveau: 1, statut: 'planifiee', date_debut: day(9), date_fin: day(10), formateur: 'M. Essomba', lieu: 'Salle 1', capacite_max: 15, horaires: [], description: null, nb_inscrits: 9 },
]

const tickets = [
  { id: 't1', numero_facture: 'FAC-C-000231', numero_local: null, caissier_id: 'u', client_id: null, client_nom: null, total_ht_xaf: 35000, tva_xaf: 6738, total_ttc_xaf: 41738, remise_xaf: 0, statut: 'valide', oversell: false, created_at: iso(0, 8) },
  { id: 't2', numero_facture: 'FAC-C-000232', numero_local: null, caissier_id: 'u', client_id: 'cl4', client_nom: 'M. Tchoumi', total_ht_xaf: 120000, tva_xaf: 23100, total_ttc_xaf: 143100, remise_xaf: 0, statut: 'valide', oversell: false, created_at: iso(0, 9) },
  { id: 't3', numero_facture: 'FAC-C-000233', numero_local: null, caissier_id: 'u', client_id: null, client_nom: null, total_ht_xaf: 18000, tva_xaf: 3465, total_ttc_xaf: 21465, remise_xaf: 0, statut: 'valide', oversell: false, created_at: iso(0, 10) },
]

const jobs = [
  { id: 'j1', numero: 'OF-2026-0188', produit_designation: 'Portail coulissant 4 m', technicien_nom: 'Hervé', machine_nom: 'Poste MIG 2', avancement_pct: 65, statut: 'in_production', date_fin_prevue: day(-1), created_at: iso(-8), en_retard: true },
  { id: 'j2', numero: 'OF-2026-0191', produit_designation: 'Garde-corps balcon (12 ml)', technicien_nom: 'Junior', machine_nom: 'Cintreuse', avancement_pct: 30, statut: 'in_production', date_fin_prevue: day(5), created_at: iso(-3), en_retard: false },
  { id: 'j3', numero: 'OF-2026-0193', produit_designation: 'Lot 6 fenêtres antivol', technicien_nom: 'Sandrine', machine_nom: 'Tronçonneuse', avancement_pct: 10, statut: 'in_production', date_fin_prevue: day(9), created_at: iso(-1), en_retard: false },
]

const MOIS = ['Mai', 'Jui', 'Juil', 'Aoû', 'Sep', 'Oct']

/** Réponse simulée pour un appel API ; `null` = 404. */
function apiResponse(path: string, search: URLSearchParams, role: RoleCase): unknown {
  switch (path) {
    case '/api/profile/permissions':
      return { data: { legacyRole: role.legacy, rbacRoleName: role.rbac, permissions: role.permissions } }
    case '/api/rapports/dashboard':
      return {
        ca_mensuel: [4.1, 3.6, 5.2, 4.8, 6.1, 5.4].map((m, i) => ({ mois: MOIS[i], ca: m * 1_000_000 })),
        kpis: { commandes_actives: 3, stocks_en_alerte: 3, apprenants_actifs: 5, bons_en_attente: 2, credits_echus: 1, caisse_ventes_jour_count: 7, caisse_ventes_jour_xaf: 386500 },
        recent_commandes: commandes.map((c) => ({ id: c.id, numero: c.reference, client_nom: c.client.nom, total_ttc_xaf: c.montant_ttc_xaf, statut: c.statut, date_commande: c.date_commande })),
        recent_mouvements: [],
      }
    case '/api/ai/alertes':
      return { alertes: [] }
    case '/api/finance/dashboard':
      return {
        kpis: { ca_facture_xaf: 18400000, encaisse_xaf: 13250000, a_recevoir_xaf: 5150000, banque_caisse_xaf: 7200000, taux_encaissement: 72, factures_total: 41, factures_brouillon: 2, factures_a_relancer: 4, factures_en_retard: 2, montant_retard_xaf: 1470000, credits_ouverts: 3, credits_solde_xaf: 980000 },
        repartition_factures: [],
        factures_en_retard: [
          { id: 'f1', numero: 'FAC-2026-0098', client_nom: 'SCI Bonapriso', date_echeance: day(-12), solde_restant_xaf: 950000 },
          { id: 'f2', numero: 'FAC-2026-0104', client_nom: 'Hôtel La Falaise', date_echeance: day(-4), solde_restant_xaf: 520000 },
        ],
        top_clients_debiteurs: [], dernieres_ecritures: [],
      }
    case '/api/credit/dashboard':
      return { totalEncours: 980000, activeClients: 3, overdueCount: 2, recoveryRate: 81, monthlyTrend: [] }
    case '/api/credit/overdue':
      return { data: [
        { id: 'e1', payment_plan_id: 'pp1', installment_number: 2, due_date: day(-9), amount_due: 150000, amount_paid: 50000, status: 'overdue', days_late: 9, payment_plans: { id: 'pp1', customer_id: 'cl4', total_amount: 480000, outstanding_balance: 250000, clients: { id: 'cl4', nom: 'M. Tchoumi', telephone: '690 000 004' } } },
        { id: 'e2', payment_plan_id: 'pp2', installment_number: 1, due_date: day(-3), amount_due: 80000, amount_paid: 0, status: 'overdue', days_late: 3, payment_plans: { id: 'pp2', customer_id: 'cl2', total_amount: 320000, outstanding_balance: 320000, clients: { id: 'cl2', nom: 'Mme Ngo Bassa', telephone: '677 000 002' } } },
      ] }
    case '/api/caisse/sessions/courante':
      return { id: 'ses1', caissier_id: 'u', date_ouverture: iso(0, 7), date_fermeture: null, fond_ouverture_xaf: 50000, fond_fermeture_xaf: null, total_especes_xaf: 0, total_om_xaf: 0, total_momo_xaf: 0, total_credit_xaf: 0, ecart_xaf: null, statut: 'ouverte' }
    case '/api/caisse/tickets':
      return { data: tickets, total: tickets.length, page: 1, per_page: 100, total_pages: 1 }
    case '/api/devis':
      return { data: [
        { id: 'd1', reference: 'DEV-2026-0301', statut: 'envoye', montant_ttc_xaf: 1250000, expire: false, jours_restants: 2, client: { id: 'cl5', nom: 'Pharmacie du Rond-Point' }, lignes: [] },
        { id: 'd2', reference: 'DEV-2026-0297', statut: 'envoye', montant_ttc_xaf: 3400000, expire: false, jours_restants: 11, client: { id: 'cl3', nom: 'SCI Bonapriso' }, lignes: [] },
        { id: 'd3', reference: 'DEV-2026-0288', statut: 'envoye', montant_ttc_xaf: 560000, expire: true, jours_restants: 0, client: { id: 'cl6', nom: 'M. Kamga' }, lignes: [] },
      ], total: 3 }
    case '/api/commandes':
      return { data: commandes, total: commandes.length }
    case '/api/stocks/alertes':
      return { data: produitsAlerte, total: produitsAlerte.length }
    case '/api/stocks/mouvements':
      return { data: [
        { id: 'm1', created_at: iso(0, 9), type: 'sortie', quantite: 12, reference: null, notes: null, created_by: null, produits: { ref: 'TUB-40x40', designation: 'Tube carré 40x40 acier', unite: 'barre' }, profiles: null },
        { id: 'm2', created_at: iso(0, 8), type: 'entree', quantite: 40, reference: null, notes: null, created_by: null, produits: { ref: 'DISQ-125', designation: 'Disque à tronçonner 125', unite: 'pièce' }, profiles: null },
        { id: 'm3', created_at: iso(-1, 16), type: 'sortie', quantite: 5, reference: null, notes: null, created_by: null, produits: { ref: 'ELEC-E6013', designation: 'Électrodes E6013 Ø3.2', unite: 'paquet' }, profiles: null },
      ], total: 3, page: 1, per_page: 20, total_pages: 1 }
    case '/api/bons':
      return { data: [], total: search.get('statut') === 'soumis' ? 2 : 1 }
    case '/api/logistique/preparation/resume':
      return { a_preparer: 4, en_cours: 2, pret_a_livrer: 3, planifiee: 2 }
    case '/api/logistique/livraisons':
    case '/api/logistique/livraisons/mes-livraisons':
      return { data: livraisons, total: livraisons.length, page: 1, per_page: 50, total_pages: 1 }
    case '/api/production/indicateurs':
      return { data: { of_en_cours: 3, of_a_lancer: 2, of_en_retard: 1, machines: { operationnelles: 7, total: 9, en_panne: 1, en_maintenance: 1 }, rendement_30j_pct: 92, etapes_mesurees_30j: 18, anomalies: { total: 2, of_en_retard: 1, machines_en_panne: 1 } } }
    case '/api/production/jobs':
      return { data: jobs, total: jobs.length }
    case '/api/rh/apprenants':
      return { data: apprenants, total: apprenants.length }
    case '/api/rh/formation/sessions': {
      const statut = search.get('statut')
      const data = statut ? sessions.filter((s) => s.statut === statut) : sessions
      return { data, total: data.length }
    }
    case '/api/formation/mon-parcours':
      return {
        apprenant: apprenants[1],
        validations: [],
        inscriptions: [{ id: 'i1', apprenant_id: 'a2', session_id: 's1', date_inscription: day(-8), disponibilites: [], nb_seances: 4, evaluation: null, statut: 'en_cours', notes: null, formation_sessions: { module: sessions[0].module, niveau: 3, date_debut: sessions[0].date_debut, date_fin: sessions[0].date_fin, formateur: 'M. Essomba', lieu: 'Atelier A' } }],
      }
    default:
      return { data: [], total: 0 }
  }
}

async function ouvrirDashboard(page: Page, role: RoleCase) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
    email: `${role.legacy}@tafdil.cm`, app_metadata: { role: role.legacy }, user_metadata: {}, created_at: iso(-90),
  }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const session = {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.signature`,
    refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
  }
  await page.addInitScript(([key, value]) => { localStorage.setItem(key, value) },
    [`sb-${supabaseRef()}-auth-token`, JSON.stringify(session)] as const)

  // Supabase (auth, PostgREST, realtime) — jamais le vrai projet.
  await page.route(/supabase\.co\//, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({ json: session })
    if (url.pathname === '/rest/v1/profiles') {
      return route.fulfill({ json: { role: role.legacy, nom: role.nom, rbac_user_profiles: null, user_pins: null } })
    }
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ json: [] })
    return route.abort()
  })

  // API ERP — uniquement les appels fetch (pas les modules servis par Vite).
  await page.route(/\/api\//, (route) => {
    const request = route.request()
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.fallback()
    const url = new URL(request.url())
    return route.fulfill({ json: apiResponse(url.pathname, url.searchParams, role) })
  })

  await page.goto('/dashboard')
}

for (const role of ROLES) {
  test(`dashboard ${role.rbac} — indicateurs du poste uniquement`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1300 })
    await ouvrirDashboard(page, role)

    await expect(page.getByText(role.nom).first()).toBeVisible({ timeout: 20_000 })
    for (const titre of role.visible) {
      await expect(page.getByText(titre, { exact: true }).first(), titre).toBeVisible({ timeout: 15_000 })
    }
    for (const titre of role.absent) {
      await expect(page.getByText(titre, { exact: true }), titre).toHaveCount(0)
    }

    // Laisse les animations d'entrée et les requêtes se terminer avant la capture.
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(800)
    const file = `test-results/dashboards/${role.rbac.toLowerCase()}.png`
    await page.screenshot({ path: file, fullPage: true })
    await testInfo.attach(role.rbac, { path: file, contentType: 'image/png' })
  })
}
