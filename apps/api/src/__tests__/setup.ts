// Variables d'environnement injectées avant tout import de module
process.env.NODE_ENV             = 'test'
process.env.SUPABASE_JWT_SECRET  = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'
process.env.SUPABASE_URL         = 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY    = 'test-anon-key'
// Service role vide → supabaseAdmin sera null → auditMiddleware ne logue rien
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
// NOKASH_SECRET_KEY / NOKASH_PUBLIC_KEY : noms hérités d'une ancienne convention,
// plus lus nulle part dans le code actuel (apps/api/src/routes/paiements.ts lit
// NOKASH_APPLICATION_KEY / NOKASH_INTEGRATION_KEY). Conservés pour ne rien casser
// d'éventuel, mais ce sont ces deux-ci qui rendent nokashConfigured() vrai en test.
process.env.NOKASH_SECRET_KEY       = ''
process.env.NOKASH_PUBLIC_KEY       = 'pk_test.forge-test'
process.env.NOKASH_APPLICATION_KEY  = 'test-app-key-forge'
process.env.NOKASH_INTEGRATION_KEY  = 'test-integration-key-forge'
// Clé Anthropic factice — remplacée par mock dans TEST-04
process.env.ANTHROPIC_API_KEY    = 'sk-ant-test-forge-2026'
