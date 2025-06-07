#!/bin/bash
echo "Starting full build..."
echo ""
./build.sh
echo ""
./build-inline.sh
echo ""
echo "Full build completed."