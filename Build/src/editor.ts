import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, toggleComment, history, undo, redo } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { lintWithBiome } from "./biome";
import { search } from "@codemirror/search";
import { monokai } from "@uiw/codemirror-theme-monokai";
import { bbedit } from "@uiw/codemirror-theme-bbedit";
import type { CodeMirrorEditor, FileTab } from "./types";
import { runCode } from "./runner";
import { debounce } from "./utils";
import {
  autoRunState,
  darkModeState,
  filesState,
  activeFileState,
} from "./appState";
import { effect } from "@nisoku/sairin";

export const editor: { view: EditorView | null } = { view: null };

let _languageCompartment: Compartment;
let _themeCompartment: Compartment;
let _autoRunCompartment: Compartment;
let _suppressContentUpdate = false;

function getLanguageExtension(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx":
      return javascript();
    default:
      return javascript();
  }
}

function getFileName(fileId: string, files: FileTab[]): string {
  const f = files.find((f) => f.id === fileId);
  return f?.name ?? "file.txt";
}

const debouncedRun = debounce(runCode, 250);
const autoRunListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) debouncedRun();
});

export function createEditor(container: HTMLElement, initialFile: FileTab): void {
  _languageCompartment = new Compartment();
  _themeCompartment = new Compartment();
  _autoRunCompartment = new Compartment();

  const view = new EditorView({
    state: EditorState.create({
      doc: initialFile.content,
      extensions: [
        lineNumbers(),
        history(),
        foldGutter(),
        linter(async (view) => {
          const text = view.state.doc.toString();
          const fileId = activeFileState.get();
          const files = filesState.get();
          const fileName = getFileName(fileId, files);
          try {
            const biomeDiags = await lintWithBiome(text, fileName);
            return biomeDiags || [];
          } catch (err) {
            console.error("Biome linting failed:", err);
            return [];
          }
        }),
        lintGutter(),
        _languageCompartment.of(getLanguageExtension(initialFile.name)),
        _themeCompartment.of(darkModeState.get() ? monokai : bbedit),
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
        _autoRunCompartment.of(autoRunState.get() ? autoRunListener : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !_suppressContentUpdate) {
            const content = update.state.doc.toString();
            const files = filesState.get();
            const activeId = activeFileState.get();
            const existing = files.find((f) => f.id === activeId);
            if (existing && existing.content === content) return;
            const updated = files.map((f) =>
              f.id === activeId ? { ...f, content } : f,
            );
            filesState.set(updated);
          }
        }),
      ],
    }),
    parent: container,
  });

  view.dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  });

  editor.view = view;
}

export function switchToFile(file: FileTab): void {
  if (!editor.view) return;

  _suppressContentUpdate = true;

  const currentContent = editor.view.state.doc.toString();
  const currentId = activeFileState.get();
  const files = filesState.get();
  const updated = files.map((f) =>
    f.id === currentId ? { ...f, content: currentContent } : f,
  );
  filesState.set(updated);

  activeFileState.set(file.id);

  editor.view.dispatch({
    changes: {
      from: 0,
      to: editor.view.state.doc.length,
      insert: file.content,
    },
  });

  editor.view.dispatch({
    effects: _languageCompartment.reconfigure(getLanguageExtension(file.name)),
  });

  editor.view.focus();

  _suppressContentUpdate = false;
}

export function setDarkMode(value: boolean): void {
  darkModeState.set(value);
  if (editor.view) {
    editor.view.dispatch({
      effects: _themeCompartment.reconfigure(
        darkModeState.get() ? monokai : bbedit,
      ),
    });
  }
}

export function setAutoRun(value: boolean): void {
  autoRunState.set(value);
  if (editor.view) {
    editor.view.dispatch({
      effects: _autoRunCompartment.reconfigure(
        value ? autoRunListener : [],
      ),
    });
  }
}

effect(() => {
  const files = filesState.get();
  const activeId = activeFileState.get();
  const file = files.find((f) => f.id === activeId);
  if (file && editor.view) {
    const currentDoc = editor.view.state.doc.toString();
    if (currentDoc !== file.content && !_suppressContentUpdate) {
      _suppressContentUpdate = true;
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
          insert: file.content,
        },
      });
      editor.view.dispatch({
        effects: _languageCompartment.reconfigure(getLanguageExtension(file.name)),
      });
      _suppressContentUpdate = false;
    }
  }
});
