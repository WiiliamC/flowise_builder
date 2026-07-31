#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/install-skill.sh --project DIR [--force]
  scripts/install-skill.sh --global [--force]
  scripts/install-skill.sh -h|--help

Install the build-flowise-agentflow skill into DIR/.agents/skills, or copy it
to ${CODEX_HOME:-$HOME/.codex}/skills with --global. --force replaces an
existing target. With no arguments, this help is displayed without installing.
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

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
source_dir="$repo_root/skills/build-flowise-agentflow"

if [ ! -f "$source_dir/SKILL.md" ] || [ ! -d "$source_dir/agents" ] || [ ! -d "$source_dir/references" ] || ! find "$source_dir/agents" "$source_dir/references" -type f -print -quit | grep -q .; then
  printf '%s\n' 'Skill source is incomplete.' >&2
  exit 1
fi

replace_target() {
  local target="$1"
  if [ "$target" != "$expected_target" ]; then
    printf '%s\n' 'Refusing to replace an unexpected target.' >&2
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
    printf '%s\n' 'Refusing to install through a symlinked repository skill path.' >&2
    exit 1
  fi
  mkdir -p -- "$local_parent"
  if [ "$(CDPATH= cd -- "$local_parent" && pwd -P)" != "$local_parent" ]; then
    printf '%s\n' 'Refusing to install through a symlinked repository skill path.' >&2
    exit 1
  fi
  target="$local_parent/build-flowise-agentflow"
  expected_target="$target"
  relative_source="$(node -e '
    const path = require("node:path");
    process.stdout.write(path.relative(process.argv[1], process.argv[2]) || ".");
  ' "$local_parent" "$source_dir")"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$relative_source" ]; then
    printf '%s\n' 'Repository skill link is already installed.'
    exit 0
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    if ! "$force"; then
      printf '%s\n' 'Skill target already exists; use --force to replace it.' >&2
      exit 1
    fi
    replace_target "$target"
  fi
  ln -s -- "$relative_source" "$target"
  printf '%s\n' 'Installed repository skill link.'
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
target="$codex_home/skills/build-flowise-agentflow"
expected_target="$target"
parent_dir="$(dirname -- "$target")"
mkdir -p -- "$parent_dir"
if [ -e "$target" ] || [ -L "$target" ]; then
  if ! "$force"; then
    printf '%s\n' 'Skill target already exists; use --force to replace it.' >&2
    exit 1
  fi
fi
temporary_dir="$(mktemp -d "$parent_dir/.build-flowise-agentflow.tmp.XXXXXX")"
backup_path=''
cleanup() {
  if [ -n "$temporary_dir" ] && { [ -e "$temporary_dir" ] || [ -L "$temporary_dir" ]; }; then
    rm -rf -- "$temporary_dir"
  fi
  if [ -n "$backup_path" ] && { [ -e "$backup_path" ] || [ -L "$backup_path" ]; } && ! { [ -e "$target" ] || [ -L "$target" ]; }; then
    mv -- "$backup_path" "$target"
  fi
}
trap cleanup EXIT HUP INT TERM
cp -R "$source_dir/." "$temporary_dir"
if [ -e "$target" ] || [ -L "$target" ]; then
  backup_path="$(mktemp -d "$parent_dir/.build-flowise-agentflow.backup.XXXXXX")"
  rmdir -- "$backup_path"
  mv -- "$target" "$backup_path"
fi
if ! mv -- "$temporary_dir" "$target"; then
  printf '%s\n' 'Failed to activate the global skill copy; the previous installation was restored.' >&2
  exit 1
fi
temporary_dir=''
if [ -n "$backup_path" ]; then
  rm -rf -- "$backup_path"
  backup_path=''
fi
trap - EXIT HUP INT TERM
printf '%s\n' 'Installed global skill copy.'
