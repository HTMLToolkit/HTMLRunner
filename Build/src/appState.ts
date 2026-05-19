import { effect, path, signal } from "@nisoku/sairin";
import type { State, Actions } from "./types";
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
  Array.isArray(persistedState?.splitSizes) &&
  persistedState.splitSizes.length === 2
    ? persistedState.splitSizes
    : [50, 50];
const STORAGE_KEY = "htmlRunnerState";

const logFiltersInitial = Array.isArray(persistedState?.logFilters)
  ? (persistedState!.logFilters as string[])
  : ["log", "error", "warn", "info"];

const ALLOWED_TABS = ["html", "css", "js"] as const;
const ALLOWED_OUTPUTS = ["preview", "console"] as const;

let _lastPersistedSnapshot = "";
let _idleHandle: number | null = null;
let _timeoutHandle: number | null = null;

export const htmlState = signal(
  path("htmlrunner", "editor", "html"),
  htmlInitial,
);
export const cssState = signal(path("htmlrunner", "editor", "css"), cssInitial);
export const jsState = signal(path("htmlrunner", "editor", "js"), jsInitial);
export const activeTabState = signal(
  path("htmlrunner", "ui", "activeTab"),
  activeTabInitial,
);
export const activeOutputState = signal(
  path("htmlrunner", "ui", "activeOutput"),
  activeOutputInitial,
);
export const splitSizesState = signal(
  path("htmlrunner", "layout", "splitSizes"),
  splitSizesInitial,
);
export const darkModeState = signal(
  path("htmlrunner", "ui", "darkMode"),
  darkModeInitial,
);
export const autoRunState = signal(
  path("htmlrunner", "editor", "autoRun"),
  autoRunInitial,
);
export const logFilters = signal(
  path("htmlrunner", "console", "filters"),
  logFiltersInitial,
);
export const stateHydrated = signal(
  path("htmlrunner", "meta", "stateHydrated"),
  false,
);

// UI visibility and messages
export const loadingVisible = signal(
  path("htmlrunner", "ui", "loadingVisible"),
  false,
);
export const errorMessage = signal(
  path("htmlrunner", "ui", "errorMessage"),
  "",
);
export const errorVisible = signal(
  path("htmlrunner", "ui", "errorVisible"),
  false,
);
effect(() => errorVisible.set(errorMessage.get().length > 0));

// Theme UI bindings
export const themeLabel = signal(
  path("htmlrunner", "ui", "themeLabel"),
  darkModeState.get() ? "Light Mode" : "Dark Mode",
);
export const themeIconClass = signal(
  path("htmlrunner", "ui", "themeIconClass"),
  darkModeState.get() ? "fas fa-sun" : "fas fa-moon",
);
effect(() => {
  themeLabel.set(darkModeState.get() ? "Light Mode" : "Dark Mode");
  themeIconClass.set(darkModeState.get() ? "fas fa-sun" : "fas fa-moon");
});

export const autoRunText = signal(
  path("htmlrunner", "ui", "autoRunText"),
  autoRunState.get() ? "On" : "Off",
);
effect(() => autoRunText.set(autoRunState.get() ? "On" : "Off"));

export const htmlVisible = signal(
  path("htmlrunner", "ui", "htmlVisible"),
  activeTabState.get() === "html",
);
export const cssVisible = signal(
  path("htmlrunner", "ui", "cssVisible"),
  activeTabState.get() === "css",
);
export const jsVisible = signal(
  path("htmlrunner", "ui", "jsVisible"),
  activeTabState.get() === "js",
);
effect(() => {
  htmlVisible.set(activeTabState.get() === "html");
  cssVisible.set(activeTabState.get() === "css");
  jsVisible.set(activeTabState.get() === "js");
});

export const tabHtmlClass = signal(
  path("htmlrunner", "ui", "tabHtmlClass"),
  activeTabState.get() === "html" ? "tab active" : "tab",
);
export const tabCssClass = signal(
  path("htmlrunner", "ui", "tabCssClass"),
  activeTabState.get() === "css" ? "tab active" : "tab",
);
export const tabJsClass = signal(
  path("htmlrunner", "ui", "tabJsClass"),
  activeTabState.get() === "js" ? "tab active" : "tab",
);
effect(() => {
  tabHtmlClass.set(activeTabState.get() === "html" ? "tab active" : "tab");
  tabCssClass.set(activeTabState.get() === "css" ? "tab active" : "tab");
  tabJsClass.set(activeTabState.get() === "js" ? "tab active" : "tab");
});

export const previewClass = signal(
  path("htmlrunner", "ui", "previewClass"),
  activeOutputState.get() === "preview" ? "tab active" : "tab",
);
export const consoleClass = signal(
  path("htmlrunner", "ui", "consoleClass"),
  activeOutputState.get() === "console" ? "tab active" : "tab",
);
effect(() => {
  previewClass.set(
    activeOutputState.get() === "preview" ? "tab active" : "tab",
  );
  consoleClass.set(
    activeOutputState.get() === "console" ? "tab active" : "tab",
  );
});

export const bodyClass = signal(
  path("htmlrunner", "ui", "bodyClass"),
  darkModeState.get() ? "dark-mode" : "",
);
// Resizing state and computed body class
export const isResizing = signal(path("htmlrunner", "ui", "isResizing"), false);
export const resizingClass = signal(
  path("htmlrunner", "ui", "resizingClass"),
  "",
);
effect(() => {
  const parts: string[] = [];
  if (darkModeState.get()) parts.push("dark-mode");
  const rc = resizingClass.get();
  if (rc) parts.push(rc);
  bodyClass.set(parts.join(" "));
});

// Global action registry
export const globalActions = signal(
  path("htmlrunner", "global", "actions"),
  {} as Actions,
);

effect(() => {
  if (!stateHydrated.get()) return;

  const snapshot = createStateSnapshot();
  const snapshotStr = JSON.stringify(snapshot);

  // Skip if nothing changed since last successful persist
  if (snapshotStr === _lastPersistedSnapshot) return;

  // Cancel pending schedules
  if (_idleHandle != null && window.cancelIdleCallback) {
    window.cancelIdleCallback(_idleHandle);
    _idleHandle = null;
  }
  if (_timeoutHandle != null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }

  const writeNow = () => {
    try {
      localStorage.setItem(STORAGE_KEY, snapshotStr);
      _lastPersistedSnapshot = snapshotStr;
    } catch (e) {
      console.warn("Failed to persist state:", e);
    }
  };

  // Prefer idle callback when available, fallback to a short timeout (500ms)
  if (typeof window.requestIdleCallback === "function") {
    _idleHandle = window.requestIdleCallback(
      () => {
        writeNow();
        _idleHandle = null;
      },
      { timeout: 1000 },
    );
  } else {
    _timeoutHandle = window.setTimeout(() => {
      writeNow();
      _timeoutHandle = null;
    }, 500);
  }

  return () => {
    if (_idleHandle != null && window.cancelIdleCallback) {
      window.cancelIdleCallback(_idleHandle);
      _idleHandle = null;
    }
    if (_timeoutHandle != null) {
      clearTimeout(_timeoutHandle);
      _timeoutHandle = null;
    }
  };
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
    logFilters: logFilters.get(),
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
    if ((ALLOWED_TABS as readonly string[]).includes(snapshot.activeTab)) {
      activeTabState.set(snapshot.activeTab);
    } else {
      console.warn("Ignoring invalid persisted activeTab:", snapshot.activeTab);
    }
  }

  if (typeof snapshot.activeOutput === "string") {
    if (
      (ALLOWED_OUTPUTS as readonly string[]).includes(snapshot.activeOutput)
    ) {
      activeOutputState.set(snapshot.activeOutput);
    } else {
      console.warn(
        "Ignoring invalid persisted activeOutput:",
        snapshot.activeOutput,
      );
    }
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

  if (Array.isArray(snapshot.logFilters)) {
    logFilters.set(snapshot.logFilters as string[]);
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    showError("Failed to load state: " + msg);
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
