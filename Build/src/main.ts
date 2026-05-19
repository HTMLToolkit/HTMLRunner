import "@fortawesome/fontawesome-free/css/all.min.css";
import { initializeEditors } from "./editor";
import {
  openSearchPanel,
  searchPanelOpen,
  closeSearchPanel,
} from "@codemirror/search";
import Split from "split.js";
import { copyToClipboard } from "./utils";
import { editors } from "./editor";
import { clearConsole, initializeConsole, consoleEntries } from "./console";
import { runCode, formatCode } from "./runner";
import { undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import {
  resetCode,
  loadState,
  autoRunText,
  htmlVisible,
  cssVisible,
  jsVisible,
  tabHtmlClass,
  tabCssClass,
  tabJsClass,
  previewClass,
  consoleClass,
  bodyClass,
  activeTabState,
  activeOutputState,
  loadingVisible,
  errorMessage,
  errorVisible,
  themeLabel,
  themeIconClass,
  isResizing,
  resizingClass,
  logFilters,
  splitSizesState,
  globalActions,
} from "./appState";
import {
  switchTab,
  switchOutput,
  showError,
  updateThemeIcon,
  toggleAutoRun,
  toggleDarkMode,
} from "./ui";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  bindEvent,
  bindText,
  bindVisibility,
  bindClass,
  effect,
} from "@nisoku/sairin";

let splitInstance: Split.Instance;
let editorPanelEl: HTMLElement | null = null;
let outputPanelEl: HTMLElement | null = null;

// Initialize Split.js
function initializeSplit() {
  if (splitInstance) {
    splitInstance.destroy();
  }

  const direction = window.innerWidth <= 768 ? "vertical" : "horizontal";

  const elementEls = [
    editorPanelEl || document.getElementById("editor-panel"),
    outputPanelEl || document.getElementById("output-panel"),
  ];
  if (!elementEls.every((el) => el instanceof HTMLElement)) {
    console.error("Split.js elements not found");
    return;
  }

  const _sizes = splitSizesState.get();
  const sizes =
    Array.isArray(_sizes) &&
    _sizes.length >= 2 &&
    _sizes.every((n) => typeof n === "number" && isFinite(n) && n > 0)
      ? _sizes
      : [50, 50];

  // pass the element nodes directly to Split.js
  splitInstance = Split(elementEls as HTMLElement[], {
    sizes,
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
      // Use signal-driven class instead of direct style mutation
      resizingClass.set(
        direction === "horizontal" ? "resizing-col" : "resizing-row",
      );
      isResizing.set(true);
    },
    onDrag: function () {
      Object.values(editors).forEach((editor) => editor.view.requestMeasure());
    },
    onDragEnd: function (sizes) {
      resizingClass.set("");
      isResizing.set(false);
      splitSizesState.set(sizes);
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
  bindEvent(searchBtn, "click", () => toggleSearch("find"));

  const replaceBtn = document.createElement("button");
  replaceBtn.className = "replace-btn";
  replaceBtn.innerHTML = '<i class="fas fa-exchange-alt"></i>';
  replaceBtn.title = "Replace (Ctrl+H)";
  bindEvent(replaceBtn, "click", () => toggleSearch("replace"));

  searchControls.appendChild(searchBtn);
  searchControls.appendChild(replaceBtn);
  tabsContainer.appendChild(searchControls);
}

// Toggle auto-run

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
    try {
      const blob = new Blob([files[0].content], { type: "text/plain" });
      saveAs(blob, files[0].name);
    } catch (err) {
      console.error("Failed to export file:", err);
      showError("Unable to export file.");
    }
    return;
  }

  try {
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.name, file.content);
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "htmlrunner-export.zip");
  } catch (err) {
    console.error("Failed to create ZIP:", err);
    showError("Unable to create ZIP.");
    return;
  }
}

// Copy console content
function copyAllConsole(): void {
  const entries = consoleEntries.get();
  const text = entries
    .map((ev) => {
      const timestamp = new Date(ev.timestamp).toLocaleTimeString();
      const message = ev.data
        .map((d) => (typeof d === "object" ? JSON.stringify(d) : String(d)))
        .join(" ");
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

// Initialize copy buttons for each editor and a "Copy All" for console
function initializeCopyButtons(
  editorContainers?: {
    html?: HTMLElement | null;
    css?: HTMLElement | null;
    js?: HTMLElement | null;
  },
  outputConsoleTab?: Element | null,
): void {
  (["html", "css", "js"] as const).forEach((editorType) => {
    const containerFromParam =
      (editorContainers as Record<string, HTMLElement | null> | undefined)?.[
        editorType
      ] ?? null;
    const container =
      containerFromParam ||
      document.getElementById(`${editorType}-editor-container`);
    if (container) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.innerHTML = '<i class="far fa-copy"></i>';
      bindEvent(copyBtn, "click", () => {
        copyEditorContent(editorType);
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="far fa-copy"></i>';
        }, 2000);
      });
      container.appendChild(copyBtn);
    }
  });
  const consoleTab =
    outputConsoleTab ||
    document.querySelector('.output-tabs .tab[data-output="console"]');
  if (consoleTab) {
    const copyAllBtn = document.createElement("button");
    copyAllBtn.className = "copy-btn";
    copyAllBtn.style.position = "static";
    copyAllBtn.style.marginLeft = "auto";
    copyAllBtn.style.opacity = "1";
    copyAllBtn.innerHTML = '<i class="far fa-copy"></i> Copy All';
    bindEvent(copyAllBtn, "click", () => {
      copyAllConsole();
      copyAllBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => {
        copyAllBtn.innerHTML = '<i class="far fa-copy"></i> Copy All';
      }, 2000);
    });
    consoleTab.parentElement?.appendChild(copyAllBtn);
  }
}

// Console message handling is delegated to `Build/src/console.ts` (reactive rendering).
function initializeLogFilters(outputTabsEl?: Element | null): void {
  const consoleTab = outputTabsEl || document.querySelector(".output-tabs");
  if (!consoleTab) return;

  const filtersDiv = document.createElement("div");
  filtersDiv.className = "console-filters";

  (["log", "error", "warn", "info"] as const).forEach((type) => {
    const button = document.createElement("button");
    button.className = `filter-toggle ${type}`;
    const icon =
      type === "log"
        ? "terminal"
        : type === "error"
          ? "times-circle"
          : type === "warn"
            ? "exclamation-triangle"
            : "info-circle";
    button.innerHTML = `<i class="fas fa-${icon}"></i>${type.charAt(0).toUpperCase() + type.slice(1)}`;

    bindEvent(button, "click", () => {
      const prev = logFilters.get();
      const set = new Set(prev);
      if (set.has(type)) set.delete(type);
      else set.add(type);
      const arr = Array.from(set);
      logFilters.set(arr);
      try {
        localStorage.setItem("logFilters", JSON.stringify(arr));
      } catch (e) {
        console.error("Failed to save log filters to localStorage:", e);
      }
    });

    filtersDiv.appendChild(button);
  });

  consoleTab.insertBefore(filtersDiv, consoleTab.lastElementChild);

  const btnMap = new Map<string, HTMLButtonElement>();
  Array.from(filtersDiv.children).forEach((c) => {
    if (c instanceof HTMLButtonElement) {
      const classes = c.className.split(" ");
      for (const cls of classes) {
        if (["log", "error", "warn", "info"].includes(cls)) {
          btnMap.set(cls, c);
          break;
        }
      }
    }
  });

  effect(() => {
    const active = new Set(logFilters.get());
    for (const [type, btn] of btnMap) {
      if (active.has(type)) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });
}

// Search toggle function
export function toggleSearch(mode: "find" | "replace" = "find"): void {
  const editor = editors[activeTabState.get()].view;
  if (editor) {
    const isOpen = searchPanelOpen(editor.state);
    if (isOpen) {
      closeSearchPanel(editor);
    } else {
      openSearchPanel(editor);
    }

    window.requestAnimationFrame(() => {
      const selector =
        mode === "replace"
          ? '.cm-search input[name="replace"]'
          : '.cm-search input[name="search"]';
      // Scope lookup to the visible editor's DOM to avoid matching hidden panels
      const root = editor.dom as HTMLElement;
      const field = root.querySelector(selector) as HTMLInputElement | null;
      field?.focus();
      field?.select();
    });
  }
}

// Register global actions in Sairin
globalActions.set({
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

// Provide undo/redo commands that operate on the active editor (or specific editor name)
function undoAction(editorName?: string): void {
  const name = editorName || activeTabState.get();
  const ed = editors[name];
  if (ed) cmUndo(ed.view);
}

function redoAction(editorName?: string): void {
  const name = editorName || activeTabState.get();
  const ed = editors[name];
  if (ed) cmRedo(ed.view);
}

// Register undo/redo in global actions
const prevActions = globalActions.get();
globalActions.set({ ...prevActions, undo: undoAction, redo: redoAction });

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  // Cache editor containers before initializing editors
  const htmlContainer = document.getElementById("html-editor-container");
  const cssContainer = document.getElementById("css-editor-container");
  const jsContainer = document.getElementById("js-editor-container");

  if (!htmlContainer || !cssContainer || !jsContainer) {
    console.error("Editor containers not found");
  } else {
    initializeEditors({
      html: htmlContainer,
      css: cssContainer,
      js: jsContainer,
    });
  }
  const outputConsoleTabElEarly = document.querySelector(
    '.output-tabs .tab[data-output="console"]',
  ) as Element | null;
  initializeCopyButtons(
    { html: htmlContainer, css: cssContainer, js: jsContainer },
    outputConsoleTabElEarly,
  );

  // Apply persisted state early so layout (Split) can use saved sizes
  loadState();
  updateThemeIcon();

  // Cache panel elements for Split.js
  editorPanelEl = document.getElementById("editor-panel");
  outputPanelEl = document.getElementById("output-panel");
  initializeSplit();
  initializeLogFilters(document.querySelector(".output-tabs"));
  initializeConsole();
  addGlobalSearchShortcuts();

  // Lookup elements now that DOM is ready
  const loadingEl = document.getElementById("loading") as HTMLDivElement | null;
  const errorEl = document.getElementById(
    "error-message",
  ) as HTMLDivElement | null;

  const editorTabs = document.querySelector(".editor-tabs");
  if (editorTabs) {
    initializeSearchControls(editorTabs);
  }

  // Cache frequently-used DOM nodes to avoid repeated queries
  const tabHtmlEl = document.querySelector(
    '.editor-tabs .tab[data-tab="html"]',
  ) as HTMLElement | null;
  const tabCssEl = document.querySelector(
    '.editor-tabs .tab[data-tab="css"]',
  ) as HTMLElement | null;
  const tabJsEl = document.querySelector(
    '.editor-tabs .tab[data-tab="js"]',
  ) as HTMLElement | null;

  const outputPreviewTabEl = document.querySelector(
    '.output-tabs .tab[data-output="preview"]',
  ) as HTMLElement | null;
  const outputConsoleTabEl = document.querySelector(
    '.output-tabs .tab[data-output="console"]',
  ) as HTMLElement | null;

  const previewEl = document.getElementById(
    "preview",
  ) as HTMLIFrameElement | null;
  const consoleEl = document.getElementById("console") as HTMLDivElement | null;

  const bodyEl = document.body as HTMLElement;

  const actions = globalActions.get();

  const runBtn = document.querySelector(".btn-run") as HTMLButtonElement | null;
  if (runBtn) bindEvent(runBtn, "click", () => actions.runCode());

  const formatBtn = document.querySelector(
    ".btn-format",
  ) as HTMLButtonElement | null;
  if (formatBtn) bindEvent(formatBtn, "click", () => void actions.formatCode());

  const resetBtn = document.querySelector(
    ".btn-reset",
  ) as HTMLButtonElement | null;
  if (resetBtn) bindEvent(resetBtn, "click", () => actions.resetCode());

  const clearBtn = document.querySelector(
    ".btn-clear",
  ) as HTMLButtonElement | null;
  if (clearBtn) bindEvent(clearBtn, "click", () => actions.clearConsole());

  const downloadBtn = document.querySelector(
    ".btn-download",
  ) as HTMLButtonElement | null;
  if (downloadBtn)
    bindEvent(downloadBtn, "click", () => void actions.exportAsZip());

  const autoRunBtn = document.querySelector(
    ".btn-auto-run",
  ) as HTMLButtonElement | null;
  if (autoRunBtn) bindEvent(autoRunBtn, "click", () => actions.toggleAutoRun());

  const themeBtn = document.querySelector(
    ".theme-toggle",
  ) as HTMLButtonElement | null;
  if (themeBtn) bindEvent(themeBtn, "click", () => actions.toggleDarkMode());

  // Editor tab clicks (delegated)
  const editorTabsContainer = document.querySelector(
    ".editor-tabs",
  ) as HTMLElement | null;
  if (editorTabsContainer) {
    editorTabsContainer.addEventListener("click", (e) => {
      const el = e.target as Element | null;
      const target = el?.closest(".tab") as HTMLElement | null;
      if (!target) return;
      const tab = target.dataset.tab;
      if (tab) actions.switchTab(tab);
    });
  }

  // Output tab clicks (delegated)
  const outputTabsContainer = document.querySelector(
    ".output-tabs",
  ) as HTMLElement | null;
  if (outputTabsContainer) {
    outputTabsContainer.addEventListener("click", (e) => {
      const el = e.target as Element | null;
      const target = el?.closest(".tab") as HTMLElement | null;
      if (!target) return;
      const out = target.dataset.output;
      if (out) actions.switchOutput(out);
    });
  }

  // Bind UI elements to centralized appState signals
  const autoRunEl = document.getElementById("auto-run-status");
  if (autoRunEl) bindText(autoRunEl, autoRunText);

  if (htmlContainer) {
    effect(() => {
      const visible = htmlVisible.get();
      htmlContainer.style.display = visible ? "" : "none";
      if (visible) {
        setTimeout(() => editors.html?.view.requestMeasure(), 0);
      }
    });
  }
  if (cssContainer) {
    effect(() => {
      const visible = cssVisible.get();
      cssContainer.style.display = visible ? "" : "none";
      if (visible) {
        setTimeout(() => editors.css?.view.requestMeasure(), 0);
      }
    });
  }
  if (jsContainer) {
    effect(() => {
      const visible = jsVisible.get();
      jsContainer.style.display = visible ? "" : "none";
      if (visible) {
        setTimeout(() => editors.js?.view.requestMeasure(), 0);
      }
    });
  }

  // Update editor tab classes reactively
  effect(() => {
    if (tabHtmlEl) tabHtmlEl.className = tabHtmlClass.get();
  });
  effect(() => {
    if (tabCssEl) tabCssEl.className = tabCssClass.get();
  });
  effect(() => {
    if (tabJsEl) tabJsEl.className = tabJsClass.get();
  });

  // Update output tab classes reactively
  effect(() => {
    if (outputPreviewTabEl) outputPreviewTabEl.className = previewClass.get();
  });
  effect(() => {
    if (outputConsoleTabEl) outputConsoleTabEl.className = consoleClass.get();
  });

  // Update output content visibility (iframe / console) based on activeOutputState
  effect(() => {
    const out = activeOutputState.get();
    if (previewEl)
      previewEl.className = out === "preview" ? "preview active" : "preview";
    if (consoleEl)
      consoleEl.className = out === "console" ? "console active" : "console";
  });

  bindClass(bodyEl, bodyClass);

  // Loading and error bindings
  if (loadingEl) bindVisibility(loadingEl, loadingVisible);
  if (errorEl) {
    bindText(errorEl, errorMessage);
    bindVisibility(errorEl, errorVisible);
  }

  // Theme icon + label bindings
  const themeIcon = document.querySelector(
    ".theme-toggle i",
  ) as HTMLElement | null;
  const themeLabelEl = document.querySelector(
    ".theme-toggle span",
  ) as HTMLElement | null;
  if (themeLabelEl) bindText(themeLabelEl, themeLabel);
  if (themeIcon) bindClass(themeIcon, themeIconClass);

  formatCode().catch((error) => {
    showError(`Error formatting code: ${error.message}`);
  });
});
