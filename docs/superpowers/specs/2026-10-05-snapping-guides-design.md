# Snapping Guides — Design

Editing-app snapping: lines drawn with the rule tools snap to nearby geometry
(other objects' edges and centres), moving an object snaps its edges and
centres the same way, and thin blue guide lines announce the alignment while it
happens. Drawn across a shape, a rule becomes a full-span divider.

The template format, the renderer, and everything the work on grouping and
wrapping added stay exactly as they are. The document is unchanged by
snapping — merely composed from more deliberately placed parts.

## Why it exists

The author asked for Instagram-style behaviour: while laying out boxes and
rules, the editor should show a "this line is level with that one" indication.
Without it, a 4×3 grid has to be laid out by eye and by pixel-counting.

## The model

One new pure module, `lib/canvas/snap.ts`, holding all the math and nothing
Fabric-specific, so it stays unit-testable in the node environment like
`lib/canvas/groups.ts`.

```ts
/** A perpendicular level another object exposes. */
export interface SnapLevels {
  x: number[]; // vertical levels: left, centreX, right
  y: number[]; // horizontal levels: top, centreY, bottom
}

export interface SnapLine {
  axis: "x" | "y"; // 'y' = a horizontal line at this y, and vice versa
  pos: number;
}

export interface SnapResult {
  dx: number; // correction to apply to left
  dy: number; // correction to apply to top
  guides: SnapLine[];
}

/**
 * Snap the moving edges to the nearest candidate levels, within tolerance.
 * Independent per axis: a corner can catch a level on each axis at once, which
 * yields two guides.
 */
export function snapEdges(movingEdges: { left: number; right: number; centreX: number; top: number; bottom: number; centreY: number }, candidates: SnapLevels, tolerance: number): SnapResult;

/** Collect levels from a set of scene bounds, each object's own edges and centres. */
export function levelsFromBounds(bounds: Array<{ left: number; top: number; right: number; bottom: number }>): SnapLevels;
```

### Candidates

Levels come from every object relevant to the interaction — every case below
uses `getBoundingRect()`, which already returns scene coordinates (confirmed at
`EditorController.ts:1732`):

| interaction | excludes | includes |
|---|---|---|
| drawing a rule | the line being drawn | everything else |
| moving an object | the moving object | everything else |
| resizing an object | the resizing object | everything else, incl. the tables it may resist |

Rules contribute only their axis level: an `hr` yields one y level, a `vr` one x
level. Text, fields, images and tables all contribute their edges and centres.

`BillTable` is special: it is a snap *target* but its edges are never used to
force its own geometry, because tables resize column-wise and scaling them
dounds them irregularly.

## Drawing a rule

`drawOrigin` is the scene coordinate of `mouse:down`, already captured today.

### Full-span divider

If `drawOrigin` lies inside the bounds of a `rect` or `rounded-rect`, pick the
innermost such shape. The dominant axis of the drag decides the rule kind:

- horizontal-leaning drag → a horizontal rule spanning `shape.left → shape.right`
  at `drawOrigin.y`;
- vertical-leaning drag → a vertical rule spanning `shape.top → shape.bottom` at
  `drawOrigin.x`.

This directly serves "split a long box into two parts": you never have to land
the endpoints precisely on the border. "Dominant axis" starts once the drag has
moved roughly 4 screen px in either direction, and can switch with the pointer,
so the rule kind follows the cursor — it stays what it was on mouse-up.

### Free rule with endpoint snap

If `drawOrigin` is not inside a rect, the rule is free, but its live endpoint
snaps to the candidate levels as the pointer moves; the snapped level becomes a
visible guide. Both axes snap independently, so a point that catches two levels
at once snaps diagonally and shows two guides.

Outside everything, with no nearby target, the result is exactly today's rule.

## Moving an object

On `object:moving`, run `snapEdges` against all other objects. Apply the
correction (`target.left += dx`, `target.top += dy`) only if the best match on
an axis lies within tolerance, and record each matched level as an active guide.
Tables are exempt from being moved-snapped — their top-left must not be
nudged by half a stroke while the user refines their grid.

## Resizing an object

On `object:scaling`, **guides only**, decided up front: scaling is where Fabric
mouse math is most delicate (the centred-scale Alt gesture, the table special-case),
and forcing a correction into it would interact badly with both. While a
scalable object is scaled, its bounding-box edges are still compared against
candidate levels and matching levels appear as guides — so the user still gets
the Instagram indication — but the object's geometry is not adjusted by snap.
`BillTable` already drives its own exact resize in this handler; unchanged.

## The guide layer

`EditorState.snaps: SnapLine[]` — default `[]`, updated on each drawing/move/
scaling `mouse:move`, cleared on `mouse:up`, on tool change, and when the
pointer leaves the canvas.

`CanvasStage` maps each entry to one hairline absolutely positioned inside its
existing `pointer-events-none absolute inset-0` overlay:

- an `axis: "y"` snap paints a **full-pane-width** 1px line at
  `sceneToScreen({x:0, y:pos}).y`;
- an `axis: "x"` snap paints a **full-pane-height** 1px line at
  `sceneToScreen({x:pos, y:0}).x`.

Colour `#2563eb` at 50% alpha, `z-index` above the page ring, `pointer-events:
none`. Nothing is drawn through Fabric's top context, so selection handles and transient guides are cleanly separated. Cleared on mouse-up, so a guide can never end up
in a screenshot or an export.

## State and controls

- `EditorState.snapToObjects: boolean` — default `true`.
- `setSnapToObjects(on: boolean)` on the controller; exposed as a new
  **Snap to objects** checkbox in the Grid settings dialog, default on, separate
  from **Snap to grid** (`snapToGrid`, unchanged semantics).
- Tolerance: `6 / zoom` scene px, i.e. a roughly constant screen distance at
  every zoom level.

## What this feature is not

- Not a change to how templates, rendering, grouping, wrapping, or any export
  path consumes rules.
- Not a second grid. The guide lines are feedback, not layout: they do not
  persist, are not selectable, and are not in the template.
- Not replacements for selection-based alignment (`align`, `distribute` in
  `MultiSelectPanel`): those align an existing selection in one shot; guides
  help build that selection deliberately.

## Testing

- `tests/snap.test.ts`: both axes snap independently; nearest match wins;
  beyond-tolerance cascades produce no offset; no candidates → no offset and no
  guides; a corner match yields exactly two guides.
- `e2e/workflow.spec.ts`:
  - a horizontal rule dragged inside a rect spans that rect's full width;
  - a rect dragged near a sibling's edge shows a guide and lands aligned;
  - scaling a rect shows guides but the table special-case and Alt-centred
    scaling are untouched;
  - the existing e2e around snapping to grid and the table resize coordinates
    stays green.
- Full gate: `tsc --noEmit`, unit suite, E2E suite, lint, build — all clean.
