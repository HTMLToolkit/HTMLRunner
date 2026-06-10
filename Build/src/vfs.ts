import fs from "@zenfs/core";
import { PortFS } from "@zenfs/core";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { filesState, activeFileState } from "./appState";
import type { FileTab } from "./types";
import { getLanguageForExt } from "./defaultContent";

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

    const existingFiles = await readVfsFiles("/sandbox");
    if (existingFiles.length > 0) {
      filesState.set(existingFiles);
      activeFileState.set(existingFiles[0].id);
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

async function ensureParentDir(filePath: string): Promise<void> {
  const idx = filePath.lastIndexOf("/");
  if (idx > 0) {
    const dir = filePath.slice(0, idx);
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
  }
}

export async function syncFilesToVFS(files: FileTab[]): Promise<void> {
  for (const file of files) {
    try {
      const vfsPath = `/sandbox/${file.name}`;
      await ensureParentDir(vfsPath);
      await fs.promises.writeFile(vfsPath, file.content, "utf-8");
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
  const vfsPath = `/sandbox/${name}`;
  await ensureParentDir(vfsPath);
  await fs.promises.writeFile(vfsPath, content, "utf-8");
}

export async function deleteFileInVFS(name: string): Promise<void> {
  await fs.promises.unlink(`/sandbox/${name}`).catch(() => {});
}

export async function renameFileInVFS(oldName: string, newName: string): Promise<void> {
  const vfsNew = `/sandbox/${newName}`;
  await ensureParentDir(vfsNew);
  await fs.promises.rename(`/sandbox/${oldName}`, vfsNew);
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
  const files = filesState.get();
  const statuses: GitFileStatus[] = [];

  let hasHead = true;
  try {
    await git.resolveRef({ fs, dir: GIT_DIR, ref: "HEAD" });
  } catch {
    hasHead = false;
  }

  for (const file of files) {
    if (!hasHead) {
      statuses.push({ filepath: file.name, status: "*added", short: "A" });
      continue;
    }
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

export async function gitLog(): Promise<{ oid: string; message: string; author: string; date: string }[]> {
  try {
    const commits = await git.log({ fs, dir: GIT_DIR, depth: 10 });
    return commits.map((c: any) => ({
      oid: c.oid,
      message: c.commit?.message ?? "",
      author: c.commit?.author?.name ?? "",
      date: c.commit?.author?.timestamp ? new Date(c.commit.author.timestamp * 1000).toISOString() : "",
    }));
  } catch (err) {
    console.warn("git log failed:", err);
    return [];
  }
}

export async function gitDiff(): Promise<string> {
  try {
    const statuses = await gitStatus();
    const parts: string[] = [];
    for (const s of statuses) {
      if (s.short === "M" || s.short === "A") {
        const file = filesState.get().find((f) => f.name === s.filepath);
        const newContent = file?.content ?? "";
        const newLines = newContent.split("\n");
        let oldContent = "";

        if (s.short === "M") {
          try {
            const obj = await git.readBlob({
              fs, dir: GIT_DIR, filepath: s.filepath, oid: "HEAD",
            });
            oldContent = new TextDecoder().decode(obj.blob);
          } catch {
            oldContent = "";
          }
        }

        const oldLines = oldContent ? oldContent.split("\n") : [];
        const diffLines: string[] = [
          `--- a/${s.filepath}`,
          `+++ b/${s.filepath}`,
          `@@ -1,${oldLines.length || 1} +1,${newLines.length || 1} @@`,
        ];
        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          if (i >= oldLines.length) {
            diffLines.push(`+${newLines[i]}`);
          } else if (i >= newLines.length) {
            diffLines.push(`-${oldLines[i]}`);
          } else if (oldLines[i] !== newLines[i]) {
            diffLines.push(`-${oldLines[i]}`);
            diffLines.push(`+${newLines[i]}`);
          }
        }
        parts.push(diffLines.join("\n"));
      }
    }
    return parts.join("\n\n");
  } catch (err) {
    console.warn("git diff failed:", err);
    return "";
  }
}

export async function gitBranches(): Promise<{ current: string; branches: string[] }> {
  try {
    const current = await git.currentBranch({ fs, dir: GIT_DIR });
    const branches = await git.listBranches({ fs, dir: GIT_DIR });
    return { current: current ?? "main", branches };
  } catch (err) {
    console.warn("git branches failed:", err);
    return { current: "main", branches: ["main"] };
  }
}

function promptCredentials(): { username: string; password: string } {
  const username = prompt("Git username:") || "";
  const password = prompt("Git password / personal access token:") || "";
  return { username, password };
}

const onAuth = () => promptCredentials();
const onAuthFailure = () => {
  alert("Authentication failed. Check your credentials and try again.");
  return { cancel: true };
};


export async function gitGetRemotes(): Promise<{ remote: string; url: string }[]> {
  try {
    return await git.listRemotes({ fs, dir: GIT_DIR });
  } catch {
    return [];
  }
}

export async function gitAddRemote(remote: string, url: string): Promise<void> {
  await git.addRemote({ fs, dir: GIT_DIR, remote, url });
}

export async function gitRemoveRemote(remote: string): Promise<void> {
  await git.deleteRemote({ fs, dir: GIT_DIR, remote });
}

export async function gitPush(
  remote = "origin",
  ref = "main",
): Promise<void> {
  await gitAddAll();
  await git.push({
    fs,
    http,
    dir: GIT_DIR,
    remote,
    remoteRef: ref,
    corsProxy: "https://cors.isomorphic-git.org",
    onAuth,
    onAuthFailure,
  });
}

export async function gitPull(
  remote = "origin",
  ref = "main",
): Promise<void> {
  await git.pull({
    fs,
    http,
    dir: GIT_DIR,
    remote,
    ref,
    singleBranch: true,
    author: GIT_AUTHOR,
    corsProxy: "https://cors.isomorphic-git.org",
    onAuth,
    onAuthFailure,
  });
  const files = await readVfsFiles("/sandbox");
  if (files.length > 0) {
    filesState.set(files);
    activeFileState.set(files[0].id);
  }
}

const SKIP_DIRS = new Set([".git", "node_modules", ".gitkeep"]);

async function readVfsFiles(baseDir: string): Promise<FileTab[]> {
  const result: FileTab[] = [];
  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const fullPath = `${dir}/${name}`;
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (stat.isFile()) {
          const ext = name.split(".").pop()?.toLowerCase() || "";
          if (["png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "zip", "gz", "wasm"].includes(ext)) continue;
          const content = await fs.promises.readFile(fullPath, "utf-8");
          result.push({ id: relPath, name: relPath, content, language: getLanguageForExt(ext) });
        }
      } catch {
        // skip unreadable entries
      }
    }
  };
  await walk(baseDir, "");
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

async function removeTree(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = `${dir}/${entry}`;
    try {
      const s = await fs.promises.stat(full);
      if (s.isDirectory()) {
        await removeTree(full);
        await fs.promises.rmdir(full).catch(() => {});
      } else {
        await fs.promises.unlink(full);
      }
    } catch {}
  }
  await fs.promises.rmdir(dir).catch(() => {});
}

async function removeGitDir(dir: string): Promise<void> {
  await removeTree(`${dir}/.git`).catch(() => {});
}

export async function gitClone(url: string, dir = "/sandbox"): Promise<void> {
  await removeGitDir(dir);
  await git.clone({
    fs,
    http,
    dir,
    url,
    singleBranch: true,
    depth: 1,
    corsProxy: "https://cors.isomorphic-git.org",
    onAuth,
    onAuthFailure,
  });
  const files = await readVfsFiles(dir);
  if (files.length > 0) {
    filesState.set(files);
    activeFileState.set(files[0].id);
  }
}
