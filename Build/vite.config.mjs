import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import fs from "fs";
import path from "path";

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
          const buf = fs.readFileSync(options.svg);
          const base64 = buf.toString("base64");
          const mime = ext === ".png" ? "image/png" : ext === ".ico" ? "image/x-icon" : "application/octet-stream";
          faviconTag = `<link rel="icon" type="${mime}" href="data:${mime};base64,${base64}"/>\n`;
        }
      } catch (e) {
        return html;
      }

      return html.replace(/(<head[^>]*>)/i, `$1\n  ${faviconTag}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isSingleFile = env.SINGLE_FILE === "true";

  return {
    base: "./",
    plugins: [
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
      chunkSizeWarningLimit: 1500,
    },

    optimizeDeps: {
      exclude: ["wasm-git"],
    },
  };
});
