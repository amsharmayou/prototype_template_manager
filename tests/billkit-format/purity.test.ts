import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Patterns that are already true of CODE, so they match against raw source.
 * An import specifier lives inside a string literal by nature - stripping
 * strings would hide exactly what these are written to catch.
 */
const BANNED_IN_CODE = [
  /from ["']fabric["']/,
  /from ["']react/,
  /from ["']next\//,
  /lib\/canvas/,
  // Matched on the specifier alone, not on a binding name, so every import
  // form is caught: `import crypto`, `import * as crypto`, and - the ones that
  // actually threaten byte-identical output - `import { randomUUID }` or a
  // `require("node:crypto")`. Naming a binding would only catch the first two.
  //
  // The bare specifier is banned alongside the `node:`-prefixed one because
  // Node resolves `"crypto"` and `"node:crypto"` to the same module: banning
  // only the prefixed spelling bans a spelling, not the module. Left uncaught,
  // `import { randomBytes } from "crypto"` passes this whole suite and is still
  // the one source of nondeterminism the guard exists to exclude.
  /from ["']node:crypto["']/,
  /require\(["']node:crypto["']\)/,
  /import\(["']node:crypto["']\)/,
  /from ["']crypto["']/,
  /require\(["']crypto["']\)/,
  /import\(["']crypto["']\)/,
];

/**
 * Patterns that must not appear in CODE, and would false-positive on prose.
 * `document.` ends sentences in ordinary JSDoc; `fetch` appears in explanatory
 * comments. Matching the raw text for those makes the guard cry wolf, and a
 * guard that cries wolf gets ignored.
 */
const BANNED_AT_RUNTIME = [
  /\bDate\b/,
  /Math\.random/,
  /\bIntl\b/,
  /toLocaleString/,
  // `crypto.` and not `\bcrypto\b`: the word is only dangerous as a property
  // access, and the global is reached as `globalThis.crypto.getRandomValues`,
  // not as a bare local the stripped pass happens to keep.
  /crypto\./,
  /\bfetch\b/,
  /document\./,
  /window\./,
];

/** Drop comments and string bodies, keeping the surrounding code shape. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

/**
 * Every `${...}` body in the source, brace-matched.
 *
 * `code()` deletes whole template literals, which takes the interpolations
 * with them - so `` `${new Date().toISOString()}` `` strips down to `""` and
 * reads as pure. This puts those expressions back as their own scan target.
 *
 * Brace counting is string-aware. A `}` inside `'`/`"`/`` ` `` is a character in
 * a string, not the end of the interpolation: `${flag ? "}" : new Date()}` ends
 * at that brace without the string check, so the body seen is `flag ? "` and the
 * `Date` behind it is never scanned. Tracking the open quote closes that hole,
 * and an escape is consumed with the character it escapes so a `\"` cannot end
 * the string early.
 *
 * It does not check that the `$` was inside a backtick, so it can pick up a
 * `${` that lives in a comment or an ordinary string. That is a superset of
 * what it should see, and for a guard the extra detections are the cheap
 * direction to err in.
 */
function interpolations(src: string): string {
  const out: string[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== "$" || src[i + 1] !== "{") continue;
    let depth = 0;
    let quote: string | null = null;
    for (let j = i + 1; j < src.length; j++) {
      const ch = src[j];
      if (quote !== null) {
        // `\` quotes the next character, so step past it rather than letting
        // `\"` read as the closing quote of the string it sits in.
        if (ch === "\\") j += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        out.push(src.slice(i + 2, j));
        break;
      }
    }
  }
  return out.join("\n");
}

/**
 * The vendored format sources, relative to the repo root.
 *
 * These are the files copied from the retired `shared/billkit-format` package.
 * The scan is an explicit list - not a directory walk - because `lib/` also
 * holds editor code (canvas, renderer, serialize) that legitimately touches
 * everything banned here. If a format file is added, add it to this list.
 */
const VENDORED = [
  "lib/package/build.ts",
  "lib/package/computedSpecs.ts",
  "lib/package/form.ts",
  "lib/package/format.ts",
  "lib/package/index.ts",
  "lib/package/parse.ts",
  "lib/package/resolve.ts",
  "lib/package/validate.ts",
  "lib/render/sha256.ts",
  "lib/render/values.ts",
  "lib/template/dataBinding.ts",
  "lib/template/placeholders.ts",
  "lib/template/types.ts",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sources = () => VENDORED.map((f) => ({ file: f, src: readFileSync(join(root, f), "utf8") }));

describe("purity of the vendored format sources", () => {
  it("scans more than one real source file", () => {
    // Without this, an empty or mis-pointed root makes every assertion below
    // pass vacuously. That is the exact failure this whole task exists to
    // prevent, so it is asserted first and on its own.
    expect(sources().length).toBeGreaterThan(5);
  });

  it("imports no engine and no UI", () => {
    for (const { file, src } of sources()) {
      for (const re of BANNED_IN_CODE) {
        expect(`${file}: ${re.source} ${re.test(src) ? "FOUND" : "ok"}`).toContain("ok");
      }
    }
  });

  it("touches no impure runtime global", () => {
    for (const { file, src } of sources()) {
      const bodies = [code(src), interpolations(src)];
      for (const re of BANNED_AT_RUNTIME) {
        const hit = bodies.some((b) => re.test(b));
        expect(`${file}: ${re.source} ${hit ? "FOUND" : "ok"}`).toContain("ok");
      }
    }
  });
});
