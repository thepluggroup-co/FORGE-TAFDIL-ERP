# Preview & Debugging Checklist

## Starting the App

You have two options to run the app:

### Option 1: Download ZIP and Run Locally (Recommended)
1. Click **three dots** (⋯) in top right of v0
2. Click **"Download ZIP"**
3. Extract to your computer
4. Open terminal in the project folder
5. Run:
   ```bash
   pnpm install
   ```
6. Then in **two separate terminals**:
   ```bash
   # Terminal 1: Start Backend API
   pnpm dev --filter @forge/api
   
   # Terminal 2: Start Frontend Web
   pnpm dev --filter @forge/web
   ```
7. Open browser: `http://localhost:5173`

### Option 2: Deploy to Vercel
1. Click **"Publish"** in top right
2. Follow prompts to connect GitHub and deploy
3. Vercel will automatically detect and build both apps

---

## What to Look For in the Preview

### Step 1: Browser Console
1. Press **F12** to open DevTools
2. Go to **Console** tab
3. You should see logs like:

```
[v0] API Client initialized with base URL: http://localhost:3001
```

This means the frontend is ready to talk to the backend.

### Step 2: Make Your First API Call
Depending on which page loads, you should see logs like:

```
[v0] API Request: { 
  method: 'GET',
  url: 'http://localhost:3001/api/stocks',
  hasAuth: true 
}
```

This means the frontend successfully made a request to the backend with authentication.

### Step 3: Check Response
Look for:

```
[v0] API Response: {
  status: 200,
  statusText: 'OK',
  url: 'http://localhost:3001/api/stocks'
}
```

✅ **Status 200** = Success! Data is loading
❌ **Status 404** = Route doesn't exist
❌ **Status 401** = Authentication failed
❌ **Connection refused** = Backend not running

---

## Using the Health Check Component

A health check component was created at:
```
apps/web/src/components/APIHealthCheck.tsx
```

To use it in any page:

```tsx
import { APIHealthCheck } from '@/components/APIHealthCheck'

export function Dashboard() {
  return (
    <div>
      <APIHealthCheck />
      {/* Rest of your page */}
    </div>
  )
}
```

This component:
- ✓ Shows API connection status with color indicators
- ✓ Auto-retries every 5 seconds
- ✓ Displays server version and company info
- ✓ Shows helpful error messages
- ✓ Logs all attempts to browser console

---

## Console Logs Guide

### Successful Connection
```
[v0] API Client initialized with base URL: http://localhost:3001
[v0] Checking API connection to http://localhost:3001/health
[v0] Health check response status: 200
[v0] Health check successful: { status: 'ok', version: '1.0.0', ... }
```
✅ Everything is working!

### Backend Not Running
```
[v0] Checking API connection to http://localhost:3001/health
error: net::ERR_CONNECTION_REFUSED
[v0] API health check failed: Failed to fetch
```
❌ Start the backend: `pnpm dev --filter @forge/api`

### Authentication Failed
```
[v0] API Request: { method: 'GET', url: '...', hasAuth: false }
[v0] API Response: { status: 401, statusText: 'Unauthorized', ... }
```
❌ Need to login or Supabase JWT is invalid

### Route Not Found
```
[v0] API Request: { method: 'GET', url: 'http://localhost:3001/api/nonexistent', ... }
[v0] API Response: { status: 404, statusText: 'Not Found', ... }
[v0] Route not found: http://localhost:3001/api/nonexistent
```
❌ Check the endpoint path in `API_ROUTING_GUIDE.md`

---

## Step-by-Step Connection Test

### 1. Test Backend Health (No Auth)
```javascript
// Open DevTools Console and run:
fetch('http://localhost:3001/health')
  .then(r => r.json())
  .then(data => {
    console.log('[v0] Health Check:', data)
    console.log('[v0] Connection Status:', 
      data.status === 'ok' ? '✓ WORKING' : '✗ FAILED')
  })
  .catch(e => console.error('[v0] Error:', e.message))
```

Expected output:
```
[v0] Health Check: {
  status: "ok",
  version: "1.0.0",
  app: "FORGE ERP API",
  company: "TAFDIL",
  timestamp: "2026-05-21T14:30:00.000Z"
}
[v0] Connection Status: ✓ WORKING
```

### 2. Test Auth (With JWT)
```javascript
// Make sure you're logged in first, then run:
const session = await supabase.auth.getSession()
if (!session.data.session) {
  console.error('[v0] Not logged in')
} else {
  const token = session.data.session.access_token
  fetch('http://localhost:3001/api/stocks', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(r => r.json())
  .then(data => console.log('[v0] Stocks Data:', data))
  .catch(e => console.error('[v0] Error:', e.message))
}
```

### 3. Test Network Tab
1. Press **F12** → **Network** tab
2. Perform an action (load stocks, create item, etc.)
3. Look for requests to:
   - `http://localhost:3001/api/*` (on local dev)
   - `https://your-domain/api/*` (on production)
4. Check response:
   - Should be **200 OK** for successful requests
   - Should see **JSON data** in response
   - Should have **Authorization header** with Bearer token

---

## Troubleshooting Flowchart

```
Does preview load at all?
│
├─ NO → Check for build errors in console
│       → Verify all dependencies installed
│       → Try: pnpm install && pnpm build
│
└─ YES → Open DevTools (F12)
         │
         └─ Do you see [v0] logs?
            │
            ├─ NO → Component didn't load
            │       → Check app routing
            │       → Add APIHealthCheck component
            │
            └─ YES → Check log messages
                    │
                    ├─ "Connection refused" → Start backend API
                    │  Command: pnpm dev --filter @forge/api
                    │
                    ├─ "404 Not Found" → Wrong endpoint path
                    │  Check: API_ROUTING_GUIDE.md
                    │
                    ├─ "401 Unauthorized" → Auth failed
                    │  Fix: Update SUPABASE_JWT_SECRET
                    │
                    ├─ "200 OK" → SUCCESS! ✓
                    │  Everything is connected and working
                    │
                    └─ Status 500 → Server error
                       Check: API console for details
```

---

## Performance Monitoring

Once connected, monitor performance:

1. **DevTools → Performance Tab**
   - Record an action
   - Look for API request timeline
   - Should complete in <500ms

2. **DevTools → Network Tab**
   - Filter by XHR/Fetch
   - Check response sizes
   - Monitor response times

3. **DevTools → Console**
   - Search for `[v0]` to see all app logs
   - No errors should be present

---

## File Reference

| Purpose | File | Location |
|---------|------|----------|
| API Routing | API_ROUTING_GUIDE.md | Root |
| Architecture | ARCHITECTURE_DIAGRAM.md | Root |
| Quick Start | QUICK_START.md | Root |
| Connection Fix | CONNECTION_STATUS.md | Root |
| Health Check Component | APIHealthCheck.tsx | apps/web/src/components/ |
| API Client | api-client.ts | apps/web/src/lib/ |
| Backend App | app.ts | apps/api/src/ |
| Backend Server | index.ts | apps/api/src/ |

---

## Success Criteria

✅ All systems working when:

1. ✓ Frontend loads at `http://localhost:5173`
2. ✓ Browser console shows `[v0]` logs
3. ✓ Health endpoint returns `status: 'ok'`
4. ✓ API calls return status 200 with data
5. ✓ No CORS errors in console
6. ✓ No 404 errors for valid routes
7. ✓ No 401 errors after login
8. ✓ Data displays on page correctly

---

## Next Steps After Connection Works

Once connected, you can:

1. **Browse Stock Data** → View items in inventory
2. **Create Orders** → Place new commandes
3. **Generate Reports** → Export data
4. **Use AI Assistant** → Get AI-powered insights
5. **Manage HR** → View employees and payroll
6. **Run Sync** → Keep shop and ERP in sync

All powered by the frontend-backend connection!
