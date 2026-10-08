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
});

describe("fflate zip round-trip in the node environment", () => {
  it("reads back what it wrote", async () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = await import("fflate");
    const files = unzipSync(zipSync({ "manifest.json": strToU8('{"a":1}') }));
    expect(strFromU8(files["manifest.json"]!)).toBe('{"a":1}');
  });
});
