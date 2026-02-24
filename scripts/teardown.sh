#!/usr/bin/env bash
# teardown.sh — Stop and clean up the VMS mock environment.
#
# Usage:
#   ./scripts/teardown.sh              # Docker Compose mode (default)
#   ./scripts/teardown.sh compose      # Docker Compose mode (explicit)
#   ./scripts/teardown.sh k8s          # K8s mode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-compose}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }

case "$MODE" in
  compose)
    info "Stopping Docker Compose stack..."
    cd "$ROOT_DIR"
    docker compose -f docker-compose.dev.yml down --remove-orphans
    ok "Docker Compose stack stopped and removed."
    ;;
  k8s)
    info "Removing K8s resources..."
    cd "$ROOT_DIR"
    kubectl delete -f k8s/ingress.yaml --ignore-not-found
    kubectl delete -f k8s/diode-gateway-unclass.yaml --ignore-not-found
    kubectl delete -f k8s/diode-gateway-restricted.yaml --ignore-not-found
    kubectl delete -f k8s/mocks.yaml --ignore-not-found
    kubectl delete -f k8s/delay-proxy.yaml --ignore-not-found
    kubectl delete -f k8s/nats.yaml --ignore-not-found
    kubectl delete -f k8s/network-policies.yaml --ignore-not-found
    kubectl delete -f k8s/namespaces.yaml --ignore-not-found
    ok "All K8s VMS resources removed."
    ;;
  *)
    echo -e "${RED}[ERROR]${NC} Unknown mode: $MODE"
    echo "Usage: $0 [compose|k8s]"
    exit 1
    ;;
esac
