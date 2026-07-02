#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh"
export EMSDK="${EMSDK:-$HOME/emsdk}"

if [ ! -d "src/libs/build/opencv" ]; then
  echo "Building native deps (first run may take 30–60 min)..."
  (cd src/libs && ./build.sh)
fi

mkdir -p src/slam/build
cd src/slam/build
emcmake cmake ..
emmake make install
cd "$ROOT"

node scripts/sync-post-js.js
node scripts/copy-wasm.js
echo "build-wasm: done"
