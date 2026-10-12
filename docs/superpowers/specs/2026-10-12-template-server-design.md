# Template Server and Device Template Library - Design Spec

**Date:** 2026-10-12
**Status:** Design approved, awaiting implementation plan
**Extends:** `2026-10-08-billkit-package-design.md` (the `.btpkg` format this spec serves)

## Problem

The editor can now export a `.btpkg`, and the Android host can render one. But nothing joins
them. A template gets from the editor to a device by being emailed, dropped on a USB stick,
or hand-copied into `app/src/main/assets/` by a build script. That path has no catalog, no
discovery, and no way to publish an update.

Three gaps stand in the way:

1. **There is no publisher.** `Export ▸ Bill Package (.btpkg)` downloads bytes to the
   author's laptop. `tools/prepare-android-assets.ts` copies one hardcoded demo into the APK.
   There is no service that accepts a package, and therefore no place a template can be
   *available* to anyone but its author.
2. **There is no catalog.** Even given bytes, the device cannot ask "what exists?". The only
   template it knows is the one compiled into it, and the only way to load another is a file
   picker the user has to drive by hand.
3. **There is no Android-side network layer at all.** No HTTP client is on the classpath, no
   `INTERNET` permission is declared, and there is no local store. `PackageReader.open(ByteArray)`
   is a seam that nothing ever feeds except `assets/` and the SAF picker.

## Goals

- A standalone **Express + Node** service that **ingests, validates, stores and serves**
  `.btpkg` files, deployable and restartable independently of the editor.
- An admin dashboard where an author uploads a package and sees exactly why an upload was
  refused when it is refused.
- An Android **Templates screen** that lists what the server offers, downloads on demand,
  keeps it locally, and renders a chosen template through the existing fill/print flow.
- One implementation of the package format shared by every party that reads it.
- A device never stores a package it has not verified.

## Non-goals

- Authentication for the Android app. The catalog is readable by anyone who can reach the
  server; this is a trusted/internal-network deployment.
- A relational database server, object storage, or horizontal scaling.
- Background sync, push notifications, or delta updates. The app **pulls** when the user asks.
- Editing a template on the device, or publishing from the editor directly.
- Template version pinning, rollback, or a release channel on the device.
- Multi-page output (a pre-existing renderer limitation, unchanged here).
- Moving the Android project into the workspace. It stays an independent, untracked tree.

## Relationship to the existing package spec

`2026-10-08-billkit-package-design.md` defined the `.btpkg` archive and the `billkit.js`
host bridge, and it scoped a parse/validate/render client API that was **never implemented** -
the shipped bridge takes JSON strings, not a `Package`. This spec does not widen the format.
It treats the format as **settled** and builds the missing distribution layer around it.

The one thing it changes is *where the format code lives*: `lib/package` becomes a shared
workspace package so the editor and the new backend read it from one implementation. See
*Shared format package*.

## Architecture

```
Prototype/                    npm workspace root
├── version 1/      EDITOR     ─┐
├── server/         EXPRESS API + DASHBOARD ──┤ depends on ──┐
│                                            │            │
├── shared/         billkit-format ─────────┴────────────┤
│                  (.btpkg wire format)                   │
│                                                       ▼
│                                              shared/billkit-format
│                                  (parse · validate · derive · sha256)
└── Android/        HOST        ◄── HTTP + .btpkg bytes
                    (independent tree, not in the workspace)
```

Three consumers touch `.btpkg`: the editor (builds and exports), the backend (ingests,
validates, serves), and the Android host (downloads, verifies, renders). The first two are
TypeScript and **must** share an implementation; the third is Kotlin and necessarily
re-derives the shape as DTOs, which it already does.

### Why the backend never builds packages

The backend has no editor, no canvas, and no Fabric. Its entire package-facing job is
`parse → validate → describe`. Building is the editor's job alone. Keeping that line sharp is
what makes the shared package small enough to stay pure.

## Shared format package

`.btpkg` is now a **wire format between independently deployed processes**, which makes a
single implementation a correctness requirement rather than a tidiness preference. Two readers
of a binary format drift, and the symptom is quietly nasty: a package that validates in the
editor and then fails on a customer's device.

`shared/billkit-format/` becomes a real package at `Prototype/shared/billkit-format/`.

**Moves into it:**

The set is the **exact transitive `@/` closure** of `lib/package/*`, verified against the current
imports rather than guessed:

| From `version 1/` | Who needs it |
|---|---|
| `lib/package/*.ts` (7 files) | the format itself |
| `lib/render/sha256.ts` | `build` and `validate` |
| `lib/render/values.ts` | `template/dataBinding` (`resolveText`) |
| `lib/template/types.ts` | everywhere |
| `lib/template/placeholders.ts` | `build` and `form` (`extractVariables`) |
| `lib/template/dataBinding.ts` | `build` (`extractTemplateFields`) |

**What stays behind, and why it matters:** `lib/template/hydrate.ts` and `serialize.ts` do
*not* move. `hydrate.ts` imports `lib/canvas/objects/*` and `lib/canvas/fabricSetup`, so
following it would drag Fabric - a browser canvas library - into a package the backend runs
in Node. The boundary is exactly "everything the format needs that does not import the canvas",
and `hydrate.ts` is the file that draws the line.

**What it exports** - unchanged from today: `buildPackage`, `writePackage`, `parsePackage`,
`validatePackage`, `validateManifest`, `resolvePackage`, `deriveForm`, `computedSpecsFor`, and
the `Package` / `PackageManifest` / `Issue` / `FormSchema` types.

**What it must not gain:** `node:fs`, `node:crypto`, `document`, `window`, `fetch`, `Date`,
`Math.random`. This is not aspirational - the library is *already* isomorphic, verified by
running it under plain Node 24 with no shim. The two platform touch points it has,
`atob`/`btoa`, are guarded and throw loudly rather than degrade, because a silent empty
`Uint8Array` would produce a zero-byte asset with a *valid* checksum - a package that passes
validation and prints with a part missing.

The move is safe because the code is already dependency-light: its imports are relative and
`@/`-free today, so relocating the directory does not change a single internal import.

**Existing guards travel with it.** The purity test in `tests/render.test.ts` reads the
source files as text and asserts they match none of the banned patterns. It moves to the
shared package's own test suite and keeps guarding.

**Cost, measured rather than guessed.** The importer count of each moving file:

| Module | Files importing it |
|---|---|
| `lib/template/types` | **52** |
| `lib/template/placeholders` | 8 |
| `lib/template/dataBinding` | 7 |
| `lib/render/sha256` | 5 |
| `lib/render/values` | 2 |

`lib/template/types` alone reaches into every canvas object, every export format, the share
kit, the renderer and most tests. Rewriting those 52 imports by hand is a large, high-regression
edit to a suite that currently passes 634 tests.

**So nothing's imports change.** The editor keeps its `@/lib/...` paths; each moved module is
replaced in place by a one-line re-export shim:

```ts
// version 1/lib/template/types.ts  (after)
export * from "billkit-format/template/types";
```

A shim is not a second copy - it has no body to drift - so there is still exactly one
implementation, and it is the one the backend imports. The edit surface is the 12 moved files
plus 12 shims, all mechanical, with the existing green gate proving nothing broke. The 52
`@/lib/template/types` importers are untouched.

### The trap a shim introduces

`tests/render.test.ts` asserts purity by **reading source text** from a hardcoded directory:
`describe("purity of lib/render")` scans `join(__dirname, "..", "lib", "render")`. Once
`values.ts` and `sha256.ts` are shims, that scan keeps passing while no longer reading the
code it was written to protect - a silent loss of coverage on the exact guarantee this whole
design rests on.

The shared package therefore carries its own purity suite that scans **its own real sources**,
and the editor's existing scan is repointed so it stops pretending to cover files that have
moved. Green must mean checked, not merely unexamined.

### Workspace root

`Prototype/package.json` gains `"workspaces": ["shared/*", "version 1", "server"]`. Both apps
declare `"billkit-format": "*"`.

> **Risk.** `version 1` contains a space and does not begin with a scope character. Verify a
> clean `npm install` and a green web gate at the *root* before building anything on top of
> this. If the workspace root proves hostile, fall back to a `file:` dependency declared by
> each app, keeping the shared directory where it is; the shims above are what make this
> fallback cheap - only the 12 shims' import specifier changes, not the workspace layout.

## Backend

A standalone **Express 5 + Node** service at `Prototype/server/`, deployed independently of
the editor and sharing no runtime with it. It is plain TypeScript run through `tsx`; there is
no framework, no bundler and no build step for the service itself.

Express was chosen over embedding route handlers in the editor's Next.js app because the
service must be deployable and restartable on its own, with its own process, its own port and
its own lifecycle. Coupling its uptime to the editor's build was the thing to avoid.

Routes are plain Express middleware; the HTTP contract below is unchanged by the framework.

### Storage

`node:sqlite`'s `DatabaseSync` - no native compilation, and confirmed working on the
installed Node 24.18.1. Bytes live on disk, content-addressed.

```
server/data/
├── billkit.db               SQLite, WAL mode
└── packages/<sha256>.btpkg  raw bytes
```

The row `id` **is** the SHA-256 of the uploaded bytes. One decision, several properties:
re-uploading identical bytes is idempotent rather than duplicative; the stored filename is
its own integrity check; and there is no separate slug or collision handling to get wrong.

```sql
CREATE TABLE packages (
  id               TEXT PRIMARY KEY,      -- sha256 of the .btpkg bytes
  name             TEXT NOT NULL,         -- manifest.name
  description      TEXT,
  filename         TEXT NOT NULL,         -- as uploaded, for display + download name
  byte_size        INTEGER NOT NULL,
  package_version  INTEGER NOT NULL,
  template_version INTEGER NOT NULL,
  page_width       INTEGER,
  page_height      INTEGER,
  field_count      INTEGER,
  asset_count      INTEGER,
  computed_summary TEXT,                  -- "subtotal=sum(items.amount) total=add(subtotal)"
  uploaded_at      TEXT NOT NULL
);

CREATE TABLE ingest_issues (              -- the last validation verdict
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  severity   TEXT NOT NULL,
  path       TEXT NOT NULL,
  message    TEXT NOT NULL
);
```

Ingest issues are recorded rather than discarded, so a package that arrived with warnings can
still be explained later. They are never a reason to refuse - only `error`-severity issues are.

### API

Public, unauthenticated - the app carries no credential:

| Route | Response |
|---|---|
| `GET /api/packages` | catalog JSON: `[{ id, name, description, byteSize, uploadedAt, page, fieldCount, assetCount }]` |
| `GET /api/packages/:id/download` | raw bytes, streamed from disk; `Content-Type: application/zip`, `ETag: <id>`, `Content-Disposition: attachment` |

Admin, session required:

| Route | Purpose |
|---|---|
| `POST /api/admin/login` / `POST /api/admin/logout` | password ⇄ signed cookie |
| `POST /api/admin/packages` | multipart upload → validate → ingest |
| `PATCH /api/admin/packages/:id` | edit `name` / `description` |
| `DELETE /api/admin/packages/:id` | delete the row and the file |

### Ingest

Validation is the shared library's, not a second opinion:

```
parsePackage(bytes)
  → validatePackage(pkg)
      → any error-severity issue ⇒ 422, nothing written, every issue returned
      → otherwise derive the catalog row from the manifest and form schema
```

A refused upload returns the **same issue shape the editor already reports** -
`{ severity, path, message }` - so one fault reads identically in three places. 50 MB upload
cap, because `arrayBuffer()` materialises the whole body.

Re-uploading bytes that already exist returns `200` with the existing row. Uploading a file
that is not a zip at all returns `422`, not `500`: `parsePackage` throws for an unreadable
archive and the handler converts that into an issue rather than letting it escape.

### Dashboard

At `/admin`, served as server-rendered HTML from the same Express process. The React and
Tailwind pipelines belong to the editor; rebuilding either here would mean a second frontend
build to keep in step for what is an operator tool. So the pages are template literals with
one hand-written stylesheet, `server/public/admin.css`, that deliberately mirrors the editor's
tokens: the `neutral` palette, `blue-600` as the single accent, dense 10-11px type. It is
~120 lines, needs no build, no CDN and no network at runtime, and can be swapped for Tailwind
later at the cost of that one file.

- **Catalog** - name, size, page, field count, uploaded-at; download, edit, delete.
- **Upload** - drag-drop or picker. Success shows the manifest summary; a `422` lists every
  issue with its path, so a refused upload explains itself.
- **Detail** - manifest summary, form groups, repeat-band columns, computed specs.

Auth is one password from `BILLKIT_ADMIN_PASSWORD`, exchanged for a signed HttpOnly cookie.
The signature reuses the shared SHA-256 - the same "digest sits beside the bytes" idea as
`manifest.json.sha256` - so no new crypto dependency and no `jose`/`iron-session`.

`npm run seed` imports the existing `sample.btpkg` so there is real data to test against.

## Android

### Wiring that does not exist yet

`libs.versions.toml` gains **OkHttp**. `app/src/main/AndroidManifest.xml` gains
`<uses-permission android:name="android.permission.INTERNET" />`.

Because `targetSdk 37` blocks cleartext HTTP by default, the development backend is reached
through a **debug-only** `network_security_config.xml` in `app/src/debug/res/xml/`, declared by
an `app/src/debug/AndroidManifest.xml` overlay. The release build never declares the config at
all, so release is HTTPS-only by construction rather than by a flag someone can forget.

### New module: `feature:templates`

Mirrors the existing `feature:renderer:{domain,data,presentation}` split.

**domain** - pure interfaces and models: `TemplateCatalog` (fetch the server list),
`LocalTemplateStore` (list / save / read / delete), `TemplateRepository` (compose the two),
`TemplateCatalogItem`, `LocalTemplate`, and new `DataError` cases `NetworkUnavailable`,
`HttpError(code)`, `CatalogUnreadable`, `DownloadCorrupt`, `StorageFailed`.

> Each new `DataError` case **must** get a string in
> `core/presentation/src/main/res/values/strings.xml`. That mapping is an exhaustive `when`,
> so a missing string is a compile error - which is the intended forcing function.

**data** - `OkHttpCatalogSource` and `OkHttpDownloader` over the public routes;
`FileTemplateStore` writing `filesDir/templates/<id>.btpkg` with an `index.json` updated
write-tmp-then-rename, so a process death mid-write cannot corrupt the index.

### Templates screen

A `TemplatesRoute` with **its own ViewModel**, deliberately *not* the activity-scoped
renderer VM. This is the load-bearing decision: `RendererViewModel.init` (until changed, see
below) force-loads `sample.btpkg` and the `billkit.js` WebView, so sharing it would make the
Templates screen pay for a full render pipeline just to draw a list.

A card per template showing name, size, page and field count, with **Use** when stored,
**Download** when only on the server, and **Delete** once stored. Pull-to-refresh re-fetches
the catalog. Reach it from a Templates button on Home.

### Rendering a chosen template

Today `RendererViewModel.init` unconditionally dispatches `OnOpenSample`. That is why the
sample can never be *replaced* - the ViewModel was already busy before any screen appeared.

- `init` stops dispatching. `HomeRoot` dispatches `OnOpenSample` instead, exactly **once per
  ViewModel lifetime**, guarded by a local flag rather than by reading state - reading
  "is there a document?" from state would re-fire on every recomposition. Identical visible
  behaviour, no cost when nothing needs it.
- New `RendererAction.OnOpenStoredTemplate(id)` resolves the stored bytes and enters the
  **same** `openPackage(bytes)` path the sample already uses. Derive, render, debounce, save
  state and print are untouched - this is one more source of bytes, not a new code path.
- Tapping **Use** dispatches on the renderer VM and navigates to `FillRoute`.

One existing test changes as a deliberate consequence: `RendererViewModelTest`'s
`opening the sample loads the document and its form` must now dispatch `OnOpenSample`
explicitly.

### Verification closes a documented gap

`ZipPackageReader` deliberately ignores `manifest.json.sha256`, and its KDoc gives the reason:
*"the package is read from a file the user just picked - the checksum's job is to detect
tampering in transit, which this path has no exposure to."* That reasoning is correct for SAF
and **wrong for a download**, which is exactly in-transit input.

Downloads are therefore verified: the whole-archive SHA-256 is compared against the catalog
`id` **before anything touches disk**, and a mismatch is discarded as `DownloadCorrupt`. The
whole-archive hash subsumes the per-member checksums, so this is one pass, not N, and no
per-member verification needs porting into Kotlin. The SAF path keeps its current behaviour.

## Testing

| Suite | Coverage |
|---|---|
| server `ingest.test.ts` | accepts a valid package, refuses each error-severity class, idempotent re-upload, non-zip body → 422 |
| server `catalog.test.ts` | catalog shape, download headers/ETag, unknown id → 404 |
| server `auth.test.ts` | dashboard routes reject an unauthenticated request |
| `TemplateRepositoryTest` | happy path, SHA mismatch rejected, HTTP error, corrupt zip |
| `FileTemplateStoreTest` | save/list/read/delete round-trip, index survives, corrupt index recovers |
| `OkHttpCatalogSourceTest` | MockWebServer (new test dep) for DTO parsing and error mapping |
| `TemplatesViewModelTest` | refresh, download progress, delete, error surfacing |

`TemplatesViewModelTest` follows the existing convention exactly: one shared
`StandardTestDispatcher` passed to `runTest`, Turbine for `events` only (a `StateFlow`
conflates, so `awaitItem()` chains are wrong), hand-written fakes, AssertK, backtick test
names.

**Gates.** Server: `typecheck`, `lint`, `test`, `build`. Android:
`.\gradlew.bat --no-configuration-cache assembleDebug testDebugUnitTest lintDebug`
(configuration-cache off, because AGP 9.4.1 cannot serialise it for this build).

**End-to-end proof.** Upload a package in the dashboard → it appears on the Android Templates
screen → Download → Use → Fill → Preview → Print. Every step above the proof is a unit test;
this is the one that says the three languages agree.

## Risks

| Risk | Mitigation |
|---|---|
| Workspace root with a space in `version 1` | verify clean install + green web gate at `Prototype/` **first**; `file:` fallback documented above |
| Moving `lib/package` breaks ~15 test files and all editor imports | the shim design means **no importer changes at all**; the 634-test gate proves it |
| `node:sqlite` is still flagged experimental in Node 24 | it is stable in practice and needs no native build; if it is unavailable, `better-sqlite3` is a drop-in behind the same repository interface |
| Emulator cannot reach the dev backend | the server binds `0.0.0.0` so the emulator reaches it over the LAN at `10.0.2.2`; if that fails, `adb reverse tcp:4000 tcp:4000` |
| Cleartext config accidentally shipped | it lives in `src/debug/` only; release has no reference to it at all |

## Out of scope

Restating the non-goals, because each was a live option and each is deliberately declined:
app authentication, Room, background sync, editor-direct publishing, on-device template
editing, version pinning, multi-page output, and moving Android into the workspace.
