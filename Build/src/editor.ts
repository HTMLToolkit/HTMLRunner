import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, toggleComment, history, undo, redo } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { lintWithBiome } from "./biome";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import { CodeMirrorEditor, Editors } from "./types";
import { runCode } from "./runner";
import { debounce } from "./utils";
import {
  autoRunState,
  cssState,
  darkModeState,
  htmlState,
  jsState,
} from "./appState";
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
        darkModeState.get() ? monokai : bbedit,
      ),
    });
  });
}

export function setAutoRun(value: boolean): void {
  autoRunState.set(value);
  Object.values(editors).forEach((editor) => {
    editor.view.dispatch({
      effects: editor.autoRunCompartment.reconfigure(
        value ? autoRunListener : [],
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
  contentState: typeof htmlState | typeof cssState | typeof jsState,
  fileName = "file.txt",
): CodeMirrorEditor {
  const themeCompartment = new Compartment();
  const autoRunCompartment = new Compartment();

  const view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        foldGutter(),
        linter(async (view) => {
          const text = view.state.doc.toString();
          try {
            const biomeDiags = await lintWithBiome(text, fileName);
            return biomeDiags || [];
          } catch (err) {
            console.error("Biome linting failed:", err);
            return [];
          }
        }),
        lintGutter(),
        language,
        themeCompartment.of(darkModeState.get() ? monokai : bbedit),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { minHeight: "100%" },
        }),
        search(),
        autocompletion(),
        keymap.of([
          ...defaultKeymap,
          ...foldKeymap,
          { key: "Mod-/", run: toggleComment },
          { key: "Mod-z", run: undo },
          { key: "Mod-y", run: redo },
          { key: "Mod-Shift-z", run: redo },
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

export type EditorContainers = {
  html: HTMLElement;
  css: HTMLElement;
  js: HTMLElement;
};

export function initializeEditors(containers: EditorContainers): void {
  const {
    html: htmlContainer,
    css: cssContainer,
    js: jsContainer,
  } = containers;

  if (!htmlContainer || !cssContainer || !jsContainer) {
    throw new Error("Editor containers not found");
  }

  editors.html = createEditorConfig(
    html(),
    htmlContainer,
    htmlState.get(),
    htmlState,
    "index.html",
  );
  editors.css = createEditorConfig(
    css(),
    cssContainer,
    cssState.get(),
    cssState,
    "styles.css",
  );
  editors.js = createEditorConfig(
    javascript(),
    jsContainer,
    jsState.get(),
    jsState,
    "script.js",
  );
}
