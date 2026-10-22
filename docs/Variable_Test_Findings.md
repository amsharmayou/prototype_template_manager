# Variable_Test.json — layout findings

**Template analysed:** `../outputs/Variable_Test.json`
**Renderer:** `lib/render/layout.ts` (`calculateLayout`)
**Method:** every number below was produced by running the real solver and the real
`renderHtml` over the real file, then asserted from a real browser driving
`public/billkit.js` (the same bundle the Android WebView loads), with text
measured by a real font engine.

The two PNGs in `docs/screenshots/` visualise two symptoms. Both were reproduced
numerically, root-caused, and fixed. **This model cannot read image input**, so
the screenshots themselves could not be viewed; the reproductions below are
independent of them and match the reported behaviour exactly.

---

## 1. The template, in numbers

| Item | Value |
|---|---|
| Page | 1127 × 871 |
| `guide-1` (horizontal) | **base y = 373.49** |
| `guide-2` (horizontal) | base y = 433.84 — **declared but referenced by nothing (dead guide)** |
| `field_eqgsmkr` | y = 213.55, h = 144.17 → **bottom = 357.72** |
| `rect_b5s870i` (frame around the field) | y = 193.93, h = 222.97 → **bottom = 416.90** |
| `rect_97e4jyr` (bottom-left box) | top = 452.11 → **78.62px below guide-1** |
| `rect_apph1si` (bottom-right box) | top = 453.78 → **80.29px below guide-1** |

Relationships actually stored in the file:

- `field_eqgsmkr` — expansion `x:fixed`, `y:unbounded/wrap`; **top and bottom both
  attached to `guide-1` (`stretch`)**, which is what makes the field push the
  boundary. No `layoutParentId`.
- `rect_b5s870i` — expansion `y:unbounded`, **no `container`**, **no
  `layoutParentId`**; **bottom attached to `guide-1` (`stretch`)**.
- `rect_97e4jyr` — **top attached to `guide-1` (`move`)**.
- `rect_apph1si` — **top attached to `guide-1` (`move`)**.

Derived quantities:

- free space between the field's authored bottom and `guide-1` = **15.77px**
- gap between `rect_b5s870i` bottom and the field's authored bottom = **59.18px**
- only the field *pushes* `guide-1`: the demand map is built from objects that
  carry both a growth policy **and** a measurement, and of those only the field
  has a bottom/right attachment naming the guide.

---

## 2. Symptom A — the two bottom rows jump up onto the guide

> "when the field if full and hits the guide 1 the tops of the two bottom
> rectangles just goes up like screenshot-4 and go with the guide but they should
> not have to move up they should have maintain the distance from the guide line
> attached"

### Reproduced

`rect_97e4jyr.top` (authored 452.11, i.e. 78.62px **below** the line):

| field lines | field bottom | guide-1 | `rect_97e4jyr.top` **before** | **after fix** | wanted |
|---:|---:|---:|---:|---:|---:|
| 9 | 359.71 | 373.49 | 452.11 | 452.11 | 452.11 |
| 10 | 375.95 | 375.95 | **375.95** | 454.57 | 452.11 + travel |
| 12 | 408.43 | 408.43 | **408.43** | 487.05 | 452.11 + travel |
| 15 | 457.15 | 457.15 | 535.77 | 535.77 | 452.11 + travel |
| 20 | 538.35 | 538.35 | 616.97 | 616.97 | 452.11 + travel |

At 10 lines the boundary travels **2.46px** and the box jumps **76px up**. It
then rides the line, and at 15 lines flips back down to the correct offset — a
discontinuity of ~78px mid-gesture. `rect_apph1si` behaves identically.

### Root cause — `carryTo`

`lib/render/layout.ts`, the predicate duplicated in `placeEdge` and `carryTo`:

```ts
// before
const drawnOnGuide = travel > TOLERANCE && at - authoredEdge <= TOLERANCE;
const want = drawnOnGuide ? at : authoredEdge + travel;
```

"`move` means carry the whole object" is the whole rule, so a box drawn *clear*
of the line — above **or** below it — must keep the distance the author drew,
which `authoredEdge + travel` expresses. A box drawn *on* the line belongs to it,
and `authoredEdge == guideBase` reaches the same place by the same formula. So
the predicate only has to tell those two apart, and it cannot do it from the
boundary's **current** position: for a box below the line, `at - authoredEdge` is
already negative, so an unguarded `<=` reads every such box as "on the line" and
carries it *up* onto the boundary the moment the boundary moves a sub-pixel.

It is also one-sided for the other case. `at - authoredEdge <= TOLERANCE` is
false when the edge is far above the line (large positive difference) and true
when it is anywhere below it, so the rule applied differently depending on which
side of the line the author drew — the opposite of a rule that is supposed to be
symmetric.

### The idempotency property the fix must keep

A second clause keeps the steady state a fixed point: once a box has been carried
onto the boundary its edge sits at it, and re-solving it there must not carry it
again. Comparing against the **base** alone fixes the first render but breaks
that — measured by re-solving a result (objects fed back with the *moved* guides,
which is what an actual round trip does):

| form | 1st run `r97.top` | 2nd run | |
|---|---:|---:|---|
| before (buggy) | 408.43 | 408.43 | stable, but wrong geometry |
| `authoredEdge` vs base **only** | 487.05 | **521.99** | drifts |
| base **or** current position | 487.05 | 487.05 | fixed point ✓ |

Note the original file is *already* non-idempotent in the other direction — it is
only stable in the small-travel band, because that is the band where it wrongly
snaps. There is no existing test that re-solves a below-line `move` box with the
original guides, which is why the defect survived.

### Fix

`carryTo` compares the edge against **either** the boundary's base **or** its
current position, symmetrically:

```ts
const guideBase = at - travel;
const drawnOnGuide =
  Math.abs(authoredEdge - guideBase) <= TOLERANCE ||
  Math.abs(authoredEdge - at) <= TOLERANCE;
const want = drawnOnGuide ? at : authoredEdge + travel;
```

plus `atFarEdge` (below), which fixes a third defect the same tests exposed.

`placeEdge` is **unchanged**: `sequential guides` deliberately draws `band` with
a guide *inside* it, and pinning the edge to the boundary then never letting the
box shrink below its own traced edge is the rule that test pins.

### Third defect found by the same tests — a box carried by its far edge

The same test written for the mirror case failed, which pinned a **previously
unreachable** bug: `carryTo` assigned the edge coordinate to the object's origin
regardless of which edge the attachment bound, so a `move` attachment on a
**bottom/right** edge set the *far* edge coordinate as the *origin* and teleported
the box by its whole height. No test ever exercised that path — the only `move`
attachments on a far edge were on edges that never moved.

```ts
// before: assigns the edge coordinate to the origin
if (axis === "y") box.y = want;
else box.x = want;

// after: the answer is a coordinate of the edge, so the origin is
// the far edge back by the size
if (axis === "y") box.y = atFarEdge ? want - box.height : want;
else box.x = atFarEdge ? want - box.width : want;
```

Verified in `e2e/expandable-bill.spec.ts`, which drives `public/billkit.js` and
fails with `Received: 440.83, Expected: 519.45` — a 78.62px error, exactly the
reported symptom — when the fix is reverted.

---

## 3. Symptom B — the parent frame only grows when the field nearly arrives

> "the field bottom should and the parent rectangle inside which the field have
> some distance and when the field tries to grow the bottom of the rectangle
> should also grow to maintain the distance(gap) but they are not following as
> the bottom of the rect start growing when the text field comes to very near of
> it"

### Reproduced

Gap between `rect_b5s870i`'s bottom and the field's bottom (authored 59.18):

| field lines | field bottom | `rect_b5s870i` bottom **before** | gap **before** | bottom **after fix** | gap **after** |
|---:|---:|---:|---:|---:|---:|
| 9 | 359.71 | 416.90 | 57.19 | 418.89 | 59.18 |
| 10 | 375.95 | 416.90 | 40.95 | 435.13 | 59.18 |
| 12 | 408.43 | 416.90 | **8.47** | 467.61 | 59.18 |
| 13 | 424.67 | 468.08 | 43.41 | 483.85 | 59.18 |
| 20 | 538.35 | 581.76 | 43.41 | 597.53 | 59.18 |

Before the fix the frame sat frozen at its traced height of 416.90 while the
field consumed the gap, then snapped to follow the guide at 13 lines and settled
at a **different** distance (43.41). After it tracks the field from the first
pixel and keeps the authored 59.18.

### Root cause — a guide attachment disabled containment

The frame does contain the field geometrically, and the solver has a "legacy
shape" containment path that grows such a frame around what it contained, keeping
the traced slack. That path is guarded by:

```ts
// before — lib/render/layout.ts, in both the container and legacy passes
if (links[axis]) continue;   // links[axis] is true for ANY top/bottom attachment
```

`linked` was true for *either* an expansion `growthGuideId` *or* any
top/bottom **attachment**. So a frame with a top/bottom attachment was excluded
from containment entirely and was left to whatever the attachment did to it:

- `placeEdge` sets the edge to `max(boundary, traced bottom)` — "grow past the
  traced height, never shrink" — which is why it froze until the boundary passed
  416.90 and then followed the guide instead of the field. That is the exact
  "starts growing when the text comes very near" symptom.

Removing the attachment restores the designed behaviour, which proves the guard
is what suppresses it:

| rB5 bottom → field bottom gap | lines 9 / 12 / 20 |
|---|---|
| attachment removed, containment active | 59.18 / 59.18 / 59.18 |
| as authored (guard suppresses containment) | 57.19 / 8.47 / 43.41 |

### Fix

Suppress containment only when the shape's **own expansion** ties an edge to a
*live* guide — i.e. when the "shapes linked to a boundary" pass is the thing
setting that edge. An attachment pins an edge; it does not release the frame from
containing its contents.

```ts
// after
const linked = new Map<string, { y: boolean; x: boolean }>();
for (const o of input.objects) {
  const p = policyOf(o);
  linked.set(o.id, {
    y: p?.y.growthGuideId !== undefined && guides.has(p.y.growthGuideId),
    x: p?.x.growthGuideId !== undefined && guides.has(p.x.growthGuideId),
  });
}
```

The `guides.has(...)` check matters: a dangling `growthGuideId` moves nothing, so
it must not suppress containment either.

This is deliberately **not** a removal of the guard. Removing it outright fixes
this template but over-grows the `legacy` case: `layoutPersistence` draws a rect
whose expansion *does* name a guide and whose edge is stretched to it, and then
containment would add the authored slack on top of an already-stretched edge
(170 instead of 130). The two rules reconcile by taking whichever edge is further
out, which is what the guard ordering achieves.

---

## 4. Other gaps found in the same template

- **`guide-2` is dead.** Declared at y = 433.84, referenced by no attachment and
  no `growthGuideId`. It renders as an editor overlay and does nothing.
- **`field_eqgsmkr` has a contradictory top+bottom pair on `guide-1`**, both
  `stretch`. It happens to misbehave only in a benign way because the field's own
  content is what pushes that guide, so the solver skips both of its attachments.
  A twin-edge pair on a *non-pushing* box would be carried rather than stretched.
- **No diagnostics.** All of the above were silent — `diagnostics` is `[]` at
  every length tested, for both before and after. `guides` at every length also
  never reaches output.

---

## 5. Changes made

| File | Change |
|---|---|
| `lib/render/layout.ts` | `carryTo`: base-or-current comparison + `atFarEdge` far-edge translation. `linked`: narrowed to expansion-linked guides only so containment keeps running when an edge is merely attached. `placeEdge` unchanged. |
| `tests/layoutHierarchy.test.ts` | **+6 tests**: a box drawn clear of a boundary keeps its distance (below *and* above the line), far-edge carry instead of teleport, steady state, frame keeps its gap while bound to a boundary, and deferring to the nearer boundary. |
| `tests/variableLayoutBill.test.ts` | Rewrote the stale "leaves the row below alone" case — the live template now *does* attach those rows. It now asserts they are carried by travel and that untouched rows stay as authored. |
| `e2e/expandable-bill.spec.ts` | **New.** Drives `public/billkit.js` on the **live** `../outputs/Variable_Test.json` in a real browser: short value paints the trace; long value carries the attached rows and keeps the frame's gap. |
| `public/billkit.js`, `public/sharekit.js` | **Rebuilt.** Both embed the solver, so every host would otherwise keep serving the old layout. |

---

## 6. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` | **926 passed** (56 files) |
| `eslint` (source) | 0 errors, 2 pre-existing warnings |
| `playwright test` | layout-guides, rows, variable-layout, expandable-bill all pass |

The `e2e/expandable-bill.spec.ts` regression was validated by reverting the
solver and rebuilding the bundle: it fails with `Expected: 519.448, Received:
440.83` — the reported symptom — and passes again once the fix is restored.

**Not in this repository:** pagination (the renderer has no page model), automatic
collision resolution (`report`/`allow` only), font-load timing (measurement is
synchronous), and Android. This repo has no `Android/` module, so the WebView,
print and Kotlin DTO paths are verified in the separate pipeline repository and
no claim is made here about them.
