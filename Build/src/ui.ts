import {
  editors,
  setDarkMode,
  setAutoRun,
  autoRunListener,
} from "./editor";
import { runCode } from "./runner";
import { debounce } from "./utils";
import { EditorView } from "@codemirror/view";
import {
  activeOutputState,
  activeTabState,
  autoRunState,
  darkModeState,
} from "./appState";

export const loadingEl = document.getElementById("loading") as HTMLDivElement;
export const errorEl = document.getElementById(
  "error-message"
) as HTMLDivElement;

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
  activeTabState.set(tab);

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
}


export function switchOutput(output: string): void {
  activeOutputState.set(output);
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
}

export function toggleAutoRun(): void {
  const newAutoRun = !autoRunState.get();
  setAutoRun(newAutoRun);

  Object.values(editors).forEach((editor) => {
    const listener = newAutoRun ? autoRunListener : [];
    editor.view.dispatch({
      effects: editor.autoRunCompartment.reconfigure(listener),
    });
  });

  updateAutoRunStatus();
}

export function updateAutoRunStatus(): void {
  const statusEl = document.getElementById("auto-run-status");
  if (statusEl) {
    statusEl.textContent = autoRunState.get() ? "On" : "Off";
  }
}

export function toggleDarkMode(): void {
  const newDarkMode = !darkModeState.get();
  setPageDarkMode(newDarkMode);
}

export function updateThemeIcon(): void {
  const icon = document.querySelector(".theme-toggle i");
  const label = document.querySelector(".theme-toggle span");
  if (label) {
    label.textContent = darkModeState.get() ? "Light Mode" : "Dark Mode";
  }
  if (icon) {
    icon.classList.toggle("fa-moon", !darkModeState.get());
    icon.classList.toggle("fa-sun", darkModeState.get());
  }
}

export function setPageDarkMode(value: boolean): void {
  setDarkMode(value);
  document.body.classList.toggle("dark-mode", value);
  updateThemeIcon();
}