# Generalized HTML Document Renderer — Design Spec

Date: 2026-09-30
Status: approved in chat, pending spec review
Sprint: Plan 3 of 2. The canvas/image unification is deferred to a later sprint.

Design reference: `docs/Document_Renderer_and_Printer.md` (the TransportApp2
document pipeline). That document is the source of most of the reasoning below;
where this project deliberately diverges from it, the divergence is called out
and justified.

## Problem

`lib/template/types.ts:4-6` already declares the template to be "a portable
contract that a future rendering engine can consume without Fabric being
installed". No such engine exists. Every current export round-trips the template
back through Fabric:

```
serialiseObjects -> BillTemplate -> hydrateTemplate -> StaticCanvas -> output
```

That has three consequences. It needs Fabric in the browser to produce a
document. It has no data layer, so a `{{placeholder}}` can only ever be printed
literally. And it cannot serve the goal that motivated the reference document:
*the same document, opened or printed anywhere, is the same document*.

Planning this also surfaced a pre-existing defect, described under **The freehand
defect** below, which silently drops every freehand stroke from every export.

## Goals

- **Pure.** `(BillTemplate, values) -> string`. No Fabric, no React, no DOM, no
  network, no clock, no filesystem. Runs identically in a browser, in Node, and
  in CI.
- **Deterministic.** Identical input produces byte-identical output. No
  timestamps, no randomness, no locale-dependent formatting.
- **Inert.** One self-contained file: no external stylesheet, no web font, no
  remote image, and **no JavaScript**. A customer can be emailed it.
- **Safe.** Every user-supplied value is HTML-escaped. Every template-supplied
  value that reaches CSS is validated against a whitelist, never interpolated
  raw.
- **Faithful.** Reproduces the traced geometry. The traced table becomes a real
  `<table>`, honouring the reference's rule that the one element which can
  overflow a page is the one the browser engine owns.
- **Extensible without rewrite.** `values` is a parameter from day one and
  defaults to `{}`. Data binding, and later recomputed totals, are additions to
  the call site, not changes to the renderer.
- **Fix the freehand loss.**

## Non-goals

- **No data-entry UI.** No values panel, no JSON data-file loader. With
  `values = {}` the `{{placeholder}}` tokens print literally, which is the
  agreed behaviour for this sprint.
- **No expression evaluation and no recomputed totals.** The reference's
  strongest idea — a whitelisted calculator so `total` is derived from `items`
  in integer paise and a supplied total is never trusted — is out of scope. It
  is the natural third plan, and it changes what a template can express, so it
  deserves its own spec.
- **No change to the existing exports.** JSON, SVG, PDF, DOCX and PNG all behave
  exactly as they do now. HTML is a sixth target.
- **No font embedding.** See **Fonts** below.
- **No multi-page output.** A traced bill is one page by construction.
- **No image attachment.** There is no editor feature for putting a real image
  in a placeholder yet, so an `image-placeholder` renders as the dashed box it
  is in the editor.

## What is taken from the reference document

| Reference principle | Where | Adopted here |
|---|---|---|
| Template is data, not code | §3.1 | The renderer reads only what the template declares. It contains no field vocabulary. |
| A field is a key, never a business concept | §3.1 | `{{key}}` resolved from a `values` map. Guard test enforces the absence of a vocabulary. |
| Determinism, offline, self-contained | §1, §4 | Adopted in full. No network is touched, ever. |
| Escape every user value | §4.5 | Adopted in full. |
| No JavaScript in the print document | §4.6 | Adopted in full. |
| Real `<table>` for the grid, not absolute boxes | §4.1 | Adopted **for the traced table only**; see **Deliberate divergence**. |
| `@page` CSS as the pagination implementation | §4.2 | Adopted, sized in px from the document rather than mm from A4. |
| Sheet sized in millimetres | §4.3 | Adapted: px, because the document size *is* the scanned bill's pixel size. |
| Theme values as CSS custom properties | §4.4 | Adopted for the small set of colours the template actually uses. |
| Refusal over silent repair | §3.2 | Adopted for template *values* that are unsafe: a bad colour is refused and reported, never emitted. |
| `htmlHash` via `String.hashCode()` is too weak | §8.1 | Adopted as a criticism: this uses real SHA-256. |
| Golden-file render tests | §8.2 | Adopted. |
| A second, non-primary render port compared by a parity test | §8.5 | Deferred; noted in **Future work**. |
| Never rasterize; drive the print adapter | §5 | Adopted. See **Printing**. |
| The eleven-item WebView checklist | §5 | Two items transfer; see **Printing**. |

## Deliberate divergence

The reference renders *semantic* templates: a list of business sections
(`header`, `items`, `totals`) that reflow, and whose tables grow with the data.
Its rule 1 — the grid is a real `<table>` because "the browser engine owns row
heights and page breaking" — exists to make a reflowing document paginate
correctly.

This project's templates are a **pixel-exact trace of one specific scanned
bill**. Every primitive has a measured position and size, and a traced table's
column widths are the ones the user drew. Reflowing that would destroy the only
property worth preserving. So:

- **A traced `table` renders as a real `<table>`** — `<colgroup>` from
  `colWidths`, per-row `height` from `rowHeights`, `<thead>` when `headerRow`,
  per-cell borders, padding, colour, alignment and font size from the cell and
  table spec. This is the one object that can plausibly exceed a page, and it
  gets browser-managed layout.
- **Every other primitive is absolutely positioned** from its document
  coordinates, in `zIndex` order. This is the only way to reproduce a trace.

The consequence is that a traced template does not paginate. `.sheet` is
`overflow: hidden`, so anything past the document edge is clipped rather than
flowed onto a second page. That is correct for this input class and must not be
mistaken for support.

## Architecture

A new pure package, `lib/render/`, with no dependency on anything but
`lib/template/types` (types only) and `lib/template/placeholders` (for the
`{{token}}` grammar). It never imports `fabric`, `react`, or anything from
`lib/canvas/`. A static import scan in the test suite enforces that.

```
lib/render/
  index.ts        public entry: renderHtml(template, values, options) -> string
  escape.ts       escapeHtml, and the attribute-quoting helper
  values.ts       token extraction and resolution against a values map
  css.ts          safeColor, fontStack, safeLength, safeAngle
  sha256.ts       pure-TS SHA-256, hex
  canonical.ts    stable-key JSON serialisation, for hashing
  style.ts        the stylesheet, including @page
  primitives.ts   one function per object type
```

`primitives.ts` is the only file that knows a document coordinate exists.
`index.ts` owns document size, z-order, the sheet element and the surrounding
`<html>`. `style.ts` is a pure function of the document size and the colour
set, so it is testable without a template.

### The public entry

```ts
export interface RenderOptions {
  /** Emitted as a comment. Never affects layout. */
  title?: string;
}

export function renderHtml(
  template: BillTemplate,
  values: Readonly<Record<string, string>> = {},
  options: RenderOptions = {},
): string
```

Synchronous, string in, string out.

## Values

`{{key}}` tokens are resolved with the existing grammar in
`lib/template/placeholders.ts` (`TOKEN_SOURCE`, `extractVariables`). For each
token:

- if `values` has the key, the **escaped** value replaces the token;
- otherwise the **literal token** is left in place.

That second rule is what makes this sprint's static render a real subset of the
final renderer rather than throwaway work. `renderHtml(template)` and
`renderHtml(template, { total: '3,510.00' })` are the same code path.

The renderer contains no notion of what a bill is. It has no list of field
names, no default values, no business labels. Two tests enforce this: a
template using an invented key such as `zzz_custom_thing` resolves, and a
source scan asserts that no identifier from `SUGGESTED_VARIABLES` appears
anywhere under `lib/render/`.

Values are escaped with the same routine as template text, so a value of
`Sharma & Sons <Traders>` is safe in a text object, in a table cell, and in a
title.

## Determinism

The same `BillTemplate` and `values` must produce byte-identical output. The
rules that make that true:

- **No clock.** `Date`, `Date.now`, `performance.now` and `Intl` are absent
  from the output. In particular `template.meta.modifiedAt` is **not** emitted,
  even though it exists on the model — it is the obvious determinism trap,
  because it changes on every save and would make every export unique.
- **No randomness.** No ids, no counters, no generated class names. Class names
  are derived from the object type and index only.
- **No locale.** Numbers are formatted with a fixed helper
  (`String(round2(n))` semantics: integers plain, at most two decimals, always
  `.` as the decimal separator). No `toLocaleString`.
- **Stable attribute order.** Every attribute is emitted in a fixed order by
  code, never by iterating an object literal whose key order could change.
- **Fixed object order.** Objects are sorted by `zIndex`, with the array index
  as a stable tiebreak, so equal `zIndex` values never reorder between runs.

The document carries two provenance attributes for traceability, both
deterministic:

- `data-template-version` — `template.templateVersion`.
- `data-template-hash` — SHA-256, hex, of the canonical serialisation of the
  template with `meta` reduced to its `name`. Everything else is covered, so a
  change to any traced field moves the hash; the save clock is not, so
  re-saving an unchanged trace keeps the same fingerprint.

### Hashing

SHA-256 is implemented in TypeScript in `sha256.ts`, not taken from
`crypto.subtle`, for two reasons. `crypto.subtle` is only available in a secure
context, so it is absent when the app is served over plain `http://` on a LAN —
which is exactly how a shop would run this. And the renderer must run in Node
and in CI without a DOM. `sha256.ts` is pure and directly unit-testable against
known vectors.

Fabric 7.4.0 does **not** export `joinPath` or `getPathCommandsInfo` from its
package entry, so no path helper is borrowed from it anywhere in this design.
(That matters for the freehand fix below, which builds a path-data string
locally.)

The hash covers the canonical form, produced by `canonical.ts`: JSON with
object keys sorted at every level, no insignificant whitespace, numbers
normalised. Hashing raw `JSON.stringify` output would make the fingerprint
depend on key insertion order. The input to that canonicaliser is the template
with `meta` replaced by `{ name }`, so `meta.modifiedAt` is excluded from the
fingerprint as well as from the output.

## Safety

### Escaping

`escapeHtml` replaces `&`, `<`, `>`, `"` and `'` — the same five characters the
reference escapes. It is applied to every piece of template-authored text and
every value: text object content, table cell text, object names, image
placeholder labels, and the document title.

### CSS values are validated, not escaped

Escaping is the wrong tool for CSS: `&lt;` is not a defence against
`fill: red; } body { display: none`. Every template value that reaches a
stylesheet or an inline `style` attribute is validated:

- `safeColor` accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
  `rgb(r,g,b)` / `rgba(r,g,b,a)` with numeric arguments only, and the keywords
  `transparent`, `none`, `currentColor`. Anything else is **refused**: the
  default is substituted and a reason is recorded. The value is never emitted.
- `fontStack` maps the template's `fontFamily` through a whitelist to a stack.
  An unrecognised family maps to the default sans stack. The raw string never
  reaches the stylesheet.
- `safeLength` and `safeAngle` accept any finite number and otherwise return the
  fallback. Neither imposes a range, deliberately: a rotation is applied modulo
  a full turn, so clamping one would move a traced object rather than tidy its
  input. `safeOpacity` is the exception and clamps to `0..1`, which is the one
  place a range means something. A *negative* length is refused separately, by
  the caller's `length()` helper, because the CSS parser discards it and the
  element would silently fall back to `width: auto`.
- A refusal repeated verbatim is recorded once. A table's own colours and
  lengths are looked up once per cell, and nine copies of one sentence tell a
  caller showing the list nothing they could not read from the first.

Refusals are collected and returned alongside the HTML so the caller can show
them, mirroring the reference's "refusal over repair" — a template with one bad
colour still renders, and the caller is told.

### No script, no external references

The output contains no `<script>`, no `<link>`, no `@import`, and no
`http://` or `https://` URL. A test asserts all four. This is the reference's
security posture and its reason for existing: the file is emailed and opened by
people who did not create it.

## Object rendering

Common to all: `position: absolute`, `left`/`top` in px, `z-index` from
`zIndex`, `opacity` from the object, skipped entirely when `visible` is false,
and a `transform: rotate(<angle>deg)` with `transform-origin: 50% 50%` when
`rotation` is non-zero, matching Fabric's centre origin.

| `type` | Element | Notes |
|---|---|---|
| `group` | **nothing** | See below. |
| `line`, `hr`, `vr` | one `div` | Rotated. `left`/`top` from the segment start, `width` from its length, `height` from `max(strokeWidth, 0.75)`, `background` from `stroke`, `transform-origin: 0 50%`, rotated by the segment's own angle. |
| `rect`, `rounded-rect` | one `div` | `box-sizing: border-box` so the border sits inside the traced box, matching the half-stroke inset the canvas table already uses. `border-radius` from `cornerRadius`. |
| `ellipse` | one `div` | As rect, with `border-radius: 50%`. |
| `polygon` | inline `svg` + `polygon` | The svg is absolutely positioned at the object's box with `overflow: visible`; points are already document-relative to the origin. |
| `freehand` | inline `svg` + `path` | `d` is SVG path data, produced by the serialiser fix below. `fill: none`, `stroke-linecap/linejoin: round`. |
| `text` | one `div` | See below. |
| `table` | wrapper `div` + `table` | See below. |
| `image-placeholder` | one `div` | Dashed border, centred `label`, matching the editor. |

### Why `group` renders nothing

`hydrateGroup` in `lib/template/hydrate.ts:222` returns `null`, and the
comment above it explains that groups are represented by `parentId` on children
rather than a Fabric group, because Fabric 7 groups cannot hold an exact layout.
A `GroupObject` in a template is therefore a serialised `ActiveSelection` — a
transient selection artefact with no children of its own; its children are
separate top-level entries with their own absolute coordinates and
`parentId: null`. Painting it would be actively wrong: `baseFields` gives every
object `stroke: "#000000"` and `strokeWidth: 1`, so a group would paint a
spurious black rectangle. The HTML renderer skips it, matching `hydrateGroup`.

### Text

`white-space: pre` and no wrapping, so a traced text box never reflows and a
long value cannot push anything. Line breaks in the text are honoured.
`line-height` is a multiplier in the model, so it is emitted as
`fontSize * lineHeight` in px. `charSpacing` is in thousandths of an em in
Fabric, so it is emitted as `charSpacing / 1000` em. `textAlign` maps to
`text-align`. `textVerticalAlign` is a flex column with
`justify-content` of `flex-start` / `center` / `flex-end`. `fontStyle` and
`fontWeight` map directly.

### Tables

The wrapper is absolutely positioned at `(x, y)`. Inside it a real table with
`table-layout: fixed`, `border-collapse: collapse`, and an explicit pixel width
from `sum(colWidths)`. A `<colgroup>` fixes each column from `colWidths`. Each
`<tr>` carries `height` from its `rowHeights` entry. When `headerRow` is set the
first row is emitted as `<thead>` with `<th>`; otherwise every row is `<td>`.
Per cell: `border` from `borderWidth`/`borderColor`, `padding` from `padding`,
`font-size` and `font-weight` from the cell, `color` from
`cellTextColor`/`headerTextColor`, `background` from `cellFill`/`headerFill`,
and `text-align` from the cell.

Cell text is ellipsised in the canvas renderer. The HTML renderer does not
ellipsise: it applies `overflow: hidden`, so a long value is clipped at the cell
edge. This is a deliberate, documented difference — CSS truncation with
`text-overflow: ellipsis` needs a constrained inline box, and for a table cell
that fights the browser's own layout.

## Page and printing

The document size *is* the scanned bill's pixel size, which is often not A4. So
the page is declared in px from the document, not mm from A4:

```css
@page { size: <document.width>px <document.height>px; margin: 0; }
.sheet { position: relative; width: <w>px; height: <h>px; overflow: hidden; }
```

A non-A4 bill therefore prints at its true size on any printer, which is what a
tracing tool needs and is the one thing an A4-fixed renderer cannot do.

### Printing

The exported file has no print button and no script. The user prints it with
their browser, which is the same engine as the system "Save as PDF" dialog on
every platform. Two items from the reference's eleven-item WebView checklist
transfer and are encoded here:

1. **Never rasterize.** Print the HTML. Screenshotting or drawing the DOM to a
   bitmap applies device density, viewport heuristics and clipping. The
   reference calls this "a settled non-answer — do not resurrect it", and it
   applies with equal force to `window.print()`.
2. **Pin text sizing.** Every length in the output is in px, and the print
   stylesheet sets `-webkit-text-size-adjust: 100%` and
   `text-size-adjust: 100%`. A browser's minimum-font-size or default-font-size
   setting cannot therefore move a single traced element.

The other nine items are Android WebView traps — invisible views skipping
Chromium's pipeline, `onPageFinished` firing for an internal blank page, print
attributes that a headless drive must supply. They do not arise when a human
prints a file they just opened, and this design does not drive a headless
print adapter.

## The freehand defect

Found while planning, and pre-existing — this design does not cause it and
cannot avoid inheriting it.

`lib/template/serialize.ts:52` defines:

```ts
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
```

`serialiseFreehand` (`:265`) writes `path: str(o.path, "")`. But a Fabric
`Path` stores its geometry in `path` as an **array of command tuples**, not a
string. Verified against the installed fabric 7.4.0:

```
new Path([['M',0,0],['L',100,50]]).path   ->  [ [ 'M', 0, 0 ], [ 'L', 100, 50 ] ]   (an Array)
typeof p.path === 'object', Array.isArray(p.path) === true
str(p.path, '')                          ->  ""
```

So every freehand stroke is serialised as `path: ""`, and
`hydrateFreehand` (`lib/template/hydrate.ts:153`) returns `null` for an empty
path. **Freehand strokes appear in the editor and in no exported document** —
not the JSON (which stores the empty string), and not the SVG, PDF, DOCX or PNG,
all of which hydrate the same template.

The fix is on the serialisation side only. `new Path('M 0 0 L 100 50')` parses
path data into exactly the same command array, verified in the same run:

```
new Path('M 0 0 L 100 50 Q 120 80 140 60').path
  ->  [ [ 'M', 0, 0 ], [ 'L', 100, 50 ], [ 'Q', 120, 80, 140, 60 ] ]
```

so `hydrateFreehand` needs no change. `serialiseFreehand` must emit path data
built locally — `commands.map(c => c[0] + ' ' + c.slice(1).join(' ')).join(' ')`
— because fabric 7.4.0 exports neither `joinPath` nor
`getPathCommandsInfo` from its package entry. The `FreehandObject.path` field's
doc comment in `types.ts` changes from nothing to "SVG path data", and a
round-trip test is added: serialise a template containing freehand, hydrate it,
assert the commands survive.

This is in scope here rather than deferred because the HTML renderer reads the
same template and would otherwise inherit the loss, and because shipping a
"generalized renderer" that silently drops a primitive the user can draw is not
acceptable.

## Fonts

No web fonts are fetched, per the reference. Every family is mapped through a
whitelist to a stack that ends in a generic family, so the file renders with no
network.

The honest limit of the "identical output everywhere" goal: **layout is
identical on every platform, glyph shapes are not.** Every box is fixed and no
text wraps, so a substituted font can never reflow or move anything. But if the
traced `fontFamily` is not installed on the viewing machine, the letterforms
differ. There is no web-safe set that covers arbitrary fonts, and fetching one
is forbidden.

If glyph-identical output is ever required, the fix is base64-embedding a font
file, which is a decision about file size and licensing rather than about this
renderer. It is deliberately not taken now. The editor should warn the author
when a traced family is not in the whitelist; that warning is not part of this
sprint either, since it is an editor concern rather than a renderer one.

## Errors

- A bad colour or font is refused: the default is used and a human-readable
  reason is returned. The document still renders. A template with one bad value
  must never fail to produce output.
- A `templateVersion` the renderer does not recognise is refused outright, with
  a message naming the version and the supported one. This is the reference's
  schema gate, and it is the one case that does not render a degraded document,
  because a future template's geometry cannot be guessed at.
- An object with non-finite `x`, `y`, `width` or `height` is skipped and
  recorded. It cannot be positioned, and emitting `NaNpx` would break the whole
  stylesheet rather than one element.
- A template with **no** `document`, `meta` or `objects` renders a degraded page
  and records a refusal for each. All three load sites cast `JSON.parse` output
  straight to `BillTemplate`, so a truncated or hand-edited file reaches the
  renderer with those fields absent, and dereferencing one would escape the
  public entry as a raw `TypeError`. A non-string `meta.name` is coerced rather
  than dropped: `42` is a name someone typed.
- `values` containing a non-string is ignored for that key, so the token prints
  literally.

## Testing

`tests/render.test.ts` and `tests/renderGolden.test.ts`. The renderer is a pure
function, so these are fast string assertions with no DOM.

**Golden files**, following the reference's §8.2 pattern: a committed HTML file
per case, compared byte for byte. Cases: a single text object; a 3×3 table with
a header row; a template mixing every primitive type; a non-A4 document size; a
template with no objects. A golden *diff* is what surfaces an unintended
change, so the failure output shows the first differing line.

**Properties that must hold for every golden:**

- Rendering the same input twice is byte-identical.
- The output contains no `<script`, no `<link`, no `@import`, and no
  `http://` / `https://`.
- The output does not contain the template's `meta.modifiedAt` value. That is
  the one specific determinism trap worth asserting by name, because the field
  exists on the model and changes on every save. A general "no date-looking
  string" assertion is *not* used: a traced invoice legitimately contains its
  own dates, so such a test would be a false positive waiting to happen.
- Every `<style>` length is in px.

**Specific behaviours:**

- `{{unknown_key}}` survives literally; `{{known_key}}` is replaced when present
  in `values`.
- A value and template text of `Sharma & Sons <Traders>` appear escaped, never
  as markup.
- A template `fill` of `red; } body { display: none` is neutralised and a
  refusal reason is returned.
- An unrecognised `fontFamily` maps to the default stack and does not appear
  verbatim in the output.
- A `group` object contributes no element.
- A `table`'s `<colgroup>` widths match `colWidths` exactly and the row heights
  match `rowHeights` exactly.
- One bad table colour or length produces exactly one refusal, not one per cell.
- A template with no `meta`, no `objects`, no `document`, or a non-string
  `meta.name` renders and returns a refusal naming what was substituted.
- A negative traced `width` or `height` is refused and rendered as `0px`; a
  negative `x` or `y` is preserved, because a position is not a length and an
  object may hang off the page edge.
- `@page size` equals the document size in px.
- `data-template-hash` is stable across runs, changes when any traced template
  field changes, and does **not** change when only `meta.modifiedAt` differs —
  that field is excluded from the fingerprint, so two saves of the same trace
  agree. The canonical form is order-independent, so two templates differing only
  in key insertion order hash identically.
- `sha256.ts` matches published test vectors.
- `lib/render/**` imports neither `fabric` nor `react`, and contains no
  identifier from `SUGGESTED_VARIABLES`. Enforced by reading the source as text,
  not by a linter, so it cannot be configured off. The scan is recursive, and the
  recursion is itself asserted: a guard that quietly stopped descending into a
  subdirectory would be a guard that stopped guarding.
- Freehand round trip: serialise a template with a freehand object, hydrate it,
  assert the path commands survive.

## Files

**New**

- `lib/render/index.ts`, `escape.ts`, `values.ts`, `css.ts`, `sha256.ts`,
  `canonical.ts`, `style.ts`, `primitives.ts`
- `tests/render.test.ts`, `tests/renderGolden.test.ts`
- `tests/renderGolden/*.html`
- `docs/superpowers/specs/2026-09-30-generalized-html-renderer.md` (this file)
- `docs/superpowers/plans/2026-09-30-generalized-html-renderer.md`

**Modified**

- `lib/template/serialize.ts` — the freehand path-data fix
- `lib/template/types.ts` — document `FreehandObject.path` as SVG path data
- `components/editor/ExportMenu.tsx` — sixth export target, using
  `downloadText(html, name, 'text/html;charset=utf-8')`, which already exists
- `README.md` — the pipeline, the determinism guarantee, the font caveat, and
  the freehand fix

**Unchanged on purpose**

- `lib/export/download.ts` — `downloadText` already takes a MIME type
- `lib/export/renderTemplate.ts`, `toSvg.ts`, `toPdf.ts`, `toDocx.ts` — every
  existing export keeps its current behaviour
- `lib/canvas/**` — the renderer does not touch the editing engine
- `lib/template/hydrate.ts` — already accepts path data

## Future work

- **Data binding.** A values panel built on `collectDocumentVariables`, and a
  populated map passed to `renderHtml`. No renderer change.
- **Recomputed totals.** The reference's whitelisted expression evaluator over
  integer paise, so a supplied total is never trusted. Needs its own spec
  because it changes the template schema.
- **A second render port.** The reference's §8.5: a headless-Chromium port for
  server-side or bulk rendering, kept non-primary, compared to the browser path
  by a parity test on text tokens, page count and page geometry rather than
  bytes.
- **Image attachment** for `image-placeholder`, which would then need a data
  URI in the template and a size budget for the exported file.
- **Font embedding**, if glyph-identical output is ever required.
