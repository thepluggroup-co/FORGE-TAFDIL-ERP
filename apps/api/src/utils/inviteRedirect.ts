const DEFAULT_WEB_URL = 'https://forge-tafdil-erp-web.vercel.app'

const isLocal = (url: string) => /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url)

export function resolveInviteRedirectUrl(): string | undefined {
  // FRONTEND_URL est une liste d'origines séparées par des virgules (c'est ainsi
  // que app.ts construit ALLOWED_ORIGINS pour le CORS) — on n'en veut qu'UNE
  // pour la redirection. Cette liste commence en général par les origines de
  // dev (http://localhost:5173…) : les prendre telles quelles envoyait les
  // invités vers « localhost n'autorise pas la connexion » (recette AD-04).
  // On retient donc la première origine NON locale ; une origine locale n'est
  // utilisée qu'hors production et faute de mieux.
  const candidates = [
    process.env.INVITE_REDIRECT_URL,
    ...(process.env.FRONTEND_URL?.split(',') ?? []),
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VITE_APP_URL,
    process.env.VITE_FRONTEND_URL,
    process.env.APP_URL,
  ]
    .map(value => value?.trim() ?? '')
    .filter(Boolean)

  const publique = candidates.find(url => !isLocal(url))
  const locale   = process.env.NODE_ENV !== 'production' ? candidates.find(isLocal) : undefined
  const base     = publique ?? locale ?? DEFAULT_WEB_URL

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
