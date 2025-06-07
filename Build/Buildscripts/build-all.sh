#!/bin/bash
set -e  # Exit immediately on error

echo "Starting full build..."
echo ""

# Determine the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run each script relative to this directory
"$SCRIPT_DIR/build.sh"
echo ""
"$SCRIPT_DIR/build-inline.sh"
echo ""

echo "Full build completed."
