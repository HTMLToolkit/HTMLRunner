import { editors } from "./editor";
import { consoleInterceptor } from "./console";
import { showError, showLoading, hideLoading, switchOutput } from "./ui";
import { clearConsole, logConsoleError } from "./console";
import { saveState } from "./state";
import * as prettier from "prettier/standalone";
import * as parserHtml from "prettier/plugins/html";
import * as parserCss from "prettier/plugins/postcss";
import * as parserBabel from "prettier/plugins/babel"; // Use Babel instead of Flow
import * as prettierPluginEstree from "prettier/plugins/estree";

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
    const isFullHtml = /<html[\s>]|<!doctype html/i.test(html);
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
        "<\/script>",
        "</head><body>",
        html,
        "<\/body>",
        "<script>",
        js,
        "<\/script><\/html>",
      ].join("");
    }

    const blob = new Blob([docContent], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const preview = document.getElementById("preview");
    if (!preview || !(preview instanceof HTMLIFrameElement)) {
      throw new Error("Preview element not found or is not an iframe");
    }
    preview.src = url;
    preview.addEventListener("load", () => URL.revokeObjectURL(url));
    switchOutput("preview");
    saveState();
  } catch (error: any) {
    showError(`Error running code: ${error.message}`);
  } finally {
    hideLoading();
  }
}

export async function formatCode(): Promise<void> {
  try {
    // Format each editor separately with error handling
    let formattedHtml = editors.html.view.state.doc.toString();
    let formattedCss = editors.css.view.state.doc.toString();
    let formattedJs = editors.js.view.state.doc.toString();

    // Format HTML
    try {
      if (formattedHtml.trim()) {
        // First normalize the HTML by removing extra whitespace
        const normalizedHtml = formattedHtml.trim().replace(/^\s+/gm, '');
        
        formattedHtml = await prettier.format(normalizedHtml, {
          parser: "html",
          plugins: [parserHtml],
          printWidth: 120,
          tabWidth: 4,
          htmlWhitespaceSensitivity: "ignore",
          bracketSameLine: true,
          singleAttributePerLine: false,
        });

        // Ensure the formatted HTML is well-formed
        formattedHtml = formattedHtml.replace(/>\n\s*\n/g, '>\n');

        // Remove two spaces from the beginning of each line
        formattedHtml = formattedHtml.replace(/^  /gm, '');

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
          plugins: [parserCss],
          printWidth: 100,
          tabWidth: 2,
        });
        // Remove two spaces from the beginning of each line
        formattedCss = formattedCss.replace(/^  /gm, '');
      }
    } catch (error) {
      console.warn("CSS formatting failed:", error);
    }

    // Format JavaScript with better error handling
    try {
      if (formattedJs.trim()) {
        formattedJs = await prettier.format(formattedJs, {
          parser: "babel", // Use babel instead of flow
          plugins: [
            parserBabel,
            (prettierPluginEstree as any).default || prettierPluginEstree,
          ],
          printWidth: 100,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
          trailingComma: "es5",
          bracketSpacing: true,
        });
        // Remove two spaces from the beginning of each line
        formattedJs = formattedJs.replace(/^  /gm, '');
      }
    } catch (error) {
      console.warn("JavaScript formatting failed:", error);
      // Try with a simpler parser as fallback
      try {
        formattedJs = await prettier.format(formattedJs, {
          parser: "babel-ts", // Alternative parser
          plugins: [
            parserBabel,
            (prettierPluginEstree as any).default || prettierPluginEstree,
          ],
          printWidth: 100,
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        });
        // Remove two spaces from the beginning of each line
        formattedJs = formattedJs.replace(/^  /gm, '');
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

    saveState();
  } catch (error: any) {
    showError(`Error formatting code: ${error.message}`);
  }
}