# BillKit Package - Phase 1 & 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare template JSON into a validated `.btpkg` package with a manifest, and let tables repeat a variable number of line-item rows with correctly computed totals.

**Architecture:** The distributable format is a ZIP (`.btpkg`) holding `manifest.json`, `template.json` and `assets/`. One deliberate asymmetry keeps the change cheap: **the package is the distributable format, while `BillTemplate` with inline data URIs stays the in-memory render format.** The package layer resolves `pkg://` references back to data URIs before calling `renderHtml`, so the pure renderer never learns packages exist. Repeat rows are expanded by a pre-pass over the object list, so `renderObject` and the whole rendering path stay untouched.

**Tech Stack:** TypeScript 5, Vitest (`node` environment, `@/` alias to repo root), fflate for zip, Playwright for E2E, the existing hand-written SHA-256 in `lib/render/sha256.ts`.

**Spec:** `docs/superpowers/specs/2026-10-08-billkit-package-design.md`

**Scope note:** Phases 1 and 2 of the spec only. Phases 3 (fonts), 4 (runtime bundle) and 5 (Android host) get a separate plan. `lib/render` gains new *pure* modules; no existing render behaviour changes, and its purity test and byte-for-byte goldens must pass untouched.

## Global Constraints

- `lib/render/**` must stay pure: no `fabric`, `react`, `next/`, `lib/canvas`, `Date`, `Math.random`, `Intl`, `toLocaleString`, `crypto`, `fetch`, `document.`, `window.` - enforced by the "purity of lib/render" test in `tests/render.test.ts`. Do not weaken that test.
- `lib/render/**` must contain no word from `SUGGESTED_VARIABLES` - also enforced by a test.
- Money is arithmetic in **integer minor units** with a declared `currencyScale` (default 2). Never `parseFloat` a money value; never do money arithmetic in floats.
- No `eval` and no parsed expression strings. Computed values use a fixed `op` vocabulary evaluated by pure functions.
- `pkg://` is package-internal. `lib/render`'s existing `isSafeImageSrc` rejects it, so an unresolved reference can never reach an export as a live URL.
- Repo style: double quotes, semicolons, 2-space indent, `camelCase.ts` under `lib/`, flat `tests/*.test.ts`.
- Vitest runs in the `node` environment. DOM behaviour is covered by Playwright, not Vitest.
- Every task ends green on `npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run lint`.
- **Do not commit unless the user explicitly asks.** Each task lists the commit command; run it only on that instruction.

---

### Task 1: Byte hashing and an explicit fflate dependency

Package checksums must cover binary PNG bytes, but `sha256Hex` accepts only a string and runs it through an internal UTF-8 encoder. Also promote `fflate` from a transitive dependency of `docx` to a declared one: relying on a transitive dependency means a future `docx` bump breaks package reading invisibly.

**Files:**
- Modify: `lib/render/sha256.ts`
- Create: `tests/sha256Bytes.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `sha256Hex(input: string): string` (behaviour unchanged) and `sha256HexBytes(bytes: Uint8Array): string`, both from `@/lib/render/sha256`.

- [ ] **Step 1: Write the failing test**

Create `tests/sha256Bytes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/sha256Bytes.test.ts`

Expected: FAIL - `sha256HexBytes` is not exported.

- [ ] **Step 3: Refactor the compression core to take bytes**

In `lib/render/sha256.ts`, replace:

```ts
export function sha256Hex(input: string): string {
  const message = utf8Bytes(input);
  const bits = message.length * 8;
```

with:

```ts
export function sha256Hex(input: string): string {
  return sha256HexFromBytes(utf8Bytes(input));
}

/**
 * Hash raw bytes. `sha256Hex` cannot be used for this: it runs its input through
 * a UTF-8 encoder first, so any byte sequence that is not valid UTF-8 would be
 * hashed as its replacement-character substitution rather than as itself. A
 * package checksum covers PNG bytes, so it must hash what is actually stored.
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  return sha256HexFromBytes(Array.from(bytes));
}

/**
 * FIPS 180-4 SHA-256 over an already-encoded byte sequence. Both public entry
 * points share this, so they cannot drift apart in how they pad.
 */
export function sha256HexFromBytes(message: number[]): string {
  const bits = message.length * 8;
```

Everything from the existing padding block through `return h.map(hex).join("");` stays exactly as it is, now closing `sha256HexFromBytes`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx.cmd vitest run tests/sha256Bytes.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Promote fflate to an explicit dependency**

Run: `npm.cmd install fflate --save`

Then confirm it is declared, not merely present:

```powershell
node -e "const p=require('./package.json'); console.log('declared:', p.dependencies.fflate, 'installed:', require('fflate/package.json').version)"
```

Expected: both printed, and they match.

- [ ] **Step 6: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. The five `renderGolden` files and the `lib/render` purity tests must pass unchanged.

- [ ] **Step 7: Commit**

```powershell
git add lib/render/sha256.ts tests/sha256Bytes.test.ts package.json package-lock.json
git commit -m "feat: byte-level SHA-256 and explicit fflate dependency"
```

---

### Task 2: Template schema v2, the repeat band, migration, and package format types

`repeat` is additive and optional, so **every v1 template stays a valid v2 template**. `migrateTemplate` exists because no migration layer exists today: the only version check in the repo is a throw inside `lib/render/index.ts`, and `EditorController.loadTemplate` does not check the version at all.

**Files:**
- Modify: `lib/template/types.ts`
- Create: `lib/template/migrate.ts`
- Create: `lib/package/format.ts`
- Create: `tests/migrate.test.ts`

**Interfaces:**
- Consumes: `BillTemplate`, `TemplateObject` from `@/lib/template/types`.
- Produces: `TEMPLATE_VERSION` becomes `2`; `TableObject.repeat?: TableRepeat` where `TableRepeat` is `{ startRow: number; endRow: number; key: string; repeatHeader?: boolean; maxItems?: number }`; `migrateTemplate(raw: unknown): { template: BillTemplate; notes: string[] }`; and `PACKAGE_VERSION = 1` plus the manifest types in `@/lib/package/format`: `Issue`, `Severity`, `ManifestDocument`, `ManifestAsset`, `ManifestFont`, `ManifestField`, `ManifestFieldType`, `ComputedSpec`, `ComputedOp`, `PackageManifest`, `PackageFile`, `Package`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { migrateTemplate } from "@/lib/template/migrate";
import { TEMPLATE_VERSION, type BillTemplate } from "@/lib/template/types";

const v1: BillTemplate = {
  templateVersion: 1,
  document: { width: 794, height: 1123 },
  meta: { name: "Old bill", modifiedAt: "2026-01-01T00:00:00.000Z" },
  objects: [],
};

describe("migrateTemplate", () => {
  it("passes a v1 template through unchanged and reports the version it saw", () => {
    const { template, notes } = migrateTemplate(v1);
    expect(template.templateVersion).toBe(TEMPLATE_VERSION);
    expect(template.objects).toEqual([]);
    expect(template.document).toEqual({ width: 794, height: 1123 });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("refuses a template claiming a newer version than this build supports", () => {
    expect(() => migrateTemplate({ ...v1, templateVersion: TEMPLATE_VERSION + 1 })).toThrow(
      /exceeds/,
    );
  });

  it("stamps a missing version rather than leaving it undefined", () => {
    const { template } = migrateTemplate({
      document: { width: 794, height: 1123 },
      meta: { name: "No version", modifiedAt: "2026-01-01T00:00:00.000Z" },
      objects: [],
    });
    expect(template.templateVersion).toBe(TEMPLATE_VERSION);
  });

  it("supplies a default document and name for an empty object", () => {
    const { template } = migrateTemplate({});
    expect(template.document.width).toBeGreaterThan(0);
    expect(template.document.height).toBeGreaterThan(0);
    expect(template.meta.name.length).toBeGreaterThan(0);
    expect(template.objects).toEqual([]);
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42, "nope", [], { objects: "no" }]) {
      expect(() => migrateTemplate(bad)).not.toThrow();
    }
  });

  it("keeps an existing repeat band untouched", () => {
    const { template } = migrateTemplate({
      ...v1,
      templateVersion: TEMPLATE_VERSION,
      objects: [
        {
          id: "t1",
          type: "table",
          name: "Items",
          role: null,
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 0,
          parentId: null,
          stroke: "",
          strokeWidth: 0,
          fill: "",
          rows: 3,
          columns: 2,
          colWidths: [50, 50],
          rowHeights: [20, 20, 20],
          cells: [],
          borderColor: "#000",
          borderWidth: 1,
          cellFill: "",
          headerRow: true,
          headerFill: "",
          headerTextColor: "",
          cellTextColor: "",
          padding: 2,
          fontFamily: "Arial",
          repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 50 },
        },
      ],
    });
    expect((template.objects[0] as { repeat?: unknown }).repeat).toEqual({
      startRow: 1,
      endRow: 1,
      key: "items",
      maxItems: 50,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/migrate.test.ts`

Expected: FAIL - `@/lib/template/migrate` does not exist.

- [ ] **Step 3: Add the repeat band and bump the version**

In `lib/template/types.ts` change:

```ts
export const TEMPLATE_VERSION = 1 as const;
```

to:

```ts
export const TEMPLATE_VERSION = 2 as const;
```

Add immediately before `export interface TableObject`:

```ts
/**
 * A band of rows inside a table that is repeated once per item at render time.
 *
 * Rows `startRow`..`endRow` inclusive (0-based) are the template band: they are
 * cloned, never drawn as they stand, and every `{{token}}` inside them resolves
 * against the current item before the flat values. A band may span more than one
 * row so a two-row-per-item layout is expressible.
 *
 * Optional on purpose: its absence is a v1 template, which is why v1 and v2
 * describe the same bytes.
 */
export interface TableRepeat {
  /** 0-based, inclusive: first row of the template band. */
  startRow: number;
  /** 0-based, inclusive: last row of the template band. */
  endRow: number;
  /** Values key holding the JSON array of items. */
  key: string;
  /** Repeat `headerRow` when the expanded table splits across pages. */
  repeatHeader?: boolean;
  /** Hard cap on generated rows; a larger input is refused, not silently truncated. */
  maxItems?: number;
}
```

Add `repeat?: TableRepeat;` as the last field of `TableObject`.

- [ ] **Step 4: Write the migration module**

Create `lib/template/migrate.ts`:

```ts
import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type TemplateObject,
} from "@/lib/template/types";

/**
 * Bring an untrusted template of any supported version up to this build's
 * version.
 *
 * This exists because there was no migration layer: the only version check in
 * the codebase was a throw inside `renderHtml`, and `EditorController.loadTemplate`
 * did not check the version at all, so a file from a newer build was accepted
 * and rendered with whatever fields this build happened to recognise.
 *
 * Every field read is defensive. All three template load sites cast
 * `JSON.parse` output straight to `BillTemplate`, so a truncated or hand-edited
 * file arrives with missing pieces.
 */
export function migrateTemplate(raw: unknown): { template: BillTemplate; notes: string[] } {
  const notes: string[] = [];
  const root =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const claimed = root.templateVersion;
  if (typeof claimed === "number" && claimed > TEMPLATE_VERSION) {
    throw new Error(`template version ${claimed} exceeds the supported ${TEMPLATE_VERSION}`);
  }
  notes.push(
    typeof claimed === "number"
      ? `template read as version ${claimed}, migrated to ${TEMPLATE_VERSION}`
      : `template carried no version, treated as version 1 and migrated to ${TEMPLATE_VERSION}`,
  );

  const doc =
    typeof root.document === "object" && root.document !== null
      ? (root.document as Record<string, unknown>)
      : {};
  const width = typeof doc.width === "number" && doc.width > 0 ? doc.width : A4_WIDTH;
  const height = typeof doc.height === "number" && doc.height > 0 ? doc.height : A4_HEIGHT;
  if (width !== doc.width || height !== doc.height) {
    notes.push(`document size filled in to ${width}x${height}`);
  }

  const meta =
    typeof root.meta === "object" && root.meta !== null
      ? (root.meta as Record<string, unknown>)
      : {};
  const name =
    typeof meta.name === "string" && meta.name.length > 0 ? meta.name : "Untitled bill";
  const modifiedAt = typeof meta.modifiedAt === "string" ? meta.modifiedAt : "";

  const objects: TemplateObject[] = Array.isArray(root.objects)
    ? (root.objects as TemplateObject[])
    : [];

  return {
    template: {
      templateVersion: TEMPLATE_VERSION,
      document: { width, height },
      meta: { name, modifiedAt },
      objects,
    },
    notes,
  };
}
```

- [ ] **Step 5: Run the migration test**

Run: `npx.cmd vitest run tests/migrate.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Create the package format types**

Create `lib/package/format.ts`:

```ts
/**
 * The `.btpkg` manifest: the contract a foreign frontend reads before it has
 * seen the template it describes.
 *
 * Deliberately separate from `lib/template/types.ts`. That file is the *in-memory
 * render format* and carries inline data URIs; this is the *distributable* format
 * and references assets by file. Keeping them apart is what lets the existing
 * pure renderer keep working unchanged.
 */

export const PACKAGE_VERSION = 1 as const;

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Dotted path into the package, e.g. `assets[2].file`. */
  path: string;
  message: string;
}

export interface ManifestDocument {
  width: number;
  height: number;
  unit: "px";
  dpi: number;
  paper: string;
  /** Decimal places money is held in; amounts are integers of this scale. */
  currencyScale: number;
}

export interface ManifestAsset {
  id: string;
  role: "bill-part" | "image-placeholder";
  /** Archive-relative path, e.g. `assets/obj_7.png`. */
  file: string;
  width: number;
  height: number;
}

export interface ManifestFont {
  family: string;
  file: string;
  sha256: string;
}

/**
 * `"repeating"` is a package-layer kind, not a renderer one: it is meaningful
 * only on a field whose `source` is `table` and whose table carries a
 * `TableRepeat`. It is intentionally absent from `FieldType` in
 * `lib/template/dataBinding.ts`, which the renderer reads.
 */
export type ManifestFieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image"
  | "repeating";

export interface ManifestField {
  key: string;
  label: string;
  type: ManifestFieldType;
  source: "text" | "table" | "image-placeholder" | "field";
  objectName: string;
  maxLength?: number;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
  /** Column keys of a repeating field, in band order. */
  columns?: string[];
  maxItems?: number;
}

export type ComputedOp =
  | "sum"
  | "sum-times"
  | "add"
  | "subtract"
  | "multiply"
  | "percent";

export interface ComputedSpec {
  key: string;
  op: ComputedOp;
  /**
   * A dotted arg such as `items.amount` means column `amount` of repeat `items`.
   * An undotted arg is a flat values key.
   */
  args: string[];
  /** Read by `percent`; the percentage rate. */
  rateKey?: string;
}

export interface PackageManifest {
  packageVersion: typeof PACKAGE_VERSION;
  templateVersion: number;
  name: string;
  document: ManifestDocument;
  /** Archive-relative path of the template document. */
  template: string;
  assets: ManifestAsset[];
  fonts: ManifestFont[];
  fields: ManifestField[];
  computed: ComputedSpec[];
  /** SHA-256 per archive file, keyed by that path. */
  checksums: Record<string, string>;
}

export interface PackageFile {
  name: string;
  bytes: Uint8Array;
}

export interface Package {
  manifest: PackageManifest;
  /** Every archive member except the manifest, keyed by its archive-relative path. */
  files: Map<string, Uint8Array>;
}
```

- [ ] **Step 7: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. `renderHtml`'s existing check is `claimed > TEMPLATE_VERSION` and `TEMPLATE_VERSION` is now `2`, so v1 templates keep rendering unchanged.

- [ ] **Step 8: Commit**

```powershell
git add lib/template/types.ts lib/template/migrate.ts lib/package/format.ts tests/migrate.test.ts
git commit -m "feat: template schema v2 with repeat bands and a migration layer"
```

---

### Task 3: The package validator

Today `RenderClient.importTemplate` does `JSON.parse` with **zero** structural checks, and `EditorController.loadTemplate` runs five duck-type checks and fails silently. This replaces both with a validator that reports rather than throws.

**Files:**
- Create: `lib/package/validate.ts`
- Create: `tests/packageValidate.test.ts`

**Interfaces:**
- Consumes: `Package`, `PackageManifest`, `Issue` from `@/lib/package/format`; `PACKAGE_VERSION` from the same; `sha256HexBytes` from `@/lib/render/sha256`; `TEMPLATE_VERSION` from `@/lib/template/types`.
- Produces: `validatePackage(pkg: Package): { ok: boolean; issues: Issue[] }` and `validateManifest(manifest: unknown, files: ReadonlyMap<string, Uint8Array>): Issue[]`

- [ ] **Step 1: Write the failing test**

Create `tests/packageValidate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { validatePackage } from "@/lib/package/validate";

function manifest(over: Partial<PackageManifest> = {}): PackageManifest {
  return {
    packageVersion: PACKAGE_VERSION,
    templateVersion: 2,
    name: "Invoice",
    document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    template: "template.json",
    assets: [],
    fonts: [],
    fields: [],
    computed: [],
    checksums: {},
    ...over,
  };
}

function pkg(
  over: Partial<PackageManifest> = {},
  files: Record<string, Uint8Array> = {},
): Package {
  const map = new Map<string, Uint8Array>([
    ["template.json", new Uint8Array([1, 2, 3])],
    ...Object.entries(files),
  ]);
  return { manifest: manifest(over), files: map };
}

const errors = (p: Package) =>
  validatePackage(p).issues.filter((i) => i.severity === "error");

describe("validatePackage", () => {
  it("accepts a well-formed package", () => {
    expect(validatePackage(pkg())).toEqual({ ok: true, issues: [] });
  });

  it("rejects an unsupported package version", () => {
    const p = pkg({ packageVersion: (PACKAGE_VERSION + 1) as never });
    expect(errors(p).some((i) => i.path === "packageVersion")).toBe(true);
    expect(validatePackage(p).ok).toBe(false);
  });

  it("rejects a template version this build cannot render", () => {
    expect(errors(pkg({ templateVersion: 99 })).some((i) => i.path === "templateVersion")).toBe(
      true,
    );
  });

  it("rejects a missing template file", () => {
    const p = pkg();
    p.files.delete("template.json");
    expect(errors(p).some((i) => i.path === "template")).toBe(true);
  });

  it("rejects a non-positive page width", () => {
    const p = pkg({
      document: { width: 0, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    });
    expect(errors(p).some((i) => i.path === "document.width")).toBe(true);
  });

  it("rejects an asset declared but not present in the archive", () => {
    const p = pkg({
      assets: [{ id: "a", role: "bill-part", file: "assets/missing.png", width: 1, height: 1 }],
    });
    expect(errors(p).some((i) => i.path === "assets[0].file")).toBe(true);
  });

  it("rejects duplicate field keys", () => {
    const f = {
      key: "customer_name",
      label: "A",
      type: "text" as const,
      source: "text" as const,
      objectName: "X",
    };
    expect(errors(pkg({ fields: [f, { ...f, label: "B" }] })).some(
      (i) => i.path === "fields[1].key",
    )).toBe(true);
  });

  it("rejects a field type outside the union", () => {
    const p = pkg({
      fields: [
        {
          key: "x",
          label: "X",
          type: "telepathy" as never,
          source: "text" as const,
          objectName: "O",
        },
      ],
    });
    expect(errors(p).some((i) => i.path === "fields[0].type")).toBe(true);
  });

  it("requires columns on a repeating field", () => {
    const p = pkg({
      fields: [
        {
          key: "items",
          label: "Items",
          type: "repeating" as const,
          source: "table" as const,
          objectName: "Items",
        },
      ],
    });
    expect(errors(p).some((i) => i.path === "fields[0].columns")).toBe(true);
  });

  it("rejects a computed op outside the vocabulary", () => {
    expect(
      errors(pkg({ computed: [{ key: "t", op: "eval-me" as never, args: ["subtotal"] }] })).some(
        (i) => i.path === "computed[0].op",
      ),
    ).toBe(true);
  });

  it("requires a rateKey on a percent op", () => {
    expect(
      errors(pkg({ computed: [{ key: "tax", op: "percent" as const, args: ["subtotal"] }] })).some(
        (i) => i.path === "computed[0].rateKey",
      ),
    ).toBe(true);
  });

  it("reports a checksum mismatch", () => {
    const p = pkg({ checksums: { "template.json": "0".repeat(64) } });
    expect(errors(p).some((i) => i.path === "checksums.template.json")).toBe(true);
  });

  it("never throws on a garbage manifest", () => {
    for (const bad of [null, undefined, 42, "x", [], { assets: "no", fields: 3 }]) {
      const p = { manifest: bad as never, files: new Map() };
      expect(() => validatePackage(p)).not.toThrow();
      expect(validatePackage(p).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/packageValidate.test.ts`

Expected: FAIL - `@/lib/package/validate` does not exist.

- [ ] **Step 3: Implement the validator**

Create `lib/package/validate.ts`:

```ts
import type { Issue, Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { sha256HexBytes } from "@/lib/render/sha256";
import { TEMPLATE_VERSION } from "@/lib/template/types";

const FIELD_TYPES = new Set([
  "text",
  "number",
  "date",
  "currency",
  "tickmark",
  "checkbox",
  "image",
  "repeating",
]);

const COMPUTED_OPS = new Set(["sum", "sum-times", "add", "subtract", "multiply", "percent"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(path: string, message: string): Issue {
  return { severity: "error", path, message };
}

/**
 * Validate a manifest against the archive it claims to describe.
 *
 * Returns issues rather than throwing, so a host can show every problem at once
 * instead of surfacing them one reload at a time.
 */
export function validateManifest(
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
): Issue[] {
  const out: Issue[] = [];
  if (!isRecord(manifest)) return [issue("", "manifest is not an object")];

  if (manifest.packageVersion !== PACKAGE_VERSION) {
    out.push(
      issue(
        "packageVersion",
        `package version ${String(manifest.packageVersion)} is not supported; this build reads ${PACKAGE_VERSION}`,
      ),
    );
  }
  const tplVersion = manifest.templateVersion;
  if (typeof tplVersion !== "number" || !Number.isFinite(tplVersion)) {
    out.push(issue("templateVersion", "template version is not a number"));
  } else if (tplVersion > TEMPLATE_VERSION) {
    out.push(
      issue(
        "templateVersion",
        `template version ${tplVersion} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
      ),
    );
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    out.push(issue("name", "manifest has no name"));
  }

  const doc = manifest.document;
  if (!isRecord(doc)) {
    out.push(issue("document", "manifest has no document"));
  } else {
    for (const side of ["width", "height"] as const) {
      const v = doc[side];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        out.push(issue(`document.${side}`, `page ${side} must be a positive number`));
      }
    }
    const scale = doc.currencyScale;
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > 6) {
      out.push(issue("document.currencyScale", "currencyScale must be an integer from 0 to 6"));
    }
  }

  const templatePath = manifest.template;
  if (typeof templatePath !== "string" || templatePath.length === 0) {
    out.push(issue("template", "manifest names no template file"));
  } else if (!files.has(templatePath)) {
    out.push(issue("template", `template file ${templatePath} is not in the archive`));
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  assets.forEach((a, i) => {
    if (!isRecord(a)) return void out.push(issue(`assets[${i}]`, "asset entry is not an object"));
    if (typeof a.file !== "string" || a.file.length === 0) {
      out.push(issue(`assets[${i}].file`, "asset has no file"));
    } else if (!files.has(a.file)) {
      out.push(issue(`assets[${i}].file`, `asset file ${a.file} is not in the archive`));
    }
  });

  const fonts = Array.isArray(manifest.fonts) ? manifest.fonts : [];
  fonts.forEach((f, i) => {
    if (!isRecord(f)) return void out.push(issue(`fonts[${i}]`, "font entry is not an object"));
    if (typeof f.file !== "string" || !files.has(f.file)) {
      out.push(issue(`fonts[${i}].file`, `font file ${String(f.file)} is not in the archive`));
    }
  });

  const fields = Array.isArray(manifest.fields) ? manifest.fields : [];
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!isRecord(f)) return void out.push(issue(`fields[${i}]`, "field entry is not an object"));
    const key = f.key;
    if (typeof key !== "string" || key.length === 0) {
      out.push(issue(`fields[${i}].key`, "field has no key"));
    } else if (seen.has(key)) {
      out.push(issue(`fields[${i}].key`, `duplicate field key ${key}`));
    } else {
      seen.add(key);
    }
    if (typeof f.type !== "string" || !FIELD_TYPES.has(f.type)) {
      out.push(issue(`fields[${i}].type`, `unknown field type ${String(f.type)}`));
    }
    if (f.type === "repeating" && (!Array.isArray(f.columns) || f.columns.length === 0)) {
      out.push(issue(`fields[${i}].columns`, "a repeating field must declare its columns"));
    }
    if (f.pattern !== undefined && typeof f.pattern !== "string") {
      out.push(issue(`fields[${i}].pattern`, "pattern must be a string"));
    }
  });

  const computed = Array.isArray(manifest.computed) ? manifest.computed : [];
  computed.forEach((c, i) => {
    if (!isRecord(c)) return void out.push(issue(`computed[${i}]`, "computed entry is not an object"));
    if (typeof c.op !== "string" || !COMPUTED_OPS.has(c.op)) {
      out.push(issue(`computed[${i}].op`, `unknown computed op ${String(c.op)}`));
    }
    if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== "string")) {
      out.push(issue(`computed[${i}].args`, "computed args must all be strings"));
    }
    if (c.op === "percent" && (typeof c.rateKey !== "string" || c.rateKey.length === 0)) {
      out.push(issue(`computed[${i}].rateKey`, "a percent op must name the rate it applies"));
    }
  });

  const checksums = manifest.checksums;
  if (checksums !== undefined) {
    if (!isRecord(checksums)) {
      out.push(issue("checksums", "checksums must be an object"));
    } else {
      for (const [path, expected] of Object.entries(checksums)) {
        const bytes = files.get(path);
        if (!bytes) {
          out.push(issue(`checksums.${path}`, "checksum given for a file not in the archive"));
          continue;
        }
        if (typeof expected !== "string" || sha256HexBytes(bytes) !== expected) {
          out.push(issue(`checksums.${path}`, `checksum does not match the archived ${path}`));
        }
      }
    }
  }

  return out;
}

/** `ok` is false when at least one error was found. Warnings never block. */
export function validatePackage(pkg: Package): { ok: boolean; issues: Issue[] } {
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();
  const issues = validateManifest(pkg?.manifest, files);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/packageValidate.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add lib/package/validate.ts tests/packageValidate.test.ts
git commit -m "feat: strict package validator reporting errors and warnings"
```

---

### Task 4: Build and parse a `.btpkg`, and round-trip it

**Files:**
- Create: `lib/package/build.ts`
- Create: `lib/package/parse.ts`
- Create: `tests/packageRoundTrip.test.ts`

**Interfaces:**
- Consumes: `Package`, `PackageManifest`, `ComputedSpec` from `@/lib/package/format`; `extractTemplateFields` from `@/lib/template/dataBinding`; `BillTemplate` from `@/lib/template/types`; `sha256HexBytes` from `@/lib/render/sha256`; `zipSync`/`unzipSync`/`strToU8`/`strFromU8` from `fflate`.
- Produces: `BuildOptions`, `buildPackage(template: BillTemplate, options?: BuildOptions): Package`, `writePackage(pkg: Package): Uint8Array`, `parsePackage(bytes: Uint8Array): Package` (throws only for an unreadable archive).

**Note on `buildPackage` and repeating fields.** The manifest fields come straight from
`extractTemplateFields`, which knows nothing about repeat bands, so a freshly built manifest
contains no field of `type: "repeating"` and no `columns`. That is deliberate, not an oversight:
Task 11 recovers the band and its columns from the template itself, so the derived form is
correct either way. Do **not** "fix" this by teaching `extractTemplateFields` about bands - the
validator in Task 3 requires `columns` on any `repeating` field, and synthesising one here
without `maxItems` would produce a manifest that fails its own validation.

- [ ] **Step 1: Write the failing round-trip test**

Create `tests/packageRoundTrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { validatePackage } from "@/lib/package/validate";
import type { BillTemplate } from "@/lib/template/types";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dec = new TextDecoder();

function base(): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Invoice A4", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "obj_7",
        type: "bill-part",
        name: "Bill Part 1",
        role: null,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        src: PNG,
        normalized: true,
      },
    ],
  };
}

const templateIn = (pkg: { files: Map<string, Uint8Array> }): BillTemplate =>
  JSON.parse(dec.decode(pkg.files.get("template.json")!));

describe("package round-trip", () => {
  it("survives write then read unchanged", () => {
    const back = parsePackage(writePackage(buildPackage(base())));
    expect(back.manifest.name).toBe("Invoice A4");
    expect(back.manifest.templateVersion).toBe(2);
    expect(back.manifest.assets).toHaveLength(1);
    expect(back.files.get("template.json")).toBeDefined();
  });

  it("extracts the inline image into the archive instead of base64 in the template", () => {
    const pkg = buildPackage(base());
    const part = templateIn(pkg).objects[0] as { src?: string };
    expect(part.src).toMatch(/^pkg:\/\//);
    expect(part.src).not.toContain("base64");
    expect(pkg.files.get(part.src!.replace("pkg://", ""))).toBeDefined();
  });

  it("validates clean after a round-trip", () => {
    expect(validatePackage(parsePackage(writePackage(buildPackage(base()))))).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("is smaller than the equivalent base64 JSON because images are stored raw", () => {
    const zipped = writePackage(buildPackage(base())).length;
    const asJson = new TextEncoder().encode(JSON.stringify(base())).length;
    expect(zipped).toBeLessThan(asJson);
  });

  it("keeps a bill part with no image, as a part that renders nothing yet", () => {
    const t = base();
    delete (t.objects[0] as { src?: string }).src;
    expect(parsePackage(writePackage(buildPackage(t))).manifest.assets).toHaveLength(0);
  });

  it("does not extract an image src that is not a data URI", () => {
    const t = base();
    (t.objects[0] as { src?: string }).src = "https://example.com/a.png";
    const pkg = buildPackage(t);
    expect(pkg.manifest.assets).toHaveLength(0);
    expect(templateIn(pkg).objects[0]).toMatchObject({ src: "https://example.com/a.png" });
  });

  it("gives two parts with identical images one archive entry", () => {
    const t = base();
    t.objects.push({ ...t.objects[0], id: "obj_8", name: "Bill Part 2" } as never);
    const srcs = templateIn(buildPackage(t)).objects.map((o) => (o as { src?: string }).src);
    expect(new Set(srcs).size).toBe(1);
  });

  it("derives the manifest fields from the template", () => {
    const t = base();
    t.objects = [
      {
        ...base().objects[0],
        type: "text",
        src: undefined,
        text: "Dear {{customer_name}}",
        fontFamily: "Arial",
        fontSize: 12,
        fontWeight: "normal",
        fontStyle: "normal",
        textAlign: "left",
        lineHeight: 14,
        charSpacing: 0,
        roleKind: "variable",
        textVerticalAlign: "top",
      } as never,
    ];
    expect(buildPackage(t).manifest.fields.map((f) => f.key)).toContain("customer_name");
  });

  it("refuses to parse bytes that are not a zip", () => {
    expect(() => parsePackage(new TextEncoder().encode("not a zip"))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/packageRoundTrip.test.ts`

Expected: FAIL - `@/lib/package/build` does not exist.

- [ ] **Step 3: Implement the builder**

Create `lib/package/build.ts`:

```ts
import type { ComputedSpec, Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { sha256HexBytes } from "@/lib/render/sha256";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";

import { strToU8, zipSync } from "fflate";

export interface BuildOptions {
  computed?: ComputedSpec[];
  currencyScale?: number;
}

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function decodeDataUri(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(",") + 1);
  const binary = typeof atob === "function" ? atob(b64) : "";
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Archive names must be safe and unique; ids come from the editor, so neither is assumed. */
function safeName(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "asset";
}

/**
 * Turn a template into the distributable package form.
 *
 * Images move out of the JSON and into the archive. Base64 inflates binary by a
 * third, and holding the bytes in one place is what lets a host read one asset
 * without parsing the whole document.
 */
export function buildPackage(template: BillTemplate, options: BuildOptions = {}): Package {
  const files = new Map<string, Uint8Array>();
  const assets: PackageManifest["assets"] = [];
  const bySrc = new Map<string, string>();

  const unusedName = (id: string): string => {
    const base = `assets/${safeName(id)}.png`;
    if (!files.has(base)) return base;
    let n = 2;
    while (files.has(`assets/${safeName(id)}-${n}.png`)) n += 1;
    return `assets/${safeName(id)}-${n}.png`;
  };

  const objects: TemplateObject[] = template.objects.map((o) => {
    const src = (o as { src?: unknown }).src;
    // Only inline data is extracted. A remote src is left exactly as it is, so
    // the package never claims to carry bytes it does not have.
    if (typeof src !== "string" || !DATA_IMAGE.test(src)) return { ...o };

    const known = bySrc.get(src);
    if (known) return { ...o, src: `pkg://${known}` } as TemplateObject;

    const role = o.type === "bill-part" ? "bill-part" : "image-placeholder";
    const name = unusedName(o.id);
    bySrc.set(src, name);
    files.set(name, decodeDataUri(src));
    assets.push({
      id: o.id,
      role,
      file: name,
      width: Math.round(o.width),
      height: Math.round(o.height),
    });
    return { ...o, src: `pkg://${name}` } as TemplateObject;
  });

  const templateJson = JSON.stringify({ ...template, objects }, null, 2);
  files.set("template.json", strToU8(templateJson));

  const fields = extractTemplateFields({ ...template, objects }).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    source: f.source,
    objectName: f.objectName,
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
  }));

  const checksums: Record<string, string> = {};
  for (const [name, bytes] of files) checksums[name] = sha256HexBytes(bytes);

  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    templateVersion: template.templateVersion,
    name: template.meta?.name ?? "Untitled bill",
    document: {
      width: template.document?.width ?? 794,
      height: template.document?.height ?? 1123,
      unit: "px",
      dpi: 96,
      paper:
        template.document?.width === 794 && template.document?.height === 1123 ? "A4" : "custom",
      currencyScale: options.currencyScale ?? 2,
    },
    template: "template.json",
    assets,
    fonts: [],
    fields,
    computed: options.computed ?? [],
    checksums,
  };

  return { manifest, files };
}

/**
 * Serialise the package to zip bytes.
 *
 * The manifest is written alongside a sibling `manifest.json.sha256` digest, so
 * the manifest itself is covered by a checksum. It cannot carry its own digest
 * inside `checksums`, because hashing bytes that embed their own hash is
 * impossible; a reader verifies the manifest against this sibling member instead.
 */
export function writePackage(pkg: Package): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of pkg.files) entries[name] = bytes;
  entries["manifest.json"] = strToU8(JSON.stringify(pkg.manifest, null, 2));
  entries["manifest.json.sha256"] = strToU8(sha256HexBytes(entries["manifest.json"]!));
  return zipSync(entries, { level: 6 });
}
```

Add `manifestSha256?: string` to `Package` in `lib/package/format.ts`:

```ts
export interface Package {
  manifest: PackageManifest;
  /** Every archive member except the manifest, keyed by its archive-relative path. */
  files: Map<string, Uint8Array>;
  /** Digest of the manifest as read, verified by `validatePackage`. */
  manifestSha256?: string;
}
```

`parsePackage` reads the sibling member rather than trusting the manifest:

```ts
  const digestBytes = raw["manifest.json.sha256"];
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name === "manifest.json" || name === "manifest.json.sha256") continue;
    files.set(name, data);
  }

  return {
    manifest,
    files,
    manifestSha256: digestBytes ? strFromU8(digestBytes) : undefined,
  };
```

**Thread the digest through validation.** `validateManifest` needs the manifest's own bytes to
verify against, so extend both signatures in `lib/package/validate.ts` from Task 3:

```ts
export function validateManifest(
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  manifestBytes?: Uint8Array,
): Issue[] {
```

and at the top of its body, after the `isRecord` guard:

```ts
  if (manifestBytes && sha256HexBytes(manifestBytes) !== expectedDigest) {
    out.push(issue("manifest", "manifest does not match the checksum stored beside it"));
  }
```

where `expectedDigest` is threaded as a fourth parameter. Use this final form instead:

```ts
export function validateManifest(
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  manifestBytes?: Uint8Array,
  manifestSha256?: string,
): Issue[] {
  const out: Issue[] = [];
  if (!isRecord(manifest)) return [issue("", "manifest is not an object")];

  if (manifestSha256 !== undefined) {
    if (!manifestBytes || sha256HexBytes(manifestBytes) !== manifestSha256) {
      out.push(issue("manifest", "manifest does not match the checksum stored beside it"));
    }
  }
```

and change `validatePackage` to pass both through, reading the manifest's bytes from `files`:

```ts
export function validatePackage(pkg: Package): { ok: boolean; issues: Issue[] } {
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();
  // The manifest is excluded from `files` by the parser, so its bytes are carried
  // alongside the digest and verified here.
  const manifestBytes = pkg?.manifestBytes;
  const issues = validateManifest(
    pkg?.manifest,
    files,
    manifestBytes,
    pkg?.manifestSha256,
  );
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
```

Add `manifestBytes?: Uint8Array` to `Package` too, and set it in `parsePackage` to
`manifestBytes` (the raw entry) so the two travel together.

- [ ] **Step 4: Implement the parser**

Create `lib/package/parse.ts`:

```ts
import type { Package, PackageManifest } from "@/lib/package/format";

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
```

- [ ] **Step 5: Run the test**

Run: `npx.cmd vitest run tests/packageRoundTrip.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 6: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. If `atob`/`btoa` are flagged as missing types, declare them in a local `declare` block inside `build.ts` rather than widening the project `lib`, so the node test environment is unchanged:

```ts
declare const atob: ((s: string) => string) | undefined;
declare const btoa: ((s: string) => string) | undefined;
```

- [ ] **Step 7: Commit**

```powershell
git add lib/package/build.ts lib/package/parse.ts lib/package/format.ts lib/package/validate.ts tests/packageRoundTrip.test.ts
git commit -m "feat: build and parse a self-describing .btpkg archive"
```

---

### Task 5: Resolve `pkg://` references back to data URIs

This is the seam that lets the existing pure renderer keep working unchanged.

**Files:**
- Create: `lib/package/resolve.ts`
- Create: `tests/packageResolve.test.ts`

**Interfaces:**
- Consumes: `Package` from `@/lib/package/format`; `BillTemplate`, `TemplateObject` from `@/lib/template/types`; `strFromU8` from `fflate`.
- Produces: `resolvePackage(pkg: Package): { template: BillTemplate; unresolved: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/packageResolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPackage } from "@/lib/package/build";
import { resolvePackage } from "@/lib/package/resolve";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function templated(src: string): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 200, height: 200 },
    meta: { name: "T", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "obj_7",
        type: "bill-part",
        name: "Part",
        role: null,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        src,
        normalized: true,
      },
    ],
  };
}

describe("resolvePackage", () => {
  it("turns a pkg reference back into the original data URI", () => {
    const { template, unresolved } = resolvePackage(buildPackage(templated(PNG)));
    expect(unresolved).toEqual([]);
    expect((template.objects[0] as { src?: string }).src).toBe(PNG);
  });

  it("reports a reference that points at nothing instead of throwing", () => {
    const pkg = buildPackage(templated(PNG));
    const { template, unresolved } = resolvePackage({ ...pkg, files: new Map() });
    expect(unresolved).toEqual(["assets/obj_7.png"]);
    // Left in place rather than dropped, so a later render records a refusal
    // naming the file instead of silently losing the part.
    expect((template.objects[0] as { src?: string }).src).toBe("pkg://assets/obj_7.png");
  });

  it("never leaves a pkg reference inside rendered output", () => {
    const { template } = resolvePackage({
      ...buildPackage(templated(PNG)),
      files: new Map(),
    });
    expect(renderHtml(template).html).not.toContain("pkg://");
  });

  it("leaves a remote https image src alone", () => {
    const { template } = resolvePackage(buildPackage(templated("https://example.com/a.png")));
    expect((template.objects[0] as { src?: string }).src).toBe("https://example.com/a.png");
  });

  it("does not mutate the package it was given", () => {
    const pkg = buildPackage(templated(PNG));
    const read = () => new TextDecoder().decode(pkg.files.get("template.json")!);
    const before = read();
    resolvePackage(pkg);
    expect(read()).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/packageResolve.test.ts`

Expected: FAIL - `@/lib/package/resolve` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `lib/package/resolve.ts`:

```ts
import type { Package } from "@/lib/package/format";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";

import { strFromU8 } from "fflate";

const SCHEME = "pkg://";

declare const btoa: ((s: string) => string) | undefined;

function toDataUri(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return `data:${mime};base64,${typeof btoa === "function" ? btoa(binary) : ""}`;
}

/**
 * Turn a package back into the plain `BillTemplate` the renderer expects, with
 * `pkg://` asset references replaced by inline data URIs.
 *
 * The asymmetry is deliberate and load-bearing: the package is the *distributable*
 * format while `BillTemplate` with data URIs remains the *in-memory render*
 * format. Because resolution happens here, `renderHtml` and its whole pipeline
 * never learn that packages exist, and its purity guarantee and byte-for-byte
 * goldens keep holding.
 *
 * An unresolved reference is left in place rather than dropped.
 * `lib/render`'s `isSafeImageSrc` rejects the `pkg://` scheme, so the object
 * renders as an empty slot and records a refusal naming the file - a diagnosable
 * failure, where a dropped src is a part that silently disappears.
 */
export function resolvePackage(pkg: Package): { template: BillTemplate; unresolved: string[] } {
  const unresolved: string[] = [];
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();

  const empty: BillTemplate = {
    templateVersion: 1,
    document: { width: 0, height: 0 },
    meta: { name: "", modifiedAt: "" },
    objects: [],
  };

  let template = empty;
  const raw = files.get(pkg?.manifest?.template ?? "template.json");
  if (raw) {
    try {
      template = JSON.parse(strFromU8(raw)) as BillTemplate;
    } catch {
      template = empty;
    }
  }

  const mimeFor = (path: string): string =>
    path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";

  const objects: TemplateObject[] = (Array.isArray(template.objects) ? template.objects : []).map(
    (o) => {
      const src = (o as { src?: unknown }).src;
      if (typeof src !== "string" || !src.startsWith(SCHEME)) return { ...o };
      const path = src.slice(SCHEME.length);
      const bytes = files.get(path);
      if (!bytes) {
        if (!unresolved.includes(path)) unresolved.push(path);
        return { ...o };
      }
      return { ...o, src: toDataUri(bytes, mimeFor(path)) } as TemplateObject;
    },
  );

  return { template: { ...template, objects }, unresolved };
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/packageResolve.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add lib/package/resolve.ts tests/packageResolve.test.ts
git commit -m "feat: resolve package asset references back to data URIs"
```

---

### Task 6: Amount in words

`SUGGESTED_VARIABLES` already lists `amount_in_words` and it is mandatory on Indian bills, but nothing computes it. Hand-written tables, not `Intl` or `toLocaleString`, because the purity test bans both.

**Files:**
- Create: `lib/render/words.ts`
- Create: `tests/words.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `amountToWords(minorUnits: number, scale: number, currency?: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/words.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { amountToWords } from "@/lib/render/words";

describe("amountToWords", () => {
  it("spells out a paise amount", () => {
    expect(amountToWords(100, 2)).toBe("One Rupee");
    expect(amountToWords(1050, 2)).toBe("Ten Rupees Fifty Paise Only");
  });

  it("handles zero", () => {
    expect(amountToWords(0, 2)).toBe("Zero Rupees Only");
  });

  it("handles rupees above ninety-nine", () => {
    expect(amountToWords(123456, 2)).toBe(
      "One Thousand Two Hundred Thirty Four Rupees Fifty Six Paise Only",
    );
  });

  it("groups Indian numbering correctly", () => {
    // 12,34,567.89 is lakh/crore grouping, not Western thousands.
    expect(amountToWords(123456789, 2)).toBe(
      "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Eighty Nine Paise Only",
    );
  });

  it("handles crores", () => {
    expect(amountToWords(10000000, 2)).toBe("One Crore Rupees Only");
  });

  it("honours a zero decimal scale", () => {
    expect(amountToWords(42, 0)).toBe("Forty Two Rupees Only");
  });

  it("uses the currency it is given", () => {
    expect(amountToWords(100, 2, "USD")).toBe("One Dollar Only");
  });

  it("never produces an empty string for a negative amount", () => {
    expect(amountToWords(-100, 2).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/words.test.ts`

Expected: FAIL - `@/lib/render/words` does not exist.

- [ ] **Step 3: Implement the converter**

Create `lib/render/words.ts`:

```ts
/**
 * Spell a money amount out in words.
 *
 * Hand-written tables rather than `Intl.NumberFormat`, because `Intl` and
 * `toLocaleString` are both banned by the `lib/render` purity test: the renderer
 * has to survive runtimes where neither exists, which is the same reason
 * `sha256.ts` avoids `crypto.subtle`.
 *
 * Grouping follows the Indian system (crore / lakh / thousand), because these
 * are Indian bills and `amount_in_words` is a mandatory field on them.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const CURRENCY: Record<string, { major: string; minor: string }> = {
  inr: { major: "Rupee", minor: "Paise" },
  usd: { major: "Dollar", minor: "Cent" },
  eur: { major: "Euro", minor: "Cent" },
  gbp: { major: "Pound", minor: "Penny" },
};

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  return `${TENS[Math.floor(n / 10)] ?? ""}${n % 10 ? ` ${ONES[n % 10]}` : ""}`.trim();
}

function under1000(n: number): string {
  const head = Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : "";
  const tail = under100(n % 100);
  return [head, tail].filter(Boolean).join(" ");
}

/** Indian grouping: crore (10^7), lakh (10^5), thousand (10^3). */
function groupWords(n: number): string {
  if (n <= 0) return "";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${groupWords(crore)} Crore` : "",
    lakh ? `${under100(lakh)} Lakh` : "",
    thousand ? `${under100(thousand)} Thousand` : "",
    rest ? under1000(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/**
 * `minorUnits` is an integer count of the smallest currency unit, so the
 * arithmetic stays exact. `scale` is how many decimal places that unit carries.
 */
export function amountToWords(minorUnits: number, scale: number, currency?: string): string {
  const safe = Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;
  const names = CURRENCY[(currency ?? "inr").toLowerCase()] ?? { major: "Unit", minor: "Cent" };
  const n = Math.abs(Math.round(minorUnits));

  let majorUnits = n;
  let minorPart = 0;
  if (safe > 0) {
    const divisor = 10 ** safe;
    majorUnits = Math.floor(n / divisor);
    minorPart = n % divisor;
  }

  const pieces: string[] = [];
  if (minorUnits < 0) pieces.push("Minus");
  if (majorUnits === 0 && minorPart === 0) {
    pieces.push(`Zero ${names.major}s Only`);
  } else {
    if (majorUnits > 0) pieces.push(`${groupWords(majorUnits)} ${plural(names.major, majorUnits)}`);
    if (minorPart > 0) pieces.push(`${under1000(minorPart)} ${plural(names.minor, minorPart)}`);
    pieces.push("Only");
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/words.test.ts`

Expected: PASS, 8 tests. If the lakh/crore case disagrees, verify by hand that `12345678` reads "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight" and fix the expectation only if the implementation is right.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. The purity test must still pass: `words.ts` uses no banned token.

- [ ] **Step 6: Commit**

```powershell
git add lib/render/words.ts tests/words.test.ts
git commit -m "feat: spell money amounts out in words"
```

---

### Task 7: Computed totals in integer minor units

Money in floating point loses whole paise: `0.1 + 0.2` is `0.30000000000000004`, and a bill off by a paisa is a bill a customer notices. Everything here is integer arithmetic; parsing is exact string handling, never `parseFloat`.

**Files:**
- Create: `lib/render/computed.ts`
- Create: `tests/computed.test.ts`

**Interfaces:**
- Consumes: `ComputedSpec` from `@/lib/package/format`; `Values` from `@/lib/render/values`.
- Produces: `parseMinorUnits(value: unknown, scale: number): number`, `formatMinorUnits(minorUnits: number, scale: number): string`, `itemsOf(values: Values, key: string): Record<string, unknown>[]`, `computeAll(specs: readonly ComputedSpec[], values: Values, scale: number): Record<string, string>`

- [ ] **Step 1: Write the failing test**

Create `tests/computed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  computeAll,
  formatMinorUnits,
  itemsOf,
  parseMinorUnits,
} from "@/lib/render/computed";

const v = (o: Record<string, unknown>) => o as Record<string, string>;

describe("parseMinorUnits", () => {
  it("reads a decimal string exactly", () => {
    expect(parseMinorUnits("19.99", 2)).toBe(1999);
  });

  it("reads an integer string", () => {
    expect(parseMinorUnits("20", 2)).toBe(2000);
  });

  it("pads a short fraction", () => {
    expect(parseMinorUnits("5.5", 2)).toBe(550);
  });

  it("treats a missing or unusable value as zero", () => {
    expect(parseMinorUnits(undefined, 2)).toBe(0);
    expect(parseMinorUnits("", 2)).toBe(0);
    expect(parseMinorUnits("abc", 2)).toBe(0);
  });

  it("does not go through a float", () => {
    // parseFloat("1.005") * 100 is 100.49999999999999. Exact string handling
    // rounds the half up at the declared scale instead.
    expect(parseMinorUnits("1.005", 2)).toBe(101);
    expect(Number.isSafeInteger(parseMinorUnits("0.07", 2))).toBe(true);
  });

  it("tolerates thousands separators", () => {
    expect(parseMinorUnits("1,23,456.78", 2)).toBe(12345678);
  });
});

describe("formatMinorUnits", () => {
  it("renders two decimals", () => {
    expect(formatMinorUnits(1999, 2)).toBe("19.99");
  });

  it("shows decimals on a whole amount", () => {
    expect(formatMinorUnits(2000, 2)).toBe("20.00");
  });

  it("renders a zero scale without a point", () => {
    expect(formatMinorUnits(42, 0)).toBe("42");
  });
});

describe("itemsOf", () => {
  it("reads the JSON array a host passes for a repeat key", () => {
    expect(itemsOf(v({ items: '[{"a":1}]' }), "items")).toEqual([{ a: 1 }]);
  });

  it("returns an empty list for anything unusable", () => {
    expect(itemsOf(v({ items: "nope" }), "items")).toEqual([]);
    expect(itemsOf(v({}), "items")).toEqual([]);
  });
});

describe("computeAll", () => {
  it("sums a column across items", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"amount":"100.00"},{"amount":"250.50"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "350.50" });
  });

  it("multiplies then sums, which is what a rate column needs", () => {
    expect(
      computeAll(
        [{ key: "total", op: "sum-times", args: ["items.qty", "items.rate"] }],
        v({ items: '[{"qty":"3","rate":"10.00"},{"qty":"2","rate":"7.25"}]' }),
        2,
      ),
    ).toEqual({ total: "44.50" });
  });

  it("adds flat values", () => {
    expect(
      computeAll([{ key: "total", op: "add", args: ["a", "b"] }], v({ a: "10.00", b: "5.25" }), 2),
    ).toEqual({ total: "15.25" });
  });

  it("applies a percentage rate", () => {
    expect(
      computeAll(
        [{ key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" }],
        v({ subtotal: "200.00", tax_rate: "18" }),
        2,
      ),
    ).toEqual({ tax: "36.00" });
  });

  it("resolves a chain, because specs are applied in order", () => {
    expect(
      computeAll(
        [
          { key: "subtotal", op: "sum", args: ["items.amount"] },
          { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
          { key: "total", op: "add", args: ["subtotal", "tax"] },
        ],
        v({ items: '[{"amount":"1000.00"}]', tax_rate: "18" }),
        2,
      ),
    ).toEqual({ subtotal: "1000.00", tax: "180.00", total: "1180.00" });
  });

  it("sums a missing column as zero rather than NaN", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"other":"5.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "0.00" });
  });

  it("is exact where float arithmetic would drift", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"amount":"0.10"},{"amount":"0.20"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "0.30" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/computed.test.ts`

Expected: FAIL - `@/lib/render/computed` does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/render/computed.ts`:

```ts
/**
 * Computed totals for a filled bill.
 *
 * Every value is an integer count of the smallest currency unit from the moment
 * it is read to the moment it is formatted. Money in floating point loses whole
 * paise, so parsing is exact string handling and never `parseFloat`, and
 * `Number.isSafeInteger` guards the one place a huge input could exceed what a
 * JS number represents exactly.
 *
 * Pure: no clock, no locale, no network.
 */

import type { ComputedSpec } from "@/lib/package/format";

import type { Values } from "./values";

const safeScale = (scale: number): number =>
  Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;

/**
 * Read a decimal string into minor units.
 *
 * The fraction is padded or truncated to `scale` digits and concatenated onto the
 * integer part as text, so `19.99` becomes `1999` without ever being a float. A
 * half rounds up, which is the convention a customer expects on a rounded bill.
 */
export function parseMinorUnits(value: unknown, scale: number): number {
  const s = safeScale(scale);
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 10 ** s) : 0;
  }
  if (typeof value !== "string") return 0;

  const trimmed = value.trim().replace(/,/g, "").replace(/^[^0-9.-]+/, "");
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] && match[2].length > 0 ? match[2] : "0";
  const fracPart = match[3] ?? "";

  let digits: string;
  if (fracPart.length > s) {
    // More decimals than the scale allows: round on the first dropped digit.
    const kept = fracPart.slice(0, s).padEnd(s, "0");
    const next = Number(fracPart[s] ?? "0");
    const base = Number(s === 0 ? whole : `${whole}${kept}`) || 0;
    return sign * (next >= 5 ? base + 1 : base);
  }
  const padded = fracPart.padEnd(s, "0");
  digits = s === 0 ? whole : `${whole}${padded}`;

  const n = Number(digits);
  return Number.isSafeInteger(n) ? sign * n : 0;
}

export function formatMinorUnits(minorUnits: number, scale: number): string {
  const s = safeScale(scale);
  const n = Math.abs(Math.round(minorUnits));
  const sign = minorUnits < 0 ? "-" : "";
  if (s === 0) return `${sign}${n}`;
  const divisor = 10 ** s;
  return `${sign}${Math.floor(n / divisor)}.${String(n % divisor).padStart(s, "0")}`;
}

/** The rows a host passed for a repeat key, as a plain array. */
export function itemsOf(values: Values, key: string): Record<string, unknown>[] {
  const raw = values[key];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && !Array.isArray(r),
    );
  } catch {
    return [];
  }
}

interface RowCache {
  rows: Record<string, Record<string, unknown>[]>;
}

const cache = new WeakMap<object, RowCache>();

function rowsFor(values: Values, repeatKey: string): Record<string, unknown>[] {
  let entry = cache.get(values as unknown as object);
  if (!entry) {
    entry = { rows: {} };
    cache.set(values as unknown as object, entry);
  }
  if (!entry.rows[repeatKey]) entry.rows[repeatKey] = itemsOf(values, repeatKey);
  return entry.rows[repeatKey]!;
}

const has = (o: Record<string, number>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** A flat key: an already-computed value first, then the supplied values. */
function flat(arg: string, values: Values, numeric: Record<string, number>, s: number): number {
  if (has(numeric, arg)) return numeric[arg]!;
  return parseMinorUnits(values[arg], s);
}

/** One cell of a dotted arg at a given row index. */
function cell(
  arg: string,
  values: Values,
  numeric: Record<string, number>,
  s: number,
  row: Record<string, unknown> | undefined,
): number {
  const dot = arg.indexOf(".");
  if (dot <= 0) return row ? parseMinorUnits(row[arg], s) : flat(arg, values, numeric, s);
  return parseMinorUnits(row?.[arg.slice(dot + 1)], s);
}

const split = (arg: string): [string, string] => {
  const dot = arg.indexOf(".");
  return dot > 0 ? [arg.slice(0, dot), arg.slice(dot + 1)] : ["", arg];
};

/**
 * Apply `specs` in order, so a later spec can read an earlier spec's key. Each
 * result is a formatted decimal string, ready to drop into the values map that
 * `renderHtml` consumes.
 */
export function computeAll(
  specs: readonly ComputedSpec[],
  values: Values,
  scale: number,
): Record<string, string> {
  const s = safeScale(scale);
  const numeric: Record<string, number> = {};
  const out: Record<string, string> = {};

  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string" || spec.key.length === 0) continue;
    const args = Array.isArray(spec.args) ? spec.args.filter((a) => typeof a === "string") : [];
    let result = 0;

    switch (spec.op) {
      case "sum": {
        for (const arg of args) {
          const [repeatKey] = split(arg);
          if (repeatKey) {
            for (const row of rowsFor(values, repeatKey)) result += cell(arg, values, numeric, s, row);
          } else {
            result += flat(arg, values, numeric, s);
          }
        }
        break;
      }
      case "sum-times": {
        const [a, b] = args;
        if (a && b) {
          const [aKey] = split(a);
          const [bKey] = split(b);
          const aRows = aKey ? rowsFor(values, aKey) : [];
          const bRows = bKey ? rowsFor(values, bKey) : [];
          // One row per item of whichever side repeats; when both are flat this
          // is a single product, which is what a bare `sum-times` means.
          const count = Math.max(aRows.length, bRows.length, aKey || bKey ? 0 : 1);
          for (let i = 0; i < count; i += 1) {
            const av = cell(a, values, numeric, s, aRows[i]);
            const bv = cell(b, values, numeric, s, bRows[i]);
            result += av * bv;
          }
        }
        break;
      }
      case "add":
      case "subtract":
      case "multiply": {
        const nums = args.map((a) => flat(a, values, numeric, s));
        if (nums.length > 0) result = nums[0]!;
        for (let i = 1; i < nums.length; i += 1) {
          if (spec.op === "add") result += nums[i]!;
          else if (spec.op === "subtract") result -= nums[i]!;
          else result *= nums[i]!;
        }
        break;
      }
      case "percent": {
        const base = args.length > 0 ? flat(args[0]!, values, numeric, s) : 0;
        // The rate is read at scale 6 so `18.5` and `18.500000` both work.
        const rate = spec.rateKey ? parseMinorUnits(values[spec.rateKey], 6) : 0;
        result = Math.round((base * rate) / 1000000);
        break;
      }
      default:
        result = 0;
    }
    numeric[spec.key] = result;
    out[spec.key] = formatMinorUnits(result, s);
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/computed.test.ts`

Expected: PASS, 16 tests. If `sum-times` disagrees on `44.50`, check the product is `minorQty * minorRate` and re-scaled by `10^scale`.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add lib/render/computed.ts tests/computed.test.ts
git commit -m "feat: computed totals in exact integer minor units"
```

---

### Task 8: Expand a repeat band into rows

**Files:**
- Create: `lib/render/repeat.ts`
- Create: `tests/repeat.test.ts`

**Interfaces:**
- Consumes: `TableObject`, `TableCell`, `TemplateObject` from `@/lib/template/types`; `itemsOf` from `@/lib/render/computed`; `Values` from `@/lib/render/values`.
- Produces: `expandRepeats(objects: readonly TemplateObject[], values: Values, pageHeight: number): { objects: TemplateObject[]; warnings: string[] }` and `resolveScoped(text: string, item: Record<string, unknown>, values: Values): string`

- [ ] **Step 1: Write the failing test**

Create `tests/repeat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { expandRepeats, resolveScoped } from "@/lib/render/repeat";
import type { TableCell, TableObject } from "@/lib/template/types";

const cell = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

function table(over: Partial<TableObject> = {}): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 10,
    y: 100,
    width: 400,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    parentId: null,
    stroke: "",
    strokeWidth: 0,
    fill: "",
    rows: 3,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 20, 20],
    cells: [
      cell("Item"),
      cell("Amount"),
      cell("{{description}}"),
      cell("{{amount}}"),
      cell("Total"),
      cell("{{total}}"),
    ],
    borderColor: "#000",
    borderWidth: 1,
    cellFill: "",
    headerRow: true,
    headerFill: "",
    headerTextColor: "",
    cellTextColor: "",
    padding: 2,
    fontFamily: "Arial",
    repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 100 },
    ...over,
  } as TableObject;
}

const v = (o: Record<string, unknown>) => o as Record<string, string>;
const texts = (o: TableObject) => o.cells.map((c) => c.text);

describe("resolveScoped", () => {
  it("prefers the item over the flat values", () => {
    expect(resolveScoped("{{amount}}", { amount: "9.99" }, v({ amount: "1.00" }))).toBe("9.99");
  });

  it("falls back to the flat values", () => {
    expect(resolveScoped("{{total}}", { amount: "1" }, v({ total: "12.00" }))).toBe("12.00");
  });

  it("stringifies a numeric item value", () => {
    expect(resolveScoped("{{qty}}", { qty: 3 }, v({}))).toBe("3");
  });

  it("leaves an unknown token literally in place", () => {
    expect(resolveScoped("{{nope}}", {}, v({}))).toBe("{{nope}}");
  });
});

describe("expandRepeats", () => {
  const twoItems = v({
    items: '[{"description":"A","amount":"1.00"},{"description":"B","amount":"2.00"}]',
  });

  it("clones the band once per item", () => {
    const { objects } = expandRepeats([table()], twoItems, 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(4);
    expect(texts(t)).toEqual([
      "Item", "Amount",
      "A", "1.00",
      "B", "2.00",
      "Total", "{{total}}",
    ]);
  });

  it("grows the row heights by the band template height per item", () => {
    const { objects } = expandRepeats([table()], twoItems, 1123);
    const t = objects[0] as TableObject;
    expect(t.rowHeights).toEqual([20, 20, 20, 20]);
    expect(t.height).toBe(80);
  });

  it("collapses the band to nothing for an empty item list", () => {
    const { objects } = expandRepeats([table()], v({ items: "[]" }), 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(2);
    expect(texts(t)).toEqual(["Item", "Amount", "Total", "{{total}}"]);
  });

  it("collapses the band and warns for unparseable items", () => {
    const { objects, warnings } = expandRepeats([table()], v({ items: "not json" }), 1123);
    expect((objects[0] as TableObject).rows).toBe(2);
    expect(warnings.join(" ")).toMatch(/items/);
  });

  it("clamps to maxItems and says so", () => {
    const many = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ description: `d${i}`, amount: "1.00" })),
    );
    const { objects, warnings } = expandRepeats(
      [table({ repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 3 } })],
      v({ items: many }),
      1123,
    );
    expect((objects[0] as TableObject).rows).toBe(4);
    expect(warnings.join(" ")).toMatch(/3/);
  });

  it("warns when the grown table would run off the page", () => {
    const many = Array.from({ length: 20 }, () => ({ amount: "1.00" }));
    const { warnings } = expandRepeats([table({ y: 1100 })], v({ items: JSON.stringify(many) }), 1123);
    expect(warnings.join(" ")).toMatch(/off the page/i);
  });

  it("supports a band spanning more than one row", () => {
    const tall = table({
      rows: 4,
      rowHeights: [20, 20, 20, 20],
      cells: [
        cell("H1"), cell("H2"),
        cell("{{description}}"), cell("A"),
        cell("{{description}}"), cell("B"),
        cell("Total"), cell("{{total}}"),
      ],
      repeat: { startRow: 1, endRow: 2, key: "items", maxItems: 100 },
    });
    const { objects } = expandRepeats([tall], v({ items: '[{"description":"A"}]' }), 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(4);
    expect(texts(t)).toEqual(["H1", "H2", "A", "A", "A", "B", "Total", "{{total}}"]);
  });

  it("leaves a table with no repeat band exactly as it was", () => {
    const original = table({ repeat: undefined });
    const { objects, warnings } = expandRepeats([original], v({ items: "[{}]" }), 1123);
    expect(objects[0]).toBe(original);
    expect(warnings).toEqual([]);
  });

  it("ignores a band whose rows are out of range", () => {
    const bad = table({ repeat: { startRow: 2, endRow: 9, key: "items", maxItems: 10 } });
    const { objects, warnings } = expandRepeats([bad], v({ items: "[{}]" }), 1123);
    expect(objects[0]).toBe(bad);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("leaves non-table objects alone", () => {
    const line = { id: "l1", type: "line", x: 0, y: 0, height: 0 } as never;
    expect(expandRepeats([line], v({ items: "[{}]" }), 1123).objects[0]).toBe(line);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/repeat.test.ts`

Expected: FAIL - `@/lib/render/repeat` does not exist.

- [ ] **Step 3: Implement the expansion**

Create `lib/render/repeat.ts`:

```ts
/**
 * Expand a table's repeat band into real rows, one set per item.
 *
 * This runs as a pre-pass over the object list, before `renderObject` sees
 * anything. That is deliberate: the renderer learns nothing about repeating
 * bands, so its purity guarantee and its byte-for-byte goldens are untouched by
 * this feature.
 *
 * Resolution inside a band prefers the item over the flat values, so
 * `{{amount}}` means `item.amount` inside the band and the global `amount`
 * outside it. Band content is cloned, never drawn as it stands.
 */

import type { TableCell, TableObject, TemplateObject } from "@/lib/template/types";

import { itemsOf } from "./computed";
import type { Values } from "./values";

/** Same grammar as `TOKEN_SOURCE` in `lib/render/values`. A fresh regex per use. */
const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

const tokenRegex = (): RegExp => new RegExp(TOKEN_SOURCE, "g");

export function resolveScoped(
  text: string,
  item: Record<string, unknown>,
  values: Values,
): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    const local = item[key];
    if (typeof local === "string") return local;
    if (typeof local === "number" && Number.isFinite(local)) return String(local);
    const global = values[key];
    return typeof global === "string" ? global : token;
  });
}

interface Band {
  startRow: number;
  endRow: number;
  key: string;
  maxItems: number;
}

const DEFAULT_MAX_ITEMS = 200;

/**
 * The band, or null when the table has none or the one it has cannot apply.
 * Rejecting rather than repairing is deliberate: a band that does not fit its
 * table would otherwise be silently ignored, and the author would never learn
 * why their rows did not repeat.
 */
function bandOf(o: TableObject): { band: Band; why: string | null } | null {
  const r = o.repeat as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  const { startRow, endRow, key } = r;
  const rows = typeof o.rows === "number" && Number.isInteger(o.rows) ? o.rows : 0;
  const problem = (why: string): { band: Band; why: string } => ({
    band: { startRow: 0, endRow: 0, key: "", maxItems: DEFAULT_MAX_ITEMS },
    why,
  });

  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) {
    return problem("first row is not a row index");
  }
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) {
    return problem("last row comes before the first");
  }
  if (rows <= 0 || endRow >= rows) return problem("last row is past the end of the table");
  if (typeof key !== "string" || key.trim().length === 0) return problem("no items key");

  const maxItems =
    typeof r.maxItems === "number" && Number.isInteger(r.maxItems) && r.maxItems > 0
      ? r.maxItems
      : DEFAULT_MAX_ITEMS;
  return {
    band: { startRow, endRow, key: key.trim(), maxItems },
    why: null,
  };
}

function expandTable(
  o: TableObject,
  values: Values,
  pageHeight: number,
): { table: TemplateObject; warnings: string[] } {
  const found = bandOf(o);
  if (!found) return { table: o, warnings: [] };
  const { band, why } = found;

  const warnings: string[] = [];
  if (why) {
    warnings.push(`table "${o.name}" has a repeat band that was ignored: ${why}`);
    return { table: o, warnings };
  }

  const columns = typeof o.columns === "number" && o.columns > 0 ? o.columns : 1;
  const raw = values[band.key];
  const items = itemsOf(values, band.key);

  if (typeof raw === "string" && raw.length > 0 && items.length === 0) {
    warnings.push(
      `table "${o.name}" could not read any items from ${band.key}; the repeating rows were dropped`,
    );
  }

  let used = items;
  if (items.length > band.maxItems) {
    warnings.push(
      `table "${o.name}" received ${items.length} items but ${band.key} is capped at ${band.maxItems}; the extra rows were not drawn`,
    );
    used = items.slice(0, band.maxItems);
  }

  const cells = Array.isArray(o.cells) ? o.cells : [];
  const heights = Array.isArray(o.rowHeights) ? o.rowHeights : [];
  const rows = typeof o.rows === "number" ? o.rows : 0;
  const at = (r: number, c: number): TableCell =>
    cells[r * columns + c] ?? { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" };

  const newCells: TableCell[] = [];
  const newHeights: number[] = [];

  for (let r = 0; r < band.startRow; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }
  for (const item of used) {
    for (let r = band.startRow; r <= band.endRow; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const src = at(r, c);
        newCells.push({ ...src, text: resolveScoped(src.text ?? "", item, values) });
      }
      newHeights.push(heights[r] ?? 0);
    }
  }
  for (let r = band.endRow + 1; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }

  const height = newHeights.reduce((a, b) => a + b, 0);
  const top = typeof o.top === "number" ? o.top : 0;
  if (Number.isFinite(pageHeight) && pageHeight > 0 && top + height > pageHeight) {
    warnings.push(
      `table "${o.name}" ends at ${Math.round(top + height)} but the page is ${Math.round(pageHeight)} tall; the last rows will print off the page`,
    );
  }

  return {
    table: {
      ...o,
      rows: newHeights.length,
      rowHeights: newHeights,
      cells: newCells,
      height,
      repeat: undefined,
    } as TableObject,
    warnings,
  };
}

/**
 * Expand every repeating band in `objects`.
 *
 * Warnings are returned rather than thrown: a bill with more items than the page
 * can hold is something the caller can show and fix, not a crash. Silently
 * clipping it is the failure this exists to prevent.
 */
export function expandRepeats(
  objects: readonly TemplateObject[],
  values: Values,
  pageHeight: number,
): { objects: TemplateObject[]; warnings: string[] } {
  const warnings: string[] = [];
  const out = objects.map((o) => {
    if (o.type !== "table") return o;
    const { table, warnings: w } = expandTable(o, values, pageHeight);
    warnings.push(...w);
    return table;
  });
  return { objects: out, warnings };
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/repeat.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add lib/render/repeat.ts tests/repeat.test.ts
git commit -m "feat: expand repeat bands into rows, one set per item"
```

---

### Task 9: A repeat band survives save and reload

Without this the band is authored, then silently disappears the next time the template is saved, because `serialiseTable` and `hydrateTable` know nothing about it.

**Files:**
- Modify: `lib/template/types.ts`
- Modify: `lib/template/serialize.ts`
- Modify: `lib/template/hydrate.ts`
- Modify: `lib/canvas/objects/BillTable.ts`
- Create: `tests/repeatSerialise.test.ts`

**Interfaces:**
- Consumes: `TableRepeat` from `@/lib/template/types`.
- Produces: `repeat` present on a serialised table, restored on hydration, and carried on the `BillTable` canvas class.

- [ ] **Step 1: Write the failing test**

Create `tests/repeatSerialise.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObject } from "@/lib/template/serialize";
import type { BillTemplate } from "@/lib/template/types";

const repeat = { startRow: 1, endRow: 2, key: "items", repeatHeader: true, maxItems: 40 };

function fake(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    appType: "table",
    type: "BillTable",
    name: "Items",
    role: null,
    left: 0,
    top: 0,
    width: 400,
    height: 80,
    angle: 0,
    opacity: 1,
    visible: true,
    locked: false,
    stroke: "#000",
    strokeWidth: 1,
    fill: "",
    zIndex: 0,
    rows: 4,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 20, 20, 20],
    cells: [],
    borderColor: "#000",
    borderWidth: 1,
    cellFill: "",
    headerRow: true,
    headerFill: "",
    headerTextColor: "",
    cellTextColor: "",
    padding: 2,
    fontFamily: "Arial",
    repeat,
    ...over,
  } as never;
}

describe("serialising a repeat band", () => {
  it("carries the band onto the template object", () => {
    expect((serialiseObject(fake(), 0) as unknown as Record<string, unknown>).repeat).toEqual(repeat);
  });

  it("omits repeat entirely when the table has none", () => {
    const out = serialiseObject(fake({ repeat: undefined }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("drops a band with an unusable key rather than writing a broken one", () => {
    const out = serialiseObject(fake({ repeat: { startRow: 1, endRow: 1, key: "" } }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("drops a band whose rows are inverted", () => {
    const out = serialiseObject(fake({ repeat: { startRow: 3, endRow: 1, key: "items" } }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("defaults maxItems when the author left it blank", () => {
    const out = serialiseObject(
      fake({ repeat: { startRow: 1, endRow: 1, key: "items" } }),
      0,
    ) as unknown as { repeat?: { maxItems?: number } };
    expect(out.repeat?.maxItems).toBe(200);
  });
});

describe("hydrating a repeat band", () => {
  it("restores the band when a template is loaded", () => {
    const tpl = {
      templateVersion: 2,
      document: { width: 794, height: 1123 },
      meta: { name: "T", modifiedAt: "2026-10-08T00:00:00.000Z" },
      objects: [
        {
          id: "t1",
          type: "table",
          name: "Items",
          role: null,
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 0,
          parentId: null,
          stroke: "",
          strokeWidth: 0,
          fill: "",
          rows: 4,
          columns: 2,
          colWidths: [200, 200],
          rowHeights: [20, 20, 20, 20],
          cells: [],
          borderColor: "#000",
          borderWidth: 1,
          cellFill: "",
          headerRow: true,
          headerFill: "",
          headerTextColor: "",
          cellTextColor: "",
          padding: 2,
          fontFamily: "Arial",
          repeat,
        },
      ],
    };
    const objects = hydrateTemplate(tpl as unknown as BillTemplate);
    expect((objects[0] as { repeat?: unknown }).repeat).toEqual(repeat);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/repeatSerialise.test.ts`

Expected: FAIL - the serialised table has no `repeat`.

- [ ] **Step 3: Serialise the band**

In `lib/template/serialize.ts`, add `TableRepeat` to the type imports from `@/lib/template/types`, then add this helper above `serialiseTable`:

```ts
/**
 * A band that cannot identify its items would produce a table with no repeating
 * rows and no explanation, so it is dropped rather than written. The same shape
 * is checked again on hydration and again in the renderer, because a package can
 * be assembled from files this editor never saw.
 */
function serialiseRepeat(raw: unknown): TableRepeat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const key = r.key;
  if (typeof key !== "string" || key.trim().length === 0) return undefined;
  const startRow = r.startRow;
  const endRow = r.endRow;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return undefined;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return undefined;
  const maxItems =
    typeof r.maxItems === "number" && Number.isInteger(r.maxItems) && r.maxItems > 0
      ? r.maxItems
      : 200;
  return {
    startRow,
    endRow,
    key: key.trim(),
    ...(r.repeatHeader === true ? { repeatHeader: true } : {}),
    maxItems,
  };
}
```

At the top of `serialiseTable`, add:

```ts
  const repeat = serialiseRepeat((o as unknown as { repeat?: unknown }).repeat);
```

And add `...(repeat ? { repeat } : {}),` as the last property of the object literal `serialiseTable` returns.

- [ ] **Step 4: Carry the band on the canvas class**

In `lib/canvas/objects/BillTable.ts`:

1. Add `repeat?: TableRepeat;` to the `BillTableSpec` interface.
2. Add `  repeat?: TableRepeat;` as a field on the class.
3. Add `TableRepeat` to the type imports from `@/lib/template/types`.
4. In the constructor, after the existing `this.rowHeights = rowHeights;`, add:

```ts
    this.repeat = merged.repeat;
```

- [ ] **Step 5: Hydrate the band**

In `lib/template/hydrate.ts`, inside `hydrateTable`, add `repeat: o.repeat,` to the object passed into the `BillTable` construction.

- [ ] **Step 6: Run the test**

Run: `npx.cmd vitest run tests/repeatSerialise.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. All existing table-resize and table-grid tests must still pass: adding a field to `BillTable` must not change its geometry.

- [ ] **Step 8: Commit**

```powershell
git add lib/template/types.ts lib/template/serialize.ts lib/template/hydrate.ts lib/canvas/objects/BillTable.ts tests/repeatSerialise.test.ts
git commit -m "feat: a repeat band survives save and reload"
```

---

### Task 10: Wire expansion and computed values into `renderHtml`

One pre-pass and one extra return field. `renderObject` and the whole rendering path stay untouched.

**Files:**
- Modify: `lib/render/index.ts`
- Create: `tests/renderRepeats.test.ts`

**Interfaces:**
- Consumes: `expandRepeats` from `@/lib/render/repeat`; `computeAll` from `@/lib/render/computed`; `ComputedSpec` from `@/lib/package/format`; `Values` from `@/lib/render/values`.
- Produces: `RenderResult.warnings: string[]`; `RenderOptions.computed?: readonly ComputedSpec[]` and `RenderOptions.currencyScale?: number`

- [ ] **Step 1: Write the failing test**

Create `tests/renderRepeats.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

function banded(): BillTemplate {
  const cells: TableCell[] = [];
  const push = (a: string, b: string) => {
    cells.push({ text: a, textAlign: "left", fontSize: 10, fontWeight: "normal" });
    cells.push({ text: b, textAlign: "left", fontSize: 10, fontWeight: "normal" });
  };
  push("Item", "Amount");
  push("{{description}}", "{{amount}}");
  push("Total", "{{total}}");

  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Invoice", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "t1",
        type: "table",
        name: "Items",
        role: null,
        x: 10,
        y: 100,
        width: 400,
        height: 60,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        rows: 3,
        columns: 2,
        colWidths: [200, 200],
        rowHeights: [20, 20, 20],
        cells,
        borderColor: "#000",
        borderWidth: 1,
        cellFill: "",
        headerRow: true,
        headerFill: "",
        headerTextColor: "",
        cellTextColor: "",
        padding: 2,
        fontFamily: "Arial",
        repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 100 },
      } as unknown as TableObject,
    ],
  };
}

const values = (items: Record<string, string>[]) => ({ items: JSON.stringify(items) });
const twoItems = values([
  { description: "Wheat", amount: "100.00" },
  { description: "Rice", amount: "250.50" },
]);

describe("renderHtml with repeat bands", () => {
  it("draws one row per item", () => {
    const { html } = renderHtml(banded(), twoItems);
    expect(html).toContain("Wheat");
    expect(html).toContain("Rice");
    expect(html).toContain("250.50");
  });

  it("computes a total from the items when asked", () => {
    const { html } = renderHtml(banded(), twoItems, {
      computed: [
        { key: "subtotal", op: "sum", args: ["items.amount"] },
        { key: "total", op: "add", args: ["subtotal"] },
      ],
    });
    expect(html).toContain("350.50");
  });

  it("reports an overflow as a warning rather than clipping silently", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `d${i}`,
      amount: "1.00",
    }));
    const tpl = banded();
    (tpl.objects[0] as unknown as TableObject).y = 1000;
    expect(renderHtml(tpl, values(many)).warnings.join(" ")).toMatch(/off the page/i);
  });

  it("produces no warnings for a short bill", () => {
    expect(renderHtml(banded(), values([{ description: "A", amount: "1.00" }])).warnings).toEqual(
      [],
    );
  });

  it("leaves the fingerprint describing the template, not the data", () => {
    const hash = (h: string) => /data-template-hash="([^"]+)"/.exec(h)?.[1];
    const a = renderHtml(banded(), values([{ description: "A", amount: "1.00" }]));
    const b = renderHtml(banded(), values([{ description: "B", amount: "9.00" }]));
    expect(hash(a.html)).toBe(hash(b.html));
  });

  it("still reports the band's columns as variables the template needs", () => {
    const { variables } = renderHtml(banded(), values([{ description: "A", amount: "1.00" }]));
    expect(variables).toContain("description");
    expect(variables).toContain("amount");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/renderRepeats.test.ts`

Expected: FAIL - `RenderResult` has no `warnings`, and "Wheat" is absent because nothing expands the band.

- [ ] **Step 3: Add the options and the warnings field**

In `lib/render/index.ts`, change `RenderOptions`:

```ts
export interface RenderOptions {
  title?: string;
  /** Totals to evaluate before the page is painted. */
  computed?: readonly ComputedSpec[];
  /** Decimal places money is held in. Defaults to 2. */
  currencyScale?: number;
}
```

Add `warnings: string[];` to `RenderResult`.

Add these imports:

```ts
import type { ComputedSpec } from "@/lib/package/format";
import { computeAll } from "./computed";
import { expandRepeats } from "./repeat";
import type { Values } from "./values";
```

- [ ] **Step 4: Wire the pre-pass into `renderHtml`**

Immediately before the existing `const ordered = objects` line, insert:

```ts
  // Repeating bands are expanded before anything is sorted or painted, so the
  // renderer itself stays unaware of them. `values` gains the computed totals
  // first, because a band's trailing total row needs them.
  const enriched: Values = {
    ...values,
    ...computeAll(options.computed ?? [], values, options.currencyScale ?? 2),
  };

  const { objects: expanded, warnings } = expandRepeats(objects, enriched, height);
```

Then change the body render to read from the expanded list:

```ts
  const ordered = expanded
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.zIndex - b.o.zIndex || a.i - b.i);

  const body = ordered
    .map(({ o, i }) => renderObject(o, i, enriched, refusals))
    .filter((s): s is string => typeof s === "string")
    .join("\n");
```

Leave the `hash` and `variables` computation reading the **original** `template` and `objects`. The fingerprint answers "has the layout changed?", which binding data must not alter, and the variable list answers "what does this template ask for", which is a property of the template.

Change the final line to:

```ts
  return { html, refusals: refusals.list(), variables, warnings };
```

- [ ] **Step 5: Run the test**

Run: `npx.cmd vitest run tests/renderRepeats.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. The five `renderGolden` files must be byte-identical, proving the pre-pass is inert for a template with no band.

- [ ] **Step 7: Commit**

```powershell
git add lib/render/index.ts tests/renderRepeats.test.ts
git commit -m "feat: render repeat bands and computed totals through the pure renderer"
```

---

### Task 11: Derive the form schema from a manifest

**Files:**
- Create: `lib/package/form.ts`
- Create: `tests/packageForm.test.ts`

**Interfaces:**
- Consumes: `ComputedSpec`, `ManifestField`, `PackageManifest` from `@/lib/package/format`; `extractVariables` from `@/lib/template/placeholders`; `BillTemplate`, `TableObject` from `@/lib/template/types`.
- Produces: `FormField`, `RepeatFieldSpec`, `FormGroup`, `FormSchema` and `deriveForm(manifest: PackageManifest, template?: BillTemplate): FormSchema` from `@/lib/package/form`

- [ ] **Step 1: Write the failing test**

Create `tests/packageForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { deriveForm } from "@/lib/package/form";
import type { BillTemplate, TableCell } from "@/lib/template/types";

const base = (over: Partial<PackageManifest> = {}): PackageManifest => ({
  packageVersion: PACKAGE_VERSION,
  templateVersion: 2,
  name: "Invoice",
  document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
  template: "template.json",
  assets: [],
  fonts: [],
  fields: [
    { key: "customer_name", label: "Customer", type: "text", source: "text", objectName: "Header" },
    {
      key: "logo",
      label: "Logo",
      type: "image",
      source: "image-placeholder",
      objectName: "Logo",
    },
  ],
  computed: [{ key: "total", op: "sum", args: ["items.amount"] }],
  checksums: {},
  ...over,
});

const c = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

const withBand = (): BillTemplate => ({
  templateVersion: 2,
  document: { width: 794, height: 1123 },
  meta: { name: "Invoice", modifiedAt: "2026-10-08T00:00:00.000Z" },
  objects: [
    {
      id: "t1",
      type: "table",
      name: "Items",
      role: null,
      x: 0,
      y: 0,
      width: 400,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      parentId: null,
      stroke: "",
      strokeWidth: 0,
      fill: "",
      rows: 3,
      columns: 2,
      colWidths: [200, 200],
      rowHeights: [20, 20, 20],
      cells: [c("Item"), c("Amount"), c("{{description}}"), c("{{amount}}"), c("Total"), c("{{total}}")],
      borderColor: "#000",
      borderWidth: 1,
      cellFill: "",
      headerRow: true,
      headerFill: "",
      headerTextColor: "",
      cellTextColor: "",
      padding: 2,
      fontFamily: "Arial",
      repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 30 },
    },
  ],
});

describe("deriveForm", () => {
  it("returns the manifest fields in order", () => {
    expect(deriveForm(base()).fields.map((x) => x.key)).toEqual(["customer_name", "logo"]);
  });

  it("groups fields the way the existing forms do", () => {
    const f = deriveForm(base());
    expect(f.groups.find((g) => g.title === "Text fields")?.fields.map((x) => x.key)).toEqual([
      "customer_name",
    ]);
    expect(f.groups.some((g) => g.title === "Images & signatures")).toBe(true);
  });

  it("groups a field-source field with text, as DynamicForm does", () => {
    // `extractTemplateFields` can report source "field" for a slot placed with
    // the field tool. It belongs under "Text fields" with everything else, not
    // in a group of its own.
    const f = deriveForm(
      base({
        fields: [
          { key: "invoice_no", label: "Invoice no", type: "text", source: "field", objectName: "F" },
        ],
      }),
    );
    expect(f.groups.map((g) => g.title)).toEqual(["Text fields"]);
    expect(f.groups[0]?.fields.map((x) => x.key)).toEqual(["invoice_no"]);
  });

  it("carries validation rules through", () => {
    const f = deriveForm(
      base({
        fields: [
          {
            key: "gstin",
            label: "GSTIN",
            type: "text",
            source: "text",
            objectName: "Header",
            required: true,
            pattern: "^[0-9]{15}$",
            maxLength: 15,
          },
        ],
      }),
    );
    expect(f.fields[0]).toMatchObject({ required: true, pattern: "^[0-9]{15}$", maxLength: 15 });
  });

  it("discovers a repeating group from the template's band", () => {
    expect(deriveForm(base(), withBand()).repeats).toEqual([
      { key: "items", objectName: "Items", columns: ["description", "amount"], maxItems: 30 },
    ]);
  });

  it("adds a field of its own for each band", () => {
    const f = deriveForm(base(), withBand());
    expect(f.fields.find((x) => x.key === "items")).toMatchObject({
      type: "repeating",
      source: "table",
    });
  });

  it("passes the computed specs through", () => {
    expect(deriveForm(base()).computed).toEqual([
      { key: "total", op: "sum", args: ["items.amount"] },
    ]);
  });

  it("does not duplicate a band the manifest already declares", () => {
    const f = deriveForm(
      base({
        fields: [
          {
            key: "items",
            label: "Items",
            type: "repeating",
            source: "table",
            objectName: "Items",
            columns: ["description", "amount"],
          },
        ],
      }),
      withBand(),
    );
    expect(f.fields.filter((x) => x.key === "items")).toHaveLength(1);
  });

  it("never throws on a garbage manifest", () => {
    expect(() => deriveForm(null as never)).not.toThrow();
    expect(deriveForm(null as never).fields).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/packageForm.test.ts`

Expected: FAIL - `@/lib/package/form` does not exist.

- [ ] **Step 3: Implement the derivation**

Create `lib/package/form.ts`:

```ts
/**
 * Derive the input form from a package manifest.
 *
 * This is the promise the package format makes: a host that can read a manifest
 * can show the right form without knowing anything about this editor. Grouping
 * reuses the `source` discriminator both existing forms already group by, so a
 * derived schema and the app's own forms stay recognisably the same thing.
 */

import type { ComputedSpec, ManifestField, PackageManifest } from "@/lib/package/format";
import { extractVariables } from "@/lib/template/placeholders";
import type { BillTemplate, TableObject } from "@/lib/template/types";

export interface FormField {
  key: string;
  label: string;
  type: ManifestField["type"];
  source: ManifestField["source"];
  objectName: string;
  maxLength?: number;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface RepeatFieldSpec {
  key: string;
  objectName: string;
  /** Column keys, in band order. */
  columns: string[];
  maxItems: number;
}

export interface FormGroup {
  title: string;
  fields: FormField[];
}

export interface FormSchema {
  groups: FormGroup[];
  fields: FormField[];
  repeats: RepeatFieldSpec[];
  computed: ComputedSpec[];
}

const GROUP_TITLES: Record<ManifestField["source"], string> = {
  text: "Text fields",
  field: "Text fields",
  table: "Table cells",
  "image-placeholder": "Images & signatures",
};

/** Column keys inside a repeat band, read from the band's own cell tokens. */
function columnsOf(t: TableObject, startRow: number, endRow: number): string[] {
  const columns = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const text = cells[r * columns + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

function repeatsOf(template: BillTemplate | undefined): RepeatFieldSpec[] {
  const out: RepeatFieldSpec[] = [];
  const objects = template && Array.isArray(template.objects) ? template.objects : [];
  for (const o of objects) {
    if (o.type !== "table") continue;
    const band = o.repeat;
    if (!band || typeof band.key !== "string" || band.key.trim().length === 0) continue;
    out.push({
      key: band.key.trim(),
      objectName: o.name,
      columns: columnsOf(o, band.startRow, band.endRow),
      maxItems: typeof band.maxItems === "number" && band.maxItems > 0 ? band.maxItems : 200,
    });
  }
  return out;
}

export function deriveForm(manifest: PackageManifest, template?: BillTemplate): FormSchema {
  const declared: FormField[] = Array.isArray(manifest?.fields)
    ? manifest.fields
        .filter((f): f is ManifestField => Boolean(f) && typeof f.key === "string" && f.key.length > 0)
        .map((f) => ({
          key: f.key,
          label: typeof f.label === "string" && f.label.length > 0 ? f.label : f.key,
          type: f.type,
          source: f.source,
          objectName: typeof f.objectName === "string" ? f.objectName : "",
          ...(typeof f.maxLength === "number" ? { maxLength: f.maxLength } : {}),
          ...(f.required === true ? { required: true } : {}),
          ...(typeof f.pattern === "string" ? { pattern: f.pattern } : {}),
          ...(typeof f.min === "number" ? { min: f.min } : {}),
          ...(typeof f.max === "number" ? { max: f.max } : {}),
          ...(Array.isArray(f.options) ? { options: f.options } : {}),
        }))
    : [];

  const repeats = repeatsOf(template);

  // A band always contributes a field of its own unless the manifest already
  // declares one, so a host that renders only the flat list still shows the line
  // items rather than silently dropping them.
  const fields: FormField[] = [
    ...declared.filter((f) => !repeats.some((r) => r.key === f.key)),
    ...repeats.map((r) => ({
      key: r.key,
      label: r.objectName || r.key,
      type: "repeating" as const,
      source: "table" as const,
      objectName: r.objectName,
    })),
  ];

  // Grouped by title rather than by source, because two sources share one title:
  // `DynamicForm` already puts `text` and `field` together under "Text fields",
  // and a derived schema that split them would not look like the app's own form.
  const order: string[] = ["Text fields", "Table cells", "Images & signatures"];
  const byTitle = new Map<string, FormField[]>();
  for (const f of fields) {
    const title = GROUP_TITLES[f.source] ?? "Other fields";
    const bucket = byTitle.get(title);
    if (bucket) bucket.push(f);
    else byTitle.set(title, [f]);
  }

  const groups: FormGroup[] = [];
  for (const title of order) {
    const bucket = byTitle.get(title);
    if (bucket && bucket.length > 0) groups.push({ title, fields: bucket });
  }
  // Anything whose source is outside the known set is still shown, rather than
  // vanishing from the form.
  for (const [title, bucket] of byTitle) {
    if (!order.includes(title) && bucket.length > 0) groups.push({ title, fields: bucket });
  }

  return {
    groups,
    fields,
    repeats,
    computed: Array.isArray(manifest?.computed) ? manifest.computed : [],
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/packageForm.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add lib/package/form.ts tests/packageForm.test.ts
git commit -m "feat: derive an input form schema from a package manifest"
```

---

### Task 12: Author a band from the editor

Without this an author cannot create a band, so the whole feature is unreachable by hand.

**Files:**
- Create: `lib/canvas/tableRepeat.ts`
- Modify: `lib/canvas/EditorController.ts`
- Modify: `components/editor/PropertiesPanel.tsx`
- Create: `tests/tableRepeat.test.ts`

**Interfaces:**
- Consumes: `TableRepeat` from `@/lib/template/types`; `BillTable` from `@/lib/canvas/objects/BillTable`.
- Produces: `normaliseRepeat(raw: Partial<TableRepeat> | null | undefined, rowCount: number): TableRepeat | null` from `@/lib/canvas/tableRepeat`; `EditorController.setTableRepeat(tableId: string, repeat: Partial<TableRepeat> | null): void`; `EditorState.selectedTable: (TableObject & { repeat?: TableRepeat }) | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/tableRepeat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normaliseRepeat } from "@/lib/canvas/tableRepeat";

describe("normaliseRepeat", () => {
  it("accepts a band inside the table and fills the defaults", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 2, key: "items" }, 4)).toEqual({
      startRow: 1,
      endRow: 2,
      key: "items",
      repeatHeader: false,
      maxItems: 200,
    });
  });

  it("keeps an explicit maxItems and repeatHeader", () => {
    expect(
      normaliseRepeat({ startRow: 0, endRow: 0, key: "items", maxItems: 5, repeatHeader: true }, 2),
    ).toMatchObject({ maxItems: 5, repeatHeader: true });
  });

  it("trims the key", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 1, key: "  items  " }, 4)?.key).toBe("items");
  });

  it("refuses a band past the last row", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 4, key: "items" }, 4)).toBeNull();
  });

  it("refuses an inverted band", () => {
    expect(normaliseRepeat({ startRow: 3, endRow: 1, key: "items" }, 4)).toBeNull();
  });

  it("refuses an empty key", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 1, key: "  " }, 4)).toBeNull();
  });

  it("refuses a non-integer row", () => {
    expect(normaliseRepeat({ startRow: 1.5, endRow: 2, key: "items" }, 4)).toBeNull();
  });

  it("refuses null", () => {
    expect(normaliseRepeat(null, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/tableRepeat.test.ts`

Expected: FAIL - `@/lib/canvas/tableRepeat` does not exist.

- [ ] **Step 3: Implement the guard**

Create `lib/canvas/tableRepeat.ts`:

```ts
import type { TableRepeat } from "@/lib/template/types";

const DEFAULT_MAX_ITEMS = 200;

/**
 * Validate a band against the table it will live in, returning a fully populated
 * `TableRepeat` or null.
 *
 * This sits beside the other canvas rules because it is a canvas-authoring
 * constraint: the band has to fit the table as it is currently drawn. The
 * renderer and the serialiser re-check independently, because a package can be
 * assembled from files this editor never saw.
 */
export function normaliseRepeat(
  raw: Partial<TableRepeat> | null | undefined,
  rowCount: number,
): TableRepeat | null {
  if (!raw || typeof raw !== "object") return null;
  const { startRow, endRow, key } = raw;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return null;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return null;
  if (!Number.isInteger(rowCount) || rowCount <= 0 || endRow >= rowCount) return null;
  if (typeof key !== "string" || key.trim().length === 0) return null;
  return {
    startRow,
    endRow,
    key: key.trim(),
    repeatHeader: raw.repeatHeader === true,
    maxItems:
      typeof raw.maxItems === "number" && Number.isInteger(raw.maxItems) && raw.maxItems > 0
        ? raw.maxItems
        : DEFAULT_MAX_ITEMS,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/tableRepeat.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Add the controller command and selected-table state**

In `lib/canvas/EditorController.ts`:

1. Add `normaliseRepeat` to the imports from `@/lib/canvas/tableRepeat` and `TableRepeat` to the type imports from `@/lib/template/types`.
2. In `EditorState`, add a field next to the other selection fields:

```ts
  /** The selected table with its repeat band, or null when none is selected. */
  selectedTable: (TableObject & { repeat?: TableRepeat }) | null;
```

3. Initialise it to `null` alongside the other initial state values.
4. Set it wherever `state` is rebuilt from the active object: in the same place the other `selected*` fields are derived, add

```ts
      selectedTable:
        active instanceof BillTable ? (active as unknown as TableObject & { repeat?: TableRepeat }) : null,
```

5. Add the command:

```ts
  /**
   * Mark a table's rows as a repeating band, or clear it with null.
   *
   * A band that does not fit the table as drawn is refused rather than
   * committed, so an invalid band cannot be saved and then fail to render.
   */
  setTableRepeat(tableId: string, repeat: Partial<TableRepeat> | null): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const target = canvas.getObjects().find((o) => o instanceof BillTable && o.id === tableId);
    if (!(target instanceof BillTable)) return;

    if (repeat === null) {
      target.repeat = undefined;
      this.commit("Clear repeating rows");
      canvas.requestRenderAll();
      return;
    }
    const rowCount = Array.isArray(target.rowHeights) ? target.rowHeights.length : 0;
    const next = normaliseRepeat(repeat, rowCount);
    if (!next) return;
    target.repeat = next;
    this.commit("Set repeating rows");
    canvas.requestRenderAll();
  }
```

- [ ] **Step 6: Add the panel controls**

In `components/editor/PropertiesPanel.tsx`, render a "Repeating rows" block inside the section that already handles a selected table. Add a prop `onSetTableRepeat?: (tableId: string, repeat: Partial<TableRepeat> | null) => void` to the panel's props, and render:

```tsx
{state.selectedTable ? (
  <div className="mt-3 rounded border border-neutral-200 p-2">
    <div className="mb-1 text-[11px] font-semibold uppercase text-neutral-500">Repeating rows</div>
    <label className="flex items-center gap-2 text-[11px]">
      <input
        type="checkbox"
        checked={Boolean(state.selectedTable.repeat)}
        onChange={(e) => {
          const t = state.selectedTable!;
          const lastRow = Math.max(0, t.rows - 1);
          onSetTableRepeat?.(
            t.id,
            e.target.checked
              ? { startRow: Math.min(1, lastRow), endRow: lastRow, key: "items" }
              : null,
          );
        }}
      />
      Repeat these rows once per item
    </label>
    {state.selectedTable.repeat ? (
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className="text-[11px]">
          First row
          <input
            type="number"
            min={0}
            max={state.selectedTable.rows - 1}
            value={state.selectedTable.repeat.startRow}
            onChange={(e) =>
              onSetTableRepeat?.(state.selectedTable!.id, {
                ...state.selectedTable!.repeat!,
                startRow: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="text-[11px]">
          Last row
          <input
            type="number"
            min={0}
            max={state.selectedTable.rows - 1}
            value={state.selectedTable.repeat.endRow}
            onChange={(e) =>
              onSetTableRepeat?.(state.selectedTable!.id, {
                ...state.selectedTable!.repeat!,
                endRow: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="col-span-2 text-[11px]">
          Items key
          <input
            type="text"
            value={state.selectedTable.repeat.key}
            onChange={(e) =>
              onSetTableRepeat?.(state.selectedTable!.id, {
                ...state.selectedTable!.repeat!,
                key: e.target.value,
              })
            }
          />
        </label>
        <label className="text-[11px]">
          Max items
          <input
            type="number"
            min={1}
            value={state.selectedTable.repeat.maxItems ?? 200}
            onChange={(e) =>
              onSetTableRepeat?.(state.selectedTable!.id, {
                ...state.selectedTable!.repeat!,
                maxItems: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={state.selectedTable.repeat.repeatHeader === true}
            onChange={(e) =>
              onSetTableRepeat?.(state.selectedTable!.id, {
                ...state.selectedTable!.repeat!,
                repeatHeader: e.target.checked,
              })
            }
          />
          Repeat header when split
        </label>
      </div>
    ) : null}
  </div>
) : null}
```

Wire `onSetTableRepeat` at the call site in `components/editor/BillEditor.tsx`:

```tsx
onSetTableRepeat={(tableId, repeat) => controllerRef.current?.setTableRepeat(tableId, repeat)}
```

- [ ] **Step 7: Run the gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean.

- [ ] **Step 8: Commit**

```powershell
git add lib/canvas/tableRepeat.ts lib/canvas/EditorController.ts components/editor/PropertiesPanel.tsx components/editor/BillEditor.tsx tests/tableRepeat.test.ts
git commit -m "feat: author a repeat band from the table properties panel"
```

---

### Task 13: Show and edit repeating rows in the generated form

The existing form shows one input per template token. A band's tokens must instead become a row editor, or the line items are uneditable.

**Files:**
- Modify: `components/render/DynamicForm.tsx`
- Create: `tests/repeatForm.test.ts`

**Interfaces:**
- Consumes: `FormSchema`, `FormField`, `RepeatFieldSpec` from `@/lib/package/form`; `humanizeKey` from `@/lib/template/dataBinding`.
- Produces: `repeatValue(rows: Record<string, string>[], columns: string[]): string` from `@/lib/render/repeatForm` - serialises the row array into the JSON string the renderer expects.

- [ ] **Step 1: Write the failing test**

Create `tests/repeatForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { repeatValue, rowsFromValue } from "@/lib/render/repeatForm";

const columns = ["description", "amount"];

describe("repeatValue", () => {
  it("serialises rows into the JSON string the renderer reads", () => {
    const out = repeatValue([{ description: "A", amount: "1.00" }], columns);
    expect(out).toBe('[{"description":"A","amount":"1.00"}]');
  });

  it("emits an empty list for no rows", () => {
    expect(repeatValue([], columns)).toBe("[]");
  });

  it("keeps a blank row rather than dropping it mid-edit", () => {
    const out = repeatValue([{ description: "A", amount: "" }], columns);
    expect(JSON.parse(out)).toEqual([{ description: "A", amount: "" }]);
  });

  it("fills missing columns with empty strings so a row always has every key", () => {
    expect(JSON.parse(repeatValue([{ description: "A" }], columns))).toEqual([
      { description: "A", amount: "" },
    ]);
  });
});

describe("rowsFromValue", () => {
  it("reads rows back out of the JSON string", () => {
    expect(rowsFromValue('[{"description":"A","amount":"1.00"}]', columns)).toEqual([
      { description: "A", amount: "1.00" },
    ]);
  });

  it("falls back to one blank row for anything unusable", () => {
    expect(rowsFromValue("nope", columns)).toEqual([{ description: "", amount: "" }]);
  });

  it("falls back to one blank row for an empty string", () => {
    expect(rowsFromValue("", columns)).toEqual([{ description: "", amount: "" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run tests/repeatForm.test.ts`

Expected: FAIL - `@/lib/render/repeatForm` does not exist.

- [ ] **Step 3: Implement the serialiser**

Create `lib/render/repeatForm.ts`:

```ts
/**
 * Conversions between a repeat field's rows and the single JSON string the
 * renderer reads for that key.
 *
 * A row is kept even when every cell is blank, so deleting the last character of
 * the only line item does not make the row disappear from under the cursor.
 * Filling every column guarantees a row always has the same keys, which is what
 * lets the renderer resolve `{{column}}` without checking each one.
 */

import { itemsOf } from "./computed";
import type { Values } from "./values";

function blankRow(columns: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of columns) row[c] = "";
  return row;
}

/** Serialise rows into the JSON string stored under the repeat's key. */
export function repeatValue(rows: Record<string, string>[], columns: string[]): string {
  const filled = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = typeof row[c] === "string" ? row[c] : "";
    return out;
  });
  return JSON.stringify(filled);
}

/** Read rows back out of a value, always yielding at least one editable row. */
export function rowsFromValue(value: string, columns: string[]): Record<string, string>[] {
  const parsed = itemsOf({ repeat: value } as Values, "repeat");
  if (parsed.length === 0) return [blankRow(columns)];
  return parsed.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      const v = row[c];
      out[c] = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    }
    return out;
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx.cmd vitest run tests/repeatForm.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Render a row editor in the generated form**

In `components/render/DynamicForm.tsx`:

1. Import `repeatValue`, `rowsFromValue` from `@/lib/render/repeatForm`.
2. Import `FormSchema`, `RepeatFieldSpec` from `@/lib/package/form`.
3. Change the component to accept the derived schema: `schema: FormSchema` in place of building its own field list from `extractTemplateFields`.
4. Render a repeating field as a small row editor. For each field whose `type` is `"repeating"`, look up its `RepeatFieldSpec` in `schema.repeats`, then render one labelled row of inputs per column, with Add and Remove buttons:

```tsx
{field.type === "repeating" && repeat ? (
  <fieldset className="col-span-2 rounded border border-neutral-200 p-2">
    <legend className="text-[11px] uppercase text-neutral-500">{field.label}</legend>
    {(() => {
      const rows = rowsFromValue(values[field.key] ?? "", repeat.columns);
      const commit = (next: Record<string, string>[]) =>
        onChange(field.key, repeatValue(next, repeat.columns));
      return (
        <div className="flex flex-col gap-1">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              {repeat.columns.map((col) => (
                <input
                  key={col}
                  aria-label={`${repeat.objectName} row ${i + 1} ${col}`}
                  className="flex-1 border px-1 py-0.5 text-[12px]"
                  value={row[col] ?? ""}
                  onChange={(e) => {
                    const next = rows.map((r, j) => (j === i ? { ...r, [col]: e.target.value } : r));
                    commit(next);
                  }}
                />
              ))}
              <button
                type="button"
                className="px-2 text-[11px]"
                disabled={rows.length <= 1}
                onClick={() => commit(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start px-2 text-[11px]"
            disabled={rows.length >= repeat.maxItems}
            onClick={() => commit([...rows, {}])}
          >
            Add row
          </button>
        </div>
      );
    })()}
  </fieldset>
) : null}
```

Filter the repeated field out of the ordinary single-input rendering so it is not also drawn as a plain text box:

```tsx
const plainFields = schema.fields.filter((f) => f.type !== "repeating");
```

- [ ] **Step 6: Run the gate**

Run: `npx.cmd tsc --noEmit; npm.cmd test; npm.cmd run lint`

Expected: clean. Any other caller of `DynamicForm` must be updated to pass `schema`; check `app/render/RenderClient.tsx` and build it with `deriveForm` from `@/lib/package/form`, passing the resolved template so bands are discovered.

- [ ] **Step 7: Commit**

```powershell
git add lib/render/repeatForm.ts components/render/DynamicForm.tsx app/render/RenderClient.tsx tests/repeatForm.test.ts
git commit -m "feat: edit repeating line items in the generated form"
```

---

### Task 14: End-to-end coverage of a filled invoice

Every unit above is verified in isolation. This proves the whole path works together in a real browser: author a band, save, reopen, fill, render.

**Files:**
- Create: `e2e/billkit.spec.ts`

**Interfaces:**
- Consumes: the editor, the render page, and `window.__btm` as used by existing E2E specs.
- Produces: no new product code; this is the acceptance test for Phases 1 and 2.

- [ ] **Step 1: Write the failing test**

Create `e2e/billkit.spec.ts`, following the helper shape used in `e2e/tableguides.spec.ts` (`openEditor`, `docToPage`, `pickTool`):

```ts
import { expect, test } from "@playwright/test";

async function openEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  const file = page.locator('input[type="file"]').first();
  await file.setInputFiles("e2e/fixtures/test-bill.png");
  await page.waitForTimeout(800);
}

function docToPage(page: import("@playwright/test").Page) {
  return async (dx: number, dy: number) => {
    const box = await page.locator("canvas.upper-canvas").boundingBox();
    if (!box) throw new Error("no canvas");
    return { x: box.x + dx, y: box.y + dy };
  };
}

async function pickTool(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name }).click();
}

async function drawTableWithBand(page: import("@playwright/test").Page): Promise<void> {
  const P = docToPage(page);
  await pickTool(page, "Table");
  const a = await P(80, 200);
  const b = await P(520, 380);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  const rows = dialog.locator('input[type="number"]').first();
  await rows.click();
  await rows.press("Control+a");
  await rows.type("3");
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(400);
}

async function markBand(page: import("@playwright/test").Page): Promise<void> {
  await page.keyboard.press("v");
  const P = docToPage(page);
  const inside = await P(300, 260);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);
  await page.getByLabel("Repeat these rows once per item").check();
  await page.waitForTimeout(300);
}

test.describe("billkit package and repeating line items", () => {
  test("a band survives save and reload, and renders one row per item", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);
    await markBand(page);

    const saved = await page.evaluate(() => window.__btm.getTemplate());
    const table = saved.objects.find((o) => o.type === "table") as unknown as {
      repeat?: { key: string };
    };
    expect(table.repeat?.key).toBe("items");

    // The band must come back after a reload, or authoring it is pointless.
    await page.reload();
    await page.waitForTimeout(800);
    const restored = await page.evaluate(() => window.__btm.getTemplate());
    const restoredTable = restored.objects.find((o) => o.type === "table") as unknown as {
      repeat?: { key: string };
    };
    expect(restoredTable.repeat?.key).toBe("items");
  });

  test("filling items produces one rendered row per item plus the total", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);
    await markBand(page);

    const template = await page.evaluate(() => window.__btm.getTemplate());
    const html = await page.evaluate((t) => {
      const band = (t as { objects: { repeat?: { key: string } }[] }).objects.find(
        (o) => o.repeat,
      )!.repeat!.key;
      return window.__btm.renderHtmlForTest(t, {
        [band]: JSON.stringify([
          { description: "Wheat flour", amount: "100.00" },
          { description: "Rice", amount: "250.50" },
        ]),
      });
    }, template);

    expect(html).toContain("Wheat flour");
    expect(html).toContain("Rice");
    expect(html).toContain("250.50");
  });

  test("a build/parse/resolve round trip preserves the rendered output", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);

    const same = await page.evaluate(async () => {
      const t = window.__btm.getTemplate();
      const direct = window.__btm.renderHtmlForTest(t, {});
      const round = await window.__btm.packageRoundTripHtml(t);
      return { same: direct === round, direct };
    });
    expect(same.same).toBe(true);
    expect(same.direct.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Add the test-only hooks it needs**

The three helpers above are new. Add them to the `window.__btm` test surface in `components/editor/BillEditor.tsx`, guarded so they exist only in development:

```ts
  // Test-only surface used by e2e specs. `renderHtmlForTest` and
  // `packageRoundTripHtml` exercise the pure renderer and the package path
  // without a second browser round trip.
  (window as unknown as Record<string, unknown>).__btm = {
    ...(existing __btm members),
    renderHtmlForTest: (t: BillTemplate, values: Record<string, string>) =>
      renderHtml(t, values, { computed: computedSpecsFor(t) }).html,
    packageRoundTripHtml: async (t: BillTemplate) => {
      const pkg = buildPackage(t);
      const { template } = resolvePackage(parsePackage(writePackage(pkg)));
      return renderHtml(template, {}, { computed: computedSpecsFor(t) }).html;
    },
  };
```

Where `computedSpecsFor(t)` returns the totals to evaluate, reading them from the template's
placeholder specs so the E2E and the app agree:

```ts
function computedSpecsFor(t: BillTemplate): ComputedSpec[] {
  return t.objects
    .flatMap((o) => (o.type === "table" && o.repeat ? [o] : []))
    .map((o) => ({ key: "subtotal", op: "sum" as const, args: [`${(o as { repeat: { key: string } }).repeat.key}.amount`] }))
    .concat([{ key: "total", op: "add" as const, args: ["subtotal"] }]);
}
```

- [ ] **Step 3: Run the E2E suite**

Run: `$env:PORT="3000"; npx.cmd playwright test e2e/billkit.spec.ts --reporter=list`

Expected: PASS, 3 tests.

If the reload test fails on `restoredTable.repeat`, the serialise/hydrate work in Task 9 is incomplete - do not patch the test.

- [ ] **Step 4: Prove the reload test can fail**

Temporarily delete the `repeat: o.repeat,` line from `hydrateTable` in `lib/template/hydrate.ts`, re-run only the reload test, and confirm it goes red. Restore the line afterwards.

This step exists because a test asserting a value that is present by default proves nothing, and Task 9's whole purpose is a field that is absent by default.

Run: `$env:PORT="3000"; npx.cmd playwright test e2e/billkit.spec.ts --reporter=list`

Expected: FAIL on the reload test.

- [ ] **Step 5: Run the complete gate**

Run:

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
$env:PORT="3000"; npx.cmd playwright test
npm.cmd run build
```

Expected: all clean. The unit count should have grown by roughly 90 tests and the E2E count by 3.

- [ ] **Step 6: Commit**

```powershell
git add e2e/billkit.spec.ts components/editor/BillEditor.tsx
git commit -m "test: end-to-end coverage for packages and repeating line items"
```

---

## Definition of done

- `lib/render/**` purity test and all five `renderGolden` files pass unchanged.
- A template round-trips through `buildPackage` -> `writePackage` -> `parsePackage` -> `resolvePackage` and renders byte-identically to rendering the template directly.
- A table with a repeat band renders one row per item, with a computed total, and warns rather than clipping when it outgrows the page.
- A band survives save and reload.
- The full gate is green: `tsc`, `npm test`, `npm run lint`, Playwright, `npm run build`.

## Follow-on (separate plan)

Phases 3 to 5 of the spec, not covered here:

- **Phase 3** font subsetting and `@font-face`. Unverified: no subsetting library is installed, so this needs `subset-font` + HarfBuzz wasm and a check that it builds offline here.
- **Phase 4** the `billkit.js` runtime bundle and the prebuilt single-file HTML, mirroring the existing `build:share` esbuild step.
- **Phase 5** the host integration guide, the reference Android WebView host, and the parity test on text tokens, page count and geometry.

Also worth doing at some point, and deliberately out of scope here: routing `RenderClient.importTemplate` and `EditorController.loadTemplate` through `migrateTemplate` and `validatePackage`. Today a garbage template file can still reach `renderHtml` unchecked, and both those call sites are only hardened once this work exists to call.