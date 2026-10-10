{
  lib,
  stdenv,
  buildGoModule,
  stdenvNoCC,
  bun,
  writableTmpDirAsHomeHook,
  libghostty-vt,
  commit ? "",
}:

let
  # tagpr adds each release at the top of CHANGELOG.md.
  version = lib.pipe ../CHANGELOG.md [
    builtins.readFile
    (lib.splitString "\n")
    (map (builtins.match "## \\[v([0-9]+\\.[0-9]+\\.[0-9]+)].*"))
    (lib.findFirst (match: match != null) (throw "CHANGELOG.md has no release heading"))
    builtins.head
  ];

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../.npmrc
      ../bun.lock
      ../cmd
      ../go.mod
      ../go.sum
      ../internal
      ../package.json
      ../scripts/pkg-config
      ../tsconfig.json
      ../web
    ];
  };

  # The view's runtime dependencies. Development tools and the typescript peer are left out, so
  # the hash does not depend on the platform and changes only with those dependencies.
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "kastty-node-modules";
    inherit version src;

    impureEnvVars = lib.fetchers.proxyImpureEnvVars;
    nativeBuildInputs = [
      bun
      writableTmpDirAsHomeHook
    ];

    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
      bun install --frozen-lockfile --production --omit=peer --ignore-scripts --no-progress
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -R node_modules $out
      runHook postInstall
    '';
    # Fixup would patch the output and make its hash unstable.
    dontFixup = true;

    outputHash = "sha256-/34J14l7orxvCUrCx5AmTaqzOgrTEyYr7AMv3WVABHw=";
    outputHashMode = "recursive";
  };

  web = stdenvNoCC.mkDerivation {
    pname = "kastty-web";
    inherit version src;

    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      ln -s ${nodeModules} node_modules
      bun web/build.ts
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -R web/dist $out
      runHook postInstall
    '';
  };
in
buildGoModule {
  pname = "kastty";
  inherit version src;

  vendorHash = "sha256-aElYDzt8All0bsqb4pUzLmKxe1AEMs1+YHzEYHpjk8I=";

  # The same cgo setup as `make build`: the bundled pkg-config stand-in points go-libghostty at
  # the static library.
  preConfigure = ''
    cp -R ${web}/. web/dist
    chmod -R u+w web/dist
    export PKG_CONFIG=$PWD/scripts/pkg-config
    export LIBGHOSTTY_VT_PREFIX=${libghostty-vt.dev}
  '';

  # GNU ld, lld and mold reject the compiler_rt.o that nixpkgs' Zig bundles into libghostty-vt.a
  # (relocations against an empty symbol); gold links it.
  env = lib.optionalAttrs stdenv.hostPlatform.isLinux { CGO_LDFLAGS = "-fuse-ld=gold"; };

  ldflags = [
    "-s"
    "-w"
    "-X main.version=v${version}"
    "-X main.commit=${commit}"
  ];

  passthru = { inherit libghostty-vt web; };

  meta = {
    description = "Share a terminal in the browser";
    homepage = "https://github.com/shuymn/kastty";
    license = lib.licenses.mit;
    mainProgram = "kastty";
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
