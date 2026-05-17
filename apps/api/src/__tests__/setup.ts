// Variables d'environnement injectées avant tout import de module
process.env.NODE_ENV             = 'test'
process.env.SUPABASE_JWT_SECRET  = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'
process.env.SUPABASE_URL         = 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY    = 'test-anon-key'
// Service role vide → supabaseAdmin sera null → auditMiddleware ne logue rien
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
// Signature Notchpay vide → verifySignature retourne true (bypass en dev)
process.env.NOTCHPAY_SECRET_KEY  = ''
process.env.NOTCHPAY_PUBLIC_KEY  = 'pk_test.forge-test'
// Clé Anthropic factice — remplacée par mock dans TEST-04
process.env.ANTHROPIC_API_KEY    = 'sk-ant-test-forge-2026'
