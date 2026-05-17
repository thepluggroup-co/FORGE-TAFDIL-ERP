import Link from 'next/link'
import { Search, ArrowLeft, MessageCircle } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-6 rounded-2xl bg-gray-50 p-6">
        <Search size={40} className="mx-auto text-gray-300" />
      </div>

      <span className="font-mono text-6xl font-black text-gray-100">404</span>
      <h1 className="mt-2 text-2xl font-black text-forge-dark">Page introuvable</h1>
      <p className="mt-2 max-w-sm text-sm text-forge-steel">
        Cette page n'existe pas ou a été déplacée. Vérifiez l'URL ou retournez à l'accueil.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-xl bg-forge-red px-5 py-3 text-sm font-bold text-white transition hover:bg-red-700"
        >
          <ArrowLeft size={15} /> Retour à l'accueil
        </Link>
        <Link
          href="/catalogue"
          className="flex items-center gap-2 rounded-xl border-2 border-forge-red px-5 py-3 text-sm font-bold text-forge-red transition hover:bg-forge-red hover:text-white"
        >
          Voir le catalogue
        </Link>
      </div>

      <a
        href={`https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '237958845').replace(/\D/g, '')}?text=Bonjour TAFDIL`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center gap-2 text-sm text-green-600 hover:underline"
      >
        <MessageCircle size={14} /> Besoin d'aide ? WhatsApp
      </a>
    </main>
  )
}
