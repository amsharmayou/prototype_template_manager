import { zipSync, strToU8 } from "fflate";

import { describe, expect, it } from "vitest";

import { generateSigningKeyPair, signManifest, verifyManifestSignature } from "@/lib/package/signing";
import { openBundle } from "@/lib/package/open";
import { sha256HexBytes } from "@/lib/render/sha256";
import { PACKAGE_VERSION } from "@/lib/package/format";
import type { PackageManifest } from "@/lib/package/format";

/** A minimal valid v2 manifest for signing round-trips. */
function manifestFor(): PackageManifest {
  return {
    packageVersion: PACKAGE_VERSION,
    templateVersion: 2,
    name: "Signed invoice",
    document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    template: "template.json",
    assets: [],
    fonts: [],
    fields: [],
    computed: [],
    engineVersion: 1,
    templateSha256: "",
    signature: undefined,
    checksums: {},
  };
}

describe("bundle signing", () => {
  it("signs manifest bytes and verifies them", async () => {
    const { publicKeyPem, privateKeyPem } = await generateSigningKeyPair();
    const manifest = { ...manifestFor(), name: "Signed invoice" };
    const signed = await signManifest(manifest as unknown as Record<string, unknown>, (m) => strToU8(JSON.stringify(m)), privateKeyPem, "vendor-2026");

    const verdict = await verifyManifestSignature(
      signed.manifestBytes,
      signed.signatureBytes,
      publicKeyPem,
      "vendor-2026",
    );
    expect(verdict.ok).toBe(true);
    // The stamped envelope is inside the signed bytes, so a verifier reads the
    // keyId back out of the manifest itself.
    const stamped = JSON.parse(new TextDecoder().decode(signed.manifestBytes)) as { signature?: { keyId?: string } };
    expect(stamped.signature?.keyId).toBe("vendor-2026");
  });

  it("refuses tampered bytes and foreign keys", async () => {
    const { publicKeyPem, privateKeyPem, } = await generateSigningKeyPair();
    const other = await generateSigningKeyPair();
    const manifest = manifestFor();
    const signed = await signManifest(manifest as unknown as Record<string, unknown>, (m) => strToU8(JSON.stringify(m)), privateKeyPem, "vendor-2026");

    const tampered = signed.manifestBytes.slice();
    tampered[tampered.length - 5] ^= 0xff;
    const tamperedVerdict = await verifyManifestSignature(tampered, signed.signatureBytes, publicKeyPem);
    expect(tamperedVerdict.ok).toBe(false);

    const foreign = await verifyManifestSignature(signed.manifestBytes, signed.signatureBytes, other.publicKeyPem);
    expect(foreign.ok).toBe(false);

    const wrongKey = await verifyManifestSignature(signed.manifestBytes, signed.signatureBytes, publicKeyPem, "other-key");
    expect(wrongKey.ok).toBe(false);
    expect(wrongKey.reason).toContain("not the trusted key");
  });

  it("openBundle enforces a required signature", async () => {
    const { publicKeyPem, privateKeyPem } = await generateSigningKeyPair();
    const templateBytes = strToU8(
      JSON.stringify({ templateVersion: 2, meta: { name: "S" }, objects: [] }),
    );
    const manifest = manifestFor();
    manifest.templateSha256 = sha256HexBytes(templateBytes);
    manifest.checksums = { "template.json": sha256HexBytes(templateBytes) };
    const signed = await signManifest(manifest as unknown as Record<string, unknown>, (m) => strToU8(JSON.stringify(m)), privateKeyPem, "vendor-2026");
    const archive = zipSync(
      {
        "manifest.json": signed.manifestBytes,
        "manifest.json.sig": signed.signatureBytes,
        "template.json": templateBytes,
      },
      { level: 6 },
    );

    const okOpen = await openBundle(archive, {
      verify: { publicKeyPem, keyId: "vendor-2026", required: true },
    });
    expect(okOpen.ok).toBe(true);

    // A manifest swapped in under the same signature fails the signature
    // before anything else matters.
    const evilManifest = strToU8(
      JSON.stringify({ ...JSON.parse(new TextDecoder().decode(signed.manifestBytes)), name: "Evil" }),
    );
    const evil = zipSync(
      { "manifest.json": evilManifest, "manifest.json.sig": signed.signatureBytes, "template.json": templateBytes },
      { level: 6 },
    );
    const refused = await openBundle(evil, {
      verify: { publicKeyPem, keyId: "vendor-2026", required: true },
    });
    expect(refused.ok).toBe(false);
    expect(refused.refusals.some((m) => m.includes("signature"))).toBe(true);

    // A host that requires signatures refuses an unsigned bundle outright.
    const unsigned = zipSync(
      { "manifest.json": strToU8(JSON.stringify(manifest)), "template.json": templateBytes },
      { level: 6 },
    );
    const unsignedOpen = await openBundle(unsigned, {
      verify: { publicKeyPem, required: true },
    });
    expect(unsignedOpen.ok).toBe(false);
    expect(unsignedOpen.refusals.some((m) => m.includes("not signed"))).toBe(true);
  });
});
