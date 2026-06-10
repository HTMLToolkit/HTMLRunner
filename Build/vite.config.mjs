import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";
import fs from "fs";
import path from "path";

// SVG inliner plugin
function inlineSvgFaviconPlugin(options) {
  return {
    name: "inline-svg-favicon",
    enforce: "post",
    transformIndexHtml(html) {
      if (!fs.existsSync(options.svg)) return html;
      const ext = path.extname(options.svg).toLowerCase();
      let faviconTag = "";

      try {
        if (ext === ".svg") {
          let svgContent = fs.readFileSync(options.svg, "utf8");
          svgContent = svgContent
            .replace(/<\?xml[^>]*>\s*/g, "")
            .replace(/\s+/g, " ");
          const base64 = Buffer.from(svgContent).toString("base64");
          faviconTag = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${base64}"/>\n`;
        } else {
          // Non-SVG (png, ico, etc.) — read binary and base64-encode
          const buf = fs.readFileSync(options.svg);
          const base64 = buf.toString("base64");
          const mime = ext === ".png" ? "image/png" : ext === ".ico" ? "image/x-icon" : "application/octet-stream";
          faviconTag = `<link rel="icon" type="${mime}" href="data:${mime};base64,${base64}"/>\n`;
        }
      } catch (e) {
        // If reading fails, don't modify the HTML
        return html;
      }

      return html.replace(/<head>(.*?)/, `<head>$1\n  ${faviconTag}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), "");
  const isSingleFile = env.SINGLE_FILE === "true";

  return {
    base: "./",
    plugins: [
      !isSingleFile &&
        VitePWA({
          strategies: 'injectManifest',
          srcDir: 'src',
          filename: 'sw.ts',
          registerType: 'autoUpdate',
          includeAssets: ['robots.txt'],

          manifest: {
            name: 'HTMLRunner',
            short_name: 'HTMLRunner',
            start_url: './',
            display: 'standalone',
            theme_color: '#f5f5f5',
            background_color: '#2196F3',
          },
          pwaAssets: {
            image: 'public/favicon.png',
            preset: 'minimal-2023',
            includeHtmlHeadLinks: true,
          },
          injectManifest: {
            globPatterns: ['**/*.{js,css,html,png,ico,json}'],
            rollupFormat: 'iife',
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          },
        }),
      isSingleFile && viteSingleFile(),
      isSingleFile && inlineSvgFaviconPlugin({ svg: "public/favicon.png" }),
    ].filter(Boolean),

    define: {
      global: "globalThis",
    },

    worker: {
      format: "es",
    },

    build: {
      sourcemap: !isSingleFile,
      outDir: "./dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
    },
  };
});
