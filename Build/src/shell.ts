import { getContainer, isContainerReady } from "./container";
import {
  gitInit,
  gitClone,
  gitCommit,
  gitStatus,
  gitLog,
  gitDiff,
  gitPush,
  gitPull,
  gitBranches,
  gitCheckout,
  isGitReady,
  syncAllFilesToWorker,
  requestFilesFromWorker,
} from "./git-service";

let terminalWrite: ((text: string) => void) | null = null;
let terminalWriteln: ((text: string) => void) | null = null;

export function setTerminalWriters(
  write: (text: string) => void,
  writeln: (text: string) => void,
): void {
  terminalWrite = write;
  terminalWriteln = writeln;
}

function write(text: string): void {
  terminalWrite?.(text);
}

function writeln(text: string): void {
  terminalWriteln?.(text);
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

async function runShellCommand(line: string): Promise<void> {
  if (!isContainerReady()) {
    writeln("Runtime not ready yet");
    return;
  }

  const container = getContainer();
  try {
    const result = await container.run(line, {
      onStdout: (data) => write(data),
      onStderr: (data) => write(data),
    });
    if (result.exitCode !== 0 && result.stderr) {
      // stderr already streamed via onStderr
    }
  } catch (err) {
    writeln(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleGitCommand(args: string[]): Promise<void> {
  if (!isGitReady()) {
    writeln("Git not ready yet");
    return;
  }

  const sub = args[0];

  switch (sub) {
    case "init":
      await gitInit();
      writeln("Initialized git repository");
      break;

    case "clone": {
      const url = args[1];
      if (!url) {
        writeln("git clone: missing URL");
        return;
      }
      writeln(`Cloning ${url}...`);
      await gitClone(url);
      writeln("Clone complete");
      break;
    }

    case "status":
      writeln(await gitStatus());
      break;

    case "log":
      writeln(await gitLog());
      break;

    case "diff":
      writeln(await gitDiff());
      break;

    case "branch": {
      writeln(await gitBranches());
      break;
    }

    case "checkout": {
      const branch = args[1];
      if (!branch) {
        writeln("git checkout: missing branch name");
        return;
      }
      writeln(await gitCheckout(branch));
      break;
    }

    case "commit": {
      const flagIdx = args.indexOf("-m");
      const message =
        flagIdx >= 0 ? args.slice(flagIdx + 1).join(" ") : args.slice(1).join(" ");
      if (!message) {
        writeln("git commit: missing message (-m \"msg\")");
        return;
      }
      await syncAllFilesToWorker();
      const sha = await gitCommit(message);
      writeln(sha);
      break;
    }

    case "push": {
      const remote = args[1] || "origin";
      const ref = args[2] || "main";
      await syncAllFilesToWorker();
      writeln(await gitPush(remote, ref));
      break;
    }

    case "pull": {
      const remote = args[1] || "origin";
      const ref = args[2] || "main";
      writeln(await gitPull(remote, ref));
      break;
    }

    default:
      writeln(`git: '${sub}' is not a git command`);
      break;
  }
}

function cmdHelp(): void {
  writeln("Available commands:");
  writeln("  ls [dir]        List directory contents");
  writeln("  cd [dir]        Change directory");
  writeln("  pwd             Print working directory");
  writeln("  cat <file>      Display file contents");
  writeln("  mkdir <dir>     Create directory");
  writeln("  rm [-rf] <path> Remove file or directory");
  writeln("  cp <src> <dst>  Copy file");
  writeln("  mv <src> <dst>  Move/rename file");
  writeln("  echo <text>     Print text");
  writeln("  clear           Clear terminal");
  writeln("  node <file>     Run JavaScript (via runtime)");
  writeln("  npm ...         npm commands (install, run, etc.)");
  writeln("  git ...         git commands (init, clone, commit, etc.)");
  writeln("  help            Show this help");
}

export async function executeCommand(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parts = parseLine(trimmed);
  const cmd = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);

  if (cmd === "help") {
    cmdHelp();
    return;
  }

  if (cmd === "clear") {
    terminalWrite?.("\x1b[2J\x1b[H");
    return;
  }

  if (cmd === "git") {
    try {
      await handleGitCommand(args);
    } catch (err) {
      writeln(`git error: ${err instanceof Error ? err.message : String(err)}`);
    }
    syncVfsToEditor();
    return;
  }

  await runShellCommand(trimmed);

  if (["npm", "node", "cp", "mv", "rm", "mkdir"].includes(cmd)) {
    syncVfsToEditor();
  }
}

async function syncVfsToEditor(): Promise<void> {
  if (!isGitReady()) return;
  requestFilesFromWorker();
}
