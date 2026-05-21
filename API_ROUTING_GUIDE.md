# FORGE ERP API - Complete Routing Guide

## Server Configuration
- **API Server Port:** 3001
- **Frontend Port:** 5173
- **Server Framework:** Hono (Ultra-lightweight Node.js framework)

---

## Public Routes (No Authentication Required)

### Health Check
```
GET /health
```
Returns:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "app": "FORGE ERP API",
  "company": "TAFDIL",
  "timestamp": "2026-05-21T..."
}
```

### Public Commerce
```
GET / 
POST /
```
Public commandes endpoints (e.g., shop orders)

### Shop (Public)
```
GET /api/shop
POST /api/shop
```
Public shop endpoints

### Payments (Public)
```
GET /api/paiements
POST /api/paiements
```
Public payment endpoints

---

## Protected Routes (Authentication Required)

All `/api/*` routes require a valid `Authorization: Bearer <token>` header.

### Stocks Management (`/api/stocks`)
```
GET    /api/stocks              - List all stocks
POST   /api/stocks              - Create new stock
GET    /api/stocks/:id          - Get stock details
PUT    /api/stocks/:id          - Update stock
DELETE /api/stocks/:id          - Delete stock
GET    /api/stocks/search/:term - Search stocks
```

### Bons (Delivery Notes) (`/api/bons`)
```
GET    /api/bons                - List all bons
POST   /api/bons                - Create new bon
GET    /api/bons/:id            - Get bon details
PUT    /api/bons/:id            - Update bon
DELETE /api/bons/:id            - Delete bon
GET    /api/bons/status/:status - Filter by status
```

### Commerce (`/api`)
```
GET    /api/commandes           - List orders
POST   /api/commandes           - Create order
GET    /api/commandes/:id       - Get order details
PUT    /api/commandes/:id       - Update order
DELETE /api/commandes/:id       - Cancel order
GET    /api/commandes/export    - Export orders
```

### Finance (`/api`)
```
GET    /api/factures            - List invoices
POST   /api/factures            - Create invoice
GET    /api/factures/:id        - Get invoice details
PUT    /api/factures/:id        - Update invoice
GET    /api/rapports/finance    - Financial reports
GET    /api/devis                - List quotes
POST   /api/devis                - Create quote
```

### Human Resources (`/api`)
```
GET    /api/employes            - List employees
POST   /api/employes            - Create employee
GET    /api/employes/:id        - Get employee details
PUT    /api/employes/:id        - Update employee
DELETE /api/employes/:id        - Remove employee
GET    /api/paies                - List salaries
POST   /api/paies                - Create salary record
```

### AI Assistant (`/api`)
```
POST   /api/ai/analyze          - Analyze data with AI
POST   /api/ai/generate         - Generate suggestions
GET    /api/ai/history          - Get AI conversation history
POST   /api/ai/chat             - Chat with AI assistant
```

### Reports (`/api/rapports`)
```
GET    /api/rapports            - List all reports
GET    /api/rapports/ventes     - Sales reports
GET    /api/rapports/stocks     - Stock reports
GET    /api/rapports/finance    - Finance reports
GET    /api/rapports/:type/export - Export report
```

### Shop ERP Integration (`/api/shop-erp`)
```
GET    /api/shop-erp/products   - Sync products
POST   /api/shop-erp/products   - Create product
GET    /api/shop-erp/orders     - Sync shop orders
POST   /api/shop-erp/sync       - Full sync
```

### Operations (`/api`)
```
GET    /api/operations          - List operations
POST   /api/operations          - Create operation
GET    /api/operations/:id      - Get operation details
PUT    /api/operations/:id      - Update operation
DELETE /api/operations/:id      - Delete operation
```

---

## Middleware Stack

All requests pass through this middleware chain:

1. **Logger** - Logs all HTTP requests
2. **CORS** - Handles cross-origin requests
   - Allowed origins: `localhost:5173`, `localhost:4173`, `localhost:3000`, `localhost:3002`
   - Credentials enabled
   - Max age: 24 hours
3. **Rate Limiting** - Prevents abuse
4. **Authentication** - Validates JWT token (protected routes only)
5. **Audit** - Logs all modifications (protected routes only)
6. **RBAC** - Role-based access control (protected routes only)

---

## Error Handling

### 404 Not Found
```json
{
  "error": "Route GET /api/invalid introuvable",
  "code": "NOT_FOUND"
}
```

### 401 Unauthorized
```json
{
  "error": "Token invalide ou expiré",
  "code": "UNAUTHORIZED"
}
```

### 403 Forbidden
```json
{
  "error": "Accès refusé — droits insuffisants",
  "code": "FORBIDDEN"
}
```

### 429 Too Many Requests
```json
{
  "error": "Trop de requêtes. Réessayez plus tard.",
  "code": "RATE_LIMITED"
}
```

### 500 Server Error
```json
{
  "error": "Erreur serveur interne",
  "code": "INTERNAL_ERROR",
  "details": "..." // Only in development
}
```

---

## Authentication

### How to Authenticate

1. **Get Session from Supabase**
   ```typescript
   const { data: { session } } = await supabase.auth.getSession()
   ```

2. **Use Bearer Token in Headers**
   ```
   Authorization: Bearer {session.access_token}
   ```

3. **API Client Handles This Automatically**
   ```typescript
   import { api } from '@/lib/api-client'
   const data = await api.get('/api/stocks')
   ```

---

## Testing Connection

### Via Browser Console
```javascript
// Test health endpoint
fetch('http://localhost:3001/health')
  .then(r => r.json())
  .then(console.log)

// Test with authentication
const token = (await supabase.auth.getSession()).data.session.access_token
fetch('http://localhost:3001/api/stocks', {
  headers: { 'Authorization': `Bearer ${token}` }
})
  .then(r => r.json())
  .then(console.log)
```

### Via cURL
```bash
# Health check
curl http://localhost:3001/health

# Protected route (replace TOKEN with actual JWT)
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/api/stocks
```

---

## Environment Variables

```env
# .env
PORT=3001
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_JWT_SECRET=your_jwt_secret

# Frontend
FRONTEND_URL=http://localhost:5173,http://localhost:4173

# Rate Limiting
RATE_LIMIT_WINDOW=60000    # 1 minute
RATE_LIMIT_MAX_REQUESTS=100

# Tauri (Desktop App)
TAURI_URL=https://tauri.localhost
```

---

## Common Issues

### 404: Route Not Found
- Check the exact path (case-sensitive)
- Ensure route starts with `/api` for protected routes
- Verify the method (GET, POST, etc.)

### 401: Unauthorized
- Supabase session may have expired
- Use `supabase.auth.getSession()` to refresh
- Check JWT token in header

### CORS Error
- Frontend origin must be in ALLOWED_ORIGINS
- In development, `localhost` on any port is allowed
- Check `vite.config.ts` proxy configuration

### 500: Server Error
- Check API console for error details
- Enable development logging in `.env`
- Verify database connection

---

## Quick API Test

Add this to your page to test the connection:

```tsx
import { useEffect, useState } from 'react'

export function APITest() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('http://localhost:3001/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(e => {
        console.error('[v0] API Error:', e)
        setError(e.message)
      })
  }, [])

  if (error) return <div>Error: {error}</div>
  if (!health) return <div>Loading...</div>
  
  return (
    <div>
      <h2>API Status: {health.status}</h2>
      <p>App: {health.app}</p>
      <p>Version: {health.version}</p>
    </div>
  )
}
```

---

## File Structure

```
apps/api/src/
├── app.ts                 # Main Hono app with routing
├── index.ts              # Server entry point
├── types.ts              # TypeScript types
├── middleware/
│   ├── auth.ts          # JWT authentication
│   ├── audit.ts         # Audit logging
│   ├── rateLimit.ts     # Rate limiting
│   └── rbac.ts          # Role-based access control
└── routes/
    ├── stocks.ts        # Stock management
    ├── bons.ts          # Delivery notes
    ├── commerce.ts      # Orders and commerce
    ├── finance.ts       # Invoices and finance
    ├── rh.ts            # Human resources
    ├── ai.ts            # AI assistant
    ├── rapports.ts      # Reports
    ├── shop.ts          # Shop integration
    ├── paiements.ts     # Payments
    └── operations.ts    # Operations
```

---

## Next Steps

1. **Start API Server:** `pnpm dev --filter @forge/api`
2. **Start Frontend:** `pnpm dev --filter @forge/web`
3. **Test Health:** `curl http://localhost:3001/health`
4. **Login:** Access frontend at `http://localhost:5173`
5. **Monitor:** Check browser console for `[v0]` logs
