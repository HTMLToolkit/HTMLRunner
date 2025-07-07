import { initializeEditors, setDarkMode, setAutoRun } from "./editor";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, StateEffect } from "@codemirror/state";
import {
  search,
  openSearchPanel,
  searchPanelOpen,
  closeSearchPanel,
} from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import Split from "split.js";
import * as prettier from "prettier/standalone";
import * as parserHtml from "prettier/plugins/html";
import * as parserCss from "prettier/plugins/postcss";
import * as parserFlow from "prettier/plugins/flow";
import * as prettierPluginEstree from "prettier/plugins/estree";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { copyToClipboard } from "./utils";
import { editors } from "./editor";
import {
  Editors,
  State,
  ConsoleMessage,
  StackInfo,
  CodeMirrorEditor,
} from "./types";
import { consoleInterceptor, consoleOutput, clearConsole, logConsoleError } from "./console";
import { runCode, formatCode } from "./runner";
import { resetCode, state, saveState, loadState } from "./state";
import { switchTab, switchOutput, showError, showLoading, hideLoading, updateThemeIcon, setPageDarkMode } from "./ui"; // Import updateThemeIcon

// Type declarations for global window properties
declare global {
  interface Window {
    prettierPlugins: any[];
    runCode: () => void;
    clearConsole: () => void;
    resetCode: () => void;
    formatCode: () => Promise<void>;
    toggleAutoRun: () => void;
    toggleDarkMode: () => void;
    switchTab: (tab: string) => void;
    switchOutput: (output: string) => void;
    exportAsZip: () => Promise<void>;
    copyAllConsole: () => void;
    copyEditorContent: (editor: string) => void;
    toggleSearch: () => void;
  }
}

// Register Prettier plugins
const plugins = [parserHtml, parserCss, parserFlow];
window.prettierPlugins = plugins;

let currentTab: string = "html";
let currentOutput: string = "preview";
let isDarkMode: boolean = localStorage.getItem("darkMode") === "true";
let isAutoRun: boolean = localStorage.getItem("autoRun") === "true";
let splitInstance: Split.Instance;
const loadingEl = document.getElementById("loading") as HTMLDivElement;
const errorEl = document.getElementById("error-message") as HTMLDivElement;
const preview = document.getElementById("preview") as HTMLIFrameElement;

if (!consoleOutput || !loadingEl || !errorEl || !preview) {
  throw new Error("Required DOM elements not found");
}

// Initialize Split.js
function initializeSplit() {
  if (splitInstance) {
    splitInstance.destroy();
  }

  const elements = ["#editor-panel", "#output-panel"];
  const direction = window.innerWidth <= 768 ? "vertical" : "horizontal";

  if (!elements.every((id) => document.querySelector(id))) {
    console.error("Split.js elements not found");
    return;
  }

  splitInstance = Split(elements, {
    sizes: state.splitSizes || [50, 50],
    minSize: 200,
    gutterSize: 10,
    snapOffset: 0,
    dragInterval: 1,
    direction,
    elementStyle: (dimension, size, gutterSize) => ({
      "flex-basis": `calc(${size}% - ${gutterSize}px)`,
    }),
    gutterStyle: (dimension, gutterSize) => ({
      "flex-basis": `${gutterSize}px`,
    }),
    onDragStart: function () {
      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
    },
    onDrag: function () {
      Object.values(editors).forEach((editor) => editor.view.requestMeasure());
    },
    onDragEnd: function (sizes) {
      document.body.style.cursor = "";
      state.splitSizes = sizes;
      saveState();
      Object.values(editors).forEach((editor) => editor.view.requestMeasure());
    },
  });

  setTimeout(() => {
    Object.values(editors).forEach((editor) => editor.view.requestMeasure());
  }, 0);
}

// Handle window resize
let resizeTimeout: number;
const handleResize = () => {
  if (resizeTimeout) {
    window.clearTimeout(resizeTimeout);
  }
  resizeTimeout = window.setTimeout(() => {
    initializeSplit();
  }, 250);
};

window.removeEventListener("resize", handleResize);
window.addEventListener("resize", handleResize);

window.addEventListener("beforeunload", () => {
  if (splitInstance) {
    splitInstance.destroy();
  }
});

// Add global keyboard shortcut handler for search
function addGlobalSearchShortcuts() {
  const preventDefault = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "h")) {
      e.preventDefault();
      e.stopPropagation();
      toggleSearch(e.key === "f" ? "find" : "replace");
    }
  };
  window.addEventListener("keydown", preventDefault, true);
}

// Initialize search controls
function initializeSearchControls(tabsContainer: Element): void {
  const searchControls = document.createElement("div");
  searchControls.className = "search-controls";

  const searchBtn = document.createElement("button");
  searchBtn.className = "search-btn";
  searchBtn.innerHTML = '<i class="fas fa-search"></i>';
  searchBtn.title = "Search (Ctrl+F)";
  searchBtn.onclick = () => toggleSearch("find");

  const replaceBtn = document.createElement("button");
  replaceBtn.className = "replace-btn";
  replaceBtn.innerHTML = '<i class="fas fa-exchange-alt"></i>';
  replaceBtn.title = "Replace (Ctrl+H)";
  replaceBtn.onclick = () => toggleSearch("replace");

  searchControls.appendChild(searchBtn);
  searchControls.appendChild(replaceBtn);
  tabsContainer.appendChild(searchControls);
}

// Console message handling
window.addEventListener("message", (event: MessageEvent<ConsoleMessage>) => {
  if (event.data.type === "console") {
    const entry = document.createElement("div");
    entry.className = `console-entry ${!activeFilters.has(event.data.level) ? "filtered" : ""}`;

    const timestamp = document.createElement("span");
    timestamp.className = "timestamp";
    timestamp.textContent = new Date(event.data.timestamp).toLocaleTimeString();

    const message = document.createElement("span");
    message.className = `console-${event.data.level}`;
    if (event.data.data && event.data.data.length) {
      event.data.data.forEach((item: any, i: number) => {
        if (i > 0) message.appendChild(document.createTextNode(" "));
        if (item && typeof item === "object") {
          message.appendChild(renderObject(item));
        } else {
          message.appendChild(document.createTextNode(String(item)));
        }
      });
    }

    if (event.data.data[1]?.stack) {
      const stack = document.createElement("div");
      stack.className = "console-stack";
      stack.textContent = event.data.data[1].stack;
      stack.addEventListener("click", () => stack.classList.toggle("expanded"));
      message.appendChild(stack);
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.innerHTML = '<i class="far fa-copy"></i>';
    copyBtn.addEventListener("click", () => {
      const text = event.data.data
        .map((item: any) =>
          typeof item === "object"
            ? JSON.stringify(item, null, 2)
            : String(item)
        )
        .join(" ");
      copyToClipboard(text);
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="far fa-copy"></i>';
      }, 2000);
    });

    entry.appendChild(timestamp);
    entry.appendChild(document.createTextNode(" "));
    entry.appendChild(message);
    entry.appendChild(copyBtn);
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }
});

// Render objects with depth limit and circular reference handling
function renderObject(obj: any, level = 0, visited = new WeakSet()): Node {
  if (obj === null) return document.createTextNode("null");
  if (typeof obj !== "object") return document.createTextNode(String(obj));
  if (visited.has(obj)) return document.createTextNode("[Circular]");
  if (level > 3) return document.createTextNode("[...]");
  visited.add(obj);

  const container = document.createElement("span");
  if (obj instanceof Error) {
    const errorEl = document.createElement("span");
    errorEl.className = "console-error";
    errorEl.textContent = `${obj.name}: ${obj.message}`;
    if (obj.stack)
      errorEl.textContent += `\n${obj.stack.split("\n").slice(1).join("\n")}`;
    container.appendChild(errorEl);
    return container;
  }

  const preview = document.createElement("span");
  preview.className = "console-object";
  preview.textContent = Array.isArray(obj) ? `Array(${obj.length})` : "{...}";
  const content = document.createElement("div");
  content.className = "console-object-content";

  Object.entries(obj).forEach(([key, value]) => {
    const prop = document.createElement("div");
    prop.textContent = `${key}: `;
    prop.appendChild(renderObject(value, level + 1, visited));
    content.appendChild(prop);
  });

  preview.addEventListener("click", (e) => {
    e.stopPropagation();
    preview.classList.toggle("expanded");
  });

  container.appendChild(preview);
  container.appendChild(content);
  return container;
}

// Toggle auto-run
function toggleAutoRun(): void {
  isAutoRun = !isAutoRun;
  setAutoRun(isAutoRun);
  localStorage.setItem("autoRun", String(isAutoRun));
  updateAutoRunStatus();

  Object.values(editors).forEach((editor) => {
    const listener = isAutoRun
      ? EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            debounce(runCode, 1000)();
          }
        })
      : [];
    editor.view.dispatch({
      effects: editor.autoRunCompartment.reconfigure(listener),
    });
  });
}

function updateAutoRunStatus(): void {
  const statusEl = document.getElementById("auto-run-status");
  if (statusEl) {
    statusEl.textContent = isAutoRun ? "On" : "Off";
  }
}

// Toggle dark mode
function toggleDarkMode(): void {
  isDarkMode = !isDarkMode;
  setDarkMode(isDarkMode);
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("darkMode", String(isDarkMode));
  updateThemeIcon();
}

// Export editors' content as ZIP
async function exportAsZip() {
  const html = editors.html.view.state.doc.toString().trim();
  const css = editors.css.view.state.doc.toString().trim();
  const js = editors.js.view.state.doc.toString().trim();

  const files: { name: string; content: string }[] = [];
  if (html) files.push({ name: "index.html", content: html });
  if (css) files.push({ name: "styles.css", content: css });
  if (js) files.push({ name: "script.js", content: js });

  if (files.length === 0) {
    alert("Nothing to export!");
    return;
  }

  if (files.length === 1) {
    const blob = new Blob([files[0].content], { type: "text/plain" });
    saveAs(blob, files[0].name);
    return;
  }

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.content);
  }

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "htmlrunner-export.zip");
}


// Copy console content
function copyAllConsole(): void {
  const entries = Array.from(consoleOutput.children);
  const text = entries
    .map((entry) => {
      const timestamp = entry.querySelector(".timestamp")?.textContent || "";
      const message = Array.from(
        entry.querySelectorAll(
          ".console-log, .console-error, .console-warn, .console-info"
        )
      )
        .map((el) => el.textContent)
        .join("");
      return `${timestamp} ${message}`;
    })
    .join("\n");
  copyToClipboard(text);
}

// Copy editor content
function copyEditorContent(editor: string): void {
  const content = editors[editor].view.state.doc.toString();
  copyToClipboard(content);
}

// Initialize copy buttons
function initializeCopyButtons(): void {
  ["html", "css", "js"].forEach((editorType) => {
    const container = document.getElementById(`${editorType}-editor-container`);
    if (container) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.innerHTML = '<i class="far fa-copy"></i>';
      copyBtn.addEventListener("click", () => {
        copyEditorContent(editorType);
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="far fa-copy"></i>';
        }, 2000);
      });
      container.appendChild(copyBtn);
    }
  });

  const consoleTab = document.querySelector(
    '.output-tabs .tab[data-output="console"]'
  );
  if (consoleTab) {
    const copyAllBtn = document.createElement("button");
    copyAllBtn.className = "copy-btn";
    copyAllBtn.style.position = "static";
    copyAllBtn.style.marginLeft = "auto";
    copyAllBtn.style.opacity = "1";
    copyAllBtn.innerHTML = '<i class="far fa-copy"></i> Copy All';
    copyAllBtn.addEventListener("click", () => {
      copyAllConsole();
      copyAllBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => {
        copyAllBtn.innerHTML = '<i class="far fa-copy"></i> Copy All';
      }, 2000);
    });
    consoleTab.parentElement?.appendChild(copyAllBtn);
  }
}

// Log filter state
let activeFilters = new Set(["log", "error", "warn", "info"]);

function toggleLogFilter(type: "log" | "error" | "warn" | "info"): void {
  const button = document.querySelector(`.filter-toggle.${type}`);
  if (button) {
    const isActive = button.classList.contains("active");
    if (isActive) {
      activeFilters.delete(type);
      button.classList.remove("active");
    } else {
      activeFilters.add(type);
      button.classList.add("active");
    }
    localStorage.setItem(
      "logFilters",
      JSON.stringify(Array.from(activeFilters))
    );
    applyLogFilters();
  }
}

function applyLogFilters(): void {
  document.querySelectorAll(".console-entry").forEach((entry) => {
    const messageElement = entry.querySelector(
      ".console-log, .console-error, .console-warn, .console-info"
    );
    if (messageElement) {
      const logType = Array.from(messageElement.classList)
        .find((cls) => cls.startsWith("console-"))
        ?.replace("console-", "");
      if (logType && !activeFilters.has(logType)) {
        entry.className = "console-entry filtered";
      } else {
        entry.className = "console-entry";
      }
    }
  });
}

function initializeLogFilters(): void {
  try {
    const savedFilters = localStorage.getItem("logFilters");
    if (savedFilters) {
      activeFilters = new Set(JSON.parse(savedFilters));
    }
  } catch (e) {
    console.error("Failed to load log filters:", e);
  }

  const consoleTab = document.querySelector(".output-tabs");
  if (consoleTab) {
    const filtersDiv = document.createElement("div");
    filtersDiv.className = "console-filters";

    ["log", "error", "warn", "info"].forEach((type) => {
      const button = document.createElement("button");
      button.className = `filter-toggle ${type} ${activeFilters.has(type) ? "active" : ""}`;
      button.innerHTML = `<i class="fas fa-${
        type === "log"
          ? "terminal"
          : type === "error"
            ? "times-circle"
            : type === "warn"
              ? "exclamation-triangle"
              : "info-circle"
      }"></i>${type.charAt(0).toUpperCase() + type.slice(1)}`;
      button.onclick = () => toggleLogFilter(type as any);
      filtersDiv.appendChild(button);
    });

    consoleTab.insertBefore(filtersDiv, consoleTab.lastElementChild);
  }
}

// Search toggle function
export function toggleSearch(mode: "find" | "replace" = "find"): void {
  const editor = editors[currentTab].view;
  if (editor) {
    const isOpen = searchPanelOpen(editor.state);
    if (isOpen) {
      closeSearchPanel(editor);
    } else {
      openSearchPanel(editor);
    }
  }
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return function (this: any, ...args: Parameters<T>): void {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => func.apply(this, args), wait);
  };
}

// Expose functions to window object
Object.assign(window, {
  runCode,
  clearConsole,
  resetCode,
  formatCode,
  toggleAutoRun,
  toggleDarkMode,
  switchTab,
  switchOutput,
  exportAsZip,
  copyAllConsole,
  copyEditorContent,
  toggleSearch,
});

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  initializeEditors();
  initializeCopyButtons();
  initializeSplit();
  updateAutoRunStatus();
  initializeLogFilters();
  addGlobalSearchShortcuts();

  const editorTabs = document.querySelector(".editor-tabs");
  if (editorTabs) {
    initializeSearchControls(editorTabs);
  }

  // Apply dark mode to page and editors on load
  if (isDarkMode) {
    setPageDarkMode(true);
  }

  loadState();
  formatCode().catch((error) => {
    showError(`Error formatting code: ${error.message}`);
  });
});