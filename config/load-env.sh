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

is_set() {
  local key="$1"
  local value="${!key-}"
  [ -n "${value}" ]
}

missing_vars=()
if [ "${environment}" = "project" ]; then
  required_vars=(
    ZEUS_FETCH_HOST
    ZEUS_FETCH_PORT
    ZEUS_FETCH_USER
    ZEUS_FETCH_PASSWORD
    ZEUS_FETCH_IFS_DIR
    ZEUS_FETCH_OUT
    ZEUS_DB_HOST
    ZEUS_DB_USER
    ZEUS_DB_PASSWORD
  )
else
  required_vars=(
    ZEUS_OUTPUT_ROOT
    ZEUS_SOURCE_ROOT
    ZEUS_DB_HOST
    ZEUS_DB_USER
    ZEUS_DB_PASSWORD
  )
fi

for key in "${required_vars[@]}"; do
  if ! is_set "${key}"; then
    missing_vars+=("${key}")
  fi
done

if [ "${environment}" = "project" ]; then
  if ! is_set "ZEUS_FETCH_SOURCE_LIB" && ! is_set "ZEUS_FETCH_SOURCE_LIBRARY"; then
    missing_vars+=("ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY")
  fi
fi

if [ "${#missing_vars[@]}" -gt 0 ]; then
  echo
  echo "Warning: critical variables are missing:"
  for key in "${missing_vars[@]}"; do
    echo "  - ${key}"
  done
else
  echo
  echo "All critical variables are set."
fi

echo "Environment variables are now available in this shell session."
