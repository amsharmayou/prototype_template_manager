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
  "meta": { "name": "acme-invoice", "modifiedAt": "2026-01-15T…" },
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
      ExportMenu.tsx             JSON, SVG, PDF, DOCX, PNG
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
tests/                           Vitest: geometry, placeholders, serialize, history
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
npm test        # 66 unit tests over the pure layer
npm run test:e2e
```

Unit tests cover what a `<canvas>` cannot be meaningfully tested for in jsdom:
table geometry and hit testing, placeholder parsing, the serialiser contract
(including that a reference image can never appear, and that unknown Fabric
types are skipped), and the history stack.

The E2E test drives the real browser through the full workflow: upload a local
bill, verify the reference is a non-selectable 25%-opacity image, trace borders,
rules, text and a table, assert the table's grid maths, assert cell hit-testing
resolves to the right slot, assert zooming does not change document
coordinates, preview on/off, undo/redo, reload the template, then download all
five formats and check their contents — the SVG has no `<image>`, the PDF starts
with `%PDF`, the DOCX is a real OOXML zip, the PNG has the right magic bytes.

A second suite covers pane navigation against a purpose-built 794 x 2600
fixture: the loaded bill is fitted to the pane, a fitted long page needs no
scrolling, zooming in makes the stage scrollable to the very bottom, scrolling
cannot pass the image edge, the wheel scrolls without changing zoom while
Ctrl+wheel zooms, drag-panning works in both directions without offsetting the
page inside the canvas, and the pane refits on resize until the user picks a
zoom.

A third suite covers the page/image binding (the page adopts the image's exact
shape; loading a differently-sized template re-binds the image instead of
detaching it) and table editing (dialog values can be cleared and retyped, grid
size accepts a retyped value, column and row resizes never move the table's
top-left, corner and edge handles resize the grid right and down only, and the
table's paint origin matches Fabric's centred origin).

Wheel behaviour is asserted with synthetic events, because Playwright's
`mouse.wheel()` does not deliver a DOM wheel event to the page in this headless
setup (a capture-phase listener on the canvas never fires). The handler is the
same either way, and the test additionally asserts that a plain wheel does
*not* call `preventDefault`, which is what lets the real browser scroll
natively.

---

## Navigating the pane

The canvas stage is a **native scroll container**. The canvas element is sized
to `document × zoom`, so:

- a page smaller than the pane is centred with a margin;
- a page larger than the pane scrolls, in both axes, with normal scrollbars and
  trackpad momentum.

| Input | Action |
| --- | --- |
| **Scroll wheel** | Scrolls the pane. Never zooms. |
| **Ctrl/⌘ + wheel** | Zooms about the pointer. `preventDefault` stops the browser page-zooming. |
| **Space + drag**, **Alt + drag**, **middle-drag** | Pans by scrolling the pane. |
| **Fit** button | Scales so the whole page is visible and clears any pan offset. |
| `+` / `−` / `100%` | Zoom in, out, reset. |

Loading a bill fits it to the pane automatically. The pane also refits when it
resizes, until you choose a zoom level yourself — after that your zoom is
respected and never yanked away by a window resize.

The page is the boundary: it is only inset with a margin while it fits, so
scrolling can never reveal empty space beyond the image's edge in either
direction.

## The page and the image are bound together

The loaded bill **is** the page. Its natural size becomes the document size, and
the image is always re-fitted to cover `0,0 -> document.width x document.height`.
Whenever the page changes — opening a bill, loading a template with a different
page size, or starting a blank document — the image is re-bound rather than
left at its own size, so the canvas and the image can never drift apart. Zoom
only changes the view: document coordinates and the page boundary are
unaffected, so the traced template stays registered to the image at any zoom.

## Resizing a table

Tables are resized by **changing column widths and row heights**, never by
scaling, which keeps the grid exact and exportable. The top-left corner is
always pinned, so a table only ever grows right and down:

- drag any corner or edge handle, exactly like a rectangle;
- or set values numerically in the properties panel.

Both paths leave `left`/`top` untouched and keep `scaleX`/`scaleY` at 1.

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
| `Space` + drag | Pan · **Ctrl** + scroll to zoom · scroll to move |

Shortcuts are suppressed while typing in a field or editing text.

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
- **Per-column table resizing by dragging** is not implemented; widths are set
  numerically in the properties panel. Dragging a table's corner converts
  nothing because tables keep `scaleX = 1` — resize via the panel.
- **Text vertical alignment** is stored but not yet honoured on canvas or in
  exports.
- **No persistence beyond explicit Save/Load.** No autosave, no project
  directory. Multiple line items in a table are handled as repeated rows by the
  future renderer; the editor models one grid.
- **Freehand paths are opaque outlines**, not editable strokes, and export as
  filled vector paths.
- **Exported SVG/PDF text is not outlined or font-embedded**, so unusual fonts
  may substitute in other viewers.
- The E2E test covers one shape of template; the freehand, polygon and
  image-placeholder tools are not exercised by it.
