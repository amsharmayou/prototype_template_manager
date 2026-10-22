# BillKit Product Completion Plan for AI Agents

**Date:** 2026-10-18  
**Status:** Roadmap; partial implementation in progress (audited 2026-10-19)  
**Purpose:** Deliver the complete supported workflow from creating a bill template to distributing a `.btpkg`, filling it on Android, and printing/sharing the finished document. Also make authoring reliable and efficient.

## Progress audit (2026-10-19)

Verified against the working trees; checkbox lines below remain authoritative per item. Phase-level truth:

- **Phase 0 — done.** Baseline commands ran (web: tsc/eslint/984 vitest; Android: assembleDebug/test/lint; server: tsc/51 vitest) and the dated baseline report exists at `version 1/docs/verification/2026-10-19-baseline.md` (device-log capture also committed). Remaining device-side items (SAF drive-through, physical print) are tracked under phases 4A/3 respectively.
- **Phase 1 — contract doc done (2026-10-19).** `version 1/docs/contract/v1-format.md` written: package envelope, page geometry, objects, fields, computed values, fonts/assets, limits, operator-mediated delivery, boundary error behaviour pinned against format.ts/types.ts/validate.ts. Remaining: the stable template/package identity remains a Phase 7 concern (identity currently derives from content hash in the catalog).
- **Phase 2 — not started** (2A layout anchoring, 2B style tokens/accessibility audit, 2C preflight cell navigation remain).
- **Phase 3 — code ~50%.** `PaperSize` pure model (25.4 mm/in fixed, A4/Letter constants, 3 mm tolerance, 9 tests), `BillPackage.PageSize(dpi, paper)`, custom `PrintAttributes.MediaSize` + 300 dpi resolution in `PrintController` — done. Missing: web↔Android output equivalence checks, margin/fit modes, font fallback contract, physical ruler verification (blocked: no printer), migration/non-resizing behavior.
- **Phase 4A — ~80%.** `ZipPackageReader` rewritten (strict UTF-8, traversal/duplicate/absolute/backslash rejection, 64 MB archive / 256 MB expanded / 2 000 entries caps, version gate) with 20 data tests + error strings. Missing: device drive-through of the SAF picker (APK installed, sample package at `/sdcard/test-package.btpkg` on emulator-5554), content-URI permission checks from Downloads/Files/shared intent.
- **Phase 4B — ~60%.** Repeat-row sample fill fixed (`sampleColumnValue`, `persistRows`/`restoreRows` via SavedStateHandle; 22 presentation tests). Missing: constraint/IME/a11y/small-screen test matrix.
- **Phase 4C — ~60%.** `PrintPipeline` interface + `PrintState`, job tracking via `PrintDocumentAdapter` callbacks, cancel, guarded `release()`, `about:` guard; `ShareDocument` + FileProvider manifest wired for share/save. Missing: device verification of share/save pickers, stale-async-render guard, WebView lifecycle recreation, formula-vs-web matrix.
- **Phase 5 — essentially complete (2026-10-19).** All security work as previously reported, plus in this session: stored ingest warnings surfaced (GET /api/packages `issues` key, GET /api/packages/:id detail endpoint, dashboard `<details class="warnings">` with escaped `path`/message), package lifecycle (`status` column via tolerant `COLUMN_MIGRATIONS`, PATCH validation 400 "status must be active or deprecated", rename/replace never overwrite an in-use version — verified by test), backup/restore scripts (`scripts/backup.mjs` sha256 MANIFEST.json + --keep retention, `scripts/restore.mjs` verify-then-abort on tamper, refuse-without-`--force`), and a logs hygiene audit (no request logging exists; error paths log stack only; startup logs host/port/dataDir — sound). `npm test` = parity check + 67/67 tests, tsc + eslint clean. Remaining: customer expiring-link decision stays explicitly out of prototype scope (per contract doc §9).
- **Phase 6 — ~75%.** Parity tooling as previously reported, plus in this session: the Phase 6 golden fixture landed — `version 1/tools/build-golden-fixture.ts` produces deterministic bytes (ZIP-epoch pinned mtime 315532800000) committed as `tests/fixtures/golden/{invoice.template.json, golden-invoice.btpkg}` (1936 bytes); web contract tests `tests/golden-fixture.test.ts` (7: rebuild equality, validation, checksum coverage, forward packageVersion/templateVersion messages, tamper refusal, maxItems cap); server consumes the fixture via `vendor/fixtures/` + parity byte-compare + `tests/golden.test.ts` (ingest ok, forward-version contract message after re-sealing the `manifest.json.sha256` sibling, tamper refusal); Android consumes the same bytes from `feature/renderer/data/src/test/resources/golden-invoice.btpkg` (staged by `tools/prepare-android-assets.ts`) with a golden `ZipPackageReaderTest` case (checksums verified, band + computed present). Gates: web 991/991 tests + tsc + eslint, server 67/67 + parity (33 files, 2 fixtures) + tsc + eslint, Android reader 25/25 + templates/data + assembleDebug. Missing: Chromium↔WebView geometry/screenshot comparison, CI integration.
- **Phase 7 — not started beyond authoring-plan carryover** (stable IDs, versions, onboarding walkthrough, sample templates).
- **Phase 8 — not started** (checklist doc exists; no device acceptance evidence).

Session fixes worth noting: server `app.ts` `/api/packages` route corruption repaired (a bad scripted edit had merged the route declaration); PowerShell `Set-Content -Encoding UTF8` BOM + cp1252 double-encoding contamination found and eliminated from touched files; vendor tsc now clean (`tsc --noEmit` exit 0) and `npm test` = parity check + 51/51 tests pass.

## Agent instructions

Use this document as an execution sequence. Work one phase at a time; do not attempt a wholesale rewrite.

1. Before each phase, inspect the current working tree and relevant files. Preserve unrelated and pre-existing changes.
2. Read the current source and tests. Names and line-level behavior may have changed since this plan was written.
3. Treat `lib/template/types.ts`, `lib/package/`, and `lib/billkit/bridge.ts` as the format and behavior authority. Do not independently reimplement field derivation, repeat expansion, calculations, or rendering in Kotlin or server code.
4. Keep changes in the owning workspace. The web project is `version 1/`; Android is `Android/`; delivery/admin is `Admin/server/`. Coordinate schema and generated asset changes across these roots.
5. Add focused tests with each implementation phase. Run the relevant project checks at phase exit. Do not update the Android runtime asset or demo package manually: use `npm run build:billkit` and `npm run prepare:android-assets`.
6. Never silently drop unsupported template data. Reject with a useful error or preserve it with a clearly surfaced warning.
7. Keep the v1 promise explicit: one page, supported package/template versions, supported object types, and known print limitations. OCR and photographed-page perspective correction are separate product capabilities, not implicit requirements.
8. At each phase exit, report changed files, checks run, outcomes, and remaining gaps. Update this plan's checkbox/status before moving on.

## Product workflow and completion definition

The supported v1 journey is:

1. A template author opens the web editor, starts from a scan/photo or blank page, sets physical page size, traces static artwork, defines fields/repeated rows/calculations and styles, validates with realistic data, and saves/exports a package.
2. An operator uploads and reviews the `.btpkg` in the Admin server catalog and gives a package download/link to a customer or loads it directly onto a device.
3. An Android user opens a package through the system file picker, sees a generated form, fills fields and repeating rows, sees validation and a faithful preview, then prints or shares a finished artifact.
4. The filled result is reproducible: the same package and values render the same document, output geometry is predictable, and no author-only reference image or editor controls leak into it.

**Done means** every transition above is exercised with a real package, real Android file selection, nontrivial repeated data and formulas, process/rotation recovery, and a physical or PDF print check. Unit tests alone do not prove the workflow.

## Current implementation map

- Web editor and authoring contract: `version 1/components/editor/`, `version 1/lib/canvas/`, `version 1/lib/template/`.
- Portable package: `version 1/lib/package/`, `version 1/tools/prepare-android-assets.ts`.
- Shared form/render behavior: `version 1/lib/billkit/bridge.ts`, `version 1/lib/render/`.
- Android package/open/form/preview/print: `Android/feature/renderer/`; app shell: `Android/app/`.
- Admin catalog and delivery: `Admin/server/src/`, `Admin/server/vendor/billkit-format/`.
- High-level runtime notes: `PIPELINE.md`.
- Existing authoring plan and implemented items: `version 1/docs/superpowers/plans/2026-10-17-editor-template-authoring-completion.md`.

Substantial functionality already exists: template tracing, color/style properties, field and repeat authoring, decimal-safe calculation operations, package validation and checksums, a pure TypeScript bridge, Android form and WebView preview/printing, and an admin catalog. The highest-priority gaps are the unverified end-to-end transitions and specific issues below.

## Phase 0 — Establish a reproducible baseline

**Goal:** Know what is actually green before changing code.

- [ ] Record Git status and branch in each project root. Do not reset or clean user changes.
- [ ] Run web typecheck, lint, unit tests, E2E, production build, and package freshness/verification scripts.
- [ ] Run Android unit tests, lint, assembleDebug, and instrumentation tests where an emulator/device is available.
- [ ] Run Admin server typecheck, lint, and tests.
- [ ] Build the BillKit JS bundle and regenerate Android assets; compare generated package/runtime outputs to checked-in assets and document intended differences.
- [ ] Capture toolchain versions, emulator/API level, browser/WebView version, and commands/results in a dated report under `version 1/docs/verification/`.

**Likely commands**

- Web: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run build:billkit`, `npm run prepare:android-assets`.
- Android: from `Android/`, `./gradlew.bat assembleDebug testDebugUnitTest lintDebug`; run connected instrumentation tests separately when a device is configured.
- Server: from `Admin/server/`, `npm run typecheck`, `npm run lint`, `npm test`.

**Agent notes:** Next.js may need the documented webpack build and a writable output directory in this environment. The Android Gradle configuration may require disabling configuration cache as documented in `PIPELINE.md`. Do not call an unavailable physical print check “passed.”

**Exit criteria:** A baseline table lists each check as pass/fail/not available, with actionable failure logs.

## Phase 1 — Freeze and verify the v1 format/behavior contract

**Goal:** Ensure all consumers agree before adding features or diagnosing parity.

- [x] Review package schema/version and template migration in `lib/package/format.ts`, `build.ts`, `parse.ts`, `validate.ts`, `resolve.ts`, `lib/template/types.ts`, and `migrate.ts`.
- [x] Write a concise versioned contract covering page geometry (pixels, DPI, physical dimensions), supported object types, field types/contracts/defaults, image slots, repeat-band rules/cap, computed operation semantics, font fallback, asset limits, single-page restriction, and error behavior. → `docs/contract/v1-format.md`.
- [x] Define formula scale/rounding, empty-row behavior, missing operands, defaults, optional versus required input, and max-row overflow. Confirm behavior in renderer before documenting it.
- [ ] Add stable template/package identity distinct from editable name. Specify backward-compatible migration and duplicate import behavior. (Contract defines it; implementation is deferred to Phase 7 stable-ID work. The catalog already keys identity on content sha256.)
- [x] Specify whether customers receive packages through a public/unlisted expiring link, authenticated account, or operator-mediated download. For the prototype use the existing admin catalog flow; do not imply customer accounts exist. → contract §9; expiring links explicitly out of prototype scope.
- [x] Mark OCR and perspective correction as out of v1 unless separately scheduled.

**Main files:** `lib/template/types.ts`, `lib/template/migrate.ts`, `lib/package/format.ts`, `lib/package/validate.ts`, `lib/package/build.ts`, `PIPELINE.md`, and the editor completion plan.

**Exit criteria:** Examples for a fixed form, repeating invoice, and receipt all validate and describe identical behavior across web and Kotlin host. Unsupported versions fail before render with a clear error.

## Phase 2 — Web editor authoring correctness and usability

**Goal:** Let a business owner build a valid, attractive template with predictable geometry.

### 2A. Variable layout mechanics

- [ ] Audit the full hierarchy model in `lib/render/layout.ts`, `lib/template/preflight.ts`, `components/editor/LayoutPanel.tsx`, `lib/canvas/EditorController.ts`, and related tests.
- [ ] Test parent-child anchoring, growth policies, nested layouts, rotated/resized objects, repeat bands, empty/one/max rows, and page overflow at varied zoom levels.
- [ ] Fix each demonstrated coordinate or layout drift defect at its owning layer. Avoid duplicating layout rules in canvas UI and renderer.
- [ ] Add diagnostics that link a failing relation to the object and, where applicable, exact table cell. Keep computed document geometry in a shared pure function.
- [ ] Verify undo/redo and save/reopen preserve all anchors, constraints, and repeat configuration.

### 2B. Visual design controls

- [ ] Audit color controls across text fill, borders, table cells, fills, opacity, and backgrounds. Ensure there is an accessible color picker plus direct hex/RGB entry, alpha support where supported, presets/recent colors, and contrast-safe focus states.
- [ ] Define color representation in the template contract (canonical CSS-compatible sRGB; normalize before save). Validate malformed color input and maintain existing template compatibility.
- [ ] Add reusable style tokens/presets for brand colors, typography, border width/radius, and common table header/total rows; applying a preset must remain editable per object.
- [ ] Improve authoring efficiency: duplicate style, multi-select style edits, align/distribute, keyboard shortcuts, lock/hide, predictable layers, numeric geometry inputs, and clear inspector grouping. Reuse existing operations rather than adding parallel state.
- [ ] Make reference photo controls visibly author-only; ensure no reference bytes are packaged or rendered.

### 2C. Field and table workflow polish

- [ ] Ensure central Fields panel exposes all token occurrences, image slots, repeat collections, validation, defaults, labels and computed references.
- [ ] Add direct focus from preflight to a table cell, not only its table. Preserve exact row/column identity when selection changes.
- [ ] Validate repeated bands for header/trailer boundaries, row/column token mapping, cap, and totals. Include representative max-cap sample.
- [ ] Replace ambiguous panel labels and add short contextual guidance for tokens, repeats, calculations and print sizing.

**Main files:** `components/editor/PreflightPanel.tsx`, `PlaceholdersPanel.tsx`, `CalculationsPanel.tsx`, `PropertiesPanel.tsx`, `LayoutPanel.tsx`, `lib/template/preflight.ts`, `lib/canvas/EditorController.ts`, `lib/render/layout.ts`, `app/globals.css`.

**Exit criteria:** A novice can create an invoice from scan and from blank, style it, define a repeated items table, run preflight, and save/reopen with identical geometry and colors. Add Playwright coverage for both paths and targeted layout tests.

## Phase 3 — Physical print geometry and renderer accuracy

**Goal:** A saved page corresponds to intended physical paper dimensions on web and Android.

- [ ] Choose canonical page representation: physical dimensions (e.g. micrometres) plus DPI, or canonical px plus explicit DPI and conversion. Define rounding once and use it everywhere.
- [ ] Migrate existing packages without resizing their content unexpectedly. Show authors the effective physical size and warn if a source scan's pixel dimensions are being mistaken for paper dimensions.
- [ ] Verify A4, Letter, receipt, landscape, and custom sizes across web PDF/print and Android PrintAttributes. Ensure margins and fit modes are explicit.
- [ ] Fix known Android risk: `PrintController` currently chooses portrait/landscape A4 from dimensions per PIPELINE notes. Implement custom `PrintAttributes.MediaSize` when supported or explicitly warn/scale to supported paper while preserving aspect ratio.
- [ ] Verify text measurement/font fallback parity. Define a supported font package contract or explicitly document system fallback; either consume `manifest.fonts` with checksums or reject/warn for fonts that are not bundled.
- [ ] Check clipping, wrapping, long values, page overflow and color output in preview, downloaded PDF, Android preview, and printed output.

**Main files:** `lib/template/types.ts`, `lib/package/format.ts`, `lib/render/css.ts`, `lib/render/measure.ts`, `lib/export/toPdf.ts`, `Android/feature/renderer/presentation/src/main/kotlin/com/billkit/feature/renderer/presentation/PrintController.kt`, `PrintDocument.kt`, package DTOs.

**Exit criteria:** A physical ruler or known-size calibration print confirms the supported size contract within declared tolerance. Web and Android outputs agree on page bounds, orientation, fields, color and line-item positions.

## Phase 4 — Android .btpkg customer workflow hardening

**Goal:** A real customer can open an externally delivered package and complete it reliably.

### 4A. System file import and package safety

- [ ] Exercise `Open .btpkg` via Android Storage Access Framework on a real device/emulator (currently explicitly unverified in `PIPELINE.md`).
- [ ] Add negative tests for truncated zip, duplicate paths, path traversal, missing manifest/member, checksum mismatch, unsupported version, oversized archive/expanded size, decompression bomb, corrupt image/font, and malformed field schema.
- [ ] Enforce limits while streaming; do not trust ZIP declared sizes. Reject unsafe archive paths and duplicate members.
- [ ] Present understandable errors and leave any current draft/package untouched on failure.
- [ ] Verify content URI permissions and that the app works with files from Downloads, Files, and a shared intent.

**Main files:** `Android/feature/renderer/data/.../ZipPackageReader.kt`, `AssetResolver.kt`, `ManifestDto.kt`, domain error types and tests.

### 4B. Form behavior and repeat data

- [ ] Fix **Fill sample data does not populate repeating rows**. Generate stable row sample values for each declared repeat column; do not assign a meaningless string to the repeat collection key.
- [ ] Test required/default/min/max/length/type constraints, blank optional values, image-required fields, repeated add/remove, minimum one row, max cap and validation focus navigation.
- [ ] Persist user inputs and repeat rows through rotation, process death, background/restore, and app relaunch using SavedStateHandle plus durable draft storage where needed. Avoid storing sensitive form data without clear user expectation and deletion policy.
- [ ] Ensure keyboard, IME next/done, numeric/currency/date input, accessibility labels, small screens, and dynamic row controls behave well.

**Main files:** `FillScreen.kt`, `RendererViewModel.kt`, `RendererState.kt`, `FormField.kt`, `BridgeDto.kt`, relevant ViewModel/UI tests.

### 4C. Render, print, share

- [ ] Verify computed formulas using known values and decimal edge cases against the web renderer. PIPELINE marks computed-total arithmetic unverified.
- [ ] Confirm form preview and final output are produced from the same immutable values snapshot.
- [ ] Test images/assets, checksums, table repeats, totals, long content, colors and fonts in Android WebView.
- [ ] Add share/save PDF flow using Android Sharesheet and Storage Access Framework, with user-selected destination and cleanup. Verify printed and shared files contain only the finished document.
- [ ] Add lifecycle-safe WebView disposal/recreation and prevent stale asynchronous render results from replacing a newer package/input state.
- [ ] Verify print job lifecycle, failures, cancel behavior, printer paper choices, orientation, scaling, and WebView teardown.

**Main files:** `WebViewBillKitRuntime.kt`, `BillKitShell.kt`, `PreviewScreen.kt`, `PrintController.kt`, `PrintDocument.kt`, `RendererViewModel.kt`, `RendererEvent.kt`.

**Exit criteria:** SAF-open a package created by the current editor; fill regular and repeated fields; verify exact formula results; rotate/kill/restore; preview; share a PDF; print to PDF/printer. Instrument at least one end-to-end scenario and preserve logs/screenshots.

## Phase 5 — Admin package catalog and safe delivery

**Goal:** The operator can safely receive, review and distribute packages.

- [x] Map current APIs/views and document available admin upload/list/detail/download operations; distinguish current local prototype from internet-facing service.
- [x] Verify upload validation uses the same package validator and that stored object checksum/metadata match the catalog. Ensure failures clean temporary files and database rows consistently.
- [x] Add package detail/preview metadata, validation report, replace/new-version workflow, active/deprecated status, and audit timestamps without overwriting an in-use version.
- [x] Make download links safe: authenticated admin endpoints for prototype; if customer link is required, implement expiring, revocable, unguessable scoped tokens with rate limits and no directory traversal. Do not expose the packages directory statically.
- [x] Harden auth/session: secure cookie flags under HTTPS, CSRF protection for state-changing admin forms, login throttling, secret rotation, and secure deployment configuration. Keep dev behavior explicit.
- [x] Define backup/restore for SQLite and package blobs; test recovery and deletion/retention policy. → `scripts/backup.mjs` / `scripts/restore.mjs` (sha256 MANIFEST.json, tamper-abort, refuse-without-`--force`, `--keep` retention), smoke-tested including restore round-trip.
- [x] Add request size/type limits, upload rate limits, logs without document contents/secrets, health/readiness checks, graceful shutdown, and operational error reporting. (Logs hygiene audited: no request logging exists; error paths log stack only; startup logs host/port/dataDir.)
- [x] Decide separately whether the initial customer uploads a source document photo to the server. → explicitly out of prototype scope, contract §9.

**Main files:** `Admin/server/src/app.ts`, `routes/views.ts`, `ingest.ts`, `catalog.ts`, `storage.ts`, `session.ts`, `db.ts`, config/tests/views.

**Exit criteria:** Authenticated operator uploads a valid package, sees validation details, downloads the exact bytes, and an Android device opens them. Invalid packages never appear in catalog. Customer-link behavior is explicitly implemented or explicitly out of prototype scope.

## Phase 6 — Cross-platform parity and reproducible integration

**Goal:** Prevent the web and Android host from disagreeing as features evolve.

- [ ] Make `lib/billkit/bridge.ts` the only field derivation/render entrypoint used by Android; keep DTO mapping mechanical.
- [x] Remove or automate manual format copies under `Admin/server/vendor/billkit-format/`; pin the source revision and add a parity check that fails when vendor output is stale. (`sync:vendor` + `pretest`; also byte-compares the golden fixtures.)
- [ ] Add shared golden fixtures covering all supported shapes, colors, fonts, placeholder contracts, image slots, nested layouts, repeat bands, formulas, empty/malformed values and page sizes. (Invoice fixture landed; still one shape-class, not the full matrix.)
- [ ] Compare normalized HTML/DOM geometry and screenshots in Chromium and Android WebView; use tolerances only for font rasterization, not page geometry or missing objects.
- [x] Add a single integration fixture generated by the web editor and consumed by server validation and Android. Rebuild all generated artifacts as part of CI. → golden-invoice.btpkg committed, consumed by web tests, server tests (via vendor/fixtures + parity), and ZipPackageReaderTest (via staged test resource). CI itself does not exist yet in this prototype; rebuild equality is enforced by the web golden test instead.
- [x] Add contract tests for malformed input and forward-version rejection at every boundary. → web golden-fixture tests (forward packageVersion + templateVersion messages, tamper), server golden tests (forward version contract message, integrity refusal), ZipPackageReaderTest (UnsupportedPackageVersion, checksum mismatch, traversal/duplicate caps).

**Main files:** `lib/billkit/`, `tests/`, `tools/prepare-android-assets.ts`, `Admin/server/vendor/billkit-format/`, Android bridge and instrumentation tests, CI config.

**Exit criteria:** One committed fixture passes web, server and Android validation/render checks with matching field schema, computed values and page geometry.

## Phase 7 — Web editor persistence, onboarding, and supported authoring scope

**Goal:** Complete work protection and make complex template creation learnable.

- [ ] Add stable template IDs, named versions, duplicate template, save status and explicit quota/storage errors. Recovery drafts are not the same as saved versions.
- [ ] Add import/export round-trip coverage for package assets, colors, fields, calculations, repeat configuration, layout hierarchy and physical page properties.
- [ ] Complete preflight navigation into exact table cell and formula dependency; show errors/warnings with corrective actions.
- [ ] Finish keyboard/screen-reader/touch/contrast/responsive audit. Keep color entry accessible and keyboard operable.
- [ ] Add a guided first template walkthrough and sample templates for invoice, receipt and fixed form. Keep advanced controls available.
- [ ] Explicitly label OCR, perspective correction, multi-page templates and unsupported export types as not supported in v1. Do not accept data that the renderer drops.
- [ ] Add end-to-end authoring flows: scan-based template, blank template, brand styling/colors, repeated items, formulas, max-row preflight, save/reopen, package export and print preview.

**Main files:** `lib/client/templateStore.ts`, `lib/client/draftStore.ts`, `components/editor/UploadScreen.tsx`, `PreflightPanel.tsx`, editor panels, `lib/template/preflight.ts`, E2E tests.

**Exit criteria:** A new owner can create, validate, save, reopen and package a supported template without editing JSON or relying on undocumented conventions.

## Phase 8 — End-to-end device acceptance, performance and release readiness

**Goal:** Confirm the product works in its real operating environment.

- [ ] Build a release-candidate package from the web authoring flow; upload it through Admin; fetch it as a customer/operator; open it through SAF on Android.
- [ ] Execute acceptance cases: fixed form; invoice with 0/1/3/max rows; formulas; defaults and required errors; long names; image assets; custom page size; rotation/process death; corrupted package; print cancel; share destination.
- [ ] Profile archive parsing, JS bridge, render time, WebView memory, form scrolling and image-heavy templates on a low/mid-range Android device. Add measurable budgets and optimize only measured hotspots.
- [ ] Check logs for sensitive values, crash handling, offline behavior, accessibility, app permissions, package size, and release signing/versioning.
- [ ] Define data lifecycle for filled values and generated documents: local-only, explicit save/share, deletion, and backup semantics.
- [ ] Produce a release checklist and known limitations. Do not claim production readiness until deployment, HTTPS, backups, monitoring and supported-device matrix are verified.

**Exit criteria:** A named tester can repeat the complete journey on a clean device and recover from each expected error without developer intervention. Attach evidence: package hash, build versions, test report, device/browser details, and representative print/PDF comparison.

## Dependency order and execution queue

Execute in this sequence; do not block useful independent work unnecessarily:

1. Phase 0 baseline.
2. Phase 1 contract (resolve contradictions before schema changes).
3. Phase 4B repeat sample-data + formula verification (fastest confirmed Android correctness gaps).
4. Phase 4A SAF import/security and Phase 4C share/lifecycle.
5. Phase 3 print geometry and fonts.
6. Phase 5 delivery/security/operations.
7. Phase 2 editor correctness and colors/efficiency (variable layout tests can run in parallel with backend-independent work, but commits should stay scoped).
8. Phase 6 shared fixture/parity automation.
9. Phase 7 persistence/onboarding.
10. Phase 8 acceptance and release decision.

If a phase uncovers a format change, pause downstream implementation, update the contract/migration and fixture first, then resume.

## Global acceptance checklist

- [ ] Author can create a color-styled template with correct variable layout, repeat rows, calculations, and physical size.
- [ ] Preflight identifies errors and navigates to the precise field, formula, object, or cell.
- [ ] Save/reopen and package import/export preserve all supported semantics.
- [ ] Admin upload validates and serves the exact package bytes under intended access control.
- [ ] Android SAF opens external packages and rejects malformed packages without data loss.
- [ ] Android generated form honors every supported field contract and repeat collection rule.
- [ ] Web and Android compute identical results for shared fixtures, including rounding boundaries.
- [ ] Preview, PDF/share, and printed document agree on values, color, page size, layout and assets.
- [ ] Rotation, process recreation, offline use, permission denial and failure states are humane and recoverable.
- [ ] Performance and release criteria are measured on the declared support devices.

