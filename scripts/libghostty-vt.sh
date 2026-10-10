#!/usr/bin/env bash
# Build libghostty-vt as a static library for one target and print its install prefix.
#
#   scripts/libghostty-vt.sh [zig-target]      # default: native
#   scripts/libghostty-vt.sh aarch64-linux-gnu
#
# Requires Zig (set ZIG to its path if it is not on PATH). The ghostty commit must
# match the one go-libghostty pins in its CMakeLists.txt, or the C API may differ.
set -euo pipefail

GHOSTTY_COMMIT=34f39002c6e3974b54e6a6d400bd83777c5ea558
ZIG=${ZIG:-zig}

target=${1:-native}
root=$(cd "$(dirname "$0")/.." && pwd)
cache="$root/.cache"
prefix="$cache/libghostty-vt/$GHOSTTY_COMMIT/$target"

lib="$prefix/lib/libghostty-vt.a"

if [[ ! -f "$lib" ]]; then
  mkdir -p "$cache"
  # One build at a time: `make -j` runs this from several recipes, and they share the source
  # tree and the scratch directories.
  lock="$cache/libghostty-vt.lock"
  until mkdir "$lock" 2>/dev/null; do
    if [[ -z "${waiting:-}" ]]; then
      echo "Waiting for another libghostty-vt build; remove $lock if none is running." >&2
      waiting=1
    fi
    sleep 1
  done
  tmpsrc="" tmp=""
  trap 'rm -rf "$lock" ${tmpsrc:+"$tmpsrc"} ${tmp:+"$tmp"}' EXIT
fi

# Built by another run while this one waited for the lock?
if [[ ! -f "$lib" ]]; then
  src="$cache/ghostty-$GHOSTTY_COMMIT"
  if [[ ! -d "$src" ]]; then
    # Extract beside the cache and rename, so an interrupted download is never reused.
    tmpsrc=$(mktemp -d "$cache/ghostty-src.XXXXXX")
    curl -fsSL "https://codeload.github.com/ghostty-org/ghostty/tar.gz/$GHOSTTY_COMMIT" | tar -xz -C "$tmpsrc"
    mv "$tmpsrc/ghostty-$GHOSTTY_COMMIT" "$src"
  fi
  # No xcframework: it needs full Xcode and builds iOS slices nobody links (go-libghostty's
  # CMakeLists.txt passes the same flag). Install into a scratch prefix and rename it, so a
  # failed build is never mistaken for a cached one.
  tmp="$prefix.partial"
  rm -rf "$tmp"
  args=(build -Demit-lib-vt -Demit-xcframework=false -Doptimize=ReleaseFast --prefix "$tmp")
  if [[ "$target" != native ]]; then
    args+=("-Dtarget=$target")
  fi
  # ghostty's build takes its version from git. The extracted tarball has no .git, so git would
  # find kastty's repository above it (or through a GIT_DIR that git hooks inherit), and a kastty
  # release tag there makes the build panic. A missing GIT_DIR makes git report no repository.
  (cd "$src" && GIT_DIR="$src/.git" "$ZIG" "${args[@]}") >&2
  rm -rf "$prefix"
  mv "$tmp" "$prefix"
fi

echo "$prefix"
