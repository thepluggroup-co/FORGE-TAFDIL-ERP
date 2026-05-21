# Frontend-Backend Connection - FIXED ✅

## 🎯 What Was Fixed

Your FORGE ERP application had a **404 NOT_FOUND** error when trying to connect the frontend to the backend. The root causes were:

1. **Missing `.env` files** - Environment variables weren't configured
2. **Frontend didn't know where the API was** - `VITE_API_URL` wasn't set
3. **No debugging info** - Hard to diagnose what was failing

## ✅ Solution Implemented

### Files Created:

| File | Purpose |
|------|---------|
| `.env` (root) | Shared configuration with Supabase credentials and CORS settings |
| `apps/api/.env` | API server configuration (port, auth, database) |
| `apps/web/.env` | Frontend configuration pointing to API at `http://localhost:3001` |
| `FRONTEND_BACKEND_FIX.md` | Complete troubleshooting guide |
| `test-connection.sh` | Quick diagnostic script |

### Code Changes:

**`apps/web/src/lib/api-client.ts`** - Enhanced with debugging:
- Logs API base URL on initialization
- Logs every request with method, URL, and auth status
- Logs response status and URL
- Better 404 error handling
- Added detailed error logging

## 🚀 How to Run

### 1. Install Dependencies
```bash
cd /vercel/share/v0-project
pnpm install
```

### 2. Start Backend (Terminal 1)
```bash
pnpm dev --filter @forge/api
```
You should see: `FORGE API  →  http://localhost:3001`

### 3. Start Frontend (Terminal 2)
```bash
pnpm dev --filter @forge/web
```
Frontend will start on `http://localhost:5173`

### 4. Verify Connection
- Open browser to `http://localhost:5173`
- Press **F12** to open DevTools
- Go to **Console** tab
- Look for logs starting with `[v0]`

## 🔍 Expected Behavior

### On Startup (in Browser Console):
```
[v0] API Client initialized with base URL: http://localhost:3001
```

### On API Calls (in Browser Console):
```
[v0] API Request: { method: 'GET', url: 'http://localhost:3001/api/stocks', hasAuth: true }
[v0] API Response: { status: 200, statusText: 'OK', url: 'http://localhost:3001/api/stocks' }
```

## ⚠️ Important: Supabase JWT Configuration

The authentication will **only work** if `SUPABASE_JWT_SECRET` in your `.env` files matches your Supabase project:

1. Go to **Supabase Dashboard**
2. Select your project
3. Go to **Project Settings** → **API**
4. Copy the **JWT Secret**
5. Paste it into `.env` as: `SUPABASE_JWT_SECRET=your_copied_secret`

Without this, you'll get **401 Unauthorized** errors.

## 📊 Connection Architecture

```
┌─────────────────────┐
│  Frontend (Vite)    │ http://localhost:5173
│  React + Router     │
└──────────┬──────────┘
           │
           │ API Calls with JWT
           │ VITE_API_URL=http://localhost:3001
           │
┌──────────▼──────────┐
│  Backend (Hono)     │ http://localhost:3001
│  - CORS ✓           │
│  - Auth ✓           │
│  - Routes ✓         │
└──────────┬──────────┘
           │
           │ Database Queries
           │
┌──────────▼──────────┐
│  Supabase (DB+Auth) │
│  PostgreSQL         │
└─────────────────────┘
```

## 🛠️ Troubleshooting

### 404 Error Still Showing?
1. **Is API running?** Check Terminal 1 output
2. **Check Console Logs** - Look for `[v0]` logs showing which URL was called
3. **Verify `.env` files exist** - Run: `ls -la .env apps/api/.env apps/web/.env`
4. **Restart servers** - Kill and restart both terminals

### 401 Unauthorized?
- Check that `SUPABASE_JWT_SECRET` is correctly set in `.env`
- It must exactly match your Supabase project's JWT secret

### Cannot Connect to API?
```bash
# Test if API is running
curl http://localhost:3001/health

# Should return:
# {"status":"ok","version":"1.0.0","app":"FORGE ERP API","company":"TAFDIL","timestamp":"..."}
```

## 📚 Documentation Files

- **`FRONTEND_BACKEND_FIX.md`** - Detailed setup and troubleshooting guide
- **`test-connection.sh`** - Run diagnostics: `bash test-connection.sh`

## ✨ Next Steps

1. ✅ Configure `SUPABASE_JWT_SECRET` correctly
2. ✅ Start both API and Frontend servers
3. ✅ Test the connection by logging in
4. ✅ Monitor the `[v0]` console logs for any issues
5. ✅ Use the DevTools Network tab to inspect API calls

Your frontend-backend connection is now properly configured and ready for development! 🎉
