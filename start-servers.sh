#!/bin/bash

# FORGE ERP - Quick Start Script
# This script helps you get the app running quickly

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║            FORGE ERP - Connection Ready                       ║"
echo "║          Frontend-Backend Connection Fixed ✓                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if in right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the project root directory"
    echo "   Example: cd /path/to/FORGE-TAFDIL-ERP && bash start-servers.sh"
    exit 1
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ Error: pnpm not found. Install it with: npm install -g pnpm"
    exit 1
fi

echo "📋 QUICK START STEPS:"
echo ""
echo "Step 1: Install dependencies (if not already done)"
echo "   → pnpm install"
echo ""
echo "Step 2: Start Backend API (Terminal 1)"
echo "   → pnpm dev --filter @forge/api"
echo "   → Runs on: http://localhost:3001"
echo ""
echo "Step 3: Start Frontend Web (Terminal 2)"
echo "   → pnpm dev --filter @forge/web"
echo "   → Runs on: http://localhost:5173"
echo ""
echo "Step 4: Open in Browser"
echo "   → http://localhost:5173"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 VERIFY CONNECTION:"
echo ""
echo "1. Open DevTools: Press F12"
echo "2. Go to Console tab"
echo "3. Look for logs starting with [v0]:"
echo ""
echo "   ✓ [v0] API Client initialized with base URL: http://localhost:3001"
echo "   ✓ [v0] API Request: { method: 'GET', url: '...', hasAuth: true }"
echo "   ✓ [v0] API Response: { status: 200, statusText: 'OK', ... }"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 DOCUMENTATION:"
echo ""
echo "   Start here:  README_CONNECTION_FIX.md"
echo "   TL;DR guide: QUICK_START.md"
echo "   Architecture: ARCHITECTURE_DIAGRAM.md"
echo "   All endpoints: API_ROUTING_GUIDE.md"
echo "   Debugging: PREVIEW_DEBUGGING_GUIDE.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  IMPORTANT: Before running, check:"
echo ""
echo "   [ ] SUPABASE_JWT_SECRET is set in .env files"
echo "   [ ] Both .env files exist (.env, apps/api/.env, apps/web/.env)"
echo "   [ ] Port 3001 is available (not used by another app)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✨ Your app is configured and ready to run!"
echo ""
