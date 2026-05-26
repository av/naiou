#!/bin/sh

# Install script for naiou
# Usage: curl -fsSL https://raw.githubusercontent.com/av/naiou/main/install.sh | sh

set -e

REPO="av/naiou"
BINARY="naiou"

detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  platform="linux" ;;
    Darwin) platform="darwin" ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "Windows detected." >&2
      echo "" >&2
      echo "Prebuilt Windows binaries are available:" >&2
      echo "  https://github.com/${REPO}/releases/latest/download/naiou-windows-amd64.zip" >&2
      echo "" >&2
      echo "Download, unzip, and run naiou.exe." >&2
      echo "" >&2
      echo "Alternatively, build from source (requires Bun):" >&2
      echo "  git clone https://github.com/${REPO} && cd naiou && bun run build" >&2
      exit 1
      ;;
    *)
      echo "Error: Unsupported operating system: $os" >&2
      exit 1
      ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $arch" >&2
      echo "Supported: x86_64/amd64, aarch64/arm64" >&2
      exit 1
      ;;
  esac

  if [ "$platform" = "darwin" ] && [ "$arch" = "amd64" ]; then
    echo "Error: Intel Mac (darwin-amd64) prebuilt binaries are not available." >&2
    echo "Options:" >&2
    echo "  - Use an Apple Silicon Mac (arm64)" >&2
    echo "  - Install from source: git clone https://github.com/${REPO} && cd naiou && bun run build" >&2
    exit 1
  fi

  echo "${platform}-${arch}"
}

detect_install_dir() {
  if [ -w "/usr/local/bin" ]; then
    echo "/usr/local/bin"
  elif [ -d "$HOME/.local/bin" ]; then
    echo "$HOME/.local/bin"
  else
    mkdir -p "$HOME/.local/bin"
    echo "$HOME/.local/bin"
  fi
}

get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

download() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

main() {
  target="$(detect_platform)"
  version="${NAIOU_VERSION:-$(get_latest_version)}"
  install_dir="$(detect_install_dir)"

  if [ -z "$version" ]; then
    echo "Error: Could not determine latest version" >&2
    exit 1
  fi

  # Normalize version to always have 'v' prefix (GitHub tags use v-prefixed names)
  case "$version" in
    v*) ;; # already has v prefix
    *) version="v${version}" ;;
  esac

  artifact="${BINARY}-${target}"
  url="https://github.com/${REPO}/releases/download/${version}/${artifact}.tar.gz"

  echo "Installing ${BINARY} ${version} (${target})..."

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  echo "Downloading ${url}..."
  if ! download "$url" "${tmpdir}/${artifact}.tar.gz"; then
    echo ""
    echo "Error: Failed to download ${url}"
    echo ""
    echo "This usually happens when the release assets for ${version} are still"
    echo "being built by the GitHub Actions workflow (typically 10-20 minutes"
    echo "after the tag is pushed)."
    echo ""
    echo "Options:"
    echo "  1. Wait a few minutes and try again."
    echo "  2. Install a specific version that is known to be ready:"
    echo "     NAIOU_VERSION=v0.2.0 curl -fsSL https://raw.githubusercontent.com/av/naiou/main/install.sh | sh"
    echo "  3. Build from source (requires Bun):"
    echo "     git clone https://github.com/${REPO} && cd naiou && bun run build"
    echo ""
    exit 1
  fi

  echo "Extracting..."
  tar xzf "${tmpdir}/${artifact}.tar.gz" -C "$tmpdir"

  echo "Installing to ${install_dir}..."
  install -m 755 "${tmpdir}/${BINARY}" "${install_dir}/${BINARY}"

  echo ""
  echo "Successfully installed ${BINARY} to ${install_dir}/"

  case ":$PATH:" in
    *":${install_dir}:"*) ;;
    *)
      echo ""
      echo "Note: ${install_dir} is not in your PATH."
      echo "Add it with:"
      echo "  export PATH=\"${install_dir}:\$PATH\""
      ;;
  esac
}

main
