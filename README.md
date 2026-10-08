# Bill Template Maker

A **manual** bill/invoice layout tracing and structural reconstruction editor.

You load a bill image from your computer, it becomes a faint locked reference
underlay, and you trace its structure by hand with lines, rectangles, text
boxes, tables and image placeholders. The result is an editable structural
template you can export as JSON, SVG, PDF or DOCX.

**This tool does no OCR and no automatic interpretation.** Nothing infers what a
line or a number means from the image. You decide that, by drawing it and
labelling it.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run build:share` | Rebuild the standalone share runtime into `public/sharekit.js` |
| `npm run lint` | ESLint (Next core-web-vitals + typescript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (pure logic) |
| `npm run test:e2e` | Playwright end-to-end workflow test |
| `npm run fixture` | Regenerate the sample bill image used by the E2E test |

The E2E test starts its own dev server on port 3111.

### Using it

1. **Choose File** on the upload screen (or drop an image onto it). PNG, JPG and
   WebP are read in the browser with `FileReader`; **nothing is uploaded**.
2. The image becomes a locked reference at 25% opacity on the bottom layer, and
   the document adopts the image's natural size (e.g. 794 × 1123).
3. Pick a tool and drag on the canvas to trace. **Text** places a text box you
   can type into; type `{{customer_name}}` to mark it as a dynamic variable.
4. Toggle **Preview** to hide the reference and see the clean template.
5. **Export ▾** to download any format.

---

## Three ways out of the editor

A traced template is only useful if something can fill it in, so the editor
offers three exits, and they differ in who ends up holding the file.

| Action | Goes to | The template ends up |
| --- | --- | --- |
| **Save Template** | a `.json` file | with you, as data to re-open later |
| **Fill & Render** | `/render` in this app | in the app's template library |
| **Share as .html** | one `.html` file | with whoever you send it to |

### Share as .html - one file, no server

The shared file carries the template *and* the small runtime that knows how to
fill it, inlined. Open it in any browser and you get:

- a form generated from the template's own placeholders, grouped by where each
  one lives (text boxes, table cells, image slots),
- a live preview of the printed page beside it,
- **Print / Save as PDF**, the desktop route to a finished PDF.

Nothing is fetched at runtime and there is no upload step, so it works offline
and the recipient never sees this app.

The runtime lives in `lib/share/` and esbuild bundles it into
`public/sharekit.js` (`npm run build:share`). That bundle may only import
platform-free modules - no React, no Fabric - which is what keeps the shared
file small and self-contained. `lib/share/document.ts` assembles the file and
escapes the embedded template, so a value containing `</script>` cannot break
out of its JSON block.

### Placeholders

Every `{{token}}` and image placeholder becomes one generated form field. The
label, input type and max length are inferred from the key name
(`invoice_date` asks for a date, `total` for currency), and the
**Placeholders** panel in the left sidebar lets each one override that
inference:

- the label the form shows,
- the input type (`text`, `number`, `date`, `currency`),
- a max length for the input,
- and the **printed style**: font family, size, weight, style and colour.

A style applies where the placeholder fills a text box or table cell *by
itself*. A box reading `Total: {{total}}` keeps its own styling, because the
token is only part of the line - give the token its own text box when you want
it styled on its own.

A placeholder with no overrides behaves exactly as it always did, so the
metadata is entirely optional and templates saved before it keep working
unchanged.

### Fidelity: what the HTML engine reproduces

Every traced colour, border, radius, opacity, rotation and font name is
written verbatim into the standalone HTML: shared files pick them up, because
the public JSON is the visual contract. The editor's whitelist of families is
covered out of the box; any custom face you type is passed through by name.
Two boundaries to know about:

- Fonts are *referenced*, never embedded. A recipient needs that family
  installed on their machine, otherwise their browser falls back to the
  generic sans/serif in the emitted stack.
- Placeholder style only paints a token that occupies its own box or cell.
  `Total: {{total}}` prints with the surrounding box's styling by design.

## Architecture

The important design decision: **Fabric is the editing engine, but the
template format is an application-level contract.** `canvas.toJSON()` is never
used as an export. Two pure modules own the translation:

```
serialize.ts   Fabric objects  ->  BillTemplate     (app schema)
hydrate.ts     BillTemplate    ->  Fabric objects
```

Every field in the exported JSON is written explicitly by our code, so the
format is stable and a future rendering engine can consume it without Fabric.

**Exports are built from the template, never from the live canvas.**
`renderTemplate()` constructs a brand-new `StaticCanvas` from the template
alone, so the reference image is absent from every export *by construction*
rather than by remembering to filter it.

React holds only view state (selection, tool, zoom, panel flags). All
imperative Fabric state lives in a single `EditorController`, which panels
subscribe to via `useSyncExternalStore`, so dragging a shape does not re-render
the panels on every pointer move.

### Source of truth

The Fabric canvas is authoritative for editing. Undo/redo is snapshot based:
each entry stores the state before *and* after a change, and entries are only
created at meaningful moments (a completed drag, a finished cell edit) rather
than per pointer-move.

---

## The template JSON

```jsonc
{
  "templateVersion": 1,
  "document": { "width": 794, "height": 1123 },
  "meta": {
    "name": "acme-invoice", "modifiedAt": "2026-01-15T.",
    // Optional per-key contracts. Absent means "infer everything".
    "placeholders": [
      { "key": "customer_name", "label": "Who to bill", "maxLength": 60,
        "fontFamily": "Georgia", "fontWeight": "bold" }
    ]
  },
  "objects": [
    {
      "id": "rect_1a2b3c",
      "type": "rect",              // rect | rounded-rect | ellipse | line | hr | vr
                                  // polygon | freehand | text | table
                                  // image-placeholder | group
      "name": "Header Box",        // user editable, shown in the layers panel
      "role": "header",            // semantic tag: header, title, items, footer…
      "x": 40, "y": 30,            // top-left, document units, 1 unit = 1 px at 96dpi
      "width": 714, "height": 100,
      "rotation": 0, "opacity": 1, "visible": true, "locked": false,
      "zIndex": 0,                 // paint order; also the array order
      "parentId": null,            // set for grouped children
      "stroke": "#000000", "strokeWidth": 1, "fill": "transparent"
    },
    {
      "id": "text_9f0c1d",
      "type": "text",
      "name": "Customer Name",
      "role": "customer_name",     // inferred from a pure {{placeholder}}
      "roleKind": "variable",      // "static" | "variable"
      "text": "{{customer_name}}",
      "fontFamily": "Arial", "fontSize": 14, "fontWeight": "normal",
      "fontStyle": "normal", "textAlign": "left", "lineHeight": 1.16,
      "x": 60, "y": 180, "width": 300, "height": 20
    },
    {
      "id": "table_4d8e2f",
      "type": "table",
      "name": "Items Table",
      "role": "items",
      "x": 30, "y": 420, "width": 734, "height": 140,
      "rows": 4, "columns": 4,
      "colWidths":  [184, 184, 183, 183],   // authoritative geometry
      "rowHeights": [35, 35, 35, 35],       // authoritative geometry
      "cells": [                            // row-major, rows * columns entries
        { "text": "No", "textAlign": "left", "fontSize": 12, "fontWeight": "bold" }
      ],
      "borderColor": "#000000", "borderWidth": 1,
      "cellFill": "transparent", "headerRow": true, "headerFill": "transparent",
      "padding": 4, "fontFamily": "Arial"
    },
    {
      "id": "img_1b7e4c",
      "type": "image-placeholder",
      "name": "Logo",
      "role": "logo",              // logo | qr | stamp | signature | product | image
      "label": "LOGO",
      "x": 60, "y": 60, "width": 120, "height": 60
    }
  ]
}
```

**The reference bill image is never written here.** It is an authoring aid
only, so re-attaching it after reloading a template is a manual action
(Open Bill).

### Placeholders

Any text may contain `{{variable}}` tokens. Nothing infers their meaning:

- `{{customer_name}}` alone → `roleKind: "variable"`, `role: "customer_name"`
- `Total: {{total}}` → `roleKind: "variable"`, `role: null` (mixed text)
- `INVOICE` → `roleKind: "static"`, `role: null`

The same applies inside table cells.

---

## Export formats

| Format | How it is produced | Fidelity |
| --- | --- | --- |
| **JSON** | `serialize.ts` mapping | Exact. The canonical format and the input to any future renderer. |
| **SVG** | Template → fresh `StaticCanvas` → `toSVG()` with an explicit document `viewBox` | Exact. Real `<rect>`, `<line>`, `<text>`, custom `<g>` for tables and placeholders. No `<image>`. |
| **PDF** | jsPDF, page sized in `px` to the document (not the browser viewport), content via `addSvgAsImage` | Visually exact. Falls back to a 3× raster if the SVG path throws. |
| **DOCX** | `docx` library, built from the template | Structural, not pixel-exact. See below. |
| **PNG** | 2× raster of the template | Exact. The only deliberately raster export. |
| **HTML Document** | Pure `lib/render` — `(template, values) => string`, no canvas | Exact, deterministic, inert. Print-ready. See below. |

### The HTML Document export

The sixth export is the only one that does not go through Fabric. `lib/render`
is a pure package with one public entry:

```ts
renderHtml(template, values, options) -> { html, refusals, variables }
```

- **Pure and deterministic.** No Fabric, no React, no DOM, no network, no clock.
  The same template and the same values always produce the same bytes, which is
  what lets the output be cached, diffed, or sent to a printer. A test reads
  `lib/render/*.ts` as text and fails on `Date`, `Math.random`, `Intl`,
  `toLocaleString`, `crypto`, `fetch` and the DOM, so the guarantee cannot be
  configured off.
- **`meta.modifiedAt` is excluded** from the output and from the
  `data-template-hash` fingerprint. It changes on every save, so including it
  would make the hash unable to answer the question a caller actually asks — has
  the layout changed? Two saves of the same trace keep the same fingerprint.
- **Two separate defences, for two separate kinds of input.** A *user value*
  that reaches text is HTML-escaped. A *template value* that reaches CSS is not
  escaped but validated against a whitelist — `safeColor`, `safeLength`,
  `safeAngle`, `safeOpacity`, `fontStack` — because escaping a bad colour would
  still print the attacker's colour. Anything refused is returned in
  `refusals` with the field and the reason, so the caller learns what to fix.
- **`values` defaults to `{}`,** which leaves `{{placeholder}}` tokens printing
  literally. That is deliberate: this sprint's static render is a real subset of
  the future data-bound render rather than throwaway work. The next step — a
  values panel or a data-file loader — reuses this same code path and passes a
  map instead of nothing.
- **A table is a real `<table>`**, not a pile of absolutely-positioned cells: a
  `<colgroup>` carrying the traced column widths, the header row in `<thead>`
  with `<th>`, the rest in `<tbody>` with `<td>`. A bill table that survives
  round-tripping through a browser's reflow, a print dialog and a PDF printer is
  worth more than pixel-identical markup that only this app can read.
- **`@page` is sized in the document's own pixels**, not A4 — a traced bill is
  usually not A4 and must print at its true size. px-only also means a
  browser's minimum-font-size setting cannot move anything.
- **Fonts: layout identical everywhere, glyph shapes not.** Nothing is loaded
  from outside the page and no font is embedded, so a substituted family changes
  the letterforms. Every length is fixed and text is `white-space: pre` and
  clipped, so the *boxes* are identical in every browser — the shapes inside them
  depend on the fonts the reader already has.
- **The file contains no JavaScript.** No `<script>`, no `<link>`, no `@import`,
  no remote reference, and no `xmlns` on the inline `<svg>` elements (HTML5 puts
  `<svg>` in the SVG namespace on its own). So printing is the browser's own
  print pipeline, the file opens with the network switched off, and it can be
  emailed to someone who did not create it.

### Why DOCX is a flow approximation

Word has no absolute positioning, so pixel-exact placement is impossible
without screenshots — and the brief explicitly rules out replacing the
template with a canvas screenshot. Instead `toDocx.ts`:

- recovers column structure geometrically, by grouping objects whose vertical
  ranges overlap into horizontal "bands" and laying each band out as a
  borderless Word table;
- emits tables as **native Word tables** with real column widths, row heights,
  cell padding and borders;
- emits text as `TextRun`s with matching font, size, weight and alignment;
- emits horizontal/vertical rules and rectangles as paragraphs with real
  paragraph borders;
- preserves vertical rhythm through `spacing`, and horizontal offsets through
  `indent` (1 px = 15 twips).

The result opens as a genuinely editable Word document with real tables, rather
than a picture of one.

---

## Notable implementation findings

These cost real debugging time and are load-bearing for anyone extending this:

1. **Fabric 7 has no table primitive, and `Group` cannot substitute for one.**
   `Group` has an internal `layoutManager` that *owns* child positioning:
   setting a child's `left` and re-measuring gives a delta of exactly `0`. A
   200×60 grid reports `width: 181`, and forcing `width` fixes the group's
   reported box while children still render elsewhere. Disabling the layout
   manager corrupts the group. So `BillTable` is a **self-rendering
   `FabricObject`** that keeps the grid as data (`colWidths`, `rowHeights`,
   `cells`) and paints it in `_render`. Geometry comes from the pure
   `lib/template/geometry.ts`, which is fully unit tested. Tables are resized by
   editing column widths, never by scaling, so `scaleX` stays `1` and geometry
   is exact.

2. **Fabric 7 positions objects from their centre by default.**
   `left`/`top` are the origin point, and `originX`/`originY` default to
   `center`. Every object this app creates sets `originX: "left"`,
   `originY: "top"` explicitly, so coordinates match the template's top-left
   convention.

3. **Fabric 7 lowercases `instance.type`.** A custom `BillTable` reports
   `"billtable"`, and `IText` reports `"itext"`. Any `switch (obj.type)` on
   those silently misses. App classes therefore carry an explicit `appType`
   discriminator, and the serialiser matches case-insensitively.

4. **Custom Fabric properties must be registered.** Without adding names to
   `FabricObject.customProperties`, `id`, `name` and `role` vanish from
   `toObject()` and `fromObject()` with no warning.

5. **Next 16 blocks dev resources for unlisted hosts.** Browser tests
   connecting via `127.0.0.1` cannot load the client bundle unless the host is
   in `allowedDevOrigins` in `next.config.ts`.

6. **Space is a browser shortcut.** Space means "page down", so it scrolls the
   canvas pane out from under the user the moment it is held. The global
   keydown handler must `preventDefault()` it. It also cannot be detected by
   tracing the controller, because Fabric captures its handler references at
   `attach()` time, so replacing the property afterwards has no effect — the
   only way to see this was to listen for `scroll` events on the stage and
   trap `Element.prototype.scrollTop`, which proved no code was scrolling and
   pointed at the browser default instead.

7. **A custom Fabric object paints with its local origin at its centre.**
   Custom `_render` and `_toSVG` content must be drawn from `(-w/2, -h/2)`,
   even when `left`/`top` are the top-left corner. Drawing from `(0, 0)` put
   the table grid half its size down and right of the position Fabric reported,
   so the grid and the selection handles visibly disagreed — and the table
   looked un-resizable because the handles were nowhere near the grid. Fabric
   also wraps `_toSVG` output in the object's own SVG transform, so emitting a
   manual `translate` double-offsets it.

8. **`getImageData` probes are not a reliable way to test rendering here.** A
   1px stroke at 62% zoom is sub-pixel, so pixel sampling reports antialiasing
   rather than geometry. The regression test for finding 7 asserts the paint
   origin directly (the first `<rect>` in `_toSVG`), which is exact.

9. **A drag's `scaleX` is not a stable factor to multiply by.** Fabric
   recomputes it on every `object:scaling`, and *neither side of the ratio is a
   constant*. Its two branches differ only in how the numerator is formed, and
   both numerators are live:

   - The **axis** branch, `|newPoint.x * target.scaleX / dim.x|`, taken by the
     four edge midpoints and by the corners under Shift.
   - The **proportional** branch,
     `distance / (|dim.x * original.scaleX / target.scaleX| + |dim.y *
     original.scaleY / target.scaleY|)`, taken by a plain corner drag:
     `canvasDefaults.uniformScaling` is `true` and `uniScaleKey` is `shiftKey`,
     so `scaleIsProportional` reduces to `!shiftKey`.

   `newPoint` comes from `getLocalPoint`, which normalizes the pointer position
   the handler was just called with — "current mouse x/y position, canvas
   normalized" — against the origin captured at `mouse:down`. `dim` is
   `target._getTransformedDimensions()`, which reads `scaleX`, `scaleY`, `width`
   and `height` off the object. In that formula the only mouse-down quantities are
   `original.scaleX`/`original.scaleY` and the origin the pointer is measured
   from. So an object that grows its own `width`
   mid-drag is handed a different divisor on the very next event: the number
   changes every time, and re-applying it to the already-resized widths
   compounds. That is how one measured drag asking for ~130 document units — the
   ask at the E2E suite's own viewport and zoom, not a property of the bug —
   landed anywhere from ~7 to ~910 off. The fix is that the drag path never
   reads `scaleX`: it derives the target size from the pointer's displacement
   since `mouse:down` and resolves the column geometry from a snapshot taken
   when the gesture began, so re-applying the same absolute target is a no-op
   rather than one more multiplication.

4. **Every freehand stroke was silently dropped from every export.** A Fabric
   `Path` stores its geometry as `path: Array<[command, ...coords]>`, an array of
   command *tuples* — not a string. The serialiser had a `str(v, fallback)`
   helper that returns `fallback` for anything that is not a string, and applied
   it to `o.path`, so every stroke was written as `path: ""`. On reload
   `hydrateFreehand` returns `null` for an empty path, so pencil strokes vanished
   from a saved template, and every export built from that template lost them too.
   Nothing errored: a whole traced drawing was quietly lost.

   Fabric 7.4.0 exports **neither `joinPath` nor `getPathCommandsInfo`** from its
   package entry — verified — so there is no library helper to call, and the `d`
   string is built locally in `serialize.ts` by joining the tuples. A `d` string
   is still the right wire format for the template because `new Path(<data>)`
   parses path data back into exactly those tuples, so `hydrateFreehand` needed no
   change and the round trip is exact.

---

## Files

```
app/
  layout.tsx                     Root layout, metadata
  page.tsx                       Renders <BillEditor/>
  globals.css                    Tailwind theme, editor scrollbars, range inputs
components/
  editor/
    BillEditor.tsx               Client root: upload ↔ editor stages, preview mode
    UploadScreen.tsx             File picker / drag-drop, local-only reading
    Workspace layout in BillEditor:
      ToolRail.tsx               Tool buttons + polygon close action
      CanvasStage.tsx            Hosts the Fabric canvas, scroll container, grid
                               overlay, drag-to-pan, inline cell editor
      PropertiesPanel.tsx        Per-type property editors, table cell inspector
      LayersPanel.tsx            Layer list: rename, role, visibility, lock, reorder
      ReferencePanel.tsx         Opacity, show, lock, remove
      TopBar.tsx                 Open / Save / Undo / Redo / Preview / Export
      ExportMenu.tsx             JSON, SVG, PDF, DOCX, PNG, HTML Document
    StatusBar                    Zoom, document size, object count, zoom controls
  ui/Controls.tsx                Panel, Field, TextInput, NumberInput, Select,
                                 ColorInput, Button, Checkbox
hooks/
  useEditorController.ts         Owns the controller, useSyncExternalStore bridge,
                                 global keyboard shortcuts
lib/
  template/                      ← pure, unit tested
    types.ts                     The BillTemplate schema
    geometry.ts                  Table maths: offsets, cell rects, hit testing,
                                 even split, proportional scaling
    placeholders.ts              {{variable}} parsing and role analysis
    serialize.ts                 Fabric → BillTemplate (duck-typed, no Fabric import)
    hydrate.ts                   BillTemplate → Fabric objects
  canvas/
    EditorController.ts          The single brain: canvas lifecycle, tools, zoom,
                                 pan, grid, snapping, history, selection
    history.ts                   Before/after snapshot history stack
    fabricSetup.ts               Registers app custom properties
    objects/BillTable.ts         Self-rendering table object + _toSVG
    objects/ImagePlaceholder.ts  Dashed labelled placeholder + _toSVG
  export/
    renderTemplate.ts            Reference-free renderTarget for all exports
    toSvg.ts                     JSON, SVG, PNG
    toPdf.ts                     jsPDF
    toDocx.ts                    docx, with the banding algorithm
    download.ts                  Blob/URL download helpers
  render/                        ← pure, deterministic, no Fabric/React/DOM
    index.ts                     renderHtml: the public entry, sheet, z-order,
                                 fingerprint, refusal aggregation
    primitives.ts                One function per object type; the only file that
                                 knows a document coordinate exists
    style.ts                     The stylesheet, a pure function of page size
    css.ts                       Whitelist validation: safeColor, fontStack,
                                 safeLength, safeAngle, safeOpacity, Refusals
    values.ts                    {{token}} extraction and resolution
    escape.ts                    escapeHtml, attr
    canonical.ts                 Key-sorted JSON, for hashing
    sha256.ts                    Pure-TS SHA-256, hex out
tests/                           Vitest: geometry, placeholders, serialize, history,
                                 tableResize, render, renderGolden
e2e/
  workflow.spec.ts               17-step end-to-end workflow
  make-fixture.ts                Generates the A4 and 2600px-tall bill PNGs
  fixtures/test-bill.png
  fixtures/long-bill.png
```

### Dependencies

| Package | Why |
| --- | --- |
| `fabric` 7.4 | Canvas editing engine |
| `jspdf` 4.2 | PDF export |
| `docx` 9.8 | DOCX export |
| `@playwright/test` | End-to-end workflow test |
| `vitest` | Unit tests |
| `tsx` | Runs the fixture generator script |

`eslint-config-next` 16 ships a native flat config, so `eslint.config.mjs`
imports it directly rather than going through `@eslint/eslintrc`.

---

## Testing

```bash
npm test        # 194 unit tests over the pure layer, the table resize gesture
                # and the HTML renderer
npm run test:e2e
```

Unit tests cover what a `<canvas>` cannot be meaningfully tested for in jsdom:
table geometry and hit testing, placeholder parsing, the serialiser contract
(including that a reference image can never appear, and that unknown Fabric
types are skipped), the history stack, and the table resize gesture (that a drag
resolves from its snapshot rather than compounding, that no single column
absorbs the whole expansion, and that a pending gesture never reaches the
serialiser or a reload).

`tests/renderGolden.test.ts` compares the renderer's output **byte for byte**
against five committed files in `tests/renderGolden/`, and names the first
differing line, so an unintended change shows up in review rather than as a
diff nobody reads. Set `UPDATE_GOLDEN=1` to rewrite them. Because a golden that
was generated without being read only proves the renderer is self-consistent,
they were read: the table case carries a `<colgroup>` with `300px 200px 214px` in
that order, the freehand case carries its `d`, `@page size:` matches each
document's own pixels, and `{{ total }}` is substituted with `3,510.00`.

The E2E test drives the real browser through the full workflow: upload a local
bill, verify the reference is a non-selectable 25%-opacity image, trace borders,
rules, text and a table, assert the table's grid maths, assert cell hit-testing
resolves to the right slot, assert zooming does not change document
coordinates, preview on/off, undo/redo, reload the template, then download all
five original formats and check their contents — the SVG has no `<image>`, the PDF
starts with `%PDF`, the DOCX is a real OOXML zip, the PNG has the right magic
bytes. A separate case downloads the HTML Document and checks it is a
self-contained inert page: it starts with `<!DOCTYPE html>`, contains no
`<script>`, no `<link>`, no `@import` and no remote reference, and carries a
`data-template-hash` and an `@page` rule.

A second suite covers pane navigation against a purpose-built 794 x 2600
fixture: the loaded bill is fitted to the pane, a fitted long page is entirely
visible without scrolling, zooming in lets the view reach the bottom of the
page, panning never goes past the image edge, a plain wheel zooms under the
cursor while preserving the scene point beneath it, and the pane refits on
resize until the user picks a zoom.

A third suite covers the page/image binding (the page adopts the image's exact
shape; loading a differently-sized template re-binds the image instead of
detaching it) and table editing (dialog values can be cleared and retyped, grid
size accepts a retyped value, all eight handles keep the table's top-left pinned
while every column holds its share of the new total, and the table's paint
origin matches Fabric's centred origin).

A fourth suite covers the `/render` pipeline: saving the template to the local
library, deriving the placeholder form from it, filling in sample data,
previewing the live HTML, and downloading a filled PDF and a self-contained
HTML document.

Wheel behaviour is asserted with synthetic events, because Playwright's
`mouse.wheel()` does not deliver a DOM wheel event to the page in this headless
setup (a capture-phase listener on the canvas never fires). The handler is the
same either way: it zooms at the cursor and always calls `preventDefault`, so
Ctrl+wheel cannot trigger the browser's page-zoom.

---

## Navigating the pane

The canvas stage no longer scrolls at all. The canvas element fills the pane,
and panning plus zoom are a single affine viewport transform owned by the
Fabric canvas:

| Input | Action |
| --- | --- |
| **Wheel** (plain or Ctrl/⌘) | Zooms about the pointer, clamped to `MAX_ZOOM` and to never zooming out past the fitted page. `preventDefault` always runs, so Ctrl+wheel never page-zooms. |
| **Space + drag**, **Alt + drag**, **middle-drag** | Pans by translating the viewport, clamped so the page edge cannot leave the pane. |
| **Fit** button | The view that shows the whole page with the editor's 24 px margin and clears any pan offset. |
| `+` / `−` / `100%` | Zoom in, out, and re-fit (`100%` zooms toward the pane centre; `Fit` is the unprefixed reset). |

Loading a bill fits it to the pane automatically. The pane also refits when it
resizes, until you choose a zoom level yourself — after that your zoom is
respected and never yanked away by a window resize.

## The page and the image are bound together

The loaded bill **is** the page. Its natural size becomes the document size, and
the image is always re-fitted to cover `0,0 -> document.width x document.height`.
Whenever the page changes — opening a bill, loading a template with a different
page size, or starting a blank document — the image is re-bound rather than
left at its own size, so the canvas and the image can never drift apart. Zoom
only changes the view: document coordinates and the page boundary are
unaffected, so the traced template stays registered to the image at any zoom.

## Resizing a table

A table's shape is **real geometry, not a scale factor**. `colWidths` and
`rowHeights` are the authoritative layout, `width` and `height` are their sums
(every path that changes the grid re-derives them, including the generic
Width/Height fields in the properties panel, which route through the same
resize call rather than setting `width` directly), and `scaleX`/`scaleY` are held
at 1. That is what keeps the grid exact in the JSON, SVG and PDF exports — JSON
stores the real widths, and SVG and PDF draw the gridlines at them — and it is why
a resize has to be expressed as new widths rather than as a scale. DOCX carries
those same numbers as native Word column widths and row heights, subject to the
flow-approximation caveat described above.

- **Drag any of the eight scale handles** — the four corners and the four edge
  midpoints. Every one of them resizes *away from a pinned top-left*, as long as
  the table is not rotated: `left` and `top` are captured when the handle is
  grabbed and re-asserted on every pointer-move, so the top-left corner never
  moves. The table is always the region right and below that corner — it can grow
  or shrink, but its origin cannot move. Which way you pull does not matter —
  dragging the top-left handle up and left grows the table just as dragging the
  bottom-right handle down and right does.
- **Every column and row keeps its share of its own axis.** Each axis is resized
  from a target derived independently, and the new total for that axis is
  distributed across the existing sizes with the rounding remainder handed to
  whichever entries lost most to flooring, so no single column absorbs the
  leftover pixel and the proportions survive as closely as integers allow. A
  column cannot go below 8px, nor a row below 8px, so a drag cannot collapse
  the grid. Columns get one factor and rows another, so the two axes are not
  forced to move together; an edge handle drives one axis and holds the other.
- **Or set values numerically** in the properties panel, one column or row at a
  time.

The drag path and the numeric path both leave `left`/`top` untouched and keep
`scaleX`/`scaleY` at 1.

## Dialogs

Grid settings and the table-size prompt are modals. Every numeric input in the
app keeps a text draft while focused, so backspacing the last digit does not snap
the old value back and `12` after `3` produces `12` rather than `312`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` `L` `R` `C` `P` `T` `G` `I` | Select, Line, Rectangle, Ellipse, Polygon, Text, Table, Image Placeholder |
| `H` / `E` | Horizontal Rule, Freehand |
| `Delete` / `Backspace` | Delete selection |
| `Enter` | Close a polygon; confirm a table at the default 3 × 3 |
| `Escape` | Cancel the polygon or the table prompt |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | Undo / redo |
| `Ctrl/Cmd + D` | Duplicate selection |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + S` | Save template JSON |
| **Wheel** | Zooms, anchored at the cursor (the pane itself never scrolls) |
| `Space` + drag / `Alt` + drag / middle-drag | Pans by translating the view |

Shortcuts are suppressed while typing in a field or editing text.

---

## The /render page: filling a template with real data

`/` is the editor. `/render` turns a saved template into data-bound output:

1. On `/render`, pick a template from the local library (or upload a `.json`
   file, or use the template you were editing via **Fill & Render →** in the
   editor's top bar).
2. The page derives a form from the template: every `{{token}}` found in a
   text box or a table cell, plus every image slot
   (`image-placeholder`, keyed by its role: logo, signature, qr…). Field
   types are inferred from the key — dates, amounts, quantities and text.
3. Fill the form (or click **Fill sample data**).  The preview iframe
   re-renders on every keystroke, and the **Download PDF**, **Download
   HTML** and **Print** buttons all come from the same `fillTemplate`
   snapshot, so what you see is what you print.

The template itself still only holds *structure and placeholders*; values
leave the form and produce a new object every time you render.

---

## Zooming and the reference image are one surface

The Fabric canvas fills its pane and the reference image is `canvas.backgroundImage`,
not a scene object. Fabric renders the background through the same viewport
transform as every object, so a wheel zoom or a drag pan moves the paper, the
reference image and your traced layers as a single affine surface, pinned
inside the image's edges. Panning is clamped so the page edge can never be
scrolled past, and zoom is a pure cursor-anchored `zoomAbout` from
`lib/canvas/viewport.ts`, with no DOM-scroll to Fabric-zoom state to fight.

---

## Known limitations

- **The reference image is not saved.** By design (§29 of the brief), so
  reopening a template shows the structure only. Re-attach an image with
  Open Bill.
- **Grouping is not a real Fabric group.** Because Fabric 7 groups cannot hold
  an exact layout, `parentId` on children records membership instead, and
  Ungroup is not offered. Grouping is otherwise a documented no-op in the
  properties panel.
- **DOCX is a flow approximation**, as described above. Vertical rules become
  right-bordered spacers and rectangles become bordered paragraphs.
- **Per-column table resizing by dragging** is not implemented; a handle drag
  rescales every column proportionally and every row proportionally, each axis
  taking its own factor from its own target size. Set individual widths and
  heights numerically in the properties panel.
- **A rotated table resizes the axis you are not dragging.** The per-axis
  direction comes from half-plane-testing the pointer against the table's
  *unrotated* centre, and each target size is the pointer's travel in document
  units, so the handle you grab does not select the axis that follows it once the
  table is rotated.
  This is a regression from before proportional resizing, where the factor came
  from Fabric in the object's own frame and so at least resized the dragged axis.
  Rotating is available in the properties panel, so treat a rotated table as
  unsupported for handle drags.
- **Shift + drag on an edge handle does nothing.** Fabric's `altActionKey` is
  `shiftKey`, so Shift turns the four edge midpoints into *skew* handles and
  `object:scaling` never fires. A table can express neither skew nor a scale, and
  skew is not saved, so the drag is refused outright rather than shearing a table
  that would come back un-sheared on reload. The four corners are unaffected, but
  Shift does change them: they then take the axis branch too, so the two axes are
  derived independently instead of being locked to one proportional factor.
- **Text vertical alignment** is stored but not yet honoured on canvas or in
  exports.
- **Persistence is only local.** Named templates live in `localStorage` for
  `/render`, and the editor handoff uses `sessionStorage`. There is no
  autosave, no project directory, and no cloud sync. Multiple line items in a
  table are handled as repeated rows by the future renderer; the editor models
  one grid.
- **Freehand paths are opaque outlines**, not editable strokes, and export as
  filled vector paths.
- **The blank editor export ships no values.** The editor exports templates
  directly, so `Export → HTML Document` prints `{{placeholders}}` literally.
  Use `/render` (via **Fill & Render →**) to bind values and produce the
  filled preview, PDF and HTML in one pass.
- **The HTML export cannot clear text overflow itself.** Cells clip
  (`overflow: hidden`) rather than shrink or ellipsise, because a document that
  silently shortens a bill is worse than one that clips it.
- **Exported SVG/PDF text is not outlined or font-embedded**, so unusual fonts
  may substitute in other viewers. The same applies to the HTML export: layout is
  identical everywhere, glyph *shapes* depend on the fonts the reader has.
- The E2E test covers one shape of template; the freehand, polygon and
  image-placeholder tools are not exercised by it.
