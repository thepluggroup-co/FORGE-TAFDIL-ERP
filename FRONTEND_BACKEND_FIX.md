# Frontend-Backend Connection Fix Guide

## ✅ What Has Been Fixed

1. **Created `.env` files** - Set up environment variables for both frontend and API
   - Root `.env`: Contains shared configuration
   - `apps/api/.env`: API server configuration with proper defaults
   - `apps/web/.env`: Frontend Vite configuration

2. **Enhanced API client debugging** - Added detailed console logs to track requests/responses
   - Logs the API base URL on initialization
   - Logs every API request with method, URL, and auth status
   - Logs response status and URL
   - Better 404 error handling with endpoint visibility

3. **Verified CORS Configuration** - The backend already has proper CORS setup

## 🚀 Quick Start

### 1. **Install Dependencies**
```bash
cd /vercel/share/v0-project
pnpm install
```

### 2. **Start the Development Servers** (from project root)

**In one terminal - Start the API:**
```bash
pnpm dev --filter @forge/api
```
Expected output: `FORGE API  →  http://localhost:3001`

**In another terminal - Start the Frontend:**
```bash
pnpm dev --filter @forge/web
```
Expected output will show Vite server running on `http://localhost:5173`

### 3. **Verify the Connection**

Open your browser to `http://localhost:5173` and:
- Open **Browser DevTools (F12)**
- Look in the **Console** tab for logs starting with `[v0]`
- You should see: `API Client initialized with base URL: http://localhost:3001`

## 🔍 Troubleshooting the 404 Error

If you still see a 404 error:

### **Check 1: Is the API running?**
```bash
# From project root
curl http://localhost:3001/health
```
Expected response: `{"status":"ok","version":"1.0.0","app":"FORGE ERP API","company":"TAFDIL"}`

### **Check 2: Check Browser Console**
Look for `[v0]` prefixed logs to see:
- What URL is being called
- What status code was returned
- What the error was

Example logs:
```
[v0] API Client initialized with base URL: http://localhost:3001
[v0] API Request: { method: 'GET', url: 'http://localhost:3001/api/stocks', hasAuth: true }
[v0] API Response: { status: 404, statusText: 'Not Found', url: 'http://localhost:3001/api/stocks' }
```

### **Check 3: Verify Environment Variables**

**For API**, run in `apps/api`:
```bash
# Check if env vars are loaded
grep -E "SUPABASE_URL|PORT|NODE_ENV" .env
```

**For Frontend**, run in `apps/web`:
```bash
# Check if API URL is set
grep VITE_API_URL .env
```

## 📋 Environment Variables Explained

### **API Server (`apps/api/.env`)**
| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `SUPABASE_URL` | Database URL | Required |
| `SUPABASE_JWT_SECRET` | Auth secret | Must match Supabase |
| `FRONTEND_URL` | CORS origin | `http://localhost:5173` |

### **Frontend (`apps/web/.env`)**
| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_API_URL` | Backend URL | `http://localhost:3001` |

## 🔐 Supabase Setup (Critical!)

The JWT secret in `.env` **MUST match** your Supabase project:

1. Go to **Supabase Dashboard**
2. Navigate to **Project Settings → API**
3. Find **JWT Secret**
4. Copy and paste into `.env` as `SUPABASE_JWT_SECRET`

Without this match, you'll get `401 Unauthorized` errors.

## 🛠️ Common Issues

| Error | Cause | Solution |
|-------|-------|----------|
| **404 NOT_FOUND** | Route doesn't exist on backend | Check that API server is running, verify endpoint path in frontend |
| **CORS error** | Origin not in ALLOWED_ORIGINS | Backend app.ts already handles localhost ports 5173-5175 |
| **401 Unauthorized** | Missing/invalid JWT | Ensure SUPABASE_JWT_SECRET is set correctly |
| **Cannot GET /api/...** | API endpoint not registered | Check routes in `apps/api/src/routes/` |
| **VITE_API_URL undefined** | Frontend env not loaded | Restart dev server after creating `.env` |

## 📚 Architecture Overview

```
Frontend (Vite - port 5173)
    ↓ makes API calls via fetch()
    ↓ uses VITE_API_URL to find backend
    ↓ sends auth header with JWT token
    ↓
Backend (Hono - port 3001)
    ↓ CORS middleware checks origin
    ↓ Auth middleware validates JWT
    ↓ Routes handle business logic
    ↓ Returns JSON responses
    ↓
Supabase (PostgreSQL + Auth)
```

## ✨ Next Steps

Once connected:

1. **Test authentication** - Try logging in
2. **Monitor console logs** - Check `[v0]` logs for any issues
3. **Use DevTools Network tab** - See all API calls and responses
4. **Check API response codes** - 200 (success), 401 (auth), 404 (not found), 500 (server error)

## 🆘 Still Having Issues?

1. **Check all `.env` files exist**: root, `apps/api/`, `apps/web/`
2. **Restart dev servers**: Kill and restart `pnpm dev`
3. **Clear browser cache**: Ctrl+Shift+Delete (or Cmd+Shift+Delete on Mac)
4. **Check port availability**: 
   ```bash
   lsof -i :3001    # Check API port
   lsof -i :5173    # Check frontend port
   ```
5. **Verify npm/pnpm installation**: `pnpm install` in root directory
