/**
 * Build the browser view into web/dist, which web/embed.go embeds into the Go
 * host: index.html, hashed JS/CSS under assets/, and fonts under fonts/.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const WEB_DIR = import.meta.dir;
const DIST_DIR = join(WEB_DIR, "dist");
const FONTS_OUT_DIR = join(DIST_DIR, "fonts");
// go:embed needs web/dist to exist in a fresh checkout, so its .gitkeep stays.
const KEEP = new Set([".gitkeep"]);

const NERD_FONT_FILE = "SymbolsNerdFontMono-Regular.woff2";
const NERD_FONT_FACE = `
@font-face {
  font-family: 'Symbols Nerd Font Mono';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(/fonts/${NERD_FONT_FILE}) format('woff2');
}
`;

async function cleanDist(): Promise<void> {
  await mkdir(DIST_DIR, { recursive: true });
  for (const entry of await readdir(DIST_DIR)) {
    if (!KEEP.has(entry)) await rm(join(DIST_DIR, entry), { recursive: true, force: true });
  }
}

async function bundlePage(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "index.html")],
    outdir: DIST_DIR,
    target: "browser",
    minify: true,
    publicPath: "/",
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("web build failed");
  }
}

/**
 * Fonts stay out of Bun's CSS bundler: it inlines small woff2 subsets as
 * base64 (bun#24599). The fontsource CSS is copied with its url()s pointed at
 * /fonts/, and the Nerd Font face is appended.
 */
async function copyFonts(): Promise<void> {
  await mkdir(FONTS_OUT_DIR, { recursive: true });

  const mPlusCssPath = Bun.resolveSync("@fontsource-variable/m-plus-1-code/index.css", WEB_DIR);
  const mPlusFilesDir = join(dirname(mPlusCssPath), "files");
  const mPlusFiles = (await readdir(mPlusFilesDir)).filter((name) => name.endsWith(".woff2"));
  await Promise.all(
    mPlusFiles.map((name) => Bun.write(join(FONTS_OUT_DIR, name), Bun.file(join(mPlusFilesDir, name)))),
  );

  const mPlusCss = await Bun.file(mPlusCssPath).text();
  const css = mPlusCss.replaceAll("url(./files/", "url(/fonts/") + NERD_FONT_FACE;
  await Bun.write(join(FONTS_OUT_DIR, "fonts.css"), css);

  await Bun.write(join(FONTS_OUT_DIR, NERD_FONT_FILE), Bun.file(join(WEB_DIR, "fonts", NERD_FONT_FILE)));
}

await cleanDist();
await bundlePage();
await copyFonts();
console.log(`Built ${basename(WEB_DIR)}/${basename(DIST_DIR)}`);
