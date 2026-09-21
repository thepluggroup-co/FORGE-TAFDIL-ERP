import type { Metadata } from 'next'
import { CheckoutClient } from './CheckoutClient'

export const metadata: Metadata = {
  title: 'Commander | FORGE TAFDIL',
  robots: { index: false, follow: false },
}

export default function CommanderPage() {
  return <CheckoutClient />
}
