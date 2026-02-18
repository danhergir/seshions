#!/usr/bin/env bash
#
# Seshions Installer
# Usage: curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/install.sh" | bash
#

set -euo pipefail

APP="seshions"
REPO="${SESHIONS_REPO:-danhergir/seshions}"
BREW_FORMULA="${SESHIONS_BREW_FORMULA:-danhergir/tap/seshions}"
INSTALL_DIR="${SESHIONS_INSTALL_DIR:-$HOME/.seshions/bin}"

MUTED='\033[0;2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

requested_version=""
no_modify_path=false
binary_path=""
no_brew=false

usage() {
  cat <<USAGE
Seshions Installer

Usage: install.sh [options]

Options:
  -h, --help                 Display this help message
  -v, --version <version>    Install a specific release version
  -b, --binary <path>        Install from a local binary
      --no-modify-path       Don't modify shell config files
      --no-brew              Skip Homebrew install path on macOS

Examples:
  curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/install.sh" | bash
  curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/install.sh" | bash -s -- --version 0.2.0
  SESHIONS_REPO=owner/repo curl -fsSL "https://raw.githubusercontent.com/\$SESHIONS_REPO/main/install.sh" | bash
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -v|--version)
      if [[ -n "${2:-}" ]]; then
        requested_version="$2"
        shift 2
      else
        echo -e "${RED}Error: --version requires a version argument${NC}"
        exit 1
      fi
      ;;
    -b|--binary)
      if [[ -n "${2:-}" ]]; then
        binary_path="$2"
        shift 2
      else
        echo -e "${RED}Error: --binary requires a path argument${NC}"
        exit 1
      fi
      ;;
    --no-modify-path)
      no_modify_path=true
      shift
      ;;
    --no-brew)
      no_brew=true
      shift
      ;;
    *)
      echo -e "${RED}Warning: Unknown option '$1'${NC}" >&2
      shift
      ;;
  esac
done

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo -e "${RED}Unsupported OS: $(uname -s)${NC}"; exit 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo -e "${RED}Unsupported architecture: $(uname -m)${NC}"; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

check_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    return 0
  fi

  echo -e "${MUTED}tmux is not installed.${NC}"
  echo "Seshions requires tmux to function."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      read -r -p "Install tmux via Homebrew? [Y/n] " reply
      if [[ ! "$reply" =~ ^[Nn]$ ]]; then
        brew install tmux
      fi
    else
      echo "Install tmux with: brew install tmux"
    fi
  else
    if command -v apt-get >/dev/null 2>&1; then
      read -r -p "Install tmux via apt? [Y/n] " reply
      if [[ ! "$reply" =~ ^[Nn]$ ]]; then
        sudo apt-get update && sudo apt-get install -y tmux
      fi
    elif command -v dnf >/dev/null 2>&1; then
      read -r -p "Install tmux via dnf? [Y/n] " reply
      if [[ ! "$reply" =~ ^[Nn]$ ]]; then
        sudo dnf install -y tmux
      fi
    elif command -v pacman >/dev/null 2>&1; then
      read -r -p "Install tmux via pacman? [Y/n] " reply
      if [[ ! "$reply" =~ ^[Nn]$ ]]; then
        sudo pacman -S --noconfirm tmux
      fi
    else
      echo "Please install tmux manually and re-run this installer."
    fi
  fi

  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${RED}tmux is required. Aborting.${NC}"
    exit 1
  fi
}

install_with_homebrew() {
  echo -e "\n${MUTED}Installing with Homebrew (${BREW_FORMULA})...${NC}"
  brew tap danhergir/tap

  if brew list --formula "$BREW_FORMULA" >/dev/null 2>&1; then
    brew upgrade --formula --build-from-source "$BREW_FORMULA" || brew reinstall --formula --build-from-source "$BREW_FORMULA"
  else
    brew install --formula --build-from-source "$BREW_FORMULA"
  fi

  if ! command -v seshions >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix)"
    echo -e "${YELLOW}seshions installed but not on PATH in this shell.${NC}"
    echo -e "${MUTED}Run:${NC} export PATH=\"${brew_prefix}/bin:\$PATH\""
  fi

  echo ""
  echo -e "${GREEN}Installation complete!${NC}"
  echo -e "  Run ${GREEN}seshions${NC} to start"
  echo -e "  Update with: ${GREEN}brew upgrade ${BREW_FORMULA}${NC}"
  echo ""
}

check_version() {
  local specific_version="$1"

  if command -v seshions >/dev/null 2>&1; then
    local installed_version
    installed_version="$(seshions --version 2>/dev/null || echo "")"
    if [[ "$installed_version" == "$specific_version" ]]; then
      echo -e "${MUTED}Version ${specific_version} is already installed${NC}"
      exit 0
    fi
  fi
}

download_and_install() {
  local platform="$1"
  local filename="$2"
  local url="$3"

  local tmp_dir="${TMPDIR:-/tmp}/${APP}-$$"
  mkdir -p "$tmp_dir"

  echo -e "${MUTED}Downloading ${url}${NC}"
  if ! curl -#fL -o "$tmp_dir/$filename" "$url"; then
    echo -e "${RED}Download failed for ${filename}.${NC}"
    rm -rf "$tmp_dir"
    exit 1
  fi

  tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"

  local extracted_binary=""
  if [[ -f "$tmp_dir/$APP" ]]; then
    extracted_binary="$tmp_dir/$APP"
  elif [[ -f "$tmp_dir/$APP-$platform/$APP" ]]; then
    extracted_binary="$tmp_dir/$APP-$platform/$APP"
  else
    echo -e "${RED}Binary not found in archive.${NC}"
    rm -rf "$tmp_dir"
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  mv "$extracted_binary" "$INSTALL_DIR/$APP"
  chmod 755 "$INSTALL_DIR/$APP"
  rm -rf "$tmp_dir"
}

install_from_binary() {
  mkdir -p "$INSTALL_DIR"
  cp "$binary_path" "$INSTALL_DIR/$APP"
  chmod 755 "$INSTALL_DIR/$APP"
}

add_to_path() {
  local config_file="$1"
  local command="$2"

  if grep -Fxq "$command" "$config_file" 2>/dev/null; then
    return 0
  fi
  if [[ -w "$config_file" ]]; then
    echo -e "\n# seshions" >> "$config_file"
    echo "$command" >> "$config_file"
    echo -e "${MUTED}Added to PATH in ${config_file}${NC}"
  fi
}

check_tmux

platform="$(detect_platform)"
if [[ "$platform" == darwin-* ]] && [[ "$no_brew" != "true" ]] && command -v brew >/dev/null 2>&1 && [[ -z "$binary_path" ]] && [[ -z "$requested_version" ]]; then
  install_with_homebrew
  exit 0
fi

if [[ -n "$binary_path" ]]; then
  if [[ ! -f "$binary_path" ]]; then
    echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
    exit 1
  fi
  install_from_binary
else
  filename="$APP-$platform.tar.gz"

  if [[ -z "$requested_version" ]]; then
    url="https://github.com/$REPO/releases/latest/download/$filename"
    specific_version="$(curl -sI "https://github.com/$REPO/releases/latest" | sed -n 's/.*tag\/v\([^[:space:]]*\).*/\1/p' | tr -d '\r')"
    if [[ -z "$specific_version" ]]; then
      specific_version="$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"
    fi
  else
    requested_version="${requested_version#v}"
    specific_version="$requested_version"
    url="https://github.com/$REPO/releases/download/v${requested_version}/$filename"
  fi

  if [[ -z "${specific_version:-}" ]]; then
    echo -e "${RED}Failed to resolve release version${NC}"
    exit 1
  fi

  check_version "$specific_version"
  download_and_install "$platform" "$filename" "$url"
fi

if [[ "$no_modify_path" != "true" ]] && [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  case "$(basename "$SHELL")" in
    fish)
      config_file="$HOME/.config/fish/config.fish"
      [[ -f "$config_file" ]] && add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
      ;;
    zsh)
      config_file="${ZDOTDIR:-$HOME}/.zshrc"
      [[ -f "$config_file" ]] && add_to_path "$config_file" "export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
    *)
      config_file="$HOME/.bashrc"
      [[ -f "$config_file" ]] && add_to_path "$config_file" "export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo -e "  Run ${GREEN}seshions${NC}"
echo -e "  Binary: ${MUTED}$INSTALL_DIR/$APP${NC}"
echo -e "  If needed: ${MUTED}export PATH=\"$INSTALL_DIR:\$PATH\"${NC}"
echo ""
