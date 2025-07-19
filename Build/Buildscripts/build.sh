#!/bin/bash
set -e

echo "Building HTMLRunner"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"  # one level up to /Build

cd "$ROOT_DIR"

npm install
npm run build

echo "Build completed."
