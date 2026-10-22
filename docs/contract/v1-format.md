# BillKit v1 Format & Behavior Contract

**Versioned against:** `lib/package/format.ts` (`PACKAGE_VERSION = 2`), `lib/template/types.ts` (`TEMPLATE_VERSION = 2`), `lib/package/validate.ts`, `lib/render/*` — the behavior authority per plan instruction 3.

**Audience:** every consumer of a `.btpkg` — web renderer, Android host (`feature/renderer`), Admin server (`vendor/billkit-format`) — must implement exactly this contract, by reusing the same source, never by re-implementing.

## 1. Package envelope

- A package is a ZIP named `*.btpkg` containing `manifest.json`, `template.json`, `billkit.js`, `render.html`, `page.css` and the assets with the paths listed in the manifest.
- `manifest.packageVersion` must be 1 or 2; readers of this build accept both, v2 writers always emit 2. A v2 manifest additionally requires engineVersion (positive integer the host must not exceed) and `templateSha256` (the sha256 of the archived `template.json` member - the template's identity, verified at open time). `manifest.templateVersion` must be `≤ 2`. Forward versions are rejected **before any render** with a clear error (`package version N is not supported`). This rule is enforced by `validateManifest` and mirrored in the Android `ZipPackageReader` (`SUPPORTED_PACKAGE_VERSION = 1`).
- Validation produces `{ severity: "error" | "warning", path, message }` issues. `error` blocks storage/render; `warning` is stored with the package (`ingest_issues` table) and surfaced in the catalog.

## 2. Page geometry

- Canonical authoring/manifest unit is **CSS pixels at the template's DPI** (`document.width/height`, e.g. the A4 portrait defaults `794 × 1123` px @ 96 dpi).
- Physical size is derived, never stored twice: px ÷ dpi × 25.4 mm. Android derives paper via the pure `PaperSize` model (`feature/renderer/domain/PaperSize.kt`): `fromPixels(width, height, dpi, declared)` maps to A4/Letter within a **3 mm tolerance** at the declared dpi and otherwise emits a **custom MediaSize** at the exact dimensions with `COLOR_MODE_COLOR` + 300 dpi resolution.
- Single page only in v1. No perspective correction, no OCR — out of scope by contract, not by omission.

## 3. Objects (template)

Supported `ObjectType`: `line`, `shape`, `polygon`, `freehand`, `text`, `table`, `image-placeholder`, `bill-part`, `group`, `field`. Unknown object types in a newer template must be reported as errors (never silently dropped).

Key behaviors:
- `text`: roles `static | variable` (variable = `{{token}}` in text). Alignment `left | center | right`.
- `table`: `TableCell` grid with optional `TableRepeat` band `{ startRow, endRow, key, maxItems (default 200, cap validated 1..200) }` whose rows expand `items[key]` column-wise; a per-band repeat-header flag (honest warning when the header would be swallowed by trailer rows).
- `field`: standalone dynamic slot `{ key, fieldType }` rendered as the `{{key}}` token text.
- Layout: container policies (`ContainerPolicy`), child anchors (`ChildAnchor`, rules `start | end | stretch`), document growth `fixed | expand`, guide attachments `move | stretch` — implemented in `lib/render/layout.ts` and mirrored in `lib/canvas` (single source: the renderer, not the canvas re-derives geometry).

## 4. Fields (manifest)

`ManifestFieldType`: `text | number | date | currency | tickmark | checkbox | image | repeating`.

Parameters and validation (`validate.ts`): `maxLength`, `required`, `defaultValue`, `pattern`, `min` / `max` (finite, min ≤ max), `options`, repeating: `columns[]` (band order) + `maxItems` 1..200.

Field sources map from: static text token occurrences, table tokens, image placeholders, field objects.

## 5. Computed values

Ops: `sum`, `sum-times`, `add`, `subtract`, `multiply`, `percent`.

- Decimal-safety: operands are parsed at **RATE_SCALE = 6** fractional digits into integer minor units; every computed result renders at the field's declared scale (safeScale: integer 0..6, else 2).
- Half-up rounding on dropped digits (first dropped digit ≥ 5 → away from zero) — a customer-visible convention used for money.
- `items.amount` dotted args address **column `amount` of repeat `items`**; the dotted form resolves as a whole key first (a dot is legal inside a key name).
- Reference graph: forward references are legal (declaration order carries no meaning); **cycles are invalid** and rejected by `validateManifest` (including self-reference). Rationale: an evaluator would consume zero values and print a quietly wrong total rather than a visible failure.
- Missing operands/empty rows: an absent value contributes nothing (`sum`/`sum-times` treat empty rows as absent; scalar ops on a missing operand yield "no value" rather than 0 — downstream render shows the empty marker, not a corrupt figure).

## 6. Fonts & assets

- Fonts are optional (`manifest.fonts`, sha256 checksummed). Consumers with no font installer (Android) must fall back to documented system fonts and must not fail a package because its fonts are missing — but a **checksum mismatch is an error** (corrupt archive contract, below).
- Assets: `manifest.assets[]` with `{ path, sha256, byteSize }`; the reader verifies the checksum of each extracted member against the manifest in the same pass.
- Archive safety (enforced identically in `ZipPackageReader.kt` and server ingest): strict UTF-8 members (fail, never substitute U+FFFD), no path traversal/absolute/backslash/drive-letter/NUL entries, no duplicate members, declared sizes never trusted over streamed limits.

## 7. Limits (v1)

| Limit | Value |
|---|---|
| repeat cap per band | 200 items (default) |
| Android archive raw | 64 MB |
| expanded archive | 256 MB |
| archive entries | 2 000 |
| server upload (default) | `maxUploadBytes` config (checked-in default 50 MB) |

## 8. Delivery model (explicit, per plan Phase 1 bullet)

- v1 delivery is **operator-mediated**: the admin uploads a package, the catalog serves exact bytes by content id (`sha256`, strong immutable ETag). **There are no customer accounts; no public unlisted links exist.** If a customer link is ever added it must be expiring, revocable, unguessable and rate-limited — none of that exists in v1.

## 9. Error behavior at boundaries

| Boundary | Required behavior |
|---|---|
| forward `packageVersion`/`templateVersion` | reject with version-specific message, before validation of anything else |
| corrupt archive / checksum mismatch | reject; Android keeps current draft + loaded package untouched |
| oversized input | reject with limit named in the message |
| computed cycle | error at validate time, before render |
| unknown object type / unsupported field type | error (never silently drop data) |

---

**Exit criteria satisfied by this contract when:** the invoice / receipt / fixed-form examples built on these rules validate through the shared validation path and render identically from web and Android (Phase 6 fixture work).

## 8. v2 additions (print pipeline)

- **Bundle v2**: every archive member outside the manifest must have a `checksums` entry - a digest that is missing is a validation error, not an option. The manifest itself is verified against the sibling `manifest.json.sha256`.
- **Engine version**: `manifest.engineVersion` (v2, mandatory). A host refuses a bundle that needs a newer engine than it runs; this build is engine `1`.
- **Fonts are load-bearing**: the print engine measures from the bundled files (Arimo/Tinos/Carlito/Caladea/Noto set, metric-compatible with the alias names). A missing or hash-mismatched font is a hard refusal at print time - never a device-font substitution.
- **Money**: `document.quantityScale` (default 6) reads count operands at their own scale, so `0.125 x 550.25` stays `68.78`; `document.rounding` (`halfAwayFromZero` default | `halfEven`) is the one written rule for every precision drop, including negatives.
- **Row figures are computed by the engine**: band specs keyed on a band column (`line` from `items.qty x items.rate`) are evaluated per row and carried into the rows, so a grand total reads the same figures the rows print. Hosts type the inputs, not the results.
- **Display shaping**: per-field `display` (date pattern, number grouping - `indian` default for money-shaped keys, never applied to identifier-like keys) turns stored text into printed output; hosts may pass their own map to override the inferred defaults.
- **openBundle is the only supported entry**: unzip, mandatory checksums, engine-version gate, template identity verification and asset resolution in one call (`lib/package/open.ts`; exposed on the `billkit` global). A host that skips it renders outside the contract.
- **Print deliverable**: the vector PDF (lib/engine) is the authoritative output. Long bills render as one PDF with one page per sheet: the paginator cuts the solved space at paper boundaries, the band flows with a repeated header row, furniture reprints, and the summary follows the last chunk. Pages are A4-exact point boxes (595.28 x 841.89 pt) for A4 templates, with embedded font subsets and deterministic bytes. Runs needing complex-script shaping (Devanagari and other Indo-Arabic systems) refuse with a named message until a shaper is supplied; Latin text prints everywhere the font set reaches.
