import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { createId } from '@paralleldrive/cuid2'

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'operator', 'viewer'] }).notNull().default('operator'),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const products = sqliteTable('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  unit: text('unit').notNull().default('pcs'),
  priceXAF: real('price_xaf').notNull(),
  stock: integer('stock').notNull().default(0),
  category: text('category').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientName: text('client_name').notNull(),
  clientPhone: text('client_phone'),
  status: text('status', {
    enum: ['draft', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled'],
  }).notNull().default('draft'),
  totalXAF: real('total_xaf').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => orders.id),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: real('quantity').notNull(),
  unitPriceXAF: real('unit_price_xaf').notNull(),
})

export const productionJobs = sqliteTable('production_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').references(() => orders.id),
  description: text('description').notNull(),
  status: text('status', { enum: ['pending', 'active', 'paused', 'done'] }).notNull().default('pending'),
  assignedTo: text('assigned_to').references(() => users.id),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
