#!/usr/bin/env bash
set -euo pipefail

# Fetch the pinned NerdFontsSymbolsOnly release (or a CLI-specified version),
# convert to WOFF2,
# and place it in web/fonts/.
#
# Requirements: gh, tar, uv (for fonttools/brotli)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$REPO_ROOT/web/fonts"
FONT_NAME="SymbolsNerdFontMono-Regular"
NERD_FONTS_REPO="ryanoasis/nerd-fonts"
NERD_FONTS_ARCHIVE="NerdFontsSymbolsOnly.tar.xz"

NERD_FONTS_VERSION="3.4.0"
FONTTOOLS_VERSION="4.61.1"
BROTLI_VERSION="1.2.0"

# Resolve version
if [[ "${1:-}" =~ ^v?[0-9] ]]; then
  VERSION="${1#v}"
else
  VERSION="$NERD_FONTS_VERSION"
fi
echo "Version: v${VERSION}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Download & extract
echo "Downloading ${NERD_FONTS_ARCHIVE} from ${NERD_FONTS_REPO} v${VERSION}..."
gh release download "v${VERSION}" \
  --repo "$NERD_FONTS_REPO" \
  --pattern "$NERD_FONTS_ARCHIVE" \
  --output - \
  | tar -xJf - -C "$WORK"

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
