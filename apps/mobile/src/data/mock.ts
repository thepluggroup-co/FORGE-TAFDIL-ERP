import type { Order, Product } from '@forge/shared'

export const mockProducts: Product[] = [
  {
    id: '11111111-0000-0000-0000-000000000001',
    sku: 'TFD-001',
    name: 'Tissu Bazin Riche',
    description: 'Bazin riche 100% coton, 5m',
    unit: 'rouleau',
    priceXAF: 45000,
    stock: 120,
    category: 'Tissu',
  },
  {
    id: '11111111-0000-0000-0000-000000000002',
    sku: 'TFD-002',
    name: 'Tissu Kente',
    description: 'Kente artisanal, motifs traditionnels',
    unit: 'mètre',
    priceXAF: 8500,
    stock: 340,
    category: 'Tissu',
  },
  {
    id: '11111111-0000-0000-0000-000000000003',
    sku: 'TFD-003',
    name: 'Broderie Personnalisée',
    description: 'Service de broderie sur commande',
    unit: 'pièce',
    priceXAF: 15000,
    stock: 0,
    category: 'Service',
  },
  {
    id: '11111111-0000-0000-0000-000000000004',
    sku: 'TFD-004',
    name: 'Boubou Grand Modèle',
    description: 'Boubou 3 pièces sur mesure',
    unit: 'set',
    priceXAF: 85000,
    stock: 24,
    category: 'Vêtement',
  },
  {
    id: '11111111-0000-0000-0000-000000000005',
    sku: 'TFD-005',
    name: 'Fil à Broder Premium',
    description: 'Fil polyester brillant 200m',
    unit: 'bobine',
    priceXAF: 2500,
    stock: 6,
    category: 'Fourniture',
  },
]

export const mockOrders: Order[] = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    clientName: 'Mme Adjoua Koffi',
    clientPhone: '+237 699 001 122',
    status: 'delivered',
    items: [{ productId: '11111111-0000-0000-0000-000000000004', quantity: 2, unitPriceXAF: 85000 }],
    totalXAF: 170000,
    createdAt: '2026-05-28T09:00:00.000Z',
    updatedAt: '2026-05-30T14:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    clientName: 'M. Ibrahim Diallo',
    clientPhone: '+237 677 234 567',
    status: 'in_production',
    items: [
      { productId: '11111111-0000-0000-0000-000000000001', quantity: 3, unitPriceXAF: 45000 },
      { productId: '11111111-0000-0000-0000-000000000003', quantity: 1, unitPriceXAF: 15000 },
    ],
    totalXAF: 150000,
    createdAt: '2026-05-29T11:30:00.000Z',
    updatedAt: '2026-05-30T08:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
    clientName: 'Boutique Élégance',
    clientPhone: '+237 655 789 012',
    status: 'confirmed',
    items: [{ productId: '11111111-0000-0000-0000-000000000002', quantity: 20, unitPriceXAF: 8500 }],
    totalXAF: 170000,
    createdAt: '2026-05-30T08:15:00.000Z',
    updatedAt: '2026-05-30T08:15:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000004',
    clientName: 'M. Paul Nkomo',
    status: 'draft',
    items: [{ productId: '11111111-0000-0000-0000-000000000004', quantity: 1, unitPriceXAF: 85000 }],
    totalXAF: 85000,
    createdAt: '2026-05-31T07:00:00.000Z',
    updatedAt: '2026-05-31T07:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000005',
    clientName: 'Mme Fatou Sow',
    clientPhone: '+237 690 345 678',
    status: 'shipped',
    items: [
      { productId: '11111111-0000-0000-0000-000000000001', quantity: 1, unitPriceXAF: 45000 },
      { productId: '11111111-0000-0000-0000-000000000003', quantity: 2, unitPriceXAF: 15000 },
    ],
    totalXAF: 75000,
    createdAt: '2026-05-27T14:00:00.000Z',
    updatedAt: '2026-05-29T16:00:00.000Z',
  },
]

export function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}
