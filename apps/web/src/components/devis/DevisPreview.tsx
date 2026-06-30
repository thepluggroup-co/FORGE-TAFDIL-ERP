import { FileText } from 'lucide-react'
import { formatDate, formatXAF } from '@/lib/utils'

const TVA_RATE = 0.1925

export interface DevisPreviewLine {
  id?: string | number
  designation: string
  quantite: number
  prix_unitaire_ht_xaf: number
  unite?: string | null
}

export interface DevisPreviewData {
  numero: string
  client_nom: string
  date_emission?: string | null
  date_validite?: string | null
  validite_jours?: number | null
  acompte_pct?: number | null
  condition_paiement?: string | null
  total_ht_xaf: number
  tva_xaf: number
  total_ttc_xaf: number
  notes?: string | null
  lignes: DevisPreviewLine[]
}

interface DevisPreviewProps {
  devis: DevisPreviewData
  compact?: boolean
}

function safeFormatDate(value?: string | null) {
  return value ? formatDate(value) : '-'
}

export function DevisPreview({ devis, compact = false }: DevisPreviewProps) {
  const acompte = devis.acompte_pct ?? 0
  const acompteXaf = Math.round((devis.total_ttc_xaf * acompte) / 100)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="bg-[#C62828] px-5 py-4 text-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-black text-[#C62828]">
              T
            </div>
            <div>
              <p className="text-lg font-black leading-tight">TAFDIL SARL</p>
              <p className="mt-1 text-xs text-white/80">Microusine Metallurgique et BTP - Douala, Cameroun</p>
              <p className="mt-1 text-[11px] text-white/70">NIU : M052116085624A | RCCM : RC/DLA/2021/B/2624</p>
              <p className="mt-1 text-[11px] text-white/70">+237 695 884 528 | info@tafdil.cm</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
              <FileText className="h-3.5 w-3.5" />
              Devis
            </div>
            <p className="mt-2 font-mono text-xl font-black">{devis.numero}</p>
            <p className="text-xs text-white/75">Emis le {safeFormatDate(devis.date_emission)}</p>
          </div>
        </div>
      </div>

      <div className={compact ? 'space-y-4 p-4' : 'space-y-5 p-5'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-[11px] font-bold uppercase text-gray-400">Client</p>
            <p className="mt-1 text-sm font-bold text-[#212121]">{devis.client_nom}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-[11px] font-bold uppercase text-gray-400">Validite</p>
            <p className="mt-1 text-sm font-semibold text-[#212121]">
              {safeFormatDate(devis.date_validite)}
              {devis.validite_jours ? ` (${devis.validite_jours} jours)` : ''}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase text-gray-500">
                <th className="px-3 py-2 text-left font-bold">Designation</th>
                <th className="px-3 py-2 text-right font-bold">Qte</th>
                <th className="px-3 py-2 text-right font-bold">P.U. HT</th>
                <th className="px-3 py-2 text-right font-bold">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {devis.lignes.map((ligne, index) => (
                <tr key={ligne.id ?? index} className="border-t border-gray-100">
                  <td className="px-3 py-2.5 text-[#212121]">{ligne.designation}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-gray-600">
                    {ligne.quantite} {ligne.unite ?? 'u.'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-gray-600">
                    {formatXAF(ligne.prix_unitaire_ht_xaf)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#212121]">
                    {formatXAF(ligne.quantite * ligne.prix_unitaire_ht_xaf)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_260px]">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
            <p className="font-bold uppercase text-gray-400">Conditions</p>
            <p className="mt-2">
              {acompte > 0
                ? `Acompte ${acompte}% a la commande (${formatXAF(acompteXaf)}). `
                : 'Acompte a confirmer. '}
              Reglement : {devis.condition_paiement ?? 'a confirmer'}.
            </p>
            {devis.notes ? <p className="mt-2 text-gray-500">{devis.notes}</p> : null}
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Total HT</span>
              <span className="font-semibold text-[#212121]">{formatXAF(devis.total_ht_xaf)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>TVA {(TVA_RATE * 100).toFixed(2)}%</span>
              <span>{formatXAF(devis.tva_xaf)}</span>
            </div>
            <div className="mt-2 flex justify-between rounded-lg bg-[#C62828] px-3 py-2 font-black text-white">
              <span>Total TTC</span>
              <span>{formatXAF(devis.total_ttc_xaf)}</span>
            </div>
          </div>
        </div>

        <p className="border-t border-gray-100 pt-3 text-center text-[11px] text-gray-400">
          TAFDIL SARL - Kotto Mairyvanas, Douala - Devis valable selon les conditions indiquees.
        </p>
      </div>
    </div>
  )
}
