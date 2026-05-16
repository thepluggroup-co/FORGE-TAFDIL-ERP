import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema:  './src/schema.ts',
  out:     './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:forge-local.db',
  },
  verbose: true,
  strict:  true,
})
