import { configure, attachFS, mounts } from "@zenfs/core";
import { WebAccess } from "@zenfs/dom";

async function initWorkerFS() {
  try {
    const root = await navigator.storage.getDirectory();
    await configure({
      mounts: {
        "/": {
          backend: WebAccess,
          handle: root,
        },
      },
    });
    const rootFS = mounts.get("/");
    if (!rootFS) {
      self.postMessage({ type: "vfs-error", error: "rootFS is null" });
      return;
    }
    attachFS(self as never, rootFS);
    self.postMessage({ type: "vfs-ready" });
  } catch (err) {
    self.postMessage({ type: "vfs-error", error: `Worker init failed: ${String(err)}` });
  }
}

initWorkerFS();
