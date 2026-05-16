import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'

const url = process.env.DATABASE_URL ?? 'file:forge.db'
const authToken = process.env.DATABASE_AUTH_TOKEN

const libsql = createClient({ url, authToken })

export const db = drizzle(libsql, { schema })
export type DB = typeof db
