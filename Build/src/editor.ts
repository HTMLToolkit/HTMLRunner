import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view"; // Add standardKeymap, defaultKeymap
import { defaultKeymap, standardKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { linter, lintGutter } from "@codemirror/lint";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import { CodeMirrorEditor, Editors } from "./types";
import { runCode } from "./runner";
import { toggleSearch } from "./main";
import { debounce } from "./utils";
import { autoRunState, cssState, darkModeState, htmlState, jsState } from "./appState";
import { search } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands"; // Ensure toggleComment is imported

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
}

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
        linter(
          (view) => {
            return [];
          },
          { delay: 100 }
        ),
        lintGutter(),
        keymap.of([
          ...standardKeymap, // Add standard keymap
          ...defaultKeymap, // Add default keymap
          {
            key: "Ctrl-/",
            run: (view: EditorView) => {
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: "" },
              });
              return true;
            },
            preventDefault: true,
          },
        ]),
        autoRunCompartment.of(
          autoRunState.get()
            ? EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                  contentState.set(update.state.doc.toString());
                  debounce(runCode, 1000)();
                }
              })
            : []
        ),
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