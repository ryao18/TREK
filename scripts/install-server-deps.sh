#!/usr/bin/env bash
# Install server/node_modules on Linux (e.g. RHEL 8) when:
# - `node` points to NSolid → node-gyp downloads wrong headers (403)
# - GLIBC < 2.29 → better-sqlite3 prebuild fails → must compile from source
# - Python 3.6 (default on EL8) → node-gyp 12+ requires Python 3.8+ for its gyp scripts
# - GCC 8 (default g++ on EL8) → better-sqlite3 needs -std=c++20 (GCC 10+); use gcc-toolset
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server"

# node-gyp: pick Python 3.8+ (required; 3.6 throws SyntaxError on walrus operator in gyp)
pick_python38() {
  local py
  if [[ -n "${PYTHON:-}" && -x "${PYTHON}" ]]; then
    if "${PYTHON}" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
      echo "$PYTHON"
      return 0
    fi
  fi
  for py in \
    /usr/bin/python3.12 /usr/bin/python3.11 /usr/bin/python3.10 /usr/bin/python3.9 /usr/bin/python3.8 \
    /usr/local/bin/python3.11 /usr/local/bin/python3.10 /usr/local/bin/python3.9 \
    "$(command -v python3 2>/dev/null || true)"; do
    [[ -z "$py" || ! -x "$py" ]] && continue
    if "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
      echo "$py"
      return 0
    fi
  done
  return 1
}

if ! PY="$(pick_python38)"; then
  echo "ERROR: No Python 3.8+ found. node-gyp (used by better-sqlite3) needs Python ≥ 3.8."
  echo "On RHEL 8 / AlmaLinux 8:"
  echo "  sudo dnf install -y python39 gcc-c++ make"
  echo "  export PYTHON=/usr/bin/python3.9"
  echo "  $0"
  exit 1
fi
export PYTHON="$PY"
export npm_config_python="$PY"
echo "Using PYTHON=$PYTHON ($("$PYTHON" -c 'import sys; print(sys.version.split()[0])' 2>/dev/null || echo unknown))"

# Optional: force a real Node.js binary (bypasses NSolid on PATH), e.g.
#   NODE_BINARY=/opt/nodejs/bin/node ../scripts/install-server-deps.sh
# nvm stores versions as v22.x.x — do NOT use .../versions/node/22/bin/node (wrong).
if [[ -n "${NODE_BINARY:-}" ]]; then
  if [[ ! -x "$NODE_BINARY" ]]; then
    echo "ERROR: NODE_BINARY is not executable: $NODE_BINARY"
    echo "Hint: nvm path looks like: \$HOME/.nvm/versions/node/v22.21.1/bin/node"
    exit 1
  fi
  export PATH="$(dirname "$NODE_BINARY"):$PATH"
  hash -r 2>/dev/null || true
fi

# Load nvm if present so Node from nvm wins over /usr/bin/nsolid (must run before `node` check)
if [[ -z "${NODE_BINARY:-}" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    if [[ -f "$ROOT/server/.nvmrc" ]]; then
      nvm install
      nvm use
    else
      nvm install 22
      nvm use 22
    fi
    hash -r 2>/dev/null || true
  fi
fi

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: \`node\` not found. Install Node.js (nvm recommended) or set NODE_BINARY=/path/to/node"
  exit 1
fi

BASE="$(basename "$(readlink -f "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")")"
if [[ "$BASE" == "nsolid" ]] || [[ "$NODE_BIN" == *nsolid* ]] || [[ "$(readlink -f "$NODE_BIN" 2>/dev/null || true)" == *nsolid* ]]; then
  echo "ERROR: \`node\` still resolves to NSolid: $NODE_BIN"
  echo "  node-gyp then requests NSolid header tarballs and often gets HTTP 403."
  echo ""
  echo "Try one of:"
  echo "  1) source ~/.nvm/nvm.sh && cd $ROOT/server && nvm use && $0"
  echo "  2) NODE_BINARY=\$(ls -d \"\$HOME/.nvm/versions/node/v22\"*\"/bin/node\" 2>/dev/null | head -1) $0"
  exit 1
fi

echo "Using node: $NODE_BIN ($("$NODE_BIN" -p 'process.version'))"

# better-sqlite3 native build uses -std=c++20; GCC 8 only knows -std=c++2a — need gcc-toolset-12+ on RHEL 8
gpp_supports_cxx20() {
  local tmp
  tmp="$(mktemp)"
  if echo 'int main(){}' | g++ -std=c++20 -x c++ - -o "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

if ! gpp_supports_cxx20; then
  for ts in gcc-toolset-13 gcc-toolset-12 gcc-toolset-11; do
    en="/opt/rh/${ts}/enable"
    if [[ -f "$en" ]]; then
      # shellcheck source=/dev/null
      . "$en"
      if gpp_supports_cxx20; then
        echo "Using newer g++ for C++20: $(command -v g++) ($($(command -v g++) -dumpversion))"
        break
      fi
    fi
  done
fi

if ! gpp_supports_cxx20; then
  echo "ERROR: \`g++\` does not support -std=c++20 (better-sqlite3 needs GCC 10+)."
  echo "On RHEL 8 / AlmaLinux 8 install a toolchain and re-run this script:"
  echo "  sudo dnf install -y gcc-toolset-12-gcc-c++ make"
  echo "  source /opt/rh/gcc-toolset-12/enable"
  echo "  $0"
  exit 1
fi

echo "Also required on EL8: sudo dnf install -y gcc-c++ make (if not already)"
echo ""

# Prefer compiling native addons from source when prebuilds do not load (older GLIBC)
npm install --build-from-source "$@"
