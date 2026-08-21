import { expose } from "comlink";

let git: any = null;
const REPO_NAME = "sandbox";
let _mutex: Promise<unknown> = Promise.resolve();

function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = _mutex.then(fn, fn);
  _mutex = next.catch(() => {});
  return next;
}

async function withRetry<T>(fn: () => T, maxRetries = 2): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return fn();
    } catch (err: any) {
      const msg = err?.message || String(err);
      const isStale =
        msg.includes("cached in an interface object") ||
        msg.includes("stale") ||
        msg.includes("state has changed");
      if (isStale && i < maxRetries && git) {
        try { await git.syncRepo(REPO_NAME); } catch {}
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

async function runGitCommand(command: string, gitArgs: string[]): Promise<string> {
  if (!git) throw new Error("Git not initialized");
  await git.syncRepo(REPO_NAME);

  const stdout: string[] = [];
  const origPrint = git.module.print;
  const origPrintErr = git.module.printErr;
  git.module.print = (text: string) => stdout.push(text);
  git.module.printErr = (_text: string) => {};

  try {
    await git.run([command, ...gitArgs]);
  } finally {
    git.module.print = origPrint;
    git.module.printErr = origPrintErr;
  }

  return stdout.join("\n");
}

function readAllFiles(): { path: string; content: string }[] {
  if (!git) return [];
  const results: { path: string; content: string }[] = [];
  try {
    const entries = git.readdir(REPO_NAME);
    for (const name of entries) {
      if (name === "." || name === ".." || name === ".git" || name === "node_modules") continue;
      try {
        const content = git.readFile(REPO_NAME, name);
        if (typeof content === "string") {
          results.push({ path: name, content });
        } else if (content instanceof Uint8Array) {
          results.push({ path: name, content: new TextDecoder().decode(content) });
        }
      } catch {}
    }
  } catch {}
  return results;
}

const api = {
  async init(user = "HTMLRunner", email = "runner@htmlrunner.app") {
    return queue(async () => {
      const { loadOpfsGit } = await import("wasm-git/lg2_opfs_auto.js");
      git = await loadOpfsGit({ user, email });

      const found = await git.syncRepo(REPO_NAME);
      let files: { path: string; content: string }[] = [];

      if (found) {
        files = readAllFiles();
      } else {
        await git.run(["init", git.repoDir(REPO_NAME)]);
        await git.syncRepo(REPO_NAME);
      }

      return { variant: git.variant || "unknown", files };
    });
  },

  async writeFile(filePath: string, content: string) {
    return queue(() =>
      withRetry(() => git.writeFile(REPO_NAME, filePath, content)),
    );
  },

  async gitCommand(command: string, args: string[]) {
    return queue(async () => {
      const stdout = await withRetry(() => runGitCommand(command, args));
      const refreshCmds = ["clone", "pull", "fetch", "checkout", "reset", "merge"];
      if (refreshCmds.includes(command)) {
        const files = await withRetry(() => readAllFiles());
        return { stdout, files };
      }
      return { stdout };
    });
  },

  async readFiles() {
    return queue(() => withRetry(() => readAllFiles()));
  },

  async sync() {
    return queue(async () => { await git?.syncRepo(REPO_NAME); });
  },
};

expose(api);
