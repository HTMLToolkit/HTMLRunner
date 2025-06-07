#!/bin/bash
set -e

echo "Building HTMLRunner"

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT/Build" || { echo "Build directory not found"; exit 1; }

# Ensure dependencies are installed
echo "Installing dependencies..."
npm install

echo "Running build..."
npm run build || { echo "npm build failed"; exit 1; }

echo "Built HTMLRunner"
