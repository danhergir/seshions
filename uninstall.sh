#!/usr/bin/env bash
#
# Seshions Uninstaller
# Usage: SESHIONS_REPO=danhergir/seshions curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/uninstall.sh" | bash
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

INSTALL_DIR="${SESHIONS_INSTALL_DIR:-$HOME/.seshions/bin}"
BIN_DIR="${SESHIONS_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${SESHIONS_DATA_DIR:-$HOME/.seshions}"

purge_data=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data)
      purge_data=true
      shift
      ;;
    -h|--help)
      cat <<EOF
Seshions Uninstaller

Usage:
  uninstall.sh [--purge-data]

Options:
  --purge-data         Remove ~/.seshions data (state.db, config.json, logs)
EOF
      exit 0
      ;;
    *)
      echo -e "${YELLOW}[seshions]${NC} Unknown option: $1"
      shift
      ;;
  esac
done

log() {
  echo -e "${BLUE}[seshions]${NC} $1"
}

success() {
  echo -e "${GREEN}[seshions]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[seshions]${NC} $1"
}

main() {
  echo ""
  echo -e "${BLUE}╭───────────────────────────────────╮${NC}"
  echo -e "${BLUE}│      ${RED}Seshions Uninstaller${BLUE}       │${NC}"
  echo -e "${BLUE}╰───────────────────────────────────╯${NC}"
  echo ""

  for cmd in seshions; do
    if [ -f "$INSTALL_DIR/$cmd" ]; then
      log "Removing $INSTALL_DIR/$cmd..."
      rm -f "$INSTALL_DIR/$cmd"
    fi
  done

  for cmd in seshions; do
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

  echo ""
  success "Seshions has been uninstalled"
  echo ""
  warn "Note: PATH entries in shell config files were not removed"
  warn "User data is preserved by default. Use --purge-data to remove ~/.seshions data."
  echo ""
}

main "$@"
