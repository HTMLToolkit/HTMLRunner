import { editors } from "./editor";
import { consoleInterceptor } from "./console";
import { showError, showLoading, hideLoading, switchOutput } from "./ui";
import { clearConsole, logConsoleError } from "./console";

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
    ]).then(
      ([prettier, parserHtml, parserCss, parserBabel, prettierPluginEstree]) => ({
        prettier,
        parserHtml,
        parserCss,
        parserBabel,
        prettierPluginEstree,
      })
    ).catch((err) => {
      // Reset cached promise so future attempts can retry
      prettierBundlePromise = undefined;
      throw err;
    });
  }

  return prettierBundlePromise;
}

export function runCode(): void {
  showLoading();
  clearConsole();
  try {
    const html = editors.html.view.state.doc.toString();
    const css = editors.css.view.state.doc.toString();
    const js = editors.js.view.state.doc.toString();

    // Pre-parse JS
    try {
      if (js.trim()) new Function(js);
    } catch (syntaxError: any) {
      logConsoleError(`SyntaxError: ${syntaxError.message}`);
      hideLoading();
      return;
    }

    let docContent;
    const isFullHtml = /<html[\s>/]|<!doctype html/i.test(html);
    if (isFullHtml) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      if (!doc.head)
        doc.documentElement.insertBefore(
          document.createElement("head"),
          doc.body
        );
      const script = document.createElement("script");
      script.textContent = consoleInterceptor;
      doc.head.appendChild(script);
      if (css.trim()) {
        const style = document.createElement("style");
        style.textContent = css;
        doc.head.appendChild(style);
      }
      if (js.trim()) {
        const script = document.createElement("script");
        script.textContent = js;
        doc.body.appendChild(script);
      }
      docContent = doc.documentElement.outerHTML;
    } else {
      docContent = [
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
    }

    const blob = new Blob([docContent], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const preview = document.getElementById("preview");
    if (!preview || !(preview instanceof HTMLIFrameElement)) {
      throw new Error("Preview element not found or is not an iframe");
    }
    preview.src = url;
    preview.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    switchOutput("preview");
  } catch (error: any) {
    showError(`Error running code: ${error.message}`);
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

    // Some dynamic imports expose the plugin as default export or as module namespace.
    const pHtml = (parserHtml as any).default || parserHtml;
    const pCss = (parserCss as any).default || parserCss;
    const pBabel = (parserBabel as any).default || parserBabel;
    const pEstree = (prettierPluginEstree as any).default || prettierPluginEstree;

    // Format each editor separately with error handling
    let formattedHtml = editors.html.view.state.doc.toString();
    let formattedCss = editors.css.view.state.doc.toString();
    let formattedJs = editors.js.view.state.doc.toString();

    // Format HTML
    try {
      if (formattedHtml.trim()) {
        // Trim surrounding whitespace
        const normalizedHtml = formattedHtml.trim();

        formattedHtml = await prettier.format(normalizedHtml, {
          parser: "html",
          plugins: [pHtml],
          printWidth: 120,
          tabWidth: 4,
          htmlWhitespaceSensitivity: "ignore",
          bracketSameLine: true,
          singleAttributePerLine: false,
        });

        // Ensure the formatted HTML is well-formed
        formattedHtml = formattedHtml.replace(/>\n\s*\n/g, '>\n');

      }
    } catch (error) {
      console.warn("HTML formatting skipped:", error);
      // Keep original HTML if formatting fails
    }

    // Format CSS
    try {
      if (formattedCss.trim()) {
        formattedCss = await prettier.format(formattedCss, {
          parser: "css",
          plugins: [pCss],
          printWidth: 100,
          tabWidth: 2,
        });
        
      }
    } catch (error) {
      console.warn("CSS formatting failed:", error);
    }

    // Format JavaScript with better error handling
    try {
      if (formattedJs.trim()) {
        formattedJs = await prettier.format(formattedJs, {
          parser: "babel", // Use babel instead of flow
          plugins: [pBabel, pEstree],
          printWidth: 100,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
          trailingComma: "es5",
          bracketSpacing: true,
        });
        
      }
    } catch (error) {
      console.warn("JavaScript formatting failed:", error);
      // Try with a simpler parser as fallback
      try {
        formattedJs = await prettier.format(formattedJs, {
          parser: "babel-ts", // Alternative parser
          plugins: [pBabel, pEstree],
          printWidth: 100,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        });
        
      } catch (fallbackError) {
        console.warn("Fallback JavaScript formatting also failed:", fallbackError);
      }
    }

    // Update editors
    editors.html.view.dispatch({
      changes: {
        from: 0,
        to: editors.html.view.state.doc.length,
        insert: formattedHtml,
      },
    });
    editors.css.view.dispatch({
      changes: {
        from: 0,
        to: editors.css.view.state.doc.length,
        insert: formattedCss,
      },
    });
    editors.js.view.dispatch({
      changes: {
        from: 0,
        to: editors.js.view.state.doc.length,
        insert: formattedJs,
      },
    });
  } catch (error: any) {
    showError(`Error formatting code: ${error.message}`);
  }
}