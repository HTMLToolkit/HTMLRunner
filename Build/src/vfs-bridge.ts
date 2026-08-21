import { getVFS } from "./container";
import { filesState } from "./appState";
import { syncFileToWorker } from "./git-service";

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

export function initBridge(): void {
  const vfs = getVFS();

  vfs.on("change", (path: string, content: string) => {
    if (!path.startsWith("/sandbox/")) return;
    const relPath = path.slice("/sandbox/".length);
    if (!relPath || relPath.includes("node_modules") || relPath.startsWith(".")) return;
    syncFileToWorker(relPath, content);
  });

  vfs.on("delete", (path: string) => {
    if (!path.startsWith("/sandbox/")) return;
    // Worker handles deletion via git operations
  });
}

export function syncFilesToWorker(files: { name: string; content: string }[]): void {
  for (const file of files) {
    syncFileToWorker(file.name, file.content);
  }
}

export function syncFilesDebounced(
  files: { name: string; content: string }[],
): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncFilesToWorker(files);
  }, 500);
}

export function syncActiveFileToVFS(
  name: string,
  content: string,
): void {
  const vfs = getVFS();
  const dir = name.substring(0, name.lastIndexOf("/"));
  if (dir) {
    try { vfs.mkdirSync(`/sandbox/${dir}`, { recursive: true }); } catch {}
  }
  try { vfs.writeFileSync(`/sandbox/${name}`, content); } catch {}
}

export function syncAllFilesToVFS(
  files: { name: string; content: string }[],
): void {
  const vfs = getVFS();
  for (const file of files) {
    const dir = file.name.substring(0, file.name.lastIndexOf("/"));
    if (dir) {
      try { vfs.mkdirSync(`/sandbox/${dir}`, { recursive: true }); } catch {}
    }
    try { vfs.writeFileSync(`/sandbox/${file.name}`, file.content); } catch {}
  }
}
