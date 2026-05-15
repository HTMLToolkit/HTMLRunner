import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, toggleComment } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { foldGutter, foldKeymap, syntaxTree } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { formatCode } from "./runner";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import { CodeMirrorEditor, Editors } from "./types";
import { runCode } from "./runner";
import { toggleSearch } from "./main";
import { debounce } from "./utils";
import { autoRunState, cssState, darkModeState, htmlState, jsState } from "./appState";
import { search } from "@codemirror/search";

export const editors: Editors = {
  html: null as unknown as CodeMirrorEditor,
  css: null as unknown as CodeMirrorEditor,
  js: null as unknown as CodeMirrorEditor,
};

export function setDarkMode(value: boolean): void {
  darkModeState.set(value);
  Object.values(editors).forEach((editor) => {
    editor.view.dispatch({
      effects: editor.themeCompartment.reconfigure(
        darkModeState.get() ? monokai : bbedit
      ),
    });
  });
}

export function setAutoRun(value: boolean): void {
  autoRunState.set(value);
  Object.values(editors).forEach((editor) => {
    editor.view.dispatch({
      effects: editor.autoRunCompartment.reconfigure(
        value ? autoRunListener : []
      ),
    });
  });
}

// Shared debounced runner used by auto-run listeners so debounce state is preserved across keystrokes
const debouncedRun = debounce(runCode, 250);
export const autoRunListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) debouncedRun();
});

function createEditorConfig(
  language: Extension,
  container: HTMLElement,
  content: string,
  contentState: typeof htmlState | typeof cssState | typeof jsState
): CodeMirrorEditor {
  const themeCompartment = new Compartment();
  const autoRunCompartment = new Compartment();

  const view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        foldGutter(),
        // Linting: use syntax tree to surface parse errors from the language parser
        linter((view) => {
          const diags: any[] = [];
          try {
            syntaxTree(view.state).iterate({
              enter: (node) => {
                if (node.type.isError) {
                  diags.push({
                    from: node.from,
                    to: node.to,
                    severity: "error",
                    message: "Syntax error",
                  });
                }
              },
            });
          } catch (e) {
            // If iterate isn't supported for some tree shapes, fail silently
          }
          return diags;
        }),
        lintGutter(),
        language,
        themeCompartment.of(darkModeState.get() ? monokai : bbedit),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { minHeight: "100%" }
        }),
        search(),
        keymap.of([
          ...defaultKeymap,
          ...foldKeymap,
          { key: "Mod-/", run: toggleComment },
        ]),
        autoRunCompartment.of(autoRunState.get() ? autoRunListener : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            contentState.set(update.state.doc.toString());
          }
        }),
      ],
    }),
    parent: container,
  });

  // Prevent Enter from submitting a form
  view.dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation(); // Prevent form submission
    }
  });

  return {
    view,
    state: view.state,
    themeCompartment,
    autoRunCompartment,
  };
}

export function initializeEditors(): void {
  const htmlContainer = document.getElementById(
    "html-editor-container"
  ) as HTMLElement;
  const cssContainer = document.getElementById(
    "css-editor-container"
  ) as HTMLElement;
  const jsContainer = document.getElementById(
    "js-editor-container"
  ) as HTMLElement;

  if (!htmlContainer || !cssContainer || !jsContainer) {
    throw new Error("Editor containers not found");
  }

  editors.html = createEditorConfig(html(), htmlContainer, htmlState.get(), htmlState);
  editors.css = createEditorConfig(css(), cssContainer, cssState.get(), cssState);
  editors.js = createEditorConfig(javascript(), jsContainer, jsState.get(), jsState);
}