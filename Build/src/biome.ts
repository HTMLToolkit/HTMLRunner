import { Biome, Distribution } from "@biomejs/js-api";
import type { Configuration } from "@biomejs/js-api";
import initBiomeWasm from "@biomejs/wasm-web";

let biomeWorkspace: Biome | null = null;
let biomeProjectKey: number | null = null;
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

  biomeWorkspace = await Biome.create({ distribution: Distribution.WEB });

  const openRes = biomeWorkspace.openProject();
  biomeProjectKey = openRes.projectKey;

  biomeWorkspace.applyConfiguration(biomeProjectKey, {
    linter: {
      enabled: true,
      rules: {
        recommended: true,
      },
    },
  } as unknown as Configuration);

  initialized = true;
}

export async function lintWithBiome(text: string, filepath = "file.ts"): Promise<BiomeDiag[]> {
  if (!initialized) {
    await initBiome();
  }

  if (!biomeWorkspace) {
    throw new Error("Biome workspace not active after runtime initialization");
  }

  if (biomeProjectKey == null) {
    throw new Error("Biome project key not initialized");
  }

  const result = biomeWorkspace.lintContent(biomeProjectKey, text, {
    filePath: filepath,
  });

  const diags = result?.diagnostics;
  if (!Array.isArray(diags)) {
    throw new Error("Unexpected Biome lint response shape: missing diagnostics block");
  }

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
}
