{
  description = "Share a terminal in the browser";

  nixConfig = {
    extra-substituters = [ "https://shuymn.cachix.org" ];
    extra-trusted-public-keys = [ "shuymn.cachix.org-1:bUcNU5/B3gNbM7htHCYmKVVb1bUwNx2vc2W4aOJlloQ=" ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # libghostty-vt, at the commit scripts/libghostty-vt.sh builds (`make lint` checks it).
    ghostty = {
      url = "github:ghostty-org/ghostty/f54340ad77814fe319d136e5e915d6a48de8dd23";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      ghostty,
    }:
    let
      # nixpkgs-unstable no longer supports x86_64-darwin.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          kastty = pkgs.callPackage ./nix/package.nix {
            bun = pkgs.callPackage ./nix/bun.nix { };
            commit = self.rev or "";
            libghostty-vt = pkgs.callPackage "${ghostty}/nix/libghostty-vt.nix" {
              optimize = "ReleaseFast";
              revision = ghostty.shortRev;
            };
          };
        in
        {
          inherit kastty;
          default = kastty;
        }
      );

      apps = forAllSystems (system: {
        kastty = {
          type = "app";
          program = "${self.packages.${system}.kastty}/bin/kastty";
          meta.description = "Run kastty";
        };
        default = self.apps.${system}.kastty;
      });

      checks = forAllSystems (system: {
        package = self.packages.${system}.kastty;
      });

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
