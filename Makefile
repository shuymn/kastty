# Build and check kastty: the Go host (./cmd/kastty) embeds the browser view that Bun builds
# into web/dist, and links libghostty-vt statically through cgo (see docs/adr/0018).
#
#   make build                                  # host binary ./kastty
#   make release-target GOOS=linux GOARCH=arm64 # cross-compiled binary for a release archive
#
# Set ZIG to Zig 0.16.0 when `zig` on PATH is another version.

VERSION ?= dev
COMMIT ?=
ZIG ?= zig
OUT ?= kastty

GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)

# Zig targets for libghostty-vt and zig cc. Linux pins glibc 2.28 so release binaries run on
# older distributions. Explicit targets (rather than "native") also keep the library free of
# host-specific CPU features, so a cached build is safe to reuse on another machine.
ZIG_TARGET_darwin_arm64 := aarch64-macos
ZIG_TARGET_darwin_amd64 := x86_64-macos
ZIG_TARGET_linux_amd64 := x86_64-linux-gnu.2.28
ZIG_TARGET_linux_arm64 := aarch64-linux-gnu.2.28
ZIG_TARGET := $(ZIG_TARGET_$(GOOS)_$(GOARCH))
LIBGHOSTTY_TARGET ?= $(if $(ZIG_TARGET),$(ZIG_TARGET),native)

# Builds libghostty-vt for LIBGHOSTTY_TARGET unless it is cached, and points go-libghostty's
# `pkg-config --static libghostty-vt-static` at it without a system pkg-config.
CGO_ENV = prefix=$$(ZIG="$(ZIG)" scripts/libghostty-vt.sh $(LIBGHOSTTY_TARGET)) && \
	CGO_ENABLED=1 PKG_CONFIG="$(CURDIR)/scripts/pkg-config" LIBGHOSTTY_VT_PREFIX="$$prefix"

LIBGHOSTTY_MODULE := go.mitchellh.com/libghostty

GO_BUILD_FLAGS = -trimpath -ldflags "-s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT)"

# Linux: zig cc links against its bundled glibc 2.28 from any host. The default CGO_LDFLAGS
# carries -g, which would make zig cc ignore the -s that `go build -ldflags=-s` passes to it.
RELEASE_ENV_linux = CC="$(ZIG) cc -target $(ZIG_TARGET)" CXX="$(ZIG) c++ -target $(ZIG_TARGET)" \
	CGO_LDFLAGS="-O2"
# macOS: zig cc cannot link the -lresolv that package net needs on darwin, so darwin targets need
# a macOS host and use its clang (go build adds -arch). Without a minimum version, clang targets the runner's own
# macOS; 13.0 matches the deployment target libghostty-vt is built for.
RELEASE_ENV_darwin = CGO_CFLAGS="-O2 -g -mmacosx-version-min=13.0" \
	CGO_LDFLAGS="-O2 -g -mmacosx-version-min=13.0"

.PHONY: web libghostty build release-target test lint check

web:
	bun run build:web

libghostty:
	ZIG="$(ZIG)" scripts/libghostty-vt.sh $(LIBGHOSTTY_TARGET)

build: web
	$(CGO_ENV) go build $(GO_BUILD_FLAGS) -o $(OUT) ./cmd/kastty

release-target: LIBGHOSTTY_TARGET = $(ZIG_TARGET)
release-target: web
	@test -n "$(ZIG_TARGET)" || { echo "unsupported target: $(GOOS)/$(GOARCH)" >&2; exit 1; }
	$(CGO_ENV) GOOS=$(GOOS) GOARCH=$(GOARCH) $(RELEASE_ENV_$(GOOS)) \
		go build $(GO_BUILD_FLAGS) -o $(OUT) ./cmd/kastty

test:
	$(CGO_ENV) go test ./...
	bun test web

# Besides formatting and vet, lint checks that scripts/libghostty-vt.sh and the flake's ghostty
# input build the ghostty commit go-libghostty pins (GIT_TAG in its CMakeLists.txt): Renovate
# bumps only the Go module, and the C API differs between commits.
lint:
	@out=$$(gofmt -l $$(go list -f '{{.Dir}}' ./...)) && test -z "$$out" || \
		{ echo "gofmt reports unformatted files:" >&2; echo "$$out" >&2; exit 1; }
	@go mod download $(LIBGHOSTTY_MODULE) && \
		pinned=$$(sed -n 's/^ *GIT_TAG *\([0-9a-f]*\).*/\1/p' "$$(go list -m -f '{{.Dir}}' $(LIBGHOSTTY_MODULE))/CMakeLists.txt") && \
		built=$$(sed -n 's/^GHOSTTY_COMMIT=//p' scripts/libghostty-vt.sh) && \
		test -n "$$pinned" && test "$$pinned" = "$$built" || \
		{ echo "scripts/libghostty-vt.sh: GHOSTTY_COMMIT=$$built, but $(LIBGHOSTTY_MODULE) pins $$pinned" >&2; exit 1; }
	@built=$$(sed -n 's/^GHOSTTY_COMMIT=//p' scripts/libghostty-vt.sh) && \
		flake=$$(sed -n 's|.*"github:ghostty-org/ghostty/\([0-9a-f]*\)".*|\1|p' flake.nix) && \
		test "$$flake" = "$$built" || \
		{ echo "flake.nix: the ghostty input is $$flake, but scripts/libghostty-vt.sh builds $$built" >&2; exit 1; }
	$(CGO_ENV) go vet ./...
	bun run biome check .
	bun run typecheck

check: lint test
