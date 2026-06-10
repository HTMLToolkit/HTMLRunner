import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let container: HTMLElement | null = null;

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
  term.write("Welcome to HTMLRunner terminal\r\n");
  term.write("$ ");

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

export function writeTerminal(text: string): void {
  term?.write(text);
}

export function writelnTerminal(text: string): void {
  term?.writeln(text);
}

export function clearTerminal(): void {
  term?.clear();
  term?.write("$ ");
}
