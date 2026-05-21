# 🚀 QUICK START - Frontend/Backend Connection

## TL;DR - Just Run This

```bash
# Terminal 1 - Start Backend
cd /vercel/share/v0-project
pnpm dev --filter @forge/api

# Terminal 2 - Start Frontend
cd /vercel/share/v0-project
pnpm dev --filter @forge/web

# Then open: http://localhost:5173
```

## What Was Fixed

❌ **Before:**
- No `.env` files configured
- Frontend didn't know where API was
- 404 errors with no debugging info

✅ **After:**
- Created `.env` files with proper configuration
- Frontend points to `http://localhost:3001`
- Detailed console logging for debugging

## Files You Need to Know About

| What | File | Purpose |
|------|------|---------|
| **Main Config** | `.env` | Shared settings (Supabase, CORS, etc.) |
| **API Config** | `apps/api/.env` | Backend settings |
| **Frontend Config** | `apps/web/.env` | Vite dev server settings |
| **Help** | `CONNECTION_STATUS.md` | This explains everything |
| **Detailed Help** | `FRONTEND_BACKEND_FIX.md` | In-depth troubleshooting |
| **Test Script** | `test-connection.sh` | Run diagnostics |

## Critical: Supabase Setup

⚠️ **REQUIRED:** Update `SUPABASE_JWT_SECRET` in `.env` files

```bash
# 1. Go to: Supabase Dashboard → Project Settings → API
# 2. Copy JWT Secret
# 3. Replace in .env:
SUPABASE_JWT_SECRET=<your_jwt_secret_here>
```

## How to Verify It Works

1. **Open Browser:** `http://localhost:5173`
2. **Open DevTools:** Press `F12`
3. **Go to Console tab**
4. **Look for logs like:**
   ```
   [v0] API Client initialized with base URL: http://localhost:3001
   [v0] API Request: { method: 'GET', url: 'http://localhost:3001/api/...', hasAuth: true }
   [v0] API Response: { status: 200, statusText: 'OK', url: '...' }
   ```

✅ If you see these logs → **Connection is working!**

## Ports

- **Frontend:** http://localhost:5173 (Vite dev server)
- **Backend:** http://localhost:3001 (Hono API server)
- **Test API:** `curl http://localhost:3001/health`

## Common Issues

| Problem | Solution |
|---------|----------|
| 404 Error | Make sure backend is running on port 3001 |
| 401 Unauthorized | Update SUPABASE_JWT_SECRET in .env |
| CORS Error | Should auto-fix, check app.ts for ALLOWED_ORIGINS |
| Frontend won't load | Delete `.env` and restart - might need new Vite port |
| "Cannot GET /api/..." | Check endpoint exists in `apps/api/src/routes/` |

## Debug Commands

```bash
# Check if backend is running
curl http://localhost:3001/health

# Check if ports are in use
lsof -i :3001  # Backend
lsof -i :5173  # Frontend

# Reinstall everything
pnpm install

# Check env file
cat .env
cat apps/api/.env
cat apps/web/.env
```

## Project Structure

```
forge-tafdil/
├── .env                          ← Shared config (CREATE THIS)
├── apps/
│   ├── api/
│   │   ├── .env                 ← API config (CREATE THIS)
│   │   └── src/
│   │       ├── index.ts         ← Entry point (port 3001)
│   │       ├── app.ts           ← Routes & CORS setup
│   │       └── routes/          ← API endpoints
│   └── web/
│       ├── .env                 ← Frontend config (CREATE THIS)
│       └── src/
│           └── lib/
│               └── api-client.ts ← API communication (ENHANCED)
└── packages/
    └── shared/                  ← Shared types
```

## That's It!

You're ready to develop. Everything is configured. Happy coding! 🎉

For more details, see `CONNECTION_STATUS.md` or `FRONTEND_BACKEND_FIX.md`
