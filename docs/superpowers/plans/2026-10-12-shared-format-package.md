# Shared Format Package - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `.btpkg` format implementation into a standalone `billkit-format` package that both the editor and the future backend import, changing no importer in the editor.

**Architecture:** Twelve pure modules move to `Prototype/shared/billkit-format/`. Every one is replaced *in place* in the editor by a one-line `export *` shim, so the 52 files importing `@/lib/template/types` (and the other 73 importer sites) are untouched. Subpath exports preserve module identity, because `template/types.ts` and `dataBinding.ts` both export a *different* `FieldType` and a flat barrel would silently pick one.

**Tech Stack:** TypeScript 5, npm workspaces, vitest, Next.js 16 `transpilePackages`, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-12-template-server-design.md` — see *Shared format package*.

## Global Constraints

- **Zero importer edits.** No file may change an import of `@/lib/...` because of this plan. The 634-test web gate is the proof.
- **Subpath exports only.** No flat barrel. `template/types` and `template/dataBinding` both export `FieldType` with different meanings.
- **No build step for the shared package.** Consumers transpile the TypeScript source (`transpilePackages` for Next, esbuild natively for vitest/esbuild CLI).
- **Purity is enforced on real sources.** `BANNED` patterns: `fabric`, `react`, `next/`, `lib/canvas`, `Date`, `Math.random`, `Intl`, `toLocaleString`, `crypto`, `fetch`, `document.`, `window.`
- **Never commit `node_modules`, `Prototype/data/`, or `Prototype/server/data/`.**
- **No `git push`** at any point.
- Web gate is exactly: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`.
- Baseline before starting: **634 tests, 33 files, all passing.**

---

### Task 1: Workspace root and shared package skeleton

The highest-risk task in the plan, done alone on purpose. `version 1` contains a space and has no scope prefix, and a broken package layout would invalidate Tasks 2-4. It ships no behaviour change.

**Two repositories, not one workspace.** The existing repo's root is `Prototype/version 1` — the editor
itself — so nothing under `Prototype/` can be tracked from it. `shared/` and `server/` therefore live
in a **second repository rooted at `Prototype/`**, and the editor consumes the format package through
a `file:` dependency. `version 1` is never a workspace member, which keeps the editor's `allowScripts`
field authoritative and leaves the existing repo, its remote, and its linked worktree untouched.

**Files:**
- Create: `Prototype/.gitignore`
- Create: `Prototype/package.json` (workspace root for `shared/*` and `server` only)
- Create: `Prototype/shared/billkit-format/package.json`
- Create: `Prototype/shared/billkit-format/tsconfig.json`
- Create: `Prototype/shared/billkit-format/vitest.config.ts`
- Create: `Prototype/shared/billkit-format/index.ts`
- Create: `Prototype/shared/billkit-format/tests/smoke.test.ts`
- Modify: `version 1/package.json` — add the `billkit-format` `file:` dependency
- Modify: `version 1/.gitignore` — ignore the installed copy of the linked package

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a `billkit-format` package resolvable from `version 1` by package name, whose `index.ts`
  exports `PACKAGE_VERSION`. Tasks 2-4 add subpaths to it.

- [ ] **Step 1: Record the baseline before touching anything**

Run from `Prototype\version 1`:
```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: typecheck exit 0, lint clean, `Test Files 33 passed`, `Tests 634 passed`.
Record the output in the task notes. If this is not green, stop — the baseline is already broken and this plan is not the cause.

- [ ] **Step 2: Create the pipeline repo and its workspace root**

`Prototype/` becomes a second git repository. It holds `shared/`, `server/`, and the pipeline docs
that live beside them — and nothing from `version 1`.

```bash
cd "C:\Users\Lenovo\Desktop\Personal Project\Prototype"
git init
```

Create `Prototype/package.json`:
```json
{
  "name": "billkit-pipeline",
  "private": true,
  "workspaces": ["shared/*", "server"]
}
```

`"version 1"` is deliberately **absent**: it is a member of a different repository. Listing it would
make npm hoist across repos and, worse, silently disable `allowScripts` — npm honours that field
only at a workspace root, and dropping the editor to a non-root member cost it the approved install
scripts for `canvas` (a native build).

`server` does not exist yet. npm tolerates a workspace glob that matches nothing yet, and Plan 2 creates it.

- [ ] **Step 3: Create the shared package manifest**

Create `Prototype/shared/billkit-format/package.json`:
```json
{
  "name": "billkit-format",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./index.ts",
  "exports": {
    ".": "./index.ts",
    "./package": "./package/index.ts",
    "./package/*": "./package/*.ts",
    "./template/types": "./template/types.ts",
    "./template/placeholders": "./template/placeholders.ts",
    "./template/dataBinding": "./template/dataBinding.ts",
    "./render/sha256": "./render/sha256.ts",
    "./render/values": "./render/values.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "fflate": "^0.8.3"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

`fflate` is declared here rather than left to resolve by accident. The moved `build.ts` and
`parse.ts` both import it; without a declaration this package only works while npm hoists the
*editor's* copy into a shared `node_modules`, which is exactly the accidental coupling that
makes a package unpublishable later. A package declares what it imports.

`typescript` and `vitest` are pinned to the same **majors** the editor uses, so one
`tsc`/`vitest` mental model covers the workspace. `vitest` and `typescript` are hoisted from
the workspace root, but declaring them keeps the package installable on its own.

The `./*` wildcard entry keeps the subpath list short; the three explicit template/render entries exist because those are the paths the editor's shims name.

- [ ] **Step 4: Create the shared package tsconfig and vitest config**

Create `Prototype/shared/billkit-format/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2017", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"]
}
```

`"DOM"` is in `lib` deliberately and is not a purity violation: the two guarded base64 calls (`atob` in build, `btoa` in resolve) are declared there and are the only web touch points. They throw loudly rather than degrade.

Create `Prototype/shared/billkit-format/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create a placeholder barrel that the smoke test pins**

Create `Prototype/shared/billkit-format/index.ts`:
```ts
export const PACKAGE_VERSION = 1 as const;
```

Task 2 replaces this with the real barrel.

- [ ] **Step 6: Write the failing smoke test**

Create `Prototype/shared/billkit-format/tests/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "billkit-format";

describe("billkit-format", () => {
  it("resolves by package name from inside the workspace", () => {
    expect(PACKAGE_VERSION).toBe(1);
  });
});
```

- [ ] **Step 7: Install the pipeline workspace**

Run from `Prototype`:
```bash
npm.cmd install
```
Expected: no `ERESOLVE`, no workspace errors. This installs `shared/*` only; `server` is added in Plan 2.

- [ ] **Step 8: Link the package into the editor**

Add to `version 1/package.json` `dependencies`, alongside the existing entries:
```json
    "billkit-format": "file:../shared/billkit-format",
```

Then run from `Prototype\version 1`:
```bash
npm.cmd install
```

npm links a local `file:` directory rather than copying it, so `node_modules/billkit-format` is a
symlink to `../shared/billkit-format`. That is what keeps the `.ts` entry points live for the
shims in Task 2 and for Next's `transpilePackages` in Task 4 — a copy would go stale the moment
either side changed.

Confirm the link, and that it points outside this repo as intended:
```bash
(Get-Item node_modules\billkit-format).LinkType
(Get-Item node_modules\billkit-format).Target
```
Expected: `LinkType` reports a link/junction and the target is the `shared/billkit-format` directory.
If npm copied instead of linking, that is a real problem — report it rather than working around it.

Add to `version 1/.gitignore`:
```gitignore
node_modules/billkit-format
```
The link points outside the repository; committing a symlink would break on every other clone.

- [ ] **Step 9: Verify the shared package's own test passes**

Run from `Prototype\shared\billkit-format`:
```bash
npx.cmd vitest run
```
Expected: `1 passed`. This proves the package resolves by name in both repos, which is the single
precondition Tasks 2-4 rest on.

If it cannot resolve, the root install or the `file:` link is broken — report BLOCKED with both
commands' output rather than proceeding on a broken link.

- [ ] **Step 10: Confirm the editor is untouched by the new link**

Run from `Prototype\version 1`:
```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: **identical to the Step 1 baseline** — 634 passed. Adding a dependency must not perturb
the app that already works; if a test count moves, the install changed something it should not have.

- [ ] **Step 11: Add the pipeline repo's .gitignore**

Create `Prototype/.gitignore`:
```gitignore
node_modules/
data/
.next/
server/data/
server/.env
```

`server/.env` holds `BILLKIT_ADMIN_PASSWORD`. It must be uncommittable from the first commit, not
added to the ignore list after someone has already pushed it.

- [ ] **Step 12: Commit — in both repositories**

The pipeline repo first. From `Prototype`:
```bash
git add package.json .gitignore shared
git commit -m "chore: start the pipeline repo with the billkit-format package"
```

Then the editor repo, which gained only the dependency and the ignore rule. From
`Prototype\version 1`:
```bash
git add package.json .gitignore
git commit -m "build: depend on the shared billkit-format package"
```

Stage **explicit paths**. This repo carries substantial pre-existing uncommitted work (the editor's
`.btpkg` export, `lib/billkit/`, `tools/`, and more); `git add -A` here would sweep all of it into
this commit. Verify with `git status` before committing that only those two files are staged.

- [ ] **Step 13: Confirm the two repos are clean and distinct**

```bash
# from Prototype/
git status --short
# from Prototype/version 1/
git status --short
```
Expected: the pipeline repo reports only your own pre-existing untracked files; the editor repo
still lists its pre-existing uncommitted work, unchanged from Step 1.

---

### Task 2: Move the format modules behind re-export shims

**Files:**
- Copy + delete: the 12 sources move from `version 1/lib/...` to `shared/billkit-format/...` (across repositories, so `git mv` cannot be used)
- Create: `shared/billkit-format/package/index.ts`
- Create: 12 shims at the original `version 1/lib/...` paths
- Modify: the moved files' internal imports only

**Interfaces:**
- Consumes: `billkit-format` package resolution from Task 1.
- Produces: `billkit-format/package`, `billkit-format/template/types`, `billkit-format/template/placeholders`, `billkit-format/template/dataBinding`, `billkit-format/render/sha256`, `billkit-format/render/values`, each exporting **exactly** what it exported before the move.

- [ ] **Step 1: Copy the twelve files across, then delete them from the editor repo**

The destination is in a **different repository**, so `git mv` cannot do this — git will refuse any
path outside its work tree. The move is therefore a copy into the pipeline repo plus a deletion
recorded in the editor repo. That is not a downgrade: the content keeps its history in
`version 1` up to the move commit, and lives in full in the pipeline repo from the copy commit on.

From `Prototype\version 1`:
```bash
$files = @(
  "lib/package/format.ts","lib/package/build.ts","lib/package/parse.ts",
  "lib/package/validate.ts","lib/package/resolve.ts","lib/package/form.ts",
  "lib/package/computedSpecs.ts",
  "lib/template/types.ts","lib/template/placeholders.ts","lib/template/dataBinding.ts",
  "lib/render/sha256.ts","lib/render/values.ts"
)
foreach ($f in $files) {
  $dest = "../shared/billkit-format/$f"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item $f $dest
}
```

Then confirm twelve files landed and the byte counts match before deleting anything:
```bash
Get-ChildItem "..\shared\billkit-format" -Recurse -Filter *.ts | Select-Object FullName, Length
```

Only once that check passes, record the deletion in the editor repo:
```bash
git rm lib/package/format.ts lib/package/build.ts lib/package/parse.ts lib/package/validate.ts lib/package/resolve.ts lib/package/form.ts lib/package/computedSpecs.ts lib/template/types.ts lib/template/placeholders.ts lib/template/dataBinding.ts lib/render/sha256.ts lib/render/values.ts
```

Note `lib/package/computedSpecs.ts` is currently **untracked** (it has never been committed). `git rm`
will refuse it — delete it with `Remove-Item` instead, and expect the editor repo's diff to show
eleven deletions rather than twelve.

- [ ] **Step 2: Rewrite the moved files' internal imports to relative paths**

Inside `shared/billkit-format/`, every `@/lib/...` import must become relative. These are the **only** edits to moved content:

`package/build.ts` - six imports become:
```ts
import type { ComputedSpec, Package, PackageManifest } from "./format";
import { PACKAGE_VERSION } from "./format";
import { sha256HexBytes } from "../render/sha256";
import { extractTemplateFields } from "../template/dataBinding";
import { extractVariables } from "../template/placeholders";
import type { BillTemplate, TableObject, TemplateObject } from "../template/types";
```

`package/validate.ts`:
```ts
import { PACKAGE_VERSION } from "./format";
import { sha256HexBytes } from "../render/sha256";
import { TEMPLATE_VERSION } from "../template/types";
```
Leave its `import { ... } from "./format"` block (lines 1-24, types) as a relative path too.

`package/form.ts`:
```ts
import type { ComputedSpec, ManifestField, PackageManifest } from "./format";
import { extractVariables } from "../template/placeholders";
import type { BillTemplate, TableObject } from "../template/types";
import { DEFAULT_REPEAT_MAX_ITEMS } from "../template/types";
```

`package/parse.ts`:
```ts
import type { Package, PackageManifest } from "./format";
```

`package/resolve.ts`:
```ts
import type { Package } from "./format";
import type { BillTemplate, TemplateObject } from "../template/types";
import { TEMPLATE_VERSION } from "../template/types";
```

`package/computedSpecs.ts`:
```ts
import type { ComputedSpec } from "./format";
import type { BillTemplate, TableObject, TableRepeat, TemplateObject } from "../template/types";
```

`template/dataBinding.ts`:
```ts
import { extractVariables } from "./placeholders";
import { resolveText } from "../render/values";
import { ... , type BillTemplate } from "./types";
```

`package/format.ts`, `template/types.ts`, `template/placeholders.ts`, `render/sha256.ts`, `render/values.ts` have no cross-module imports and need no edits.

Verify nothing was missed:
```bash
Select-String -Path "shared\**\*.ts" -Pattern "@/lib/"
```
Expected: **no matches**.

- [ ] **Step 3: Create the package barrel**

Create `shared/billkit-format/package/index.ts`:
```ts
export { PACKAGE_VERSION } from "./format";
export type {
  ComputedOp,
  ComputedSpec,
  Issue,
  ManifestAsset,
  ManifestDocument,
  ManifestField,
  ManifestFieldType,
  ManifestFont,
  Package,
  PackageFile,
  PackageManifest,
  Severity,
} from "./format";
export { buildPackage, writePackage, type BuildOptions } from "./build";
export { parsePackage } from "./parse";
export { validateManifest, validatePackage } from "./validate";
export { resolvePackage } from "./resolve";
export { deriveForm, type FormField, type FormGroup, type FormSchema, type RepeatFieldSpec } from "./form";
export { computedSpecsFor } from "./computedSpecs";
```

Named exports, not `export *`: `manifest.json`'s consumer surface should be deliberate, and it keeps the `FieldType` collision structurally impossible.

- [ ] **Step 4: Create the twelve shims**

Each of these files replaces a moved one and is exactly one line. Write them all:

`version 1/lib/package/format.ts`:
```ts
export * from "billkit-format/package/format";
```
Repeat the same body for: `build.ts`, `parse.ts`, `validate.ts`, `resolve.ts`, `form.ts`, `computedSpecs.ts`, `lib/template/types.ts`, `lib/template/placeholders.ts`, `lib/template/dataBinding.ts`, `lib/render/sha256.ts`, `lib/render/values.ts`.

There are no export collisions **within** any single shim because each re-exports exactly one module.

- [ ] **Step 5: Run the web gate**

Run from `Prototype\version 1`:
```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
Expected: **634 passed, 33 files** — identical to baseline. If a test fails, an export was dropped in Task 2 Step 3; diff the failing module's `export` lines against the barrel before changing anything else.

- [ ] **Step 6: Confirm no importer was edited**

```bash
git status --short
```
Expected, in the **editor** repo: only the 12 deletions, the 12 shims, and the one untracked
`computedSpecs.ts` deletion. **Any file appearing here that is not one of the 24 violates the
plan's central constraint** — revert it and fix the export instead.

Then confirm the same in the **pipeline** repo, where the copies and the barrel live:
```bash
cd ..\shared\billkit-format
git status --short ..
```
Expected: the 12 copied files plus `package/index.ts`, and nothing else.

- [ ] **Step 7: Commit — pipeline repo first, then the editor repo**

From `Prototype` (pipeline repo):
```bash
git add shared/billkit-format
git commit -m "feat: carry the package format implementation"
```

From `Prototype\version 1` (editor repo):
```bash
git add lib/package lib/template lib/render
git commit -m "refactor: consume the format from billkit-format behind shims"
```

**Never `git add -A` in either repo.** This repository carries substantial pre-existing uncommitted
work that this plan must not absorb into its commits.

---

### Task 3: Make the purity guard cover the code that moved

`tests/render.test.ts` asserts purity by reading source text from a hardcoded directory. Once `sha256.ts` and `values.ts` are one-line shims, that scan passes while protecting nothing. Green must mean *checked*.

**Files:**
- Create: `shared/billkit-format/tests/purity.test.ts`
- Modify: `version 1/tests/render.test.ts` (the two `describe` blocks)

**Interfaces:**
- Consumes: the moved sources from Task 2.
- Produces: a suite that fails if a banned pattern is added to `shared/billkit-format/`, plus an editor suite that no longer claims to cover shimmed files.

- [ ] **Step 1: Write the failing purity test**

Create `shared/billkit-format/tests/purity.test.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const BANNED = [
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sources = () =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.startsWith("tests" + "/"))
    .map((f) => ({ file: f, src: readFileSync(join(root, f), "utf8") }));

describe("purity of billkit-format", () => {
  it("is not empty", () => {
    expect(sources().length).toBeGreaterThan(1);
  });

  it("imports no engine, no UI and nothing impure", () => {
    for (const { file, src } of sources()) {
      for (const re of BANNED) {
        expect(`${file}: ${re.source} ${re.test(src) ? "FOUND" : "ok"}`).toContain("ok");
      }
    }
  });
});
```

The `is not empty` test is the one that makes this suite trustworthy — without it, an empty or mis-pointed root makes the scan vacuously pass, which is the exact failure mode this task exists to prevent.

- [ ] **Step 2: Prove the guard actually fails**

Temporarily append to `shared/billkit-format/template/types.ts`:
```ts
// TEMPORARY
export const probe = () => new Date().toString();
```
Run `npx.cmd vitest run` in `shared/billkit-format`.
Expected: **FAIL**, reporting `Date` FOUND.

Remove the probe. Re-run.
Expected: **2 passed**.

Never commit the probe.

- [ ] **Step 3: Repoint the editor's purity scan**

In `version 1/tests/render.test.ts`, the `describe("purity of lib/render")` block scans `join(__dirname, "..", "lib", "render")`. `sha256.ts` and `values.ts` are now shims, so that scan reads two one-line re-export files and covers nothing.

Replace the `const dir = join(__dirname, "..", "lib", "render");` line inside that describe with a scan that skips shims and says so:
```ts
  // `sha256.ts` and `values.ts` are one-line re-export shims over
  // `billkit-format`; their real bodies are guarded by that package's own
  // purity suite. Scanning a shim would pass while checking nothing.
  const dir = join(__dirname, "..", "lib", "render");
  const SHIMMED = new Set(["sha256.ts", "values.ts"]);
  const sources = () =>
    sourcesIn(dir).filter(({ file }) => !SHIMMED.has(file.split("\\").pop() ?? file.split("/").pop() ?? ""));
```

Leave the `lib/billkit` block alone — nothing there moved.

- [ ] **Step 4: Confirm the editor suite still has something to scan**

Add temporarily to the same describe and run, then remove:
```ts
it("still scans more than one file", () => {
  expect(sources().length).toBeGreaterThan(1);
});
```
Expected: PASS. Remove it after confirming.

- [ ] **Step 5: Run the full gate**

From `Prototype\version 1`:
```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
From `Prototype/shared/billkit-format`:
```bash
npx.cmd vitest run
```
Expected: editor 634 passed; shared 2 passed.

- [ ] **Step 6: Commit — both repositories**

From `Prototype` (pipeline repo — the new purity suite lives here):
```bash
git add shared/billkit-format
git commit -m "test: guard purity on the shared package's own sources"
```

From `Prototype\version 1` (editor repo — the repointed scan lives here):
```bash
git add tests/render.test.ts
git commit -m "test: stop the render purity scan reading shims as sources"
```

Explicit paths only, in both repos.

---

### Task 4: Prove the editor's bundles and tools still build

The shims change what esbuild and Next resolve. A green `tsc` does not prove the esbuild bundle still builds — that is a separate resolver.

**Files:**
- Modify: `version 1/next.config.ts`
- Modify: `version 1/package.json` (only if a `transpilePackages` entry is needed)
- No test file; this task's deliverable is a working bundle.

**Interfaces:**
- Consumes: Task 2's shims.
- Produces: an unchanged `public/billkit.js` and a passing `npm run prepare:android-assets`.

- [ ] **Step 1: Record the current bundle size**

From `Prototype\version 1`:
```bash
(Get-Item public\billkit.js).Length
```
Expected: 27201. Keep the number; Step 3 compares against it.

- [ ] **Step 2: Tell Next to transpile the workspace package**

Add to `version 1/next.config.ts`:
```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  transpilePackages: ["billkit-format"],
};
```

Without this, Next treats the workspace package's raw `.ts` entry points as external and fails to compile them.

- [ ] **Step 3: Rebuild the host runtime bundle**

```bash
npm.cmd run build:billkit
(Get-Item public\billkit.js).Length
```
Expected: still ~27201 bytes. A large drop means a module failed to bundle rather than being inlined — investigate, do not accept the smaller file.

- [ ] **Step 4: Confirm the bundle still exports the bridge surface**

```bash
Select-String -Path public\billkit.js -Pattern "deriveForm"
```
Expected: at least one match. The bundle must still expose `window.billkit.deriveForm` and `window.billkit.render`, because `BillKitShell.kt` calls exactly those two.

- [ ] **Step 5: Prove the Android asset pipeline still runs end to end**

```bash
npm.cmd run prepare:android-assets
```
Expected: logs the package name, page, object/field/asset counts, band and computed keys, and a size near 589.8 KB. This script calls `buildPackage` through a shim, so it is a real integration check.

- [ ] **Step 6: Run the full web gate**

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```
Expected: all four clean; `Test Files 33 passed`, `Tests 634 passed`.

- [ ] **Step 7: Confirm only the generated Android assets changed**

The Android project is **not a git repository** and is not in either workspace, so `git status`
there would find no repo and fail. Check it directly instead:

```bash
Get-ChildItem "..\Android\app\src\main\assets" | Select-Object Name, Length, LastWriteTime
```
Expected: exactly `billkit.js` (~27201 bytes) and `sample.btpkg`, both freshly written — which is
correct, because Step 5 regenerates them on purpose. Nothing else under `..\Android` should have
a modification time from today.

```bash
Get-ChildItem "..\Android" -Recurse -File -Include *.kt,*.kts,*.xml |
  Where-Object { $_.LastWriteTime -gt (Get-Date).Date }
```
Expected: **no output**. No Kotlin, Gradle or manifest file may be touched by this plan; Plan 3
is the only plan that modifies Android.

- [ ] **Step 8: Commit**

From `Prototype\version 1` (the only repo this task changes):
```bash
git add next.config.ts
git commit -m "build: transpile the shared format package in Next"
```

Explicit paths only — this repository carries pre-existing uncommitted work that this plan must not
absorb.

---

## Self-Review

**Spec coverage.** Every clause of the spec's *Shared format package* section maps to a task: the verified import closure (Task 1 Step 1 / Task 2), the shim design and its rationale (Task 2 Steps 4-6), the `hydrate.ts` boundary (Task 2 Step 2 — it is not moved), the workspace-root risk with the `file:` fallback (Task 1 Steps 7-8), and the purity-guard trap (Task 3).

**Deliberately out of this plan.** The backend and dashboard (Plan 2) and the Android templates feature (Plan 3) are separate documents. This plan is the prerequisite for the first and makes the second possible; bundling them would make every task depend on reading two other documents.

**Type consistency.** `PACKAGE_VERSION`, `buildPackage`, `writePackage`, `parsePackage`, `validateManifest`, `validatePackage`, `resolvePackage`, `deriveForm`, `computedSpecsFor` are the same names the editor already exports, so every existing caller in `EditorController.ts`, `lib/export/toPackage.ts`, `lib/billkit/bridge.ts` and the tests keeps its current spelling.