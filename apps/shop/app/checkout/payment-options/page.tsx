import { redirect } from 'next/navigation'

// Cette page était orpheline (jamais atteinte depuis le tunnel) et utilisait
// un format d'API incompatible. Le paiement fractionné est désormais intégré
// dans /commander (CheckoutClient, étape 3).
export default function PaymentOptionsPage() {
  redirect('/commander')
}
