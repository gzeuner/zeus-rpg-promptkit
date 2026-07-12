#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Missing node_modules. Run: npm install"
  exit 2
fi

echo "=== Golden Path Step 1-2: install + doctor (local) ==="
node cli/zeus.js doctor --help || true

node cli/zeus.js analyze \
  --source ./examples/demo-rpg-mini-system/rpg_sources \
  --program PROGRAM_100 \
  --out ./examples/demo-rpg-mini-system/output-baseline \
  --mode documentation \
  --optimize-context \
  --reproducible

rm -rf ./examples/demo-rpg-mini-system/output-baseline/.zeus-cache

echo "Demo analyze run completed."

echo "=== Demo: investigation + review (package 08 goal -> artifacts) ==="
INV_OUT=./examples/demo-rpg-mini-system/output-baseline
node cli/zeus.js investigate --program PROGRAM_100 --out "$INV_OUT" --goal "Review ID/STATUS field lineage, usage, impact and deployment risk in demo mini-system" --search "ID,STATUS,AMOUNT" || true
node cli/zeus.js trace --field ID --start-program PROGRAM_200 --source ./examples/demo-rpg-mini-system/rpg_sources || true
node cli/zeus.js xref --program PROGRAM_200 --source ./examples/demo-rpg-mini-system/rpg_sources || true
node cli/zeus.js impact --target ID --program PROGRAM_100 --out "$INV_OUT" --source ./examples/demo-rpg-mini-system/rpg_sources || true
node cli/zeus.js assess-risk --program PROGRAM_100 --out "$INV_OUT" || true
node cli/zeus.js generate-test --program PROGRAM_100 --format markdown --out "$INV_OUT" || true
node cli/zeus.js generate-checklist --program PROGRAM_100 --out "$INV_OUT" || true
node cli/zeus.js qa --input "$INV_OUT/PROGRAM_100" --format markdown || true

echo "=== Golden Path Step 9: reproducible bundle ==="
node cli/zeus.js bundle --program PROGRAM_100 --output "$INV_OUT/bundle" --include-json --include-md --safe-sharing || true

echo "=== Golden Path Step 11: verify artifacts ==="
ls -l "$INV_OUT/PROGRAM_100/" | cat
ls -l "$INV_OUT/bundle/" | cat || true
echo "Demo golden path (investigation to review bundle) completed."
