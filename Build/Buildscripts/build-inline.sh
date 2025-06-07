#!/bin/bash
set -euo pipefail

echo "Starting inlining process..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/../dist"

HTML_FILE="$DIST_DIR/index.html"
CSS_FILE="$DIST_DIR/styles.css"
JS_FILE="$DIST_DIR/main.js"
OUTPUT_FILE="$DIST_DIR/index-inline.html"

# Check that required files exist
if [[ ! -f "$HTML_FILE" || ! -f "$CSS_FILE" || ! -f "$JS_FILE" ]]; then
  echo "Missing one or more required files in $DIST_DIR."
  exit 1
fi

# Step 1: Create a backup of the original HTML
cp "$HTML_FILE" "$OUTPUT_FILE"

# Step 2: Read and indent CSS and JS
INDENTED_CSS=$(sed 's/^/  /' "$CSS_FILE")
INDENTED_JS=$(sed 's/^/  /' "$JS_FILE")

# Step 3: Replace <link> and <script> tags with placeholders
sed -i.bak 's|<link[^>]*data-inline="true"[^>]*href="styles\.css"[^>]*>|@@INLINE_CSS@@|g' "$OUTPUT_FILE"
sed -i.bak "s|<link[^>]*data-inline=\"true\"[^>]*href='styles\.css'[^>]*>|@@INLINE_CSS@@|g" "$OUTPUT_FILE"
sed -i.bak 's|<script[^>]*data-inline="true"[^>]*src="main\.js"[^>]*></script>|@@INLINE_JS@@|g' "$OUTPUT_FILE"
sed -i.bak "s|<script[^>]*data-inline=\"true\"[^>]*src='main\.js'[^>]*></script>|@@INLINE_JS@@|g" "$OUTPUT_FILE"

# Step 4: Write indented CSS and JS to temporary files
INLINE_CSS_FILE=$(mktemp)
INLINE_JS_FILE=$(mktemp)

{
  echo "  <style>"
  echo "$INDENTED_CSS"
  echo "  </style>"
} > "$INLINE_CSS_FILE"

{
  echo "  <script>"
  echo "$INDENTED_JS"
  echo "  </script>"
} > "$INLINE_JS_FILE"

# Step 5: Replace placeholders with inline content
awk -v css="$INLINE_CSS_FILE" -v js="$INLINE_JS_FILE" '
/@@INLINE_CSS@@/ {
    while ((getline line < css) > 0) print line
    close(css)
    next
}
/@@INLINE_JS@@/ {
    while ((getline line < js) > 0) print line
    close(js)
    next
}
{ print }
' "$OUTPUT_FILE" > "$OUTPUT_FILE.tmp" && mv "$OUTPUT_FILE.tmp" "$OUTPUT_FILE"

# Clean up
rm -f "$INLINE_CSS_FILE" "$INLINE_JS_FILE" "$OUTPUT_FILE.bak"

echo "Inlined output written to $OUTPUT_FILE"
