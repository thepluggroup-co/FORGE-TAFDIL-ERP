export function resolveInviteRedirectUrl(): string | undefined {
  const candidates = [
    process.env.INVITE_REDIRECT_URL,
    process.env.FRONTEND_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VITE_APP_URL,
    process.env.VITE_FRONTEND_URL,
    process.env.APP_URL,
  ].filter((value): value is string => Boolean(value?.trim()))

  const base = candidates[0]?.trim()
  if (!base) {
    return 'https://forge-tafdil-erp-web.vercel.app/login'
  }

  const normalizedBase = base.replace(/\/+$/, '')
  const withProtocol = /^https?:\/\//i.test(normalizedBase)
    ? normalizedBase
    : `https://${normalizedBase}`

  return `${withProtocol}/login`
}
