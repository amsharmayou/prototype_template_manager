import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex, sha256HexBytes } from "@/lib/render/sha256";

const enc = new TextEncoder();

describe("sha256HexBytes", () => {
  it("matches the published SHA-256 vectors over bytes", () => {
    expect(sha256HexBytes(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256HexBytes(enc.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with the string form for ASCII input", () => {
    expect(sha256HexBytes(enc.encode("hello"))).toBe(sha256Hex("hello"));
  });

  it("differs from the string form for bytes that are not valid UTF-8", () => {
    // 0xff is never a legal UTF-8 byte. `fromCharCode` reads it as the code
    // point U+00FF, which `utf8Bytes` encodes as the two bytes 0xc3 0xbf, so the
    // string form hashes 4 bytes where the byte form hashes 3.
    expect(sha256HexBytes(new Uint8Array([0xff, 0x00, 0x41]))).not.toBe(
      sha256Hex(String.fromCharCode(0xff, 0x00, 0x41)),
    );
  });

  it("produces a 64 character lowercase hex digest for binary input", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sha256HexBytes(png)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves the caller's array untouched", () => {
    // This pins the wrapper's contract: the buffer handed in comes back
    // unmodified. It does not cover the copy inside the private core, which no
    // test can reach - `Array.from` at this wrapper already guards the caller's
    // bytes, so this would pass with or without that internal copy.
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    sha256HexBytes(bytes);
    expect(Array.from(bytes)).toEqual([0x61, 0x62, 0x63]);
  });
});

describe("sha256HexBytes against the platform digest", () => {
  // The evidence above is two hardcoded vectors plus wrapper-level tests, and all
  // of it is consistent with this implementation. A digest that pads wrongly
  // agrees with itself, so every one of those would still pass. Only an
  // independent digest can catch that.
  //
  // 55 is the last length whose padding still fits the message's own block; 56
  // is the first that spills into a second one. 56 is therefore the exact length
  // where padding behaviour changes, and 63/64/65 and 127/128/129 walk that
  // boundary a byte at a time.
  const byteLengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 127, 128, 129];

  const deterministicBytes = (n: number): Uint8Array =>
    new Uint8Array(Array.from({ length: n }, (_, i) => i % 256));

  it.each(byteLengths)("matches node:crypto over %i bytes", (n) => {
    // Deterministic content, not random, so a failure is reproducible from the
    // length alone.
    const bytes = deterministicBytes(n);
    expect(sha256HexBytes(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("probes the padding boundaries rather than arbitrary lengths", () => {
    // The list is the whole value of this block: it names the boundaries. This
    // asserts each residue class the list claims to probe is still represented,
    // so trimming the list cannot quietly drop the coverage.
    for (const residue of [0, 55, 56, 63]) {
      expect(byteLengths.filter((n) => n % 64 === residue)).not.toHaveLength(0);
    }
  });
});

describe("fflate zip round-trip in the node environment", () => {
  it("reads back what it wrote", async () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = await import("fflate");
    const files = unzipSync(zipSync({ "manifest.json": strToU8('{"a":1}') }));
    expect(strFromU8(files["manifest.json"]!)).toBe('{"a":1}');
  });
});
