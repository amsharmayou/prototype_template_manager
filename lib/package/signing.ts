/**
 * Bundle signing: Ed25519 over the archived manifest bytes.
 *
 * The manifest's own sha256 already says the archive was not edited after it
 * was built; a signature says something stronger - it came from someone
 * holding a key this host or its vendor trusts. Verification is a host option
 * (`openBundle`'s `verify`), because key distribution is a deployment matter
 * and every deployment has its own.
 *
 * Node-only by design (`node:crypto`): signing happens at build or server
 * time; a WebView host verifies during ingest on its own side or delegates to
 * its server. This module dynamic-imports `node:crypto`, so the package layer
 * stays bundle-clean for the browser.
 */

import type { PackageSignature } from "./format";

const ALG = "ed25519" as const;

export interface SignedManifest {
  /** The manifest bytes WITH the signature block already stamped inside. */
  manifestBytes: Uint8Array;
  /** Raw Ed25519 signature over `manifestBytes`. */
  signatureBytes: Uint8Array;
}

/** Generate an Ed25519 keypair for a test or a tool. Node-only. */
export async function generateSigningKeyPair(): Promise<{
  publicKeyPem: string;
  privateKeyPem: string;
}> {
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Sign manifest bytes.
 *
 * The signature block (`alg` + `keyId`) is stamped into the manifest first and
 * the resulting bytes are what gets signed, so a verifier needs only the
 * archive, the signature member and the public key - no re-serialization.
 */
export async function signManifest(
  manifest: Record<string, unknown>,
  manifestToBytes: (m: Record<string, unknown>) => Uint8Array,
  privateKeyPem: string,
  keyId: string,
): Promise<SignedManifest> {
  const nodeCrypto = await import("node:crypto");
  const stamped: Record<string, unknown> = {
    ...manifest,
    signature: { alg: ALG, keyId } satisfies PackageSignature,
  };
  const manifestBytes = manifestToBytes(stamped);
  // Ed25519 signs through the one-shot API - `createSign` takes a digest
  // algorithm name, which Ed25519 does not have.
  const signatureBytes = nodeCrypto.sign(null, manifestBytes, privateKeyPem);
  return { manifestBytes, signatureBytes };
}

export interface VerifySignatureResult {
  ok: boolean;
  /** A named reason when `ok` is false; undefined otherwise. */
  reason?: string;
}

/** Verify stamped manifest bytes against an Ed25519 signature. */
export async function verifyManifestSignature(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  publicKeyPem: string,
  keyId?: string,
): Promise<VerifySignatureResult> {
  let manifest: { signature?: PackageSignature };
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      signature?: PackageSignature;
    };
  } catch {
    return { ok: false, reason: "the manifest is not JSON, so its signature cannot be read" };
  }
  const stamped = manifest.signature;
  if (stamped === undefined || typeof stamped !== "object") {
    return { ok: false, reason: "the manifest carries no signature block" };
  }
  if (stamped.alg !== ALG) {
    return { ok: false, reason: `signature algorithm ${String(stamped.alg)} is not ${ALG}` };
  }
  if (keyId !== undefined && stamped.keyId !== keyId) {
    return { ok: false, reason: `signature key ${String(stamped.keyId)} is not the trusted key "${keyId}"` };
  }
  try {
    const nodeCrypto = await import("node:crypto");
    // One-shot Ed25519 verification, mirroring `signManifest`.
    const ok = nodeCrypto.verify(null, manifestBytes, publicKeyPem, signatureBytes);
    return { ok };
  } catch (error) {
    return { ok: false, reason: `signature verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
