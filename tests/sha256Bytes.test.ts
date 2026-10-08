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
    // 0xff is never a legal UTF-8 byte. Handed to the string form it becomes a
    // replacement character, so that digest describes a different byte stream.
    expect(sha256HexBytes(new Uint8Array([0xff, 0x00, 0x41]))).not.toBe(
      sha256Hex(String.fromCharCode(0xff, 0x00, 0x41)),
    );
  });

  it("produces a 64 character lowercase hex digest for binary input", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sha256HexBytes(png)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves the caller's array untouched", () => {
    // The digest pads by writing into a working copy, so hashing must not grow
    // or otherwise disturb the buffer it was handed.
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
  // The lengths are the ones where `length % 64` changes behaviour. At 55 the
  // padding runs past the end of the block carrying the message and needs a
  // second one; at 56 it fits in the current block. 63/64/65 walk that boundary
  // a byte at a time, and 127/128/129 repeat it across a second block, so a
  // length field that spills or truncates cannot survive all of them.
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

  it("is checked at every length where the padding block changes shape", () => {
    // The list is the test's whole value: it is what names the boundaries. This
    // asserts the boundaries are still covered if someone trims the list.
    expect(byteLengths.filter((n) => n % 64 === 55)).toContain(55);
    expect(byteLengths.filter((n) => n % 64 === 56)).toContain(56);
    expect(byteLengths.filter((n) => n % 64 === 63)).toContain(63);
    expect(byteLengths.filter((n) => n % 64 === 0)).toContain(64);
  });
});

describe("fflate zip round-trip in the node environment", () => {
  it("reads back what it wrote", async () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = await import("fflate");
    const files = unzipSync(zipSync({ "manifest.json": strToU8('{"a":1}') }));
    expect(strFromU8(files["manifest.json"]!)).toBe('{"a":1}');
  });
});
