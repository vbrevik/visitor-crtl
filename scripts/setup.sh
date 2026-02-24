#!/usr/bin/env bash
# setup.sh — One-command setup for Visitor Management System mock environment.
#
# Usage:
#   ./scripts/setup.sh              # Docker Compose mode (default)
#   ./scripts/setup.sh compose      # Docker Compose mode (explicit)
#   ./scripts/setup.sh k8s          # K3s / kubectl mode
#   ./scripts/setup.sh dev          # Local dev mode (npm only, no containers)
#
# Prerequisites:
#   - Node.js >= 20
#   - Docker + Docker Compose (for compose mode)
#   - kubectl + K3s/Rancher Desktop (for k8s mode)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-compose}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ─── Preflight Checks ───────────────────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js >= 20."
    exit 1
  fi
  local ver
  ver=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( ver < 20 )); then
    err "Node.js >= 20 required. Found: $(node -v)"
    exit 1
  fi
  ok "Node.js $(node -v)"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    err "npm not found."
    exit 1
  fi
  ok "npm $(npm -v)"
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    err "Docker not found. Install Docker or Rancher Desktop."
    exit 1
  fi
  if ! docker info &>/dev/null; then
    err "Docker daemon not running."
    exit 1
  fi
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

check_compose() {
  if docker compose version &>/dev/null; then
    ok "Docker Compose $(docker compose version --short 2>/dev/null || echo 'available')"
  else
    err "Docker Compose not found (docker compose plugin required)."
    exit 1
  fi
}

check_kubectl() {
  if ! command -v kubectl &>/dev/null; then
    err "kubectl not found. Install kubectl or Rancher Desktop."
    exit 1
  fi
  if ! kubectl cluster-info &>/dev/null 2>&1; then
    err "Cannot connect to Kubernetes cluster. Is K3s / Rancher Desktop running?"
    exit 1
  fi
  ok "kubectl connected to cluster"
}

# ─── Install Dependencies ───────────────────────────────────────────────────

install_deps() {
  info "Installing npm dependencies..."
  cd "$ROOT_DIR"
  npm install
  ok "npm dependencies installed"

  info "Building shared package..."
  npm run build -w packages/shared
  ok "Shared package built"
}

# ─── Docker Compose Mode ────────────────────────────────────────────────────

setup_compose() {
  info "Setting up Docker Compose environment..."

  check_docker
  check_compose

  cd "$ROOT_DIR"

  info "Building and starting all services..."
  docker compose -f docker-compose.dev.yml up --build -d

  echo ""
  ok "Docker Compose stack is running!"
  echo ""
  info "Services:"
  echo "  Keycloak (IdP)  — http://localhost:8180 (admin: admin/admin)"
  echo "  NATS            — localhost:4222 (monitoring: localhost:8222)"
  echo "  OnGuard Mock    — localhost:8080"
  echo "  Register Stubs  — localhost:8081"
  echo "  Notification    — localhost:8082"
  echo "  Portal          — http://localhost:5173"
  echo "  Guard UI        — http://localhost:5174"
  echo "  Security UI     — http://localhost:5175"
  echo "  Sponsor         — http://localhost:5176"
  echo ""
  info "Test users (password: test1234 for all):"
  echo "  Portal (ID-porten realm):"
  echo "    visitor.norsk / visitor.foreign / contractor.admin"
  echo "  Sponsor/Guard/Security (Mil Feide realm):"
  echo "    sponsor.hansen / guard.olsen / security.berg / escort.nilsen"
  echo ""
  warn "Convex backends are NOT included in Docker Compose."
  warn "Run them separately:"
  echo "  cd packages/convex-unclass   && npx convex dev   # port 3210"
  echo "  cd packages/convex-restricted && npx convex dev  # port 3211"
  echo ""
  info "To stop:  docker compose -f docker-compose.dev.yml down"
  info "To logs:  docker compose -f docker-compose.dev.yml logs -f [service]"
}

# ─── K8s Mode ────────────────────────────────────────────────────────────────

setup_k8s() {
  info "Setting up K8s environment..."

  check_kubectl

  cd "$ROOT_DIR"

  # Step 1: Create namespaces
  info "Creating namespaces..."
  kubectl apply -f k8s/namespaces.yaml
  ok "Namespaces created (vms-unclass, vms-restricted, vms-diode)"

  # Step 2: Apply network policies (air gap simulation)
  info "Applying network policies..."
  kubectl apply -f k8s/network-policies.yaml
  ok "Network policies applied"

  # Step 3: Deploy NATS
  info "Deploying NATS..."
  kubectl apply -f k8s/nats.yaml
  ok "NATS deployed to vms-diode"

  # Step 4: Deploy delay proxy
  info "Deploying diode delay proxy..."
  kubectl apply -f k8s/delay-proxy.yaml
  ok "Delay proxy deployed to vms-diode"

  # Step 5: Deploy mock services
  info "Deploying mock services..."
  kubectl apply -f k8s/mocks.yaml
  ok "Mock services deployed to vms-restricted"

  # Step 5b: Deploy Keycloak (mock IdP)
  info "Deploying Keycloak (mock IdP)..."
  kubectl delete configmap keycloak-realms -n vms-unclass --ignore-not-found
  kubectl create configmap keycloak-realms \
    --from-file=keycloak/id-porten-realm.json \
    --from-file=keycloak/mil-feide-realm.json \
    -n vms-unclass
  kubectl apply -f k8s/keycloak.yaml
  ok "Keycloak deployed to vms-unclass"

  # Step 6: Deploy diode gateways
  info "Deploying diode gateways..."
  kubectl apply -f k8s/diode-gateway-unclass.yaml
  kubectl apply -f k8s/diode-gateway-restricted.yaml
  ok "Diode gateways deployed (both sides)"

  # Step 7: Apply ingress
  info "Applying ingress rules..."
  kubectl apply -f k8s/ingress.yaml
  ok "Ingress applied"

  # Wait for rollouts
  info "Waiting for deployments to become ready..."
  kubectl rollout status deployment/nats -n vms-diode --timeout=60s 2>/dev/null || warn "NATS not ready yet"
  kubectl rollout status deployment/delay-proxy -n vms-diode --timeout=60s 2>/dev/null || warn "Delay proxy not ready yet"
  kubectl rollout status deployment/mock-services -n vms-restricted --timeout=60s 2>/dev/null || warn "Mock services not ready yet"

  echo ""
  ok "K8s stack deployed!"
  echo ""
  info "Access via Traefik ingress:"
  echo "  Portal       — https://portal.visitor.localhost"
  echo "  Sponsor      — https://sponsor.visitor.localhost"
  echo "  Guard UI     — https://guard.visitor.localhost"
  echo "  Security UI  — https://security.visitor.localhost"
  echo "  Keycloak     — https://auth.visitor.localhost (admin: admin/admin)"
  echo ""
  info "Check pod status:  kubectl get pods -A | grep vms-"
  info "To teardown:       ./scripts/teardown.sh k8s"
}

# ─── Dev Mode (Local, No Containers) ────────────────────────────────────────

setup_dev() {
  info "Setting up local dev environment (no containers)..."

  echo ""
  ok "Dependencies installed. Ready for local development."
  echo ""
  info "Start services manually:"
  echo ""
  echo "  # Terminal 1 — Mock servers (OnGuard, registers, notifications)"
  echo "  npm run dev:mocks"
  echo ""
  echo "  # Terminal 2 — Convex unclassified backend"
  echo "  npm run dev:convex-unclass"
  echo ""
  echo "  # Terminal 3 — Convex restricted backend"
  echo "  npm run dev:convex-restricted"
  echo ""
  echo "  # Terminal 4 — Diode gateway"
  echo "  npm run dev:gateway"
  echo ""
  echo "  # Terminal 5+ — React UIs (pick one or more)"
  echo "  npm run dev:portal        # http://localhost:5173"
  echo "  npm run dev:guard-ui      # http://localhost:5174"
  echo "  npm run dev:security-ui   # http://localhost:5175"
  echo "  npm run dev:sponsor       # http://localhost:5176"
  echo ""
  info "All workspace scripts defined in root package.json."
}

# ─── Main ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Visitor Management System — Mock Environment Setup  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Always check Node + npm and install deps
check_node
check_npm
install_deps

case "$MODE" in
  compose)
    setup_compose
    ;;
  k8s)
    setup_k8s
    ;;
  dev)
    setup_dev
    ;;
  *)
    err "Unknown mode: $MODE"
    echo "Usage: $0 [compose|k8s|dev]"
    exit 1
    ;;
esac
