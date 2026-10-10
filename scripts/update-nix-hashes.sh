#!/usr/bin/env bash
# Refresh the fixed-output hashes in nix/package.nix: the view's node_modules (bun.lock) and the
# Go module vendor directory (go.sum). Nix reports the right hash when a build uses a fake one.
set -euo pipefail

cd "$(dirname "$0")/.."
file=nix/package.nix

# refresh <attribute in nix/package.nix> <flake attribute whose build fetches it>
refresh() {
  local name=$1 attr=$2 tmp got
  tmp=$(mktemp)
  sed "s|$name = \"sha256-[^\"]*\";|$name = lib.fakeHash;|" "$file" >"$tmp" && cat "$tmp" >"$file"
  got=$(nix build --no-link ".#$attr" 2>&1 | sed -n 's/^ *got: *//p' | head -n 1) || true
  if [[ -z "$got" ]]; then
    echo "$name: nix build .#$attr did not report a hash" >&2
    rm -f "$tmp"
    exit 1
  fi
  sed "s|$name = lib.fakeHash;|$name = \"$got\";|" "$file" >"$tmp" && cat "$tmp" >"$file"
  rm -f "$tmp"
  echo "$name = $got"
}

refresh outputHash kastty.web
refresh vendorHash kastty.goModules
