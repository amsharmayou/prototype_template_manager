# Variable Layout — How It Works and How to Use It

**Audience:** anyone who traces a bill in the BillKit editor and wants the printed
bill to stay correct when a value is longer than the space drawn for it.

**What this document is:** a walk through what the feature does, where each option
lives, and what every control actually means. It describes the code as it is today,
not an aspiration.

**Companion documents:** `New_Expandable.md` (the plan this implements) and
`Expanding_Bill.md` (the earlier plan). Section 19 of `New_Expandable.md` records
what is deliberately *not* built.

---

## 1. The problem this solves

BillKit reproduces a traced bill exactly: every rectangle and field is painted at the
coordinates you drew. That is correct right up to the moment a value is longer than
the box traced for it. Then the text either spills past its frame, or is clipped, or
covers something below it — and every object below stays exactly where it was.

**Variable layout** lets the geometry respond to the content. You mark the objects
that may grow, draw **marking lines** where a boundary sits, and say which objects
follow which boundary. At render time the engine measures the real text, works out
how much room it needs, moves the boundaries that have to move, and re-places the
objects you connected. A value that fits produces the traced bill, byte for byte.

The governing idea:

> **The traced bill is the base. Content decides what grows. Only declared
> relationships move anything.**

---

## 2. The five things you can configure

Every option in the editor maps to one of five concepts. Learn these five and the
whole panel makes sense.

| Concept | What it answers | Where it lives on the object |
|---|---|---|
| **Expansion** | "How much may *this* box grow?" | Per axis: X and Y |
| **Marking line (guide)** | "Where is the boundary this content pushes?" | Template-level list |
| **Attachment** | "Which edge of that box follows that line?" | Per edge of an object |
| **Container** | "Should this rectangle grow around its children?" | On a rectangle |
| **Anchor** | "How does a child sit inside its growing parent?" | On a child object |

There is a sixth, template-wide: the **document policy** — whether the page itself
grows.

---

## 3. The engine, in order

Everything happens in this order, every time a value changes
(`lib/render/index.ts`):

```
1. Parse and validate the template
2. Fill every {{placeholder}} with its value
3. Calculate computed values (totals, etc.)
4. Expand repeating table bands into rows
5. Recompute variable-height table rows from measured cells
6. Measure every growing text box in a real browser
7. ── layout pass ──
8. Sort objects by z-index
9. Paint HTML
```

Step 7 is the layout pass (`lib/render/layout.ts`), which internally runs:

```
a. Read every object's authored (base) geometry
b. Allocate each measured object's X and Y size from its growth policy
c. Work out which boundaries the content pushes, and by how much
d. Move each boundary — by the largest single demand, capped
e. Bound content by the boundary that was moved for it
f. Apply attachments: edges follow their boundary
g. Grow shapes linked to a boundary
h. Grow containers around their children, and resolve anchors
i. Grow the page if the document policy says so
j. Collect diagnostics for anything that did not fit
```

Two rules make step 7 safe:

- **Base geometry is never overwritten.** Each render starts from the traced
  positions. Filling a shorter value shrinks the bill back; the bill never
  accumulates growth across renders.
- **Nothing moves without a declared rule.** An object that merely crosses a
  marking line is untouched.

---

## 4. Where the options are, step by step

### 4.1 Turn variable layout on

Drawing a marking line turns it on automatically: the template gains a `layout`
block with `"mode": "variable"`. Without that block the renderer paints the traced
geometry, exactly as it always did.

A template with no `layout` block is unaffected. This is why old bills keep working.

### 4.2 Draw a marking line (guide)

**Tool rail → `─` (Guide H)** for a horizontal line, **`│` (Guide V)** for a
vertical one. Click where you want it. (These two have no keyboard shortcut — they
are the only tools on the rail without one.)

- The line spans the whole page, because a boundary is not artwork — it is a rule
  the bill is allowed to push.
- It is drawn dashed blue in the editor and **never appears** in the rendered bill,
  the PDF, the print output, or a shared link.
- You can drag it to reposition, and press <kbd>Delete</kbd> to remove it.

**Orientation decides what it controls**, and this is the one thing worth memorising:

| Guide | Stores a… | Moves in… | Controls edges |
|---|---|---|---|
| Horizontal `─` | y-coordinate | down / up | `top`, `bottom` |
| Vertical `│` | x-coordinate | right / left | `left`, `right` |

A vertical guide can only move `left`/`right` edges. If you try to attach a
`bottom` edge to a vertical guide, validation refuses it when you save — it is a
mistake worth surfacing rather than silently ignoring.

### 4.3 Let a field grow

Select a text or field object. The **"Variable layout — growth"** panel appears.

**For each axis independently (Vertical growth, Horizontal growth):**

| Option | Meaning |
|---|---|
| `Fixed size` | This axis never grows. If content does not fit, you get a warning. |
| `Expand as needed` | Grows to whatever the content needs, limited only by the page or a boundary. |
| `Expand, with a limit` | Grows by at most the "Maximum extra" you type. |

**"Maximum extra"** appears only for *Expand, with a limit*. It is **additional
growth beyond the current size**, not a total size. A 100px field with a limit of
40 ends at 140px. If you later resize the field to 200px, the limit still means
"+40" — the number you typed keeps its meaning.

**"Text layout"** (shown whenever an axis is not fixed):

| Option | Meaning |
|---|---|
| `Default` | No rule stated. Wrapping follows the renderer's own behaviour. |
| `Wrap within width` | Text breaks across lines at the box width. The usual choice for an address. |
| `Keep on one line` | Text prefers one line. With *Expand horizontally* it widens instead. |

**"Vertical pushes guide" / "Horizontal pushes guide"** links this axis to a
marking line — the boundary that moves when this content outgrows its box. The
selector only offers guides of the correct orientation, so you cannot pick a
mismatched one. `No guide — grow in place` means this box grows and nothing else
is obliged to move.

Typical settings:

| Object | X | Y |
|---|---|---|
| Address | Fixed size | Expand as needed, wrap |
| Company name | Expand with limit | Expand with limit |
| Invoice number | Fixed size | Fixed size |

### 4.4 Connect a boundary to an object

Still in the same selection, **"Variable layout — attachments"** appears. It lists
one control per edge (top, bottom, left, right — filtered to the edges a guide of
the matching orientation can control).

For each edge:

1. **Which guide** — `Not attached`, or a guide from the list.
2. **How it follows** (appears once attached):
   - **`Move with guide`** — the object keeps its size and shifts with the boundary.
   - **`Stretch with guide`** — the attached edge follows the boundary and the
     opposite edge stays where you drew it, so the object resizes.

**An edge drawn *on* the line behaves differently from one drawn clear of it, and
this is intentional:**

- Drawn **on** the line: the edge *is* the boundary. It travels with it.
- Drawn **clear** of the line: the edge keeps the margin you drew and moves by the
  same amount the boundary moved. A row of boxes 12px below a line stays 12px below
  it after the line moves down.

A guide that has **not moved changes nothing** — a short value renders your traced
bill exactly as drawn, with no snapping, no drifting, no surprises.

### 4.5 Make a rectangle a container

Select a rectangle. **"Variable layout — container"** panel.

| Control | Meaning |
|---|---|
| `Layout parent` | For a child: which container it belongs to. `No parent` by default. Distinct from editor groups. |
| `Horizontal anchor` / `Vertical anchor` | For a child: how it sits inside its growing parent. See below. |
| `Container` | For a rectangle: `Plain frame` (decoration) or `Layout container` (grows around its children). |
| `Horizontal container` / `Vertical container` | `Grow around children`, or `Fixed size` (reports overflow instead). |
| `Inside padding (px)` | The gap the frame keeps around its children when it grows. |
| `Size limits (px)` | `Min width`, `Min height`, `Max width`, `Max height`. Blank means no limit. |

**Membership is explicit.** A child belongs to a container only because you
selected it in `Layout parent`. Two objects that merely overlap are not related,
and a plain rectangle never grows unexpectedly.

**Size limits:** a frame that stops at its maximum reports the child that no
longer fits, naming the box and the limit — it never silently truncates.

### 4.6 Anchor a child inside its parent

Set `Layout parent` on a child and two anchor dropdowns appear.

| Anchor | Meaning |
|---|---|
| `Keep top/left offset` | Stays exactly where you drew it. Does not move when the parent grows. |
| `Keep bottom/right inset` | Keeps its distance from the parent's bottom/right edge, so it travels down as the parent grows. **This is the one for a footer label.** |
| `Stretch with parent` | Keeps its inset from both sides and resizes with the parent. |

The inset is the gap you drew, measured from the parent. A label 20px above the
parent's bottom stays 20px above it however far the parent grows.

### 4.7 Control the page

The **"Variable layout — page"** panel is template-wide.

| Control | Meaning |
|---|---|
| `Horizontal page` / `Vertical page` | `Fixed page` (keep the traced sheet, report what does not fit) or `Let page grow`. |
| `Max page width` / `Max page height` | Hard ceilings. Blank means no explicit cap. |
| `Sibling overlap` | `Report overlap` (default: keep geometry, add a warning) or `Allow overlap` (stay silent — for deliberate overlays). |

The page is **not** the same thing as an outer rectangle. A bill may have a frame
inside a larger sheet, or none at all. You set both policies independently.

---

## 5. A worked example

This is the scenario the feature was built for, and it is the one in
`outputs/Variable_Test.json`.

**Goal:** an address field that can grow taller; the frame around it grows to
keep it inside; a box below shifts down; a short address prints the traced bill.

**Set-up:**

1. **Draw a horizontal marking line** just under the address field. Call it
   `guide-1`.
2. **Select the address field.** Set Vertical growth = `Expand as needed`, Text
   layout = `Wrap within width`, and `Vertical pushes guide` = `guide-1`.
3. **Select the frame around the field.** Container = `Layout container`,
   Vertical container = `Grow around children`, Inside padding = whatever margin
   you drew. Then select the field and set its `Layout parent` to that frame.
4. **Select the box below.** Attach its `Top edge` to `guide-1`, How it follows =
   `Move with guide`.
5. **Page panel:** Vertical page = `Let page grow` if the bill may get taller than
   the traced sheet.

**What happens at render time:**

- A short address fits its box. Nothing needs more room, so the guide does not move
  and no geometry changes. The bill is the traced design.
- A long address wraps to more lines. The field grows. The frame grows around it,
  keeping its padding. The footer, anchored to the frame's bottom, travels down
  with it, holding its own height. If the content now runs past the sheet, the
  page grows too.
- A pathologically long address hits a cap — the guide's `Max travel`, the frame's
  `Max height`, or the page's `Max page height`. It stops and tells you, naming the
  field, the box or the boundary that ran out.

A note on what "grows" means: a frame grows only to contain what is inside it. If
the field is still within the frame's traced height, the frame does not move — there
is nothing to make room for. The document as a whole still renders correctly, and
the boundary only travels when something genuinely crosses it.

---

## 6. The JSON

Everything the panels do is stored in `template.json`, so a saved template carries
its own rules.

```json
{
  "templateVersion": 2,
  "document": { "width": 1127, "height": 871 },
  "objects": [
    {
      "id": "frame",
      "type": "rect",
      "x": 40, "y": 100, "width": 700, "height": 220,
      "container": {
        "enabled": true,
        "growthX": "fixed",
        "growthY": "content",
        "padding": { "top": 0, "right": 0, "bottom": 16, "left": 0 },
        "maxHeight": 800
      }
    },
    {
      "id": "address",
      "type": "field",
      "key": "address",
      "text": "{{address}}",
      "x": 60, "y": 120, "width": 300, "height": 60,
      "layoutParentId": "frame",
      "anchor": { "vertical": "start" },
      "expansion": {
        "x": { "mode": "fixed" },
        "y": { "mode": "unbounded", "strategy": "wrap", "growthGuideId": "guide-1" }
      }
    },
    {
      "id": "footer",
      "type": "rect",
      "x": 40, "y": 340, "width": 700, "height": 80,
      "layoutParentId": "frame",
      "anchor": { "vertical": "end", "bottomOffset": 0 }
    }
  ],
  "layout": {
    "mode": "variable",
    "document": { "growthX": "fixed", "growthY": "expand" },
    "collision": "report",
    "guides": [
      { "id": "guide-1", "orientation": "horizontal", "position": 320, "maxDisplacement": 600 }
    ],
    "attachments": [
      { "id": "att-1", "objectId": "footer", "edge": "top", "guideId": "guide-1", "behavior": "move" }
    ]
  }
}
```

Notes on the schema:

- `maxGrowth` is a **delta**, never an absolute size.
- `position` is a y for a horizontal guide, an x for a vertical one.
- `layoutParentId` is separate from `parentId` (which is editor grouping).
- The whole `layout` block is optional. Absent means the traced bill renders
  unchanged.

---

## 7. How the measurement works

Text width and height depend on the font engine, so they cannot be computed in
the pure renderer. The split is:

| Piece | File | Role |
|---|---|---|
| **Plan** | `lib/billkit/bridge.ts` | Decides *what* to measure, with text already filled in. Pure. |
| **Measurer** | `lib/billkit/measure-dom.ts` | Runs the plan against the real font engine in a hidden element. The only file allowed to touch the DOM. |
| **Solver** | `lib/render/layout.ts` | Takes measurements, computes geometry. Pure. |

Consequences worth knowing:

- **The same numbers drive Web, the share page, and the Android WebView**, because
  all three call the same solver.
- **Measurement is synchronous**, so no host contract changed.
- **A field that grows horizontally is measured again at its new width**, because
  widening reduces wrapping. Without a second measurement the solver would reserve
  the height from the narrow, wrapped version — safe, but taller than needed.
- **Font loading is not waited for.** A web font that has not finished loading is
  measured with the fallback face. If that matters for a template, wait for fonts
  before rendering.
- **Without measurements, the bill still renders** — at its traced sizes. That is
  why a host with no font engine produces an honest fixed bill rather than a wrong
  one.

---

## 8. What you will be told

Problems never fail silently. They arrive as warnings in the render result and are
surfaced in the preview:

| Message | Meaning |
|---|---|
| `"<id>" could not be given the room its content needs` | A field hit its cap, or a boundary stopped early. Text is never shrunk to fit. |
| `guide "<id>" reached its maximum displacement of N` | The boundary is capped and stopped. |
| `"<id>" grew past "<id>", which is set to a fixed size` | Content outgrew a frame that cannot grow. |
| `"<id>" needs more room than "<id>" allows; that box is capped at Npx` | A container hit its own size limit. |
| `"a" overlaps "b" inside "parent"` | Two siblings overlap after growth. Reported, never auto-resolved. |
| `content reaches Npx but the page is Mpx` | Content runs past a fixed page. |
| `"<id>" has both top and bottom attached to guide "g"` | A contradiction: one box cannot have both edges on one boundary. |

**Overlap is reported, never resolved by moving something.** The engine will not
push a sibling you did not ask to move — inventing that layout is worse than
telling you about it.

---

## 9. Common questions

**My rectangle has "Expand as needed" but it never grows.**
A shape carries no text, so it has nothing of its own to grow for. It grows when
it is a `Layout container` with children, or when its axis names a `growthGuideId`
whose boundary moves.

**Why did my box jump onto the marking line when I opened the template?**
It should not — and after the current version it does not. This was a real defect:
edges used to snap to a boundary's absolute position. Edges now follow the
boundary's travel and keep their drawn margin.

**A value that used to print fine now clips.**
Check the field's growth mode and any `Maximum extra`. A cap that is smaller than
the content produces a warning and clips, rather than shrinking the text.

**Can one field push two boundaries?**
Yes. Its X axis can name a vertical guide and its Y axis a horizontal one.

**Two fields share one marking line. Do they stack?**
No. The line moves by the largest single demand, not the sum. Two fields sharing a
boundary only need it to clear both of them, not both stacked on top of each other.

**What happens if I delete a marking line?**
The attachments that pointed at it are removed with it, so no rule is left dangling
and no edge silently stops following anything. Delete a container rectangle and any
child that named it has its `Layout parent` cleared — while keeping its anchor, so
switching to a different container later does not lose your intent.

**Does this work on Android?**
The layout engine is shared TypeScript, so the same rules run there. Android
itself lives in a separate repository; printing and its DTOs are verified there.

**Can the bill paginate?**
Not yet. Pagination is a declared later phase; the renderer has no page model.

---

## 10. Where to look in the code

| Question | File |
|---|---|
| What can be configured, and how is it stored? | `lib/template/types.ts` |
| How is the layout computed? | `lib/render/layout.ts` |
| What order does rendering happen in? | `lib/render/index.ts` |
| What is measured, and where? | `lib/billkit/bridge.ts`, `lib/billkit/measure-dom.ts` |
| Are these settings valid? | `lib/package/layout.ts` |
| Where are the panels? | `components/editor/LayoutPanel.tsx` |
| How are marking lines drawn and edited? | `lib/canvas/guides.ts`, `lib/canvas/EditorController.ts` |
| Where are the tests? | `tests/layoutXAxis.test.ts`, `tests/layoutHierarchy.test.ts`, `tests/variableLayoutBill.test.ts`, `e2e/layout-guides.spec.ts` |

---

## 11. Checklist before you ship a template

- [ ] Every growing field has a growth mode on the axis you expect.
- [ ] Bounded fields have a `Maximum extra` that is realistic for the data.
- [ ] Each marking line has a `Max travel` that is a real business limit.
- [ ] Frames meant to hold growing content are `Layout container`, with the field
      in their `Layout parent`.
- [ ] Labels below a growing field use `Keep bottom/right inset`, not start.
- [ ] The page policy matches whether the bill may exceed the traced sheet.
- [ ] Fill the form with the **longest** value you expect, and read the warnings.

That last step is the real test. Fill it with a short value and confirm the bill
matches your design exactly — that is the guarantee this feature is built on.