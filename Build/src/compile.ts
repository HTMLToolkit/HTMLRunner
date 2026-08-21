import { getVFS, isContainerReady } from "./container";

let esbuildInitialized = false;

async function ensureEsbuild(): Promise<typeof import("esbuild-wasm")> {
  if (!esbuildInitialized) {
    const esbuild = await import("esbuild-wasm");
    await esbuild.initialize({
      wasmURL: "https://unpkg.com/esbuild-wasm@0.28.0/esbuild.wasm",
    });
    esbuildInitialized = true;
    return esbuild;
  }
  return import("esbuild-wasm");
}

function vfsReadFile(path: string): string | null {
  if (!isContainerReady()) return null;
  const vfs = getVFS();
  try {
    return vfs.readFileSync(path, "utf-8") as string;
  } catch {
    return null;
  }
}

function vfsStat(path: string): boolean {
  if (!isContainerReady()) return false;
  const vfs = getVFS();
  try {
    vfs.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(base: string, relative: string): string {
  const parts = base.split("/");
  for (const seg of relative.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

export async function esbuildBundle(
  cwd: string,
  write: (text: string) => void,
  writeln: (text: string) => void,
): Promise<void> {
  try {
    await ensureEsbuild();
  } catch (e) {
    writeln(`Failed to initialize esbuild: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  let entryPoint = "index.js";
  let outfile = "dist/bundle.js";
  let external: string[] = [];

  try {
    const raw = vfsReadFile(`${cwd}/package.json`);
    if (raw) {
      const pkg = JSON.parse(raw);
      const buildCmd = pkg.scripts?.build || "";
      const buildMatch = buildCmd.match(/esbuild\s+(\S+)/);
      if (buildMatch) {
        entryPoint = buildMatch[1];
      }
      const outMatch = buildCmd.match(/--outfile=(\S+)/);
      if (outMatch) {
        outfile = outMatch[1];
      }
      const extMatch = buildCmd.match(/--external:(\S+)/g);
      if (extMatch) {
        external = extMatch.map((m: string) => m.replace("--external:", ""));
      }
    }
  } catch {}

  const entryPath = `${cwd}/${entryPoint}`;
  const entryContent = vfsReadFile(entryPath);
  if (!entryContent) {
    writeln(`Entry point not found: ${entryPoint}`);
    return;
  }

  writeln(`Building ${entryPoint} -> ${outfile}...`);

  const nodeModules = `${cwd}/node_modules`;

  const plugin: import("esbuild-wasm").Plugin = {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (
          args.path === "buffer" || args.path === "process" ||
          args.path === "util" || args.path === "path" || args.path === "fs" ||
          args.path === "os" || args.path === "crypto" ||
          args.path === "stream" || args.path === "events"
        ) {
          return { path: args.path, namespace: "node-stub" };
        }
        const pkgDir = `${nodeModules}/${args.path}`;
        const pkgRaw = vfsReadFile(`${pkgDir}/package.json`);
        if (pkgRaw) {
          const pkgData = JSON.parse(pkgRaw);
          const main = pkgData.module || pkgData.browser || pkgData.main || "index.js";
          const resolvedMain = `${pkgDir}/${main}`;
          if (vfsStat(resolvedMain)) {
            return { path: resolvedMain, namespace: "file" };
          }
          if (vfsStat(`${pkgDir}/index.js`)) {
            return { path: `${pkgDir}/index.js`, namespace: "file" };
          }
        }
        return { path: args.path, namespace: "file" };
      });

      build.onResolve({ filter: /^\.\.?/ }, async (args) => {
        const base = args.importer.startsWith("/") ? args.importer : `${cwd}/${args.importer}`;
        const dir = base.substring(0, base.lastIndexOf("/"));
        const resolved = resolvePath(dir, args.path);
        for (const ext of ["", ".js", ".ts", ".jsx", ".tsx", ".json", ".mjs"]) {
          if (vfsStat(resolved + ext)) {
            return { path: resolved + ext, namespace: "file" };
          }
        }
        return { path: resolved, namespace: "file" };
      });

      build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
        const content = vfsReadFile(args.path);
        if (content !== null) {
          return { contents: content, loader: "default" };
        }
        return { errors: [{ text: `Cannot read file: ${args.path}` }] };
      });

      build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => {
        const stubs: Record<string, string> = {
          buffer: "export default { Buffer: typeof Buffer !== 'undefined' ? Buffer : {} };",
          process: "export default { env: {}, argv: [], cwd: () => '/' };",
          util: "export default { inherits: (a,b) => { a.prototype = Object.create(b.prototype); }, promisify: (fn) => fn };",
          path: "export default { join: (...a) => a.join('/'), resolve: (...a) => a.join('/'), basename: (p) => p.split('/').pop(), dirname: (p) => p.split('/').slice(0,-1).join('/'), extname: (p) => { const d=p.lastIndexOf('.'); return d>=0?p.slice(d):''; } };",
          fs: "export default { readFileSync: () => '', writeFileSync: () => {} };",
          os: "export default { platform: () => 'browser', homedir: () => '/home' };",
          crypto: "export default { randomBytes: (n) => new Uint8Array(n) };",
          stream: "export default { Writable: class { write() {} end() {} }, Readable: class { pipe() {} } };",
          events: "export default { EventEmitter: class { on() {} emit() {} } };",
        };
        return { contents: stubs[args.path] || "export default {};", loader: "js" };
      });
    },
  };

  try {
    const esbuild = await ensureEsbuild();
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      outfile: `${cwd}/${outfile}`,
      write: false,
      platform: "browser",
      format: "esm",
      target: "es2020",
      plugins: [plugin],
      external,
      sourcemap: false,
      minify: false,
    });

    const vfs = getVFS();
    for (const output of result.outputFiles) {
      const outPath = output.path.startsWith("/") ? output.path : `${cwd}/${output.path}`;
      const dir = outPath.substring(0, outPath.lastIndexOf("/"));
      try { vfs.mkdirSync(dir, { recursive: true }); } catch {}
      try { vfs.writeFileSync(outPath, output.contents); } catch {}
      writeln(`  wrote ${outPath.replace(cwd + "/", "")} (${output.contents.length} bytes)`);
    }
    writeln("Build complete!");
  } catch (e) {
    writeln(`Build failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
