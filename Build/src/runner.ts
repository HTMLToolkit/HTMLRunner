import { consoleInterceptor, navigationInterceptor } from "./console";
import { showLoading, showError, hideLoading, switchOutput } from "./ui";
import { clearConsole, logConsoleError } from "./console";
import { filesState, activeFileState } from "./appState";
import type { FileTab } from "./types";

// Markdown preview renderer

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeUrl(url: string): string {
  const stripped = url.trim();
  try {
    const parsed = new URL(stripped);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return stripped;
    return "#";
  } catch {
    return stripped;
  }
}

function inlineMarkdown(s: string): string {
  const escaped = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, text: string, url: string) =>
        `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`,
    )
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_m, alt: string, url: string) =>
        `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`,
    );
}

export function renderMarkdownPreview(md: string): string {
  const lines = md.split("\n");
  const html: string[] = ['<div class="md-preview">'];
  let inCodeBlock = false;
  let codeContent = "";
  let codeLang = "";
  let inParagraph = false;

  function flushParagraph() {
    if (inParagraph) { html.push("</p>"); inParagraph = false; }
  }
  function startParagraph() {
    if (!inParagraph) { html.push("<p>"); inParagraph = true; }
  }

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushParagraph();
        html.push(`<pre><code class="language-${codeLang}">${escapeHtml(codeContent.trimEnd())}</code></pre>`);
        codeContent = "";
        codeLang = "";
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + "\n";
      continue;
    }

    if (line === "") {
      flushParagraph();
      continue;
    }

    // Headers
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      flushParagraph();
      const level = hMatch[1].length;
      html.push(`<h${level}>${inlineMarkdown(hMatch[2])}</h${level}>`);
      continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushParagraph();
      html.push("<hr>");
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      flushParagraph();
      html.push(`<li>${inlineMarkdown(ulMatch[2])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      flushParagraph();
      html.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      flushParagraph();
      html.push(`<blockquote>${inlineMarkdown(bqMatch[1])}</blockquote>`);
      continue;
    }

    startParagraph();
    html.push(line ? inlineMarkdown(line) + " " : "<br>");
  }

  flushParagraph();
  if (inCodeBlock) {
    html.push(`<pre><code class="language-${codeLang}">${escapeHtml(codeContent.trimEnd())}</code></pre>`);
  }

  html.push("</div>");
  return html.join("\n");
}

let prevMdBlobUrl: string | null = null;

function renderMarkdownInPreview(md: string): void {
  const preview = document.getElementById("preview") as HTMLIFrameElement | null;
  if (!preview) return;
  const isDark = document.body.classList.contains("dark-mode");
  const css = isDark
    ? "body{background:#1e1e1e;color:#e0e0e0}pre,code{background:#2d2d2d}blockquote{color:#999}h1,h2,h3{border-bottom-color:#333}td,th{border-color:#444}th{background:#2d2d2d}hr{border-top-color:#333}"
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.8;color:#333;background:#fff}
pre{background:#f5f5f5;padding:16px;border-radius:6px;overflow-x:auto}
code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:0.9em}
pre code{background:none;padding:0}
img{max-width:100%;border-radius:4px}
blockquote{border-left:4px solid #2196F3;margin:16px 0;padding:8px 20px;color:#666}
h1,h2,h3{border-bottom:1px solid #eee;padding-bottom:8px;margin-top:24px}
table{border-collapse:collapse;width:100%;margin:16px 0}
td,th{border:1px solid #ddd;padding:10px;text-align:left}
th{background:#f5f5f5}
hr{border:none;border-top:2px solid #eee;margin:24px 0}
a{color:#2196F3}
${css}
</style>
</head>
<body>${renderMarkdownPreview(md)}</body>
</html>`;
  if (prevMdBlobUrl) URL.revokeObjectURL(prevMdBlobUrl);
  const blob = new Blob([html], { type: "text/html; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  prevMdBlobUrl = url;
  preview.src = url;
}

type PrettierBundle = {
  prettier: typeof import("prettier/standalone");
  parserHtml: typeof import("prettier/plugins/html");
  parserCss: typeof import("prettier/plugins/postcss");
  parserBabel: typeof import("prettier/plugins/babel");
  prettierPluginEstree: typeof import("prettier/plugins/estree");
};

let prettierBundlePromise: Promise<PrettierBundle> | undefined;

async function loadPrettierBundle(): Promise<PrettierBundle> {
  if (!prettierBundlePromise) {
    prettierBundlePromise = Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ])
      .then(
        ([prettier, parserHtml, parserCss, parserBabel, prettierPluginEstree]) => ({
          prettier,
          parserHtml,
          parserCss,
          parserBabel,
          prettierPluginEstree,
        }),
      )
      .catch((err) => {
        prettierBundlePromise = undefined;
        throw err;
      });
  }
  return prettierBundlePromise;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  cjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  wasm: "application/wasm",
};

function mimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "text/plain; charset=utf-8";
}

const SANDBOX_CACHE = "sandbox-v1";
const SANDBOX_BASE = (() => {
  const base = new URL("./sandbox/", location.href).href;
  return base.endsWith("/") ? base : base + "/";
})();

async function populateSandboxCache(files: FileTab[]): Promise<string> {
  const cache = await caches.open(SANDBOX_CACHE);
  const oldKeys = await cache.keys();
  await Promise.all(oldKeys.map((r) => cache.delete(r)));

  for (const file of files) {
    const url = SANDBOX_BASE + file.name;
    const resp = new Response(file.content, {
      headers: { "Content-Type": mimeType(file.name) },
    });
    cache.put(url, resp);
  }

  const html = generatePreviewHtml(files);
  const htmlUrl = SANDBOX_BASE + "index.html";
  const htmlResp = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  cache.put(htmlUrl, htmlResp);
  return htmlUrl;
}

function generatePreviewHtml(files: FileTab[]): string {
  const htmlFile = files.find((f) => /\.html?$/i.test(f.name));
  const cssFiles = files.filter((f) => /\.css$/i.test(f.name));
  const jsFiles = files.filter((f) => /\.m?js$/i.test(f.name));

  const rawHtml = htmlFile?.content ?? "";
  const hasDocTag = /<html[\s>/]|<!doctype\s+html/i.test(rawHtml);

  if (hasDocTag) {
    return injectIntoFullHtml(rawHtml, cssFiles, jsFiles);
  }

  return buildStandaloneHtml(rawHtml, cssFiles, jsFiles);
}

function buildStandaloneHtml(
  bodyHtml: string,
  cssFiles: FileTab[],
  jsFiles: FileTab[],
): string {
  const lines: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<script>${consoleInterceptor}${navigationInterceptor}</script>`,
  ];

  for (const css of cssFiles) {
    if (css.content.trim()) {
      lines.push(`<link rel="stylesheet" href="${css.name}">`);
    }
  }

  lines.push("</head>", "<body>");

  if (bodyHtml.trim()) {
    lines.push(bodyHtml);
  }

  for (const js of jsFiles) {
    if (js.content.trim()) {
      lines.push(`<script src="${js.name}"></script>`);
    }
  }

  lines.push("</body>", "</html>");
  return lines.join("\n");
}

function injectIntoFullHtml(
  html: string,
  cssFiles: FileTab[],
  jsFiles: FileTab[],
): string {
  let result = html;

  const hasInterceptor = result.includes(consoleInterceptor);
  if (!hasInterceptor) {
    const interceptorTag = `<script>${consoleInterceptor}${navigationInterceptor}</script>`;
    const headMatch = result.match(/(<\/head\s*>)/i);
    if (headMatch) {
      result =
        result.slice(0, headMatch.index) +
        interceptorTag + "\n" +
        result.slice(headMatch.index);
    } else {
      const htmlMatch = result.match(/(<\/html\s*>)/i);
      if (htmlMatch) {
        result =
          result.slice(0, htmlMatch.index) +
          interceptorTag + "\n" +
          result.slice(htmlMatch.index);
      } else {
        result = interceptorTag + "\n" + result;
      }
    }
  }

  for (const css of cssFiles) {
    if (!css.content.trim()) continue;
    const cssLink = `<link rel="stylesheet" href="${css.name}">`;
    if (!result.includes(css.name)) {
      result = result.replace(
        /(<\/head\s*>)/i,
        `${cssLink}\n$1`,
      );
    }
  }

  for (const js of jsFiles) {
    if (!js.content.trim()) continue;
    const jsTag = `<script src="${js.name}"></script>`;
    if (!result.includes(js.name)) {
      result = result.replace(
        /(<\/body\s*>)/i,
        `${jsTag}\n$1`,
      );
    }
  }

  return result;
}

function getPreview(): HTMLIFrameElement | null {
  const el = document.getElementById("preview");
  return el instanceof HTMLIFrameElement ? el : null;
}

async function ensureSW(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return false;
  try {
    await navigator.serviceWorker.ready;
    return true;
  } catch {
    return false;
  }
}

function inlineCssFiles(files: FileTab[]): string {
  return files
    .filter((f) => /\.css$/i.test(f.name) && f.content.trim())
    .map((f) => `<style>${f.content}</style>`)
    .join("\n");
}

function inlineJsFiles(files: FileTab[]): string {
  return files
    .filter((f) => /\.m?js$/i.test(f.name) && f.content.trim())
    .map((f) => `<script>${f.content}</script>`)
    .join("\n");
}

let prevBlobUrl: string | null = null;

function runBlobFallback(files: FileTab[], preview: HTMLIFrameElement): void {
  const htmlFile = files.find((f) => /\.html?$/i.test(f.name));
  const rawHtml = htmlFile?.content ?? "";
  const hasDocTag = /<html[\s>/]|<!doctype\s+html/i.test(rawHtml);

  const cssInlined = inlineCssFiles(files);
  const jsInlined = inlineJsFiles(files);

  const docContent = hasDocTag
    ? injectBlobHtml(rawHtml, cssInlined, jsInlined)
    : [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        `<script>${consoleInterceptor}${navigationInterceptor}</script>`,
        cssInlined,
        "</head><body>",
        rawHtml,
        jsInlined,
        "</body></html>",
      ].filter(Boolean).join("");

  if (prevBlobUrl) URL.revokeObjectURL(prevBlobUrl);
  const blob = new Blob([docContent], { type: "text/html; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  prevBlobUrl = url;
  preview.src = url;
}

function injectBlobHtml(html: string, cssLinks: string, jsLinks: string): string {
  let result = html;
  const interceptorScript = `<script>${consoleInterceptor}${navigationInterceptor}</script>`;

  const headInjection = [interceptorScript, cssLinks].filter(Boolean).join("\n");
  const bodyInjection = jsLinks;

  result = result.replace(/(<\/head\s*>)/i, `${headInjection}\n$1`);
  result = result.replace(/(<\/body\s*>)/i, `${bodyInjection}\n$1`);

  if (!/<head/i.test(result)) {
    result = [
      '<!DOCTYPE html><html><head><meta charset="UTF-8">',
      headInjection,
      "</head><body>",
      result,
      bodyInjection,
      "</body></html>",
    ].filter(Boolean).join("");
  }
  return result;
}

export async function runCode(): Promise<void> {
  showLoading();
  try {
    clearConsole();
    const files = filesState.get();
    if (files.length === 0) {
      hideLoading();
      return;
    }

    const js = files.find((f) => /\.m?js$/i.test(f.name))?.content ?? "";
    if (js.trim()) {
      try {
        new Function(js);
      } catch (syntaxError: unknown) {
        const msg = syntaxError instanceof Error ? syntaxError.message : String(syntaxError);
        logConsoleError(`SyntaxError: ${msg}`);
        hideLoading();
        return;
      }
    }

    // Markdown: render preview directly
    const activeId = activeFileState.get();
    const activeFile = files.find((f) => f.id === activeId);
    if (activeFile && /\.md$/i.test(activeFile.name)) {
      renderMarkdownInPreview(activeFile.content);
      switchOutput("preview");
      return;
    }

    const preview = getPreview();
    if (!preview) throw new Error("Preview element not found");

    const swOk = await ensureSW();
    if (swOk) {
      preview.src = await populateSandboxCache(files);
    } else {
      runBlobFallback(files, preview);
    }

    switchOutput("preview");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(`Error running code: ${msg}`);
  } finally {
    hideLoading();
  }
}

export async function formatCode(): Promise<void> {
  try {
    const {
      prettier,
      parserHtml,
      parserCss,
      parserBabel,
      prettierPluginEstree,
    } = await loadPrettierBundle();

    const pHtml =
      (parserHtml as unknown as { default?: unknown }).default || parserHtml;
    const pCss =
      (parserCss as unknown as { default?: unknown }).default || parserCss;
    const pBabel =
      (parserBabel as unknown as { default?: unknown }).default || parserBabel;
    const pEstree =
      (prettierPluginEstree as unknown as { default?: unknown }).default ||
      prettierPluginEstree;

    const files = filesState.get();

    const formatFile = async (file: FileTab): Promise<string> => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const content = file.content.trim();
      if (!content) return file.content;

      try {
        switch (ext) {
          case "html":
          case "htm":
            return await prettier.format(content, {
              parser: "html",
              plugins: [pHtml],
              printWidth: 120,
              tabWidth: 4,
              htmlWhitespaceSensitivity: "ignore",
              bracketSameLine: true,
              singleAttributePerLine: false,
            });
          case "css":
            return await prettier.format(content, {
              parser: "css",
              plugins: [pCss],
              printWidth: 100,
              tabWidth: 2,
            });
          case "js":
          case "mjs":
          case "cjs":
          case "jsx":
            return await prettier.format(content, {
              parser: "babel",
              plugins: [pBabel, pEstree],
              printWidth: 100,
              tabWidth: 2,
              semi: true,
              singleQuote: true,
              trailingComma: "es5",
              bracketSpacing: true,
            });
          case "ts":
          case "tsx":
            try {
              return await prettier.format(content, {
                parser: "babel-ts",
                plugins: [pBabel, pEstree],
                printWidth: 100,
                tabWidth: 2,
                semi: true,
                singleQuote: true,
              });
            } catch {
              return file.content;
            }
          default:
            return file.content;
        }
      } catch {
        return file.content;
      }
    };

    const formatted = await Promise.all(files.map(formatFile));
    const updated = files.map((f, i) => ({
      ...f,
      content: formatted[i],
    }));
    filesState.set(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(`Error formatting code: ${msg}`);
  }
}
