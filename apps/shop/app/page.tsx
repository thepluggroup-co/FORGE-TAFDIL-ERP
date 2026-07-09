import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  BadgePercent,
  ChevronRight,
  Clock,
  Eye,
  Heart,
  Headphones,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingCart,
  Star,
  Truck,
  Wrench,
} from 'lucide-react'
import { fetchCatalogueProduits } from '@/lib/catalogue'
import type { Produit } from '@/lib/types'
import { blogArticles } from '@/lib/blog'

export const revalidate = 60

const fallbackCategories = [
  { name: 'Aluminium', description: 'Profils, portes, fenetres et accessoires', image: 'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=600&q=80' },
  { name: 'Ferronnerie', description: 'Portails, grilles, escaliers et structures', image: 'https://images.unsplash.com/photo-1600607686527-6fb886090705?auto=format&fit=crop&w=600&q=80' },
  { name: 'Construction metallique', description: 'Charpentes, hangars et mezzanines', image: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=600&q=80' },
  { name: 'Outils & Accessoires', description: 'Machines, outils et equipements', image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80' },
  { name: 'Fixations', description: 'Visserie, boulonnerie et fixations', image: 'https://images.unsplash.com/photo-1586864387789-628af9feed72?auto=format&fit=crop&w=600&q=80' },
]

const sideCategories = [
  'Aluminium',
  'Ferronnerie',
  'Construction metallique',
  'Outils & Accessoires',
  'Assemblage & Fixation',
  'Protection & Securite',
  'Formations professionnelles',
  'Promotions',
]

const productFallbackImages = [
  'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=700&q=80',
]

function formatXAF(value: number | null | undefined) {
  if (!value) return 'Prix sur devis'
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(value)
}

function buildCategoryCards(produits: Produit[]) {
  const unique = [...new Set(produits.map((p) => p.categorie).filter(Boolean))]
  if (unique.length === 0) return fallbackCategories

  return unique.slice(0, 5).map((name, index) => {
    const firstProduct = produits.find((p) => p.categorie === name)
    return {
      name,
      description: firstProduct?.description_longue?.slice(0, 72) || fallbackCategories[index % fallbackCategories.length].description,
      image: firstProduct?.images?.[0] || fallbackCategories[index % fallbackCategories.length].image,
    }
  })
}

function ProductTile({ produit, index }: { produit: Produit; index: number }) {
  const image = produit.images?.[0] || productFallbackImages[index % productFallbackImages.length]
  const status = produit.disponibilite === 'stock_faible' ? 'Stock faible' : produit.disponibilite === 'indisponible' ? 'Sur commande' : 'Disponible'
  const hasPromo = Boolean(produit.promotion && produit.prix_barre_xaf && produit.prix_public)

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <Link href={`/catalogue/${produit.id}`} className="relative block aspect-[1.25] bg-gray-100">
        <Image src={image} alt={produit.nom} fill sizes="(max-width: 768px) 50vw, 20vw" className="object-cover" />
        <span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[10px] font-black uppercase ${produit.disponibilite === 'stock_faible' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {status}
        </span>
        {hasPromo && <span className="absolute right-3 top-3 rounded-full bg-forge-red px-2 py-1 text-[10px] font-black uppercase text-white">Promo</span>}
      </Link>
      <div className="p-4">
        <p className="font-mono text-[10px] uppercase text-gray-400">{produit.ref}</p>
        <Link href={`/catalogue/${produit.id}`} className="mt-1 block min-h-10 text-sm font-black leading-tight text-forge-dark hover:text-forge-red">
          {produit.nom}
        </Link>
        {hasPromo && <p className="mt-2 text-xs font-bold text-gray-400 line-through">{formatXAF(produit.prix_barre_xaf)}</p>}
        <p className={`${hasPromo ? 'mt-0.5' : 'mt-2'} text-base font-black text-forge-red`}>
          {formatXAF(produit.prix_public)}
          {produit.prix_public ? <span className="text-xs font-semibold text-gray-500"> / {produit.unite}</span> : null}
        </p>
        {produit.promotion && <p className="mt-1 text-[10px] font-black uppercase text-forge-red">{produit.promotion.nom}</p>}
      </div>
      <div className="grid grid-cols-3 border-t border-gray-100 text-gray-400">
        <Link href={`/catalogue/${produit.id}`} className="flex h-10 items-center justify-center hover:text-forge-red" aria-label="Voir le produit">
          <ShoppingCart size={15} />
        </Link>
        <Link href={`/catalogue/${produit.id}`} className="flex h-10 items-center justify-center border-x border-gray-100 hover:text-forge-red" aria-label="Ajouter aux favoris">
          <Heart size={15} />
        </Link>
        <Link href={`/catalogue/${produit.id}`} className="flex h-10 items-center justify-center hover:text-forge-red" aria-label="Apercu du produit">
          <Eye size={15} />
        </Link>
      </div>
    </article>
  )
}

export default async function HomePage() {
  const produits = await fetchCatalogueProduits()
  const visibleProducts = produits.slice(0, 10)
  const promoProducts = produits.filter((p) => p.promotion).slice(0, 5)
  const categories = buildCategoryCards(produits)

  return (
    <main className="bg-white">
      <section className="relative overflow-hidden bg-[#101418]">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1800&q=85"
            alt="Soudure industrielle MetalForge"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/20" />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
          <aside className="hidden overflow-hidden rounded-lg bg-white shadow-xl lg:block">
            <div className="flex items-center gap-2 bg-forge-red px-5 py-4 text-sm font-black text-white">
              <Search size={16} />
              Toutes les categories
            </div>
            <nav className="p-2">
              {sideCategories.map((category) => (
                <Link key={category} href={`/catalogue?categorie=${encodeURIComponent(category)}`} className="flex items-center justify-between rounded-md px-4 py-3 text-sm font-semibold text-forge-dark hover:bg-forge-red-light hover:text-forge-red">
                  {category}
                  <ChevronRight size={14} />
                </Link>
              ))}
            </nav>
          </aside>

          <div className="min-h-[430px] py-10 text-white lg:py-14">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-wider">
              <span>Qualite</span>
              <span className="h-1 w-1 rounded-full bg-forge-red" />
              <span>Solidite</span>
              <span className="h-1 w-1 rounded-full bg-forge-red" />
              <span>Performance</span>
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">
              Des materiaux solides pour des <span className="text-forge-red">projets durables</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-gray-200">
              Fournitures industrielles et metalliques de qualite au meilleur prix. Livraison rapide partout au Cameroun.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/catalogue" className="inline-flex items-center gap-2 rounded-lg bg-forge-red px-6 py-3 text-sm font-black text-white shadow-lg shadow-red-950/30 hover:bg-forge-red-dark">
                Voir le catalogue <ArrowRight size={16} />
              </Link>
              <Link href="/devis" className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/5 px-6 py-3 text-sm font-black text-white backdrop-blur hover:bg-white/10">
                Demander un devis
              </Link>
            </div>

            <div className="mt-10 grid gap-3 rounded-lg border border-white/10 bg-white/10 p-3 backdrop-blur md:grid-cols-4">
              {[
                { icon: PackageCheck, title: 'Produits de qualite', text: 'Certifies et garantis' },
                { icon: Truck, title: 'Livraison rapide', text: 'Partout au Cameroun' },
                { icon: ShieldCheck, title: 'Paiement securise', text: '100% securise' },
                { icon: Headphones, title: 'Support client', text: 'Lun - Sam: 7h30 - 18h' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex items-center gap-3 rounded-md px-2 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                    <Icon size={18} />
                  </span>
                  <span>
                    <span className="block text-sm font-black">{title}</span>
                    <span className="text-xs text-gray-300">{text}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {categories.map((category) => (
            <Link key={category.name} href={`/catalogue?categorie=${encodeURIComponent(category.name)}`} className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              <div className="relative h-24 bg-gray-100">
                <Image src={category.image} alt={category.name} fill sizes="200px" className="object-cover transition group-hover:scale-105" />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-black text-forge-dark">{category.name}</h2>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 group-hover:bg-forge-red group-hover:text-white">
                    <ArrowRight size={13} />
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-5 text-gray-500">{category.description}</p>
              </div>
            </Link>
          ))}
          <Link href="/catalogue" className="flex min-h-[172px] flex-col justify-between rounded-lg bg-forge-red p-5 text-white shadow-lg shadow-red-100">
            <BadgePercent size={36} />
            <div>
              <h2 className="text-lg font-black">Promotions</h2>
              <p className="mt-2 text-xs leading-5 text-white/85">Offres speciales du moment</p>
            </div>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-forge-red">{promoProducts.length > 0 ? 'Promotions actives' : 'Produits populaires'}</p>
            <h2 className="mt-2 text-2xl font-black text-forge-dark">{promoProducts.length > 0 ? 'Offres du moment' : 'Nos meilleures offres'}</h2>
          </div>
          <Link href="/catalogue" className="hidden items-center gap-2 text-sm font-black text-forge-dark hover:text-forge-red sm:inline-flex">
            Voir tout le catalogue <ArrowRight size={15} />
          </Link>
        </div>
        {visibleProducts.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {(promoProducts.length > 0 ? promoProducts : visibleProducts.slice(0, 5)).map((produit, index) => <ProductTile key={produit.id} produit={produit} index={index} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm font-semibold text-gray-500">
            Aucun produit visible pour le moment. Le catalogue s affichera automatiquement quand des produits seront publies.
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-lg bg-[#111820] px-8 py-8 text-white">
          <Image src="https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1400&q=80" alt="Offres MetalForge" fill sizes="100vw" className="object-cover opacity-25" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black text-forge-red">jusqu a</p>
              <h2 className="text-4xl font-black">Offres exclusives <span className="text-forge-red">-20%</span></h2>
              <p className="mt-3 max-w-lg text-sm text-gray-300">Sur une selection de produits de qualite professionnelle.</p>
            </div>
            <Link href="/catalogue" className="inline-flex w-fit items-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white hover:bg-forge-red-dark">
              Decouvrir les promotions <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['10+', 'Annees d experience'],
            ['500+', 'Projets realises'],
            ['200+', 'Clients satisfaits'],
            ['15', 'Techniciens qualifies'],
            ['100%', 'Satisfaction garantie'],
          ].map(([value, label]) => (
            <div key={label} className="flex items-center gap-3">
              <Star className="text-forge-red" size={24} />
              <div>
                <p className="text-2xl font-black text-forge-dark">{value}</p>
                <p className="text-xs font-semibold text-gray-500">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 sm:px-6 lg:grid-cols-[1fr_320px] lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-forge-red">Ils nous font confiance</p>
          <h2 className="mt-2 text-2xl font-black text-forge-dark">Avis de nos clients</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {['Excellent service et materiaux de tres bonne qualite. Livraison rapide et equipe professionnelle.', 'J ai trouve tout ce qu il me fallait pour mon chantier a un prix imbattable.', 'La qualite des profils aluminium est irreprochable. MetalForge est devenu mon fournisseur principal.'].map((text, index) => (
              <article key={text} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex gap-1 text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
                <p className="text-sm leading-6 text-gray-700">{text}</p>
                <p className="mt-5 text-sm font-black text-forge-dark">{['Jean-Pierre M.', 'David K.', 'Patrick A.'][index]}</p>
              </article>
            ))}
          </div>
        </div>
        <aside className="rounded-lg bg-[#111820] p-7 text-white">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Besoin d un devis ?</p>
          <h2 className="mt-2 text-2xl font-black">Parlons de votre projet</h2>
          <p className="mt-3 text-sm leading-6 text-gray-300">Obtenez une reponse rapide et personnalisee sous 24h.</p>
          <Link href="/devis" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white hover:bg-forge-red-dark">
            Demander un devis gratuit <ArrowRight size={15} />
          </Link>
          <div className="mt-5 space-y-2 text-sm text-gray-300">
            <p className="flex items-center gap-2"><Clock size={14} /> Reponse sous 24h</p>
            <p className="flex items-center gap-2"><ShieldCheck size={14} /> Sans engagement</p>
          </div>
        </aside>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <p className="text-xs font-black uppercase tracking-widest text-forge-red">Conseils & actualites</p>
        <h2 className="mt-2 text-2xl font-black text-forge-dark">Nos derniers articles</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {blogArticles.slice(0, 3).map((article) => (
            <article key={article.slug} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              <Link href={`/blog/${article.slug}`} className="relative block h-40">
                <Image src={article.image} alt={article.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                <span className="absolute bottom-3 left-3 rounded-md bg-white px-3 py-1 text-xs font-black text-forge-dark">{article.category}</span>
              </Link>
              <div className="p-5">
                <p className="text-xs font-semibold text-gray-400">{article.date}</p>
                <Link href={`/blog/${article.slug}`} className="mt-2 block text-base font-black leading-snug text-forge-dark hover:text-forge-red">
                  {article.title}
                </Link>
                <Link href={`/blog/${article.slug}`} className="mt-4 inline-flex items-center gap-2 text-sm font-black text-forge-red">
                  Lire l article <ArrowRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
