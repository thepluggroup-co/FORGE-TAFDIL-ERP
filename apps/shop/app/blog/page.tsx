import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  FileText,
  Grid2X2,
  Lightbulb,
  Newspaper,
  Search,
  Tag,
} from 'lucide-react'
import { blogArticles, type BlogArticle } from '@/lib/blog'

interface BlogPageProps {
  searchParams?: {
    categorie?: string
    q?: string
  }
}

const categories = [
  { label: 'Tous les articles', value: 'all', icon: Grid2X2 },
  { label: 'Conseils', value: 'Conseils', icon: Lightbulb },
  { label: 'Guides', value: 'Guide', icon: BookOpen },
  { label: 'Actualites', value: 'Actualites', icon: Newspaper },
  { label: 'Tendances', value: 'Tendances', icon: Tag },
]

export const metadata = {
  title: 'Blog TAFDIL | Articles et conseils',
  description: 'Conseils, guides pratiques et actualites TAFDIL pour vos projets en metallerie, aluminium et construction metallique.',
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getCategoryCount(value: string) {
  if (value === 'all') return blogArticles.length
  return blogArticles.filter((article) => article.category === value).length
}

function getVisibleArticles(category: string, query: string) {
  return blogArticles.filter((article) => {
    const matchesCategory = category === 'all' || article.category === category
    const haystack = normalize(`${article.title} ${article.excerpt} ${article.category} ${article.tags.join(' ')}`)
    const matchesQuery = query === '' || haystack.includes(normalize(query))
    return matchesCategory && matchesQuery
  })
}

function ArticleCard({ article, priority = false }: { article: BlogArticle; priority?: boolean }) {
  return (
    <article className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-forge-red/20 hover:shadow-lg">
      <Link href={`/blog/${article.slug}`} className="relative block aspect-[1.55] overflow-hidden bg-gray-100">
        <Image
          src={article.image}
          alt={article.title}
          fill
          priority={priority}
          loading={priority ? undefined : 'eager'}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 45vw, 280px"
          className="object-cover transition duration-500 group-hover:scale-105"
        />
        <span className="absolute bottom-3 left-3 rounded-md bg-white px-3 py-1 text-[11px] font-black text-forge-red shadow-sm">
          {article.category}
        </span>
      </Link>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-gray-500">
          <span>{article.date}</span>
          <span className="h-1 w-1 rounded-full bg-gray-300" />
          <span>{article.readTime}</span>
        </div>
        <Link href={`/blog/${article.slug}`} className="mt-3 block min-h-[52px] text-base font-black leading-snug text-forge-dark transition-colors hover:text-forge-red">
          {article.title}
        </Link>
        <p className="mt-3 line-clamp-3 min-h-[66px] text-sm leading-6 text-gray-600">{article.excerpt}</p>
        <Link href={`/blog/${article.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-black text-forge-red">
          Lire l article <ArrowRight size={14} />
        </Link>
      </div>
    </article>
  )
}

function SidebarArticle({ article }: { article: BlogArticle }) {
  return (
    <Link href={`/blog/${article.slug}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-md p-2 transition hover:bg-gray-50">
      <span className="relative h-16 overflow-hidden rounded-md bg-gray-100">
        <Image src={article.image} alt={article.title} fill sizes="72px" className="object-cover" />
      </span>
      <span>
        <span className="line-clamp-2 text-sm font-black leading-snug text-forge-dark">{article.title}</span>
        <span className="mt-1 block text-xs text-gray-500">{article.date}</span>
      </span>
    </Link>
  )
}

export default function BlogPage({ searchParams }: BlogPageProps) {
  const activeCategory = categories.some((category) => category.value === searchParams?.categorie)
    ? searchParams?.categorie ?? 'all'
    : 'all'
  const query = searchParams?.q?.trim() ?? ''
  const visibleArticles = getVisibleArticles(activeCategory, query)
  const popularArticles = blogArticles.slice(0, 5)

  return (
    <main className="bg-white">
      <div className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-5 text-xs font-semibold text-gray-500 sm:px-6 lg:px-8">
          <Link href="/" className="hover:text-forge-red">Accueil</Link>
          <span>/</span>
          <span className="text-forge-dark">Blog</span>
        </div>
      </div>

      <section className="relative overflow-hidden bg-[#101418]">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1800&q=85"
            alt="Atelier de metallerie TAFDIL"
            fill
            priority
            sizes="100vw"
            className="object-cover object-right opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#101418] via-[#101418]/90 to-[#101418]/30" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-16 text-white sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase tracking-widest text-forge-red">Blog & conseils</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight sm:text-5xl">
            Nos articles & conseils
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-gray-100">
            Decouvrez nos conseils d experts, guides pratiques et actualites pour reussir vos projets en metallerie et construction.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[minmax(0,1fr)_330px] lg:px-8">
        <div>
          <nav className="mb-5 flex gap-2 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm" aria-label="Categories blog">
            {categories.map(({ label, value, icon: Icon }) => {
              const href = value === 'all' ? '/blog' : `/blog?categorie=${encodeURIComponent(value)}`
              const active = activeCategory === value
              return (
                <Link
                  key={value}
                  href={href}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2.5 text-xs font-black transition ${
                    active ? 'bg-forge-red text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-forge-red'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </Link>
              )
            })}
          </nav>

          {visibleArticles.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleArticles.map((article, index) => (
                <ArticleCard key={article.slug} article={article} priority={index < 3} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
              <FileText className="mx-auto text-gray-400" size={36} />
              <h2 className="mt-4 text-lg font-black text-forge-dark">Aucun article trouve</h2>
              <p className="mt-2 text-sm text-gray-500">Essayez une autre recherche ou revenez a tous les articles.</p>
              <Link href="/blog" className="mt-5 inline-flex items-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white">
                Voir tous les articles <ArrowRight size={15} />
              </Link>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-forge-red text-sm font-black text-white">1</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-sm font-bold text-gray-400">2</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-sm font-bold text-gray-400">3</span>
            <Link href="/blog" className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-4 text-sm font-bold text-gray-600 hover:border-forge-red hover:text-forge-red">
              Suivant <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-forge-dark">Rechercher un article</h2>
            <form action="/blog" className="mt-4 flex overflow-hidden rounded-md border border-gray-200 bg-white">
              {activeCategory !== 'all' ? <input type="hidden" name="categorie" value={activeCategory} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Rechercher..."
                className="min-w-0 flex-1 px-4 py-3 text-sm outline-none placeholder:text-gray-400"
              />
              <button type="submit" className="flex w-12 items-center justify-center bg-forge-red text-white" aria-label="Rechercher">
                <Search size={16} />
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-forge-dark">Categories</h2>
            <div className="mt-4 space-y-1">
              {categories.map(({ label, value, icon: Icon }) => {
                const active = activeCategory === value
                const href = value === 'all' ? '/blog' : `/blog?categorie=${encodeURIComponent(value)}`
                return (
                  <Link
                    key={value}
                    href={href}
                    className={`flex items-center justify-between rounded-md px-2 py-3 text-sm font-bold transition ${
                      active ? 'text-forge-red' : 'text-gray-600 hover:bg-gray-50 hover:text-forge-red'
                    }`}
                  >
                    <span className="flex items-center gap-3"><Icon size={16} /> {label}</span>
                    <span>{getCategoryCount(value)}</span>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-forge-dark">Articles populaires</h2>
            <div className="mt-4 space-y-3">
              {popularArticles.map((article) => (
                <SidebarArticle key={article.slug} article={article} />
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-lg bg-[#111820] p-7 text-white shadow-sm">
            <Image src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=700&q=80" alt="Conseil personnalise TAFDIL" fill sizes="330px" className="object-cover opacity-20" />
            <div className="relative">
              <h2 className="text-xl font-black">Besoin d un conseil personnalise ?</h2>
              <p className="mt-3 text-sm leading-6 text-gray-200">Nos experts sont a votre ecoute pour vous accompagner dans vos projets.</p>
              <Link href="/devis" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white hover:bg-forge-red-dark">
                Demander un devis <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </aside>
      </section>

    </main>
  )
}
