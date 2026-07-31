#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/uninstall-skill.sh --project DIR [--force]
  scripts/uninstall-skill.sh --global [--force]
  scripts/uninstall-skill.sh -h|--help

Remove the build-flowise-agentflow skill from DIR/.agents/skills, or from
${CODEX_HOME:-$HOME/.codex}/skills with --global. By default, a target that
cannot be verified as this checkout's installation is left untouched. Use
--force to remove that exact conflicting target. Parent directories are kept.
With no arguments, this help is displayed without uninstalling.
EOF
}

if [ "$#" -eq 0 ]; then
  usage
  exit 0
fi

global=false
force=false
project_dir=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --global) global=true ;;
    --force) force=true ;;
    --project)
      if [ -n "$project_dir" ]; then
        printf '%s\n' 'The --project option may only be specified once.' >&2
        usage >&2
        exit 2
      fi
      shift
      if [ "$#" -eq 0 ] || [[ "$1" == -* ]]; then
        printf '%s\n' 'The --project option requires a directory.' >&2
        usage >&2
        exit 2
      fi
      project_dir="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if "$global" && [ -n "$project_dir" ]; then
  printf '%s\n' 'The --project and --global options are mutually exclusive.' >&2
  usage >&2
  exit 2
fi
if ! "$global" && [ -z "$project_dir" ]; then
  printf '%s\n' 'Specify --project DIR or --global.' >&2
  usage >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required.' >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
source_dir="$repo_root/skills/build-flowise-agentflow"

remove_target() {
  local target="$1"
  if [ "$target" != "$expected_target" ]; then
    printf '%s\n' 'Refusing to remove an unexpected target.' >&2
    exit 1
  fi
  rm -rf -- "$target"
}

if ! "$global"; then
  if [ ! -d "$project_dir" ]; then
    printf '%s\n' 'Project directory must already exist.' >&2
    exit 1
  fi
  if ! project_root="$(CDPATH= cd -- "$project_dir" && pwd -P)"; then
    printf '%s\n' 'Unable to resolve the project directory.' >&2
    exit 1
  fi
  if [ "$project_root" = / ]; then
    printf '%s\n' 'Project directory must resolve to a directory other than /.' >&2
    exit 1
  fi
  local_parent="$project_root/.agents/skills"
  if [ -L "$project_root/.agents" ] || [ -L "$local_parent" ]; then
    printf '%s\n' 'Refusing to uninstall through a symlinked repository skill path.' >&2
    exit 1
  fi
  target="$local_parent/build-flowise-agentflow"
  expected_target="$target"
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    printf '%s\n' 'Repository skill is not installed.'
    exit 0
  fi
  relative_source="$(node -e '
    const path = require("node:path");
    process.stdout.write(path.relative(process.argv[1], process.argv[2]) || ".");
  ' "$local_parent" "$source_dir")"
  if { [ ! -L "$target" ] || [ "$(readlink "$target")" != "$relative_source" ]; } && ! "$force"; then
    printf '%s\n' 'Skill target was not installed from this checkout; use --force to remove it.' >&2
    exit 1
  fi
  remove_target "$target"
  printf '%s\n' 'Uninstalled repository skill link.'
  exit 0
fi

if [ -n "${CODEX_HOME:-}" ]; then
  codex_home="$CODEX_HOME"
elif [ -n "${HOME:-}" ]; then
  codex_home="$HOME/.codex"
else
  printf '%s\n' 'HOME must be set when CODEX_HOME is not set.' >&2
  exit 1
fi
if [ "${codex_home#/}" = "$codex_home" ]; then
  printf '%s\n' 'CODEX_HOME must resolve to an absolute directory other than /.' >&2
  exit 1
fi
if ! codex_home="$(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  let resolved = path.resolve(process.argv[1]);
  const missing = [];
  while (!fs.existsSync(resolved)) {
    missing.unshift(path.basename(resolved));
    resolved = path.dirname(resolved);
  }
  process.stdout.write(path.join(fs.realpathSync(resolved), ...missing));
' "$codex_home")"; then
  printf '%s\n' 'Unable to resolve CODEX_HOME.' >&2
  exit 1
fi
if [ "$codex_home" = / ]; then
  printf '%s\n' 'CODEX_HOME must resolve to an absolute directory other than /.' >&2
  exit 1
fi

parent_dir="$codex_home/skills"
if [ -L "$parent_dir" ]; then
  printf '%s\n' 'Refusing to uninstall through a symlinked global skill path.' >&2
  exit 1
fi
target="$parent_dir/build-flowise-agentflow"
expected_target="$target"
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  printf '%s\n' 'Global skill is not installed.'
  exit 0
fi
if { [ -L "$target" ] || [ ! -d "$target" ] || ! diff -qr -- "$source_dir" "$target" >/dev/null 2>&1; } && ! "$force"; then
  printf '%s\n' 'Global skill target does not match this checkout; use --force to remove it.' >&2
  exit 1
fi
remove_target "$target"
printf '%s\n' 'Uninstalled global skill copy.'
