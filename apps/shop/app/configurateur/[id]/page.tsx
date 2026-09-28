import type { Metadata } from 'next'
import { ConfigurateurClient } from './ConfigurateurClient'

export const metadata: Metadata = {
  title: 'Configurer votre produit | FORGE TAFDIL',
  description: 'Personnalisez votre produit TAFDIL (dimensions, finition, options) et obtenez une estimation immédiate.',
}

export default function ConfigurateurPage({ params }: { params: { id: string } }) {
  return (
    <main className="bg-gray-50">
      <ConfigurateurClient modeleId={params.id} />
    </main>
  )
}
