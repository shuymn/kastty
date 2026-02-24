// @ts-expect-error -- Bun resolves this CSS file as plain text at compile time
import mPlusCss from "@fontsource-variable/m-plus-1-code/index.css" with { type: "text" };
// @ts-expect-error -- Bun resolves this to an embedded asset path at compile time
import nerdFontEmbedded from "../web/fonts/SymbolsNerdFontMono-Regular.woff2" with { type: "file" };
import { mPlusFontFiles } from "./m-plus-font-files.ts";

export interface FontAssets {
  css: string;
  files: Map<string, ArrayBuffer>;
}

const NERD_FONT_FILENAME = "SymbolsNerdFontMono-Regular.woff2";

/**
 * Load font CSS and WOFF2 files at startup.
 *
 * M PLUS 1 Code: Loaded from the fontsource npm package. We rewrite the
 * `url()` references to point at a server route and serve each WOFF2
 * individually, bypassing Bun's CSS bundler which corrupts unicode-range
 * values.
 *
 * Nerd Fonts Symbols Only: Loaded from web/fonts/ in the repo. Served as
 * a single WOFF2 with its own @font-face declaration appended to the CSS.
 */
export async function loadFontAssets(): Promise<FontAssets> {
  const rawCss = mPlusCss;

  const urlPattern = /url\(\.\/files\/([^)]+)\)/g;
  const filenames = new Set<string>();
  for (const match of rawCss.matchAll(urlPattern)) {
    filenames.add(match[1] as string);
  }

  const files = new Map<string, ArrayBuffer>();
  await Promise.all([
    ...[...filenames].map(async (name) => {
      const embedded = mPlusFontFiles.get(name);
      if (!embedded) {
        throw new Error(`Missing embedded M PLUS font asset: ${name}`);
      }
      const buf = await Bun.file(embedded).arrayBuffer();
      files.set(name, buf);
    }),
    (async () => {
      files.set(NERD_FONT_FILENAME, await Bun.file(nerdFontEmbedded).arrayBuffer());
    })(),
  ]);

  const nerdFontFace = `
@font-face {
  font-family: 'Symbols Nerd Font Mono';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(/fonts/${NERD_FONT_FILENAME}) format('woff2');
}`;

  const css = rawCss.replaceAll("url(./files/", "url(/fonts/") + nerdFontFace;

  return { css, files };
}
