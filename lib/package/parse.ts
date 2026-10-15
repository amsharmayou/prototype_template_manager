import type { Package, PackageManifest } from "./format";

import { strFromU8, unzipSync } from "fflate";

/**
 * Read `.btpkg` bytes into a `Package`.
 *
 * Throws for an archive that cannot be read at all. Everything else is left to
 * `validatePackage`, which reports rather than throws, so a host can show a
 * caller every problem with the file in one go.
 */
export function parsePackage(bytes: Uint8Array): Package {
  const raw = unzipSync(bytes);
  const manifestBytes = raw["manifest.json"];
  if (!manifestBytes) throw new Error("package has no manifest.json");

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as PackageManifest;
  } catch {
    throw new Error("package manifest.json is not valid JSON");
  }

  const digestBytes = raw["manifest.json.sha256"];
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name === "manifest.json" || name === "manifest.json.sha256") continue;
    files.set(name, data);
  }

  return {
    manifest,
    files,
    // The manifest's bytes and the digest recorded beside it travel together, so
    // `validatePackage` can verify one against the other.
    manifestBytes,
    manifestSha256: digestBytes ? strFromU8(digestBytes) : undefined,
  };
}
