#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/uninstall-cli.sh [--force]
  scripts/uninstall-cli.sh -h|--help

Remove the flowise-agentflow CLI globally linked from this checkout. By
default, a same-named global package from another source is left untouched.
Use --force to remove that conflicting global package.
EOF
}

force=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) force=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'pnpm is required.' >&2
  exit 1
fi

if ! global_root="$(pnpm root --global 2>/dev/null)" || [ -z "$global_root" ]; then
  printf '%s\n' 'Unable to determine pnpm global package directory.' >&2
  exit 1
fi
if [ "${global_root#/}" = "$global_root" ] || ! global_root="$(CDPATH= cd -- "$global_root" 2>/dev/null && pwd -P)"; then
  printf '%s\n' 'Unable to resolve pnpm global package directory.' >&2
  exit 1
fi
if [ "$global_root" = / ]; then
  printf '%s\n' 'Refusing to use an unsafe pnpm global package directory.' >&2
  exit 1
fi

package_target="$global_root/flowise-agentflow-builder"
if [ ! -e "$package_target" ] && [ ! -L "$package_target" ]; then
  printf '%s\n' 'flowise-agentflow is not installed from this pnpm global directory.'
  exit 0
fi

installed_root=''
if [ -L "$package_target" ]; then
  installed_root="$(CDPATH= cd -- "$package_target" 2>/dev/null && pwd -P || true)"
fi
if [ "$installed_root" != "$repo_root" ] && ! "$force"; then
  printf '%s\n' 'The global package was not linked from this checkout; use --force to remove it.' >&2
  exit 1
fi

pnpm uninstall --global flowise-agentflow-builder
if [ -e "$package_target" ] || [ -L "$package_target" ]; then
  printf '%s\n' 'pnpm did not remove the global flowise-agentflow package.' >&2
  exit 1
fi

printf '%s\n' 'Uninstalled global flowise-agentflow CLI.'
