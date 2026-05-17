import type { Metadata } from 'next'
import { PanierClient } from './PanierClient'

export const metadata: Metadata = {
  title: 'Mon Panier | FORGE TAFDIL',
}

export default function PanierPage() {
  return <PanierClient />
}
