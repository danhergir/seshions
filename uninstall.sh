#!/usr/bin/env bash
#
# Agent View Uninstaller
# Usage: AGENT_VIEW_REPO=your-org/agent-view curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/uninstall.sh" | bash
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

INSTALL_DIR="${AGENT_VIEW_INSTALL_DIR:-$HOME/.agent-view/bin}"
BIN_DIR="${AGENT_VIEW_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${AGENT_VIEW_DATA_DIR:-$HOME/.agent-view}"
LEGACY_DATA_DIR="${AGENT_VIEW_LEGACY_DATA_DIR:-$HOME/.agent-orchestrator}"

purge_data=false
purge_legacy_data=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data)
      purge_data=true
      shift
      ;;
    --purge-legacy-data)
      purge_legacy_data=true
      shift
      ;;
    -h|--help)
      cat <<EOF
Agent View Uninstaller

Usage:
  uninstall.sh [--purge-data] [--purge-legacy-data]

Options:
  --purge-data         Remove ~/.agent-view data (state.db, config.json, logs)
  --purge-legacy-data  Remove ~/.agent-orchestrator legacy data directory
EOF
      exit 0
      ;;
    *)
      echo -e "${YELLOW}[agent-view]${NC} Unknown option: $1"
      shift
      ;;
  esac
done

log() {
  echo -e "${BLUE}[agent-view]${NC} $1"
}

success() {
  echo -e "${GREEN}[agent-view]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[agent-view]${NC} $1"
}

main() {
  echo ""
  echo -e "${BLUE}╭───────────────────────────────────╮${NC}"
  echo -e "${BLUE}│      ${RED}Agent View Uninstaller${BLUE}       │${NC}"
  echo -e "${BLUE}╰───────────────────────────────────╯${NC}"
  echo ""

  for cmd in agent-view av agent-orchestrator ao; do
    if [ -f "$INSTALL_DIR/$cmd" ]; then
      log "Removing $INSTALL_DIR/$cmd..."
      rm -f "$INSTALL_DIR/$cmd"
    fi
  done

  for cmd in agent-view av agent-orchestrator ao; do
    if [ -L "$BIN_DIR/$cmd" ] || [ -f "$BIN_DIR/$cmd" ]; then
      log "Removing $BIN_DIR/$cmd..."
      rm -f "$BIN_DIR/$cmd"
    fi
  done

  if [ -d "$INSTALL_DIR" ] && [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    log "Removing empty install directory $INSTALL_DIR..."
    rmdir "$INSTALL_DIR" || true
  fi

  if [ "$purge_data" = true ] && [ -d "$DATA_DIR" ]; then
    log "Purging data directory $DATA_DIR..."
    rm -rf "$DATA_DIR"
  fi

  if [ "$purge_legacy_data" = true ] && [ -d "$LEGACY_DATA_DIR" ]; then
    log "Purging legacy data directory $LEGACY_DATA_DIR..."
    rm -rf "$LEGACY_DATA_DIR"
  fi

  echo ""
  success "Agent View has been uninstalled"
  echo ""
  warn "Note: PATH entries in shell config files were not removed"
  warn "User data is preserved by default. Use --purge-data to remove ~/.agent-view data."
  warn "Legacy data is preserved by default. Use --purge-legacy-data to remove ~/.agent-orchestrator."
  echo ""
}

main "$@"
