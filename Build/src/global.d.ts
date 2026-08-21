declare module "*.css";
declare module "@fortawesome/fontawesome-free/css/all.min.css" {
  const css: string;
  export default css;
}
declare module "wasm-git/lg2_opfs_auto.js" {
  export function loadOpfsGit(options?: {
    env?: typeof globalThis;
    variant?: "pthreads" | "jspi" | "asyncify";
    baseUrl?: string | URL;
    user?: string;
    email?: string;
    moduleArg?: object;
  }): Promise<OpfsGit>;

  export class OpfsGit {
    variant: string;
    FS: any;
    module: any;
    repoDir(repoName: string): string;
    init(opts?: { user?: string; email?: string }): Promise<this>;
    syncRepo(repoName: string): Promise<boolean>;
    run(args: string[]): Promise<void>;
    clone(url: string, repoName: string): Promise<string[]>;
    writeFile(repoName: string, filename: string, contents: string): Promise<void>;
    readFile(repoName: string, filename: string, encoding?: string): string;
    readdir(repoName: string): string[];
    addCommitPush(repoName: string, filename: string, message?: string): Promise<string[]>;
    removeRepo(repoName: string): Promise<void>;
  }

  export function selectOpfsVariant(env?: typeof globalThis): "pthreads" | "jspi" | "asyncify" | null;
  export function detectOpfsEnvironment(env?: typeof globalThis): {
    opfsAvailable: boolean;
    crossOriginIsolated: boolean;
    jspiAvailable: boolean;
  };
  export const VARIANT_FILES: Record<string, string>;
  export default loadOpfsGit;
}

declare module "*?worker&inline" {
  const WorkerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerConstructor;
}
