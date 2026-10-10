// Package web embeds the built browser view (web/dist, produced by `bun run build:web`).
package web

import "embed"

// Dist holds index.html, assets/ and fonts/ from the web build.
//
//go:embed all:dist
var Dist embed.FS
