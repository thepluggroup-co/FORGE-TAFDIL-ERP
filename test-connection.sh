#!/bin/bash
# Connection Test Utility for FORGE ERP
# Tests frontend-backend connection and provides diagnostics

set -e

echo "🔍 FORGE ERP - Frontend/Backend Connection Tester"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Check if ports are available
echo "${BLUE}[1/5] Checking port availability...${NC}"
if lsof -i :3001 &>/dev/null; then
    echo "${GREEN}✓ API port 3001 is in use${NC}"
else
    echo "${YELLOW}✗ API port 3001 is NOT in use (API might not be running)${NC}"
fi

if lsof -i :5173 &>/dev/null; then
    echo "${GREEN}✓ Frontend port 5173 is in use${NC}"
else
    echo "${YELLOW}✗ Frontend port 5173 is NOT in use (Frontend might not be running)${NC}"
fi
echo ""

# Test 2: Check .env files
echo "${BLUE}[2/5] Checking .env configuration files...${NC}"
if [ -f ".env" ]; then
    echo "${GREEN}✓ Root .env exists${NC}"
else
    echo "${RED}✗ Root .env is MISSING${NC}"
fi

if [ -f "apps/api/.env" ]; then
    echo "${GREEN}✓ API .env exists${NC}"
else
    echo "${RED}✗ API .env is MISSING${NC}"
fi

if [ -f "apps/web/.env" ]; then
    echo "${GREEN}✓ Web .env exists${NC}"
    VITE_API=$(grep VITE_API_URL apps/web/.env || echo "")
    if [ -n "$VITE_API" ]; then
        echo "  └─ $VITE_API"
    fi
else
    echo "${RED}✗ Web .env is MISSING${NC}"
fi
echo ""

# Test 3: Test API health endpoint
echo "${BLUE}[3/5] Testing API health endpoint...${NC}"
if curl -s http://localhost:3001/health &>/dev/null; then
    HEALTH=$(curl -s http://localhost:3001/health | grep -o '"status":"[^"]*"')
    echo "${GREEN}✓ API health endpoint responding: $HEALTH${NC}"
    curl -s http://localhost:3001/health | sed 's/^/  /'
else
    echo "${RED}✗ API health endpoint not responding (is API running on port 3001?)${NC}"
fi
echo ""

# Test 4: Check dependencies
echo "${BLUE}[4/5] Checking dependencies...${NC}"
if [ -d "node_modules" ]; then
    echo "${GREEN}✓ node_modules directory exists${NC}"
else
    echo "${YELLOW}⚠ node_modules not found - run 'pnpm install'${NC}"
fi
echo ""

# Test 5: Summary
echo "${BLUE}[5/5] Summary${NC}"
echo ""
echo "To start development:"
echo "  Terminal 1: ${YELLOW}pnpm dev --filter @forge/api${NC}     (Backend - port 3001)"
echo "  Terminal 2: ${YELLOW}pnpm dev --filter @forge/web${NC}     (Frontend - port 5173)"
echo ""
echo "Then open: ${YELLOW}http://localhost:5173${NC}"
echo ""
echo "For debugging, check console logs with the [v0] prefix"
echo ""
