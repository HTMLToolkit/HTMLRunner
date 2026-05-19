import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

declare global {
  interface Window {
    prettierPlugins: unknown[];
  }
}

export interface CodeMirrorEditor {
  view: EditorView;
  state: EditorState;
  autoRunCompartment: Compartment;
  themeCompartment: Compartment;
}

export type CodeMirrorEditorConfig = Extension | Extension[];

export interface CodeMirrorInstance {
  (element: HTMLElement, options?: CodeMirrorEditorConfig): CodeMirrorEditor;
}

export interface FileTab {
  id: string;
  name: string;
  content: string;
  language: string;
}

export interface Editors {
  active: CodeMirrorEditor | null;
}

export interface State {
  files: FileTab[];
  activeFile: string;
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
  switchFile: (id: string) => void;
  addFile: () => void;
  closeFile: (id: string) => void;
  switchOutput: (output: string) => void;
  exportAsZip: () => Promise<void>;
  copyAllConsole: () => void;
  copyEditorContent: () => void;
  toggleSearch: (mode?: "find" | "replace") => void;
  undo?: () => void;
  redo?: () => void;
}
