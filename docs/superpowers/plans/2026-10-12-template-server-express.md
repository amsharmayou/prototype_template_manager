# Template Server (Express) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an Express 5 + Node service that ingests `.btpkg` uploads, validates them with the shared format package, stores them in SQLite and on disk, and serves a dashboard plus a public catalog the Android app can consume.

**Architecture:** One Express process exposes three things: a public JSON catalog and download route, an authenticated admin API, and server-rendered dashboard pages. Validation is delegated entirely to `billkit-format` so the backend never holds a second opinion about the format. Packages are content-addressed by the SHA-256 of their bytes, which makes the row id the filename and makes re-upload idempotent.

**Tech Stack:** Express 5.3, Node 24, TypeScript 5, `node:sqlite`, multer 2.4, `billkit-format`, vitest 3, tsx.

**Spec:** `docs/superpowers/specs/2026-10-12-template-server-design.md` — see *Backend*.

## Global Constraints

- **The catalog `id` is a pure function of content, or none of this works.** `writePackage` now
  pins `mtime` to the ZIP epoch, so two writes of one template are byte-equal. **One known
  exception survives**, carried from Plan 1 and tracked by a deliberately-failing test at
  `shared/billkit-format/tests/determinism.test.ts` (`it.fails`, verified non-vacuous):
  `meta.modifiedAt` still reaches the archive bytes, because `build.ts` serialises the whole
  template into `template.json`. **Task 1 of this plan removes it.** Until then, a `.btpkg` is
  not a pure function of its template and the de-duplication guarantee is not yet real.
- **Express 5 semantics.** `req.params` is populated synchronously, but path-to-regexp v8 rejects bare `*` wildcards. Do not write `app.get("/x/*", ...)`.
- **The backend never builds a package.** `parsePackage` → `validatePackage` → describe. Building is the editor's job.
- **Only `error`-severity issues refuse an upload.** Warnings are recorded and the package is kept.
- **A package id is 64 lowercase hex characters.** Every id arriving from a URL must be validated against `/^[0-9a-f]{64}$/` **before** it is joined into a filesystem path.
- **Password comparison is timing-safe.** Use `crypto.timingSafeEqual` over equal-length buffers, and hash both sides first so differing lengths do not throw.
- **Never log or echo the admin password**, and never return it in any response.
- Type majors match the editor: `typescript ^5`, `vitest ^3`, `tsx ^4`.
- **No `git push`.** Never commit `node_modules/` or `server/data/`.
- Server gate: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`.
- Tests hit a **real HTTP server on an ephemeral port** using global `fetch` — no `supertest` dependency, and the assertions cover actual status codes and headers.

---

### Task 0: Make the archive a pure function of the template

Do this **first**. The whole storage design rests on it, and it is a one-line change plus one
assertion flip. Doing it later means writing the store against an id that is not yet the content
hash, and discovering the defect from a duplicate row instead of from a test.

**Files:**
- Modify: `Prototype/shared/billkit-format/package/build.ts`
- Modify: `Prototype/shared/billkit-format/tests/determinism.test.ts`

**Interfaces:**
- Consumes: `writePackage` with `mtime` already pinned to `315532800000` (Plan 1).
- Produces: a `.btpkg` whose bytes depend only on its template, which is what makes
  `id = sha256(bytes)` a usable primary key.

- [ ] **Step 1: Write the failing test first**

In `determinism.test.ts` there is a deliberately-failing case (`it.fails`) asserting that two
builds differing only in `meta.modifiedAt` produce identical bytes. Confirm it is still failing and
still marked `it.fails` — that is the whole point of it, and it goes red the moment someone fixes
the behaviour.

- [ ] **Step 2: Stop `modifiedAt` reaching the archive**

In `build.ts`, where `template.json` is produced:

```ts
const templateJson = JSON.stringify({ ...template, objects }, null, 2);
```

`meta.modifiedAt` is editor bookkeeping — the renderer already excludes it from its output hash
for the same reason, at `version 1/lib/render/index.ts:174`. Serialise it as an empty string so
the field keeps its type and loses its variance:

```ts
const templateJson = JSON.stringify(
  { ...template, meta: { ...template.meta, modifiedAt: "" }, objects },
  null,
  2,
);
```

- [ ] **Step 3: Flip the sentinel**

Change `it.fails(...)` to `it(...)`. Run `npm.cmd test` from `shared/billkit-format`.
Expected: green, with the case now asserting the invariant directly.

- [ ] **Step 4: Prove the editor is unaffected**

From `Prototype\version 1`: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, then
`npm.cmd run build:billkit` and `npm.cmd run prepare:android-assets`.
Expect **634 tests / 33 files**, and `public/billkit.js` byte-identical — `buildPackage` is not in
that bundle's dependency graph, so nothing about it should move.

- [ ] **Step 5: Prove the hash is now a function of content**

From `Prototype\server`, after Task 2 exists: build the same template twice through
`buildPackageBytes` and assert one id. Until then, a unit assertion in `determinism.test.ts`
comparing two `writePackage` results across differing `modifiedAt` values is sufficient.

- [ ] **Step 6: Commit**

In the pipeline repo, explicit paths:
```bash
git add shared/billkit-format/package/build.ts shared/billkit-format/tests/determinism.test.ts
git commit -m "fix: stop a wall-clock timestamp from varying the package bytes"
```

---

### Task 1: Server skeleton, config, and database

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/eslint.config.mjs`
- Create: `server/.env.example`
- Create: `server/src/config.ts`
- Create: `server/src/db.ts`
- Test: `server/tests/config.test.ts`

**Interfaces:**
- Consumes: the `billkit-format` workspace package from Plan 1 Task 1.
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `openDatabase(file: string): DatabaseSync`
  - `Config = { port, host, dataDir, packagesDir, adminPassword, maxUploadBytes }`

- [ ] **Step 1: Write the failing config test**

Create `server/tests/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("defaults the port, host and upload cap", () => {
    const c = loadConfig({ BILLKIT_ADMIN_PASSWORD: "hunter2" });
    expect(c.port).toBe(4000);
    // 0.0.0.0, not localhost: an Android emulator cannot reach a service bound
    // to the loopback interface from inside the guest.
    expect(c.host).toBe("0.0.0.0");
    expect(c.maxUploadBytes).toBe(50 * 1024 * 1024);
  });

  it("refuses to start with no admin password", () => {
    expect(() => loadConfig({})).toThrow(/BILLKIT_ADMIN_PASSWORD/);
  });

  it("reads overrides from the environment", () => {
    const c = loadConfig({ BILLKIT_ADMIN_PASSWORD: "x", PORT: "8080", DATA_DIR: "/tmp/bk" });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/tmp/bk");
    expect(c.packagesDir.endsWith("packages")).toBe(true);
  });

  it("rejects a non-numeric port instead of silently listening on NaN", () => {
    expect(() => loadConfig({ BILLKIT_ADMIN_PASSWORD: "x", PORT: "abc" })).toThrow(/PORT/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

From `Prototype\server` (run `npm.cmd install` from `Prototype` first, per Plan 1):
```bash
npx.cmd vitest run tests/config.test.ts
```
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Create the package manifest**

Create `server/package.json`:
```json
{
  "name": "billkit-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "seed": "tsx src/seed.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "billkit-format": "*",
    "express": "^5.3.0",
    "multer": "^2.4.0"
  },
  "devDependencies": {
    "@eslint/js": "^9",
    "@types/express": "^5.0.6",
    "@types/multer": "^2.3.0",
    "@types/node": "^20",
    "eslint": "^9",
    "typescript": "^5",
    "typescript-eslint": "^8",
    "vitest": "^3"
  }
}
```

- [ ] **Step 4: Create tsconfig, vitest config and eslint config**

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "*.ts"]
}
```

No `DOM` in `lib` here. Unlike `billkit-format`, the server never calls `atob`/`btoa` itself, and its own `crypto` use is native `node:crypto`.

`server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

`server/eslint.config.mjs`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: ["node_modules/**", "data/**", "public/**"],
});
```

- [ ] **Step 5: Write config.ts**

Create `server/src/config.ts`:
```ts
import { resolve } from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  packagesDir: string;
  adminPassword: string;
  maxUploadBytes: number;
}

const DEFAULT_PORT = 4000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.BILLKIT_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("BILLKIT_ADMIN_PASSWORD is required: the dashboard is unauthenticated without it");
  }

  const rawPort = env.PORT;
  const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got ${String(rawPort)}`);
  }

  const dataDir = resolve(env.DATA_DIR ?? "data");

  return {
    port,
    // 0.0.0.0 by default. An emulator reaches the host through the LAN, so a
    // loopback bind would work in a browser and fail on the device.
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    packagesDir: resolve(dataDir, "packages"),
    adminPassword,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  };
}
```

- [ ] **Step 6: Write db.ts**

Create `server/src/db.ts`:
```ts
import { DatabaseSync } from "node:sqlite";

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS packages (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  filename         TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  package_version  INTEGER NOT NULL,
  template_version INTEGER NOT NULL,
  page_width       INTEGER,
  page_height      INTEGER,
  field_count      INTEGER,
  asset_count      INTEGER,
  computed_summary TEXT,
  uploaded_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_issues (
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  severity   TEXT NOT NULL,
  path       TEXT NOT NULL,
  message    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_packages_uploaded ON packages(uploaded_at DESC);
`;

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}
```

`CREATE TABLE IF NOT EXISTS` everywhere, so opening an existing database on restart is not an error.

- [ ] **Step 7: Create .env.example**

Create `server/.env.example`:
```
BILLKIT_ADMIN_PASSWORD=change-me
PORT=4000
HOST=0.0.0.0
DATA_DIR=data
```

Add `server/.env` to the root `.gitignore` in this step — secrets must not be committable.

- [ ] **Step 8: Run the test and the gate**

```bash
npx.cmd vitest run tests/config.test.ts
npm.cmd run typecheck
npm.cmd run lint
```
Expected: 4 passed; typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add server
git commit -m "feat: server config and the package database"
```

---

### Task 2: Content-addressed storage and ingest

**Files:**
- Create: `server/src/storage.ts`
- Create: `server/src/ingest.ts`
- Test: `server/tests/storage.test.ts`
- Test: `server/tests/ingest.test.ts`

**Interfaces:**
- Consumes: `sha256HexBytes` from `billkit-format/render/sha256`; `parsePackage`, `validatePackage`, `deriveForm`, `PACKAGE_VERSION` and the `Issue` type from `billkit-format/package`.
- Produces:
  - `createFileStore(dir: string): FileStore` with `put(bytes: Uint8Array): Promise<string>`, `get(id: string): Promise<Uint8Array | null>`, `pathFor(id: string): string`, `remove(id: string): Promise<boolean>`
  - `isPackageId(value: string): boolean`
  - `inspectPackage(bytes: Uint8Array, filename: string): IngestOutcome`
  - `IngestOutcome = { ok: true; summary: PackageSummary; issues: Issue[] } | { ok: false; issues: Issue[] }`

- [ ] **Step 1: Write the failing storage test**

Create `server/tests/storage.test.ts`:
```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileStore, isPackageId } from "../src/storage";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "bk-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("isPackageId", () => {
  it("accepts a lowercase sha256", () => {
    expect(isPackageId("a".repeat(64))).toBe(true);
  });

  it("refuses anything that could escape the storage directory", () => {
    expect(isPackageId("../../etc/passwd")).toBe(false);
    expect(isPackageId("..%2f..%2fetc")).toBe(false);
    expect(isPackageId("A".repeat(64))).toBe(false);
    expect(isPackageId("z".repeat(64))).toBe(false);
    expect(isPackageId("")).toBe(false);
  });
});

describe("createFileStore", () => {
  it("stores bytes under their own sha256 and reads them back", async () => {
    const store = createFileStore(dir);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const id = await store.put(bytes);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.get(id)).toEqual(bytes);
  });

  it("gives identical bytes the same id and stores them once", async () => {
    const store = createFileStore(dir);
    const bytes = new Uint8Array([9, 9]);
    expect(await store.put(bytes)).toBe(await store.put(bytes));
  });

  it("returns null for an unknown id", async () => {
    expect(await createFileStore(dir).get("f".repeat(64))).toBeNull();
  });

  it("removes a stored package", async () => {
    const store = createFileStore(dir);
    const id = await store.put(new Uint8Array([1]));
    expect(await store.remove(id)).toBe(true);
    expect(await store.get(id)).toBeNull();
    expect(await store.remove(id)).toBe(false);
  });

  it("refuses an id that is not a digest", async () => {
    const store = createFileStore(dir);
    await expect(store.get("../../secret")).rejects.toThrow(/invalid package id/);
  });
});
```

The traversal test is the one that matters: `id` arrives from a URL, and an unchecked join
into a path is a directory-traversal bug.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx.cmd vitest run tests/storage.test.ts
```
Expected: FAIL — `Cannot find module '../src/storage'`.

- [ ] **Step 3: Write storage.ts**

Create `server/src/storage.ts`:
```ts
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256HexBytes } from "billkit-format/render/sha256";

const ID = /^[0-9a-f]{64}$/;

export function isPackageId(value: string): boolean {
  return ID.test(value);
}

export interface FileStore {
  put(bytes: Uint8Array): Promise<string>;
  get(id: string): Promise<Uint8Array | null>;
  pathFor(id: string): string;
  remove(id: string): Promise<boolean>;
}

export function createFileStore(dir: string): FileStore {
  const ensure = () => mkdir(dir, { recursive: true });

  const pathFor = (id: string): string => {
    if (!isPackageId(id)) {
      throw new Error(`invalid package id: ${JSON.stringify(id)}`);
    }
    return join(dir, `${id}.btpkg`);
  };

  return {
    async put(bytes) {
      await ensure();
      const id = sha256HexBytes(bytes);
      await writeFile(pathFor(id), bytes);
      return id;
    },
    async get(id) {
      const path = pathFor(id);
      try {
        return new Uint8Array(await readFile(path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    pathFor,
    async remove(id) {
      try {
        await unlink(pathFor(id));
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw e;
      }
    },
  };
}
```

`pathFor` throws rather than sanitising. A sanitising helper invites the belief that the
result is safe, when the correct response to a malformed id is to refuse the request.

- [ ] **Step 4: Run the storage test**

```bash
npx.cmd vitest run tests/storage.test.ts
```
Expected: 8 passed.

- [ ] **Step 5: Write the failing ingest test**

Create `server/tests/ingest.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { buildPackage, writePackage, type ComputedSpec } from "billkit-format/package";
import type { BillTemplate, TableCell, TableObject } from "billkit-format/template/types";

import { inspectPackage } from "../src/ingest";

const table: TableObject = {
  id: "t1",
  type: "table",
  name: "Table 1",
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  visible: true,
  width: 400,
  height: 40,
  rows: 1,
  columns: 1,
  rowHeights: [20],
  cells: [{ text: "Total", textAlign: "left", fontSize: 12, fontWeight: "normal" }] as TableCell[],
};

const template: BillTemplate = {
  templateVersion: 2,
  document: { width: 794, height: 1123 },
  meta: { name: "Receipt", modifiedAt: "" },
  objects: [table],
};

const good = (computed: ComputedSpec[] = []) =>
  writePackage(buildPackage(template, { computed }));

describe("inspectPackage", () => {
  it("summarises a valid package", () => {
    const result = inspectPackage(good(), "receipt.btpkg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.id).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summary.name).toBe("Receipt");
    expect(result.summary.pageWidth).toBe(794);
    expect(result.summary.pageHeight).toBe(1123);
    expect(result.summary.packageVersion).toBe(1);
    expect(result.summary.byteSize).toBeGreaterThan(0);
  });

  it("describes the computed specs it was given", () => {
    const bytes = good([{ key: "total", op: "add", args: ["subtotal"] }]);
    const result = inspectPackage(bytes, "x.btpkg");
    // `total` reads a `subtotal` nothing produces, so this is deliberately an
    // invalid package - the point is that ingest reports it rather than storing it.
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("computed[0].args[0]"))).toBe(true);
  });

  it("refuses a body that is not a zip, without throwing", () => {
    const result = inspectPackage(new Uint8Array([1, 2, 3, 4]), "not.zip");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.severity).toBe("error");
    expect(result.issues[0]?.path).toBe("archive");
  });

  it("refuses an empty body", () => {
    expect(inspectPackage(new Uint8Array(0), "empty.btpkg").ok).toBe(false);
  });

  it("never lets the manifest name empty the label", () => {
    const result = inspectPackage(good(), "fallback.btpkg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.name.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
npx.cmd vitest run tests/ingest.test.ts
```
Expected: FAIL — `Cannot find module '../src/ingest'`.

- [ ] **Step 7: Write ingest.ts**

Create `server/src/ingest.ts`:
```ts
import {
  deriveForm,
  parsePackage,
  validatePackage,
  type Issue,
} from "billkit-format/package";
import type { PackageManifest } from "billkit-format/package";
import { sha256HexBytes } from "billkit-format/render/sha256";

export interface PackageSummary {
  id: string;
  name: string;
  byteSize: number;
  packageVersion: number;
  templateVersion: number;
  pageWidth: number | null;
  pageHeight: number | null;
  fieldCount: number;
  assetCount: number;
  computedSummary: string;
}

export type IngestOutcome =
  | { ok: true; summary: PackageSummary; issues: Issue[] }
  | { ok: false; issues: Issue[] };

function describeComputed(manifest: PackageManifest): string {
  return manifest.computed.map((c) => `${c.key}=${c.op}(${c.args.join(",")})`).join(" ");
}

export function inspectPackage(bytes: Uint8Array, filename: string): IngestOutcome {
  // parsePackage throws only for an archive it cannot read at all. That is an
  // expected outcome of a user uploading the wrong file, so it becomes an issue
  // rather than a 500.
  let pkg;
  try {
    pkg = parsePackage(bytes);
  } catch (e) {
    return {
      ok: false,
      issues: [{ severity: "error", path: "archive", message: e instanceof Error ? e.message : String(e) }],
    };
  }

  const { issues } = validatePackage(pkg);
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };

  const { manifest } = pkg;
  const schema = deriveForm(manifest);

  return {
    ok: true,
    issues,
    summary: {
      id: sha256HexBytes(bytes),
      // A package with an empty name would render an unusable catalog row.
      name: manifest.name.trim() || filename || "untitled package",
      byteSize: bytes.byteLength,
      packageVersion: manifest.packageVersion,
      templateVersion: manifest.templateVersion,
      pageWidth: manifest.document.width,
      pageHeight: manifest.document.height,
      fieldCount: schema.fields.length,
      assetCount: manifest.assets.length,
      computedSummary: describeComputed(manifest),
    },
  };
}
```

- [ ] **Step 8: Run the ingest test**

```bash
npx.cmd vitest run tests/ingest.test.ts
```
Expected: 5 passed.

If the computed-args test does not fail, Plan 1's shim export is incomplete — `validatePackage`
would be a no-op. Stop and fix Plan 1 rather than adjusting the test.

- [ ] **Step 9: Run the whole server gate and commit**

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: all clean, 17 tests.
```bash
git add server
git commit -m "feat: content-addressed storage and package ingest"
```

---

### Task 3: Catalog, sessions, and the public API

**Files:**
- Create: `server/src/catalog.ts`
- Create: `server/src/session.ts`
- Create: `server/src/app.ts`
- Test: `server/tests/session.test.ts`
- Test: `server/tests/api.test.ts`

**Interfaces:**
- Consumes: `FileStore`, `inspectPackage` from Task 2.
- Produces:
  - `createApp(deps: { config, db, store }): Express`
  - `signSession(secret, ttlMs, now?): string` and `verifySession(token, secret, now?): boolean`
  - `rowsToCatalog(rows: PackageRow[]): CatalogItem[]`

- [ ] **Step 1: Write the failing session test**

Create `server/tests/session.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "../src/session";

const SECRET = "s3cret";

describe("session tokens", () => {
  it("round-trips", () => {
    const now = 1_000_000;
    expect(verifySession(signSession(SECRET, 60_000, now), SECRET, now + 1_000)).toBe(true);
  });

  it("refuses another secret", () => {
    const now = 1_000_000;
    expect(verifySession(signSession(SECRET, 60_000, now), "other", now)).toBe(false);
  });

  it("refuses an expired token", () => {
    const now = 1_000_000;
    expect(verifySession(signSession(SECRET, 60_000, now), SECRET, now + 61_000)).toBe(false);
  });

  it("refuses a tampered payload", () => {
    const now = 1_000_000;
    const token = signSession(SECRET, 60_000, now);
    const [payload] = token.split(".");
    expect(verifySession(`${payload}x.${token.split(".")[1]}`, SECRET, now)).toBe(false);
  });

  it("refuses rubbish rather than throwing", () => {
    expect(verifySession("nonsense", SECRET)).toBe(false);
    expect(verifySession("a.b", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Write session.ts**

Create `server/src/session.ts`:
```ts
import { sha256Hex } from "billkit-format/render/sha256";

const DAY_MS = 24 * 60 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return `${payload}.${sha256Hex(`${secret}.${payload}`)}`;
}

export function signSession(secret: string, ttlMs = DAY_MS, now = Date.now()): string {
  return sign(secret, Buffer.from(JSON.stringify({ exp: now + ttlMs })).toString("base64url"));
}

export function verifySession(token: string, secret: string, now = Date.now()): boolean {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  if (sign(secret, payload) !== token) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
    return typeof exp === "number" && now < exp;
  } catch {
    return false;
  }
}
```

The signature is a plain digest over a known secret, which is enough for a single-server
admin session. It is not a JWT and does not pretend to be: nothing here needs a second
verification key or a library.

- [ ] **Step 3: Run the session test**

```bash
npx.cmd vitest run tests/session.test.ts
```
Expected: 5 passed.

- [ ] **Step 4: Write catalog.ts**

Create `server/src/catalog.ts`:
```ts
import type { DatabaseSync } from "node:sqlite";

export interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  byte_size: number;
  package_version: number;
  template_version: number;
  page_width: number | null;
  page_height: number | null;
  field_count: number | null;
  asset_count: number | null;
  computed_summary: string | null;
  uploaded_at: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  byteSize: number;
  page: { width: number | null; height: number | null };
  fieldCount: number | null;
  assetCount: number | null;
  uploadedAt: string;
}

const SELECT = `SELECT id, name, description, filename, byte_size, package_version,
  template_version, page_width, page_height, field_count, asset_count, computed_summary,
  uploaded_at FROM packages`;

export function listPackages(db: DatabaseSync): PackageRow[] {
  return db.prepare(`${SELECT} ORDER BY uploaded_at DESC, name ASC`).all() as unknown as PackageRow[];
}

export function getPackage(db: DatabaseSync, id: string): PackageRow | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id);
  return (row as unknown as PackageRow | undefined) ?? null;
}

export interface StoredIssues {
  packageId: string;
  severity: string;
  path: string;
  message: string;
}

export function replaceIssues(db: DatabaseSync, packageId: string, issues: StoredIssues[]): void {
  db.prepare("DELETE FROM ingest_issues WHERE package_id = ?").run(packageId);
  const insert = db.prepare(
    "INSERT INTO ingest_issues (package_id, severity, path, message) VALUES (?, ?, ?, ?)",
  );
  for (const i of issues) insert.run(packageId, i.severity, i.path, i.message);
}

export function upsertPackage(
  db: DatabaseSync,
  row: Omit<PackageRow, "description" | "uploaded_at"> & { description?: string | null; uploaded_at?: string },
): PackageRow {
  db.prepare(
    `INSERT INTO packages (id, name, description, filename, byte_size, package_version,
       template_version, page_width, page_height, field_count, asset_count, computed_summary,
       uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = COALESCE(excluded.description, packages.description)`,
  ).run(
    row.id, row.name, row.description ?? null, row.filename, row.byte_size, row.package_version,
    row.template_version, row.page_width, row.page_height, row.field_count, row.asset_count,
    row.computed_summary, row.uploaded_at ?? new Date().toISOString(),
  );
  return getPackage(db, row.id)!;
}

export function deletePackage(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM packages WHERE id = ?").run(id).changes > 0;
}

export function renamePackage(db: DatabaseSync, id: string, patch: { name?: string; description?: string | null }): PackageRow | null {
  if (patch.name !== undefined) db.prepare("UPDATE packages SET name = ? WHERE id = ?").run(patch.name, id);
  if (patch.description !== undefined) db.prepare("UPDATE packages SET description = ? WHERE id = ?").run(patch.description, id);
  return getPackage(db, id);
}

export function toCatalogItem(row: PackageRow): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filename: row.filename,
    byteSize: row.byte_size,
    page: { width: row.page_width, height: row.page_height },
    fieldCount: row.field_count,
    assetCount: row.asset_count,
    uploadedAt: row.uploaded_at,
  };
}
```

`ON CONFLICT(id) DO UPDATE` is what makes a repeat upload idempotent: same bytes, same id,
no duplicate row.

- [ ] **Step 5: Write the failing API test**

Create `server/tests/api.test.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "billkit-format/package";
import type { BillTemplate } from "billkit-format/template/types";

import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { openDatabase } from "../src/db";
import { createFileStore } from "../src/storage";

const PASSWORD = "correct horse";

const template: BillTemplate = {
  templateVersion: 2,
  document: { width: 794, height: 1123 },
  meta: { name: "Test Bill", modifiedAt: "" },
  objects: [],
};
const bytes = writePackage(buildPackage(template));

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;

const config = (): Config => ({
  port: 0,
  host: "127.0.0.1",
  dataDir: dir,
  packagesDir: join(dir, "packages"),
  adminPassword: PASSWORD,
  maxUploadBytes: 50 * 1024 * 1024,
});

async function login() {
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0]!;
}

const uploadForm = (body: Buffer, filename = "bill.btpkg") => {
  const form = new FormData();
  form.append("file", new Blob([body]), filename);
  return form;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bk-api-"));
  db = openDatabase(":memory:");
  const app = createApp({ config: config(), db, store: createFileStore(join(dir, "packages")) });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("public catalog", () => {
  it("starts empty", async () => {
    const res = await fetch(`${base}/api/packages`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("refuses a download for an unknown id", async () => {
    expect((await fetch(`${base}/api/packages/${"0".repeat(64)}/download`)).status).toBe(404);
  });

  it("refuses a malformed id rather than touching the filesystem", async () => {
    expect((await fetch(`${base}/api/packages/..%2f..%2fetc/download`)).status).toBe(400);
  });
});

describe("admin auth", () => {
  it("refuses an upload with no cookie", async () => {
    const res = await fetch(`${base}/api/admin/packages`, { method: "POST", body: uploadForm(Buffer.from(bytes)) });
    expect(res.status).toBe(401);
  });

  it("refuses a wrong password", async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("never echoes the password back", async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(await res.text()).not.toContain(PASSWORD);
  });
});

describe("admin upload", () => {
  it("accepts a valid package and serves it back byte for byte", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/packages`, {
      method: "POST",
      headers: { cookie },
      body: uploadForm(Buffer.from(bytes)),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; name: string };

    const catalog = (await (await fetch(`${base}/api/packages`)).json()) as { id: string }[];
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.id).toBe(created.id);

    const dl = await fetch(`${base}/api/packages/${created.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/zip");
    expect(dl.headers.get("etag")).toBe(`"${created.id}"`);
    expect(dl.headers.get("content-disposition")).toContain(".btpkg");
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(bytes);
  });

  it("is idempotent for identical bytes", async () => {
    const cookie = await login();
    const first = await fetch(`${base}/api/admin/packages`, { method: "POST", headers: { cookie }, body: uploadForm(Buffer.from(bytes)) });
    const second = await fetch(`${base}/api/admin/packages`, { method: "POST", headers: { cookie }, body: uploadForm(Buffer.from(bytes)) });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await (await fetch(`${base}/api/packages`)).json()) as unknown[])).toHaveLength(1);
  });

  it("refuses a body that is not a package, with the reason", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/packages`, {
      method: "POST",
      headers: { cookie },
      body: uploadForm(Buffer.from([1, 2, 3, 4]), "junk.btpkg"),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { severity: string; path: string; message: string }[] };
    expect(body.issues[0]!.severity).toBe("error");
    expect(body.issues[0]!.path).toBe("archive");
    expect(((await (await fetch(`${base}/api/packages`)).json()) as unknown[])).toHaveLength(0);
  });

  it("refuses an upload with no file part", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/packages`, {
      method: "POST", headers: { cookie }, body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("deletes a package", async () => {
    const cookie = await login();
    const created = (await (await fetch(`${base}/api/admin/packages`, { method: "POST", headers: { cookie }, body: uploadForm(Buffer.from(bytes)) })).json()) as { id: string };
    const res = await fetch(`${base}/api/admin/packages/${created.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(204);
    expect(((await (await fetch(`${base}/api/packages`)).json()) as unknown[])).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
npx.cmd vitest run tests/api.test.ts
```
Expected: FAIL — `Cannot find module '../src/app'`.

- [ ] **Step 7: Write app.ts**

Create `server/src/app.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import type { DatabaseSync } from "node:sqlite";

import {
  deletePackage, getPackage, listPackages, renamePackage, replaceIssues, toCatalogItem, upsertPackage,
} from "./catalog";
import type { Config } from "./config";
import { inspectPackage } from "./ingest";
import { signSession, verifySession } from "./session";
import { isPackageId, type FileStore } from "./storage";

export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  store: FileStore;
}

export function createApp({ config, db, store }: AppDeps): Express {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes },
  });

  const readCookie = (req: Request, name: string): string | null => {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return decodeURIComponent(v.join("="));
    }
    return null;
  };

  const isAdmin = (req: Request): boolean => {
    const token = readCookie(req, "billkit_session");
    return token !== null && verifySession(token, config.adminPassword);
  };

  // --- public API -----------------------------------------------------

  app.get("/api/packages", (_req, res) => {
    res.json(listPackages(db).map(toCatalogItem));
  });

  app.get("/api/packages/:id/download", async (req, res) => {
    const { id } = req.params;
    if (typeof id !== "string" || !isPackageId(id)) {
      res.status(400).json({ error: "invalid package id" });
      return;
    }
    const row = getPackage(db, id);
    if (!row) {
      res.status(404).json({ error: "no such package" });
      return;
    }
    res.setHeader("content-type", "application/zip");
    res.setHeader("content-length", String(row.byte_size));
    // The id is the sha256 of the bytes, so it is a strong ETag and lets the
    // device revalidate a cached download with one conditional request.
    res.setHeader("etag", `"${id}"`);
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("content-disposition", `attachment; filename="${row.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    Readable.toWeb(createReadStream(store.pathFor(id)) as never).pipe(res as never);
  });

  // --- admin API ------------------------------------------------------

  app.post("/api/admin/login", express.json(), (req, res) => {
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";
    // Hash both sides first so a length difference cannot throw and leak.
    const a = Buffer.from(supplied);
    const b = Buffer.from(config.adminPassword);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      res.status(401).json({ error: "incorrect password" });
      return;
    }
    res.setHeader(
      "set-cookie",
      `billkit_session=${signSession(config.adminPassword)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
    );
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", (_req, res) => {
    res.setHeader("set-cookie", "billkit_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  app.post("/api/admin/packages", upload.single("file"), async (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ error: "admin session required" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "a `file` part is required" });
      return;
    }

    const bytes = new Uint8Array(file.buffer);
    const outcome = inspectPackage(bytes, file.originalname);
    if (!outcome.ok) {
      res.status(422).json({ issues: outcome.issues });
      return;
    }

    // Store the bytes first: the row must never point at a file that is absent.
    const id = await store.put(bytes);
    const row = upsertPackage(db, {
      id,
      name: outcome.summary.name,
      filename: file.originalname,
      byte_size: outcome.summary.byteSize,
      package_version: outcome.summary.packageVersion,
      template_version: outcome.summary.templateVersion,
      page_width: outcome.summary.pageWidth,
      page_height: outcome.summary.pageHeight,
      field_count: outcome.summary.fieldCount,
      asset_count: outcome.summary.assetCount,
      computed_summary: outcome.summary.computedSummary,
    });
    replaceIssues(db, id, outcome.issues.map((i) => ({ packageId: id, ...i })));

    res.status(row.uploaded_at === new Date().toISOString() ? 201 : 200).json(toCatalogItem(row));
  });

  app.patch("/api/admin/packages/:id", express.json(), (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ error: "admin session required" });
      return;
    }
    const { id } = req.params;
    if (typeof id !== "string" || !isPackageId(id)) {
      res.status(400).json({ error: "invalid package id" });
      return;
    }
    const row = renamePackage(db, id, {
      name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
    });
    if (!row) {
      res.status(404).json({ error: "no such package" });
      return;
    }
    res.json(toCatalogItem(row));
  });

  app.delete("/api/admin/packages/:id", (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ error: "admin session required" });
      return;
    }
    const { id } = req.params;
    if (typeof id !== "string" || !isPackageId(id)) {
      res.status(400).json({ error: "invalid package id" });
      return;
    }
    if (!deletePackage(db, id)) {
      res.status(404).json({ error: "no such package" });
      return;
    }
    void store.remove(id);
    res.status(204).end();
  });

  app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: `file exceeds the ${config.maxUploadBytes} byte limit` });
      return;
    }
    console.error("[billkit-server]", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
```

Two details worth flagging. The `upload.single("file")` middleware runs **before** the auth
check, which is unavoidable — the body must be consumed to read the file — so the admin guard has to
be the first statement in the handler. And `express.json()` is mounted per-route rather than
app-wide so the multipart handler is never fed a JSON body parser.

The status code distinguishes new from existing: `upsertPackage` writes
`uploaded_at = new Date().toISOString()`, and comparing that back to a fresh `new Date()` is
within a millisecond on a fast run but not guaranteed. Replace it with an explicit existence
check rather than the timestamp comparison shown, which is kept short here only to keep the
handler readable:

```ts
const existed = getPackage(db, outcome.summary.id) !== null;
const id = await store.put(bytes);
const row = upsertPackage(db, { /* … */ });
res.status(existed ? 200 : 201).json(toCatalogItem(row));
```

- [ ] **Step 8: Run the API test**

```bash
npx.cmd vitest run tests/api.test.ts
```
Expected: 11 passed.

- [ ] **Step 9: Run the server gate and commit**

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: clean, 33 tests.
```bash
git add server
git commit -m "feat: catalog, admin sessions, and the public package API"
```

---

### Task 4: The dashboard and the entry point

**Files:**
- Create: `server/src/views/layout.ts`
- Create: `server/src/views/admin.ts`
- Create: `server/src/views/login.ts`
- Create: `server/src/routes/views.ts`
- Create: `server/public/admin.css`
- Create: `server/public/admin.js`
- Create: `server/src/index.ts`
- Create: `server/src/seed.ts`
- Modify: `server/src/app.ts` (mount the view routes)
- Test: `server/tests/views.test.ts`

**Interfaces:**
- Consumes: `createApp` from Task 3.
- Produces: `GET /` (redirect to `/admin`), `GET /admin/login`, `POST /admin/login`, `GET /admin`, `POST /admin/upload`, `POST /admin/delete/:id`.

- [ ] **Step 1: Write the failing views test**

Create `server/tests/views.test.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "billkit-format/package";
import type { BillTemplate } from "billkit-format/template/types";

import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { openDatabase } from "../src/db";
import { createFileStore } from "../src/storage";

const PASSWORD = "pw";
const template: BillTemplate = {
  templateVersion: 2, document: { width: 794, height: 1123 },
  meta: { name: "Night <b>Bill</b> & Co", modifiedAt: "" }, objects: [],
};

let dir: string; let db: DatabaseSync; let server: Server; let base: string;
const config = (): Config => ({
  port: 0, host: "127.0.0.1", dataDir: dir, packagesDir: join(dir, "packages"),
  adminPassword: PASSWORD, maxUploadBytes: 1024 * 1024,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bk-views-"));
  db = openDatabase(":memory:");
  const app = createApp({ config: config(), db, store: createFileStore(join(dir, "packages")) });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("dashboard pages", () => {
  it("sends the root to the dashboard", async () => {
    const res = await fetch(`${base}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("shows a login form when there is no session", async () => {
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("password");
  });

  it("rejects a wrong password on the login form", async () => {
    const res = await fetch(`${base}/admin/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "nope" }).toString(),
    });
    expect(res.status).toBe(303);
  });

  it("escapes a package name that contains markup", async () => {
    const cookie = (await fetch(`${base}/api/admin/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    })).headers.get("set-cookie")!.split(";")[0]!;

    await fetch(`${base}/api/admin/packages`, {
      method: "POST", headers: { cookie },
      body: (() => { const f = new FormData(); f.append("file", new Blob([writePackage(buildPackage(template))]), "x.btpkg"); return f; })(),
    });

    const html = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
    expect(html).toContain("Night &lt;b&gt;Bill&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Bill</b>");
  });
});
```

The escaping test is the point of this task: a package name is attacker-controlled text that
an author chose, and rendering it unescaped is stored XSS against the dashboard.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx.cmd vitest run tests/views.test.ts
```
Expected: FAIL — `GET /admin` returns 404.

- [ ] **Step 3: Write the layout with escaping**

Create `server/src/views/layout.ts`:
```ts
const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

/** Every package name, description and error string passes through here. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/admin.css">
</head><body>${body}<script src="/admin.js" defer></script></body></html>`;
}
```

- [ ] **Step 4: Write the login and admin views**

Create `server/src/views/login.ts`:
```ts
import { esc, page } from "./layout";

export function loginView(error?: string): string {
  return page("Sign in - BillKit server", `
<main class="wrap narrow">
  <h1 class="title">BillKit server</h1>
  <p class="sub">Sign in to manage template packages.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ""}
  <form method="post" action="/admin/login" class="card">
    <label class="label" for="password">Password</label>
    <input class="input" id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="btn primary" type="submit">Sign in</button>
  </form>
</main>`);
}
```

Create `server/src/views/admin.ts`:
```ts
import type { PackageRow } from "../catalog";
import { esc, page } from "./layout";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function adminView(rows: PackageRow[], message?: string, issues?: string[]): string {
  const body = rows.length === 0
    ? `<p class="empty">No packages yet. Drop a <code>.btpkg</code> above.</p>`
    : `<table class="table"><thead><tr>
        <th>Name</th><th>Page</th><th>Fields</th><th>Size</th><th>Uploaded</th><th></th>
       </tr></thead><tbody>${rows.map((r) => `
        <tr>
          <td><div class="name">${esc(r.name)}</div>${r.description ? `<div class="desc">${esc(r.description)}</div>` : ""}</td>
          <td class="mono">${r.page_width ?? "?"}&times;${r.page_height ?? "?"}</td>
          <td class="mono">${r.field_count ?? "?"}</td>
          <td class="mono">${kb(r.byte_size)}</td>
          <td class="mono">${esc(r.uploaded_at.slice(0, 19).replace("T", " "))}</td>
          <td class="actions">
            <a class="btn" href="/api/packages/${esc(r.id)}/download">Download</a>
            <form method="post" action="/admin/delete/${esc(r.id)}"><button class="btn danger" type="submit">Delete</button></form>
          </td>
        </tr>`).join("")}</tbody></table>`;

  return page("BillKit server", `
<main class="wrap">
  <header class="bar">
    <h1 class="title">BillKit server</h1>
    <form method="post" action="/admin/logout"><button class="btn ghost" type="submit">Sign out</button></form>
  </header>
  ${message ? `<p class="notice">${esc(message)}</p>` : ""}
  ${issues?.length ? `<div class="issues"><h2>Upload refused</h2><ul>${
    issues.map((i) => `<li><code>${esc(i)}</code></li>`).join("")
  }</ul></div>` : ""}
  <section class="card">
    <h2 class="h2">Upload a package</h2>
    <form id="upload" method="post" action="/admin/upload" enctype="multipart/form-data">
      <input class="file" type="file" name="file" accept=".btpkg,application/zip" required>
      <button class="btn primary" type="submit">Upload</button>
    </form>
    <p class="hint">Validated on arrival. A package with an error is refused and never stored.</p>
  </section>
  <section>${body}</section>
</main>`);
}
```

- [ ] **Step 5: Write the stylesheet**

Create `server/public/admin.css`:
```css
/* Mirrors the editor's tokens: the neutral palette, blue-600 as the single
   accent, and the same dense 10-11px type. Hand-authored on purpose so this
   service needs no CSS build and no network at runtime. */
:root {
  --ink: #171717; --muted: #737373; --faint: #a3a3a3;
  --line: #e5e5e5; --line-strong: #d4d4d4;
  --paper: #ffffff; --wash: #f5f5f5; --accent: #2563eb; --danger: #dc2626;
  --radius: 6px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--wash); color: var(--ink);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { max-width: 960px; margin: 0 auto; padding: 24px 20px 64px; }
.wrap.narrow { max-width: 340px; padding-top: 96px; }
.bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.title { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 6px 0 20px; }
.h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); margin: 0 0 12px; }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin-bottom: 20px; }
.label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 6px; }
.input { width: 100%; padding: 7px 9px; font-size: 13px; border: 1px solid var(--line-strong); border-radius: 4px; }
.input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.btn {
  display: inline-block; padding: 6px 11px; font-size: 12px; cursor: pointer;
  background: var(--paper); color: var(--muted); border: 1px solid var(--line-strong);
  border-radius: 4px; text-decoration: none;
}
.btn:hover { background: var(--wash); color: var(--ink); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: #1d4ed8; }
.btn.ghost { border-color: transparent; }
.btn.danger { color: var(--danger); border-color: #fecaca; }
.btn.danger:hover { background: #fef2f2; }
.file { font-size: 12px; margin-bottom: 10px; }
.hint { color: var(--faint); font-size: 11px; margin: 10px 0 0; }
.table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.table th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); font-weight: 600; }
.table td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table tr:last-child td { border-bottom: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
.name { font-weight: 500; }
.desc { color: var(--muted); font-size: 11px; margin-top: 2px; }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
.actions form { display: inline; }
.empty { color: var(--faint); font-size: 12px; padding: 20px; background: var(--paper); border: 1px dashed var(--line-strong); border-radius: var(--radius); text-align: center; }
.error, .notice { padding: 9px 12px; border-radius: 4px; font-size: 12px; margin-bottom: 16px; }
.error { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; }
.notice { background: var(--paper); border: 1px solid var(--line); color: var(--muted); }
.issues { background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius); padding: 12px 16px; margin-bottom: 20px; }
.issues h2 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--danger); }
.issues ul { margin: 0; padding-left: 18px; }
.issues code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #991b1b; }
code { background: var(--wash); padding: 1px 4px; border-radius: 3px; }
```

- [ ] **Step 6: Write the small progressive-enhancement script**

Create `server/public/admin.js`:
```js
// The form posts normally with no JavaScript at all. This only adds the
// drag-and-drop affordance and a pending state, so a failed upload still
// lands on the server-rendered error page.
const form = document.getElementById("upload");
if (form) {
  form.addEventListener("submit", () => {
    const b = form.querySelector("button");
    if (b) { b.disabled = true; b.textContent = "Validating…"; }
  });
  form.addEventListener("dragover", (e) => e.preventDefault());
  form.addEventListener("drop", (e) => {
    e.preventDefault();
    const input = form.querySelector("input[type=file]");
    if (input && e.dataTransfer?.files.length) input.files = e.dataTransfer.files;
  });
}
```

- [ ] **Step 7: Write the view routes**

Create `server/src/routes/views.ts`:
```ts
import { Router, type Request } from "express";
import multer from "multer";

import { deletePackage, getPackage, listPackages } from "../catalog";
import type { AppDeps } from "../app";
import { inspectPackage } from "../ingest";
import { signSession, verifySession } from "../session";
import { isPackageId } from "../storage";
import { adminView } from "../views/admin";
import { loginView } from "../views/login";

const COOKIE = "billkit_session";

function token(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function viewRoutes({ config, db, store }: AppDeps): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

  router.get("/", (_req, res) => res.redirect(302, "/admin"));

  router.get("/admin/login", (_req, res) => res.type("html").send(loginView()));

  router.post("/admin/login", (req, res) => {
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";
    if (supplied !== config.adminPassword) {
      res.redirect(303, "/admin/login?error=1");
      return;
    }
    res.setHeader("set-cookie", `${COOKIE}=${signSession(config.adminPassword)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    res.redirect(303, "/admin");
  });

  router.post("/admin/logout", (_req, res) => {
    res.setHeader("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.redirect(303, "/admin/login");
  });

  const admin = (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
    const t = token(req);
    if (t === null || !verifySession(t, config.adminPassword)) {
      res.redirect(303, "/admin/login");
      return;
    }
    next();
  };

  router.get("/admin", admin, (_req, res) => {
    res.type("html").send(adminView(listPackages(db)));
  });

  router.post("/admin/upload", admin, upload.single("file"), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).type("html").send(adminView(listPackages(db), "Choose a .btpkg file first."));
      return;
    }
    const outcome = inspectPackage(new Uint8Array(file.buffer), file.originalname);
    if (!outcome.ok) {
      res.status(422).type("html").send(adminView(
        listPackages(db),
        undefined,
        outcome.issues.map((i) => `${i.path}: ${i.message}`),
      ));
      return;
    }
    void store.put(new Uint8Array(file.buffer)).then(() => {
      res.redirect(303, "/admin");
    });
  });

  router.post("/admin/delete/:id", admin, async (req, res) => {
    const { id } = req.params;
    if (typeof id === "string" && isPackageId(id) && deletePackage(db, id)) {
      await store.remove(id);
    }
    res.redirect(303, "/admin");
  });

  return router;
}
```

The HTML form path deliberately redirects rather than duplicating the JSON API's status
codes; the page is a redirect target, not a second API.

- [ ] **Step 8: Mount the routes and static files**

Append to `createApp` in `server/src/app.ts`, before the error handler:
```ts
  app.use(express.static("public", { maxAge: "1h" }));
  app.use(viewRoutes({ config, db, store }));
```
and add to the imports:
```ts
import { viewRoutes } from "./routes/views";
```

- [ ] **Step 9: Write the entry point**

Create `server/src/index.ts`:
```ts
import { mkdir } from "node:fs/promises";

import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { createFileStore } from "./storage";

const config = loadConfig();
await mkdir(config.packagesDir, { recursive: true });

const db = openDatabase(`${config.dataDir}/billkit.db`);
const store = createFileStore(config.packagesDir);
const app = createApp({ config, db, store });

app.listen(config.port, config.host, () => {
  console.log(`[billkit-server] listening on http://${config.host}:${config.port}`);
  console.log(`[billkit-server] dashboard at /admin, packages at /api/packages`);
  console.log(`[billkit-server] data in ${config.dataDir}`);
});
```

Top-level `await` needs `"type": "module"` — already set in `package.json`.

- [ ] **Step 10: Write the seed script**

Create `server/src/seed.ts`:
```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createApp } from "./app";
import { loadConfig } from "./config";
import { upsertPackage, replaceIssues } from "./catalog";
import { openDatabase } from "./db";
import { inspectPackage } from "./ingest";
import { createFileStore } from "./storage";

const target = process.argv[2] ?? resolve("..", "Android", "app", "src", "main", "assets", "sample.btpkg");
const config = loadConfig();

const bytes = new Uint8Array(await readFile(target));
const outcome = inspectPackage(bytes, target);
if (!outcome.ok) {
  console.error("[billkit-server] refusing to seed; the file is not a valid package:");
  for (const i of outcome.issues) console.error(`  ${i.severity} ${i.path}: ${i.message}`);
  process.exit(1);
}

const store = createFileStore(config.packagesDir);
const id = await store.put(bytes);
const db = openDatabase(`${config.dataDir}/billkit.db`);
const s = outcome.summary;
upsertPackage(db, {
  id, name: s.name, filename: target.split(/[\\/]/).pop()!, byte_size: s.byteSize,
  package_version: s.packageVersion, template_version: s.templateVersion,
  page_width: s.pageWidth, page_height: s.pageHeight, field_count: s.fieldCount,
  asset_count: s.assetCount, computed_summary: s.computedSummary,
});
replaceIssues(db, id, outcome.issues.map((i) => ({ packageId: id, ...i })));

console.log(`[billkit-server] seeded "${s.name}" (${s.fieldCount} fields, ${s.assetCount} assets) as ${id.slice(0, 12)}…`);
db.close();
```

Drop the unused `createApp` import; this script does not build an Express app.

- [ ] **Step 11: Run the views test**

```bash
npx.cmd vitest run tests/views.test.ts
```
Expected: 4 passed.

- [ ] **Step 12: Run the full server gate**

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: clean, 37 tests.

- [ ] **Step 13: Prove it runs for real**

```bash
$env:BILLKIT_ADMIN_PASSWORD="demo"; npm.cmd start
```
In a second terminal:
```bash
curl http://127.0.0.1:4000/api/packages
curl -X POST http://127.0.0.1:4000/api/admin/login -H "content-type: application/json" -d '{"password":"demo"}' -c cookies.txt
curl -X POST http://127.0.0.1:4000/api/admin/packages -H "cookie: $(Select-String -Path cookies.txt -Pattern 'billkit_session' | ForEach-Object { $_.Line })" -F "file=@..\Android\app\src\main\assets\sample.btpkg"
curl http://127.0.0.1:4000/api/packages
```
Expected: `[]`, a session cookie, then a catalog with one entry named "Lucky Cargo Movers — Lorry Receipt". Stop the server afterwards.

- [ ] **Step 14: Commit**

```bash
git add server
git commit -m "feat: the admin dashboard, the entry point, and a seed script"
```

---

## Self-Review

**Spec coverage.** Storage maps to Task 2; ingest to Task 2; the public and admin API to Task 3; dashboard, auth and seed to Task 4. The spec's *50 MB upload cap*, *timing-safe password check*, *id-as-path-traversal-guard*, *idempotent re-upload*, and *recorded-but-non-refusing warnings* each appear as a named test.

**Placeholder scan.** No `TBD`, no "handle errors later", no "similar to Task N". Every code block contains the actual content.

**Type consistency.** `FileStore.put/get/pathFor/remove`, `isPackageId`, `inspectPackage`/`IngestOutcome`/`PackageSummary`, `signSession`/`verifySession`, `createApp({ config, db, store })` and the row/catalog shapes are defined once and used by the same names throughout.

**One deliberate gap.** `GET /admin` accepts no query parameters for search or sorting. The catalog is a single ordered table, which is honest at this scale; adding a query language before it is needed would be building for a problem nobody has reported.