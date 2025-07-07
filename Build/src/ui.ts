import {
  editors,
  isDarkMode,
  isAutoRun,
  setDarkMode,
  setAutoRun,
} from "./editor";
import { saveState } from "./state";
import { runCode } from "./runner";
import { debounce } from "./utils";
import { EditorView } from "@codemirror/view";

export const loadingEl = document.getElementById("loading") as HTMLDivElement;
export const errorEl = document.getElementById(
  "error-message"
) as HTMLDivElement;

let currentTab = "html";
let currentOutput = "preview";

export function showLoading(): void {
  loadingEl.classList.add("active");
}

export function hideLoading(): void {
  loadingEl.classList.remove("active");
}

export function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.style.display = "block";
  setTimeout(() => (errorEl.style.display = "none"), 5000);
}

export function switchTab(tab: string): void {
  currentTab = tab;

  // Hide all editor containers
  document.querySelectorAll(".editor-container").forEach((c) => {
    const container = c as HTMLElement;
    container.style.display = "none";
  });

  const editorContainer = document.getElementById(`${tab}-editor-container`);
  const tabElement = document.querySelector(
    `.editor-tabs .tab[data-tab="${tab}"]`
  );

  if (!editorContainer || !tabElement || !editors[tab]) {
    console.error(`Invalid tab: ${tab}`);
    return;
  }

  // Remove 'active' class from all tabs
  document
    .querySelectorAll(".editor-tabs .tab")
    .forEach((t) => t.classList.remove("active"));

  // Show the selected container and mark tab as active
  editorContainer.style.display = "block";
  tabElement.classList.add("active");

  editors[tab].view.focus();
  saveState();
}


export function switchOutput(output: string): void {
  currentOutput = output;
  const previewEl = document.getElementById("preview");
  const consoleEl = document.getElementById("console");
  const targetEl = document.getElementById(output);
  const tabEl = document.querySelector(
    `.output-tabs .tab[data-output="${output}"]`
  );

  if (!previewEl || !consoleEl || !targetEl || !tabEl) {
    console.error(`Invalid output: ${output}`);
    return;
  }

  previewEl.classList.remove("active");
  consoleEl.classList.remove("active");
  targetEl.classList.add("active");
  document
    .querySelectorAll(".output-tabs .tab")
    .forEach((t) => t.classList.remove("active"));
  tabEl.classList.add("active");
  saveState();
}

export function toggleAutoRun(): void {
  const newAutoRun = !isAutoRun;
  setAutoRun(newAutoRun);
  localStorage.setItem("autoRun", String(newAutoRun));

  Object.values(editors).forEach((editor) => {
    const listener = newAutoRun
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

  updateAutoRunStatus();
}

export function updateAutoRunStatus(): void {
  const statusEl = document.getElementById("auto-run-status");
  if (statusEl) {
    statusEl.textContent = isAutoRun ? "On" : "Off";
  }
}

export function toggleDarkMode(): void {
  setDarkMode(!isDarkMode);
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("darkMode", String(isDarkMode));
  updateThemeIcon();
}

export function updateThemeIcon(): void {
  const icon = document.querySelector(".theme-toggle i");
  const label = document.querySelector(".theme-toggle span");
  if (label) {
    label.textContent = isDarkMode ? "Light Mode" : "Dark Mode";
  }
  if (icon) {
    icon.classList.toggle("fa-moon", !isDarkMode);
    icon.classList.toggle("fa-sun", isDarkMode);
  }
}

export function setPageDarkMode(value: boolean): void {
  setDarkMode(value);
  document.body.classList.toggle("dark-mode", value);
  localStorage.setItem("darkMode", String(value));
  updateThemeIcon();
}