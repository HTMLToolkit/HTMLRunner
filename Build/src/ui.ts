import {
  activeOutputState,
  autoRunState,
  darkModeState,
  errorMessage,
  loadingVisible,
} from "./appState";
import { setAutoRun, setDarkMode } from "./editor";

export function showLoading(): void {
  loadingVisible.set(true);
}

export function hideLoading(): void {
  loadingVisible.set(false);
}

export function showError(message: string): void {
  errorMessage.set(message);
  setTimeout(() => errorMessage.set(""), 5000);
}

export function switchOutput(output: string): void {
  activeOutputState.set(output);
}

export function toggleAutoRun(): void {
  const newAutoRun = !autoRunState.get();
  setAutoRun(newAutoRun);
}

export function toggleDarkMode(): void {
  const newDarkMode = !darkModeState.get();
  setDarkMode(newDarkMode);
}
