# Print Pipeline Plan — Template → Bundle → Form → Print-Ready PDF (Phases 0–2)

Basis: the production analysis in the user message, re-verified line-by-line against the code on 2026-10-22 (evidence below). Scope confirmed with the user: **platform = web/PWA + Android** (engine must be DOM-free, WASM shaping with pure-JS metric fallback); **this branch implements Phases 0–2 only** — pagination (multi-page), rule packs, hardening are a fast-follow.

## Verdict (verified)

Workable — the layout solver, repeat expansion, money math, sanitising and package format are real and reusable. Not production-safe as built: three layout engines (Fabric `lib/canvas`, HTML `lib/render`, jsPDF `lib/export/toPdf.ts`) drift apart, fonts are not bundled (`fonts: []`, lib/package/build.ts:259), measurement is delegated to whatever DOM font stack is present (`measure-dom.ts:32-35`), and money/formatting defects print wrong totals.

Confirmed evidence for the defect list (all re-checked; use as task inputs):
1. PDF export = Fabric SVG → jsPDF raster via canvg (`lib/export/toPdf.ts:34-39`), fallback 3x PNG raster (`:43-50`). Field objects print as editor markers.
2. Cell wrap contradictions: `white-space: pre` + `overflow: hidden` (`lib/render/primitives.ts:322,408-411`) vs wrap measurement (`lib/render/rowHeights.ts`, lineHeight 1.2) vs editor ellipsis (`components/editor/*`).
3. No fonts in bundle (`build.ts:259`); measurement fallback `"${family}", Arial, sans-serif` (`measure-dom.ts:32-35`).
4. Share kit renders with empty values and no repeater UI (`lib/share/kit.ts:301`, FIELD_GROUPS `:48-57`).
5. `deriveForm` does not filter computed keys while `extractFillableFields` does (`lib/package/form.ts:91-155` vs `lib/template/dataBinding.ts:222-245`).
6. Quantity parsed at currency scale (`computed.ts:58-93`, every arg via `parseMinorUnits(_, s)`); negative rounding inconsistent (`Math.round` toward +∞ at `computed.ts:191` vs sign-away at `:83`); `currencyScale` hardcoded 2 and dropped (`RenderClient.tsx:84,103`, `render/index.ts:210`, `bridge.ts` never receives it).
7. `measureBridge` folds computed into table cells only (`bridge.ts:145`); text/field boxes measured with `fillTemplate(template, values)` and no computed (`bridge.ts:111`) → `{{total}}` measured literally.
8. Template hash computed over the object handed to `renderHtml` (i.e. the filled template) and only emitted as an attribute, never verified (`render/index.ts:319-333`).
9. `billkit` exports no unzip/validate/resolve — global is only `deriveForm`/`measurePlan`/`measure`/`render` (`lib/billkit/main.ts:30-40`); checksums optional in validation.
10. `@page { size: 794px 1123px }` (`style.ts:15`, constants `types.ts:546-547`) ≈ 210.08×297.13 mm; single page only.
11. Dates print raw ISO; numbers ungrouped (`formatMinorUnits` `computed.ts:96-103`, token substitution in `primitives.ts`).
12. Fabric stroke centring vs CSS border-in-box: real drift; guard with the parity test (the `*verify*` Fabric 1.13 line-height factor stays a parity-test assertion, not assumed).

Resolved from the analysis: §11 open question → web + Android.

## Architecture target (Phase 1)

```
bundle + values
  → openBundle (unzip, hashes, engineVersion, validate)
  → bindValues → computeAll (integer minor units, explicit rounding)
  → expandRepeats (single page scope)
  → engine measure from bundled font files (opentype.js metrics; harfbuzzjs WASM for complex scripts)
  → layout solver (existing calculateLayout/rowHeights contract, engine-fed)
  → DisplayList (immutable, font-based, line-broken, positioned)
      → pdf writer (vector, embedded font subsets)   ← the deliverable
      → canvas painter (preview, PNG tests)
```

Backends paint only; they never re-measure or re-break lines. Existing `renderHtml` stays for editor fallback + parity tests until parity is proven, then becomes internal.

Stack decisions (fixed):
- **Measurement**: opentype.js (pure JS, works in vitest/Node, browser, Android WebView) for advance widths/metrics. **Shaping**: harfbuzzjs WASM, feature-detected; if WASM is unavailable, refuse to print documents containing complex-script runs (hard-fail), Latin metric path still works. Line breaking: implemented UAX#14-lite greedy break + `overflow-wrap` semantics; no `Intl.Segmenter`.
- **PDF writer**: pdf-lib (fontkit subsetting, vector ops). Interface `writePdf(displayList, fonts) → Uint8Array` so a hand-rolled deterministic writer can replace it if pdf-lib output proves non-deterministic or subsets wrong (test decides, Phase 1 exit).
- **Repo/library constraints**: fflate already a dependency (zip/unzip); fabric/jspdf stay installed for the editor interaction layer during migration but are removed from every print path. `docx` untouched.
- **Fonts bundled** (OSS, safe to embed): Liberation Sans + Liberation Serif (Arial/Times metric-compatible), Carlito (Calibri), Caladea, Noto Sans, Noto Sans Devanagari. Licences: OFL/Apache/GPL+exception as applicable — record licence string per font in manifest. Uploaded author fonts: check OS/2 embedding-permission bits (fontkit) + require licence acknowledgement checkbox.

## Branch and hygiene

- Task 0: confirm the git situation first — a nested `version 1` directory exists inside the repo and `.superpowers/sdd/.../git-roots.txt` previously recorded multiple roots. Work only in the outer repo. From a clean tree create `feature/print-pipeline` off main.
- Required reading before touching `app/`: `node_modules/next/dist/docs/` (Next 16.3.7, per AGENTS.md).

## Ordered tasks

### Phase 0 — Stabilise current pipeline (feeds everything else)

P0-1 **One render entry**: add `renderDocument(template, values, manifest)` in `lib/render/index.ts` that internally does compute → fill → resolve → render; make `RenderClient`, `share/kit.ts`, `bridge.ts` call it (removes double token resolution defect #8, drops the fill-then-unfill pattern at `bridge.ts:168-202`).
P0-2 **Money fixes** (`lib/render/computed.ts`, `lib/package/format.ts`, bridge, RenderClient):
  - spec-level operand scale: currency at manifest scale, quantity operands at 6 (`qtyScale`);
  - manifest `rounding: "halfAwayFromZero"|"halfEven"`, single rounding implementation used by parse and multiply (replaces `Math.round(raw/divisor)` at `computed.ts:191`);
  - `currencyScale` plumbed everywhere (bridge signatures, RenderClient reads manifest, `render/index.ts:210`);
  - row amounts computed in the engine: row-scoped `sum-times` evaluated in repeat binding so row `amount` cannot disagree with subtotal.
P0-3 **Display formats** (defect #11): manifest per-field `display` (date pattern, grouping incl. lakh/crore, currency symbol/position); implement in a pure `lib/render/formats.ts` consumed by token substitution; no number-to-words (fast-follow).
P0-4 **One cell wrap rule**: cells wrap (`pre-wrap` + break-word) unless `wrap: false`; remove editor ellipsis truncation; align `rowHeights.ts` at lineHeight 1.2 exactly (defect #2). Update the golden row-height tests.
P0-5 **Measure with computed** (defect #7): `measureBridge` applies `computeAll` to values before `fillTemplate` for text/field boxes (`bridge.ts:111`).
P0-6 **Template identity hash** (defect #8 part 2): hash over authored `template.json` + asset bytes at save/export; manifest stores it; open-side verifies. Stop hashing filled state.
P0-7 **`@page` fix** (defect #10): emit `size: A4` for A4 templates; custom sizes in mm computed from px at 96dpi. Single-page behaviour unchanged.
P0-8 **Share kit single form model** (defects #4, #5): share kit builds its form from `deriveForm` output (incl. repeater rows with add/remove), filters computed keys from declared fields, and passes real values to render (`kit.ts:301`).
P0-9 **Fixture corpus**: `fixtures/templates/` with ≥12 authored templates — GST invoice, retail receipt, quotation, delivery challan, salary slip, restaurant bill, Hindi (Devanagari) bill, fractional-quantity bill, credit note (negatives), multi-tax, landscape A4, minimal blank. Vitest `tests/fixtures.test.ts`: every fixture → `renderDocument` zero refusals, money property tests vs big.js reference (incl. negatives, `0.125` qty).
P0-10 Update goldens that intentionally changed and rerun `npm run typecheck && npm test && npm run test:e2e`.

**Exit P0**: corpus zero-refusal; money property tests green; e2e green.

### Phase 1 — Engine + vector PDF

P1-1 `lib/engine/types.ts`: `DisplayList` IR — page, rect/stroke, image, text run (fontId, size, px coords, shaped runs), all coordinates final; no callbacks. Serialisable JSON (golden-testable).
P1-2 `lib/engine/font/`: load bundled font bytes → opentype.js metrics; `measure(text, style) → {width, height}` exact replacement for `ContentMeasurement`; per-run shaping via harfbuzzjs (fallback metric shaping for Latin, refusal for complex scripts without WASM); UAX#14-lite line breaker.
P1-3 `lib/engine/layout.ts`: port/adapt `calculateLayout`, `rowHeights`, `expandRepeats` to consume engine measurements and emit the DisplayList (same solver contract; single re-solve loop semantics preserved from `render/index.ts:252-291`).
P1-4 `lib/engine/emit/pdf.ts`: pdf-lib writer — embed font subsets, text runs at computed positions, strokes as paths, images embedded; deterministic bytes.
P1-5 `lib/engine/emit/canvas.ts`: browser canvas painter (preview + Playwright PNG) painting the DisplayList verbatim.
P1-6 Golden + parity tests: per fixture display-list JSON snapshots; Node(vitest) vs browser(Playwright) identical; PDF page count/size/embedded-font checks + raster diff vs preview under threshold; bundle determinism (build twice, equal bytes); `serialise(hydrate(t)) == t`; Fabric-vs-engine canvas parity on 2 fixtures (catches the 1.13 line-height assumption and stroke offsets).
P1-7 Switch print path: `ExportMenu` → engine PDF; delete all Fabric/jsPDF print code (`toPdf.ts` raster paths, `renderTemplate` from print path). Fabric stays editor-interaction-only with parity guard. Field markers never reach output (placeholders `"hide"`).

**Exit P1**: identical display lists across runtimes; PDF = exact single A4 page, embedded subsets; preview and PDF raster below threshold.

### Phase 2 — Bundle v2 + editor wiring

P2-1 Manifest v2 (`lib/package/format.ts`): `engineVersion`, mandatory per-file SHA-256 map, `fonts[] {file, sha256, family, licence}`, template identity hash, per-field display formats, rounding mode. One consolidated validator merging `lib/package/validate.ts` + `lib/template/parse.ts` rules; checksums validated, never optional.
P2-2 `openBundle(bytes)` in `lib/package/open.ts` + exposed via billkit: unzip (fflate), verify all hashes, `engineVersion` compatibility check (refuse newer), asset resolution API (bytes + `URL.createObjectURL`). Hosts cannot render without it (fixes `kit.ts` missing-image class of failures, defect #9).
P2-3 Fonts: add the OSS font set to repo assets; font picker lists bundled fonts only; author font upload gated on embedding-permission check + licence acknowledgement; fonts zipped into every bundle.
P2-4 Editor: export/print blocked on validator errors (blocking on preflight); editor preview can render via engine (canvas display list) alongside Fabric with parity test; update `components/editor` font options.
P2-5 Ship: rebuild `sharekit.js`/`billkit.js`/engine (`build:share`, `build:billkit`, new `build:engine`), `tools/prepare-android-assets.ts` packs engine + fonts for the Android WebView host. Update `docs/contract/v1-format.md` → v2.

**Exit P2**: author → bundle → open (verified) → fill → PDF end to end, no fallback fonts, no editor markers in output.

## Validation

- Per phase: `npm run typecheck`, `npm test`, `npm run test:e2e` must be green.
- P0: money property suite (big.js reference, negatives, fractional qty) green; corpus zero-refusal.
- P1: golden display lists match across Node + browser; PDF checks (1 page A4, embedded fonts, raster diff < threshold); bundle determinism; PDF byte determinism across two writes.
- P2: tamper tests (flip a font byte / edit template.json → open refuses); engine-version refusal test.
- Release gate: print every fixture through the engine and pixel-diff PDF raster vs preview.

## Risks

- **pdf-lib determinism/subsetting** → fallback: hand-rolled minimal writer behind `writePdf` (decided by P1-6).
- **harfbuzzjs WASM unavailable in a host** → hard-fail for complex-script documents only; Latin runs on opentype metrics. Android WebView: WASM is available; verified in P1-6 by running the corpus in Playwright WebView.
- **Fabric parity drift during migration** → parity tests on 2 fixtures gate every engine change (the 1.13 line-height and stroke-centring assumptions live here as assertions, not folklore).
- **Git scope** — nested `version 1` dir; Task 0 establishes the single repo root before any commits.

## Out of scope (fast-follow on the same branch, then Phase 3–4)

- Pagination, headers/footers, repeating table headers across pages (largest functional gap; next work item).
- Rule packs, conditional blocks, number-to-words, QR/barcode fields.
- RTL scripts; iOS; bundle signing; telemetry; performance budget work beyond a smoke counter.
