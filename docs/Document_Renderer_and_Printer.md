# Document Renderer and Printer

How TransportApp2 turns a stored booking into printable, shareable paper — how the
pipeline is built, an assessment of the implementation, and what could be improved.

---

## 1. Overview

The feature is a **document pipeline** that takes any bilty (consignment note), challan,
freight bill, receipt or statement, renders it to a self-contained HTML document, converts
that HTML to a vector PDF, and then prints, shares or saves it. The pipeline has one
governing principle stated throughout `Implementation.md` §9:

> The paper must match the data the shop already recorded — never re-derive it.

This yields three hard invariants:

1. **Determinism** — the same snapshot + template always produce byte-identical intent
   (same totals, same layout, same pagination).
2. **Offline capability** — a shop must be able to bill with no network. Rendering never
   touches the network, remote fonts, or remote images.
3. **Version pinning** — a document is always printed through the template version that
   existed when the snapshot was created, never today's active template.

---

## 2. Architecture — the six stages

The pipeline is split across modules so that the largest portion is pure, testable
JVM code and only one step touches Android.

```
┌──────────────────────────────────────────────────────────────────────┐
│  data/transport          DocumentRepositoryImpl (impure, Android)    │
│                                                                        │
│  1. Load consignment + latest snapshot (Room)                          │
│  2. Resolve template at PINNED version (template_version column)       │
│  3. TemplateParser.parse(content_json)        ── doc-engine (pure JVM) │
│  4. payloadToValues(snapshot.payload_json)    ── decode §8 payload     │
│  5. HtmlRenderer.renderCopies(...)            ── doc-engine (pure JVM) │
│  6. PdfPort.render(html, jobName)             ── pdf-android (impure)  │
│  7. PdfActions: print / share / saveToDownloads                        │
└──────────────────────────────────────────────────────────────────────┘
```

| Stage | Module | Purity | Responsibility |
|---|---|---|---|
| Snapshot load | `data/transport` | Impure (Room, Hilt) | Fetch consignment + latest snapshot |
| Template resolution | `data/transport` | Impure | Fetch the *pinned* template version; fail with `TEMPLATE_VERSION_MISSING` if absent |
| Parsing & validation | `doc-engine/TemplateParser` | Pure | JSON → `TemplateModel`, refuse anything malformed |
| Payload decoding | `DocumentRepository.payloadToValues` | Pure | Flat JSON object → flat `Map<String, String>` of print-ready strings |
| Rendering | `doc-engine/HtmlRenderer` | Pure | Template + values → one self-contained HTML string |
| Calculation | `doc-engine/Expressions` | Pure | Whitelisted expression evaluation, integer-paise money math |
| PDF + distribution | `pdf-android/AndroidPdfRenderer` | Impure | HTML → A4 vector PDF; print/share/save adapters |

Module rules (`Spec.md` §2): `doc-engine` is a pure module — CI fails on any
`import android.*`. kotlinx-serialization is allowed **only** there (D47); snapshot
values cross module boundaries as plain `Map`. The Android `PdfPort` is the only
impure step of the whole pipeline (§9.8).

---

## 3. How "any type of template" is handled

### 3.1 The template model (`TemplateModel.kt`)

A template is **data, not code**. It is a `@Serializable` JSON document with:

- `schemaVersion` — the compatibility gate. The engine refuses any template whose
  version exceeds `ENGINE_SCHEMA_VERSION` (currently 1) with a clear
  "please update the app" message.
- `paper` — size (`A4`), margin in mm, orientation.
- `theme` — primary colour, text-on-primary, font family, logo asset ref.
- `business` — the letterhead block (shop name, contacts, tax ID, extra lines).
- `sections` — the body, made of exactly eight known types:
  `header, title, customer, meta, items, totals, footer, notes`.
- `locale` — currency symbol, date format, Indian digit grouping.

Key design decision: **a field is a key, never a business concept.** The renderer reads
values strictly by key from the snapshot's value map. There is not a single business
field name (like `customerName`) in the renderer — a source-level guard test enforces
this. Adding a new document *type* therefore requires no renderer change, only a new
template JSON.

### 3.2 Acquisition and refusal (`TemplateParser.kt`)

```kotlin
sealed interface ParseResult {
    data class Ok(val template: TemplateModel) : ParseResult
    data class Refused(val reason: String) : ParseResult
}
```

Validation rules, each with a human-readable refusal reason:

| Rule | Why |
|---|---|
| `schemaVersion <= ENGINE_SCHEMA_VERSION` | Old apps must not crash on new templates |
| `business.shopName` not blank | No letterhead, no bill |
| Every section type ∈ `KNOWN_SECTION_TYPES` | The `when` in the renderer is exhaustive by design — a new type is a *code change on purpose* |
| Every field expression ∈ `EXPRESSION_WHITELIST` | Prevents crashes and arbitrary-expression injection |
| All field/column keys unique document-wide | Strict-by-key lookup would be ambiguous otherwise |

The design intent (quoted from the source): *"A shop that cannot bill because someone
published a malformed template is a far worse outcome than a shop running last week's
template."* A refused template never replaces the previously active version.

### 3.3 Values, not formulas

The snapshot's `payload_json` is a flat object of **print-ready strings** (the §8
payload). Multi-row goods arrive as a JSON array under the `"items"` key; a single-row
document promotes scalar column keys into one row (`goodsRows` in `HtmlRenderer`).
Rows are padded to `max(actual, template.minRows)` so a short bill still prints its
ruled lines.

### 3.4 Expressions — a whitelisted calculator (`Expressions.kt`)

Totals carrying a whitelisted expression (`sum(items.freight)`, `sum(items.amount)`,
`sum(items.taxable)`, `sum(items.tax)`, `count(items)`) are **recomputed from the
snapshot's own values rather than trusted** — a stale or tampered total cannot reach
paper. Key properties:

- **Money is integer paise** — no floating point anywhere in money arithmetic.
  `"3,510.00"`, `"₹3944"`, `" 187.8 "` all parse to paise exactly; unparsable text is
  worth zero (never a crash).
- Sums format back through **Indian digit grouping**, matching what the printed sheet
  shows and matching `core:common`'s `Money` formatter.

---

## 4. Rendering — one HTML document, N copies

`HtmlRenderer.renderCopies(template, values, copyLabels)` produces **one paginated
HTML file** containing one `.sheet` per copy label (e.g. *"Copy 1 · Consignor"* …
*"Copy 4 · Office"*). Each sheet ends with a page break except the last
(`.sheet { page-break-after: always; }` / `.sheet:last-child { auto }`). Voided
bookings get a diagonal `VOID` watermark.

The structural choices that carry the design:

1. **The goods grid is a real `<table>`**, not absolutely-positioned boxes — the browser
   engine owns row heights and page breaking.
2. **`@page` CSS is the entire pagination implementation.** Declaring page size + margin
   means a 3-item bill and a 300-item bill both paginate correctly with zero code.
3. **Sheets are sized in millimetres** to match real paper (A4 minus margins).
4. **Theme values become CSS custom properties** (`--primary`, `--on-primary`) so a
   shop's brand colour flows into every bar, border and header from one place.
5. **Every user-supplied value is HTML-escaped** (`& < > " '`) — a customer named
   `Sharma & Sons <Traders>` cannot corrupt the document, and an injected `<script>` is
   inert. Correctness first, security second.
6. **Self-contained output**: no external stylesheets, no web fonts fetched at render
   time, no JavaScript, no remote images (logos are asset refs / base64 data URIs).

---

## 5. Printing — HTML to PDF, the only impure step

`pdf-android/AndroidPdfRenderer.kt` implements the platform boundary:

**Method.** Load the HTML into an off-screen `WebView`, then drive **Chromium's own
print document adapter headlessly** (layout, then write) into a cache file and read the
bytes back. This is the same engine behind the system "Save as PDF" dialog, so the
output matches it page for page, with real selectable, searchable text.

**Why not raster capture?** `PrototypeResearch.md` §B3 documents three failed attempts:
screen rendering applies device density, system font scale and viewport heuristics that
are opaque and version-dependent, and view drawing clips to view bounds. The print
pipeline re-lays-out the DOM onto virtual A4 paper, fully independent of the screen.
This is a **settled non-answer — do not resurrect it.**

**The eleven-item checklist.** Every item exists because omitting it caused a real,
diagnosed prototype failure. The highlights:

- WebView created *visible but alpha-0*, software layer, text zoom pinned to 100
  (invisible views skip Chromium's pipeline → empty document; unpinned zoom lets the
  user's font-size setting distort the invoice).
- Measured/laid out at A4 pixel dimensions at 96 dpi; attached to the activity content
  root (the print pipeline only sees content on a real window).
- Loaded with `loadDataWithBaseURL` + explicit UTF-8 (non-ASCII names corrupt otherwise).
- Run-once guard on `onPageFinished` (it fires first for the internal blank page —
  an unguarded drive renders an empty document; this was a real prototype bug).
- Print attributes **must include resolution + colour mode** — without a resolution
  Chromium throws inside the write step. The system dialog injects these silently;
  a headless drive must supply them. This was the prototype's final blocking bug.
- Layout/write result callbacks subclassed from a tiny bridge declared *inside the
  framework's print package* (the constructors are package-private).
- 15-second timeout cancels the signal and resumes empty; coroutine cancellation
  detaches and destroys the WebView (a leaked WebView on a destroyed activity is a
  crash source); UI mutation only on the main thread, file I/O on an I/O dispatcher.

**Failure contract the UI depends on:** an **empty byte array means failure** — never a
raw exception, never a spinner without a retry. The repository retries up to three times
with a short delay and then surfaces an explicit retry action.

**Printing an already-generated PDF is a different path** from printing HTML: raw bytes
go to a print adapter reporting an unknown page count. Both paths exist — HTML printing
for the system dialog from a live bill, byte printing for a reprint from history.
Preview rasterisation (bitmap thumbnails) is a third, separate, memory-bounded concern.

**Two-copy and four-copy documents are one file.** `renderBilty` builds one PDF with one
sheet per label; `render(template, values)` is the single-sheet reprint path.

---

## 6. The reprint path (§9.12)

Reprinting is deliberately *dumb*:

- It renders from the **stored snapshot** — it never re-runs data capture, never
  re-reserves a number, and never recalculates from current rules. The totals in the
  snapshot are the totals on paper.
- It resolves the template at the **pinned version** stored on the snapshot. Falling
  back to today's active row would produce a document that does not match the copy the
  customer already holds.
- If the pinned version is not on this device, rendering fails with
  `TEMPLATE_VERSION_MISSING` and the message explains that a document first printed
  elsewhere needs one online moment to fetch that version.
- Each rendered document carries an `htmlHash` (hex of the HTML hash) — a lightweight
  fingerprint of what was produced, usable for dedup/debugging.

Fixed-format operational documents (S22, D60) — challan, freight bill, receipt, statement
of account — take a separate code path (`OperationalDocuments`), which composes the same
HTML string conventions directly from typed data rather than from a template JSON, then
shares the same PDF/distribution adapters.

---

## 7. Assessment — is it a good implementation?

**Verdict: yes — this is a well-engineered, unusually disciplined implementation.**
Strengths, in order of importance:

1. **The pipeline is mostly pure.** Five of six stages are deterministic JVM functions
   testable without an emulator. `HtmlRenderer` is asserted on its output *string* —
   fast, deterministic tests that cover the majority of render regressions (per §9.7).
2. **Version pinning is enforced end to end**, with a distinct, actionable error code
   when the pinned version is missing. This is the invariant most template systems get
   wrong.
3. **Refusal over repair.** Malformed templates are refused with human-readable reasons
   instead of being half-rendered; the previously active version keeps billing.
4. **Security posture is right-sized**: whitelist-based expressions (no evaluator
   injection surface, no reflection), blanket HTML escaping of every value, fully
   offline render, no JavaScript in the print document.
5. **Money as integer paise** with Indian grouping — the classic invoice bugs
   (float rounding, separator mismatches) are structurally impossible here.
6. **The eleven-item WebView checklist turns tribal knowledge into code-commented
   invariants**, each annotated with the real failure it prevents. This is exactly how
   fragile platform interop should be documented.
7. **Clean architecture boundaries**: pure modules never import Android, features never
   touch Room, the entire platform boundary is a handful of `expect`/`actual` functions
   (§9.8), and a guard test enforces the "no business names in the renderer" rule.

**Weaknesses / caveats:**

- `htmlHash` uses `String.hashCode()` (31-bit) — fine as a debug fingerprint, too weak
  if it is ever used for identity/integrity decisions. (See §8.1.)
- The `KNOWN_SECTION_TYPES` set and the renderer's `when` must stay in sync manually;
  the compiler can't prove they match across the two files. (See §8.3.)
- Rendering depends on WebView/Chromium version on the device — pixel output can drift
  across Android versions, and the checklist mitigates but cannot eliminate this.
- `renderChallan`'s challan lines pass `packages = 0` and `amount = fmt(0)` — placeholder
  values, presumably awaiting real leg data.

---

## 8. What could be better

Concrete, prioritised improvements:

### 8.1 Stronger document fingerprint
Replace `html.hashCode().toString(16)` with SHA-256 (e.g. `MessageDigest` in
`core:common`) if `htmlHash` is ever persisted, compared, or shown to users as
"this is the exact document printed". Cheap now, avoids a compatibility break later.

### 8.2 Golden-file render tests at scale
The `doc-engine` golden test (`bilty-04188.html`) is a good pattern. Extend it to a
matrix: multi-row items, landscape, voided watermark, minimum-row padding, and each
section type, so schema-reference §9.15 is fully covered by golden files. Add a
golden-*diff* assertion (not just equality) so a Chromium upgrade's layout drift is
visible in review.

### 8.3 Compile-time coupling of section types
Move `KNOWN_SECTION_TYPES` into a single source (e.g. an enum or a sealed set consumed
by both the validator and the renderer's `when`). With an exhaustive `when` over an
enum, adding a section type becomes a compile error in the renderer rather than a
runtime refusal — closing the one gap in the "new type is a code change by design" story.

### 8.4 Unify money formatting
`Expressions.fromPaise` reimplements Indian grouping "matching core:common's format".
Extract the formatter into `core:common` (it appears to already exist as `Money`) and
have `doc-engine` depend on it, eliminating the duplicate that can silently diverge.

### 8.5 Optional server-side rendering — as a second port implementation
Per §9.8: a headless Chromium renderer on the backend, driven by the same HTML builder
compiled into the Ktor service, becomes attractive for emailed invoices,
guaranteed-identical output across devices, or bulk export. Add it as a *second*
implementation of the same `PdfPort`, keep the device path as the offline default, and
compare their outputs in a test. Never make it primary — a shop must bill with no
connection.

### 8.6 Template authoring safety net
Templates are hand-authored JSON validated only at acquisition. A lint/validator CLI
(usable in CI on the spec repository) running the same `TemplateParser` rules would catch
malformed templates before publication, not at print time on a shop device.

### 8.7 Accessibility & i18n
The locale hints cover currency/date/grouping, but printed strings are otherwise
hard-coded English (e.g. "Copy 1 · Consignor", "Tel:", "Tax ID:"). If multi-language
shops matter, these labels should move into the template/locale hints.

---

## 9. File map

| File | Role |
|---|---|
| `doc-engine/.../TemplateModel.kt` | Template-as-data model + known section types |
| `doc-engine/.../TemplateParser.kt` | Acquisition, parsing, validation, refusal |
| `doc-engine/.../Expressions.kt` | Whitelisted expression evaluator, paise math |
| `doc-engine/.../HtmlRenderer.kt` | Pure template + values → self-contained HTML |
| `pdf-android/.../AndroidPdfRenderer.kt` | HTML → A4 vector PDF (WebView + Chromium print adapter), print/share/save, preview rasterisation |
| `data/transport/.../DocumentRepository.kt` | Orchestration: snapshot load, pinned template resolution, retries, distribution |
| `data/transport/.../TemplateRepository.kt` | Versioned template storage/activation |
| `doc-engine/src/test/resources/golden/bilty-04188.html` | Golden render output |

## 10. Reference

- `TransportApp/Implementation.md` §9.2 (acquisition/validation), §9.6 (calculation),
  §9.7 (HTML rendering), §9.8 (HTML→PDF, eleven-item checklist), §9.12 (reprint),
  §9.15 (template schema reference)
- `TransportApp2/Spec.md` §2 (module rules), §11 (commands), §14 (forbidden patterns)
- `AgentChanges.md` D47 (plain-Map snapshot values across modules), D60 (fixed-format
   operational documents)

## 11. Schema v2 — the layout pipeline (TemplateV2.md)

Everything above describes the v1 section-based engine, which continues to render existing
snapshots byte-identically. A v2 engine now exists **alongside** it in
`doc-engine/src/main/java/com/example/transportapp/doc/engine/layout/`:

- **The template is a recursive tree of layout primitives** (`row`, `stack`, `panel`,
  `keyvalue`, `checkboxGroup`, `table`, `text`, `image`, `stamp`) instead of a flat list of
  eight business section types. Named blocks are cross-referenced by
  `{"$ref":"#/blocks/<name>"}`; images resolve through `theme.logoRef`. No business-domain
  field name exists in `LayoutRenderer.kt` — the same guard test that covers v1 covers v2.
- **The dispatcher** is `DocumentEngine.parse/render`: it reads `schemaVersion` and routes
  v1 to `TemplateParser`+`HtmlRenderer` (unchanged) and v2 to `LayoutParser`+`LayoutRenderer`.
  `ENGINE_SCHEMA_VERSION = 1` stays as-is so the Android path and the existing golden stay
  pinned; the app migrates to `DocumentEngine` when it starts printing v2 documents.
- **Validation** is structural at parse time (unknown block, unresolved ref, cyclic ref,
  duplicate table column, non-whitelisted expression, missing letterhead) with human-readable
  refusals; a data-dependent key is reported at render/lint time. v2's *non-rule* — the same
  field key may appear in as many blocks as the layout wants — is enforced by a positive
  parser test to make the deliberate divergence from v1 visible.
- **Expressions** are the closed whitelist `sum(<rowsField>.<column>)` / `count(<rowsField>)`
  validated against the template's own tables; totals recompute from the payload rows in
  integer paise with Indian grouping via the v1 `Expressions` helper.
- **Rendering** pins two layout rules: §9.1 (mixed `widthMm`/`flex` children in a row become
  `flex: 0 0 Nmm` and `flex: N 1 0`) and §9.2 (table columns render as *normalised
  fractions* so a 162 mm items grid still fits its 152 mm main column). §9.3 defines the
  `stampOverlay` as an un-clipped rotated div anchored to the horizontal centre of its target
  column, matching the diagonal bank-endorsement stamp on real lorry receipts.
- **A second PDF port** lives in `TransportApp2/tools/doc-pdf/` (Node 20+, Puppeteer ^24,
  headless Chromium) and is driven by the new `:doc-cli` harness
  (`doc-render <t.json> <d.json> [--html o.html] [--pdf o.pdf] [--lint]`). Per §8.5's own
  advice, this port is **never primary** — the Android `PdfPort`/`AndroidPdfRenderer` stay
  the offline default — and a parity test
  (`tools/doc-pdf/test/parity.test.mjs`, wired to the nightly
  `.github/workflows/doc-pdf-nightly.yml` job) compares deterministic output parts (text
  tokens, page count, A4 geometry) rather than bytes.
- **Three real templates ship verbatim** under `new_template_pipeline/`: the boxed-sidebar
  Lucky Cargo Consignee Copy, the insurance-checkbox Mahendra Consignor Copy, and the
  simple-table Baba Consignee Copy. Their goldens sit at
  `doc-engine/src/test/resources/golden/layout/`.

The full design, validation matrix, and CLI contract are in
`new_template_pipeline/TemplateV2.md`; the cross-cutting decision entries are D65 (additive
v2 dispatcher, v1 untouched) and D66 (Node/Puppeteer is non-primary) in `AgentChanges.md`.

---

# Appendix — Full source code of every file in the pipeline

Each file is reproduced verbatim below, headed by its name. Paths are relative to
the repo root `TransportApp2/`.

## doc-engine/src/main/java/.../doc/engine/TemplateModel.kt

```kotlin
package com.example.transportapp.doc.engine

/**
 * A document template as data (Implementation.md §9.15). Everything optional has a default
 * so a minimal template is short. `schemaVersion` is the engine compatibility gate: the
 * engine refuses a template whose schema version exceeds [ENGINE_SCHEMA_VERSION].
 */
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val ENGINE_SCHEMA_VERSION = 1

@Serializable
data class TemplateModel(
    val schemaVersion: Int,
    val id: String,
    val name: String = "",
    val version: Int = 1,
    val paper: Paper = Paper(),
    val theme: Theme = Theme(),
    val business: BusinessBlock,
    val sections: List<Section> = emptyList(),
    val locale: LocaleHints = LocaleHints(),
)

@Serializable
data class Paper(
    val size: String = "A4",
    val marginMm: Int = 10,
    val orientation: String = "portrait",
)

@Serializable
data class Theme(
    val primaryColor: String = "#0E4D38",
    val textOnPrimary: String = "#FFFFFF",
    val fontFamily: String = "sans",
    val logoAssetRef: String? = null,
)

@Serializable
data class BusinessBlock(
    val shopName: String,
    val tagline: String? = null,
    val tel: String? = null,
    val mobile: String? = null,
    val email: String? = null,
    val address: String? = null,
    val taxId: String? = null,
    val extraLines: List<String> = emptyList(),
)

@Serializable
data class LocaleHints(
    val currencySymbol: String = "₹",
    val dateFormat: String = "dd.MM.yyyy",
    val grouping: String = "indian",
)

/**
 * The eight known section types (§9.15). Unknown types fail validation — the compiler of
 * the renderer enumerates every branch, so a new type is a code change by design.
 */
@Serializable
data class Section(
    val type: String,
    val visibleWhen: VisibleWhen? = null,
    val title: String? = null,
    val fields: List<Field> = emptyList(),
    val minRows: Int = 0,
    val columns: List<ItemColumn> = emptyList(),
    val text: String? = null,
)

@Serializable
data class VisibleWhen(val field: String, val equals: String)

/**
 * A field is a *key*, never a business concept: the renderer reads values strictly by key
 * from the snapshot's value map, and a value's meaning lives in the data, not the code.
 */
@Serializable
data class Field(
    val key: String,
    val label: String,
    val required: Boolean = false,
    val kind: String = "text",
    val expression: String? = null,
)

@Serializable
data class ItemColumn(val key: String, val label: String, val widthMm: Int = 20)

/** The section types the engine understands (§9.15). */
val KNOWN_SECTION_TYPES = setOf("header", "title", "customer", "meta", "items", "totals", "footer", "notes")
```

## doc-engine/src/main/java/.../doc/engine/TemplateParser.kt

```kotlin
package com.example.transportapp.doc.engine

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * Template acquisition, parsing and validation (Implementation.md §9.2). A template that
 * fails validation is refused — the caller keeps the previously active version and records
 * the failure. A shop that cannot bill because someone published a malformed template is a
 * far worse outcome than a shop running last week's template.
 */
object TemplateParser {

    /** Expressions the whitelisted calculator understands (§9.6). Expressions are data. */
    val EXPRESSION_WHITELIST = setOf(
        "sum(items.freight)",
        "sum(items.amount)",
        "sum(items.taxable)",
        "sum(items.tax)",
        "count(items)",
    )

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }

    sealed interface ParseResult {
        data class Ok(val template: TemplateModel) : ParseResult
        data class Refused(val reason: String) : ParseResult
    }

    fun parse(contentJson: String): ParseResult = try {
        val template = json.decodeFromString<TemplateModel>(contentJson)
        validate(template)
    } catch (e: SerializationException) {
        ParseResult.Refused("malformed template JSON: ${e.message}")
    } catch (e: IllegalArgumentException) {
        ParseResult.Refused("malformed template JSON: ${e.message}")
    }

    private fun validate(template: TemplateModel): ParseResult {
        if (template.schemaVersion > ENGINE_SCHEMA_VERSION) {
            return ParseResult.Refused("template schemaVersion ${template.schemaVersion} exceeds the engine's $ENGINE_SCHEMA_VERSION — please update the app")
        }
        if (template.business.shopName.isBlank()) {
            return ParseResult.Refused("the business block needs a shop name")
        }
        template.sections.forEach { section ->
            if (section.type !in KNOWN_SECTION_TYPES) {
                return ParseResult.Refused("unknown section type '${section.type}'")
            }
            section.fields.forEach { field ->
                val expression = field.expression ?: return@forEach
                if (expression !in EXPRESSION_WHITELIST) {
                    return ParseResult.Refused("field '${field.key}' carries non-whitelisted expression '$expression'")
                }
            }
        }
        // Every field key must be unique document-wide (§9.15).
        val keys = template.sections.flatMap { it.fields }.map { it.key } +
            template.sections.filter { it.type == "items" }.flatMap { it.columns }.map { it.key }
        val duplicate = keys.groupBy { it }.filter { it.value.size > 1 }.keys.firstOrNull()
        if (duplicate != null) {
            return ParseResult.Refused("field key '$duplicate' is defined more than once")
        }
        return ParseResult.Ok(template)
    }
}
```

## doc-engine/src/main/java/.../doc/engine/Expressions.kt

```kotlin
package com.example.transportapp.doc.engine

/**
 * The whitelisted expression evaluator (Implementation.md §9.6). Expressions are data: the
 * parser validated every expression against [TemplateParser.EXPRESSION_WHITELIST] at
 * acquisition, so evaluation here is total — no injection surface, no reflection.
 *
 * Money arithmetic is integer paise. A value string like "3,510.00" or "3944" parses to
 * paise exactly; grouping separators and a currency sign are stripped before the parse.
 * Sums format back through Indian digit grouping, matching what the printed sheet shows.
 */
object Expressions {

    /** Rows available to expressions: each element maps column key to its printed value. */
    fun evaluate(expression: String, rows: List<Map<String, String>>): String? = when (expression) {
        "count(items)" -> rows.size.toString()
        else -> {
            val target = expression.removePrefix("sum(items.").removeSuffix(")")
            if (target == expression || target.isEmpty()) {
                null
            } else {
                val total = rows.sumOf { row -> row[target]?.let { toPaise(it) } ?: 0L }
                fromPaise(total)
            }
        }
    }

    /** "3,510.00" / "₹3944" / " 187.8 " → paise. Unparsable text is worth zero. */
    fun toPaise(text: String): Long {
        val clean = text.filter { it.isDigit() || it == '.' || it == '-' }
        if (clean.isEmpty() || clean == "-" || clean == ".") return 0L
        val negative = clean.startsWith("-")
        val unsigned = if (negative) clean.drop(1) else clean
        val whole = unsigned.substringBefore('.').ifEmpty { "0" }
        val frac = unsigned.substringAfter('.', "").padEnd(2, '0').take(2)
        val paise = whole.toLongOrNull()?.times(100) ?: return 0L
        val fracPaise = frac.toLongOrNull() ?: 0L
        return if (negative) -(paise + fracPaise) else paise + fracPaise
    }

    /** Paise → "3,510.00" with Indian digit grouping (matches core:common's format). */
    fun fromPaise(paise: Long): String {
        val sign = if (paise < 0) "-" else ""
        val abs = kotlin.math.abs(paise)
        val whole = abs / 100
        val frac = (abs % 100).toString().padStart(2, '0')
        return sign + groupIndian(whole) + "." + frac
    }

    private fun groupIndian(whole: Long): String {
        val digits = whole.toString()
        if (digits.length <= 3) return digits
        val last3 = digits.takeLast(3)
        val rest = digits.dropLast(3)
        val groups = rest.reversed().chunked(2).map { it.reversed() }.reversed()
        return (groups + last3).joinToString(",")
    }
}
```

## doc-engine/src/main/java/.../doc/engine/HtmlRenderer.kt

```kotlin
package com.example.transportapp.doc.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Stage 6 — the HTML renderer (Implementation.md §9.7). A pure function from template plus
 * snapshot values to one complete, self-contained HTML document: no Android, no files, no
 * PDFs, no network, no JavaScript, no external stylesheets or fonts.
 *
 * The rules that carry the design: every user-supplied value is escaped; the sheet is sized
 * in millimetres; the goods grid is a real `<table>` so the engine owns row heights and page
 * breaking (`@page` CSS is the entire pagination implementation); theme values become CSS
 * custom properties; values are read strictly by key — there is not a single business field
 * name in this file, which a source-level guard test enforces; and totals carrying a
 * whitelisted expression are recomputed from the snapshot's own values rather than trusted.
 */
object HtmlRenderer {

    private val json = Json { ignoreUnknownKeys = true }

    /** Render one sheet with no copy label — the reprint path (§9.12). */
    fun render(template: TemplateModel, values: Map<String, String>): String =
        renderCopies(template, values, emptyList())

    /**
     * Render one HTML document containing one sheet per copy label. An empty label list
     * yields a single unlabelled sheet. This is what makes a four-copy document one
     * paginated file: each sheet ends with a page break except the last.
     */
    fun renderCopies(template: TemplateModel, values: Map<String, String>, copyLabels: List<String>): String {
        val labels = if (copyLabels.isEmpty()) listOf("") else copyLabels
        val sheets = labels.joinToString("\n") { label -> sheet(template, values, label) }
        return buildString {
            append("<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">")
            append("<title>")
            append(escape(sheetTitle(template)))
            append("</title><style>")
            append(style(template))
            append("</style></head><body>\n")
            append(sheets)
            append("\n</body></html>")
        }
    }

    private fun sheetTitle(template: TemplateModel): String =
        template.sections.firstOrNull { it.type == "title" }?.title
            ?: template.name.ifBlank { template.business.shopName }

    private fun sheet(template: TemplateModel, values: Map<String, String>, copyLabel: String): String {
        val itemRows = goodsRows(template, values)
        return buildString {
            append("<div class=\"sheet\">\n")
            if (values["voided"] == "true") append("<div class=\"watermark\">VOID</div>\n")
            template.sections.forEach { section ->
                if (section.visibleWhen != null && values[section.visibleWhen.field] != section.visibleWhen.equals) {
                    return@forEach
                }
                when (section.type) {
                    "header" -> append(header(template))
                    "title" -> {
                        append("<div class=\"titleblock\">")
                        if (copyLabel.isNotEmpty()) append("<div class=\"copyline\">")
                        if (copyLabel.isNotEmpty()) append(escape(copyLabel))
                        if (copyLabel.isNotEmpty()) append("</div>")
                        append("<div class=\"title\">")
                        append(escape(section.title ?: ""))
                        append("</div></div>\n")
                    }
                    "meta" -> append(labelValueGrid(section, values, "meta"))
                    "customer" -> append(labelValueGrid(section, values, "customer"))
                    "items" -> append(goodsTable(section, itemRows))
                    "totals" -> append(totals(section, values, itemRows))
                    "footer" -> append(labelValueGrid(section, values, "footer"))
                    "notes" -> {
                        append("<div class=\"notes\">")
                        append(escape(section.text ?: ""))
                        append("</div>\n")
                    }
                }
            }
            append("</div>\n")
        }
    }

    private fun header(template: TemplateModel): String {
        val b = template.business
        return buildString {
            append("<div class=\"header\">")
            append("<div class=\"shopname\">")
            append(escape(b.shopName))
            append("</div><div class=\"shopcontact\">")
            listOfNotNull(b.tagline, b.tel?.let { "Tel: $it" }, b.mobile, b.email, b.address, b.taxId?.let { "Tax ID: $it" })
                .forEach { append("<div>").append(escape(it)).append("</div>") }
            b.extraLines.forEach { append("<div>").append(escape(it)).append("</div>") }
            append("</div></div>\n")
        }
    }

    private fun labelValueGrid(section: Section, values: Map<String, String>, css: String): String = buildString {
        append("<div class=\"$css\"><table class=\"pairs\">")
        section.fields.forEach { field ->
            append("<tr><td class=\"label\">")
            append(escape(field.label))
            append("</td><td class=\"value\">")
            append(escape(values[field.key] ?: ""))
            append("</td></tr>")
        }
        append("</table></div>\n")
    }

    /**
     * Goods rows: a values map may carry the rows as a JSON array under the "items" key
     * (a multi-row document), otherwise any present column key promotes the scalar values
     * into a single row — the common one-row case. Padded to the template's minimum so a
     * short document still prints its ruled lines.
     */
    private fun goodsRows(template: TemplateModel, values: Map<String, String>): List<Map<String, String>> {
        val section = template.sections.first { it.type == "items" }
        val raw = values["items"]
        val parsed: List<Map<String, String>> = if (raw != null) {
            when (val element = runCatching { json.parseToJsonElement(raw) }.getOrNull()) {
                is JsonArray -> element.mapNotNull { (it as? JsonObject)?.toStringMap() }
                is JsonObject -> listOfNotNull(element.toStringMap())
                else -> emptyList()
            }
        } else {
            val present = section.columns.any { values.containsKey(it.key) }
            if (present) listOf(values) else emptyList()
        }
        val target = maxOf(section.minRows, parsed.size)
        return List(target) { i -> parsed.getOrNull(i) ?: emptyMap() }
    }

    private fun JsonObject.toStringMap(): Map<String, String> = entries.associate { (k, v) ->
        val content = (v as? JsonPrimitive)?.content
        k to (content ?: "")
    }

    private fun goodsTable(section: Section, rows: List<Map<String, String>>): String = buildString {
        append("<table class=\"goods\"><thead><tr>")
        section.columns.forEach { column ->
            append("<th style=\"width:")
            append(column.widthMm)
            append("mm\">")
            append(escape(column.label))
            append("</th>")
        }
        append("</tr></thead><tbody>")
        rows.forEach { row ->
            append("<tr>")
            section.columns.forEach { column ->
                val cell = row[column.key] ?: ""
                append("<td")
                if (cell.isNotEmpty() && cell.first().isDigit()) append(" class=\"num\"")
                append(">")
                append(escape(cell))
                append("</td>")
            }
            append("</tr>")
        }
        append("</tbody></table>\n")
    }

    private fun totals(section: Section, values: Map<String, String>, itemRows: List<Map<String, String>>): String = buildString {
        append("<table class=\"totals\">")
        section.fields.forEach { field ->
            val value = when {
                field.expression != null -> Expressions.evaluate(field.expression, itemRows) ?: (values[field.key] ?: "")
                else -> values[field.key] ?: ""
            }
            append("<tr><td class=\"label\">")
            append(escape(field.label))
            append("</td><td class=\"num\">")
            append(escape(value))
            append("</td></tr>")
        }
        append("</table>\n")
    }

    private fun escape(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;")

    private fun style(template: TemplateModel): String {
        val margin = template.paper.marginMm.coerceIn(5, 25)
        val landscape = template.paper.orientation == "landscape"
        val pageShort = 210 - 2 * margin
        val pageLong = 297 - 2 * margin
        val contentWidth = if (landscape) "$pageLong" else "$pageShort"
        return buildString {
            append("@page { size: ")
            append(if (landscape) "A4 landscape" else "A4 portrait")
            append("; margin: ").append(margin).append("mm; }\n")
            append(":root { --primary: ").append(template.theme.primaryColor)
            append("; --on-primary: ").append(template.theme.textOnPrimary).append("; }\n")
            append("body { margin: 0; font-family: ")
            append(if (template.theme.fontFamily == "serif") "Georgia, serif" else "Helvetica, Arial, sans-serif")
            append("; color: #111; }\n")
            append(".sheet { width: ").append(contentWidth).append("mm; position: relative; page-break-after: always; }\n")
            append(".sheet:last-child { page-break-after: auto; }\n")
            append(".watermark { position: absolute; top: 40%; left: 10%; font-size: 60pt; color: rgba(160,0,0,0.15); transform: rotate(-18deg); font-weight: bold; }\n")
            append(".header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.2mm solid var(--primary); padding-bottom: 2mm; }\n")
            append(".shopname { font-size: 16pt; font-weight: bold; color: var(--primary); }\n")
            append(".shopcontact { text-align: right; font-size: 8pt; color: #333; }\n")
            append(".copyline { text-align: right; font-size: 8pt; color: #555; }\n")
            append(".title { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 2px; margin: 3mm 0; }\n")
            append("table { border-collapse: collapse; width: 100%; }\n")
            append("table.pairs td { padding: 1mm 2mm; font-size: 9pt; }\n")
            append("table.pairs td.label { color: #555; width: 30%; }\n")
            append(".customer, .meta, .footer { border: 0.3mm solid var(--primary); margin: 2mm 0; padding: 1mm; }\n")
            append(".customer td.value, .meta td.value { font-weight: bold; }\n")
            append("table.goods th { background: var(--primary); color: var(--on-primary); font-size: 8pt; padding: 1.5mm; border: 0.3mm solid var(--primary); }\n")
            append("table.goods td { border: 0.3mm solid var(--primary); padding: 1.5mm; font-size: 9pt; min-height: 6mm; }\n")
            append("table.goods td.num, table.totals td.num { text-align: right; font-variant-numeric: tabular-nums; }\n")
            append("table.totals { width: 60%; margin-left: auto; margin-top: 2mm; }\n")
            append("table.totals td { padding: 1mm 2mm; font-size: 9pt; border-bottom: 0.2mm solid #ccc; }\n")
            append("table.totals tr:last-child td { font-weight: bold; font-size: 11pt; border-top: 0.4mm solid var(--primary); border-bottom: none; }\n")
            append(".notes { font-size: 8pt; color: #444; margin-top: 3mm; white-space: pre-wrap; }\n")
        }
    }
}
```

## data/transport/src/main/java/.../documents/DocumentRepository.kt

```kotlin
package com.example.transportapp.data.transport.documents

import android.content.Context
import android.net.Uri
import com.example.transportapp.core.common.ErrorCode
import com.example.transportapp.core.common.Result
import com.example.transportapp.core.database.TransportDatabase
import com.example.transportapp.data.transport.session.SessionRepository
import com.example.transportapp.doc.engine.HtmlRenderer
import com.example.transportapp.doc.engine.TemplateParser
import com.example.transportapp.doc.engine.TemplateParser.ParseResult
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/** A rendered document ready for distribution. */
data class RenderedDocument(
    val pdfBytes: ByteArray,
    val fileName: String,
    val htmlHash: String,
) {
    override fun equals(other: Any?): Boolean = other is RenderedDocument &&
        pdfBytes.contentEquals(other.pdfBytes) && fileName == other.fileName
    override fun hashCode(): Int = 31 * pdfBytes.contentHashCode() + fileName.hashCode()
}

/**
 * Documents (Phase 3 S13, §17.2): render a bilty's stored snapshot through its **pinned
 * template version** — never today's (§9.12) — into vector PDF bytes, then distribute.
 * Reprinting never re-runs data capture, never re-reserves a number, and never recalculates
 * from current rules: the totals in the snapshot are the totals on paper.
 */
interface DocumentRepository {

    /**
     * Render the bilty as one paginated PDF containing one sheet per copy. Fails with
     * `TEMPLATE_VERSION_MISSING` when the pinned version is not on this device (§17.2: a
     * document first printed elsewhere needs one online moment), and surfaces the
     * three-retry PDF failure as `EXPORT_TOO_LARGE`'s retryable cousin.
     */
    suspend fun renderBilty(biltyNo: String, copies: List<String>): Result<RenderedDocument>

    /** The stored snapshot's payload as the renderer's flat value map. */
    suspend fun biltyValues(biltyNo: String): Result<Map<String, String>>?

    suspend fun copyLabels(biltyNo: String): List<String>

    /** Share an already-rendered document (the file name is what the recipient sees). */
    fun share(document: RenderedDocument, chooserTitle: String)

    /** Print an already-rendered document through the byte adapter (§9.8). */
    fun print(document: RenderedDocument)

    /** Save to the public Downloads collection; returns the content URI or null. */
    fun saveToDownloads(document: RenderedDocument): Uri?

    fun renderFromFile(file: File): ByteArray = if (file.exists()) file.readBytes() else ByteArray(0)

    // ── S22 (D60): the fixed-format operational documents ──────────────────

    /** Render the loading challan for one trip (§11). */
    suspend fun renderChallan(challanNo: String): Result<RenderedDocument>

    /** Render an issued freight bill (§12). */
    suspend fun renderFreightBill(billId: String): Result<RenderedDocument>

    /** Render a money receipt (§12.2). */
    suspend fun renderReceipt(receiptId: String): Result<RenderedDocument>

    /** Render the party statement of account for a period (§12.3). */
    suspend fun renderStatement(partyId: String, from: Long, to: Long): Result<RenderedDocument>
}

@Singleton
class DocumentRepositoryImpl @Inject constructor(
    private val database: TransportDatabase,
    private val sessionRepository: SessionRepository,
    private val pdfPort: PdfPort,
    private val pdfActions: PdfActions,
) : DocumentRepository {

    override suspend fun renderBilty(biltyNo: String, copies: List<String>): Result<RenderedDocument> {
        val s = sessionRepository.session.first()
        val consignment = database.consignmentDao().getConsignmentByBiltyNo(s.companyId, biltyNo)
            ?: database.consignmentDao().getConsignmentByProvisionalNo(s.companyId, biltyNo)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No bilty $biltyNo on this device")
        val snapshot = database.consignmentDao().getLatestSnapshot(consignment.local_id)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No snapshot stored for $biltyNo")

        // §9.12: resolve the template at the PINNED version. The snapshot stores the version
        // string it was created against; falling back to today's active row would produce a
        // document that does not match the copy the customer holds.
        val pinnedVersion = snapshot.template_version.toIntOrNull()
            ?: return Result.failure(ErrorCode.TEMPLATE_VERSION_MISSING, "The snapshot carries no template version")
        val template = database.templateDao().getTemplateVersion(s.companyId, "tpl-bilty-default", pinnedVersion)
            ?: return Result.failure(
                ErrorCode.TEMPLATE_VERSION_MISSING,
                "Template version $pinnedVersion is not on this device. A document first printed elsewhere needs one online moment to fetch that version.",
            )

        val parsed = when (val result = TemplateParser.parse(template.content_json)) {
            is ParseResult.Ok -> result.template
            is ParseResult.Refused -> return Result.failure(ErrorCode.TEMPLATE_FIELD_UNKNOWN, result.reason)
        }

        val html = HtmlRenderer.renderCopies(parsed, payloadToValues(snapshot.payload_json), copies)
        val bytes = pdfPort.render(html, "bilty-$biltyNo")
        if (bytes.isEmpty()) {
            return Result.failure(ErrorCode.EXPORT_TOO_LARGE, "The document could not be rendered — try again")
        }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ENGLISH).format(java.util.Date(System.currentTimeMillis()))
        val fileName = "Bilty-${biltyNo.replace("/", "-")}-$stamp.pdf"
        return Result.success(RenderedDocument(bytes, fileName, html.hashCode().toString(16)))
    }

    override suspend fun biltyValues(biltyNo: String): Result<Map<String, String>>? {
        val s = sessionRepository.session.first()
        val consignment = database.consignmentDao().getConsignmentByBiltyNo(s.companyId, biltyNo)
            ?: database.consignmentDao().getConsignmentByProvisionalNo(s.companyId, biltyNo)
            ?: return null
        val snapshot = database.consignmentDao().getLatestSnapshot(consignment.local_id) ?: return null
        return Result.success(payloadToValues(snapshot.payload_json))
    }

    override suspend fun copyLabels(biltyNo: String): List<String> {
        val s = sessionRepository.session.first()
        val consignment = database.consignmentDao().getConsignmentByBiltyNo(s.companyId, biltyNo)
            ?: database.consignmentDao().getConsignmentByProvisionalNo(s.companyId, biltyNo)
            ?: return DEFAULT_COPIES
        val snapshot = database.consignmentDao().getLatestSnapshot(consignment.local_id)
            ?: return DEFAULT_COPIES
        val copies = snapshot.copy_count
        return DEFAULT_COPIES.take(copies).ifEmpty { DEFAULT_COPIES }
    }

    override fun share(document: RenderedDocument, chooserTitle: String) =
        pdfActions.share(document.pdfBytes, document.fileName, chooserTitle)

    override fun print(document: RenderedDocument) =
        pdfActions.print(document.pdfBytes, "bilty-${document.fileName.removeSuffix(".pdf")}")

    override fun saveToDownloads(document: RenderedDocument): Uri? =
        pdfActions.saveToDownloads(document.pdfBytes, document.fileName)

    // ── S22 (D60): the fixed-format operational documents ──────────────────

    private suspend fun render(html: String, baseName: String): Result<RenderedDocument> {
        val bytes = pdfPort.render(html, baseName)
        if (bytes.isEmpty()) {
            return Result.failure(ErrorCode.EXPORT_TOO_LARGE, "The document could not be rendered - try again")
        }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ENGLISH).format(java.util.Date(System.currentTimeMillis()))
        return Result.success(RenderedDocument(bytes, "$baseName-$stamp.pdf", html.hashCode().toString(16)))
    }

    private suspend fun companyHead(): Pair<String, String> {
        val s = sessionRepository.session.first()
        val company = database.orgDao().getCompany(s.companyId)
        return (company?.name ?: "TransportApp") to (company?.address ?: "")
    }

    override suspend fun renderChallan(challanNo: String): Result<RenderedDocument> {
        val s = sessionRepository.session.first()
        val trip = database.tripDao().getTripByChallanNo(s.companyId, challanNo)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No challan $challanNo on this device")
        val vehicle = database.tripDao().getVehicle(trip.vehicle_id)
        val driver = database.tripDao().getDriver(trip.driver_id)
        val legs = database.tripDao().getLegRows(trip.local_id)
        val (company, address) = companyHead()
        fun fmt(paise: Long) = com.example.transportapp.core.common.Money(paise).formatted()
        val html = OperationalDocuments.challan(
            challanNo = challanNo,
            companyName = company,
            companyAddress = address,
            vehicle = vehicle?.number ?: "",
            driver = driver?.name ?: "",
            driverLicence = driver?.licence ?: "",
            from = database.orgDao().getBranchesForCompany(s.companyId).firstOrNull { it.local_id == trip.origin_branch_id }?.name ?: "",
            to = database.mastersDao().getStation(trip.dest_station_id)?.name ?: "",
            via = trip.via_stations?.split(",")?.mapNotNull { database.mastersDao().getStation(it)?.name } ?: emptyList(),
            consignments = legs.map { leg ->
                OperationalDocuments.ChallanLine(
                    bilty = leg.display_no,
                    consignee = leg.consignee_name,
                    from = "",
                    to = leg.to_station,
                    packages = 0,
                    weightKg = leg.weight_kg,
                    amount = fmt(0),
                )
            },
            hire = fmt(trip.hire_paise),
            advance = fmt(trip.advance_paise),
            balance = fmt(trip.balance_paise),
            created = SimpleDateFormat("d MMM yyyy", Locale.ENGLISH).format(java.util.Date(trip.created_at)),
        )
        return render(html, "Challan-${challanNo.replace("/", "-")}")
    }

    override suspend fun renderFreightBill(billId: String): Result<RenderedDocument> {
        val s = sessionRepository.session.first()
        val dao = database.billingDao()
        val bill = dao.getBillWithParty(billId)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No bill on this device")
        val lines = dao.getBillConsignments(billId)
        val (company, address) = companyHead()
        fun fmt(paise: Long) = com.example.transportapp.core.common.Money(paise).formatted()
        val df = SimpleDateFormat("d MMM", Locale.ENGLISH)
        val html = OperationalDocuments.freightBill(
            billNo = bill.bill_no ?: "(provisional)",
            companyName = company,
            companyAddress = address,
            companyGstin = "",
            partyName = bill.party_name,
            partyGstin = bill.party_gstin ?: "",
            from = lines.firstOrNull()?.from_station ?: "",
            to = lines.firstOrNull()?.to_station ?: "",
            period = "${df.format(java.util.Date(bill.period_start))} - ${df.format(java.util.Date(bill.period_end))}",
            consignments = lines.map { row ->
                OperationalDocuments.BillLine(
                    bilty = row.display_no,
                    date = df.format(java.util.Date(row.booked_at)),
                    packages = 0,
                    weightKg = 0,
                    rate = "",
                    amount = fmt(row.total_paise),
                )
            },
            freight = fmt(bill.taxable_paise),
            charges = listOf("Other charges" to fmt(bill.other_charges_paise)),
            gst = fmt(bill.gst_paise),
            total = fmt(bill.total_paise),
            issued = SimpleDateFormat("d MMM yyyy", Locale.ENGLISH).format(java.util.Date(bill.period_end)),
        )
        return render(html, "Bill-${(bill.bill_no ?: billId).replace("/", "-")}")
    }

    override suspend fun renderReceipt(receiptId: String): Result<RenderedDocument> {
        val s = sessionRepository.session.first()
        val dao = database.billingDao()
        val receipt = dao.getReceipt(receiptId)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No receipt on this device")
        val party = dao.getPartyNameGstin(receipt.party_id)
        val (company, address) = companyHead()
        fun fmt(paise: Long) = com.example.transportapp.core.common.Money(paise).formatted()
        val html = OperationalDocuments.receipt(
            receiptNo = receipt.receipt_no ?: "(provisional)",
            companyName = company,
            companyAddress = address,
            partyName = party?.name ?: "",
            amount = fmt(receipt.amount_paise),
            inWords = com.example.transportapp.core.common.Money(receipt.amount_paise).inWords(),
            mode = receipt.instrument,
            towards = receipt.notes ?: "On account",
            collected = SimpleDateFormat("d MMM yyyy", Locale.ENGLISH).format(java.util.Date(receipt.received_at)),
            collectedBy = receipt.received_by_name,
        )
        return render(html, "Receipt-${(receipt.receipt_no ?: receiptId).replace("/", "-")}")
    }

    override suspend fun renderStatement(partyId: String, from: Long, to: Long): Result<RenderedDocument> {
        val s = sessionRepository.session.first()
        val dao = database.billingDao()
        val party = dao.getPartyNameGstin(partyId)
            ?: return Result.failure(ErrorCode.MASTER_IN_USE, "No such party")
        val bills = dao.getIssuedBillsForParty(s.companyId, partyId).filter { it.period_end in from..to }
        val receipts = dao.getReceiptsForParty(s.companyId, partyId).filter { it.received_at in from..to }
        val (company, address) = companyHead()
        fun fmt(paise: Long) = com.example.transportapp.core.common.Money(paise).formatted()
        val df = SimpleDateFormat("d MMM yyyy", Locale.ENGLISH)
        val rows = buildList {
            bills.forEach { b ->
                add(OperationalDocuments.StatementLine(
                    date = df.format(java.util.Date(b.period_end)),
                    particulars = "Freight bill",
                    doc = b.bill_no ?: "",
                    debit = fmt(b.total_paise),
                    credit = "",
                ))
            }
            receipts.forEach { r ->
                add(OperationalDocuments.StatementLine(
                    date = df.format(java.util.Date(r.received_at)),
                    particulars = "Receipt" + (r.notes?.let { " - $it" } ?: ""),
                    doc = r.receipt_no ?: "",
                    debit = "",
                    credit = fmt(r.amount_paise),
                ))
            }
        }
        val debit = bills.sumOf { it.total_paise }
        val credit = receipts.sumOf { it.amount_paise }
        val html = OperationalDocuments.statement(
            partyName = party.name,
            companyName = company,
            from = df.format(java.util.Date(from)),
            to = df.format(java.util.Date(to)),
            opening = fmt(0),
            rows = rows,
            closing = fmt(debit - credit),
        )
        return render(html, "Statement-${party.name.replace(" ", "-")}")
    }

    companion object {
        val DEFAULT_COPIES = listOf("Copy 1 · Consignor", "Copy 2 · Consignee", "Copy 3 · Driver", "Copy 4 · Office")

        /**
         * The §8 print payload decoded to the flat value map the renderer reads by key. The
         * payload is a flat JSON object of print-ready strings; multi-row goods (a future
         * multi-article bilty) arrive as a JSON array under "items".
         */
        fun payloadToValues(payloadJson: String): Map<String, String> {
            val obj = JSONObject(payloadJson)
            val map = mutableMapOf<String, String>()
            obj.keys().forEach { key ->
                when (val value = obj.opt(key)) {
                    // JSONObject.NULL is a sentinel instance, not Kotlin null: JSON-null
                    // snapshot fields (e.g. provisionalCrossRef) decode to absent keys.
                    JSONObject.NULL -> Unit
                    is JSONObject -> map[key] = value.toString()
                    is JSONArray -> map[key] = value.toString()
                    null -> Unit
                    else -> map[key] = value.toString()
                }
            }
            return map
        }
    }
}
```

## data/transport/src/main/java/.../documents/PdfPort.kt

```kotlin
package com.example.transportapp.data.transport.documents

import android.content.Context
import android.net.Uri
import android.util.Log
import com.example.transportapp.pdf.AndroidPdfRenderer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The PDF port (Implementation.md §9.8): HTML string plus job name in, byte array out.
 * An EMPTY byte array means failure — the implementation retries three times with a short
 * delay and only then reports, so a transient WebView hiccup never reaches the user.
 */
interface PdfPort {
    suspend fun render(html: String, jobName: String): ByteArray
}

@Singleton
class AndroidPdfPort @Inject constructor(
    @ApplicationContext private val appContext: Context,
) : PdfPort {

    override suspend fun render(html: String, jobName: String): ByteArray {
        repeat(3) { attempt ->
            val bytes = AndroidPdfRenderer.exportPdf(appContext, html, jobName)
            if (bytes.isNotEmpty()) return bytes
            Log.w("DocumentRepository", "PDF export attempt ${attempt + 1} produced no bytes")
            if (attempt < 2) delay(250L)
        }
        return ByteArray(0)
    }
}

/** Share and print actions over already-rendered bytes (§9.11's distribution stage). */
interface PdfActions {
    fun share(pdfBytes: ByteArray, fileName: String, chooserTitle: String)
    fun print(pdfBytes: ByteArray, jobName: String)
    fun saveToDownloads(pdfBytes: ByteArray, fileName: String): Uri?
}

@Singleton
class AndroidPdfActions @Inject constructor(
    @ApplicationContext private val appContext: Context,
) : PdfActions {

    override fun share(pdfBytes: ByteArray, fileName: String, chooserTitle: String) =
        AndroidPdfRenderer.sharePdf(appContext, pdfBytes, fileName, chooserTitle)

    override fun print(pdfBytes: ByteArray, jobName: String) =
        AndroidPdfRenderer.printBytes(appContext, pdfBytes, jobName)

    override fun saveToDownloads(pdfBytes: ByteArray, fileName: String): Uri? =
        AndroidPdfRenderer.saveToDownloads(appContext, pdfBytes, fileName)
}
```

## data/transport/src/main/java/.../templates/TemplateRepository.kt

```kotlin
package com.example.transportapp.data.transport.templates

import androidx.room.withTransaction
import com.example.transportapp.core.common.ErrorCode
import com.example.transportapp.core.common.Result
import com.example.transportapp.core.database.TransportDatabase
import com.example.transportapp.core.database.entity.TemplateEntity
import com.example.transportapp.core.database.envelope.SyncState
import com.example.transportapp.core.database.outbox.OutboxEntityType
import com.example.transportapp.core.database.outbox.OutboxOp
import com.example.transportapp.data.transport.outbox.OutboxWriter
import com.example.transportapp.data.transport.session.SessionRepository
import com.example.transportapp.doc.engine.TemplateModel
import com.example.transportapp.doc.engine.TemplateParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** One T29 list row. */
data class TemplateSummary(
    val localId: String,
    val templateKey: String,
    val name: String,
    val version: Int,
    val isActive: Boolean,
    val schemaVersion: Int,
    /** BUILT-IN / COMPANY. */
    val visibility: String,
    val sectionCount: Int,
)

/** An active template resolved for rendering: parsed model plus its pinned identity. */
data class ParsedTemplate(
    val localId: String,
    val templateKey: String,
    val version: Int,
    val schemaVersion: Int,
    val contentJson: String,
    val contentHash: String,
    val model: TemplateModel,
)

/**
 * Templates as data (Phase 3 S11, §16.2). Versions are rows; the exactly-one-active
 * invariant is this repository's transaction. Parsing and validation live in the pure
 * `:doc-engine` — a refused template never reaches the database.
 */
interface TemplateRepository {

    fun observeTemplates(): Flow<List<TemplateSummary>>

    suspend fun getActiveTemplate(templateKey: String): ParsedTemplate?

    /** The pinned-version lookup a reprint resolves against (§9.12). */
    suspend fun getTemplateVersion(templateKey: String, version: Int): ParsedTemplate?

    /**
     * Install a template version as data: parse+validate first (a refused template answers
     * a typed error and writes nothing), then flip active within one transaction.
     */
    suspend fun installTemplate(templateKey: String, contentJson: String, now: Long): Result<TemplateSummary>
}

@Singleton
class TemplateRepositoryImpl @Inject constructor(
    private val database: TransportDatabase,
    private val sessionRepository: SessionRepository,
    private val outboxWriter: OutboxWriter,
) : TemplateRepository {

    override fun observeTemplates(): Flow<List<TemplateSummary>> = flow {
        val s = sessionRepository.session.first()
        emitAll(
            database.templateDao().observeTemplates(s.companyId)
                .map { rows -> rows.map { it.toSummary() } },
        )
    }

    override suspend fun getActiveTemplate(templateKey: String): ParsedTemplate? {
        val s = sessionRepository.session.first()
        return database.templateDao().getActiveTemplate(s.companyId, templateKey)?.toParsed()
    }

    override suspend fun getTemplateVersion(templateKey: String, version: Int): ParsedTemplate? {
        val s = sessionRepository.session.first()
        return database.templateDao().getTemplateVersion(s.companyId, templateKey, version)?.toParsed()
    }

    override suspend fun installTemplate(templateKey: String, contentJson: String, now: Long): Result<TemplateSummary> {
        val s = sessionRepository.session.first()
        // Parse and validate BEFORE any write: a malformed template is refused with the
        // typed §18.3 code that matches the reason (§9.2's keep-the-old-version rule).
        val previous = database.templateDao().getActiveTemplate(s.companyId, templateKey)
        val nextVersion = (previous?.version ?: 0) + 1
        val parsed = when (val result = TemplateParser.parse(contentJson)) {
            is TemplateParser.ParseResult.Ok -> result.template
            is TemplateParser.ParseResult.Refused -> return Result.failure(
                if (result.reason.contains("schemaVersion")) ErrorCode.TEMPLATE_VERSION_MISSING else ErrorCode.TEMPLATE_FIELD_UNKNOWN,
                result.reason,
            )
        }

        return database.withTransaction {
            // Flip the old active row and insert the new version together (§6.6's atomic
            // replacement: no instant without an active template).
            previous?.let {
                database.templateDao().upsertTemplate(it.copy(is_active = false, updated_at_local = now))
            }
            val entity = TemplateEntity(
                local_id = "tpl-" + UUID.randomUUID().toString(),
                server_id = null, updated_at_local = now, updated_at_server = null,
                sync_state = SyncState.PENDING, deleted_at = null, company_id = s.companyId,
                template_key = templateKey, version = nextVersion, is_active = true,
                schema_version = parsed.schemaVersion, content_json = contentJson,
                content_hash = contentJson.hashCode().toString(16),
                visibility = "COMPANY", created_by_name = s.name,
            )
            database.templateDao().upsertTemplate(entity)
            outboxWriter.enqueue(
                op = OutboxOp.INSERT,
                entityType = OutboxEntityType.TEMPLATE,
                entityLocalId = entity.local_id,
                payloadJson = JSONObject()
                    .put("template_key", templateKey)
                    .put("version", nextVersion)
                    .put("schema_version", parsed.schemaVersion)
                    .put("content_hash", entity.content_hash)
                    .toString(),
                now = now,
            )
            Result.success(entity.toSummary())
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private fun TemplateEntity.toSummary(): TemplateSummary {
        val parsed = TemplateParser.parse(content_json)
        return TemplateSummary(
            localId = local_id, templateKey = template_key,
            name = (parsed as? TemplateParser.ParseResult.Ok)?.template?.name?.ifBlank { null } ?: template_key,
            version = version, isActive = is_active, schemaVersion = schema_version,
            visibility = visibility,
            sectionCount = (parsed as? TemplateParser.ParseResult.Ok)?.template?.sections?.size ?: 0,
        )
    }

    private fun TemplateEntity.toParsed(): ParsedTemplate? = when (val parsed = TemplateParser.parse(content_json)) {
        is TemplateParser.ParseResult.Ok -> ParsedTemplate(
            localId = local_id, templateKey = template_key, version = version,
            schemaVersion = schema_version, contentJson = content_json,
            contentHash = content_hash, model = parsed.template,
        )
        // A stored template that no longer parses is a corrupted row: surface nothing
        // rather than render garbage (the audit trail keeps the refusal).
        is TemplateParser.ParseResult.Refused -> null
    }
}
```

## pdf-android/src/main/java/.../pdf/AndroidPdfRenderer.kt

```kotlin
package com.example.transportapp.pdf

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PdfCallbackBridge
import android.print.PrintJob
import android.print.PrintManager
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume

/**
 * The pipeline's only impure step (Implementation.md §9.8): HTML in, A4 vector PDF bytes
 * out, driven through Chromium's own print adapter headlessly — the same engine behind the
 * system "Save as PDF" dialog, so output matches it page for page, with real selectable
 * text paginated by the @page CSS.
 *
 * The eleven checklist items exist because omitting each caused a real, diagnosed failure
 * in the prototype; they are commented at the exact line that carries them. Screen
 * rasterisation capture is a settled non-answer — do not resurrect it.
 *
 * The failure contract the UI depends on: an EMPTY byte array means failure. Never a raw
 * exception, never a spinner without a retry.
 */
object AndroidPdfRenderer {

    private const val TAG = "AndroidPdfRenderer"
    private const val BASE_URL = "file:///android_asset/"
    private const val A4_WIDTH_PX = 794   // 210mm at 96dpi
    private const val A4_HEIGHT_PX = 1123 // 297mm at 96dpi
    private const val EXPORT_TIMEOUT_MS = 15_000L

    /** HTML → PDF bytes. Empty array on any failure after the internal retries. */
    suspend fun exportPdf(context: Context, html: String, jobName: String): ByteArray =
        withContext(Dispatchers.Main) {
            try {
                exportOnMainThread(context, html, jobName)
            } catch (e: Exception) {
                Log.w(TAG, "export failed", e)
                ByteArray(0)
            }
        }

    private suspend fun exportOnMainThread(context: Context, html: String, jobName: String): ByteArray {
        val handler = Handler(Looper.getMainLooper())
        // (3) the print pipeline only sees content on a real window
        val parent = findActivity(context)?.findViewById<FrameLayout>(android.R.id.content)
        if (parent == null) {
            Log.w(TAG, "no activity window to attach the WebView; export aborting")
            return ByteArray(0)
        }

        val webView = createWebView(context)
        parent.addView(webView, webView.params)

        fun cleanup() {
            handler.post {
                try {
                    (webView.parent as? ViewGroup)?.removeView(webView)
                } catch (e: Exception) {
                    Log.w(TAG, "detach failed", e)
                }
                // (10) a leaked WebView attached to a destroyed activity is a crash source
                webView.destroy()
            }
        }

        fun closeAndDelete(descriptor: ParcelFileDescriptor?, file: File?) {
            try { descriptor?.close() } catch (_: Exception) {}
            try { file?.delete() } catch (_: Exception) {}
        }

        return suspendCancellableCoroutine { continuation ->
            var finished = false
            var timeout: Runnable? = null
            val signal = CancellationSignal()

            fun finish(bytes: ByteArray) {
                if (finished) return
                finished = true
                timeout?.let(handler::removeCallbacks)
                if (continuation.isActive) continuation.resume(bytes)
                cleanup()
            }

            // (10) a timed-out export always resumes with an empty byte array instead of hanging
            val timeoutRunnable = Runnable {
                signal.cancel()
                finish(ByteArray(0))
            }
            timeout = timeoutRunnable
            handler.postDelayed(timeoutRunnable, EXPORT_TIMEOUT_MS)

            continuation.invokeOnCancellation {
                finished = true
                timeout?.let(handler::removeCallbacks)
                signal.cancel()
                cleanup()
            }

            webView.webViewClient = object : WebViewClient() {
                // (5) onPageFinished fires for the internal about:blank page and can fire
                // twice for the real document; driving the print adapter on the blank pass
                // produces an empty PDF, so the pipeline runs exactly once, on a real URL only.
                private var handled = false

                override fun onPageFinished(view: WebView, url: String?) {
                    Log.d(TAG, "onPageFinished url=$url handled=$handled")
                    if (handled) return
                    if (url == null || url.startsWith("about:")) return
                    handled = true
                    var out: File? = null
                    var pfd: ParcelFileDescriptor? = null
                    try {
                        // (6) the adapter writes into a cache file through a read-write descriptor
                        val adapter = view.createPrintDocumentAdapter(jobName)
                        val outFile = File(context.cacheDir, "export_${System.nanoTime()}.pdf")
                        out = outFile
                        pfd = ParcelFileDescriptor.open(
                            outFile,
                            ParcelFileDescriptor.MODE_READ_WRITE or
                                ParcelFileDescriptor.MODE_CREATE or
                                ParcelFileDescriptor.MODE_TRUNCATE
                        )

                        adapter.onLayout(
                            null,
                            a4PrintAttributes(),
                            signal,
                            PdfCallbackBridge.layoutCallback(
                                { info, _ ->
                                    Log.d(TAG, "layout finished pageCount=${info?.pageCount}")
                                    // (9) drive layout, then write all pages, then read the bytes
                                    adapter.onWrite(
                                        arrayOf(PageRange.ALL_PAGES),
                                        pfd,
                                        signal,
                                        PdfCallbackBridge.writeCallback(
                                            { _ ->
                                                // (11) file I/O off the main thread
                                                kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch {
                                                    val bytes = try {
                                                        outFile.readBytes()
                                                    } catch (e: Exception) {
                                                        Log.w(TAG, "read failed", e)
                                                        ByteArray(0)
                                                    }
                                                    Log.d(TAG, "write finished bytes=${bytes.size}")
                                                    closeAndDelete(pfd, outFile)
                                                    finish(bytes)
                                                }
                                            },
                                            { error ->
                                                Log.w(TAG, "write failed: $error")
                                                closeAndDelete(pfd, outFile)
                                                finish(ByteArray(0))
                                            }
                                        )
                                    )
                                },
                                { error ->
                                    Log.w(TAG, "layout failed: $error")
                                    closeAndDelete(pfd, outFile)
                                    finish(ByteArray(0))
                                }
                            ),
                            null
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "export setup failed", e)
                        closeAndDelete(pfd, out)
                        finish(ByteArray(0))
                    }
                }
            }

            try {
                // (4) explicit UTF-8: non-ASCII party names corrupt without it
                webView.loadDataWithBaseURL(BASE_URL, html, "text/html", "UTF-8", null)
            } catch (e: Exception) {
                Log.w(TAG, "load failed", e)
                finish(ByteArray(0))
            }
        }
    }

    /** The system print dialog for freshly generated HTML (a live document). */
    suspend fun printHtml(context: Context, html: String, jobName: String) {
        withContext(Dispatchers.Main) {
            try {
                val activity = findActivity(context) ?: run {
                    Log.w(TAG, "no activity to print from")
                    return@withContext
                }
                val parent = activity.findViewById<FrameLayout>(android.R.id.content)
                val webView = createWebView(context)
                parent.addView(webView, webView.params)

                suspendCancellableCoroutine<Unit> { continuation ->
                    var finished = false
                    fun done() {
                        if (finished) return
                        finished = true
                        if (continuation.isActive) continuation.resume(Unit)
                    }

                    continuation.invokeOnCancellation {
                        finished = true
                        Handler(Looper.getMainLooper()).post {
                            (webView.parent as? ViewGroup)?.removeView(webView)
                            webView.destroy()
                        }
                    }

                    webView.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, url: String?) {
                            try {
                                val adapter = webView.createPrintDocumentAdapter(jobName)
                                val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                                val printJob = manager.print(jobName, adapter, a4PrintAttributes())
                                scheduleDestroyWhenFinished(printJob, webView)
                            } catch (e: Exception) {
                                Log.w(TAG, "print setup failed", e)
                            }
                            done()
                        }
                    }

                    try {
                        webView.loadDataWithBaseURL(BASE_URL, html, "text/html", "UTF-8", null)
                    } catch (e: Exception) {
                        Log.w(TAG, "load failed", e)
                        done()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "print failed", e)
            }
        }
    }

    /**
     * Printing already-generated PDF bytes is a different path from printing HTML (§9.8):
     * an adapter that reports an unknown page count and writes the bytes through. This is
     * the reprint-from-snapshot route. PrintManager requires an Activity context.
     */
    fun printBytes(context: Context, pdfBytes: ByteArray, jobName: String) {
        val activity = findActivity(context)
            ?: throw IllegalStateException("Can print only from an activity — none is resumed")
        val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        printManager.print(
            jobName,
            BytesPrintAdapter(pdfBytes, jobName),
            PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build(),
        )
    }

    /** Save to the public Downloads collection (modern) or app-specific external (older). */
    fun saveToDownloads(context: Context, pdfBytes: ByteArray, fileName: String): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/pdf")
            }
            val uri = context.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            context.contentResolver.openOutputStream(uri)?.use { it.write(pdfBytes) }
            uri
        } else {
            val dir = File(context.getExternalFilesDir(null), "pdfs").apply { if (!exists()) mkdirs() }
            val file = File(dir, fileName)
            file.writeBytes(pdfBytes)
            Uri.fromFile(file)
        }

    /** Share through a FileProvider URI — the file name is what the recipient sees. */
    fun sharePdf(context: Context, pdfBytes: ByteArray, fileName: String, chooserTitle: String) {
        val dir = File(context.cacheDir, "pdfs").apply { if (!exists()) mkdirs() }
        val file = File(dir, fileName)
        file.writeBytes(pdfBytes)
        val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(Intent.createChooser(intent, chooserTitle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /**
     * Preview rasterisation is a third, separate concern (§9.8): rasterise the first page at
     * a bounded target width. Degrades to null on any failure; the bitmap memory is bounded
     * by the target width, which is where this code is most likely to hit OOM.
     */
    fun rasteriseFirstPage(context: Context, pdfBytes: ByteArray, targetWidthPx: Int): Bitmap? = try {
        val temp = File(context.cacheDir, "preview_${System.nanoTime()}.pdf")
        temp.writeBytes(pdfBytes)
        ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
            android.graphics.pdf.PdfRenderer(pfd).use { renderer ->
                renderer.openPage(0).use { page ->
                    val scale = targetWidthPx.toFloat() / page.width
                    val bitmap = Bitmap.createBitmap(
                        targetWidthPx,
                        (page.height * scale).toInt().coerceAtLeast(1),
                        Bitmap.Config.ARGB_8888,
                    )
                    bitmap.eraseColor(android.graphics.Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmap
                }
            }
        }.also { temp.delete() }
    } catch (e: Exception) {
        Log.w(TAG, "rasterise failed", e)
        null
    }

    // ---------- internals ----------

    /** Walks Context wrappers; falls back to the registered resumed activity (item 3). */
    private tailrec fun findActivity(context: Context): Activity? = when (context) {
        is Activity -> context
        is ContextWrapper -> findActivity(context.baseContext)
        else -> CurrentActivity.current
    }

    private fun createWebView(context: Context): WebView {
        val webView = WebView(context)
        // (1) visible + zero alpha: INVISIBLE/GONE skips Chromium's render pipeline entirely,
        // producing an empty document; alpha 0 keeps the view off the user's screen while it
        // stays fully functional. Software layer; no wide viewport; text zoom pinned to 100
        // so the user's font-size setting cannot distort the document.
        webView.visibility = View.VISIBLE
        webView.alpha = 0f
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        webView.settings.useWideViewPort = false
        webView.settings.textZoom = 100
        // (2) measure and lay out at A4 pixel dimensions at 96 dpi
        webView.measure(
            View.MeasureSpec.makeMeasureSpec(A4_WIDTH_PX, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(A4_HEIGHT_PX, View.MeasureSpec.EXACTLY)
        )
        webView.layout(0, 0, A4_WIDTH_PX, A4_HEIGHT_PX)
        return webView
    }

    private val WebView.params: FrameLayout.LayoutParams
        get() = FrameLayout.LayoutParams(A4_WIDTH_PX, A4_HEIGHT_PX, Gravity.TOP or Gravity.START)

    private fun a4PrintAttributes(): PrintAttributes =
        PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            // (7) Chromium's onWrite rejects attributes without a resolution ("attributes
            // must specify print resolution"); the system dialog injects one silently — a
            // headless drive must supply it. This was the prototype's final blocking bug.
            .setResolution(PrintAttributes.Resolution("document-pdf", "Document PDF", 300, 300))
            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .build()

    private fun scheduleDestroyWhenFinished(printJob: PrintJob, webView: WebView) {
        val handler = Handler(Looper.getMainLooper())
        fun poll() {
            if (printJob.isCompleted || printJob.isCancelled || printJob.isFailed) {
                webView.destroy()
            } else {
                handler.postDelayed({ poll() }, 500)
            }
        }
        handler.postDelayed({ poll() }, 1500)
    }

    /** The byte-through adapter for reprinting an already-generated PDF (§9.8). */
    private class BytesPrintAdapter(
        private val pdfBytes: ByteArray,
        private val jobName: String,
    ) : PrintDocumentAdapter() {

        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: CancellationSignal?,
            callback: LayoutResultCallback,
            extras: Bundle?
        ) {
            if (cancellationSignal?.isCanceled == true) {
                callback.onLayoutCancelled()
                return
            }
            val info = PrintDocumentInfo.Builder(jobName)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build()
            callback.onLayoutFinished(info, true)
        }

        override fun onWrite(
            pages: Array<out PageRange>,
            destination: ParcelFileDescriptor,
            cancellationSignal: CancellationSignal?,
            callback: WriteResultCallback
        ) {
            try {
                FileOutputStream(destination.fileDescriptor).use { it.write(pdfBytes) }
                callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            } catch (e: Exception) {
                callback.onWriteFailed(e.message)
            }
        }
    }
}
```

## data/transport/src/main/java/.../documents/OperationalDocuments.kt

```kotlin
package com.example.transportapp.data.transport.documents

/**
 * S22 (D60) — inline HTML for the fixed-format operational documents: loading challan,
 * freight bill, money receipt, and the party statement. Unlike the bilty (a
 * user-serviceable doc-engine template), these are company-form documents whose layout
 * never changes — so they render from Kotlin string templates straight to the same A4
 * WebView byte path the bilty uses. Money is pre-formatted paise; escaping is the
 * caller's (values are numeric or already-screened names).
 */
object OperationalDocuments {

    private const val HEAD =
        """
        <!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4; margin: 14mm; }
        body { font-family: 'IBM Plex Sans', sans-serif; color: #111; margin: 0; }
        .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
        .head h1 { font-family: 'Anek Latin', sans-serif; font-size: 22px; margin: 0; letter-spacing: 1px; }
        .head .doc { font-size: 12px; letter-spacing: 3px; margin-top: 2px; }
        .meta { width: 100%; font-size: 11px; margin-bottom: 10px; }
        .meta td { padding: 2px 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
        th { background: #EFEFEA; font-weight: 600; }
        .num { text-align: right; font-family: 'IBM Plex Mono', monospace; }
        .totals td { border: none; padding: 3px 6px; }
        .totals .label { text-align: right; font-weight: 600; }
        .totals .grand { font-weight: 700; font-size: 13px; border-top: 1px solid #111; }
        .sign { margin-top: 40px; width: 100%; font-size: 10px; }
        .sign td { border: none; text-align: center; }
        .signline { border-top: 1px solid #111; width: 180px; margin: 0 auto 4px; height: 34px; }
        .terms { font-size: 9px; color: #444; margin-top: 16px; border-top: 1px solid #999; padding-top: 6px; }
        .stamp { border: 2px solid #5B2A86; color: #5B2A86; padding: 2px 8px; display: inline-block;
                 transform: rotate(-3deg); font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
        </style></head><body>
        """

    private fun page(title: String, docType: String, body: String): String =
        HEAD +
            "<div class=\"head\"><h1>$title</h1><div class=\"doc\">$docType</div></div>" +
            body +
            "<table class=\"sign\"><tr>" +
            "<td><div class=\"signline\"></div>Driver's signature</td>" +
            "<td><div class=\"signline\"></div>Consignee's signature</td>" +
            "<td><div class=\"signline\"></div>For $title</td>" +
            "</tr></table>" +
            "<div class=\"terms\">Goods booked at Owner's risk. Subject to the origin branch's jurisdiction. " +
            "This document was generated by TransportApp.</div></body></html>"

    private fun meta(vararg pairs: Pair<String, String>): String {
        val sb = StringBuilder("<table class=\"meta\">")
        var i = 0
        while (i < pairs.size) {
            sb.append("<tr>")
            sb.append("<td><b>").append(pairs[i].first).append(":</b> ").append(pairs[i].second).append("</td>")
            if (i + 1 < pairs.size) {
                sb.append("<td><b>").append(pairs[i + 1].first).append(":</b> ").append(pairs[i + 1].second).append("</td>")
            }
            sb.append("</tr>")
            i += 2
        }
        sb.append("</table>")
        return sb.toString()
    }

    /** The loading challan for one trip (§11). */
    fun challan(
        challanNo: String,
        companyName: String,
        companyAddress: String,
        vehicle: String,
        driver: String,
        driverLicence: String,
        from: String,
        to: String,
        via: List<String>,
        consignments: List<ChallanLine>,
        hire: String,
        advance: String,
        balance: String,
        created: String,
    ): String {
        val viaText = if (via.isNotEmpty()) " via " + via.joinToString(", ") else ""
        val rows = consignments.joinToString("") { c ->
            "<tr><td>${c.bilty}</td><td>${c.consignee}</td><td>${c.from}</td><td>${c.to}</td>" +
                "<td class=\"num\">${c.packages}</td><td class=\"num\">${c.weightKg} kg</td><td class=\"num\">${c.amount}</td></tr>"
        }
        val body =
            meta(
                "Challan No" to challanNo,
                "Date" to created,
                "Vehicle" to vehicle,
                "From" to from,
                "Driver" to driver,
                "To" to to + viaText,
                "Licence" to driverLicence,
                "Company" to companyName,
            ) +
                "<table><tr><th>Bilty No</th><th>Consignee</th><th>From</th><th>To</th>" +
                "<th>Pkgs</th><th>Weight</th><th class=\"num\">Freight</th></tr>" +
                rows +
                "</table>" +
                "<table class=\"totals\"><tr><td class=\"label\">Total load</td><td class=\"num\">" +
                "${consignments.sumOf { it.weightKg }} kg</td></tr>" +
                "<tr><td class=\"label\">Lorry hire</td><td class=\"num\">$hire</td></tr>" +
                "<tr><td class=\"label\">Advance paid</td><td class=\"num\">$advance</td></tr>" +
                "<tr><td class=\"label\">Balance to driver</td><td class=\"num\">$balance</td></tr></table>"
        return page(companyName, "LOADING CHALLAN", body)
    }

    data class ChallanLine(
        val bilty: String,
        val consignee: String,
        val from: String,
        val to: String,
        val packages: Int,
        val weightKg: Long,
        val amount: String,
    )

    /** The freight bill for one party (§12). */
    fun freightBill(
        billNo: String,
        companyName: String,
        companyAddress: String,
        companyGstin: String,
        partyName: String,
        partyGstin: String,
        from: String,
        to: String,
        period: String,
        consignments: List<BillLine>,
        freight: String,
        charges: List<Pair<String, String>>,
        gst: String,
        total: String,
        issued: String,
    ): String {
        val rows = consignments.joinToString("") { c ->
            "<tr><td>${c.bilty}</td><td>${c.date}</td><td class=\"num\">${c.packages}</td>" +
                "<td class=\"num\">${c.weightKg} kg</td><td class=\"num\">${c.rate}</td><td class=\"num\">${c.amount}</td></tr>"
        }
        val chargeRows = charges.joinToString("") { (label, value) ->
            "<tr><td colspan=\"5\">$label</td><td class=\"num\">$value</td></tr>"
        }
        val body =
            meta(
                "Bill No" to billNo,
                "Issued" to issued,
                "Party" to partyName,
                "GSTIN" to partyGstin,
                "Route" to "$from - $to",
                "Period" to period,
            ) +
                "<table><tr><th>Bilty No</th><th>Date</th><th>Pkgs</th><th>Chargeable</th>" +
                "<th class=\"num\">Rate</th><th class=\"num\">Freight</th></tr>" +
                rows + chargeRows +
                "</table>" +
                "<table class=\"totals\">" +
                "<tr><td class=\"label\">Taxable value</td><td class=\"num\">$freight</td></tr>" +
                "<tr><td class=\"label\">GST</td><td class=\"num\">$gst</td></tr>" +
                "<tr><td class=\"label grand\">Grand total</td><td class=\"num grand\">$total</td></tr></table>"
        return page(companyName, "FREIGHT BILL", body)
    }

    data class BillLine(
        val bilty: String,
        val date: String,
        val packages: Int,
        val weightKg: Long,
        val rate: String,
        val amount: String,
    )

    /** The money receipt for a collection (§12.2). */
    fun receipt(
        receiptNo: String,
        companyName: String,
        companyAddress: String,
        partyName: String,
        amount: String,
        inWords: String,
        mode: String,
        towards: String,
        collected: String,
        collectedBy: String,
    ): String {
        val body =
            meta(
                "Receipt No" to receiptNo,
                "Date" to collected,
                "Received from" to partyName,
                "Mode" to mode,
                "Towards" to towards,
                "Collected by" to collectedBy,
            ) +
                "<table class=\"totals\">" +
                "<tr><td class=\"label grand\">Rupees received</td><td class=\"num grand\">$amount</td></tr></table>" +
                "<p style=\"font-size:11px\">$inWords only.</p>"
        return page(companyName, "MONEY RECEIPT", body)
    }

    /** The party statement of account for a period (§12.3). */
    fun statement(
        partyName: String,
        companyName: String,
        from: String,
        to: String,
        opening: String,
        rows: List<StatementLine>,
        closing: String,
    ): String {
        val table = if (rows.isEmpty()) {
            "<p style=\"font-size:11px\">No transactions in this period.</p>"
        } else {
            "<table><tr><th>Date</th><th>Particulars</th><th>Document</th>" +
                "<th class=\"num\">Debit</th><th class=\"num\">Credit</th></tr>" +
                rows.joinToString("") { r ->
                    "<tr><td>${r.date}</td><td>${r.particulars}</td><td>${r.doc}</td>" +
                        "<td class=\"num\">${r.debit.ifEmpty { "-" }}</td><td class=\"num\">${r.credit.ifEmpty { "-" }}</td></tr>"
                } + "</table>"
        }
        val body =
            meta("Party" to partyName, "Period" to "$from - $to") +
                table +
                "<table class=\"totals\">" +
                "<tr><td class=\"label\">Opening balance</td><td class=\"num\">$opening</td></tr>" +
                "<tr><td class=\"label grand\">Closing balance</td><td class=\"num grand\">$closing</td></tr></table>"
        return page(companyName, "STATEMENT OF ACCOUNT", body)
    }

    data class StatementLine(
        val date: String,
        val particulars: String,
        val doc: String,
        val debit: String,
        val credit: String,
    )
}
```
