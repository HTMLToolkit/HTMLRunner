import { editor } from "./editor";
import { consoleInterceptor } from "./console";
import { showError, showLoading, hideLoading, switchOutput } from "./ui";
import { clearConsole, logConsoleError } from "./console";
import { filesState } from "./appState";
import type { FileTab } from "./types";

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
        ([
          prettier,
          parserHtml,
          parserCss,
          parserBabel,
          prettierPluginEstree,
        ]) => ({
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

function getFileByExt(files: FileTab[], ext: string): string {
  const file = files.find((f) => {
    const fext = f.name.split(".").pop()?.toLowerCase();
    return fext === ext;
  });
  return file?.content ?? "";
}

export function runCode(): void {
  showLoading();
  clearConsole();
  try {
    const files = filesState.get();
    const html = getFileByExt(files, "html") || getFileByExt(files, "htm");
    const css = getFileByExt(files, "css");
    const js = getFileByExt(files, "js") || getFileByExt(files, "mjs");

    try {
      if (js.trim()) new Function(js);
    } catch (syntaxError: unknown) {
      const msg =
        syntaxError instanceof Error
          ? syntaxError.message
          : String(syntaxError);
      logConsoleError(`SyntaxError: ${msg}`);
      hideLoading();
      return;
    }

    const hasDocTag = /<html[\s>/]|<!doctype\s+html/i.test(html);

    const docContent = hasDocTag
      ? assembleFullHtml(html, css, js)
      : [
          '<!DOCTYPE html><html><head><meta charset="UTF-8">',
          "<style>",
          css,
          "</style>",
          "<script>",
          consoleInterceptor,
          "</script>",
          "</head><body>",
          html,
          "</body>",
          "<script>",
          js,
          "</script></html>",
        ].join("");

    const blob = new Blob([docContent], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const preview = getPreview();
    if (!preview)
      throw new Error("Preview element not found or is not an iframe");
    preview.src = url;
    preview.addEventListener("load", () => URL.revokeObjectURL(url), {
      once: true,
    });
    switchOutput("preview");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(`Error running code: ${msg}`);
  } finally {
    hideLoading();
  }
}

function assembleFullHtml(html: string, css: string, js: string): string {
  const interceptorScript = `<script>${consoleInterceptor}<\/script>`;
  const styleTag = css.trim() ? `<style>${css}<\/style>` : "";
  const scriptTag = js.trim() ? `<script>${js}<\/script>` : "";
  const headInjection = [interceptorScript, styleTag].filter(Boolean).join("\n");
  const bodyInjection = scriptTag;

  let result = html;

  const headMatch = result.match(/(<\/head\s*>)/i);
  if (headMatch && headInjection) {
    result = result.slice(0, headMatch.index) +
      headInjection + "\n" +
      result.slice(headMatch.index);
  }

  const bodyMatch = result.match(/(<\/body\s*>)/i);
  if (bodyMatch && bodyInjection) {
    result = result.slice(0, bodyMatch.index) +
      bodyInjection + "\n" +
      result.slice(bodyMatch.index);
  }

  if (!headMatch && !bodyMatch) {
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

let _previewEl: HTMLIFrameElement | null | undefined;
function getPreview(): HTMLIFrameElement | null {
  if (_previewEl === undefined) {
    const el = document.getElementById("preview");
    _previewEl = el instanceof HTMLIFrameElement ? el : null;
  }
  return _previewEl || null;
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
