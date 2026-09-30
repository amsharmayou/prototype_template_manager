# Canvas / Image Unification and Proportional Table Resize

Date: 2026-09-30
Status: approved in chat, pending spec review

## Problem

Two defects were reported after the previous release.

**1. The reference image and the canvas still do not behave as one thing.** The
editing surface is currently a document-sized canvas element inside a scrollable
pane, wrapped in padding, a drop shadow and a ring, with the reference image
added as a locked Fabric *object* at the document origin. Consequences:

- Image and canvas read as two separate layers with visible boundaries between
  them (grey gutter, padding, shadow, border), not as one surface.
- Zoom does not feel like a gallery viewer. Zoom is opt-in via Ctrl+⌘+wheel
  only, and panning is implemented as DOM scrolling of the wrapper rather than
  as a view transform.
- The guarantee that the reference never reaches an export depends on
  convention: `tracedObjects()` filters objects whose `id === "__reference__"`.
  A single missed path would leak the bill into an export.

**2. Resizing a table with the on-canvas side handles distorts the columns.**
One column (typically the middle) balloons while the others barely move, instead
of the table growing in proportion.

## Goals

- The reference image is the canvas background, edge to edge, and zooms and
  pans as one surface with the canvas.
- Zoom behaves like a photo editor or gallery viewer: plain wheel zooms under the
  cursor, and the view can never be panned past the image's edge.
- The image is structurally incapable of being selected, moved, scaled,
  layered, serialised or exported.
- Table side-marker resizing is proportional, idempotent, and never moves the
  table's top-left corner.
- The template format, the JSON schema and every export are unchanged.

## Non-goals

- No change to the bill template format, the object model, or the four exporters.
- No new gestures beyond the ones described here.
- No blank-canvas mode changes; the no-reference path keeps working as today.

## Background: the Fabric fact this design rests on

Fabric 7 renders `canvas.backgroundImage` *through* the viewport transform.
`StaticCanvasDefaults.backgroundVpt` is `true`, and `renderAll` calls
`_renderBackground(ctx)` before applying the viewport transform to objects;
`_renderBackgroundOrOverlay` applies `ctx.transform(...vpt)` to the background
itself when `backgroundVpt` is set. A background image therefore scales and
translates with the scene exactly like a regular object, but is not an object.

Verified in `node_modules/fabric/dist/index.mjs` (`backgroundVpt: true` in
`staticCanvasDefaults`; `if (this.backgroundVpt) ctx.transform(...v);` in
`_renderBackgroundOrOverlay`).

## Architecture

### The view transform

The canvas element is sized to the **pane**, not the document. There is no
scroll container. The viewport transform becomes a full affine:

```
[zoom, 0, 0, zoom, tx, ty]
```

All view state is `(zoom, tx, ty)` alongside `pane` and `document`.

New pure module `lib/canvas/viewport.ts` owns the maths. It has no Fabric
dependency so it is directly unit-testable:

```ts
export function containScale(pane, doc): number
export function clampZoom(zoom, pane, doc): number
export function clampPan(t, paneSize, imgSize): number
export function sceneToScreen(point, view): { x, y }
export function screenToScene(point, view): { x, y }
export function zoomAbout(cursor, newZoom, view, pane, doc): { zoom, tx, ty }
```

Definitions:

- `containScale = min(pane.width / doc.width, pane.height / doc.height)`
- `clampZoom` bounds zoom to `[min(containScale, MAX_ZOOM), MAX_ZOOM]` with
  `MAX_ZOOM = 8`. The lower bound means the whole bill can never be zoomed out
  past. The `min` guards the degenerate case of a bill small enough that
  `containScale` exceeds the maximum. `MAX_ZOOM` is raised from the previous
  release's `4`.
- `clampPan(t, paneSize, imgSize)`:
  - if `imgSize >= paneSize`: `t = min(0, max(paneSize - imgSize, t))` — the
    image always covers the pane on this axis, so the visible window slides
    within `[paneSize - imgSize, 0]`.
  - else: `t = (paneSize - imgSize) / 2` — centred.
- `zoomAbout(cursor, newZoom, ...)` converts the cursor to a scene point, zooms,
  then re-derives the translation so that scene point stays under the cursor,
  then clamps both axes. The scene point under the cursor is invariant by
  construction.

`fit()` is `zoom = containScale` followed by clamping, which centres the loose
axis and pins the tight axis. It is both the initial view and the reset action;
the previous `resetZoom()` (which reset to 100%) is replaced by `fit()`.

`panBy(dx, dy)` adds a screen-space delta to `(tx, ty)` and re-clamps.

All five functions must be total: a non-finite `zoom`, a zero-sized document or
a non-finite translation returns the safe value (centred / identity) rather than
propagating `NaN` into the transform.

### The reference as background

New module `lib/canvas/referenceBackground.ts` owns the whole concern, extracted
out of `EditorController.ts` (already 1623 lines):

- `install(canvas, dataUrl, opacity)` — decodes the image, sets
  `document = { width: img.width, height: img.height }` (rounded), positions the
  image at the document rect, assigns it to `canvas.backgroundImage`, and sets
  `canvas.backgroundColor` to the sampled border colour.
- `sampleBorderColor(img)` — draws the image into a small offscreen canvas
  (capped at 32px on the long edge, aspect preserved), reads the 1px outer
  ring and averages it. Wrapped in `try/catch`; returns `#ffffff` on failure
  (for example a tainted canvas). For a scanned bill on white this yields
  white, so the seam where the pane is larger than the bill is invisible.
- `setVisible(canvas, image, visible)` — sets `canvas.backgroundImage` to the
  image or to `null`. The decoded image is cached by the controller, so
  toggling back is free. (Nulling the field rather than setting
  `visible = false` avoids depending on how Fabric treats an invisible
  background.)
- `setOpacity(image, value)` — sets `image.opacity`.
- `fitTo(image, doc)` — re-stretches the image over a changed document rect by
  setting its `scaleX`/`scaleY` from the image's natural size. This replaces
  `lockReferenceToDocument()`. It is required because `loadTemplate` and
  `restoreSnapshot` (undo/redo) set `document` from the template, and a
  template saved from a *different* bill declares a different page size. At
  install time `document` is the image's own size, so `fitTo` is the identity;
  after loading a foreign template it stretches the bill to that template's
  page, which is the behaviour the existing
  `loading a template re-binds the image instead of detaching it` E2E test
  asserts. Deleting this step outright would break that test and leave the
  background and the page disagreeing.
- `remove(canvas)` — clears the background and restores
  `backgroundColor = ""`.

Because the reference is no longer a Fabric object:

- `REFERENCE_ID`, `isReference()`, and the `__reference__` filter in
  `tracedObjects()` are deleted. `tracedObjects()` becomes
  `canvas.getObjects()`.
- Layer ordering, `selectAll`, `deleteSelection`, `duplicateSelection`,
  `align`, `distribute` and `moveLayer` lose their reference special-cases.
- `setReferenceLocked` and the Lock toggle in `ReferencePanel.tsx` are removed;
  a background cannot be unlocked. Visibility and opacity remain.
- `setReferenceVisible` and `setReferenceOpacity` are replaced by the
  `referenceBackground` equivalents. The `REFERENCE_ID` sentinel, the
  `__reference__` tag written onto the image, and the locking boilerplate
  (`lockMovementX`, `hasControls`, …) are all deleted.

Exports are unaffected. `renderTemplate` builds a fresh `StaticCanvas` from the
`BillTemplate` alone, and the document size is still the image's size, so all
four exports produce byte-identical structure to today.

### Stage

`components/editor/CanvasStage.tsx`:

- The outer `div` is no longer `overflow-auto` and has no scrollable child. The
  canvas fills it.
- The grid overlay is a sibling layer positioned exactly over the canvas, with
  `backgroundSize: grid*zoom` and `backgroundPosition: tx, ty`, so the grid
  tracks the view.
- Drag-to-pan keeps its pointer capture on the stage (so Fabric never sees the
  gesture and never starts a selection) but delegates to
  `controller.panBy(-dx, -dy)` instead of mutating `scrollLeft`/`scrollTop`.
- The inline cell editor is positioned through
  `controller.projectToScreen(sceneX, sceneY)` instead of
  `canvasRect + scene * zoom`, because the transform now has a translation.

### No-reference path

`document` still defaults to A4. With no image, `backgroundImage` is `null` and
`backgroundColor` is `""`, so the page is white. The clamp and `fit()` operate
on the A4 document rect unchanged.

## Table side-marker resizing

### Root cause

`EditorController.onObjectScaling` currently does:

```
factorX = table.scaleX;  factorY = table.scaleY
table.scaleColumns(factorX); table.scaleRows(factorY)
table.set({ scaleX: 1, scaleY: 1 })
```

`scaleColWidths` is itself correctly proportional, so it is not the culprit. The
bug is that Fabric computes `scaleX` relative to the object's size captured at
**drag start**, while the handler applies the factor to the table's **current**
widths and then resets `scaleX` to 1. Every `object:scaling` event therefore
compounds: after *n* events the grid is `start × factorⁿ`. A fast drag
overshoots, the pointer catches up, and the table oscillates. `scaleColWidths`
then dumps the accumulated rounding remainder into whichever column is widest,
which is why one column — the one that has been fed the most excess — appears
extreme.

### Fix

Stop reading `scaleX`/`scaleY` entirely. Derive the target size from the pointer
instead, and always resolve from a snapshot taken at gesture start.

`BillTable` gains:

```ts
beginResizeGesture(startPointer: {x,y}, startWidth: number, startHeight: number,
                   anchor: {left, top}): void
resizeColumnsTo(targetWidth: number): void
resizeRowsTo(targetHeight: number): void
endResizeGesture(): void
```

The gesture record holds `colWidths`/`rowHeights` snapshots, the start totals,
the start pointer, and a `signX`/`signY` of `+1` or `-1` per axis. The sign is
`+1` when the pointer started in the right/bottom half of the table box and `-1`
when it started in the left/top half, so every handle resizes away from the
pinned top-left and no Fabric-internal handle identity is needed.

`resizeColumnsTo(target)` scales `snapshot × target` proportionally via
`scaleColWidths`, clamped so the total never drops below
`MIN_COL_WIDTH * columns`. With no active gesture it falls back to the live
widths, so the same method is safe to call from the properties panel.

Sign convention: `signX = +1` when the pointer started in the right half of the
table box, `-1` in the left half; likewise `signY` for the bottom half. A
pointer that started in the left half and moves further left therefore grows the
table, and moving it back right shrinks it.

`EditorController.onMouseDown` already captures `gestureAnchor` and receives
`opt.scenePoint`; it also starts the gesture when the target is a table. The
`object:scaling` payload is `{ target, transform, e }` and has no
`scenePoint`, so the handler derives one with `canvas.getScenePoint(opt.e)`. If
`opt.e` is absent the handler falls back to the previous event's scale, which
keeps the behaviour sane for synthetic events but is not the primary path.

`onObjectScaling` for a table becomes:

```
targetW = startWidth  + (pointer.x - startX) * signX
targetH = startHeight + (pointer.y - startY) * signY
table.set({ left: anchor.left, top: anchor.top })
table.resizeColumnsTo(targetW)
table.resizeRowsTo(targetH)
table.set({ scaleX: 1, scaleY: 1 })
```

Properties this gives us:

- **Idempotent** — the base is the snapshot, which never changes during the
  gesture, so applying the same target twice is a no-op. No compounding.
- **Proportional** — column ratios are preserved: a wide description column
  stays wide, narrow columns stay narrow.
- **Top-left pinned** — `left`/`top` are reassigned to the gesture anchor on
  every event.
- **Exact** — size comes from the pointer, not from Fabric's scaling internals,
  so it cannot drift from the visible handle.
- **Two axes at once** — both targets are derived from the same pointer before
  either axis is written, which is what the previous code had to special-case.

`object:modified` ends the gesture.

### Largest-remainder distribution

`scaleColWidths` / `scaleRowHeights` currently give the entire rounding
remainder to the single widest column. This is at most one pixel per column, but
it is a visible asymmetry in a hand-traced table. Both are changed to the
largest-remainder method: floor every size, then hand the leftover pixels to the
entries with the largest fractional parts, largest fraction first. Existing
tests in `tests/geometry.test.ts` that assert *which* column receives the pixel
are updated; assertions about totals and proportionality are unaffected.

This item is independent of the rest and can be cut without affecting the
reported defect.

## Data flow

Upload: `BillEditor` reads the file as a data URL, calls
`controller.addReference(dataUrl)`, which awaits canvas readiness, calls
`referenceBackground.install`, sets `document`, then `fit()`.

Zoom: wheel event -> `controller.zoomAbout(viewportPoint, newZoom)` -> clamp ->
`setViewportTransform` -> `setState({ zoom, pan })` -> React re-render of the
grid overlay and the cell editor.

Pan: stage pointermove -> `controller.panBy(-dx, -dy)` -> clamp ->
`setViewportTransform` -> `setState({ pan })` -> `requestRenderAll`.

`pan` lives in the editor state alongside `zoom`, because both the grid overlay
(`backgroundPosition`) and the cell editor need the translation. A pan therefore
re-renders React. This is accepted deliberately: one `setState` per pointermove
is well within budget for this tree, and keeping the translation in a single
source of truth is worth more than micro-optimising it.

Table resize: `mouse:down` -> `beginResizeGesture`; `object:scaling` ->
`resizeColumnsTo`/`resizeRowsTo` from the snapshot; `object:modified` ->
`endResizeGesture` + one history `commit`, as today.

## Error handling

- Image decode failure propagates through the existing upload path; unchanged.
- `sampleBorderColor` returns `#ffffff` on any throw, so a tainted or exotic
  image degrades to a white letterbox rather than breaking the editor.
- Viewport maths is total: non-finite zoom, zero or missing document dimensions
  and non-finite translations all resolve to a safe centred/identity state.
- `resizeColumnsTo` ignores a non-finite target and clamps to the minimum, so a
  degenerate pointer delta cannot collapse a column to zero or produce `NaN`.

## Testing

**New `tests/viewport.test.ts`** — `containScale`; `clampZoom` honours both
bounds; `clampPan` on both branches (zoomed in clamps to `[pane - img, 0]`,
zoomed out centres); `zoomAbout` leaves the scene point under the cursor
invariant; `fit` centres the loose axis and pins the tight axis; non-finite
inputs return safe values.

**`tests/geometry.test.ts`** — largest-remainder distribution: the total is
exact, no entry is below the minimum, and entries stay ordered by their
fractional parts.

**`tests/tableResize.test.ts`** (new) — gesture resize: applying the same target
twice is a no-op; ratios are preserved; the total clamps at
`MIN_COL_WIDTH * columns`; `left`/`top` are unchanged; both axes update
together from a single pointer move; a pointer that starts in the left half and
moves further left grows the table, and moving back right shrinks it.

**`e2e/workflow.spec.ts`** — the six "Pane navigation" tests are rewritten for
the new model:

1. the canvas element's size equals the pane's size;
2. plain wheel zooms (no Ctrl), and the zoom level increases;
3. the scene point under the cursor is unchanged across a zoom;
4. panning by drag stops exactly at the image edge in each direction;
5. zooming out past the whole bill re-centres rather than shrinking further;
6. the reference is a background: it is not selectable, does not appear in the
   layers panel, and an exported SVG contains no embedded raster.

The two existing resize tests are extended to all eight handles and to a
proportionality assertion (no column's share of the total changes by more than
one pixel of rounding).

## Files

New:
- `lib/canvas/viewport.ts`
- `lib/canvas/referenceBackground.ts`
- `tests/viewport.test.ts`
- `tests/tableResize.test.ts`
- `docs/superpowers/specs/2026-09-30-canvas-image-unification-design.md`

Modified:
- `lib/canvas/EditorController.ts` — pane-sized canvas, affine viewport,
  `zoomAbout`/`panBy`/`projectToScreen`, table gesture, reference delegation,
  removal of `REFERENCE_ID` and its special cases.
- `lib/canvas/objects/BillTable.ts` — gesture snapshot API.
- `lib/template/geometry.ts` — largest-remainder distribution.
- `components/editor/CanvasStage.tsx` — no scroll container, grid overlay offset
  by the translation, pan delegation, cell-editor projection.
- `components/editor/ReferencePanel.tsx` — remove the Lock toggle.
- `e2e/workflow.spec.ts` — rewrite navigation and resize tests.
- `tests/geometry.test.ts` — distribution expectations.
- `README.md` — navigation model, background reference, proportional resizing,
  and the `backgroundVpt` finding.

Unchanged on purpose:
- `lib/template/types.ts`, `serialise.ts`, `hydrate.ts`, `placeholders.ts`
- `lib/export/*` (all four exporters and `renderTemplate`)
- `lib/canvas/history.ts`, `fabricSetup.ts`
