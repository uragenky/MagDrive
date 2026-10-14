#!/usr/bin/env bash
set -e

# Load Cargo / Rust environment
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

# Ensure workspace directory
cd "$(dirname "$0")"

# Self-healing: verify WebKit helper process binaries exist in ~/.local
WEBKIT_HELPER_DIR="$HOME/.local/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
if [ ! -f "$WEBKIT_HELPER_DIR/WebKitNetworkProcess" ]; then
  echo "=> WebKitNetworkProcess not found. Extracting WebKit helper processes..."
  TMP_DEB_DIR=$(mktemp -d)
  (
    cd "$TMP_DEB_DIR"
    apt-get download libwebkit2gtk-4.1-0
    dpkg -x libwebkit2gtk-4.1-0*.deb "$HOME/.local/"
  )
  rm -rf "$TMP_DEB_DIR"
fi

# Execute in isolated user + mount namespace with virtual overlay for WebKit child processes
exec unshare -rm bash -c '
TMP_DIR=$(mktemp -d)
trap "rm -rf \"$TMP_DIR\"" EXIT

mkdir -p "$TMP_DIR"/{upper,work,merged}
mount -t overlay overlay -o lowerdir=/usr/lib/x86_64-linux-gnu,upperdir="$TMP_DIR"/upper,workdir="$TMP_DIR"/work "$TMP_DIR"/merged
mkdir -p "$TMP_DIR"/merged/webkit2gtk-4.1
mount --bind "'"$WEBKIT_HELPER_DIR"'" "$TMP_DIR"/merged/webkit2gtk-4.1
mount --rbind "$TMP_DIR"/merged /usr/lib/x86_64-linux-gnu

export LD_LIBRARY_PATH=/home/opencode/.local/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
export WEBKIT_DISABLE_COMPOSITING_MODE=1

npm run tauri dev
'
