#!/usr/bin/env bash
#
# Usage:
#   source ./config/load-env.sh
#   source ./config/load-env.sh project
#   source ./config/load-env.sh project --quiet
#   source ./config/load-env.sh project --verbose
#
# Loads environment variables from .env files into the current shell session.
# Search order for files:
#   1) config/local-only/   (preferred location for gitignored credentials)
#   2) config/
#   3) project root (backward compatibility)

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Please source this script so variables stay in your current shell:"
  echo "  source ./config/load-env.sh [environment]"
  exit 1
fi

environment="default"
quiet=false
verbose=false
for argument in "$@"; do
  case "${argument}" in
    --quiet) quiet=true ;;
    --verbose) verbose=true ;;
    --*) echo "Unknown loader option." >&2; return 2 ;;
    *)
      if [[ ! "${argument}" =~ ^[A-Za-z0-9_-]+$ ]]; then
        echo "Invalid environment name." >&2
        return 2
      fi
      environment="${argument}"
      ;;
  esac
done
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

resolve_env_file() {
  local file_name="$1"
  if [ -f "${script_dir}/local-only/${file_name}" ]; then
    printf '%s\n' "${script_dir}/local-only/${file_name}"
    return 0
  fi
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
  echo "Create it in config/local-only/ (preferred), config/ or project root."
  return 2
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
  local var_count=0

  while IFS= read -r line || [ -n "${line}" ]; do
    if [[ "${line}" =~ ^(.*)[[:space:]]+#.*$ ]]; then
      line="${BASH_REMATCH[1]}"
    fi
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    case "${line}" in
      ''|'#'*) continue ;;
    esac

    if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      export "${key}=${value}"
      var_count=$((var_count + 1))
      if [ "${verbose}" = true ] && [ "${quiet}" = false ]; then
        echo "  ${key} (value hidden)"
      fi
    fi
  done < "${file_path}"

  if [ "${quiet}" = false ]; then
    echo "Loaded $(basename "${file_path}"): ${var_count} variable(s)."
  fi
}

if [ -n "${base_env_file}" ]; then
  load_env_file "${base_env_file}"
fi
load_env_file "${env_file}"

is_set() {
  local key="$1"
  local value="${!key-}"
  [[ "${value}" =~ [^[:space:]] ]]
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
    ZEUS_DB_USER
    ZEUS_DB_PASSWORD
  )
else
  required_vars=(
    ZEUS_OUTPUT_ROOT
    ZEUS_SOURCE_ROOT
    ZEUS_DB_USER
    ZEUS_DB_PASSWORD
  )
fi

if [[ "${ZEUS_JDBC_ONLY:-}" =~ ^(1|true|yes|on)$ ]]; then
  required_vars=()
fi

for key in "${required_vars[@]}"; do
  if ! is_set "${key}"; then
    missing_vars+=("${key}")
  fi
done

if [[ ! "${ZEUS_JDBC_ONLY:-}" =~ ^(1|true|yes|on)$ ]] && ! is_set "ZEUS_DB_HOST" && ! is_set "ZEUS_DB_URL"; then
  missing_vars+=("ZEUS_DB_HOST|ZEUS_DB_URL")
fi

if [ "${environment}" = "project" ]; then
  if ! is_set "ZEUS_FETCH_SOURCE_LIB" && ! is_set "ZEUS_FETCH_SOURCE_LIBRARY"; then
    missing_vars+=("ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY")
  fi
fi

if [ "${#missing_vars[@]}" -gt 0 ]; then
  echo
  echo "Critical variables are missing:"
  for key in "${missing_vars[@]}"; do
    echo "  - ${key}"
  done
  return 3
else
  if [ "${verbose}" = true ] && [ "${quiet}" = false ]; then
    echo "Environment variables are available in this shell session only."
  fi
fi
