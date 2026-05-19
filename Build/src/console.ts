import { ConsoleMessage, StackInfo, ConsoleData } from "./types";
import { editor } from "./editor";
import { signal, effect, path } from "@nisoku/sairin";
import { logFilters } from "./appState";

// Signal holding the console messages for reactive rendering
export const consoleEntries = signal(
  path("htmlrunner", "console", "entries"),
  [] as ConsoleMessage[],
);

// Cached DOM node (set during initializeConsole when DOM is ready)
let consoleOutputEl: HTMLDivElement | null = null;

function renderConsoleEntries(entries: ConsoleMessage[]): void {
  if (!consoleOutputEl) return;
  const frag = document.createDocumentFragment();
  for (const ev of entries) {
    const entry = document.createElement("div");
    const filters = logFilters.get();
    const filtered = !filters.includes(ev.level);
    entry.className = `console-entry${filtered ? " filtered" : ""}`;

    const timestamp = document.createElement("span");
    timestamp.className = "timestamp";
    timestamp.textContent = new Date(ev.timestamp).toLocaleTimeString();

    const message = document.createElement("span");
    message.className = `console-${ev.level}`;
    if (ev.data && ev.data.length) {
      ev.data.forEach((item: ConsoleData, i: number) => {
        if (i > 0) message.appendChild(document.createTextNode(" "));
        if (item && typeof item === "object") {
          message.appendChild(renderObject(item));
        } else {
          message.appendChild(document.createTextNode(String(item)));
        }
      });
    }

    // stack rendering (same logic as before)
    const maybeStack = ev.data[1];
    if (
      maybeStack &&
      typeof maybeStack === "object" &&
      "stack" in (maybeStack as Record<string, unknown>)
    ) {
      const stack = document.createElement("div");
      stack.className = "console-stack";
      const stackVal = (maybeStack as Record<string, unknown>)["stack"];
      const rawStack: string =
        typeof stackVal === "string" ? stackVal : String(stackVal);
      rawStack.split("\n").forEach((line) => {
        const lineEl = document.createElement("div");
        lineEl.className = "console-stack-line";
        lineEl.textContent = line.trim();

        let lineNum: number | undefined;
        let colNum: number | undefined;
        const patterns: RegExp[] = [
          /\(([^)]+):(\d+):(\d+)\)$/, // at fn (file:line:col)
          /([^@()\s]+):(\d+):(\d+)$/, // fn@file:line:col or file:line:col
          /([^@()\s]+):(\d+)$/, // file:line
        ];
        for (const pat of patterns) {
          const m = line.match(pat);
          if (m) {
            lineNum = parseInt(m[2], 10);
            if (m[3]) colNum = parseInt(m[3], 10);
            break;
          }
        }

        if (lineNum) {
          lineEl.classList.add("clickable");
          lineEl.addEventListener("click", () => {
            if (!editor.view) return;
            const doc = editor.view.state.doc;
            const maxLine = doc.lines;
            const safeLine = Math.max(1, Math.min(lineNum as number, maxLine));
            const lineObj = doc.line(safeLine);
            const offset = Math.min(
              lineObj.to,
              lineObj.from + Math.max(0, (colNum || 1) - 1),
            );
            editor.view.dispatch({ selection: { anchor: offset } });
            editor.view.focus();
          });
        }
        stack.appendChild(lineEl);
      });
      stack.addEventListener("click", (e) => {
        if (e.target === stack) stack.classList.toggle("expanded");
      });
      message.appendChild(stack);
    }

    entry.appendChild(timestamp);
    entry.appendChild(document.createTextNode(" "));
    entry.appendChild(message);
    frag.appendChild(entry);
  }
  consoleOutputEl.replaceChildren(frag);
  consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
}

// Re-render console output whenever entries change
effect(() => {
  const entries = consoleEntries.get();
  if (!consoleOutputEl) return;
  renderConsoleEntries(entries);
});

// Console interceptor code that will be injected into the preview iframe
export const consoleInterceptor = `
    const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    function sendToConsole(level, ...args) {
        window.parent.postMessage({ type: 'console', level, data: args, timestamp: new Date().toISOString() }, '*');
        originalConsole[level].apply(console, args);
    }
    console.log = (...args) => sendToConsole('log', ...args);
    console.error = (...args) => sendToConsole('error', ...args);
    console.warn = (...args) => sendToConsole('warn', ...args);
    console.info = (...args) => sendToConsole('info', ...args);
    window.onerror = (message, source, lineno, colno, error) => {
        sendToConsole('error', error || message, { stack: error?.stack });
        return true;
    };
    window.onunhandledrejection = (event) => {
        sendToConsole('error', event.reason, { stack: event.reason?.stack });
    };
`;

// Initialize console message handler
export function initializeConsole(): void {
  // Cache the console output element now that DOM is ready
  consoleOutputEl = document.getElementById("console") as HTMLDivElement | null;
  // render any existing entries immediately
  if (consoleOutputEl) renderConsoleEntries(consoleEntries.get());
  window.addEventListener("message", handleConsoleMessage);
}
function handleConsoleMessage(event: MessageEvent<ConsoleMessage>): void {
  if (event.data.type === "console") {
    // Append to signal list
    const prev = consoleEntries.get();
    consoleEntries.set([...prev, event.data]);
  }
}

function renderObject(
  obj: ConsoleData,
  level = 0,
  visited = new WeakSet<object>(),
): Node {
  if (obj === null) return document.createTextNode("null");
  if (
    typeof obj === "string" ||
    typeof obj === "number" ||
    typeof obj === "boolean"
  )
    return document.createTextNode(String(obj));
  if (obj instanceof Error) {
    const errorEl = document.createElement("span");
    errorEl.className = "console-error";
    errorEl.textContent = `${obj.name}: ${obj.message}`;
    if ((obj as Error).stack)
      errorEl.textContent += `\n${(obj as Error).stack!.split("\n").slice(1).join("\n")}`;
    const container = document.createElement("span");
    container.appendChild(errorEl);
    return container;
  }
  // At this point obj is either an array-like or object with console-able entries
  const asObj = obj as Record<string, ConsoleData> | ConsoleData[];
  if (visited.has(asObj as object))
    return document.createTextNode("[Circular]");
  if (level > 3) return document.createTextNode("[...]");
  visited.add(asObj as object);

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
  preview.textContent = Array.isArray(asObj)
    ? `Array(${(asObj as ConsoleData[]).length})`
    : "{...}";
  const content = document.createElement("div");
  content.className = "console-object-content";

  if (Array.isArray(asObj)) {
    asObj.forEach((v: ConsoleData) => {
      const prop = document.createElement("div");
      prop.appendChild(renderObject(v, level + 1, visited));
      content.appendChild(prop);
    });
  } else {
    Object.entries(asObj as Record<string, ConsoleData>).forEach(
      ([key, value]) => {
        const prop = document.createElement("div");
        prop.textContent = `${key}: `;
        prop.appendChild(renderObject(value, level + 1, visited));
        content.appendChild(prop);
      },
    );
  }

  preview.addEventListener("click", (e) => {
    e.stopPropagation();
    preview.classList.toggle("expanded");
  });

  container.appendChild(preview);
  container.appendChild(content);
  return container;
}

export function clearConsole(): void {
  consoleEntries.set([]);
}

export function logConsoleError(message: string, stack: StackInfo = {}): void {
  const prev = consoleEntries.get();
  const entry: ConsoleMessage = {
    type: "console",
    level: "error",
    data: [message, stack],
    timestamp: new Date().toISOString(),
  };
  consoleEntries.set([...prev, entry]);
}
