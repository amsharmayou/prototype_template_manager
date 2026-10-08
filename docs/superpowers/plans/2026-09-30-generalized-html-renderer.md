# Generalized HTML Document Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure, deterministic `(BillTemplate, values) -> string` renderer that emits one self-contained, inert HTML document, and fix a pre-existing bug that silently drops every freehand stroke from every export.

**Architecture:** A new pure package `lib/render/` with no dependency on Fabric, React, the DOM, the network or the clock. Template values are resolved by key against a `values` map that defaults to `{}`, so this sprint's static render is a real subset of the future data-bound render rather than throwaway work. Every template value that reaches CSS is validated against a whitelist; every user value is escaped.

**Tech Stack:** TypeScript, Next.js 16.3.7, Vitest 3.2. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-generalized-html-renderer.md` — the spec is the authority; this plan is its argument. Read it before starting.

**Design reference:** `docs/Document_Renderer_and_Printer.md` — the TransportApp2 pipeline this design is derived from. Where the plan says "the reference", that is this document.

## Global Constraints

- Source stays in `C:\Users\Lenovo\Desktop\Personal Project\Prototype\version 1`; this is not a git worktree.
- PowerShell on this machine cannot execute unsigned `.ps1` shims, so **every npm invocation must use `npm.cmd`** — `npm.cmd test`, `npm.cmd run lint`. Plain `npm` fails with `PSSecurityException`.
- **`lib/render/` must never import `fabric`, `react`, or anything from `lib/canvas/`.** It may import types from `lib/template/types` and the token grammar from `lib/template/placeholders`. This is enforced by a test that reads the source as text, so it cannot be configured off.
- **No comments are added to source files unless a comment is required to explain a non-obvious constraint.** Comments the spec or this plan prescribes verbatim are part of the specified code.
- The renderer is pure: no `Date`, `Date.now`, `Math.random`, `Intl`, `toLocaleString`, `crypto`, `fetch`, or DOM API may appear anywhere under `lib/render/`.
- `template.meta.modifiedAt` must never appear in renderer output. It changes on every save and would destroy byte-determinism.
- Fabric 7.4.0 exports **neither `joinPath` nor `getPathCommandsInfo`** from its package entry. Verified. Any path-data string must be built locally.
- No existing export changes behaviour. JSON, SVG, PDF, DOCX and PNG stay exactly as they are.
- Do not run `git push`; the remote returns 403. Commit locally only.
- Baseline before this plan: 89 unit tests, 25 E2E tests, lint and typecheck clean.

## File Structure

**New, pure and independently testable**

- `lib/render/sha256.ts` — pure-TS SHA-256, hex out. No `crypto`.
- `lib/render/canonical.ts` — JSON with keys sorted at every level, for hashing.
- `lib/render/escape.ts` — `escapeHtml`, `attr`.
- `lib/render/values.ts` — token extraction and resolution against a values map.
- `lib/render/css.ts` — `safeColor`, `fontStack`, `safeLength`, `safeAngle`, `safeOpacity`, `Refusals`.
- `lib/render/style.ts` — the stylesheet, a pure function of document size and colours.
- `lib/render/primitives.ts` — one function per object type. The only file that knows a document coordinate exists.
- `lib/render/index.ts` — public entry: sheet, z-order, provenance attributes, refusal aggregation.

**New, tests**

- `tests/render.test.ts` — properties and behaviours.
- `tests/renderGolden.test.ts` — golden-file comparison.
- `tests/renderGolden/*.html` — committed expected output.

**Modified**

- `lib/template/serialize.ts` — freehand path-data fix (Task 1).
- `lib/template/types.ts` — document `FreehandObject.path`.
- `components/editor/ExportMenu.tsx` — sixth export target.
- `README.md`.

---

### Task 1: Fix freehand path data being dropped

Do this first. It is a pre-existing data-loss bug, and the renderer would otherwise inherit it.

**Files:**
- Modify: `lib/template/serialize.ts`, `lib/template/types.ts`
- Test: `tests/serialize.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `serialiseFreehand` now writes `FreehandObject.path` as SVG path **data** (a string), not `""`. `hydrateFreehand` is unchanged and already accepts it.

- [ ] **Step 1: Write the failing test**

Append to `tests/serialize.test.ts`:

```ts
it("round-trips freehand path data through the template", async () => {
  const { Path } = await import("fabric");
  const path = new Path(
    [
      ["M", 0, 0],
      ["L", 100, 50],
      ["Q", 120, 80, 140, 60],
    ],
    { stroke: "#000000", fill: "", strokeWidth: 2 },
  );
  path.set({ left: 10, top: 20, appType: "path", id: "p1", name: "Stroke" } as never);

  const template = serialiseObjects([path] as never, { width: 400, height: 400 }, "t");
  const freehand = template.objects.find((o) => o.type === "freehand");
  expect(freehand).toBeDefined();
  if (freehand?.type !== "freehand") throw new Error("unreachable");

  // Path data, not an empty string. This is the assertion that fails today.
  expect(freehand.path).toBe("M 0 0 L 100 50 Q 120 80 140 60");

  // And it survives a hydrate, so every existing export now draws the stroke.
  const back = hydrateTemplate(template);
  const revived = back.find((o) => o.type === "path");
  expect(revived).toBeDefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm.cmd test -- tests/serialize.test.ts`

Expected: FAIL. `freehand.path` is `""` today.

- [ ] **Step 3: Fix the serialiser**

In `lib/template/serialize.ts`, add a local helper near `str`/`num`:

```ts
/**
 * Fabric 7 stores a Path's geometry as an array of command tuples, and exports
 * neither `joinPath` nor `getPathCommandsInfo`, so the SVG path data is built
 * here. `new Path(<data>)` parses this back into the same tuples, so
 * `hydrateFreehand` needs no change.
 */
function pathData(commands: unknown): string {
  if (!Array.isArray(commands)) return "";
  return commands
    .filter((c): c is unknown[] => Array.isArray(c) && typeof c[0] === "string")
    .map((c) => `${c[0]} ${c.slice(1).join(" ")}`)
    .join(" ");
}
```

and in `serialiseFreehand`, replace `path: str(o.path, "")` with:

```ts
    path: pathData(o.path),
```

- [ ] **Step 4: Document the field**

In `lib/template/types.ts`, change `FreehandObject.path` to carry a doc comment:

```ts
export interface FreehandObject extends TemplateObjectBase {
  type: "freehand";
  /** Absolute document-space path, relative to the object origin. */
  points: Array<[number, number]>;
}
```

Do **not** change the `FreehandObject` interface in this task — only add the doc comment to its existing `path` field:

```ts
export interface FreehandObject extends TemplateObjectBase {
  type: "freehand";
  /** SVG path data, e.g. "M 0 0 L 100 50". Relative to the object origin. */
  path: string;
}
```

Keep `FreehandObject` exactly as it is apart from that comment. Do not rename `path`, do not add `points`, and do not change `PolygonObject`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm.cmd test -- tests/serialize.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the whole suite, typecheck and lint**

Run: `npm.cmd test` then `npm.cmd run typecheck` then `npm.cmd run lint`

Expected: 89 existing tests plus the new one, all green. No type errors, no lint errors.

- [ ] **Step 7: Commit**

```powershell
git add lib/template/serialize.ts lib/template/types.ts tests/serialize.test.ts
git commit -m "fix(export): serialise freehand strokes as SVG path data

Fabric stores a Path's geometry as an array of command tuples, and str() only
passes strings through, so every freehand stroke was serialised as path: \"\".
hydrateFreehand returns null for an empty path, so pencil strokes appeared in
the editor and in no exported document at all - not JSON, SVG, PDF, DOCX or PNG.

Build the path data locally; fabric 7.4.0 exports neither joinPath nor
getPathCommandsInfo. new Path(<data>) parses back to the same tuples, so the
hydrate side needs no change."
```

---

### Task 2: Canonical JSON and SHA-256

**Files:**
- Create: `lib/render/sha256.ts`, `lib/render/canonical.ts`
- Test: `tests/render.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // canonical.ts
  export function canonicalJson(value: unknown): string
  // Keys sorted at every level, no insignificant whitespace, numbers normalised.
  // Key insertion order must not affect the result.

  // sha256.ts
  export function sha256Hex(input: string): string
  // Lowercase hex, 64 chars. Pure: no crypto, no Buffer, no TextEncoder.
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/render/canonical";
import { sha256Hex } from "@/lib/render/sha256";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("handles a multi-byte character without mojibake", () => {
    // "日本語" in UTF-8
    expect(sha256Hex("日本語")).toBe(
      "8fe08b1f3b0b4a9d5b0e2f6b4a7d3f1c9e2a5b8d4f6c0a3e7d9b1f5c8a2e6d4b0",
    );
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is independent of key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("normalises numbers so 1 and 1.0 hash alike", () => {
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1.0 }));
  });

  it("handles arrays and null", () => {
    expect(canonicalJson({ a: [3, 1, 2], b: null })).toBe('{"a":[3,1,2],"b":null}');
  });
});
```

The multi-byte vector in that test is a **placeholder you must replace with the real value** — compute it before running:

Run: `node -e "const c=require('crypto');console.log(c.createHash('sha256').update('日本語','utf8').digest('hex'))"`

Paste the printed value in place of the dummy. Do not leave a value you have not computed; a wrong expected value turns this test into a coin flip.

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — `lib/render/canonical` and `lib/render/sha256` do not exist.

- [ ] **Step 3: Implement `sha256.ts`**

Standard FIPS 180-4 SHA-256. Write it as: UTF-8 encode the input by hand (code-point to bytes, handling surrogate pairs), pad to a multiple of 64 bytes with `0x80` then zeros then a 64-bit big-endian bit length, then 64 rounds over the eight initial hash values with the 64 round constants. No `crypto`, no `Buffer`, no `TextEncoder`.

Export:

```ts
export function sha256Hex(input: string): string
```

- [ ] **Step 4: Implement `canonical.ts`**

```ts
/**
 * JSON with object keys sorted at every level and no insignificant
 * whitespace, so a template's fingerprint does not depend on key insertion
 * order. Numbers are normalised through `Number`, so 1 and 1.0 agree.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return "null";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS. If the multi-byte vector fails while the ASCII vectors pass, your UTF-8 encoder mishandles surrogate pairs.

- [ ] **Step 6: Commit**

```powershell
git add lib/render/sha256.ts lib/render/canonical.ts tests/render.test.ts
git commit -m "feat(render): add pure SHA-256 and canonical JSON

Both are needed for a deterministic document fingerprint. crypto.subtle is
unavailable on plain http origins, which is how a shop would run this, and is
absent in Node without a DOM, so the digest is implemented here. canonicalJson
sorts keys at every level so the fingerprint does not depend on insertion
order."
```

---

### Task 3: Escaping and value resolution

**Files:**
- Create: `lib/render/escape.ts`, `lib/render/values.ts`
- Test: `tests/render.test.ts` (append)

**Interfaces:**
- Consumes: `TOKEN_SOURCE`-equivalent grammar. Prefer importing `extractVariables` from `lib/template/placeholders` for discovery, but resolution needs the token *positions*, so `values.ts` re-implements the match with the same pattern and a comment noting it must stay in step.
- Produces:
  ```ts
  // escape.ts
  export function escapeHtml(s: string): string   // & < > " '
  export function attr(s: string): string          // escapeHtml, for attribute values

  // values.ts
  export type Values = Readonly<Record<string, string>>;
  export function resolveText(text: string, values: Values): string
  ```
  `resolveText` does **not** escape; primitives escape at emit time, so a value
  substituted into two places is not double-escaped. `documentVariables` is
  deliberately *not* added here — Task 7 reuses `collectDocumentVariables` from
  `lib/template/placeholders`, which already does this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.test.ts`:

```ts
import { escapeHtml } from "@/lib/render/escape";
import { documentVariables, resolveText } from "@/lib/render/values";

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`Sharma & Sons <Traders> "x" 'y'`)).toBe(
      "Sharma &amp; Sons &lt;Traders&gt; &quot;x&quot; &#39;y&#39;",
    );
  });

  it("escapes ampersand first so entities are not double-broken", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralises a script tag", () => {
    expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script");
  });
});

describe("resolveText", () => {
  it("substitutes a key that is present", () => {
    expect(resolveText("Total {{ total }} due", { total: "3,510.00" })).toBe(
      "Total 3,510.00 due",
    );
  });

  it("leaves an unknown token literally in place", () => {
    expect(resolveText("Hello {{ zzz_custom_thing }}", {})).toBe(
      "Hello {{ zzz_custom_thing }}",
    );
  });

  it("escapes the substituted value", () => {
    expect(resolveText("{{ name }}", { name: "A & B <C>" })).toBe("A &amp; B &lt;C&gt;");
  });

  it("ignores a non-string value and leaves the token", () => {
    expect(resolveText("{{ n }}", { n: 42 as never })).toBe("{{ n }}");
  });

  it("substitutes the same key in every position", () => {
    expect(resolveText("{{ a }}-{{ a }}-{{ b }}", { a: "1", b: "2" })).toBe("1-1-2");
  });

  it("leaves text with no tokens untouched", () => {
    expect(resolveText("ACME TRADING CO.", {})).toBe("ACME TRADING CO.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — the two modules do not exist.

- [ ] **Step 3: Implement `escape.ts`**

```ts
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape every character that could end a text node or an attribute value. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export function attr(s: string): string {
  return escapeHtml(s);
}
```

- [ ] **Step 4: Implement `values.ts`**

```ts
import type { BillTemplate } from "@/lib/template/types";

export type Values = Readonly<Record<string, string>>;

/**
 * Same grammar as `TOKEN_SOURCE` in `lib/template/placeholders`. Duplicated
 * because resolution needs match positions, not just the distinct names; the
 * two must stay in step and a test asserts they agree.
 */
const TOKEN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Replace `{{key}}` with the value for that key, or leave the token literally
 * in place when the key is absent or not a string. Substitution is what makes
 * a static render a subset of the data-bound one rather than a separate path.
 */
export function resolveText(text: string, values: Values): string {
  return text.replace(TOKEN, (token, key: string) => {
    const v = values[key];
    return typeof v === "string" ? v : token;
  });
}
```

`values.ts` resolves raw values and the caller escapes, so `resolveText` must
**not** escape — the primitives escape at emit time. Adjust the test above
accordingly: assert `resolveText("{{ n }}", { n: "A & B" })` returns
`"A & B"`, and cover escaping at the `escapeHtml` level plus one integration
test in Task 7 that a value reaching a rendered text object is escaped. This
avoids double-escaping a value that is substituted into two places.

- [ ] **Step 5: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS after the assertion change in Step 4.

- [ ] **Step 6: Add the grammar-agreement test**

Append:

```ts
it("agrees with the template package's token grammar", async () => {
  const { extractVariables } = await import("@/lib/template/placeholders");
  const { resolveText } = await import("@/lib/render/values");
  const text = "{{ a }} {{ b.c }} {{d_1}} plain";
  const viaTemplatePkg = extractVariables(text).sort();
  const viaRenderer = Array.from(
    new Set(
      (text.match(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g) ?? []).map((t) =>
        t.replace(/[{}\s]/g, ""),
      ),
    ),
  ).sort();
  expect(viaRenderer).toEqual(viaTemplatePkg);
  expect(resolveText(text, {})).toBe(text);
});
```

- [ ] **Step 7: Commit**

```powershell
git add lib/render/escape.ts lib/render/values.ts tests/render.test.ts
git commit -m "feat(render): add HTML escaping and by-key value resolution

resolveText substitutes {{key}} from the values map and leaves an unknown
token in place, which is what makes a static render a real subset of the
data-bound one: the same code path serves both, and values default to {}.
Resolution does not escape; primitives escape at emit time, so a value
substituted twice is not double-escaped."
```

---

### Task 4: CSS value validation

**Files:**
- Create: `lib/render/css.ts`
- Test: `tests/render.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Refusal { field: string; value: string; reason: string }
  export class Refusals { add(field: string, value: string, reason: string): void; list(): Refusal[] }
  export function safeColor(v: unknown, fallback: string, r: Refusals, field = "color"): string
  export function fontStack(family: unknown): string
  export function safeLength(v: unknown, fallback = 0): number
  export function safeAngle(v: unknown): number
  export function safeOpacity(v: unknown): number
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.test.ts`:

```ts
import { Refusals, fontStack, safeAngle, safeColor, safeLength, safeOpacity } from "@/lib/render/css";

describe("safeColor", () => {
  it("accepts the safe forms", () => {
    const r = new Refusals();
    expect(safeColor("#abc", "#000000", r)).toBe("#abc");
    expect(safeColor("#aabbcc", "#000000", r)).toBe("#aabbcc");
    expect(safeColor("#aabbccdd", "#000000", r)).toBe("#aabbccdd");
    expect(safeColor("rgb(1, 2, 3)", "#000000", r)).toBe("rgb(1, 2, 3)");
    expect(safeColor("rgba(1,2,3,0.5)", "#000000", r)).toBe("rgba(1,2,3,0.5)");
    expect(safeColor("transparent", "#000000", r)).toBe("transparent");
    expect(safeColor("none", "#000000", r)).toBe("none");
    expect(r.list()).toHaveLength(0);
  });

  it("refuses a CSS injection attempt and records a reason", () => {
    const r = new Refusals();
    const out = safeColor("red; } body { display: none", "#000000", r, "fill");
    expect(out).toBe("#000000");
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0]!.field).toBe("fill");
  });

  it("refuses a url() and a non-finite value", () => {
    const r = new Refusals();
    expect(safeColor("url(javascript:alert(1))", "#000", r)).toBe("#000");
    expect(safeColor(Number.NaN, "#000", r)).toBe("#000");
    expect(safeColor(undefined, "#000", r)).toBe("#000");
    expect(r.list()).toHaveLength(3);
  });
});

describe("fontStack", () => {
  it("maps a known family to a stack", () => {
    expect(fontStack("Arial")).toContain("Arial");
    expect(fontStack("Arial")).toMatch(/sans-serif$/);
  });

  it("falls back for an unknown family and never echoes it", () => {
    const out = fontStack("My; } body { display:none");
    expect(out).not.toContain("display:none");
    expect(out).toMatch(/sans-serif$/);
  });

  it("handles a non-string", () => {
    expect(fontStack(undefined)).toMatch(/sans-serif$/);
  });
});

describe("numeric guards", () => {
  it("safeLength keeps finite numbers and replaces the rest", () => {
    expect(safeLength(12.5)).toBe(12.5);
    expect(safeLength(Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(safeLength("20", 0)).toBe(0);
  });

  it("safeAngle and safeOpacity clamp", () => {
    expect(safeAngle(45)).toBe(45);
    expect(safeAngle(Number.NaN)).toBe(0);
    expect(safeOpacity(0.5)).toBe(0.5);
    expect(safeOpacity(9)).toBe(1);
    expect(safeOpacity(-2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `css.ts`**

```ts
export interface Refusal {
  field: string;
  value: string;
  reason: string;
}

/**
 * Collected reasons a template value was refused. A bad value never fails the
 * render: the default is used and the caller is told, so one malformed colour
 * cannot cost a shop their whole document.
 */
export class Refusals {
  private readonly items: Refusal[] = [];
  add(field: string, value: string, reason: string): void {
    this.items.push({ field, value, reason });
  }
  list(): Refusal[] {
    return this.items;
  }
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\.\d+)\s*)?\)$/i;
const KEYWORD = new Set(["transparent", "none", "currentcolor"]);

/**
 * Validate a colour against a whitelist. Escaping is the wrong tool here:
 * `&lt;` does not defend against `fill: red; } body { display: none }`.
 * Anything unrecognised is refused and never emitted.
 */
export function safeColor(v: unknown, fallback: string, r: Refusals, field = "color"): string {
  if (typeof v !== "string") {
    r.add(field, String(v), "not a string");
    return fallback;
  }
  const t = v.trim();
  if (HEX.test(t) || RGB.test(t) || KEYWORD.has(t.toLowerCase())) return t;
  r.add(field, v, "not a recognised colour");
  return fallback;
}

const FAMILIES: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  "helvetica neue": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  calibri: "Calibri, Carlito, Arial, sans-serif",
  "times new roman": '"Times New Roman", Times, serif',
  georgia: "Georgia, " + '"Times New Roman", serif',
  courier: '"Courier New", Courier, monospace',
  monospace: "ui-monospace, Menlo, Consolas, monospace',
  serif: "Georgia, " + '"Times New Roman", serif',
  sans-serif: "Helvetica, Arial, sans-serif",
};

/** Map a family through a whitelist so a raw string never reaches the CSS. */
export function fontStack(family: unknown): string {
  if (typeof family !== "string") return FAMILIES["sans-serif"]!;
  return FAMILIES[family.trim().toLowerCase()] ?? FAMILIES["sans-serif"]!;
}

export function safeLength(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function safeAngle(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function safeOpacity(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/render/css.ts tests/render.test.ts
git commit -m "feat(render): validate every template value that reaches CSS

Escaping is the wrong tool for a stylesheet: &lt; does not defend against
fill: red; } body { display: none }. Colours are whitelisted, families map
through a table, numbers are range-checked, and a refused value is reported
rather than emitted, so one malformed colour cannot cost the whole document."
```

---

### Task 5: The stylesheet

**Files:**
- Create: `lib/render/style.ts`
- Test: `tests/render.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function stylesheet(docW: number, docH: number): string`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { stylesheet } from "@/lib/render/style";

describe("stylesheet", () => {
  it("declares the page at the document size in px, not A4 in mm", () => {
    const css = stylesheet(1240, 1754);
    expect(css).toContain("@page");
    expect(css).toContain("size: 1240px 1754px");
    expect(css).not.toMatch(/size:\s*A4/);
  });

  it("sizes the sheet to the document and clips overflow", () => {
    const css = stylesheet(800, 1000);
    expect(css).toContain("width: 800px");
    expect(css).toContain("height: 1000px");
    expect(css).toContain("overflow: hidden");
  });

  it("uses only px lengths so browser font settings cannot move anything", () => {
    const css = stylesheet(800, 1000);
    expect(css).not.toMatch(/\d(rem|em|pt|vh|vw)\b/);
  });

  it("pins text sizing for print", () => {
    const css = stylesheet(800, 1000);
    expect(css).toContain("text-size-adjust: 100%");
  });

  it("fetches nothing", () => {
    const css = stylesheet(800, 1000);
    expect(css).not.toContain("@import");
    expect(css).not.toMatch(/url\(/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `style.ts`**

A template literal producing the whole stylesheet. Required rules:

- `@page { size: <docW>px <docH>px; margin: 0; }`
- `html, body { margin: 0; padding: 0; background: #fff; }`
- `body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`
- `.sheet { position: relative; width: <w>px; height: <h>px; overflow: hidden; background: #fff; }`
- `.o { position: absolute; }` — the shared per-object rule
- `.t { white-space: pre; }` — traced text never wraps
- `.tx { display: flex; flex-direction: column; }` — for vertical alignment
- `.tbl { border-collapse: collapse; table-layout: fixed; }`
- `.ph { border: 1px dashed #9ca3af; display: flex; align-items: center; justify-content: center; color: #6b7280; }`
- `* { box-sizing: border-box; }`
- Every length in `px`. No `rem`, `em`, `pt`, `vh`, `vw`.
- No `@import`, no `url()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/render/style.ts tests/render.test.ts
git commit -m "feat(render): add the document stylesheet

The page is declared at the document's own pixel size rather than A4 in mm,
because a traced bill is usually not A4 and must print at its true size. Every
length is px so a browser's minimum-font-size setting cannot move a traced
element, and nothing is fetched."
```

---

### Task 6: Per-object primitives

**Files:**
- Create: `lib/render/primitives.ts`
- Test: `tests/render.test.ts` (append)

**Interfaces:**
- Consumes: `escapeHtml`, `resolveText`, `fontStack`, `safeColor`, `safeLength`, `safeAngle`, `safeOpacity`, `Refusals` from Tasks 3-4; `TemplateObject` from `lib/template/types`.
- Produces: `export function renderObject(o: TemplateObject, index: number, values: Readonly<Record<string, string>>, r: Refusals): string | null` — `null` when the object must not be emitted. **`values` is the third parameter, `r` the fourth**; every call in the tests below uses that order.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { renderObject } from "@/lib/render/primitives";
import { Refusals } from "@/lib/render/css";

const base = {
  id: "o1",
  name: "n",
  role: null,
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  parentId: null,
  stroke: "#000000",
  strokeWidth: 1,
  fill: "transparent",
} as const;

it("returns null for a group, which has no paint of its own", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "group" } as never, 0, {}, r)).toBeNull();
});

it("returns null for an invisible object", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "rect", visible: false, cornerRadius: 0 } as never, 0, {}, r)).toBeNull();
});

it("returns null for a non-finite box rather than emitting NaNpx", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "rect", x: Number.NaN, cornerRadius: 0 } as never, 0, {}, r)).toBeNull();
  expect(r.list().length).toBeGreaterThan(0);
});

it("renders a rect with its border inside the traced box", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, fill: "#ff0000" } as never, 0, {}, r)!;
  expect(out).toContain("position: absolute");
  expect(out).toContain("left: 10px");
  expect(out).toContain("top: 20px");
  expect(out).toContain("border: 1px solid #000000");
  expect(out).toContain("background: #ff0000");
});

it("refuses an injected fill and renders the default", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, fill: "red; } body{display:none" } as never, 0, {}, r)!;
  expect(out).not.toContain("display:none");
  expect(r.list().length).toBeGreaterThan(0);
});

it("emits a rotation transform with a centre origin", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, rotation: 30 } as never, 0, {}, r)!;
  expect(out).toContain("transform: rotate(30deg)");
  expect(out).toContain("transform-origin: 50% 50%");
});

it("renders text pre-formatted so it cannot reflow", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    type: "text",
    text: "Hello",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "static",
    textVerticalAlign: "top",
  } as never, 0, {}, r)!;
  expect(out).toContain("white-space: pre");
  expect(out).toContain("font-size: 12px");
  expect(out).toContain("line-height: 13.92px");
  expect(out).toContain("Hello");
});

it("renders a table as a real table with colgroup and row heights", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    width: 300,
    height: 60,
    type: "table",
    rows: 2,
    columns: 3,
    colWidths: [100, 120, 80],
    rowHeights: [30, 30],
    cells: [
      { text: "A", textAlign: "left", fontSize: 12, fontWeight: "bold" },
      { text: "B", textAlign: "left", fontSize: 12, fontWeight: "normal" },
      { text: "C", textAlign: "left", fontSize: 12, fontWeight: "normal" },
      { text: "D", textAlign: "left", fontSize: 12, fontWeight: "normal" },
      { text: "E", textAlign: "left", fontSize: 12, fontWeight: "normal" },
      { text: "F", textAlign: "left", fontSize: 12, fontWeight: "normal" },
    ],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "transparent",
    headerRow: true,
    headerFill: "#eeeeee",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
  } as never, 0, {}, r)!;
  expect(out).toContain("<table");
  expect(out).toContain("<colgroup>");
  expect(out).toContain('style="width: 100px"');
  expect(out).toContain('style="width: 120px"');
  expect(out).toContain('style="width: 80px"');
  expect(out).toContain("<thead>");
  expect(out).toContain("height: 30px");
  expect(out).toContain("border: 1px solid #000000");
});

it("clips a table cell instead of ellipsising it", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    width: 100,
    height: 30,
    type: "table",
    rows: 1,
    columns: 1,
    colWidths: [100],
    rowHeights: [30],
    cells: [{ text: "a very long value indeed", textAlign: "left", fontSize: 12, fontWeight: "normal" }],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "transparent",
    headerRow: false,
    headerFill: "transparent",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
  } as never, 0, {}, r)!;
  expect(out).toContain("overflow: hidden");
  expect(out).not.toContain("text-overflow");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `primitives.ts`**

Write `renderObject(o, index, values, r)` as a `switch` on `o.type`, returning `null` for `group` and for any object whose `x`, `y`, `width` or `height` is not finite (recording a refusal for the latter).

Per-type requirements:

- **Shared wrapper** for the div-based types: `class="o"`, `left`, `top`, `width`, `height`, `z-index`, `opacity`, and `transform: rotate(<angle>deg); transform-origin: 50% 50%` only when `rotation !== 0`. `index` is used only to make generated class names stable and unique.
- **`rect` / `rounded-rect` / `ellipse`**: `border: <w>px solid <stroke>` via `safeColor`, `background` via `safeColor` with `"transparent"` as the fallback for `fill`, `border-radius` from `cornerRadius` for rounded-rect and `50%` for ellipse.
- **`line` / `hr` / `vr`**: compute `dx = x2 - x`, `dy = y2 - y`, `len = Math.hypot(dx, dy)`, `angle = Math.atan2(dy, dx) * 180 / Math.PI`. Emit `left: <x>px`, `top: <y - h/2>px`, `width: <len>px`, `height: <max(strokeWidth, 0.75)>px`, `background: <stroke>`, `transform-origin: 0 50%`, `transform: rotate(<angle>deg)`. Return `null` when `len` is 0.
- **`polygon`**: an inline `<svg class="o" style="left;top;width;height;overflow:visible">` containing `<polygon points="x,y x,y" fill stroke>`. Points come from `o.points`, already relative to the origin; join with spaces and format each number with at most two decimals.
- **`freehand`**: an inline `<svg class="o">` with the same box plus `<path d="<escaped path data>" fill="none" stroke="<stroke>" stroke-width="<w>" stroke-linecap="round" stroke-linejoin="round">`. Return `null` when `o.path` is empty, which keeps a pre-fix template carrying the old empty string from emitting an empty `<path>`.
- **`text`**: `class="o t"`, `width`/`height` from the object, `font-family` from `fontStack`, `font-size: <fontSize>px`, `line-height: <fontSize * lineHeight>px`, `font-weight` and `font-style` when not normal, `text-align`, and a `tx` flex child whose `justify-content` is `flex-start` / `center` / `flex-end` from `textVerticalAlign`. Content is `escapeHtml(resolveText(o.text, values))`.
  **`letter-spacing` is emitted in `em` (`charSpacing / 1000`), not px, and this is deliberate**: letter spacing is a font-relative metric, so expressing it in em keeps it correct if the family is substituted. It cannot affect layout, because the box is absolutely positioned and the text is `white-space: pre` with no wrapping. The "px only" rule applies to the stylesheet, which is what Task 5 tests.
- **`table`**: a wrapper div at `(x, y)` with `width: <sum(colWidths)>px` containing a `<table style="width: <sum>px">`, a `<colgroup>` with one `<col style="width: Npx">` per entry, and a row per `rowHeights` entry with `style="height: Npx"`. `headerRow` puts the first row in `<thead>` with `<th>`, otherwise all rows are `<tbody>` with `<td>`. Each cell carries `border`, `padding`, `font-size`, `font-weight`, `color` (`headerTextColor` in a header row else `cellTextColor`), `background` (`headerFill` else `cellFill`), `text-align`, and `overflow: hidden` with no `text-overflow`. Cell text is `escapeHtml(resolveText(cell.text, values))`.
- **`image-placeholder`**: `class="o ph"` with the label centred via `escapeHtml(o.label)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS.

- [ ] **Step 5: Add a value-escaping integration assertion**

Append:

```ts
it("escapes a value that reaches a rendered text object", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    type: "text",
    text: "Dear {{ name }}",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
  } as never, 0, { name: "A & B <C>" }, r)!;
  expect(out).toContain("A &amp; B &lt;C&gt;");
  expect(out).not.toContain("<C>");
});
```

- [ ] **Step 6: Commit**

```powershell
git add lib/render/primitives.ts tests/render.test.ts
git commit -m "feat(render): render each object type

A traced template is a pixel-exact trace, so every primitive is absolutely
positioned - except the table, which becomes a real table with a colgroup and
per-row heights, so the one element that could exceed a page is the one the
browser engine owns. A group renders nothing: it is a serialised
ActiveSelection with no paint of its own, and baseFields would give it a black
border."
```

---

### Task 7: The public entry

**Files:**
- Create: `lib/render/index.ts`
- Test: `tests/render.test.ts` (append)

**Interfaces:**
- Consumes: `stylesheet`, `renderObject`, `Refusals`, `canonicalJson`, `sha256Hex`, `escapeHtml`, `documentVariables`.
- Produces:
  ```ts
  export interface RenderOptions { title?: string }
  export interface RenderResult { html: string; refusals: Refusal[]; variables: string[] }
  export function renderHtml(
    template: BillTemplate,
    values?: Readonly<Record<string, string>>,
    options?: RenderOptions,
  ): RenderResult
  ```

`renderHtml` returns a `RenderResult`, not a bare string, so the caller can show refusals and the variable list. The export target uses `result.html`.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { renderHtml } from "@/lib/render";
import { emptyTemplate, type BillTemplate } from "@/lib/template/types";

const tpl = (mutate?: (t: BillTemplate) => void): BillTemplate => {
  const t = emptyTemplate(1240, 1754, "Acme Bill");
  t.meta.modifiedAt = "2026-09-30T12:00:00.000Z";
  mutate?.(t);
  return t;
};

describe("renderHtml", () => {
  it("produces a complete document", () => {
    const { html } = renderHtml(tpl());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("charset=\"utf-8\"");
  });

  it("is byte-identical across runs", () => {
    const a = renderHtml(tpl()).html;
    const b = renderHtml(tpl()).html;
    expect(a).toBe(b);
  });

  it("never emits modifiedAt", () => {
    const { html } = renderHtml(tpl());
    expect(html).not.toContain("2026-09-30T12:00:00.000Z");
  });

  it("is inert: no script, no link, no import, no remote reference", () => {
    const { html } = renderHtml(tpl());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("records the template version and a stable hash", () => {
    const a = renderHtml(tpl()).html;
    const b = renderHtml(tpl()).html;
    expect(a).toContain('data-template-version="1"');
    const hash = /data-template-hash="([0-9a-f]{64})"/.exec(a);
    expect(hash).not.toBeNull();
    expect(b).toContain(hash![1]!);
  });

  it("changes the hash when the template changes", () => {
    const a = /data-template-hash="([0-9a-f]{64})"/.exec(renderHtml(tpl()).html)![1];
    const b = /data-template-hash="([0-9a-f]{64})"/.exec(
      renderHtml(tpl((t) => { t.document.width = 999; })).html,
    )![1];
    expect(a).not.toBe(b);
  });

  it("refuses an unsupported template version instead of guessing", () => {
    expect(() => renderHtml(tpl((t) => { (t as never as { templateVersion: number }).templateVersion = 99; })))
      .toThrow(/version/i);
  });

  it("reports the document's variables", () => {
    const { variables } = renderHtml(
      tpl((t) => {
        t.objects.push({
          id: "t1", name: "T", role: null, x: 0, y: 0, width: 100, height: 20,
          rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
          parentId: null, stroke: "#000", strokeWidth: 1, fill: "transparent",
          type: "text", text: "Hi {{ customer_name }}", fontFamily: "Arial",
          fontSize: 12, fontWeight: "normal", fontStyle: "normal",
          textAlign: "left", lineHeight: 1.16, charSpacing: 0,
          roleKind: "variable", textVerticalAlign: "top",
        } as never);
      }),
    );
    expect(variables).toEqual(["customer_name"]);
  });

  it("renders objects in zIndex order regardless of array order", () => {
    const mk = (id: string, z: number, text: string) => ({
      id, name: id, role: null, x: 0, y: 0, width: 50, height: 20, rotation: 0,
      opacity: 1, visible: true, locked: false, zIndex: z, parentId: null,
      stroke: "#000", strokeWidth: 1, fill: "transparent", type: "text", text,
      fontFamily: "Arial", fontSize: 12, fontWeight: "normal", fontStyle: "normal",
      textAlign: "left", lineHeight: 1.16, charSpacing: 0, roleKind: "static",
      textVerticalAlign: "top",
    });
    const { html } = renderHtml(tpl((t) => {
      t.objects.push(mk("second", 5, "SECOND") as never, mk("first", 1, "FIRST") as never);
    }));
    expect(html.indexOf("FIRST")).toBeLessThan(html.indexOf("SECOND"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `index.ts`**

```ts
import { escapeHtml } from "./escape";
import { canonicalJson } from "./canonical";
import { sha256Hex } from "./sha256";
import { type Refusal, Refusals } from "./css";
import { stylesheet } from "./style";
import { renderObject } from "./primitives";
import { collectDocumentVariables } from "@/lib/template/placeholders";
import { TEMPLATE_VERSION, type BillTemplate } from "@/lib/template/types";

export interface RenderOptions {
  title?: string;
}

export interface RenderResult {
  html: string;
  refusals: Refusal[];
  variables: string[];
}

export type { Refusal } from "./css";

export function renderHtml(
  template: BillTemplate,
  values: Readonly<Record<string, string>> = {},
  options: RenderOptions = {},
): RenderResult {
  if (template.templateVersion > TEMPLATE_VERSION) {
    throw new Error(
      `template version ${template.templateVersion} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
    );
  }
  const refusals = new Refusals();
  const { width, height } = template.document;

  // Array index breaks zIndex ties, so equal zIndex values never reorder.
  const ordered = template.objects
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.zIndex - b.o.zIndex || a.i - b.i);

  const body = ordered
    .map(({ o, i }) => renderObject(o, i, values, refusals))
    .filter((s): s is string => s !== null)
    .join("\n");

  const hash = sha256Hex(canonicalJson(template));
  const title = escapeHtml(options.title ?? template.meta.name ?? "Document");

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n` +
    `<style>\n${stylesheet(width, height)}\n</style>\n</head>\n<body>\n` +
    `<div class="sheet" data-template-version="${template.templateVersion}" ` +
    `data-template-hash="${hash}">\n${body}\n</div>\n</body>\n</html>\n`;

  const variables = collectDocumentVariables(
    template.objects.flatMap((o) =>
      o.type === "table" ? o.cells.map((c) => c.text) : o.type === "text" ? [o.text] : [],
    ),
  );

  return { html, refusals: refusals.list(), variables };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd test -- tests/render.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the whole suite, typecheck, lint**

Run: `npm.cmd test` then `npm.cmd run typecheck` then `npm.cmd run lint`

Expected: everything green.

- [ ] **Step 6: Commit**

```powershell
git add lib/render/index.ts tests/render.test.ts
git commit -m "feat(render): add the public HTML entry point

Objects render in zIndex order with the array index breaking ties, so equal
zIndex values never reorder between runs. The sheet carries the template
version and a SHA-256 fingerprint; meta.modifiedAt is never emitted, since it
changes on every save and would make every export unique."
```

---

### Task 8: Golden files and the purity guard

**Files:**
- Create: `tests/renderGolden.test.ts`, `tests/renderGolden/*.html`
- Test: same

**Interfaces:**
- Consumes: `renderHtml`, `emptyTemplate`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the golden test with a record mode**

Create `tests/renderGolden.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import { emptyTemplate, type BillTemplate, type TemplateObject } from "@/lib/template/types";

const DIR = join(__dirname, "renderGolden");

const base = {
  id: "o", name: "o", role: null, x: 0, y: 0, width: 100, height: 40,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
  parentId: null, stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const cases: Array<{ name: string; doc: { w: number; h: number }; objects: TemplateObject[] }> = [
  { name: "empty", doc: { w: 1240, h: 1754 }, objects: [] },
  { name: "single-text", doc: { w: 800, h: 1000 }, objects: [
    { ...base, id: "t1", type: "text", x: 40, y: 60, width: 300, height: 24,
      text: "ACME TRADING CO.", fontFamily: "Arial", fontSize: 18,
      fontWeight: "bold", fontStyle: "normal", textAlign: "left",
      lineHeight: 1.16, charSpacing: 0, roleKind: "static", textVerticalAlign: "top" } as TemplateObject,
  ] },
  { name: "a4-table", doc: { w: 794, h: 1123 }, objects: [
    { ...base, id: "tb", type: "table", x: 40, y: 200, width: 714, height: 90,
      rows: 3, columns: 3, colWidths: [300, 200, 214], rowHeights: [30, 30, 30],
      cells: Array.from({ length: 9 }, (_, i) => ({
        text: i === 0 ? "Item" : i === 1 ? "Qty" : i === 2 ? "Amount"
          : i === 3 ? "Widget" : i === 4 ? "2" : i === 5 ? "100.00"
          : i === 6 ? "Gadget" : i === 7 ? "1" : "50.00",
        textAlign: i === 2 || i === 5 || i === 8 ? "right" : "left",
        fontSize: 11, fontWeight: i < 3 ? "bold" : "normal",
      })),
      borderColor: "#000000", borderWidth: 1, cellFill: "transparent",
      headerRow: true, headerFill: "#f0f0f0", headerTextColor: "#000000",
      cellTextColor: "#000000", padding: 4, fontFamily: "Arial" } as TemplateObject,
  ] },
  { name: "every-primitive", doc: { w: 1000, h: 1400 }, objects: [
    { ...base, id: "r1", type: "rect", x: 20, y: 20, width: 200, height: 80, cornerRadius: 0, fill: "transparent" } as TemplateObject,
    { ...base, id: "r2", type: "rounded-rect", x: 20, y: 120, width: 200, height: 80, cornerRadius: 8, fill: "#eeeeee" } as TemplateObject,
    { ...base, id: "e1", type: "ellipse", x: 20, y: 220, width: 120, height: 120, cornerRadius: 0, fill: "transparent" } as TemplateObject,
    { ...base, id: "l1", type: "hr", x: 20, y: 360, width: 400, height: 0, x2: 420, y2: 360 } as TemplateObject,
    { ...base, id: "v1", type: "vr", x: 440, y: 360, width: 0, height: 200, x2: 440, y2: 560 } as TemplateObject,
    { ...base, id: "p1", type: "polygon", x: 460, y: 360, width: 100, height: 80, points: [[0,0],[100,20],[60,80]] } as TemplateObject,
    { ...base, id: "f1", type: "freehand", x: 580, y: 360, width: 120, height: 90, path: "M 0 0 L 60 40 L 120 10" } as TemplateObject,
    { ...base, id: "ph1", type: "image-placeholder", x: 580, y: 480, width: 160, height: 100, placeholderRole: "logo", label: "LOGO" } as TemplateObject,
    { ...base, id: "tx1", type: "text", x: 20, y: 600, width: 400, height: 24, text: "Total {{ total }}", fontFamily: "Arial", fontSize: 14, fontWeight: "bold", fontStyle: "normal", textAlign: "right", lineHeight: 1.16, charSpacing: 0, roleKind: "variable", textVerticalAlign: "top" } as TemplateObject,
  ] },
  { name: "non-a4", doc: { w: 2480, h: 3508 }, objects: [] },
];

const build = (c: (typeof cases)[number], values: Record<string, string> = {}): BillTemplate => {
  const t = emptyTemplate(c.doc.w, c.doc.h, "Golden");
  t.objects = c.objects;
  return t;
};

// Set UPDATE_GOLDEN=1 to rewrite the expected files, review the diff, and unset.
const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("golden render output", () => {
  for (const c of cases) {
    it(`matches ${c.name}.html`, () => {
      const { html } = renderHtml(build(c), c.name === "every-primitive" ? { total: "3,510.00" } : {});
      const file = join(DIR, `${c.name}.html`);
      if (UPDATE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, html, "utf8");
      }
      expect(existsSync(file)).toBe(true);
      const expected = readFileSync(file, "utf8");
      if (expected !== html) {
        const e = expected.split("\n");
        const a = html.split("\n");
        const i = a.findIndex((line, n) => line !== e[n]);
        throw new Error(
          `golden mismatch at line ${i + 1}\n  expected: ${e[i] ?? "<eof>"}\n  actual:   ${a[i] ?? "<eof>"}\n` +
            (UPDATE ? "goldens were rewritten; review the diff" : "set UPDATE_GOLDEN=1 to regenerate"),
        );
      }
    });
  }
});
```

- [ ] **Step 2: Generate the goldens, then read them**

Run: `$env:UPDATE_GOLDEN='1'; npm.cmd test -- tests/renderGolden.test.ts; Remove-Item Env:\UPDATE_GOLDEN`

Expected: PASS, and five files appear in `tests/renderGolden/`.

Then **read `every-primitive.html` in full and check it by eye** before committing. Confirm: no `<script`, no `http`, the table has a `<colgroup>` with the three exact widths, the freehand path carries its `d`, the group is absent, `@page size: 1000px 1400px`, and `{{ total }}` was substituted with `3,510.00` in the `every-primitive` case. A golden file that was generated without being read only proves the renderer is self-consistent, not correct.

- [ ] **Step 3: Write the purity guard test**

Append to `tests/render.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

it("lib/render imports no engine, no UI and nothing impure", () => {
  const dir = join(__dirname, "..", "lib", "render");
  const banned = [
    /from ["']fabric["']/,
    /from ["']react/,
    /from ["']next\//,
    /lib\/canvas/,
    /\bDate\b/,
    /Math\.random/,
    /\bIntl\b/,
    /toLocaleString/,
    /\bcrypto\b/,
    /\bfetch\b/,
    /document\./,
    /window\./,
  ];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const re of banned) {
      expect(`${file}: ${re.source} ${re.test(src) ? "FOUND" : "ok"}`).toContain("ok");
    }
  }
});

it("lib/render contains no field vocabulary", async () => {
  const { SUGGESTED_VARIABLES } = await import("@/lib/template/placeholders");
  const dir = join(__dirname, "..", "lib", "render");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const name of SUGGESTED_VARIABLES) {
      // Assert on the source, never on a message that embeds the name:
      // ``expect(`${file} must not mention ${name}`).not.toContain(name)`` is a
      // tautology that fails for every one of the 25 names, because the subject
      // string contains the needle by construction.
      expect({ file, name, present: src.includes(name) }).toEqual({
        file,
        name,
        present: false,
      });
    }
  }
});
```

The second test is the reference's "no business names in the renderer" guard, expressed as a source scan so it cannot be configured off like a linter rule.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd test`

Expected: PASS. If the vocabulary guard fails, a name from `SUGGESTED_VARIABLES` leaked into the renderer; remove it rather than weakening the test.

- [ ] **Step 5: Verify the goldens are stable without UPDATE_GOLDEN**

Run: `npm.cmd test -- tests/renderGolden.test.ts`

Expected: PASS with no environment variable set. This is the real check that the goldens describe the renderer and not a one-off run.

- [ ] **Step 6: Commit**

```powershell
git add tests/renderGolden.test.ts tests/renderGolden tests/render.test.ts
git commit -m "test(render): add golden files and the purity guard

Goldens are compared byte for byte and the failure names the first differing
line, so an unintended change is visible in review. The purity guard reads
lib/render as text and fails on fabric, react, next, lib/canvas, Date, Math
random, Intl, crypto, fetch and the DOM, and separately on any name from
SUGGESTED_VARIABLES - the reference's 'a field is a key, never a business
concept' rule, enforced where a linter cannot turn it off."
```

---

### Task 9: Wire the export target

**Files:**
- Modify: `components/editor/ExportMenu.tsx`
- Test: `e2e/workflow.spec.ts` (append)

**Interfaces:**
- Consumes: `renderHtml` from `lib/render`, `downloadText` from `lib/export/download`.
- Produces: a sixth item in the export menu.

- [ ] **Step 1: Write the failing E2E test**

Append to `e2e/workflow.spec.ts`, inside the existing `test.describe("Bill template tracing workflow")`:

```ts
test("exports a self-contained inert HTML document", async ({ page }) => {
  await openEditorWithBill(page);
  await pickTool(page, "Rect");
  const P = await docToPage(page);
  await draw(page, P, 120, 200, 480, 300);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export/ }).click();
  await page.getByRole("button", { name: /HTML Document/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.html$/);

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const html = Buffer.concat(chunks).toString("utf8");

  expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(html).not.toContain("<script");
  expect(html).not.toContain("http://");
  expect(html).toMatch(/data-template-hash="[0-9a-f]{64}"/);
  expect(html).toContain("@page");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm.cmd run test:e2e -- -g "self-contained inert HTML"`

Expected: FAIL — no such menu item.

- [ ] **Step 3: Add the export item**

In `components/editor/ExportMenu.tsx`:

- Add `"html"` to the `ExportItem` union.
- Add to `ITEMS`: `{ id: "html", label: "HTML Document", hint: "Self-contained, no scripts" }`.
- Import `renderHtml` and `downloadText`.
- In `run`, add:

```ts
      if (item === "html") {
        const result = renderHtml(template);
        downloadText(
          result.html,
          `${safeFilename(template.meta.name)}.html`,
          "text/html;charset=utf-8",
        );
      }
```

- Import `safeFilename` alongside `downloadText`.

Do not change any other branch of `run`. The existing exports must behave exactly as before.

- [ ] **Step 4: Run to verify it passes**

Run: `npm.cmd run test:e2e -- -g "self-contained inert HTML"`

Expected: PASS.

- [ ] **Step 5: Run the full E2E suite**

Run: `npm.cmd run test:e2e`

Expected: 26 passed, the 25 existing plus this one.

- [ ] **Step 6: Commit**

```powershell
git add components/editor/ExportMenu.tsx e2e/workflow.spec.ts
git commit -m "feat(export): add a self-contained HTML export target

The sixth export, alongside the five that already exist and are untouched. The
document is inert by construction - no script, no stylesheet link, no remote
reference - so it can be emailed to someone who did not create it."
```

---

### Task 10: Document it

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the renderer section**

Add a section describing: the pure `(BillTemplate, values) -> string` signature; the determinism guarantee and the `modifiedAt` exclusion; the escaping and CSS-validation split; the `values` map defaulting to `{}` and what that makes possible next; the table-as-real-`<table>` choice; the `@page` sizing in the document's own pixels; the font caveat, stated as layout identical everywhere and glyph shapes not; and that the file contains no JavaScript so printing is the browser's own.

- [ ] **Step 2: Add the freehand fix to the findings**

In the Fabric findings register, add an entry recording that a Fabric `Path` stores `path` as an array of command tuples, that a string-only serialiser therefore wrote `""`, and that `new Path(<data>)` parses path data back into the same tuples — so a `d` string is the right wire format. Include the fact that fabric 7.4.0 exports neither `joinPath` nor `getPathCommandsInfo`.

- [ ] **Step 3: Verify and commit**

Run: `npm.cmd run lint` then `npm.cmd test`

Expected: 89 existing plus every new test, all green, no lint errors.

```powershell
git add README.md
git commit -m "docs: describe the HTML renderer and the freehand path fix"
```

---

## Final Verification

All five gates. This is the definition of done.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: lint clean, typecheck clean, unit green (89 pre-existing + every new test in this plan), E2E green (25 pre-existing + the HTML export case), build compiles.

Then confirm by hand: export HTML from the editor, open it in two different browsers, and check the layout is identical. The file must open with no network available.

## Out of Scope For This Plan

- **Data entry.** No values panel, no data-file loader. `values = {}` leaves
  `{{placeholder}}` tokens printing literally, which is the agreed behaviour.
- **Recomputed totals.** The reference's whitelisted expression evaluator over
  integer paise, so a supplied total is never trusted. It changes the template
  schema and needs its own spec.
- **Replacing the PDF export.** `toPdf` still builds from the SVG. The reference
  argues Chromium's print adapter is the better path; that is a separate
  decision, taken in a later sprint.
- **Font embedding**, for glyph-identical output.
- **Image attachment** to placeholders, and therefore any raster in the output.
- **Multi-page output.** `.sheet` clips; a traced bill is one page.
