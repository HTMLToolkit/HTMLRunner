import { createContainer, VirtualFS } from "almostnode";

let _container: ReturnType<typeof createContainer> | null = null;
let _vfs: VirtualFS | null = null;

export function getContainer(): ReturnType<typeof createContainer> {
  if (!_container) {
    _container = createContainer({ cwd: "/sandbox" });
  }
  return _container;
}

export function getVFS(): VirtualFS {
  if (!_vfs) {
    _vfs = getContainer().vfs;
  }
  return _vfs;
}

export function isContainerReady(): boolean {
  return _container !== null;
}
