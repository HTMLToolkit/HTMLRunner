import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import "@fortawesome/fontawesome-free/css/all.min.css";
import { createEditor, switchToFile, editor } from "./editor";
import {
  openSearchPanel,
  searchPanelOpen,
  closeSearchPanel,
} from "@codemirror/search";
import Split from "split.js";
import { copyToClipboard } from "./utils";
import { clearConsole, initializeConsole, consoleEntries } from "./console";
import { runCode, formatCode } from "./runner";
import { undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import {
  resetCode,
  loadState,
  filesState,
  activeFileState,
  activeOutputState,
  bodyClass,
  isResizing,
  resizingClass,
  logFilters,
  splitSizesState,
  globalActions,
  autoRunText,
  previewClass,
  consoleClass,
  loadingVisible,
  errorMessage,
  errorVisible,
  themeLabel,
  themeIconClass,
} from "./appState";
import { switchOutput, showError, toggleAutoRun, toggleDarkMode } from "./ui";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  bindEvent,
  bindText,
  bindVisibility,
  bindClass,
  effect,
} from "@nisoku/sairin";
import type { FileTab } from "./types";
import {
  initializeVFS,
  isReady,
  syncFilesDebounced,
  createFileInVFS,
  deleteFileInVFS,
  gitCommit,
  gitStatus,
} from "./vfs";
import type { GitFileStatus } from "./vfs";
import GitWorker from "./git.worker?worker&inline";

let splitInstance: Split.Instance;
let editorPanelEl: HTMLElement | null = null;
let outputPanelEl: HTMLElement | null = null;

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
      resizingClass.set(
        direction === "horizontal" ? "resizing-col" : "resizing-row",
      );
      isResizing.set(true);
    },
    onDrag: function () {
      if (editor.view) editor.view.requestMeasure();
    },
    onDragEnd: function (sizes) {
      resizingClass.set("");
      isResizing.set(false);
      splitSizesState.set(sizes);
      if (editor.view) editor.view.requestMeasure();
    },
  });

  setTimeout(() => {
    if (editor.view) editor.view.requestMeasure();
  }, 0);
}

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

async function exportAsZip() {
  const files = filesState.get();
  const nonEmpty = files.filter((f) => f.content.trim());

  if (nonEmpty.length === 0) {
    alert("Nothing to export!");
    return;
  }

  if (nonEmpty.length === 1) {
    try {
      const blob = new Blob([nonEmpty[0].content], { type: "text/plain" });
      saveAs(blob, nonEmpty[0].name);
    } catch (err) {
      console.error("Failed to export file:", err);
      showError("Unable to export file.");
    }
    return;
  }

  try {
    const zip = new JSZip();
    for (const file of nonEmpty) {
      zip.file(file.name, file.content);
    }
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "htmlrunner-export.zip");
  } catch (err) {
    console.error("Failed to create ZIP:", err);
    showError("Unable to create ZIP.");
  }
}

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

function copyEditorContent(): void {
  if (editor.view) {
    copyToClipboard(editor.view.state.doc.toString());
  }
}

function initializeCopyButtons(): void {
  const container = document.getElementById("editor-container");
  if (container) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.innerHTML = '<i class="far fa-copy"></i>';
    bindEvent(copyBtn, "click", () => {
      copyEditorContent();
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="far fa-copy"></i>';
      }, 2000);
    });
    container.appendChild(copyBtn);
  }

  const consoleTab = document.querySelector('.output-tabs .tab[data-output="console"]');
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

export function toggleSearch(mode: "find" | "replace" = "find"): void {
  if (!editor.view) return;
  const isOpen = searchPanelOpen(editor.view.state);
  if (isOpen) {
    closeSearchPanel(editor.view);
  } else {
    openSearchPanel(editor.view);
  }

  window.requestAnimationFrame(() => {
    const selector =
      mode === "replace"
        ? '.cm-search input[name="replace"]'
        : '.cm-search input[name="search"]';
    const root = editor.view!.dom as HTMLElement;
    const field = root.querySelector(selector) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  });
}

function renderFileTabs(container: HTMLElement, files: FileTab[], activeId: string): void {
  container.innerHTML = "";

  for (const file of files) {
    const tab = document.createElement("div");
    tab.className = `file-tab${file.id === activeId ? " active" : ""}`;
    tab.dataset.file = file.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-tab-name";
    nameSpan.textContent = file.name;
    tab.appendChild(nameSpan);

    const closeBtn = document.createElement("button");
    closeBtn.className = "file-tab-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.dataset.file = file.id;
    tab.appendChild(closeBtn);

    container.appendChild(tab);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "file-tab-add";
  addBtn.innerHTML = "+";
  addBtn.title = "New file";
  container.appendChild(addBtn);
}

// Sidebar File Tree

const FILE_ICONS: Record<string, string> = {
  html: "fab fa-html5", htm: "fab fa-html5",
  css: "fab fa-css3-alt",
  js: "fab fa-js", mjs: "fab fa-js", cjs: "fab fa-js",
  jsx: "fab fa-react",
  ts: "fab fa-js", tsx: "fab fa-react",
  json: "fas fa-brackets-curly",
};

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] || "far fa-file-code";
}

function renderFileTree(container: HTMLElement): void {
  const files = filesState.get();
  const activeId = activeFileState.get();

  container.innerHTML = "";

  for (const file of files) {
    const item = document.createElement("div");
    item.className = `file-tree-item${file.id === activeId ? " active" : ""}`;
    item.dataset.file = file.id;

    const icon = document.createElement("i");
    icon.className = getFileIcon(file.name) + " file-tree-icon";
    item.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-tree-name";
    name.textContent = file.name;
    item.appendChild(name);

    container.appendChild(item);
  }
}

// Git indicator overlay

function renderGitStatus(container: HTMLElement, statuses: GitFileStatus[]): void {
  container.innerHTML = "";
  if (statuses.length === 0) {
    container.innerHTML = '<span class="git-status-empty">No changes</span>';
    return;
  }

  for (const s of statuses) {
    const item = document.createElement("div");
    item.className = "git-status-item";

    const badge = document.createElement("span");
    badge.className = `git-badge git-badge-${s.short.toLowerCase()}`;
    badge.textContent = s.short;
    item.appendChild(badge);

    const name = document.createElement("span");
    name.className = "git-status-filename";
    name.textContent = s.filepath;
    item.appendChild(name);

    container.appendChild(item);
  }
}

// File operations

function switchFileAction(id: string): void {
  const files = filesState.get();
  const file = files.find((f) => f.id === id);
  if (file) switchToFile(file);
}

function addFileAction(): void {
  const name = prompt("Enter filename:", "untitled.html");
  if (!name || !name.trim()) return;

  const fileName = name.trim();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  let language = "javascript";
  if (ext === "html" || ext === "htm") language = "html";
  else if (ext === "css") language = "css";
  else if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) language = "javascript";

  const newFile: FileTab = {
    id: fileName,
    name: fileName,
    content: "",
    language,
  };

  const files = filesState.get();
  filesState.set([...files, newFile]);
  activeFileState.set(newFile.id);

  const file = filesState.get().find((f) => f.id === newFile.id);
  if (file) switchToFile(file);

  if (isReady()) {
    createFileInVFS(fileName, "").catch((err) =>
      console.warn("VFS create failed:", err),
    );
  }
}

function closeFileAction(id: string): void {
  const files = filesState.get();
  if (files.length <= 1) return;

  const idx = files.findIndex((f) => f.id === id);
  const updated = files.filter((f) => f.id !== id);
  filesState.set(updated);

  const wasActive = activeFileState.get() === id;
  if (wasActive && updated.length > 0) {
    const nextIdx = Math.min(idx, updated.length - 1);
    const newActive = updated[nextIdx].id;
    activeFileState.set(newActive);
    const file = updated[nextIdx];
    if (file) switchToFile(file);
  }

  const file = files.find((f) => f.id === id);
  if (file && isReady()) {
    deleteFileInVFS(file.name).catch((err) =>
      console.warn("VFS delete failed:", err),
    );
  }
}

async function commitAction(): Promise<void> {
  const msg = prompt("Commit message:", "Update files");
  if (!msg || !msg.trim()) return;
  try {
    const sha = await gitCommit(msg.trim());
    showError(`Committed: ${sha.slice(0, 7)}`);
    await refreshGitStatus();
  } catch (err) {
    console.error("Commit failed:", err);
    showError("Commit failed");
  }
}

async function refreshGitStatus(): Promise<void> {
  const statusEl = document.getElementById("git-status");
  if (!statusEl) return;
  try {
    const statuses = await gitStatus();
    renderGitStatus(statusEl, statuses);
  } catch {
    // not ready yet
  }
}

const actions = {
  runCode,
  clearConsole,
  resetCode,
  formatCode,
  switchFile: switchFileAction,
  addFile: addFileAction,
  closeFile: closeFileAction,
  switchOutput,
  exportAsZip,
  copyAllConsole,
  copyEditorContent,
  toggleSearch,
  toggleAutoRun,
  toggleDarkMode,
};

globalActions.set({ ...actions, formatCode: formatCode as () => Promise<void> });

function undoAction(): void {
  if (editor.view) cmUndo(editor.view);
}
function redoAction(): void {
  if (editor.view) cmRedo(editor.view);
}

const prevActions = globalActions.get();
globalActions.set({ ...prevActions, undo: undoAction, redo: redoAction });

document.addEventListener("DOMContentLoaded", async () => {
  const worker = new GitWorker();
  await initializeVFS(worker);

  const editorContainer = document.getElementById("editor-container");
  if (!editorContainer) {
    console.error("Editor container not found");
    return;
  }

  const initialFiles = filesState.get();
  const initialActiveId = activeFileState.get();
  const initialFile = initialFiles.find((f) => f.id === initialActiveId) ?? initialFiles[0];
  if (initialFile) {
    createEditor(editorContainer, initialFile);
  }

  initializeCopyButtons();

  loadState();

  editorPanelEl = document.getElementById("editor-panel");
  outputPanelEl = document.getElementById("output-panel");
  initializeSplit();
  initializeLogFilters(document.querySelector(".output-tabs"));
  initializeConsole();
  addGlobalSearchShortcuts();

  const loadingEl = document.getElementById("loading") as HTMLDivElement | null;
  const errorEl = document.getElementById("error-message") as HTMLDivElement | null;

  const fileTabsEl = document.getElementById("file-tabs") as HTMLElement | null;

  const outputPreviewTabEl = document.querySelector(
    '.output-tabs .tab[data-output="preview"]',
  ) as HTMLElement | null;
  const outputConsoleTabEl = document.querySelector(
    '.output-tabs .tab[data-output="console"]',
  ) as HTMLElement | null;

  const previewEl = document.getElementById("preview") as HTMLIFrameElement | null;
  const consoleEl = document.getElementById("console") as HTMLDivElement | null;
  const bodyEl = document.body as HTMLElement;

  const runBtn = document.querySelector(".btn-run") as HTMLButtonElement | null;
  if (runBtn) bindEvent(runBtn, "click", () => actions.runCode());

  const formatBtn = document.querySelector(".btn-format") as HTMLButtonElement | null;
  if (formatBtn) bindEvent(formatBtn, "click", () => void actions.formatCode());

  const resetBtn = document.querySelector(".btn-reset") as HTMLButtonElement | null;
  if (resetBtn) bindEvent(resetBtn, "click", () => actions.resetCode());

  const clearBtn = document.querySelector(".btn-clear") as HTMLButtonElement | null;
  if (clearBtn) bindEvent(clearBtn, "click", () => actions.clearConsole());

  const downloadBtn = document.querySelector(".btn-download") as HTMLButtonElement | null;
  if (downloadBtn) bindEvent(downloadBtn, "click", () => void actions.exportAsZip());

  const autoRunBtn = document.querySelector(".btn-auto-run") as HTMLButtonElement | null;
  if (autoRunBtn) bindEvent(autoRunBtn, "click", () => toggleAutoRun());

  const themeBtn = document.querySelector(".theme-toggle") as HTMLButtonElement | null;
  if (themeBtn) bindEvent(themeBtn, "click", () => toggleDarkMode());

  const autoRunEl = document.getElementById("auto-run-status");
  if (autoRunEl) bindText(autoRunEl, autoRunText);

  if (fileTabsEl) {
    effect(() => {
      const files = filesState.get();
      const activeId = activeFileState.get();
      renderFileTabs(fileTabsEl, files, activeId);
    });

    fileTabsEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const tabEl = target.closest(".file-tab") as HTMLElement | null;
      const closeBtn = target.closest(".file-tab-close") as HTMLElement | null;
      const addBtn = target.closest(".file-tab-add") as HTMLElement | null;

      if (closeBtn) {
        const id = closeBtn.dataset.file;
        if (id) actions.closeFile(id);
      } else if (addBtn) {
        actions.addFile();
      } else if (tabEl) {
        const id = tabEl.dataset.file;
        if (id) actions.switchFile(id);
      }
    });
  }

  if (outputPreviewTabEl) {
    effect(() => {
      outputPreviewTabEl.className = previewClass.get();
    });
  }
  if (outputConsoleTabEl) {
    effect(() => {
      outputConsoleTabEl.className = consoleClass.get();
    });
  }

  const outputTabsContainer = document.querySelector(".output-tabs") as HTMLElement | null;
  if (outputTabsContainer) {
    outputTabsContainer.addEventListener("click", (e) => {
      const el = e.target as Element | null;
      const target = el?.closest(".tab") as HTMLElement | null;
      if (!target) return;
      const out = target.dataset.output;
      if (out) actions.switchOutput(out);
    });
  }

  effect(() => {
    const out = activeOutputState.get();
    if (previewEl)
      previewEl.className = out === "preview" ? "preview active" : "preview";
    if (consoleEl)
      consoleEl.className = out === "console" ? "console active" : "console";
  });

  bindClass(bodyEl, bodyClass);

  if (loadingEl) bindVisibility(loadingEl, loadingVisible);
  if (errorEl) {
    bindText(errorEl, errorMessage);
    bindVisibility(errorEl, errorVisible);
  }

  const themeIcon = document.querySelector(".theme-toggle i") as HTMLElement | null;
  const themeLabelEl = document.querySelector(".theme-toggle span") as HTMLElement | null;
  if (themeLabelEl) bindText(themeLabelEl, themeLabel);
  if (themeIcon) bindClass(themeIcon, themeIconClass);

  // Sidebar file tree

  const fileTreeEl = document.getElementById("file-tree") as HTMLElement | null;
  if (fileTreeEl) {
    effect(() => {
      renderFileTree(fileTreeEl);
    });

    fileTreeEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest(".file-tree-item") as HTMLElement | null;
      if (item && item.dataset.file) {
        actions.switchFile(item.dataset.file);
      }
    });

    fileTreeEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const item = target.closest(".file-tree-item") as HTMLElement | null;
      if (!item || !item.dataset.file) return;

      const fileName = item.dataset.file;
      const action = prompt(
        `Actions for ${fileName}:\nType "rename" or "delete":`,
      );
      if (action === "rename") {
        const newName = prompt("New name:", fileName);
        if (newName && newName.trim() && newName.trim() !== fileName) {
          import("./vfs").then((vfs) =>
            vfs.renameFileInVFS(fileName, newName.trim()),
          );
        }
      } else if (action === "delete") {
        actions.closeFile(fileName);
      }
    });
  }

  // Sidebar new file button

  const newFileBtn = document.getElementById("sidebar-new-btn");
  if (newFileBtn) {
    bindEvent(newFileBtn, "click", () => actions.addFile());
  }

  // Git commit button

  const gitBtn = document.getElementById("sidebar-git-btn");
  if (gitBtn) {
    bindEvent(gitBtn, "click", () => void commitAction());
  }

  // Auto-refresh git status periodically

  setInterval(() => {
    if (isReady()) {
      refreshGitStatus().catch(() => {});
    }
  }, 5000);

  // Sync files to VFS on change

  effect(() => {
    const files = filesState.get();
    if (isReady()) {
      syncFilesDebounced(files);
    }
  });

  formatCode().catch((error) => {
    showError(`Error formatting code: ${error.message}`);
  });
});
