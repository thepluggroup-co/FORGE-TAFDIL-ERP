export function resolveInviteRedirectUrl(): string | undefined {
  // FRONTEND_URL est une liste d'origines séparées par des virgules (c'est ainsi
  // que app.ts construit ALLOWED_ORIGINS pour le CORS) — ici on ne veut qu'UNE
  // seule URL de redirection, donc on ne prend que la première origine de la
  // liste. Sans ce split, la chaîne entière ("http://a,http://b,http://c")
  // partait telle quelle vers Supabase comme redirectTo : une URL invalide que
  // Supabase rejette silencieusement en retombant sur son "Site URL" par
  // défaut du dashboard (d'où la redirection surprise vers localhost:3000).
  const candidates = [
    process.env.INVITE_REDIRECT_URL,
    process.env.FRONTEND_URL?.split(',')[0],
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VITE_APP_URL,
    process.env.VITE_FRONTEND_URL,
    process.env.APP_URL,
  ].filter((value): value is string => Boolean(value?.trim()))

  const base = candidates[0]?.trim()
  if (!base) {
    return 'https://forge-tafdil-erp-web.vercel.app/set-password'
  }

  const normalizedBase = base.replace(/\/+$/, '')
  const withProtocol = /^https?:\/\//i.test(normalizedBase)
    ? normalizedBase
    : `https://${normalizedBase}`

  // /set-password (pas /login) : c'est l'écran de première connexion / reset —
  // il capte le token Supabase dans l'URL et fait choisir le mot de passe,
  // au lieu d'atterrir sur le formulaire de connexion normal sans mot de passe
  // encore défini.
  return `${withProtocol}/set-password`
}
