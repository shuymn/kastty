#!/usr/bin/env bash
set -euo pipefail

# Fetch the latest NerdFontsSymbolsOnly release, convert to WOFF2,
# and place it in web/fonts/.
#
# Requirements: curl, tar, uv (for fonttools/brotli)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$REPO_ROOT/web/fonts"
FONT_NAME="SymbolsNerdFontMono-Regular"

FONTTOOLS_VERSION="4.61.1"
BROTLI_VERSION="1.2.0"

# Resolve version
if [[ "${1:-}" =~ ^v?[0-9] ]]; then
  VERSION="${1#v}"
else
  echo "Fetching latest Nerd Fonts release..."
  VERSION=$(curl -sI "https://github.com/ryanoasis/nerd-fonts/releases/latest" \
    | grep -i '^location:' | sed 's|.*/v||;s/[[:space:]]//g')
fi
echo "Version: v${VERSION}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Download & extract
URL="https://github.com/ryanoasis/nerd-fonts/releases/download/v${VERSION}/NerdFontsSymbolsOnly.tar.xz"
echo "Downloading ${URL}..."
curl -sL "$URL" -o "$WORK/archive.tar.xz"
tar -xf "$WORK/archive.tar.xz" -C "$WORK"

# Convert TTF → WOFF2 using fonttools via uv
echo "Converting TTF to WOFF2..."
uv run --no-project --with "fonttools==${FONTTOOLS_VERSION}" --with "brotli==${BROTLI_VERSION}" python3 -c "
from fontTools.ttLib import TTFont
font = TTFont('$WORK/${FONT_NAME}.ttf')
font.flavor = 'woff2'
font.save('$WORK/${FONT_NAME}.woff2')
"

# Place files
cp "$WORK/${FONT_NAME}.woff2" "$DEST_DIR/"
cp "$WORK/LICENSE" "$DEST_DIR/NerdFontsSymbolsOnly-LICENSE"

WOFF2_SIZE=$(wc -c < "$DEST_DIR/${FONT_NAME}.woff2" | tr -d ' ')
echo "Done: ${DEST_DIR}/${FONT_NAME}.woff2 (${WOFF2_SIZE} bytes, v${VERSION})"
