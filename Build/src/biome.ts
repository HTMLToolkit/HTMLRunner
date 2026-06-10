import initBiomeWasm, { Workspace } from "@biomejs/wasm-web";

let workspace: Workspace | null = null;
let projectKey: number | null = null;
let initialized = false;

export type BiomeDiag = {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
};

function byteToCharOffset(text: string, byteOffset: number): number {
  let charIdx = 0;
  for (let i = 0; i < byteOffset; charIdx++) {
    const code = text.charCodeAt(charIdx);
    if (code < 0x80) {
      i += 1;
    } else if (code < 0x800) {
      i += 2;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      i += 4;
      charIdx++;
    } else {
      i += 3;
    }
  }
  return charIdx;
}

export async function initBiome(): Promise<void> {
  if (initialized) return;

  await initBiomeWasm();

  workspace = new Workspace();

  const openRes = workspace.openProject({ path: "", openUninitialized: true });
  projectKey = openRes.projectKey;

  workspace.updateSettings({
    projectKey,
    configuration: {
      linter: {
        enabled: true,
        rules: {
          recommended: true,
        },
      },
      files: {
        ignoreUnknown: true,
      },
      vcs: {
        enabled: false,
      },
    },
    workspaceDirectory: "",
  });

  initialized = true;
}

export async function lintWithBiome(text: string, filepath = "file.ts"): Promise<BiomeDiag[]> {
  if (!initialized) {
    await initBiome();
  }

  if (!workspace || projectKey == null) {
    throw new Error("Biome workspace not initialized");
  }

  await workspace.openFile({
    projectKey,
    path: filepath,
    content: { type: "fromClient", content: text, version: 0 },
  });

  try {
    const result = workspace.pullDiagnostics({
      projectKey,
      path: filepath,
      categories: ["syntax", "lint", "action"],
    });

    const diags = result.diagnostics;
    if (!Array.isArray(diags)) return [];

    return diags.map((d) => {
      const diag = d as unknown as {
        location?: { span?: [number, number] } | null;
        severity?: string | null;
        description?: string | null;
        category?: string | null;
      };

      const span = diag.location?.span;
      const byteFrom = typeof span?.[0] === "number" ? span[0] : 0;
      const byteTo = typeof span?.[1] === "number" ? span[1] : byteFrom;

      const from = byteToCharOffset(text, byteFrom);
      const to = byteToCharOffset(text, byteTo);

      let severity: "error" | "warning" | "info" = "info";
      if (diag.severity === "error" || diag.severity === "fatal") severity = "error";
      if (diag.severity === "warning" || diag.severity === "warn") severity = "warning";

      const rawMsg = diag.description ?? "";
      const category = diag.category
        ? diag.category.replace(/^lint\//, "")
        : "";
      const message = category ? `${rawMsg} [${category}]` : rawMsg;

      return { from, to, severity, message };
    });
  } finally {
    workspace.closeFile({ projectKey, path: filepath });
  }
}
