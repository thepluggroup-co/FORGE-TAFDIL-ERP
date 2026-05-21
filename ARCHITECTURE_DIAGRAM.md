# Frontend-Backend Connection Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Frontend)                       │
│  http://localhost:5173                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ React App (apps/web)                                       │ │
│  │ ├─ Pages                                                   │ │
│  │ ├─ Components (APIHealthCheck)                             │ │
│  │ └─ API Client (lib/api-client.ts)                          │ │
│  │    ├─ VITE_API_URL = http://localhost:3001                 │ │
│  │    ├─ getAuthHeaders()  → Supabase JWT                     │ │
│  │    └─ request<T>()      → Fetch with auth                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↕                                    │
│                     (HTTP/CORS Requests)                          │
│                              ↕                                    │
└─────────────────────────────────────────────────────────────────┘
                                ↓
          ┌────────────────────────────────────────┐
          │     VITE DEV SERVER (Port 5173)       │
          │  ├─ Hot Module Reload (HMR)           │
          │  ├─ CORS Proxy (/api → :3001)         │
          │  └─ Serve React Bundle                │
          └────────────────────────────────────────┘
                                ↓
          ┌────────────────────────────────────────┐
          │  Network Request to Backend             │
          │  Method: GET/POST/PUT/DELETE/PATCH     │
          │  URL: http://localhost:3001/api/...    │
          │  Headers: Authorization: Bearer {JWT}  │
          └────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                   NODE.JS SERVER (API Backend)                  │
│  http://localhost:3001                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Hono Framework (apps/api)                                  │ │
│  │                                                            │ │
│  │ ┌─ Middleware Stack                                       │ │
│  │ │  1. Logger          → Log all requests                  │ │
│  │ │  2. CORS            → Allow localhost:5173              │ │
│  │ │  3. Rate Limit      → Prevent abuse                     │ │
│  │ │  4. Auth            → Validate JWT                      │ │
│  │ │  5. Audit           → Log modifications                 │ │
│  │ │  6. RBAC            → Check permissions                 │ │
│  │ └─────────────────────────────────────────               │ │
│  │                                                            │ │
│  │ ┌─ Routes                                                 │ │
│  │ │  /health            → Health check (public)             │ │
│  │ │  /api/stocks        → Stock management (protected)      │ │
│  │ │  /api/bons          → Delivery notes (protected)        │ │
│  │ │  /api/commandes     → Orders (protected)                │ │
│  │ │  /api/factures      → Invoices (protected)              │ │
│  │ │  /api/employes      → Employees (protected)             │ │
│  │ │  /api/ai            → AI Assistant (protected)          │ │
│  │ │  /api/rapports      → Reports (protected)               │ │
│  │ │  ... (more routes)                                      │ │
│  │ └─────────────────────────────────────────               │ │
│  │                                                            │ │
│  │ ┌─ Database Layer                                         │ │
│  │ │  Supabase PostgreSQL                                    │ │
│  │ │  ├─ Tables: stocks, bons, commandes, etc.               │ │
│  │ │  └─ Auth: JWT validation                                │ │
│  │ └─────────────────────────────────────────               │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Diagram

### Example: Get Stocks

```
┌─────────────────────────────────────────────────────────────┐
│  1. Frontend Component makes request                         │
│                                                              │
│  import { api } from '@/lib/api-client'                      │
│  const stocks = await api.get('/api/stocks')                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. API Client builds request                                │
│                                                              │
│  - Fetch session from Supabase                               │
│  - Get JWT access_token                                      │
│  - Build headers with Bearer token                           │
│  - Log request with [v0] prefix                              │
│  - Make HTTP GET to http://localhost:3001/api/stocks         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Vite DevServer receives request                          │
│                                                              │
│  - Matches /api/* pattern in proxy config                    │
│  - Forwards to http://localhost:3001/api/stocks              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Hono Backend receives request                            │
│                                                              │
│  GET /api/stocks                                             │
│  Headers: Authorization: Bearer eyJ...                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Middleware pipeline processes request                    │
│                                                              │
│  ✓ Logger:    Log request details                            │
│  ✓ CORS:      Allow localhost:5173 → Pass through           │
│  ✓ RateLimit: Check if under limit → Pass through           │
│  ✓ Auth:      Validate JWT → Extract user ID                │
│  ✓ Audit:     Log who accessed what                          │
│  ✓ RBAC:      Check if user can view stocks → Pass through   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  6. Route handler executes                                   │
│                                                              │
│  - Query Supabase: SELECT * FROM stocks WHERE user_id = ?    │
│  - Format response as JSON                                   │
│  - Return 200 OK with data                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  7. Response travels back through middleware                 │
│                                                              │
│  ✓ Logger:    Log response status                            │
│  ✓ CORS:      Add CORS headers to response                   │
│  - Remaining middleware: Already passed                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  8. Response reaches Vite proxy                              │
│                                                              │
│  200 OK                                                      │
│  Content-Type: application/json                              │
│  Access-Control-Allow-Origin: http://localhost:5173          │
│  Body: { data: [...stocks] }                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  9. Response reaches Frontend                                │
│                                                              │
│  - API Client logs response with [v0] prefix                 │
│  - Parse JSON response                                       │
│  - Return typed data: Promise<Stock[]>                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  10. Component receives data                                 │
│                                                              │
│  const stocks = await api.get('/api/stocks')                 │
│  // stocks is now loaded with data                           │
│  // Component re-renders with new data                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration Files

### 1. Frontend Configuration (apps/web/.env)
```env
VITE_API_URL=http://localhost:3001
```
Used by Vite to build the app and by the API client to know where the backend is.

### 2. Backend Configuration (apps/api/.env)
```env
PORT=3001
NODE_ENV=development
SUPABASE_JWT_SECRET=your_jwt_secret_here
FRONTEND_URL=http://localhost:5173,http://localhost:4173
```
API server configuration.

### 3. Root Configuration (.env)
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_JWT_SECRET=your_jwt_secret
```
Shared across the monorepo.

---

## Key Files

### Frontend API Client
**File:** `apps/web/src/lib/api-client.ts`

Handles all HTTP communication:
- Retrieves JWT from Supabase session
- Builds request with Bearer token
- Logs all requests/responses with `[v0]` prefix
- Handles errors and redirects

### Backend App Configuration
**File:** `apps/api/src/app.ts`

Hono app with:
- Middleware stack (CORS, Auth, RateLimit, etc.)
- Route registrations (/api/stocks, /api/bons, etc.)
- Error handling
- 404 handling

### Backend Server
**File:** `apps/api/src/index.ts`

Node.js HTTP server:
- Runs on port 3001
- Serves the Hono app

### Vite Configuration
**File:** `apps/web/vite.config.ts`

Includes proxy rules:
```typescript
proxy: {
  '/api': {
    target: process.env.VITE_API_URL ?? 'http://localhost:3001',
    changeOrigin: true,
  },
}
```

---

## Debugging Connection Issues

### Issue: 404 NOT_FOUND

**Cause:** API endpoint doesn't exist

**Solution:**
1. Check the path in API client
2. Verify route exists in `apps/api/src/routes/`
3. Check API_ROUTING_GUIDE.md for available endpoints

### Issue: 401 UNAUTHORIZED

**Cause:** Invalid or missing JWT token

**Solution:**
1. Login to frontend
2. Check Supabase session with: `supabase.auth.getSession()`
3. Update SUPABASE_JWT_SECRET in .env files

### Issue: CORS Error

**Cause:** Frontend origin not allowed

**Solution:**
1. Check ALLOWED_ORIGINS in `apps/api/src/app.ts`
2. Verify FRONTEND_URL in `.env`
3. For dev, localhost on any port is allowed

### Issue: Connection Refused

**Cause:** API server not running

**Solution:**
```bash
pnpm dev --filter @forge/api
```

---

## Monitoring with Browser DevTools

1. Open browser: `http://localhost:5173`
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Look for logs starting with `[v0]`:
   - `[v0] API Client initialized with base URL: http://localhost:3001`
   - `[v0] API Request: { method: 'GET', url: 'http://localhost:3001/api/stocks', hasAuth: true }`
   - `[v0] API Response: { status: 200, statusText: 'OK', url: '...' }`

---

## Testing Without Frontend

### Test API directly with cURL:

```bash
# Test health (no auth required)
curl http://localhost:3001/health

# Test protected route (need token)
TOKEN=$(curl -s https://your-project.supabase.co/auth/v1/token \
  -H "apikey: your_anon_key" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"password","email":"user@example.com","password":"password"}' \
  | jq -r '.access_token')

curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/stocks
```

### Test API with browser console:

```javascript
// Health check
fetch('http://localhost:3001/health').then(r => r.json()).then(console.log)

// Protected route (after login)
const token = (await supabase.auth.getSession()).data.session.access_token
fetch('http://localhost:3001/api/stocks', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json()).then(console.log)
```

---

## Summary

The frontend-backend connection works as follows:

1. **Frontend** (React at :5173) → Makes API requests using `lib/api-client.ts`
2. **API Client** → Retrieves JWT from Supabase, builds Authorization header
3. **Vite Proxy** → Routes `/api/*` requests to backend (:3001)
4. **Backend** (Hono at :3001) → Validates JWT, processes request, returns data
5. **Response** → Travels back with CORS headers, frontend handles data

All requests are logged with `[v0]` prefix in browser console for easy debugging.
