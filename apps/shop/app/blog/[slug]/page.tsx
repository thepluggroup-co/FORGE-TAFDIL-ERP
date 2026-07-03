import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, Calendar, CheckCircle2, Clock, Link2, MessageCircle, UserCircle } from 'lucide-react'
import { blogArticles, getArticleBySlug } from '@/lib/blog'

interface Props {
  params: { slug: string }
}

export function generateStaticParams() {
  return blogArticles.map((article) => ({ slug: article.slug }))
}

export function generateMetadata({ params }: Props) {
  const article = getArticleBySlug(params.slug)
  if (!article) return {}
  return {
    title: `${article.title} | TAFDIL`,
    description: article.excerpt,
  }
}

export default function BlogArticlePage({ params }: Props) {
  const article = getArticleBySlug(params.slug)
  if (!article) notFound()

  const index = blogArticles.findIndex((item) => item.slug === article.slug)
  const previous = blogArticles[(index - 1 + blogArticles.length) % blogArticles.length]
  const next = blogArticles[(index + 1) % blogArticles.length]

  return (
    <main className="bg-white">
      <div className="border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 py-5 text-xs font-semibold text-gray-500 sm:px-6 lg:px-8">
          <Link href="/" className="hover:text-forge-red">Accueil</Link>
          <span className="mx-2">/</span>
          <Link href="/blog" className="hover:text-forge-red">Blog</Link>
          <span className="mx-2">/</span>
          <span className="text-forge-dark">{article.category}</span>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_330px] lg:px-8">
        <article>
          <p className="text-xs font-black uppercase tracking-widest text-forge-red">{article.category}</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight text-forge-dark sm:text-5xl">
            {article.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm font-semibold text-gray-500">
            <span className="flex items-center gap-1.5"><Calendar size={15} /> {article.date}</span>
            <span className="flex items-center gap-1.5"><Clock size={15} /> {article.readTime}</span>
            <span className="flex items-center gap-1.5"><UserCircle size={15} /> {article.author}</span>
          </div>

          <div className="relative mt-8 aspect-[2.05] overflow-hidden rounded-lg bg-gray-100">
            <Image src={article.image} alt={article.title} fill priority sizes="(max-width: 1024px) 100vw, 840px" className="object-cover" />
          </div>

          <div className="prose prose-gray mt-8 max-w-none">
            <p className="text-lg leading-8 text-gray-700">{article.excerpt}</p>
            {article.sections.map((section, sectionIndex) => (
              <section key={section.title} className="mt-8">
                <h2 className="text-2xl font-black text-forge-dark">
                  {sectionIndex + 1}. {section.title}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-7 text-gray-700">{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="mt-4 space-y-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3 text-sm leading-6 text-gray-700">
                        <CheckCircle2 className="mt-0.5 shrink-0 text-forge-red" size={16} />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {sectionIndex === 0 && article.expertTip && (
                  <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
                    <p className="font-black text-forge-dark">{article.expertTip.title}</p>
                    <p className="mt-2 text-sm leading-6 text-gray-600">{article.expertTip.text}</p>
                  </div>
                )}
              </section>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-5 border-y border-gray-200 py-5">
            <div className="flex flex-wrap gap-2">
              <span className="text-sm font-bold text-gray-500">Tags :</span>
              {article.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-gray-100 px-3 py-1 text-xs font-black text-gray-600">{tag}</span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-500">Partager :</span>
              <button className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:border-forge-red hover:text-forge-red" aria-label="Partager le lien">
                <Link2 size={16} />
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Link href={`/blog/${previous.slug}`} className="flex items-center gap-4 rounded-lg border border-gray-200 p-4 hover:border-forge-red">
              <ArrowLeft className="shrink-0 text-forge-red" size={18} />
              <span>
                <span className="block text-xs font-semibold text-gray-400">Article precedent</span>
                <span className="font-black text-forge-dark">{previous.title}</span>
              </span>
            </Link>
            <Link href={`/blog/${next.slug}`} className="flex items-center justify-end gap-4 rounded-lg border border-gray-200 p-4 text-right hover:border-forge-red">
              <span>
                <span className="block text-xs font-semibold text-gray-400">Article suivant</span>
                <span className="font-black text-forge-dark">{next.title}</span>
              </span>
              <ArrowRight className="shrink-0 text-forge-red" size={18} />
            </Link>
          </div>
        </article>

        <aside className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-forge-dark">Articles populaires</h2>
            <div className="mt-4 space-y-4">
              {blogArticles.map((item) => (
                <Link key={item.slug} href={`/blog/${item.slug}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-md p-2 hover:bg-gray-50">
                  <span className="relative h-16 overflow-hidden rounded-md bg-gray-100">
                    <Image src={item.image} alt={item.title} fill sizes="72px" className="object-cover" />
                  </span>
                  <span>
                    <span className="line-clamp-2 text-sm font-black leading-snug text-forge-dark">{item.title}</span>
                    <span className="mt-1 block text-xs text-gray-500">{item.date}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-lg bg-[#111820] p-6 text-white">
            <Image src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=700&q=80" alt="Livraison au Cameroun" fill sizes="330px" className="object-cover opacity-30" />
            <div className="relative">
              <h2 className="text-xl font-black">Livraison rapide partout au Cameroun</h2>
              <p className="mt-3 text-sm leading-6 text-gray-200">Vos materiaux livres rapidement et en toute securite.</p>
              <Link href="/catalogue" className="mt-5 inline-flex items-center gap-2 rounded-md bg-forge-red px-4 py-2 text-sm font-black text-white">
                En savoir plus <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-forge-dark">Categories</h2>
            <div className="mt-4 space-y-3">
              {[
                ['Tous les articles', '/blog'],
                ['Conseils', '/blog?categorie=Conseils'],
                ['Guides pratiques', '/blog?categorie=Guide'],
                ['Actualites', '/blog?categorie=Actualites'],
                ['Tendances', '/blog?categorie=Tendances'],
              ].map(([item, href], itemIndex) => (
                <Link key={item} href={href} className="flex items-center justify-between text-sm font-bold text-gray-600 hover:text-forge-red">
                  {item}
                  <span>{[blogArticles.length, 2, 2, 2, 1][itemIndex]}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-forge-red p-6 text-white">
            <h2 className="text-xl font-black">Besoin d un devis personnalise ?</h2>
            <p className="mt-3 text-sm leading-6 text-white/85">Decrivez votre projet et recevez une offre sous 24h.</p>
            <Link href="/devis" className="mt-5 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-black text-forge-red">
              <MessageCircle size={15} /> Demander un devis
            </Link>
          </div>
        </aside>
      </div>
    </main>
  )
}
