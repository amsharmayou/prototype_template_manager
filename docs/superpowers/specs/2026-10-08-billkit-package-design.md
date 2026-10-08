# BillKit Package and Cross-Platform Bill Generation - Design Spec

**Date:** 2026-10-08
**Status:** Design approved, awaiting implementation plan
**Supersedes:** extends `2026-09-30-generalized-html-renderer.md` (see *Relationship to existing specs*)

## Problem

A bill template lives today as a `.json` file that only this web app knows how to consume.
A second frontend - an Android app, an iOS app, a desktop tool - cannot take that file,
discover what input it needs, collect it, and produce a bill that is ready to print and
share, without a bespoke integration written from scratch against our internals.

Four things stand in the way:

1. **There is no package.** A template is a bare JSON file opened with a file picker. There
   is no manifest, no declared schema version, no formal validation, and no asset directory.
   Bill-part images are inlined as base64, which inflates them by a third.
2. **There is no contract.** A frontend cannot know what a template will ask for, what
   values are valid, or whether a file it was handed is well-formed. `RenderClient.importTemplate`
   performs `JSON.parse` with **zero** structural checks; `EditorController.loadTemplate` performs
   five duck-type checks and **fails silently**.
3. **Line items cannot repeat.** `TableObject` has a fixed `rows` count and `fillTemplate`
   writes values into those fixed cells. A bill with more items than the author drew loses
   data silently. There is no repeating row band anywhere in the model.
4. **Output is web-locked and typographically unstable.** SVG, PNG and PDF all route through
   Fabric's `StaticCanvas`, which requires `document.createElement("canvas")`. DOCX is
   portable but nothing consumes it off-web. Fonts are referenced by name and never embedded,
   so an Android device substitutes glyphs.

## Goals

- One distributable artifact a template author produces and any frontend can open.
- From that artifact, a frontend **derives the input form automatically** - no per-template code.
- Filling the form and rendering produces a **print- and share-ready PDF**.
- Works from **any frontend that can host a WebView** (Android, iOS, desktop, plain browser),
  with no renderer porting and no server.
- **Repeatable line items** so a real invoice with any number of items renders correctly.
- **Identical typography everywhere**, by subsetting and bundling the fonts a template uses.
- Validate strictly, and refuse bad input loudly instead of silently.

## Non-goals

- A hosted render service.
- A native Kotlin or Swift reimplementation of the render core.
- Signed, encrypted, or DRM-protected packages.
- Multi-page named sections, page numbering, or running headers/footers.
- Perfect DOCX or SVG parity on non-web platforms.
- General-purpose layout or an expression language for computed values.

## Relationship to existing specs

`2026-09-30-generalized-html-renderer.md` deliberately deferred font embedding, stating that
glyph-identical output is "a decision about file size and licensing rather than about this
renderer." **This spec makes that decision** and amends it: fonts are subsetted at package
build time, bundled as woff2, and emitted as `@font-face`. Everything else in that spec -
the pure `lib/render` core, its source-text purity test, its golden files, the no-network
guarantee - is preserved and extended, not rewritten.

`2026-10-04-render-share-and-rendering-polish.md` and the existing
`lib/share/` + `buildShareDocument` path are generalised into the prebuilt HTML artifact
described below rather than replaced.

## Architecture

Three artifacts, with one deliberate asymmetry: **the package is the distributable format;
`BillTemplate` (with inline data URIs) remains the in-memory render format.**

```
billkit.js   TypeScript -> esbuild IIFE, ~30-40 KB, no module loader, no DOM required
             parsePackage / validatePackage / deriveForm / render / renderToShareDocument

.btpkg       ZIP
             manifest.json    schema versions, page setup, field contract, fonts, assets
             template.json    BillTemplate geometry and styles, NO image bytes
             assets/*.png     bill-part crops and bound image slots, as real binary
             fonts/*.woff2    subsetted, one per family the template uses

bill.html    Prebuilt, self-contained: runtime + one package + the form UI, all inlined.
             Double-clickable demo and the integrator's reference implementation.
```

The asymmetry is what keeps this cheap. `renderHtml` already consumes a `BillTemplate` whose
`bill-part.src` is a data URI, and its purity test forbids `fetch`. So the package layer
resolves `pkg://` asset references back into data URIs *before* calling `renderHtml`, and the
existing renderer is used unmodified. No renderer change is needed to make assets work.

### Host integration

The whole contract a non-web frontend implements:

```js
const pkg  = billkit.parsePackage(await fetch(url).arrayBuffer()); // or read a bundled asset
const form = billkit.deriveForm(pkg);        // the input form, derived
const { html } = billkit.render(pkg, values); // values: Record<string,string>
webView.print(html);                          // -> PDF, via the platform print pipeline
```

The host owns its own form UI and its own file writing. BillKit owns derivation and rendering.
A host with no code beyond these four lines can already print a bill.

## Package format

### `manifest.json`

```jsonc
{
  "packageVersion": 1,
  "templateVersion": 2,
  "name": "Invoice A4",
  "document": {
    "width": 794, "height": 1123,
    "unit": "px", "dpi": 96, "paper": "A4",
    "currencyScale": 2
  },
  "template": "template.json",
  "assets": [
    { "id": "obj_7", "role": "bill-part", "file": "assets/obj_7.png",
      "width": 620, "height": 180 }
  ],
  "fonts": [
    { "family": "Arial", "file": "fonts/arial-subset.woff2",
      "sha256": "9f2c…" }
  ],
  "fields": [
    { "key": "customer_name", "label": "Customer name", "type": "text",
      "source": "text", "objectName": "Header", "required": true,
      "maxLength": 80 },
    { "key": "items", "label": "Line items", "type": "repeating",
      "source": "table", "objectName": "Items",
      "columns": ["description", "quantity", "rate", "amount"],
      "maxItems": 200 }
  ],
  "computed": [
    { "key": "subtotal", "op": "sum", "args": ["items.amount"] },
    { "key": "tax",      "op": "percent", "args": ["subtotal"], "rateKey": "tax_rate" },
    { "key": "total",    "op": "add",    "args": ["subtotal", "tax"] }
  ],
  "checksums": { "template.json": "4b1e…" }
}
```

`unit` and `dpi` are stated explicitly. Today the template relies on an *implicit* 96 dpi
documented only as `PX_TO_TWIP = 15` in `lib/export/toDocx.ts`; a package consumed by a
foreign frontend must not depend on that being remembered.

### `template.json`

A normal `BillTemplate`, except image bytes are replaced by references:

```jsonc
{ "type": "bill-part", "src": "pkg://assets/obj_7.png", "width": 620, "height": 180, … }
```

`pkg://` is a package-internal scheme. `resolveAssets()` maps it to a data URI from the
loaded asset map, producing the in-memory `BillTemplate` the renderer expects. The scheme is
deliberately one the existing `isSafeImageSrc` guard rejects, so an un-resolved reference can
never silently reach an export as a live remote URL.

### Validation

`validatePackage()` returns issues rather than throwing, each with a path:

| Severity | Meaning |
|---|---|
| `error` | Package is unusable. `parsePackage` refuses; the host must not render. |
| `warning` | Package loads, but something is degraded (unknown object type, substituted asset). |

Checked: zip integrity; required files present; `packageVersion` supported; `templateVersion`
supported; `document.width`/`height` positive and finite; every `assets[].file` exists in the
archive; every `template.json` `pkg://` reference resolves to a declared asset; no duplicate
field keys; `fields[].type` within the union; `fonts[].file` exists; checksum match per file.

This replaces today's behaviour, where a garbage JSON object sails through
`RenderClient.importTemplate` into `renderHtml`. Unknown object types are a **warning** and are
skipped, matching how `lib/render/primitives.ts` already records a refusal and returns `null`.

## Versioning and migration

`TEMPLATE_VERSION` moves `1 -> 2`. The only schema change is the additive, optional
`TableObject.repeat`, so **every v1 template is a valid v2 template** and loads unchanged.

`lib/template/migrate.ts` is introduced because none exists. Today a version check happens in
exactly one place - `lib/render/index.ts` throws if `templateVersion > TEMPLATE_VERSION` - and
`EditorController.loadTemplate` does not check it at all. `migrateTemplate(raw)` returns
`{ template, notes }`, runs `normalise*` passes for optional/absent fields, and reports what it
changed. v1 to v2 is an identity transform plus a note.

## Form derivation

`deriveForm(pkg)` returns a `FormSchema`, extending the existing `extractTemplateFields`. That
function is kept as the flat non-repeating case; the package layer adds grouping, ordering,
and validation.

```ts
interface FormSchema {
  groups: FormGroup[];        // ordered, mirroring form UI grouping
  fields: FormField[];        // flat, in first-appearance order
  repeats: RepeatSpec[];     // repeating line-item groups
  computed: ComputedSpec[];   // totals the host need not supply
}
```

`FormField` extends `TemplateField` with `required`, `pattern`, `min`, `max`, `options`,
`minLength`. Grouping reuses the existing `source` discriminator already used by both existing
forms (`text`/`field`, `table`, `image-placeholder`).

`type` reuses the existing `FieldType` union (`text | number | date | currency | tickmark |
checkbox | image`) and adds one kind, `"repeating"`, which is meaningful only on a field whose
`source` is `table` and whose table carries a `repeat` band. It is not added to
`lib/template/dataBinding.ts`'s `FieldType` - repeating is a package-layer concept, and the
renderer never needs to know about it.

**Validation rules are host-enforceable, not renderer-enforced.** The schema carries them; a
host that ignores them still renders correctly, because unvalidated values substitute rather
than throw.

## Repeat rows

`TableObject` gains an optional repeat band:

```ts
repeat?: {
  startRow: number;    // 0-based, inclusive - first row of the template band
  endRow: number;      // 0-based, inclusive - last row of the template band
  key: string;         // values key holding the array of items
  repeatHeader: boolean; // repeat headerRow on each page when the band splits
  maxItems: number;    // hard cap; render refuses beyond it
}
```

A band may span more than one row, so a two-row-per-item layout is expressible.

At fill time the band is **cloned per item**, and every `{{column}}` token inside the band is
resolved from that item rather than from the flat values map. Tokens in a repeating band are
resolved item-scope first, then fall back to the flat map, so `{{description}}` means
`item.description` inside the band and a global elsewhere. Ambiguity is resolved in favour of
item scope, and the manifest must declare the band columns explicitly so the form can be built.

The table's `rows` and `rowHeights` grow to fit. Objects below the table **do not move**;
`document.height` is fixed. A bill that outgrows the page must be caught, not silently clipped,
so `render()` returns a `warning` naming the object when content would exceed the page, and the
editor surfaces it when the band is authored. `maxItems` caps the row count to keep a malformed
input from generating an unbounded table.

## Computed values

Totals are computed in **integer minor units** (paise/cents) and only formatted at the end.
Floating-point money is the classic source of bills that are off by one paisa; a fixed decimal
scale is declared in the manifest (`document.currencyScale`, default `2`) and the arithmetic is
integer throughout. A value arriving as a decimal string is parsed to minor units by exact
string handling, never by `parseFloat`, so `19.99` cannot become `19.989999999999998`.

`op` is a **fixed vocabulary**, evaluated by a pure function - not `eval`, not a parsed
expression string. v1 supports exactly:

| `op` | Meaning | Args |
|---|---|---|
| `sum` | Add one value per row of a repeat | `["items.amount"]` |
| `sum-times` | Sum of `arg[0] * arg[1]` per row | `["items.quantity","items.rate"]` |
| `add` / `subtract` / `multiply` | Combine flat values | `["subtotal","tax"]` |
| `percent` | `arg[0] * rateKey / 100` | `["subtotal"]` + `rateKey` |

A dotted arg such as `items.amount` means "column `amount` of repeat `items`"; an undotted arg
is a flat values key. This is a deliberate YAGNI cut: a general expression language is a
security and correctness liability for no benefit at this stage.

`amount_in_words` is included, since `SUGGESTED_VARIABLES` already lists it and it is
mandatory on Indian bills. `lib/render/words.ts` implements English cardinal words with an
extensible locale table; unknown locales fall back to digits rather than to wrong words.

## Fonts

At package build time each family used by the template is subset to the glyphs it can actually
display - the union of every literal character in the template, a declared extra charset, and a
fixed safety set (ASCII printable, digits, currency and typographic punctuation) - then encoded
as woff2 into `fonts/`.

Subsetting uses `subset-font` (HarfBuzz via wasm) as a **build-time devDependency**. It is not
installed today; this is new and Phase 3 must verify it works offline in this repo before the
phase can close.

Fonts are loaded by the **package layer**, not the renderer: `render()` accepts a prepared
`fontFaces` string on `RenderOptions` and `lib/render/style.ts` emits it verbatim. `lib/render`
stays free of encoding, fetching, and file access, so its existing purity test and goldens keep
holding unchanged.

Licensing is the author's responsibility, and the manifest records a `fonts[].sha256` so a
consumer can detect tampering. This is recorded, not enforced.

## Runtime bundle

`lib/billkit/main.ts` becomes the bundle entry, mirroring the proven `build:share`:

```
esbuild lib/billkit/main.ts --bundle --minify --format=iife --target=es2019 --outfile=public/billkit.js
```

`public/sharekit.js` is 25 KB today; the new bundle should land in the same range. The entry
must reach only platform-free modules - no React, no Fabric, no module loader, no `fetch`,
no `document`.

Public API:

```ts
billkit.parsePackage(bytes: ArrayBuffer): Package
billkit.validatePackage(pkg: Package): { ok: boolean; issues: Issue[] }
billkit.deriveForm(pkg: Package): FormSchema
billkit.render(pkg: Package, values: Record<string,string>,
               options?: RenderOptions): { html: string; refusals: Refusal[];
                                            warnings: string[] }
billkit.renderToShareDocument(pkg: Package, values: Record<string,string>,
                              runtimeSource: string): string
billkit.VERSION: string
```

`renderToShareDocument` takes the runtime source as an argument rather than reading a global,
mirroring the existing `buildShareDocument(template, kitSource)` signature, so it stays pure and
testable.

The runtime must not rely on `btoa` for base64 encoding: it is absent on some non-browser hosts,
which is the same reason `lib/render/sha256.ts` is hand-written rather than using
`crypto.subtle`. Base64 comes from `fflate`, which Phase 1 already depends on.

`render()` never throws on bad *data*; it substitutes and reports. It throws only on an
unsupported `packageVersion` or `templateVersion`, because no correct output exists then.

## PDF handoff

BillKit emits HTML. The platform owns the PDF, because every target already has a print
pipeline and none should be reimplemented.

| Host | Mechanism |
|---|---|
| Android | `WebView.createPrintDocumentAdapter()` -> `PrintManager` |
| iOS / macOS | `WKWebView` + `UIPrintPageRenderer` |
| Desktop / plain browser | `window.print()` |

`Document_Renderer_and_Printer.md` records an 11-item Android print checklist, including that
invisible views skip Chromium's pipeline entirely and that print attributes must carry
resolution and colour mode. Phase 5 adopts that checklist rather than rediscovering it, and
`2026-09-30-generalized-html-renderer.md` already notes which items transfer to a plain browser
print.

This is the one genuinely lossy seam: WebView-to-PDF pagination is Chromium's, so BillKit
cannot control where a page breaks. The repeat band mitigates it with `repeatHeader`, and the
overflow warning makes silent truncation impossible.

## Prebuilt HTML

`renderToShareDocument()` generalises today's `buildShareDocument`. It inlines the runtime, the
package, and a working form UI into one file that needs no network and no build step. It
exists to be opened, and to be read: an integrator can read one file to see exactly how the
five-line integration is supposed to behave.

## Reference Android host and parity

Phase 5 ships a small Kotlin WebView host proving the integration end to end, and a parity test
comparing its output against the web path. The comparison is on **text tokens, page count and
page geometry - never bytes**, following the precedent in `Document_Renderer_and_Printer.md`.
Bytes would fail on font rasterisation and Chromium version differences and would produce a
test that cries wolf.

## Phasing

Each phase ships value and can stop there.

| Phase | Deliverable | Can ship alone? |
|---|---|---|
| 1 | `lib/package/` - format, strict validator, v1->v2 migration, `.btpkg` writer | Yes - a validated, smaller template file with a manifest |
| 2 | Repeat rows + computed totals + amount-in-words | Yes - real invoices on the existing web app |
| 3 | Font subsetting + `@font-face` | Yes - identical typography |
| 4 | `billkit.js` runtime + prebuilt HTML | Yes - the distributable runtime |
| 5 | Host integration guide + reference Android host + parity test | Yes - proof on a second platform |

Phases 1 and 2 improve this web app on their own and are worth doing even if no second frontend
ever appears. Phases 3-5 are what make the package portable.

## Testing

- **Package**: unit tests for parse/build/validate round-trips, checksum detection, every error
  severity, and a test proving an un-resolved `pkg://` never reaches an export.
- **Migration**: every v1 fixture still loads and renders byte-identically under v2.
- **Repeat**: golden tests for zero, one, many, and over-`maxItems` items; integer-unit tests
  pinning totals against float-arithmetic bugs specifically.
- **Fonts**: subset output is asserted to contain the safety set and to have shrunk; a rendered
  document must contain the `@font-face` and no network reference.
- **Runtime**: the existing `lib/render` purity test is extended to `lib/billkit` - no Fabric,
  React, `fetch`, `document`, `window`, `Date`, `Math.random`, or `Intl`.
- **Parity**: tokens, page count and geometry across web and WebView.

## Risks and honest limits

- **Font subsetting is unverified.** No subsetting library is installed. `subset-font` pulls in
  HarfBuzz wasm; if it cannot build offline here, Phase 3 falls back to accepting substitution.
  This is the phase most likely to need a different approach.
- **`fflate` is currently only a transitive dependency of `docx`.** Phase 1 must promote it to
  an explicit dependency, or a future `docx` bump breaks package reading invisibly.
- **Repeat rows change the meaning of `rows`.** A v1 template that has `rows: 3` still means
  three rows; the band is opt-in and additive, so nothing silently changes meaning.
- **Objects below a growing table do not move**, so a very long bill can overflow the page. The
  warning covers it; automatic reflow is explicitly out of scope.
- **Chromium owns pagination** in the WebView print path, so exact page breaks are not
  controllable from JavaScript.
- **DOCX stays web-oriented.** Its encoding is pure, but no mobile host is asked to consume it.
- **License compliance for embedded fonts is the author's responsibility.** The manifest
  records a hash; it does not enforce a licence.

## Files

New:

```
lib/package/format.ts        PackageManifest, PACKAGE_VERSION, types
lib/package/parse.ts         zip -> Package, checksum + presence checks
lib/package/build.ts         BillTemplate + assets -> .btpkg bytes
lib/package/resolve.ts       pkg:// -> data URI, producing the in-memory BillTemplate
lib/package/validate.ts      Issue list, errors and warnings
lib/package/fonts.ts         subset + woff2 encode + @font-face assembly
lib/template/migrate.ts      migrateTemplate(raw) -> { template, notes }
lib/render/repeat.ts         band cloning, item-scope token resolution
lib/render/computed.ts       integer-minor-unit totals
lib/render/words.ts          amount-in-words
lib/billkit/index.ts         public API
lib/billkit/main.ts          esbuild entry
tests/package/*.test.ts
```

Modified:

```
lib/template/types.ts        TEMPLATE_VERSION 1 -> 2, TableObject.repeat
lib/render/index.ts          RenderOptions gains fontFaces; render() gains warnings
lib/render/style.ts          emit @font-face verbatim
package.json                 explicit fflate; devDep subset-font; build:billkit script
tests/render.test.ts         extend the purity scan to lib/billkit
```

Unchanged, and deliberately so:

```
lib/render/**                the pure renderer, its goldens, its purity guarantee
```

## Next step

Invoke the `writing-plans` skill to turn this into a phased implementation plan.