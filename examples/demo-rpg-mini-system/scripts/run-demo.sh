#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Missing node_modules. Run: npm install"
  exit 2
fi

node cli/zeus.js analyze \
  --source ./examples/demo-rpg-mini-system/rpg_sources \
  --program PROGRAM_100 \
  --out ./examples/demo-rpg-mini-system/output-baseline \
  --mode documentation \
  --optimize-context \
  --reproducible

rm -rf ./examples/demo-rpg-mini-system/output-baseline/.zeus-cache

echo "Demo analyze run completed."
