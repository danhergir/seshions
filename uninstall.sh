#!/usr/bin/env bash
#
# Seshions Uninstaller
# Usage: curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/uninstall.sh" | bash
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="${SESHIONS_INSTALL_DIR:-$HOME/.seshions/bin}"
BIN_DIR="${SESHIONS_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${SESHIONS_DATA_DIR:-$HOME/.seshions}"
BREW_FORMULA="${SESHIONS_BREW_FORMULA:-danhergir/tap/seshions}"

purge_data=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data)
      purge_data=true
      shift
      ;;
    -h|--help)
      cat <<USAGE
Seshions Uninstaller

Usage:
  uninstall.sh [--purge-data]

Options:
  --purge-data   Remove ~/.seshions data (state.json, config.json, logs)
USAGE
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
  echo -e "${BLUE}│       ${RED}Seshions Uninstaller${BLUE}        │${NC}"
  echo -e "${BLUE}╰───────────────────────────────────╯${NC}"
  echo ""

  if command -v brew >/dev/null 2>&1 && brew list --formula "$BREW_FORMULA" >/dev/null 2>&1; then
    log "Uninstalling Homebrew formula $BREW_FORMULA..."
    brew uninstall --formula "$BREW_FORMULA" || true
  fi

  if [[ -f "$INSTALL_DIR/seshions" ]]; then
    log "Removing $INSTALL_DIR/seshions..."
    rm -f "$INSTALL_DIR/seshions"
  fi

  if [[ -L "$BIN_DIR/seshions" || -f "$BIN_DIR/seshions" ]]; then
    log "Removing $BIN_DIR/seshions..."
    rm -f "$BIN_DIR/seshions"
  fi

  if [[ -d "$INSTALL_DIR" && -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    log "Removing empty install directory $INSTALL_DIR..."
    rmdir "$INSTALL_DIR" || true
  fi

  if [[ "$purge_data" == "true" && -d "$DATA_DIR" ]]; then
    log "Purging data directory $DATA_DIR..."
    rm -rf "$DATA_DIR"
  fi

  echo ""
  success "Seshions has been uninstalled"
  warn "PATH entries in shell config files were not removed"
  warn "Use --purge-data to remove ~/.seshions data"
  echo ""
}

main "$@"
