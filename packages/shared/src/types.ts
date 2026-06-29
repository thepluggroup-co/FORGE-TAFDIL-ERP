import { z } from 'zod'

// --- Core domain types for FORGE ERP ---

export const UserRoleSchema = z.enum(['admin', 'superviseur', 'operateur', 'technicien'])
export type UserRole = z.infer<typeof UserRoleSchema>

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

export const ProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().optional(),
  unit: z.string(),
  priceXAF: z.number().positive(),
  stock: z.number().int().min(0),
  category: z.string(),
})
export type Product = z.infer<typeof ProductSchema>

export const OrderStatusSchema = z.enum(['draft', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

export const OrderSchema = z.object({
  id: z.string().uuid(),
  clientName: z.string(),
  clientPhone: z.string().optional(),
  status: OrderStatusSchema,
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    unitPriceXAF: z.number().positive(),
  })),
  totalXAF: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Order = z.infer<typeof OrderSchema>

export type ApiResponse<T> = {
  success: true
  data: T
} | {
  success: false
  error: string
  code?: string
}
