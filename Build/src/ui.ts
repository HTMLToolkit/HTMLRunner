import { editors, setDarkMode, setAutoRun, autoRunListener } from "./editor";
import {
  activeOutputState,
  activeTabState,
  autoRunState,
  darkModeState,
  loadingVisible,
  errorMessage,
} from "./appState";

export function showLoading(): void {
  loadingVisible.set(true);
}

export function hideLoading(): void {
  loadingVisible.set(false);
}

export function showError(message: string): void {
  errorMessage.set(message);
  // clear after a short timeout
  setTimeout(() => errorMessage.set(""), 5000);
}

export function switchTab(tab: string): void {
  // Set the active tab state; UI bindings handle DOM updates
  activeTabState.set(tab);
  // Ensure the editor for the active tab receives focus
  if (editors[tab]) editors[tab].view.focus();
}

export function switchOutput(output: string): void {
  // Update output state; UI bindings update DOM
  activeOutputState.set(output);
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
}

export function toggleDarkMode(): void {
  const newDarkMode = !darkModeState.get();
  // Only update the stored dark mode state and theme icon; bindings handle body class
  setDarkMode(newDarkMode);
  updateThemeIcon();
}

export function updateThemeIcon(): void {
  // Update theme signals; DOM updates are handled by app-level bindings.
}

export function setPageDarkMode(value: boolean): void {
  // Persist dark-mode state and update theme icon
  setDarkMode(value);
  updateThemeIcon();
}
