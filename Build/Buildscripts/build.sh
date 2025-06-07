#!/bin/bash
set -e

echo "Building HTMLRunner"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"  # now inside /Build

npm install
npm run build

echo "Build completed."
