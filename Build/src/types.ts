import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

declare global {
  interface Window {
    prettierPlugins: any[];
  }
}

// CodeMirror 6 editor instance type is EditorView
export interface CodeMirrorEditor {
  view: EditorView;
  state: EditorState;
  autoRunCompartment: Compartment;
  themeCompartment: Compartment;
}

// Configuration for CM6 is an array of Extensions
export type CodeMirrorEditorConfig = Extension | Extension[];

// Type for the function that creates the editor and attaches it to an element
export interface CodeMirrorInstance {
  (element: HTMLElement, options?: CodeMirrorEditorConfig): CodeMirrorEditor;
}

export interface Editors {
  html: CodeMirrorEditor; // Added html
  css: CodeMirrorEditor;
  js: CodeMirrorEditor;
  [key: string]: CodeMirrorEditor;
}

export interface State {
  html: string;
  css: string;
  js: string;
  activeTab: string;
  activeOutput: string;
  splitSizes: number[];
  darkMode: boolean;
  autoRun: boolean;
}

export interface ConsoleMessage {
  type: "console";
  level: "log" | "error" | "warn" | "info";
  data: any[];
  timestamp: string;
}

export interface StackInfo {
  stack?: string;
}
