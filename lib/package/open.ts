/**
 * Opening a bundle is one call, and that is the point.
 *
 * A host that unzips at will and picks files out of the archive can skip
 * every guarantee the manifest makes - which is precisely how a shared bundle
 * ends up printing with its assets missing. `openBundle` does the whole
 * ceremony in order and returns a resolved bundle the caller can render
 * immediately, or a refusal list that names every problem at once.
 */

import { unzipSync } from "fflate";

import type { Bundle, PackageManifest, PackageOpen } from "./format";
import { ENGINE_VERSION } from "./format";
import { validateManifest } from "./validate";

export * from "./format";

export class UnzipUnavailableError extends Error {
  constructor() {
    super(
      "this runtime cannot unzip; the bundle needs a JSZip-style inflate that was not supplied",
    );
  }
}

/**
 * A pure inflate seam. In a DOM runtime fflate's sync unzip works; hosts
 * without typed arrays or with frozen globals can supply their own.
 */
export type Inflate = (bytes: Uint8Array) => Record<string, Uint8Array>;

const defaultInflate: Inflate =
  typeof unzipSync === "function"
    ? (bytes) => unzipSync(bytes)
    : () => {
        throw new UnzipUnavailableError();
      };

export interface OpenOptions {
  inflate?: Inflate;
  /** The engine release this host runs; defaults to this build's own. */
  engineVersion?: number;
}

export interface OpenedBundle {
  manifest: PackageManifest;
  /** Every archive member, manifest included. */
  files: Map<string, Uint8Array>;
  /** The verified template, parsed and ready to render. */
  template: BillTemplate2;
}

type BillTemplate2 = import("../template/types").BillTemplate;

/**
 * Unzip, verify, and resolve one bundle.
 *
 * Returns `{ ok: false, refusals }` - never a throw - because a bundle that
 * arrives from outside must be able to fail loudly and completely rather than
 * leave the host holding a half-open archive.
 */
export async function openBundle(
  bytes: Uint8Array,
  options: OpenOptions = {},
): Promise<PackageOpen> {
  const refusals: string[] = [];
  let files: Map<string, Uint8Array>;
  try {
    const raw = options.inflate ? options.inflate(bytes) : defaultInflate(bytes);
    files = new Map(Object.entries(raw));
  } catch (error) {
    return {
      ok: false,
      refusals: [`the archive could not be opened: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) {
    return { ok: false, refusals: ["the archive carries no manifest.json"] };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    return {
      ok: false,
      refusals: [`manifest.json is not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const digest = files.get("manifest.json.sha256");
  if (!digest) {
    refusals.push("the archive carries no manifest.json.sha256, so the manifest itself cannot be verified");
  }
  const manifestSha = digest
    ? new TextDecoder().decode(digest).trim().split(/\s+/)[0]
    : undefined;
  // The validator sees the archive the way `parsePackage` serves it: the
  // manifest members sit outside `files`, since a file cannot checksum itself
  // and the manifest digest travels beside it instead.
  const validatorFiles = new Map(files);
  validatorFiles.delete("manifest.json");
  validatorFiles.delete("manifest.json.sha256");
  const issues = validateManifest(manifest, validatorFiles, manifestBytes, manifestSha);
  for (const issue of issues) {
    if (issue.severity === "error") refusals.push(`${issue.path}: ${issue.message}`);
  }

  const engineVersion = (manifest as { engineVersion?: number }).engineVersion ?? 1;
  const hostEngine = options.engineVersion ?? ENGINE_VERSION;
  if (engineVersion > hostEngine) {
    return {
      ok: false,
      refusals: [
        `the bundle needs engine ${engineVersion}; this app runs ${hostEngine} and must not guess`,
      ],
    };
  }

  const typed = manifest as PackageManifest;
  const templateBytes = files.get(typed.template ?? "template.json");
  if (!templateBytes) {
    return { ok: false, refusals: [`template member ${String(typed.template)} is not in the archive`] };
  }
  let template: BillTemplate2;
  try {
    template = JSON.parse(new TextDecoder().decode(templateBytes)) as BillTemplate2;
  } catch (error) {
    return {
      ok: false,
      refusals: [`the template member is not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  // Every check fed the same list, and the list is the verdict: a bundle that
  // collected any refusal does not open, whatever else it got right.
  if (refusals.length > 0) return { ok: false, refusals };

  const bundle: Bundle = { manifest: typed, files };
  return { ok: true, bundle, template, refusals };
}