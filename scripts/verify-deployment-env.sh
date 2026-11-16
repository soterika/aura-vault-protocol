#!/usr/bin/env bash
# scripts/verify-deployment-env.sh
# Comprehensive environment verification for Aura Vault deployment

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "Aura Vault Deployment Environment Verification"
echo "=============================================="

# Rust
echo ""
echo "Checking Rust..."
if ! command -v rustc &> /dev/null; then
  fail "Rust not found. Install from https://rustup.rs"
fi
RUST_VERSION=$(rustc --version | awk '{print $2}')
pass "Rust $RUST_VERSION installed"

# Check minimum version (1.79)
RUST_MAJOR=$(echo "$RUST_VERSION" | cut -d. -f1)
RUST_MINOR=$(echo "$RUST_VERSION" | cut -d. -f2)
if [[ $RUST_MAJOR -lt 1 ]] || [[ $RUST_MAJOR -eq 1 && $RUST_MINOR -lt 79 ]]; then
  fail "Rust version $RUST_VERSION is too old (need 1.79+)"
fi

# wasm32 target
if ! rustup target list | grep -q "wasm32-unknown-unknown (installed)"; then
  fail "wasm32-unknown-unknown target not installed. Run: rustup target add wasm32-unknown-unknown"
fi
pass "wasm32-unknown-unknown target installed"

# Stellar CLI
echo ""
echo "Checking Stellar CLI..."
if ! command -v stellar &> /dev/null; then
  fail "Stellar CLI not found. Install via: cargo install stellar-cli --features opt"
fi
STELLAR_VERSION=$(stellar --version 2>&1 | head -1)
pass "$STELLAR_VERSION"

# Node.js
echo ""
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
  fail "Node.js not found. Install from https://nodejs.org"
fi
NODE_VERSION=$(node --version)
if [[ ! "$NODE_VERSION" =~ ^v([2-9][0-9]|[0-9]{3,}) ]]; then
  fail "Node.js version $NODE_VERSION is too old (need 20+)"
fi
pass "Node.js $NODE_VERSION"

# Docker
echo ""
echo "Checking Docker..."
if ! command -v docker &> /dev/null; then
  fail "Docker not found. Install from https://docs.docker.com/get-docker"
fi
DOCKER_VERSION=$(docker --version | awk '{print $3}' | sed 's/,//')
pass "Docker $DOCKER_VERSION"

# jq
echo ""
echo "Checking jq..."
if ! command -v jq &> /dev/null; then
  fail "jq not found. Install via: apt-get install jq or brew install jq"
fi
pass "jq installed"

# openssl
echo ""
echo "Checking openssl..."
if ! command -v openssl &> /dev/null; then
  fail "openssl not found (required for JWT secret generation)"
fi
OPENSSL_VERSION=$(openssl version | cut -d' ' -f2)
pass "openssl $OPENSSL_VERSION"

# PostgreSQL client (optional)
echo ""
echo "Checking PostgreSQL client..."
if ! command -v psql &> /dev/null; then
  warn "psql not found (optional if using Docker Compose)"
else
  pass "psql installed"
fi

# Redis CLI (optional)
echo ""
echo "Checking Redis CLI..."
if ! command -v redis-cli &> /dev/null; then
  warn "redis-cli not found (optional if using Docker Compose)"
else
  pass "redis-cli installed"
fi

# Cargo Audit
echo ""
echo "Checking cargo-audit..."
if ! command -v cargo-audit &> /dev/null; then
  warn "cargo-audit not found. Install via: cargo install cargo-audit"
else
  pass "cargo-audit installed"
fi

echo ""
echo "=============================================="
echo -e "${GREEN}✓ All required tools verified${NC}"
echo "Ready for deployment!"
