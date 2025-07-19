#!/bin/bash
set -e

echo "Building HTMLRunner"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"         # project root
BUILD_DIR="$ROOT_DIR/Build"                         # e.g., Build/
DIST_DIR="$BUILD_DIR/dist"                          # final output

cd "$BUILD_DIR"

npm install
npm run build

echo "Copying extra files..."
cp "$ROOT_DIR/favicon.png" "$DIST_DIR/"
cp "$ROOT_DIR/manifest.json" "$DIST_DIR/"
cp "$ROOT_DIR/service-worker.js" "$DIST_DIR/"

echo "Build completed."
