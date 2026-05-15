#!/usr/bin/env bash
#
# Usage:
#   source ./config/load-env.sh
#   source ./config/load-env.sh project
#
# Loads environment variables from .env files into the current shell session.
# Search order for files:
#   1) config/
#   2) project root (backward compatibility)

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Please source this script so variables stay in your current shell:"
  echo "  source ./config/load-env.sh [environment]"
  exit 1
fi

set -euo pipefail

environment="${1:-default}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

resolve_env_file() {
  local file_name="$1"
  if [ -f "${script_dir}/${file_name}" ]; then
    printf '%s\n' "${script_dir}/${file_name}"
    return 0
  fi
  if [ -f "${project_root}/${file_name}" ]; then
    printf '%s\n' "${project_root}/${file_name}"
    return 0
  fi
  return 1
}

env_file_name=".env.local"
if [ "${environment}" != "default" ]; then
  env_file_name=".env.${environment}.local"
fi

if ! env_file="$(resolve_env_file "${env_file_name}")"; then
  echo "Env file not found: ${env_file_name}"
  echo "Create it in config/ or project root."
  return 1
fi

base_env_file=""
if [ "${environment}" != "default" ]; then
  if base_resolved="$(resolve_env_file ".env.local")"; then
    base_env_file="${base_resolved}"
  fi
fi

load_env_file() {
  local file_path="$1"
  local line key value
  local line_count=0
  local var_count=0

  echo
  echo "Loading $(basename "${file_path}")"

  while IFS= read -r line || [ -n "${line}" ]; do
    line_count=$((line_count + 1))

    case "${line}" in
      ''|'#'*) continue ;;
    esac

    if [[ "${line}" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      export "${key}=${value}"
      var_count=$((var_count + 1))
      echo "  loaded ${key}"
    fi
  done < "${file_path}"

  echo "Loaded ${var_count} variable(s) from ${line_count} line(s)."
}

if [ -n "${base_env_file}" ]; then
  load_env_file "${base_env_file}"
fi
load_env_file "${env_file}"

echo "Environment variables are now available in this shell session."
