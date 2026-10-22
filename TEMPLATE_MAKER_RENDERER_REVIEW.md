# Version 1: Editor → `.btpkg` → Form and Renderer Review

**Review date:** 21 October 2026  
**Scope:** The workflow you described: author in the Editor, export `.btpkg`, let the package renderer derive a form, combine submitted data with the template, and render the finished bill. I reviewed the current source and related tests/tools, excluding documentation and comments embedded in code as requested. I did not run tests or builds.

## Executive assessment

The codebase has a strong foundation for this focused pipeline. The Editor uses an application-owned template model; the `.btpkg` export writes that template, moves inline images into archive assets, derives fields and repeatable table metadata, includes calculations and checksums, and validates the package it just built. The BillKit runtime provides form derivation, variable-layout measurement and HTML rendering for a host application.

**The format/export side is more complete than the package-loading/host-rendering side visible in this repository.** The `BillKit` bridge expects a host to unpack the `.btpkg`, validate it, resolve `pkg://` assets, and pass JSON to its form/render methods. Those steps are not one atomic API, and the in-repo `/render` page does not load `.btpkg` files. If your production renderer is a separate Android/app host, its archive-loading, validation, native form controls, value validation, WebView printing and error handling are outside this workspace and cannot be certified by reviewing this repository alone.

For supported single-page bills, the design is credible and thoughtfully layered. It is not yet a general document pipeline: the product itself says `.btpkg` v1 is single-page and has no OCR, and the renderer does not paginate. The most important production work is to make package load → validate → resolve → form → validate values → measure → render a single, enforced host contract, and verify the actual host implementation against it.

| Part of your workflow | Assessment |
|---|---|
| Editor authoring model | Strong feature set for visual bill tracing; portable model is a good foundation. |
| `.btpkg` export | Well considered: manifest, images as assets, repeat/form metadata, calculations, hashes, deterministic ZIP timestamps, and self-validation. |
| Package consumption in this repo | Building blocks exist, but there is no single safe package-to-render entry point or integrated `.btpkg` upload flow. |
| Form derived from package | Schema includes ordinary fields, repeated collections and computed rules. Repeat-column UI/type handling depends on the host. |
| Data + template rendering | Pure HTML renderer and BillKit bridge exist. Host must resolve assets and supply layout measurements in the correct order. |
| Variable layout | Capable opt-in layout system; its browser/host measurement boundary must be implemented consistently. |
| Production scope | Promising for single-page bills; not arbitrary documents or multipage output. |

## The exact pipeline in code

```text
Editor (Fabric canvas)
  │  getTemplate() → app-owned BillTemplate
  ▼
buildPackage(template, computedSpecsFor(template))
  ├─ template.json (with inline asset src values replaced by pkg:// paths)
  ├─ assets/* (inline image bytes)
  └─ manifest.json (page metadata, fields, repeat columns, calculations, checksums)
  ▼
writePackage() → .btpkg ZIP
  ▼
exportPackage() reparses and validates the produced ZIP; errors block download
  ▼
HOST RESPONSIBILITY (the .btpkg-consuming app)
  ├─ parsePackage(bytes)
  ├─ validatePackage(package) and stop on errors
  ├─ resolvePackage(package) → template with pkg:// assets inlined
  ├─ deriveFormBridge(manifest JSON, template JSON) → form schema
  ├─ collect values and enforce required/type/range/repeat constraints
  ├─ if layout.mode = variable: measurePlan → measure → render(measurements)
  └─ renderBridge(template JSON, values JSON, computed JSON, measurements JSON)
       └─ fill → compute → expand repeat rows → row sizing → layout solve → HTML
```

Key source areas are `lib/export/toPackage.ts`, `lib/package/build.ts`, `lib/package/parse.ts`, `lib/package/validate.ts`, `lib/package/resolve.ts`, `lib/package/form.ts`, and `lib/billkit/bridge.ts` / `main.ts`.

## What is good in this pipeline

### Editor → template → package

- **The persisted model is not Fabric serialization.** `BillTemplate` is an application-level contract, with serialize/hydrate adapters for the editor. This keeps the exported template readable to non-Fabric renderers (`lib/template/types.ts`, `serialize.ts`, `hydrate.ts`).
- **The package adds the right broad ingredients.** The manifest describes the template, page, fields and computed rules; image data is extracted to archive members and referenced with `pkg://`; checksums cover the files; the manifest has a sibling digest.
- **Export validates what will ship.** `buildPackageBytes` writes the archive, parses it again and runs `validatePackage`; `exportPackage` blocks a download if errors exist (`lib/export/toPackage.ts`).
- **Repeat bands are explicit.** Table row ranges, the collection key and max item count are represented in the template; the package manifest exposes repeat field columns and an item limit so another frontend can build a line-item form.
- **Package output is designed to be reproducible.** Build timestamps are neutralized and ZIP timestamps pinned, helping identical inputs produce stable package bytes (`lib/package/build.ts`).
- **The variable-layout model is part of the portable template.** Growth settings, guides, attachments, container hierarchy and document policy serialize into the template. This is necessary for a host renderer to reproduce author intent rather than relying on editor-only state.

### Form and rendering runtime

- **The BillKit API has a clean division of work.** `deriveForm`, `measurePlan`, `measure`, and `render` are exposed as a small host-facing API (`lib/billkit/main.ts`). Form and rendering semantics remain in shared modules rather than forcing each host to reimplement token parsing.
- **Calculation language is constrained.** The renderer does not evaluate arbitrary expressions. Supported operations are enumerated and package validation checks references, repeat-column paths and computed cycles.
- **Render order accounts for dependent geometry.** `renderHtml` computes values, expands repeated rows, applies measured row heights, solves variable layout, and only then paints objects. A guide below a growing repeated table therefore sees its expanded height.
- **Image and text output has safety work.** Rendered text/attributes are escaped, image schemes are filtered, and the package resolver reports unresolved asset paths.
- **There is substantial test coverage in the repository** for package creation/validation/round trips, forms, computations, repeats, layout, rendering and the browser kit. This is evidence of intended contracts, though this review did not run the suite.

## Main findings for the `.btpkg` renderer workflow

### 1. Package consumption is a host protocol, not a one-call pipeline

`parsePackage` only unzips and parses `manifest.json`. It does not validate. `resolvePackage` converts `pkg://` references into inline data but also does not validate. `deriveFormBridge` parses JSON with type casts and directly derives a form. `renderBridge` expects an already-resolved plain template and values; it does not open a ZIP, validate a package, or resolve `pkg://` assets.

This separation is defensible, but the host must call the pieces in exactly the right order and surface their errors. The editor’s `.btpkg` export does validate the package it creates, but that does not validate packages later received by a renderer. A host that skips validation can display a form from an inconsistent manifest; one that skips resolution can omit packaged bill-part images. `resolvePackage` returns unresolved assets separately, and a missing `bill-part` can disappear from the final page, so the caller must not ignore that list.

**Recommendation:** Add a single package-runtime entry point that accepts ZIP bytes, applies size limits, parses, validates, resolves assets, and returns either a complete render-ready package or structured errors. Make it difficult for a UI to call `deriveForm` or `render` on an unvalidated/unresolved package by accident.

### 2. The renderer bundle does not validate submitted values

The app’s React `/render` path validates ordinary and repeating values before PDF/HTML/print. The standalone ShareKit also calls `validateTemplateValues` and `validateRepeatingValues`. The host-facing `window.billkit` API, however, exposes only `deriveForm`, `measurePlan`, `measure` and `render`; `renderBridge` does not enforce the manifest’s `required`, `type`, `min`, `max`, `maxLength`, or repeat-row shape itself.

Repeat expansion caps rows and returns warnings, while numeric parsing in calculations is intentionally tolerant. Those are useful last-resort rendering behaviors, but they are not equivalent to rejecting invalid customer input. A native host must independently enforce the form contract or expose/use the existing validation functions before rendering. The manifest has `pattern` and `options` fields, but the editor’s `PlaceholderSpec` and `extractTemplateFields` currently do not populate those constraints, so those manifest capabilities are not fully authorable through this editor.

**Recommendation:** Expose a `validateValues(manifest, template, values)` BillKit call and make the host block final output when required fields, input constraints, malformed repeat JSON/rows, or item caps fail. Show validation errors next to fields, not only as a render warning.

### 3. Variable layout depends on the host carrying out an extra measurement loop

`renderBridge` accepts optional measurements; it does not run a font engine. The host is expected to request `measurePlan`, measure the returned text/cell boxes in a DOM, then pass those measurements to `render`. Without them, variable-layout templates render without the intended measured growth. The regular React renderer and ShareKit explicitly perform this loop and a possible remeasure after X growth; a native host must match that behavior.

The measurement contract also depends on available fonts, font loading, line-height and letter-spacing semantics matching the HTML renderer. `measureDom` measures with fonts installed in the current runtime; packages declare `fonts: []` and do not embed font files. The same template can therefore grow differently on devices with different fallback fonts. A poor measurement may clip content or move attached elements differently, even when the solver itself is deterministic.

**Recommendation:** Treat the measurement loop as mandatory when `layout.mode === "variable"`; define what happens if the host cannot measure. Add font-loading readiness and fallback policy, and compare layout results on the actual Android/WebView and browser versions you ship.

### 4. Current form derivation supports line items, but the host must interpret the repeat contract

`deriveForm` returns both a flat `fields` list and `repeats` specifications. Each repeat has a collection key, object name, ordered columns and maximum rows. It intentionally filters the repeating collection out of ordinary manifest fields and adds it back as `type: "repeating"`.

The schema does not prescribe a detailed row-editor UI or carry a separate full field schema per repeat column. For example, column tokens can be inferred as `currency`/`number` by ordinary field discovery, but the derived repeat spec contains only column names. A host that wants typed inputs for description, quantity and price must join repeat columns to manifest fields or establish a convention; the repo’s React repeat editor instead renders plain text inputs for each column. Required/range constraints can be checked after row entry, but the user experience is less guided than ordinary fields.

**Recommendation:** Define repeat columns as first-class field specs inside the repeating field (label, type, required, length/range/default), and use the same metadata for form rendering and row validation in every host.

### 5. Archive resource limits are missing before decompression

`parsePackage` calls `unzipSync(bytes)` before package validation. The uploaded JSON template has a file-size cap, but the package parser shown here has no compressed-size, expanded-size, entry-count or per-asset limits. Validation happens after decompression, too late to protect memory/CPU from a very large or highly compressed archive.

Checksums are useful for detecting content changes when verified; they are not signatures and do not establish package origin. The package build also records MIME declared by the data URI, not a type sniffed from the asset bytes.

**Recommendation:** Enforce archive and asset budgets before or during extraction, cap template/object/table/repeat sizes at the package boundary, sniff image bytes, and use signatures only if you need trusted publisher identity.

### 6. It is a single-page bill renderer

The package export UI itself labels `.btpkg` v1 “single page, no multi-page, no OCR.” The HTML stylesheet uses a page-sized sheet with `overflow: hidden`. Repeat bands expand rows and variable layout can expand a page when configured, but there is no pagination, row splitting across pages, repeated page header, page number or footer flow. The renderer warns that `repeatHeader` cannot be honored across pages.

This can work well for compact invoices/receipts and one-page forms, especially if the template page is configured to grow vertically. It is not suitable yet for the claim “any kind of bill/document” when arbitrary item counts must flow over multiple physical pages.

**Recommendation:** Keep single-page as an explicit product constraint for v1. Reject or clearly report content outside a fixed page; for expanded pages, make the print-to-paper behavior explicit. Build pagination as a separate feature with page-break and repeated-header rules rather than treating taller HTML as pagination.

### 7. Asset and offline behavior needs a clear policy

Inline data images are packaged. Remote image sources are left in the template and not included in package assets; the HTML renderer permits `http://` and `https://`. Thus, `.btpkg` is self-contained for embedded images but not necessarily for every image a template references. A customer’s render can depend on network access, remote URL stability or third-party availability.

**Recommendation:** Either reject external asset URLs when exporting a self-contained `.btpkg`, or make the external dependency visible in package validation and the host UI. Prefer local data/assets for offline renderer promises.

## Feature consistency for the path you use

| Feature | Editor → `.btpkg` behavior | Renderer contract / caveat |
|---|---|---|
| Text placeholders and standalone fields | Extracted into manifest fields with labels, types and supported constraints. | Form can be derived; host must validate values before final output. |
| Image placeholders | Field appears in manifest; selected customer image is supplied as a value. | Renderer accepts safe image sources; host must preserve file value and validate size/type. |
| Repeated table rows | Band key, columns and item cap are written to manifest; template retains row band. | Renderer expands rows from JSON collection values; host must create that value shape and surface cap/warnings. |
| Computed totals | Editor computes automatic subtotal/total specs and packages them. | `renderBridge` computes from manifest specs; invalid/missing numeric values can become zero if host permits them through. |
| Fixed layout | Geometry is stored in template. | Can render without measurements, subject to the selected HTML runtime/fonts. |
| Variable layout | Policies/guides/attachments are serialized. | Host must run measure plan → measure → render; omitting measurements loses intended growth. |
| Embedded bill parts | Image bytes become archive assets and `pkg://` references. | Host must validate and resolve package assets before rendering; unresolved bill parts may be omitted. |
| Fonts | Manifest has a fonts section, but package builder currently writes `fonts: []`. | Renderer uses system/fallback fonts; visual and measured parity is not guaranteed across devices. |
| More than one page | Not supported by current package v1 UI contract. | No pagination or page-break engine. |

## Production-readiness priorities for this workflow

### P0 — required before trusting external customer output

1. **Review the actual `.btpkg` host code.** This repository cannot establish that the production host validates every package, resolves all assets, validates values, measures variable fields, handles warnings, and prints the final page correctly.
2. **Provide one safe package loader.** Enforce archive limits, parse, validate, migrate if supported, resolve assets, and return explicit errors through one API.
3. **Add host-facing value validation.** Return field-level and row-level errors from the same shared runtime so required/type/range/length rules do not drift across Android and web.
4. **Make variable-layout measurement a tested host contract.** Test long text, very long unbroken values, tall repeated rows, bounded growth, missing measurements, fallback fonts and expanded page bounds on the shipped WebView/browser.
5. **Verify print output on target devices/printers.** Check physical page size, clipping, color/background printing and whether an expanded single sheet is printed/scaled in the intended way.

### P1 — before broad template/customer use

1. Put per-column field metadata into the repeat schema and use it in every host form.
2. Add package-level limits for object count, table dimensions, repeat data, text length, archive bytes and image pixels; parse limits should apply before full decompression.
3. Validate embedded image bytes and expose unresolved asset/refusal/warning data in the host UI instead of quietly rendering a missing part.
4. Specify fallback fonts and print fidelity. Embed licensed font assets if matching typography across devices is required.
5. Establish compatibility rules for package/template versions and migration behavior; add forward/backward fixtures for packages saved by each supported editor/renderer release.

### P2 — product scope expansion

1. Add multi-page flow only if customer use cases require long invoices/reports; define page breaks, repeated table headings, totals on final page and page numbering first.
2. Add OCR/auto-tracing only as a separate authoring feature; it is not present in this pipeline now.
3. Add package provenance/signatures if the host needs to distinguish approved company templates from arbitrary files.

## Direct answer for your workflow

**Yes:** the code is designed to export a `.btpkg` that contains the template and enough manifest data to derive a form, and the BillKit runtime can combine submitted values and computed values with the resolved template to produce rendered HTML. Repeated table rows and opt-in variable layout are part of that pipeline.

**The key condition:** the package renderer must perform the host steps correctly. In this repository the BillKit API accepts manifest/template/value JSON; it does not itself open and validate `.btpkg`, resolve its assets, or enforce submitted-value validation. The code provides those building blocks separately. If your real renderer lives in another app, that code must be reviewed alongside this repo before calling the complete end-to-end flow production-ready.

**Scope:** it is for single-page bill-like templates, not arbitrary or multi-page documents. “Any kind” would overstate current capabilities.

## Review boundary

This report is based on static inspection of the current workspace source and related test/tool code, excluding documentation and comments in code as requested. The workspace contains pre-existing modified and untracked files; it was reviewed as-is. The package-consuming host may be outside this repository. No test or build result is implied.
