#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/install-cli.sh
  scripts/install-cli.sh -h|--help

Install the flowise-agentflow CLI from this checkout. The script installs
lockfile-pinned dependencies, builds the package, links it globally with pnpm,
and verifies the installed CLI version.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 20 or newer is required.' >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if ! [[ "$node_major" =~ ^[0-9]+$ ]] || [ "$node_major" -lt 20 ]; then
  printf '%s\n' 'Node.js 20 or newer is required.' >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'pnpm is required.' >&2
  exit 1
fi

if ! global_bin="$(pnpm bin --global 2>/dev/null)" || [ -z "$global_bin" ]; then
  printf '%s\n' 'pnpm has no global bin directory. Run "pnpm setup", restart your shell, and try again.' >&2
  exit 1
fi

cd -- "$repo_root"
pnpm install --frozen-lockfile
pnpm build
pnpm link --global

expected_version="$(node -p "require('./package.json').version")"
linked_cli="$global_bin/flowise-agentflow"
if [ ! -x "$linked_cli" ]; then
  printf '%s\n' 'pnpm did not create an executable global flowise-agentflow link.' >&2
  exit 1
fi

actual_version="$("$linked_cli" --version)"
if [ "$actual_version" != "$expected_version" ]; then
  printf 'Installed CLI version mismatch: expected %s, got %s\n' "$expected_version" "$actual_version" >&2
  exit 1
fi

printf 'Installed flowise-agentflow %s\n' "$actual_version"
