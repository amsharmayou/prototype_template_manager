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

import { verifyManifestSignature } from "./signing";
import { validateManifest } from "./validate";
import { sha256HexBytes } from "../render/sha256";
import type { Bundle, PackageManifest, PackageOpen } from "./format";
import { ENGINE_VERSION, MANIFEST_SIGNATURE_MEMBER } from "./format";

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
  /**
   * Signature ingest, for hosts that trust a signing key.
   *
   * `required` refuses an unsigned bundle outright; otherwise a present
   * signature is verified against the public key and a mismatch (or a bundle
   * claiming an envelope its archive does not carry) refuses with a named
   * reason. Node runtimes verify Ed25519 signatures; browser hosts deploy-verify
   * server-side.
   */
  verify?: {
    publicKeyPem: string;
    /** The trusted `signature.keyId`, when the host pins one. */
    keyId?: string;
    /** Refuse bundles that carry no signature at all. */
    required?: boolean;
  };
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
  // An unsigned bundle needs the sha sibling to be verifiable at all. A
  // signed bundle needs no sibling: its signature covers the manifest bytes,
  // which is the stronger fact, and the signature check below does the work.
  if (!digest && options.verify === undefined) {
    refusals.push("the archive carries no manifest.json.sha256, so the manifest itself cannot be verified");
  }
  const manifestSha = digest
    ? new TextDecoder().decode(digest).trim().split(/\s+/)[0]
    : undefined;

  // Migration, v1 -> v2, in memory only: an older bundle carries no engine
  // version and no template identity, and both are derived rather than
  // invented - the engine that understands v1 fields is this one, and the
  // template bytes are in the archive. Checksums already carried by v1
  // manifests keep doing their job; a v1 archive missing them still refuses.
  const manifestRecord = manifest as Record<string, unknown>;
  const declaredVersion = manifestRecord.packageVersion;
  if (declaredVersion === 1) {
    const templateMember = files.get(
      typeof manifestRecord.template === "string" ? manifestRecord.template : "template.json",
    );
    if (!manifestRecord.engineVersion) manifestRecord.engineVersion = 1;
    if (!manifestRecord.templateSha256 && templateMember) {
      manifestRecord.templateSha256 = sha256HexBytes(templateMember);
    }
  }

  // The validator sees the archive the way `parsePackage` serves it: the
  // manifest members sit outside `files`, since a file cannot checksum itself
  // and the manifest digest travels beside it instead. The signature member is
  // the third self-referential member: it signs the manifest and cannot
  // checksum itself either.
  const validatorFiles = new Map(files);
  validatorFiles.delete("manifest.json");
  validatorFiles.delete("manifest.json.sha256");
  validatorFiles.delete(MANIFEST_SIGNATURE_MEMBER);
  const issues = validateManifest(manifest, validatorFiles, manifestBytes, manifestSha);
  for (const issue of issues) {
    if (issue.severity === "error") refusals.push(`${issue.path}: ${issue.message}`);
  }

  // Signature ingest, when the host trusts a key. An optional verify on a
  // present signature; a required verify on its absence; a failure under an
  // envelope that lies. All three refuse before anything renders.
  const verify = options.verify;
  if (verify !== undefined) {
    const sigBytes = files.get(MANIFEST_SIGNATURE_MEMBER);
    if (!sigBytes) {
      refusals.push(
        verify.required === true
          ? "the bundle is not signed and this host requires a signature"
          : "the bundle names a signature the archive does not carry",
      );
    } else {
      const verdict = await verifyManifestSignature(
        manifestBytes,
        sigBytes,
        verify.publicKeyPem,
        verify.keyId,
      );
      if (!verdict.ok) refusals.push(`signature: ${verdict.reason ?? "invalid"}`);
    }
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