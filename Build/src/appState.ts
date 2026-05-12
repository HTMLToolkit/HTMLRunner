import { effect, path, signal } from "@nisoku/sairin";
import type { State } from "./types";
import { defaultCss, defaultHtml, defaultJs } from "./defaultContent";
import { editors } from "./editor";
import { showError, switchOutput, switchTab } from "./ui";
import { runCode } from "./runner";

function readPersistedState(): Partial<State> | null {
  try {
    const savedState = localStorage.getItem("htmlRunnerState");
    if (!savedState) {
      return null;
    }

    return JSON.parse(savedState) as Partial<State>;
  } catch {
    return null;
  }
}

const persistedState = readPersistedState();

const darkModeInitial =
  persistedState?.darkMode ?? localStorage.getItem("darkMode") === "true";
const autoRunInitial =
  persistedState?.autoRun ?? localStorage.getItem("autoRun") === "true";
const htmlInitial = persistedState?.html ?? defaultHtml;
const cssInitial = persistedState?.css ?? defaultCss;
const jsInitial = persistedState?.js ?? defaultJs;
const activeTabInitial = persistedState?.activeTab ?? "html";
const activeOutputInitial = persistedState?.activeOutput ?? "preview";
const splitSizesInitial =
  Array.isArray(persistedState?.splitSizes) && persistedState.splitSizes.length === 2
    ? persistedState.splitSizes
    : [50, 50];
const STORAGE_KEY = "htmlRunnerState";

export const htmlState = signal(path("htmlrunner", "editor", "html"), htmlInitial);
export const cssState = signal(path("htmlrunner", "editor", "css"), cssInitial);
export const jsState = signal(path("htmlrunner", "editor", "js"), jsInitial);
export const activeTabState = signal(path("htmlrunner", "ui", "activeTab"), activeTabInitial);
export const activeOutputState = signal(path("htmlrunner", "ui", "activeOutput"), activeOutputInitial);
export const splitSizesState = signal(path("htmlrunner", "layout", "splitSizes"), splitSizesInitial);
export const darkModeState = signal(path("htmlrunner", "ui", "darkMode"), darkModeInitial);
export const autoRunState = signal(path("htmlrunner", "editor", "autoRun"), autoRunInitial);
export const stateHydrated = signal(path("htmlrunner", "meta", "stateHydrated"), false);

effect(() => {
  if (!stateHydrated.get()) {
    return;
  }

  localStorage.setItem("htmlRunnerState", JSON.stringify(createStateSnapshot()));
});

export function createStateSnapshot(): State {
  return {
    html: htmlState.get(),
    css: cssState.get(),
    js: jsState.get(),
    activeTab: activeTabState.get(),
    activeOutput: activeOutputState.get(),
    splitSizes: splitSizesState.get(),
    darkMode: darkModeState.get(),
    autoRun: autoRunState.get(),
  };
}

export function applyStateSnapshot(snapshot: Partial<State>): void {
  if (typeof snapshot.html === "string") {
    htmlState.set(snapshot.html);
  }

  if (typeof snapshot.css === "string") {
    cssState.set(snapshot.css);
  }

  if (typeof snapshot.js === "string") {
    jsState.set(snapshot.js);
  }

  if (typeof snapshot.activeTab === "string") {
    activeTabState.set(snapshot.activeTab);
  }

  if (typeof snapshot.activeOutput === "string") {
    activeOutputState.set(snapshot.activeOutput);
  }

  if (
    Array.isArray(snapshot.splitSizes) &&
    snapshot.splitSizes.length === 2 &&
    snapshot.splitSizes.every((size) => typeof size === "number")
  ) {
    splitSizesState.set(snapshot.splitSizes);
  }

  if (typeof snapshot.darkMode === "boolean") {
    darkModeState.set(snapshot.darkMode);
  }

  if (typeof snapshot.autoRun === "boolean") {
    autoRunState.set(snapshot.autoRun);
  }
}

export function markStateHydrated(): void {
  stateHydrated.set(true);
}

export function loadState(): void {
  try {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
      const parsed = JSON.parse(savedState) as Partial<State>;
      applyStateSnapshot(parsed);

      editors.html.view.dispatch({
        changes: {
          from: 0,
          to: editors.html.view.state.doc.length,
          insert: htmlState.get(),
        },
      });
      editors.css.view.dispatch({
        changes: {
          from: 0,
          to: editors.css.view.state.doc.length,
          insert: cssState.get(),
        },
      });
      editors.js.view.dispatch({
        changes: {
          from: 0,
          to: editors.js.view.state.doc.length,
          insert: jsState.get(),
        },
      });

      if (["html", "css", "js"].includes(activeTabState.get())) {
        switchTab(activeTabState.get());
      }
      if (["preview", "console"].includes(activeOutputState.get())) {
        switchOutput(activeOutputState.get());
      }

      runCode();
      markStateHydrated();
    } else {
      resetCode(true);
      markStateHydrated();
    }
  } catch (e: any) {
    showError("Failed to load state: " + e.message);
    resetCode(true);
    markStateHydrated();
  }
}

export function resetCode(skipConfirmation: boolean = false): void {
  if (skipConfirmation || confirm("Are you sure you want to reset all code?")) {
    editors.html.view.dispatch({
      changes: {
        from: 0,
        to: editors.html.view.state.doc.length,
        insert: defaultHtml,
      },
    });

    editors.css.view.dispatch({
      changes: {
        from: 0,
        to: editors.css.view.state.doc.length,
        insert: defaultCss,
      },
    });

    editors.js.view.dispatch({
      changes: {
        from: 0,
        to: editors.js.view.state.doc.length,
        insert: defaultJs,
      },
    });

    runCode();
    markStateHydrated();
  }
}