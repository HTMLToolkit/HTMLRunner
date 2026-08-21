import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { executeCommand, setTerminalWriters } from "./shell";

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let container: HTMLElement | null = null;
let lineBuffer = "";
const history: string[] = [];
let historyIndex = -1;

export function getTerminal(): Terminal | null {
  return term;
}

export function createTerminal(el: HTMLElement): void {
  container = el;
  container.innerHTML = "";

  fitAddon = new FitAddon();

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 13,
    fontFamily: "'Courier New', 'Consolas', monospace",
    rows: 10,
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#e5e5e5",
    },
  });

  term.loadAddon(fitAddon);
  term.open(el);

  setTerminalWriters(
    (text) => term?.write(text),
    (text) => term?.writeln(text),
  );

  term.write("Welcome to HTMLRunner terminal\r\n");
  term.write("$ ");

  lineBuffer = "";

  term.onKey((e) => {
    const { key, domEvent } = e;
    const ev = domEvent as KeyboardEvent;

    if (ev.ctrlKey && key === "c") {
      term?.write("^C\r\n$ ");
      lineBuffer = "";
      historyIndex = -1;
      return;
    }

    if (ev.ctrlKey && key === "l") {
      term?.write("\x1b[2J\x1b[H$ ");
      lineBuffer = "";
      return;
    }

    if (key === "\r") {
      term?.writeln("");
      const cmd = lineBuffer;
      lineBuffer = "";
      historyIndex = -1;
      if (cmd.trim()) {
        history.push(cmd);
        executeCommand(cmd).finally(() => {
          term?.write("$ ");
        });
      } else {
        term?.write("$ ");
      }
    } else if (key === "\x7f") {
      if (lineBuffer.length > 0) {
        lineBuffer = lineBuffer.slice(0, -1);
        term?.write("\b \b");
      }
    } else if (key === "\x1b[A") {
      if (history.length > 0) {
        const idx = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
        historyIndex = idx;
        clearLine();
        lineBuffer = history[idx];
        term?.write(lineBuffer);
      }
    } else if (key === "\x1b[B") {
      if (historyIndex >= 0) {
        const idx = historyIndex + 1;
        if (idx >= history.length) {
          historyIndex = -1;
          clearLine();
          lineBuffer = "";
        } else {
          historyIndex = idx;
          clearLine();
          lineBuffer = history[idx];
          term?.write(lineBuffer);
        }
      }
    } else if (key === "\x1b[C") {
      // Right arrow - ignore
    } else if (key === "\x1b[D") {
      // Left arrow - ignore
    } else if (ev.ctrlKey && key === "a") {
      // Home - ignore (no cursor movement support)
    } else if (ev.ctrlKey && key === "e") {
      // End - ignore
    } else if (key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      lineBuffer += key;
      term?.write(key);
    }
  });

  requestAnimationFrame(() => {
    fitAddon?.fit();
  });
}

export function fitTerminal(): void {
  try {
    fitAddon?.fit();
  } catch {
    // not mounted
  }
}

export function clearTerminal(): void {
  term?.clear();
  term?.write("$ ");
}

function clearLine(): void {
  if (!term) return;
  for (let i = 0; i < lineBuffer.length; i++) {
    term.write("\b \b");
  }
}
