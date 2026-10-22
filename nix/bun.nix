# Keep Nix builds on a patched release while nixpkgs still ships Bun 1.4.2.
{
  bun,
  fetchurl,
  lib,
  stdenvNoCC,
}:
if lib.versionAtLeast bun.version "1.4.4" then
  bun
else
  bun.overrideAttrs (
    finalAttrs: previousAttrs: {
      version = "1.4.4";
      src = finalAttrs.passthru.sources.${stdenvNoCC.hostPlatform.system};
      passthru = previousAttrs.passthru // {
        sources =
          lib.mapAttrs
            (
              _: source:
              fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/${source.archive}.zip";
                hash = source.hash;
              }
            )
            {
              aarch64-darwin = {
                archive = "bun-darwin-aarch64";
                hash = "sha256-wkDX8My5DCY6hJ/NsJt+5iYw2SE0jtaq/ahrnVd7xRA=";
              };
              aarch64-linux = {
                archive = "bun-linux-aarch64";
                hash = "sha256-uqa7NvUdblhWHgK76oJQOKnfRU9nPW13bou/hvjHhQ4=";
              };
              x86_64-linux = {
                archive = "bun-linux-x64-baseline";
                hash = "sha256-4ERutVmVdy65iUvrrppr42jZhai5Jx7hJEhvmUbu3XY=";
              };
            };
      };
    }
  )
