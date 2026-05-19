import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

declare global {
  interface Window {
    prettierPlugins: unknown[];
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
  logFilters?: string[];
}

export interface ConsoleMessage {
  type: "console";
  level: "log" | "error" | "warn" | "info";
  data: ConsoleData[];
  timestamp: string;
}

// Recursive console data types (use interfaces to avoid circular alias error)
export type ConsolePrimitive = string | number | boolean | null;
export interface ConsoleObject {
  [key: string]: ConsoleData;
}
export interface ConsoleArray {
  [index: number]: ConsoleData;
  length: number;
}
export type ConsoleData =
  | ConsolePrimitive
  | { stack?: string }
  | { name: string; message: string; stack?: string }
  | Error
  | ConsoleObject
  | ConsoleArray;

export interface StackInfo {
  stack?: string;
}

export interface Actions {
  runCode: () => void;
  clearConsole: () => void;
  resetCode: (skipConfirmation?: boolean) => void;
  formatCode: () => Promise<void>;
  toggleAutoRun: () => void;
  toggleDarkMode: () => void;
  switchTab: (tab: string) => void;
  switchOutput: (output: string) => void;
  exportAsZip: () => Promise<void>;
  copyAllConsole: () => void;
  copyEditorContent: (editor: string) => void;
  toggleSearch: (mode?: "find" | "replace") => void;
  undo?: (editor?: string) => void;
  redo?: (editor?: string) => void;
}
