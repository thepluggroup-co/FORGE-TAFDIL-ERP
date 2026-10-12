/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@forge/ui', '@forge/shared'],
  // Le lint tourne à part (`pnpm lint`, configuration ESLint à la racine) :
  // `next build` ne doit pas le relancer avec sa propre configuration.
  eslint: { ignoreDuringBuilds: true },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
}

export default nextConfig
