import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

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
import { createTerminal, fitTerminal } from "./terminal";
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
  terminalClass,
  loadingVisible,
  errorMessage,
  errorVisible,
  themeLabel,
  themeIconClass,
  cursorPos,
} from "./appState";
import { switchOutput, showError, toggleAutoRun, toggleDarkMode, showLoading, hideLoading } from "./ui";
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
import { getTemplateForExt, getLanguageForExt } from "./defaultContent";
import { getContainer, isContainerReady, getVFS } from "./container";
import { initGitService, isGitReady, gitClone, gitCommit, gitStatus, gitLog, gitDiff, gitPush, gitPull, syncAllFilesToWorker, requestFilesFromWorker, syncFileToWorker } from "./git-service";
import { initBridge, syncFilesDebounced, syncActiveFileToVFS } from "./vfs-bridge";
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
  const files = filesState.get();
  syncAllFilesToWorker();
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

// Menu bar
let activeMenu: string | null = null;

function initializeMenuBar(): void {
  const menuItems = document.querySelectorAll(".menu-item");
  const dropdowns = document.querySelectorAll(".menu-dropdown");

  function closeAllMenus() {
    activeMenu = null;
    dropdowns.forEach((d) => d.classList.remove("open"));
  }

  menuItems.forEach((item) => {
    const menuId = (item as HTMLElement).dataset.menu;
    if (!menuId) return;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById(`menu-${menuId}`);
      if (!dropdown) return;

      if (activeMenu === menuId) {
        closeAllMenus();
        return;
      }

      closeAllMenus();
      const rect = item.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom}px`;
      dropdown.classList.add("open");
      activeMenu = menuId;
    });

    item.addEventListener("mouseenter", () => {
      if (activeMenu && activeMenu !== menuId) {
        const dropdown = document.getElementById(`menu-${menuId}`);
        if (!dropdown) return;
        const prev = document.getElementById(`menu-${activeMenu}`);
        if (prev) prev.classList.remove("open");
        const rect = item.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom}px`;
        dropdown.classList.add("open");
        activeMenu = menuId;
      }
    });
  });

  // Handle menu dropdown item clicks
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".menu-dropdown-item") as HTMLElement | null;
    if (!item) return;

    const action = item.dataset.action;
    if (!action) return;

    closeAllMenus();

    // Parse compound actions
    if (action.startsWith("switchOutput-")) {
      switchOutput(action.slice("switchOutput-".length));
      return;
    }
    if (action === "toggleSearch") {
      toggleSearch("find");
      return;
    }
    if (action === "toggleReplace") {
      toggleSearch("replace");
      return;
    }

    // Direct actions
    const actionMap: Record<string, () => void> = {
      addFile: () => addFileAction(),
      addFolder: () => addFolderAction(),
      importFiles: () => importFilesAction(),
      exportAsZip: () => { exportAsZip().catch(console.error); },

      resetCode: () => resetCode(),
      undo: () => undoAction(),
      redo: () => redoAction(),
      formatCode: () => { formatCode().catch(console.error); },
      toggleSidebar: () => toggleSidebar(),
      toggleDarkMode: () => toggleDarkMode(),
      toggleAutoRun: () => toggleAutoRun(),
      runCode: () => { runCode().catch(console.error); },
      clearConsole: () => clearConsole(),
      gitStatus: () => showGitStatus(),
      gitCommit: () => { commitAction().catch(console.error); },
      gitDiff: () => showGitDiff().catch(console.error),
      gitLog: () => showGitLog().catch(console.error),
      gitPush: () => { pushAction().catch(console.error); },
      gitPull: () => { pullAction().catch(console.error); },
      gitClone: () => { cloneAction().catch(console.error); },
      about: () => showAbout(),
      openShortcuts: () => showShortcuts(),
    };

    const fn = actionMap[action];
    if (fn) fn();
  });

  // Close menus on outside click
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".menu-item") && !target.closest(".menu-dropdown")) {
      closeAllMenus();
    }
  });

  // Close menus on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllMenus();
  });
}

// Toggle sidebar visibility
let sidebarVisible = true;
function toggleSidebar(): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebarVisible = !sidebarVisible;
  sidebar.style.display = sidebarVisible ? "" : "none";
}

// Markdown preview renderer
// Git UI dialogs

async function showGitStatus(): Promise<void> {
  try {
    const output = await gitStatus();
    showInfoDialog("Git Status", output || "No changes (clean working tree)");
  } catch {
    showError("Failed to get git status");
  }
}

async function showGitDiff(): Promise<void> {
  try {
    const diff = await gitDiff();
    if (!diff) {
      showInfoDialog("Git Diff", "No differences found.");
      return;
    }
    showInfoDialog("Git Diff", diff);
  } catch {
    showError("Failed to get git diff");
  }
}

async function showGitLog(): Promise<void> {
  try {
    const log = await gitLog();
    if (!log || log.trim().length === 0) {
      showInfoDialog("Git Log", "No commits yet.");
      return;
    }
    showInfoDialog("Git Log", log);
  } catch {
    showError("Failed to get git log");
  }
}

// Simple modal dialog

function showInfoDialog(title: string, body: string): void {
  // Remove existing dialog
  document.querySelector(".info-dialog-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "info-dialog-overlay";
  overlay.addEventListener("click", () => overlay.remove());

  const dialog = document.createElement("div");
  dialog.className = "info-dialog";
  dialog.addEventListener("click", (e) => e.stopPropagation());

  const header = document.createElement("div");
  header.className = "info-dialog-header";
  header.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "info-dialog-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);

  const bodyEl = document.createElement("pre");
  bodyEl.className = "info-dialog-body";
  bodyEl.textContent = body;

  dialog.appendChild(header);
  dialog.appendChild(bodyEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// About dialog
function showAbout(): void {
  showInfoDialog(
    "About HTMLRunner",
    `HTMLRunner v2.0.0\n\nA browser-based HTML/CSS/JavaScript code editor\nwith live preview, console, and git integration.\n\nBuilt with:\n  - CodeMirror 6\n  - Vite\n  - almostnode (Node.js runtime)\n  - wasm-git (libgit2 WASM)\n  - ZenFS\n  - Biome\n  - Prettier\n\nhttps://htmltoolkit.github.io/HTMLRunner/`
  );
}

function showShortcuts(): void {
  showInfoDialog(
    "Keyboard Shortcuts",
    `Ctrl/Cmd + Enter    Run code\nCtrl/Cmd + F        Find\nCtrl/Cmd + H        Find & Replace\nCtrl/Cmd + /        Toggle comment\nCtrl/Cmd + Z        Undo\nCtrl/Cmd + Y        Redo\nTab / Shift+Tab     Indent / Unindent\nEsc                 Close menus`
  );
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
      logFilters.set(Array.from(set));
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

const expandedFolders = new Set<string>();

function getDirPath(name: string): string {
  const idx = name.lastIndexOf("/");
  return idx >= 0 ? name.slice(0, idx) : "";
}

function getBaseName(name: string): string {
  const idx = name.lastIndexOf("/");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  file?: FileTab;
  children: TreeNode[];
}

function buildFileTree(files: FileTab[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.name.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: fullPath,
          isFile,
          children: [],
        };
        if (isFile) existing.file = file;
        current.push(existing);
      }
      if (!isFile) {
        current = existing.children;
      }
    }
  }

  function sortNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (!n.isFile) sortNodes(n.children);
    }
  }
  sortNodes(root);
  return root;
}

function renderTreeNode(
  node: TreeNode,
  activeId: string,
  depth: number,
): HTMLElement | null {
  if (node.isFile && node.name === ".gitkeep") return null;

  const item = document.createElement("div");

  if (node.isFile) {
    item.className = `file-tree-item${node.file && node.file.id === activeId ? " active" : ""}`;
    item.dataset.file = node.file?.id;

    const icon = document.createElement("i");
    const fileName = node.file?.name ?? node.name;
    icon.className = getFileIcon(fileName) + " file-tree-icon";
    item.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-tree-name";
    name.textContent = node.name;
    item.appendChild(name);
  } else {
    const isOpen = expandedFolders.has(node.path);
    item.className = "file-tree-folder";
    item.dataset.folder = node.path;

    const toggle = document.createElement("span");
    toggle.className = "file-tree-toggle";
    toggle.textContent = isOpen ? "▾" : "▸";
    item.appendChild(toggle);

    const icon = document.createElement("i");
    icon.className = "fas fa-folder" + (isOpen ? "-open" : "") + " file-tree-icon";
    item.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-tree-name";
    name.textContent = node.name;
    item.appendChild(name);

    if (isOpen) {
      const visible = node.children.filter(
        (c) => !(c.isFile && c.name === ".gitkeep"),
      );
      if (visible.length > 0) {
        const children = document.createElement("div");
        children.className = "file-tree-children";
        const sorted = [...visible].sort((a, b) => {
          if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
        let hasChild = false;
        for (const child of sorted) {
          const el = renderTreeNode(child, activeId, depth + 1);
          if (el) {
            children.appendChild(el);
            hasChild = true;
          }
        }
        if (hasChild) item.appendChild(children);
      }
    }
  }

  item.style.paddingLeft = `${depth * 16 + 4}px`;
  return item;
}

function renderFileTree(container: HTMLElement): void {
  const files = filesState.get();
  const activeId = activeFileState.get();

  container.innerHTML = "";

  const root = buildFileTree(files);
  for (const node of root) {
    const el = renderTreeNode(node, activeId, 0);
    if (el) container.appendChild(el);
  }
}

// Git indicator overlay

function renderGitStatus(container: HTMLElement, statusText: string): void {
  container.innerHTML = "";
  if (!statusText || statusText.includes("nothing to commit")) {
    container.innerHTML = '<span class="git-status-empty">No changes</span>';
    return;
  }
  const lines = statusText.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const item = document.createElement("div");
    item.className = "git-status-item";
    const name = document.createElement("span");
    name.className = "git-status-filename";
    name.textContent = line;
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
  const name = prompt("Enter filename (use / for folders):", "untitled.html");
  if (!name || !name.trim()) return;

  const fileName = name.trim();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const language = getLanguageForExt(ext);
  const template = getTemplateForExt(ext);

  const newFile: FileTab = {
    id: fileName,
    name: fileName,
    content: template,
    language,
  };

  const files = filesState.get();
  filesState.set([...files, newFile]);
  activeFileState.set(newFile.id);

  const file = filesState.get().find((f) => f.id === newFile.id);
  if (file) switchToFile(file);

  if (isGitReady()) {
    syncFileToWorker(fileName, template);
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
  if (file && isGitReady()) {
    // Worker handles deletion via git
  }
}

async function commitAction(): Promise<void> {
  const msg = prompt("Commit message:", "Update files");
  if (!msg || !msg.trim()) return;
  try {
    await syncAllFilesToWorker();
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
    const output = await gitStatus();
    renderGitStatus(statusEl, output);
  } catch {
    // VFS not ready yet
  }
}

async function pushAction(): Promise<void> {
  const remote = prompt("Remote name:", "origin") || "origin";
  const ref = prompt("Branch to push:", "main") || "main";
  try {
    showLoading();
    await syncAllFilesToWorker();
    await gitPush(remote, ref);
    showError(`Pushed to ${remote}/${ref}`);
  } catch (err) {
    console.error("Push failed:", err);
    showError(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hideLoading();
  }
}

async function pullAction(): Promise<void> {
  const remote = prompt("Remote name:", "origin") || "origin";
  const ref = prompt("Branch to pull:", "main") || "main";
  try {
    showLoading();
    await gitPull(remote, ref);
    showError(`Pulled from ${remote}/${ref}`);
    await refreshGitStatus();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(`Pull failed: ${msg}`);
  } finally {
    hideLoading();
  }
}

async function cloneAction(): Promise<void> {
  const url = prompt("Clone repository URL:");
  if (!url) return;
  try {
    showLoading();
    await gitClone(url);
    showError("Repository cloned");
    await refreshGitStatus();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(`Clone failed: ${msg}`);
  } finally {
    hideLoading();
  }
}

// Import files from disk

function importFilesAction(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".html,.htm,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.json,.svg,.xml,.txt,.md";
  input.addEventListener("change", async () => {
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    const newTabs: FileTab[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const content = await f.text();
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      const language = getLanguageForExt(ext);
      newTabs.push({ id: f.name, name: f.name, content, language });
    }
    if (newTabs.length > 0) {
      const currentFiles = filesState.get();
      filesState.set([...currentFiles, ...newTabs]);
      activeFileState.set(newTabs[0].id);
      const file = filesState.get().find((f) => f.id === newTabs[0].id);
      if (file) switchToFile(file);
    }
  });
  input.click();
}

// Tab management

function renameFileAction(id: string): void {
  const files = filesState.get();
  const file = files.find((f) => f.id === id);
  if (!file) return;
  const newName = prompt("Rename file:", file.name);
  if (!newName || !newName.trim() || newName.trim() === file.name) return;
  const trimmed = newName.trim();
  const ext = trimmed.split(".").pop()?.toLowerCase() || "";
  const language = getLanguageForExt(ext);
  const updated = files.map((f) =>
    f.id === id ? { ...f, id: trimmed, name: trimmed, language } : f,
  );
  filesState.set(updated);
  if (activeFileState.get() === id) {
    activeFileState.set(trimmed);
  }
  if (isGitReady()) {
    syncFileToWorker(trimmed, file.content);
  }
}

function duplicateFileAction(id: string): void {
  const files = filesState.get();
  const file = files.find((f) => f.id === id);
  if (!file) return;
  const dotIdx = file.name.lastIndexOf(".");
  let newName: string;
  if (dotIdx > 0) {
    newName = file.name.slice(0, dotIdx) + "-copy" + file.name.slice(dotIdx);
  } else {
    newName = file.name + "-copy";
  }
  let counter = 1;
  while (files.some((f) => f.name === newName)) {
    counter++;
    if (dotIdx > 0) {
      newName = file.name.slice(0, dotIdx) + `-copy${counter}` + file.name.slice(dotIdx);
    } else {
      newName = file.name + `-copy${counter}`;
    }
  }
  const newFile: FileTab = {
    id: newName,
    name: newName,
    content: file.content,
    language: file.language,
  };
  filesState.set([...files, newFile]);
  activeFileState.set(newName);
  const tab = filesState.get().find((f) => f.id === newName);
  if (tab) switchToFile(tab);
  if (isGitReady()) {
    syncFileToWorker(newName, file.content);
  }
}

function closeOthersAction(id: string): void {
  const files = filesState.get();
  const kept = files.filter((f) => f.id === id);
  if (kept.length === 0) return;
  const removed = files.filter((f) => f.id !== id);
  filesState.set(kept);
  activeFileState.set(id);
  switchToFile(kept[0]);
  if (isGitReady()) {
    for (const f of removed) {
      // Worker handles file deletion
    }
  }
}

function closeAllAction(): void {
  const files = filesState.get();
  if (files.length === 0) return;
  const removed = files.slice(1);
  const kept = files[0];
  filesState.set([kept]);
  activeFileState.set(kept.id);
  switchToFile(kept);
  if (isGitReady()) {
    for (const f of removed) {
      // Worker handles file deletion
    }
  }
}

function addFileInFolder(folderPath: string): void {
  const name = prompt(`Enter filename in "${folderPath}/":`, "untitled.html");
  if (!name || !name.trim()) return;

  const fileName = folderPath ? folderPath + "/" + name.trim() : name.trim();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const language = getLanguageForExt(ext);
  const template = getTemplateForExt(ext);

  const newFile: FileTab = {
    id: fileName,
    name: fileName,
    content: template,
    language,
  };

  const files = filesState.get();
  filesState.set([...files, newFile]);
  activeFileState.set(newFile.id);

  const file = filesState.get().find((f) => f.id === newFile.id);
  if (file) switchToFile(file);

  if (isGitReady()) {
    syncFileToWorker(fileName, template);
  }
}

function addFolderAction(): void {
  const name = prompt("Enter folder name:", "new-folder");
  if (!name || !name.trim()) return;

  const folderName = name.trim().replace(/\s+/g, "-").toLowerCase();
  const keepFile = ".gitkeep";
  const fileName = folderName + "/" + keepFile;

  const newFile: FileTab = {
    id: fileName,
    name: fileName,
    content: "",
    language: "text",
  };

  const files = filesState.get();
  filesState.set([...files, newFile]);

  expandedFolders.add(folderName);

  if (isGitReady()) {
    syncFileToWorker(fileName, "");
  }
}

function deleteFolderAction(folderPath: string): void {
  if (!confirm(`Delete folder "${folderPath}" and all files inside?`)) return;
  const files = filesState.get();
  const updated = files.filter((f) => {
    const dir = getDirPath(f.name);
    return dir !== folderPath && !dir.startsWith(folderPath + "/");
  });
  if (updated.length === files.length) return;
  filesState.set(updated);
  const activeId = activeFileState.get();
  if (!updated.find((f) => f.id === activeId) && updated.length > 0) {
    activeFileState.set(updated[0].id);
    switchToFile(updated[0]);
  }
}

function showFolderContextMenu(e: MouseEvent, folderPath: string): void {
  e.preventDefault();
  document.querySelector(".tab-context-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "tab-context-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const items = [
    {
      label: "New File",
      icon: "fa-file",
      action: () => addFileInFolder(folderPath),
    },
    {
      label: "New Folder",
      icon: "fa-folder",
      action: () => addSubfolderAction(folderPath),
    },
    {
      label: "Delete Folder",
      icon: "fa-trash",
      action: () => deleteFolderAction(folderPath),
    },
  ];

  for (const item of items) {
    const el = document.createElement("div");
    el.className = "context-menu-item";
    el.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label}`;
    el.addEventListener("click", () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(el);
  }

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 0);

  document.body.appendChild(menu);
}

function addSubfolderAction(parentPath: string): void {
  const name = prompt(`Enter folder name in "${parentPath}/":`, "new-folder");
  if (!name || !name.trim()) return;

  const folderName = parentPath + "/" + name.trim().replace(/\s+/g, "-").toLowerCase();
  const keepFile = ".gitkeep";
  const fileName = folderName + "/" + keepFile;

  const newFile: FileTab = {
    id: fileName,
    name: fileName,
    content: "",
    language: "text",
  };

  const files = filesState.get();
  filesState.set([...files, newFile]);
  expandedFolders.add(folderName);

  if (isGitReady()) {
    syncFileToWorker(fileName, "");
  }
}

// Tab context menu

function showTabContextMenu(e: MouseEvent, fileId: string): void {
  e.preventDefault();
  document.querySelector(".tab-context-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "tab-context-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const items = [
    { label: "Close", icon: "fa-times", action: () => closeFileAction(fileId) },
    { label: "Close Others", icon: "fa-times-circle", action: () => closeOthersAction(fileId) },
    { label: "Close All", icon: "fa-trash", action: () => closeAllAction() },
    { label: "Rename", icon: "fa-pencil", action: () => renameFileAction(fileId) },
    { label: "Duplicate", icon: "fa-copy", action: () => duplicateFileAction(fileId) },
  ];

  for (const item of items) {
    const el = document.createElement("div");
    el.className = "context-menu-item";
    el.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label}`;
    el.addEventListener("click", () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(el);
  }

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 0);

  document.body.appendChild(menu);
}

// Markdown-aware run code
async function runCodeAction(): Promise<void> {
  return runCode();
}

const actions = {
  runCode: runCodeAction,
  clearConsole,
  resetCode,
  formatCode,
  switchFile: switchFileAction,
  addFile: addFileAction,
  addFolder: addFolderAction,
  closeFile: closeFileAction,
  importFiles: importFilesAction,
  renameFile: renameFileAction,
  duplicateFile: duplicateFileAction,
  closeOthers: closeOthersAction,
  closeAll: closeAllAction,
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
  initGitService(worker);
  initBridge();

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
  const termEl = document.getElementById("terminal") as HTMLElement | null;
  if (termEl) {
    createTerminal(termEl);
  }
  window.addEventListener("resize", () => {
    fitTerminal();
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type !== "navigate") return;
    const href = event.data.href as string;
    if (!href) return;
    const files = filesState.get();
    const target = files.find((f) => f.name === href);
    if (!target) return;
    activeFileState.set(target.id);
    switchToFile(target);
    runCode().catch(console.error);
  });
  addGlobalSearchShortcuts();
  initializeMenuBar();

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

  const autoRunBtn = document.querySelector(".btn-auto-run") as HTMLButtonElement | null;
  if (autoRunBtn) bindEvent(autoRunBtn, "click", () => toggleAutoRun());

  const themeBtn = document.querySelector(".theme-toggle") as HTMLButtonElement | null;
  if (themeBtn) bindEvent(themeBtn, "click", () => toggleDarkMode());

  const autoRunEl = document.getElementById("auto-run-status");
  if (autoRunEl) bindText(autoRunEl, autoRunText);

  const previewOpenBtn = document.getElementById("preview-open-btn");
  if (previewOpenBtn && previewEl) {
    bindEvent(previewOpenBtn, "click", () => {
      const src = previewEl.src;
      if (src && src !== "about:blank") {
        window.open(src, "_blank");
      } else {
        showError("Run code first to preview");
      }
    });
  }

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

    fileTabsEl.addEventListener("contextmenu", (e) => {
      const target = e.target as HTMLElement;
      const tabEl = target.closest(".file-tab") as HTMLElement | null;
      if (tabEl && tabEl.dataset.file) {
        showTabContextMenu(e, tabEl.dataset.file);
      }
    });
  }

  const outputTerminalTabEl = document.querySelector(
    '.output-tabs .tab[data-output="terminal"]',
  ) as HTMLElement | null;

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
  if (outputTerminalTabEl) {
    effect(() => {
      outputTerminalTabEl.className = terminalClass.get();
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

  const termPanelEl = document.getElementById("terminal") as HTMLElement | null;

  effect(() => {
    const out = activeOutputState.get();
    if (previewEl)
      previewEl.className = out === "preview" ? "preview active" : "preview";
    if (consoleEl)
      consoleEl.className = out === "console" ? "console active" : "console";
    if (termPanelEl)
      termPanelEl.className = out === "terminal" ? "terminal-panel active" : "terminal-panel";
  });
  effect(() => {
    if (activeOutputState.get() === "terminal") {
      requestAnimationFrame(() => fitTerminal());
    }
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
      const fileItem = target.closest(".file-tree-item") as HTMLElement | null;
      const folder = !fileItem ? target.closest(".file-tree-folder") as HTMLElement | null : null;

      if (fileItem && fileItem.dataset.file) {
        actions.switchFile(fileItem.dataset.file);
      } else if (folder) {
        const path = folder.dataset.folder;
        if (!path) return;
        if (expandedFolders.has(path)) {
          expandedFolders.delete(path);
        } else {
          expandedFolders.add(path);
        }
        renderFileTree(fileTreeEl);
      }
    });

    fileTreeEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const fileItem = target.closest(".file-tree-item") as HTMLElement | null;
      const folder = target.closest(".file-tree-folder") as HTMLElement | null;

      if (fileItem && fileItem.dataset.file) {
        showTabContextMenu(e, fileItem.dataset.file);
      } else if (folder) {
        const folderPath = folder.dataset.folder;
        if (!folderPath) return;
        showFolderContextMenu(e, folderPath);
      }
    });
  }

  // Sidebar file buttons

  const newFileBtn = document.getElementById("sidebar-new-btn");
  if (newFileBtn) {
    bindEvent(newFileBtn, "click", () => actions.addFile());
  }

  const folderBtn = document.getElementById("sidebar-folder-btn");
  if (folderBtn) {
    bindEvent(folderBtn, "click", () => actions.addFolder());
  }

  const importBtn = document.getElementById("sidebar-import-btn");
  if (importBtn) {
    bindEvent(importBtn, "click", () => actions.importFiles());
  }

  // Cursor position

  const cursorEl = document.getElementById("cursor-position");
  if (cursorEl) {
    effect(() => {
      const pos = cursorPos.get();
      cursorEl.textContent = `Ln ${pos.line}, Col ${pos.col}`;
    });
  }

  // Git commit button

  const gitBtn = document.getElementById("sidebar-git-btn");
  if (gitBtn) {
    bindEvent(gitBtn, "click", () => void commitAction());
  }

  // Auto-refresh git status periodically

  setInterval(() => {
    if (isGitReady()) {
      refreshGitStatus().catch((err) => console.warn("Git status refresh failed:", err));
    }
  }, 5000);

  // Sync files to VFS on change

  effect(() => {
    const files = filesState.get();
    if (isGitReady()) {
      syncFilesDebounced(files);
    }
  });

});
