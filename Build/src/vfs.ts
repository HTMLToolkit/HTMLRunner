import fs from "@zenfs/core";
import { PortFS } from "@zenfs/core";
import git from "isomorphic-git";
import { filesState, activeFileState } from "./appState";
import type { FileTab } from "./types";

let _ready = false;
let _readyResolve: () => void;
const _readyPromise = new Promise<void>((r) => {
  _readyResolve = r;
});

export function ready(): Promise<void> {
  return _readyPromise;
}

export function isReady(): boolean {
  return _ready;
}

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function waitForWorker(worker: Worker, timeoutMs = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "vfs-ready") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
      if (ev.data?.type === "vfs-error") {
        worker.removeEventListener("message", onMsg);
        reject(new Error(ev.data.error));
      }
    };
    worker.addEventListener("message", onMsg);
    setTimeout(() => {
      worker.removeEventListener("message", onMsg);
      reject(new Error("Worker init timeout"));
    }, timeoutMs);
  });
}

export async function initializeVFS(worker: Worker): Promise<void> {
  try {
    await waitForWorker(worker);

    const portfs = new PortFS(worker as never, 5000);
    (portfs as any).attributes.set("no_async_preload", true);
    await portfs.ready();
    (fs as any).umount("/");
    (fs as any).mount("/", portfs);

    const dirs = ["/sandbox"];
    for (const dir of dirs) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
      } catch {
        // already exists
      }
    }

    const entries = await fs.promises.readdir("/sandbox");

    if (entries.length > 0) {
      const files: FileTab[] = [];
      for (const name of entries) {
        const stat = await fs.promises.stat(`/sandbox/${name}`);
        if (stat.isFile()) {
          const content = await fs.promises.readFile(
            `/sandbox/${name}`,
            "utf-8",
          );
          const ext = name.split(".").pop()?.toLowerCase() || "";
          const language = getLanguageForExt(ext);
          files.push({
            id: name,
            name,
            content,
            language,
          });
        }
      }
      if (files.length > 0) {
        filesState.set(files);
        activeFileState.set(files[0].id);
      }
    }

    await gitInit();
    _ready = true;
    _readyResolve();
  } catch (err) {
    console.error("VFS init error:", err);
    _ready = true;
    _readyResolve();
  }
}

function getLanguageForExt(ext: string): string {
  switch (ext) {
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx":
      return "javascript";
    default:
      return "javascript";
  }
}

export async function syncFilesToVFS(files: FileTab[]): Promise<void> {
  for (const file of files) {
    try {
      await fs.promises.writeFile(`/sandbox/${file.name}`, file.content, "utf-8");
    } catch (err) {
      console.warn(`Failed to write ${file.name} to VFS:`, err);
    }
  }
}

export function syncFilesDebounced(files: FileTab[]): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncFilesToVFS(files).catch((err) =>
      console.warn("VFS sync failed:", err),
    );
  }, 1000);
}

export async function createFileInVFS(
  name: string,
  content = "",
): Promise<void> {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const language = getLanguageForExt(ext);
  await fs.promises.writeFile(`/sandbox/${name}`, content, "utf-8");
  const files = filesState.get();
  const newFile: FileTab = { id: name, name, content, language };
  filesState.set([...files, newFile]);
  activeFileState.set(name);
}

export async function deleteFileInVFS(name: string): Promise<void> {
  const files = filesState.get();
  if (files.length <= 1) return;

  await fs.promises.unlink(`/sandbox/${name}`);
  const idx = files.findIndex((f) => f.name === name);
  const updated = files.filter((f) => f.name !== name);
  filesState.set(updated);

  if (activeFileState.get() === name) {
    const nextIdx = Math.min(idx, updated.length - 1);
    activeFileState.set(updated[nextIdx].id);
  }
}

export async function renameFileInVFS(oldName: string, newName: string): Promise<void> {
  await fs.promises.rename(`/sandbox/${oldName}`, `/sandbox/${newName}`);
  const files = filesState.get();
  const updated = files.map((f) => {
    if (f.name === oldName) {
      const ext = newName.split(".").pop()?.toLowerCase() || "";
      return {
        ...f,
        id: newName,
        name: newName,
        language: getLanguageForExt(ext),
      };
    }
    return f;
  });
  filesState.set(updated);
  if (activeFileState.get() === oldName) {
    activeFileState.set(newName);
  }
}

// Git

const GIT_DIR = "/sandbox";
const GIT_AUTHOR = { name: "HTMLRunner", email: "runner@htmlrunner.app" };

async function gitInit(): Promise<void> {
  try {
    await git.init({ fs, dir: GIT_DIR });
  } catch {
    // already initialized
  }
}

const STATUS_SHORT: Record<string, string> = {
  "ignored": "?",
  "unmodified": " ",
  "*modified": "M",
  "*added": "A",
  "*deleted": "D",
  "*absent": "!",
  "*unmodified": " ",
  "added": "A",
  "deleted": "D",
  "modified": "M",
};

export type GitFileStatus = {
  filepath: string;
  status: string;
  short: string;
};

export async function gitStatus(): Promise<GitFileStatus[]> {
  try {
    const files = filesState.get();
    const statuses: GitFileStatus[] = [];

    for (const file of files) {
      try {
        const s = await git.status({ fs, dir: GIT_DIR, filepath: file.name });
        if (s !== "unmodified") {
          statuses.push({ filepath: file.name, status: s, short: STATUS_SHORT[s] ?? s });
        }
      } catch {
        statuses.push({ filepath: file.name, status: "*", short: "?" });
      }
    }

    return statuses;
  } catch {
    return [];
  }
}

export async function gitAddAll(): Promise<void> {
  const files = filesState.get();
  for (const file of files) {
    try {
      await git.add({ fs, dir: GIT_DIR, filepath: file.name });
    } catch (err) {
      console.warn(`git add ${file.name} failed:`, err);
    }
  }
}

export async function gitCommit(message: string): Promise<string> {
  await gitAddAll();
  const sha = await git.commit({
    fs,
    dir: GIT_DIR,
    message,
    author: GIT_AUTHOR,
  });
  return sha;
}

export async function gitLog(): Promise<{ oid: string; message: string }[]> {
  try {
    const commits = await git.log({ fs, dir: GIT_DIR, depth: 10 });
    return commits.map((c: any) => ({
      oid: c.oid,
      message: c.commit?.message ?? "",
    }));
  } catch {
    return [];
  }
}
