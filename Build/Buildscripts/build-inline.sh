#!/bin/bash
echo "Starting inlining process..."
DIST_DIR="../dist"
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

# Step 3: Replace <link> and <script> tags with placeholders (only those marked for inlining)
sed -i.bak 's|<link[^>]*data-inline="true"[^>]*href="styles\.css"[^>]*>|@@INLINE_CSS@@|g' "$OUTPUT_FILE"
sed -i.bak "s|<link[^>]*data-inline=\"true\"[^>]*href='styles\.css'[^>]*>|@@INLINE_CSS@@|g" "$OUTPUT_FILE"
sed -i.bak 's|<script[^>]*data-inline="true"[^>]*src="main\.js"[^>]*></script>|@@INLINE_JS@@|g' "$OUTPUT_FILE"
sed -i.bak "s|<script[^>]*data-inline=\"true\"[^>]*src='main\.js'[^>]*></script>|@@INLINE_JS@@|g" "$OUTPUT_FILE"

# Step 4: Write the indented CSS and JS to temporary files
echo "  <style>" > /tmp/inlined_css
echo "$INDENTED_CSS" >> /tmp/inlined_css
echo "  </style>" >> /tmp/inlined_css

echo "  <script>" > /tmp/inlined_js
echo "$INDENTED_JS" >> /tmp/inlined_js
echo "  </script>" >> /tmp/inlined_js

# Step 5: Replace placeholders with actual content
# Use a different approach for multiline replacement
awk '
/@@INLINE_CSS@@/ {
    while ((getline line < "/tmp/inlined_css") > 0) {
        print line
    }
    close("/tmp/inlined_css")
    next
}
/@@INLINE_JS@@/ {
    while ((getline line < "/tmp/inlined_js") > 0) {
        print line
    }
    close("/tmp/inlined_js")
    next
}
{ print }
' "$OUTPUT_FILE" > "$OUTPUT_FILE.tmp" && mv "$OUTPUT_FILE.tmp" "$OUTPUT_FILE"

# Clean up temporary files and backup
rm -f /tmp/inlined_css /tmp/inlined_js "$OUTPUT_FILE.bak"

echo "Inlined output written to $OUTPUT_FILE"