# BillKit Variable Layout — Hierarchical Containers, Expandable Fields, and Two-Axis Guides

**Document type:** Implementation plan for a coding agent  
**Status:** Revised follow-up plan; use this to extend the current implementation  
**Applies to:** BillKit Web editor/renderer and Android renderer/print flow  
**Primary requirement:** Make variable layout work with horizontal **and** vertical marking guides, nested/parent rectangles that expand when their children need room, and child objects that can either stay anchored, move with a parent edge, or stretch.

> **Important for the coding agent:** A previous version of the variable-layout plan may already have been implemented in this repository. Do not start over or blindly replace that work. First inspect the current branch, identify which parts already exist, run the existing tests, and then implement the missing/incorrect behaviour described here. Adapt proposed names and schemas to the real codebase. Record meaningful deviations in the final report.

---

## 1. The user-visible behaviour this plan must deliver

BillKit lets a designer trace a bill, add rectangles and fields, save it as a `.btpkg`, fill the fields on Web or Android, preview the result, and print it. The new layout feature must preserve the authored design when values fit and adapt the geometry only when content requires it.

The layout can be asymmetric and free-form. It is **not** assumed to be a uniform table or grid.

### 1.1 Field expansion

Every eligible field can independently specify its X and Y growth policy:

- **Fixed:** no content-driven growth on that axis.
- **Bounded:** can grow by a configured maximum amount beyond its base size.
- **Unbounded:** has no user-defined growth cap, but is still subject to finite runtime/document safety limits.

Examples:

- An address has X fixed and Y unbounded, so it wraps at its original width and grows down.
- A long organization name has X bounded and Y bounded, so it may widen up to its configured limit and then wrap/grow vertically if allowed.
- A reference number has X and Y fixed.

The layout must measure content using the same typography, wrapping, padding, and border rules as the final renderer. Do not use a rough character-count estimate as the source of truth.

### 1.2 Horizontal and vertical marking guides

Both guide orientations are required parts of the feature—not separate optional future phases.

- A **horizontal guide** is a line across the canvas with a Y coordinate. It can move up/down and control `top`/`bottom` edges.
- A **vertical guide** is a line down the canvas with an X coordinate. It can move left/right and control `left`/`right` edges.

A guide is layout metadata and an editor overlay, not normal bill artwork. Crossing a guide does **not** automatically attach an object to it. Only explicit, saved relationships affect layout.

Examples:

- A vertically expandable field can request movement of a horizontal guide.
- A horizontally expandable field can request movement of a vertical guide.
- A rectangle can stretch when one of its edges follows a guide.
- A table, label, image, or other object can move with a guide while preserving its size.

### 1.3 Hierarchical expansion

A rectangle may be more than a decorative outline: it may act as a **layout container** for child fields and objects. Containers can be nested.

When a child needs more space:

1. Calculate the child's new size from its own expansion rules.
2. Recalculate its containing section/rectangle if that container must preserve padding or contain its children.
3. Propagate the required change to the outer rectangle/document if their policies allow expansion.
4. Apply each sibling's own anchor/attachment rules. Do not indiscriminately move every object below or beside the field.

A growing field does not automatically mean that every neighbour must move. The parent defines the available region and its growth behaviour; each sibling declares what it is attached to.

### 1.4 Preserve separate text or objects inside the same rectangle

A common use case is a field near the top of a rectangle and pre-existing static text below it. As the field grows, the lower text should not be accidentally covered or arbitrarily moved.

The designer must be able to define whether the lower text is:

- anchored to the parent's top/left (stays at the same local position in the parent);
- anchored to the parent's bottom/right (moves with the corresponding parent edge and preserves its distance from that edge);
- attached to a guide/edge (follows that boundary);
- stretched between two edges; or
- fixed in canvas/document coordinates if supported by the current object model.

If the field grows and the parent expands, a bottom-anchored label can move down with the growing parent's bottom edge, preserving its bottom padding and its position relative to that edge. A top-anchored label can remain at its original local position. If the growing field would overlap a fixed/top-anchored label, the engine must follow an explicit collision policy or report a collision; it must not silently overlay the label.

### 1.5 Expandable outer rectangle and document boundary

The outer rectangle can itself be an expandable container. It should grow only as much as needed to contain its final children plus configured inner padding/margins, while preserving its configured fixed axes.

The document/canvas has a separate policy:

- fixed paper size;
- expandable width and/or height subject to finite limits; and
- optionally pagination in a future phase if the renderer/printing pipeline supports it.

An expandable outer rectangle is not the same thing as an expandable document. Both policies must be explicit. If the outer rectangle grows inside a fixed-page document and reaches the page edge, BillKit should report the page overflow or follow an explicitly selected overflow policy.

---

## 2. Mandatory repository reconnaissance before coding

The implementation must first inspect the actual code, as an earlier plan may already have been applied.

Read and trace:

- `PIPELINE.md` and any existing variable-layout plan/documentation;
- template object types and the current meaning of `parentId`;
- expansion policies and guide/attachment metadata already implemented;
- Fabric.js serialization, grouping, selection, tool state, undo/redo, snapping, zoom/pan, and save/load;
- package build, parse, resolve, validation, and template-version handling;
- `fillTemplate`, computed-value resolution, repeat-band expansion, and HTML object renderers;
- the runtime entry and bridge (`lib/billkit/main.ts`, `lib/billkit/bridge.ts`, or their current equivalents);
- browser/Web preview measurement and how the Android WebView calls the runtime;
- Android DTOs, `RendererViewModel`, preview refresh, and `PrintController`;
- all tests added by the previous implementation.

Run the current relevant tests before editing. Produce a short checklist of what is already implemented, what is incomplete, and which tests demonstrate it. Do not duplicate a feature that already works.

### Critical `parentId` check

The template may already contain `parentId`. Determine whether it represents Fabric grouping/visual containment, runtime ownership, or layout semantics. Do **not** assume those meanings are interchangeable. If the current `parentId` cannot safely express layout containment, add a distinct optional `layoutParentId`/container relationship instead of changing existing grouping behaviour in a breaking way.

Use the actual serialized shape already adopted in the repository when possible. Examples in this document are conceptual targets, not proof that corresponding types/functions already exist.

---

## 3. Architecture to preserve

The existing BillKit pipeline describes:

- Web editor: Next.js/Fabric.js authoring and preview;
- shared TypeScript package/template/render libraries;
- `.btpkg` archive format containing manifest, template and assets;
- Android/Kotlin frontend for file opening, Compose form UI, WebView rendering and printing;
- shared runtime/bridge so the same layout semantics are used by Web and Android.

Keep the core layout calculations in shared TypeScript. Android must not implement a separate guide or expansion solver. Kotlin remains responsible for package file I/O, UI state, hosting the runtime, and print APIs.

Keep pure calculations free from DOM/window/filesystem/network dependencies. If actual text measurement uses DOM APIs, put it in a runtime/browser adapter that returns measurements to the pure solver.

Do not rewrite the renderer wholesale. Extend the established pipeline at a clear seam and preserve current object-rendering primitives whenever possible.

---

## 4. Terminology

- **Base geometry:** The designer-authored X, Y, width and height. Treat it as immutable for each render.
- **Final geometry:** The coordinates/dimensions after content measurements and layout constraints are applied.
- **Field expansion policy:** Fixed/bounded/unbounded growth on a single axis.
- **Guide:** A horizontal or vertical layout marking line with a stable ID and base coordinate.
- **Guide attachment:** A relationship between a supported object edge and a guide.
- **Layout container:** An object/region (often a rectangle) whose child relationships and padding are used to calculate a growing region.
- **Anchor:** A rule describing how an object is positioned relative to its container or document (top/left, bottom/right, center if supported, one/two edges, or explicit guide).
- **Growth demand:** The additional width/height needed by an object or container.
- **Collision:** Two objects/regions overlap beyond the allowed design relationship.
- **Overflow:** Content or geometry cannot be contained within configured expansion/document limits.
- **Diagnostic:** A warning/error explaining a capped field, collision, invalid guide, impossible constraint, or non-convergent layout.

Avoid confusing guide orientation with the axis along which the guide moves: a horizontal guide has a Y coordinate and moves vertically; a vertical guide has an X coordinate and moves horizontally.

---

## 5. Layout model and relationship rules

This section defines the intended semantics. Implementations may use different internal types, but must preserve these behaviours.

### 5.1 Per-axis expansion policy

Each eligible field can configure X and Y independently:

```ts
// Conceptual shape; adapt to current type names/conventions.
type AxisExpansion =
  | { mode: "fixed" }
  | { mode: "bounded"; maxGrowth: number }
  | { mode: "unbounded" };
```

Rules:

- `maxGrowth` is additional growth beyond current authored/base geometry, not final absolute dimension.
- `fixed` means content-driven layout must not increase that dimension; overflowing content must produce a configured fallback or diagnostic.
- `bounded` may increase the dimension by at most `maxGrowth`.
- `unbounded` has no designer-set cap but must respect engine maximums and document policy.
- Do not auto-shrink font size unless explicitly configured; do not silently clip text.
- For text, define wrapping behaviour explicitly. In the simplest rule, X fixed means wrapping at the base width; Y growth then fits the wrapped content.
- If X growth is enabled, use a documented width-allocation policy and remeasure wrapping at the chosen final width. The result must be deterministic.

For first release, growth direction should default to rightward for X and downward for Y, with top-left retained as the origin unless an explicit attachment/anchor requires repositioning.

### 5.2 Layout-container behaviour

A visual rectangle may be marked as a layout container. This is an explicit property, not an assumption that every rectangle contains every nearby object.

A container should define, as supported by the current model:

- stable container ID;
- optional layout parent/container ID;
- child/member object IDs or reverse `layoutParentId` links;
- per-axis growth policy;
- minimum/base width and height;
- inner padding/insets (left, top, right, bottom);
- child overflow/collision policy;
- whether its size is fixed, content-driven, or controlled by guide-attached edges;
- optional maximum width/height.

For a content-driven container with top-left anchored origin, calculate its needed dimensions from its base minimum size and the final bounds of its participating children, plus padding. In simplified form:

```text
requiredRight  = max(child.finalRight  + rightPadding)
requiredBottom = max(child.finalBottom + bottomPadding)
container.width  = max(baseWidth, requiredRight  - container.x)
container.height = max(baseHeight, requiredBottom - container.y)
```

The real implementation must account for left/top insets, child-local versus absolute coordinates, attached edges, rotation, minimum dimensions and existing object semantics. This formula states the content-containment principle, not an implementation shortcut.

**Important:** A parent container should not grow solely because a field is near it. The field must be a member/child or have an explicit layout relationship. A rectangle used only as decorative artwork must not unexpectedly resize unless the designer opts into that behaviour.

### 5.3 Nested parent growth

Container growth must propagate outward through nested layout containers:

1. Measure and size the growing field.
2. Recalculate its immediate content container from its participating children and padding.
3. If that container's final bounds exceed its parent's available region, recalculate/grow the parent according to its policy.
4. Continue until the outermost container/document boundary is reached or a cap/constraint prevents further growth.

Never mutate base coordinates/dimensions as a shortcut. Each render begins from the original authored geometry and calculates a fresh final layout.

If a parent is fixed on an axis and a child needs more room, use the configured overflow/collision policy and diagnostics. Do not secretly make a fixed parent expandable.

### 5.4 Anchoring sibling content within a growing parent

Support explicit anchor semantics for children of a container. At minimum, implement the following where compatible with current geometry support:

- **Start/top/left anchored:** preserve the object's offset from the parent's top/left; it does not move merely because the parent grows on the far edge.
- **End/bottom/right anchored:** preserve its distance from the parent's bottom/right; it moves as the corresponding parent edge moves.
- **Stretch between edges:** keep the configured start and end insets; dimension changes with the parent.
- **Guide anchored:** one or more object edges follow an explicit guide.
- **Fixed/absolute:** preserve a defined absolute or parent-local coordinate, according to the documented mode.

For a child located under an expanding field, the designer must be able to keep that child at the same local top position or pin it to the parent's bottom edge. If it is bottom-anchored, and the parent grows down 80 px, the child should usually move down 80 px to preserve its bottom inset. This is the intended method for keeping pre-existing footer/label text in the same relative position at the bottom of a growing box.

Do not infer anchors based only on where an object happens to appear in the drawing. They must be serialized in template metadata or be created explicitly through the editor.

### 5.5 Collision/overlap policy

Expansion can create a collision if a field grows into a sibling anchored near it. The engine must not arbitrarily push all objects or silently overlap them.

Provide explicit behaviour where practical, such as:

- allow overlap (only for intentional overlay/design elements);
- preserve the sibling's anchor and report collision;
- move the sibling/region according to an explicit push/guide rule;
- expand the containing region and move end-anchored siblings with the parent's boundary;
- clamp the field to its limit and report overflow.

The first release does not need a universal automatic packing algorithm. It needs deterministic behaviour and useful warnings for unsupported or conflicting constraints. If the selected rule cannot satisfy both objects, return a diagnostic that identifies the field and affected object/container.

### 5.6 Guide semantics

A guide record stores at least:

- unique stable ID;
- orientation: `horizontal` or `vertical`;
- base coordinate (`position`, interpreted as Y for horizontal and X for vertical);
- optional max movement/displacement;
- optional movement rule/role if current architecture needs it.

An attachment stores at least:

- unique stable attachment ID;
- object ID;
- edge (`top`, `bottom`, `left`, `right`);
- guide ID;
- behaviour (`move` or `stretch`, with optional richer modes if already implemented).

Validation rules:

- Horizontal guides may attach to `top`/`bottom` edges.
- Vertical guides may attach to `left`/`right` edges.
- A `move` attachment means move the entire object, preserving its width/height, when the attached edge moves. Define the anchor precisely for objects with more than one attachment.
- A `stretch` attachment means the referenced edge follows the guide while the opposite edge remains anchored; final size is recomputed.
- When both opposite edges are attached to guides, size comes from the distance between final guide positions, respecting minimum size and object-specific layout policy.
- Do not make a guide move every object it crosses. Only attachments and field/container growth relationships drive changes.
- Deleting a guide must invoke a clear editor action: remove dependent attachments with confirmation, or mark them invalid and show an actionable diagnostic. Never leave silent dangling references.

### 5.7 Connect expansion to guides

Fields/containers may declare an expansion guide for each axis:

- Y growth can request movement of a horizontal guide.
- X growth can request movement of a vertical guide.

A guide acts as a movable boundary. If the expanded edge still falls before the guide's base position, it need not move. If content requires the edge to pass the guide, move the guide only as far as needed, subject to caps and connected relationships. This supports using pre-existing blank space before moving lower/right content.

For example, when a field's final bottom extends 67.58 px beyond a horizontal guide's base coordinate, the guide's needed displacement is 67.58 px, unless a different explicit clearance/inset policy applies.

If several fields request the same shared boundary, use the maximum compatible displacement required to satisfy them, rather than summing the growth of sibling fields that share the same boundary. Distinct sequential sections can produce cumulative movement through their separate dependent guides.

### 5.8 Both guide orientations must work in the first complete implementation

Do not declare the feature complete with only vertical field growth/horizontal guides.

Required symmetry:

| Expansion | Corresponding guide | Typical effects |
|---|---|---|
| Field grows in Y | Horizontal guide moves in Y | Height/vertical boundaries respond; connected right/below sections follow configured rules |
| Field grows in X | Vertical guide moves in X | Width/horizontal boundaries respond; connected right-side sections/boundaries follow configured rules |
| Container grows in Y | Horizontal boundary/edge adjusts if attached | Bottom borders, bottom-anchored children and outer container react according to their rules |
| Container grows in X | Vertical boundary/edge adjusts if attached | Right borders, right-anchored children and outer container react according to their rules |

A layout using both axes must behave consistently when one field changes both width and height or when one expansion changes text wrapping on the other axis.

---

## 6. Template schema and compatibility

Use the current repository's schema if the earlier implementation already introduced it. Extend/repair that schema instead of inventing a parallel competing schema.

The following examples are conceptual. Adapt naming to the current types, schema version, and existing serialized data.

### 6.1 Example: vertically expandable field inside a content container

```json
{
  "id": "customer_address",
  "x": 32,
  "y": 28,
  "width": 240,
  "height": 48,
  "layoutParentId": "customer_panel",
  "expansion": {
    "x": { "mode": "fixed" },
    "y": {
      "mode": "unbounded",
      "strategy": "wrap",
      "growthGuideId": "customer_panel_bottom"
    }
  }
}
```

### 6.2 Example: a content container and a bottom-anchored label

```json
{
  "id": "customer_panel",
  "type": "rect",
  "x": 180,
  "y": 140,
  "width": 500,
  "height": 240,
  "container": {
    "enabled": true,
    "growthX": "fixed",
    "growthY": "content",
    "padding": { "top": 16, "right": 16, "bottom": 20, "left": 16 }
  }
}
```

```json
{
  "id": "panel_footer_label",
  "x": 200,
  "y": 340,
  "width": 220,
  "height": 24,
  "layoutParentId": "customer_panel",
  "anchor": { "vertical": "end", "bottomOffset": 12, "horizontal": "start", "leftOffset": 20 }
}
```

This conceptual configuration says that the label should keep a 12 px distance from the parent's bottom edge. When the panel grows vertically, it moves down with the bottom edge. A top-anchored sibling instead preserves its top offset.

The implementation must define whether child coordinates are stored in absolute canvas coordinates or parent-local coordinates. Do not mix them. If the editor stores absolute coordinates today, keep that representation at the authoring boundary and normalize into a consistent internal coordinate system for solving.

### 6.3 Example: both marking-line orientations

```json
{
  "layout": {
    "mode": "variable",
    "guides": [
      {
        "id": "details_bottom",
        "orientation": "horizontal",
        "position": 370.14,
        "maxDisplacement": 700
      },
      {
        "id": "details_right",
        "orientation": "vertical",
        "position": 851.98,
        "maxDisplacement": 300
      }
    ],
    "attachments": [
      {
        "id": "details_border_bottom",
        "objectId": "details_border",
        "edge": "bottom",
        "guideId": "details_bottom",
        "behavior": "stretch"
      },
      {
        "id": "right_section_left",
        "objectId": "right_section",
        "edge": "left",
        "guideId": "details_right",
        "behavior": "move"
      }
    ]
  }
}
```

### 6.4 Container vs guide vs document

Keep these separate:

- **Field/child policy:** how much the content object can grow.
- **Guide policy:** how a boundary moves in response to a growth demand.
- **Container policy:** whether a rectangle/section grows to contain children, stretches between guides, or stays fixed.
- **Document policy:** whether the page/canvas remains fixed or grows and how overflow is handled.

Do not treat an outer rectangle as the document boundary automatically. A bill may have an outer rectangle within a larger page, or may have no visible outer rectangle at all.

### 6.5 Versioning

The currently documented template version is `2`, but inspect the actual code and any previous implementation before deciding the next version. If the feature adds incompatible required semantics, use the repository's agreed versioning approach (likely a new template version) and add migrations/defaults deliberately.

- Old templates without variable-layout metadata must keep legacy behaviour.
- Layout must remain opt-in.
- Do not change the `.btpkg` archive/package version just because `template.json` gains metadata unless the archive format itself changes.
- Build/parse/resolve must preserve all new layout/container/anchor metadata.
- Validate untrusted imported JSON before using object or guide relationships.

---

## 7. Shared rendering architecture and pipeline position

The target path for a variable-layout render is:

1. Parse and validate the template/package.
2. Start from immutable base geometry.
3. Resolve flat field values and computed values using existing BillKit behaviour.
4. Expand repeating bands into render objects using existing repeat logic.
5. Establish normalized render IDs and layout-container memberships.
6. Measure rendered content using a browser/runtime measurement adapter.
7. Calculate field expansion demands for **both X and Y**.
8. Resolve guide movement demands for both horizontal and vertical guides.
9. Recalculate affected child, container, and outer-container geometry.
10. Apply sibling anchors/collision policies.
11. Propagate growth outward through nested containers and document policy.
12. Re-measure/re-solve if X/Y interaction changes wrapping; impose a strict iteration cap.
13. Check document bounds, collisions, caps, invalid constraints and stable convergence.
14. Generate HTML using final geometry, retaining existing object renderers and z-index behaviour.
15. Return HTML plus diagnostics through the existing result/bridge contract.
16. Show/print the final result using the existing Web and Android pipeline.

Verify the real order in code. Do not duplicate existing fill/computation/repeat logic merely to create this seam. If current `renderHtml` combines multiple steps, refactor the smallest necessary surface.

### 7.1 Pure solver vs measurement adapter

The pure shared TypeScript solver must not use `document`, `window`, Android APIs, or network/file access. It accepts measurements and template/layout metadata and returns final geometry plus diagnostics.

The browser/WebView adapter may measure a hidden DOM element that uses the same typography and wrapping rules as the final output. It should:

- safely insert plain text as text, not executable HTML;
- account for font family, size, weight, style, line height, character spacing, padding and borders supported by the renderer;
- measure wrapped height at a candidate width;
- deal explicitly with font-load timing/fallback;
- measure any supported inline image or non-text content where needed;
- provide consistent results within reasonable browser differences.

Canvas `measureText()` may support width estimates but does not by itself replace measuring wrapped block height.

### 7.2 Runtime/bridge contract

The current documented bridge accepts JSON strings and exposes high-level `deriveForm` and `render` operations. Inspect the current implementation before changing the contract.

- Keep `bridge.ts` pure.
- Prefer preserving the existing public API.
- If DOM measurement makes rendering asynchronous, update the runtime and both consumers deliberately; do not accidentally return a Promise to a caller expecting a synchronous JSON string.
- Preserve success/error envelopes and useful diagnostic propagation to Web and Android.
- Ensure the Android runtime waits for the WebView shell/runtime to be ready.

---

## 8. Layout calculation algorithm

Use a bounded, deterministic layout algorithm. The MVP does not need a universal CAD solver, but it must correctly handle explicit parent/child and guide dependencies.

### 8.1 Normalize and validate

- Create fresh working geometry from authored base objects on every render.
- Convert coordinates to one well-defined coordinate space for calculation.
- Build object, container, guide, attachment and parent lookup maps.
- Validate unique IDs, finite dimensions, nonnegative/acceptable sizes, known parents and guides, axis compatibility, and configured size caps.
- Detect cycles in guide/container dependencies before iterative work where possible.
- Do not mutate or persist computed geometry into the source template.

### 8.2 Measure natural content size

For each expandable field, request required width and height at the candidate width, including the actual style/padding rules. Content measurements may depend on width, so the interface can be candidate-width-based rather than a single static result.

A conceptual measurement type:

```ts
interface ContentMeasurement {
  requiredWidth: number;
  requiredHeightAtWidth: number;
  measuredWidth: number;
  measuredHeight: number;
}
```

Adapt as necessary for repeat cells or rich content. A fallback measurement must be marked as such and must not be silently treated as equivalent to a browser-accurate measurement.

### 8.3 Resolve per-field X and Y growth

- Compute permitted final width using the X policy and explicit growth priority.
- Re-measure text height at that chosen width.
- Compute permitted final height using the Y policy.
- Preserve base top-left unless a constraint/anchor changes it.
- If the permitted size is insufficient, register an overflow/cap diagnostic.
- When only Y is expandable, keep base width and wrap.
- When only X is expandable, keep base height and apply explicit no-wrap/overflow policy.
- When both axes are expandable, use a documented deterministic strategy. The editor should make the strategy understandable rather than relying on accidental solver order.

### 8.4 Resolve guide demands in both axes

For Y expansion, the relevant horizontal guide may move down. For X expansion, the relevant vertical guide may move right. In either case:

1. Compare the relevant final edge with the guide's base coordinate/clearance policy.
2. Move the guide only when the required edge crosses its permitted free-space boundary.
3. Apply max displacement and document/container limits.
4. Aggregate compatible demands on a shared guide deterministically (normally maximum required displacement).
5. Recompute all explicitly attached edges and objects.

Do not assume horizontal and vertical processing can never affect each other. A vertical guide can change field width, changing text wrap and resulting height; a horizontal guide can change a container's geometry which in turn affects child widths if those children stretch.

### 8.5 Resolve object attachments

- `move`: move the whole object along the guide's movement axis while retaining its dimensions.
- `stretch`: move the attached edge while keeping the opposite edge anchored.
- Both opposite edges attached: derive the final dimension from their resolved positions and respect minimum dimensions.
- Validate incompatible attachments (e.g. two contradictory constraints on one edge).
- Unattached objects do not move just because they are near or crossed by a guide.

### 8.6 Resolve containers from inner to outer

Use a predictable dependency order:

1. Resolve field sizes and any guides controlling those fields.
2. Recalculate direct child positions using their parent anchors/edge attachments.
3. Compute the container's required bounds based on participating children and configured padding.
4. Apply the container's own X/Y policies, attachments and size limits.
5. Propagate the resulting change to its parent container.
6. Continue until the outermost container/document is handled.

If a container edge is controlled by a guide, reconcile content-driven growth with the guide relationship according to a documented precedence. Prefer rejecting conflicting constraints with a diagnostic rather than arbitrarily allowing one rule to overwrite another.

### 8.7 Collision handling

After each significant geometry pass, test only the collisions relevant to the model (for example children within one container or objects explicitly marked as non-overlapping). Do not use a global “all rectangles must never overlap” rule because bill artwork intentionally layers and intersects.

When a growth collision is found:

- apply the configured push/anchor/container policy if one exists;
- otherwise preserve the authored anchor and report the collision/overflow;
- never silently hide an unrelated label behind an expanded field.

### 8.8 Convergence and safety limits

- Use a dependency graph/topological ordering where possible.
- Use a bounded iteration loop only where X/Y wrapping and dependent geometry require it.
- Define a small pixel tolerance and an iteration/pass limit (for example, 6 passes initially; adjust using tests).
- Detect repeated geometry states/non-convergence.
- Clamp to finite documented engine safety limits even in unbounded mode.
- Return a stable safe result with diagnostics or an explicit render failure; never hang the UI or print process.

### 8.9 Compute document bounds

Document size is calculated separately from a visible outer rectangle.

- Fixed document: preserve the selected page size and report out-of-page geometry according to policy.
- Expandable document: calculate the union of final content bounds and required page padding, then apply max width/height.
- For the initial implementation, vertical expansion is particularly important for receipt-like bills. Implement horizontal document expansion as well where configured; do not ignore X just because Y is common.
- Pagination should be considered later unless the current renderer already supports it.

---

## 9. Editor UX requirements

Inspect current Fabric.js patterns and integrate with them rather than adding a parallel interaction system.

### 9.1 Marking-line tool

Add or complete a dedicated **Layout Guide** tool, separate from the normal bill line tool.

- Let the user choose horizontal or vertical mode.
- Click-drag or click-place according to current editor interaction conventions.
- In horizontal mode, constrain the guide to a Y position and draw it across the guide's defined span/canvas.
- In vertical mode, constrain the guide to an X position and draw it vertically.
- Support select, move, delete, property edit, undo/redo, persistence, and zoom/pan coordinate correctness.
- Give guides a distinctive dashed style/color in editor mode.
- Ensure normal bill line drawing is unchanged.
- Prevent guide overlays from being serialized/rendered as bill artwork.

If the editor needs transient Fabric objects for pointer interaction, maintain an explicit mapping to the stable serialized guide ID and filter them from the artwork object list.

### 9.2 Guide properties

Expose:

- orientation and position;
- allowed movement/displacement limits;
- which object edges attach to the guide;
- associated growth demands from fields/containers;
- safe deletion behaviour when dependencies exist.

Do not display settings the engine cannot yet enforce.

### 9.3 Field properties

For each field, expose independent X and Y policies, caps, wrapping/growth strategy, and optional growth guide references:

- X: fixed / bounded / unbounded;
- Y: fixed / bounded / unbounded;
- maximum additional growth when bounded;
- wrap/no-wrap/overflow behaviour supported by runtime;
- horizontal growth guide (must refer to a vertical guide);
- vertical growth guide (must refer to a horizontal guide).

### 9.4 Container/rectangle properties

Allow a rectangle/section to be designated as a layout container. Expose, as appropriate:

- enable/disable container behaviour;
- optional layout parent/container;
- X/Y growth policy;
- padding/insets;
- minimum/current base size and maximum growth/size;
- child membership or tools to assign children to the container;
- collision/overflow policy;
- edge/guide attachments.

Not all rectangles should become containers automatically. Offer a clear action such as **Use as layout container** and a way to assign or reassign children.

### 9.5 Child anchor properties

Provide a readable UI for anchoring children relative to a parent:

- pin to top/left;
- pin to bottom/right;
- stretch between edges;
- attach an edge to a marking guide;
- keep fixed coordinate (if supported).

For an object selected in the canvas, show the parent/container that currently controls its layout. If an object is outside any container, explain that it is anchored to the document/canvas or is free-positioned.

### 9.6 Preview and editing feedback

- Guide lines are visible in editor mode and hidden from final preview/render/export/print.
- Show selected object's base bounds and resulting/final bounds when useful.
- Show actionable diagnostics for overlap, caps, unresolved guide IDs or invalid parent relationships.
- Updating a value/rule refreshes preview through the same shared runtime.
- Print/export must wait for the newest completed layout result.

---

## 10. Package, versioning, and backward compatibility

- Preserve new guide, attachment, parent/container, anchor and expansion metadata in `template.json`.
- Ensure build/parse/resolve/validate and asset replacement preserve that metadata.
- Package checksums must continue to cover the actual template member and assets.
- Keep legacy templates on the established fixed renderer path unless variable layout is explicitly enabled.
- If the earlier implementation already made a version change, preserve its valid migration strategy rather than introducing a second version change unnecessarily.
- Do not increment `.btpkg` package format version unless the ZIP/archive contract changes.
- Validate external JSON before using its references. Missing parents/guides or invalid attachment edges must produce helpful diagnostics, not a blank page or runtime crash.
- Add a fixture for the uploaded `Variable_Test.json` shape (or a minimized equivalent) to ensure current metadata is migrated/handled correctly. It currently shows an expandable field, one horizontal guide, attachments, `parentId` values, and document growth settings; inspect how the implemented code currently interprets these. Do not hardcode the sample's IDs or positions into the solver.

---

## 11. Repeating tables and row content

If the previous implementation already supports repeat-band expansion, preserve its data semantics and add variable row heights carefully.

- Measure each rendered cell at its final column width.
- Set each row's height based on the tallest participating cell allowed to expand.
- Rows can have different heights; the table's following rows, border lines, trailer and footer must use the calculated row positions.
- Compute a table's expanded height from its rows and table padding/borders, then propagate that size through its containing section if configured.
- Computed totals must continue to use original input values and must not depend on visual row geometry.
- Enforce existing `maxItems` and warnings.
- If variable row heights are not already implemented, keep it as a declared second milestone after the main parent/guide model works, but do not claim the complete feature supports variable table descriptions until those tests pass.

---

## 12. Web/Android integration and printing

### Web

- Use the shared TypeScript solver and runtime measurement adapter.
- Keep canvas guide overlays separate from final rendering objects.
- Verify preview, exports, and print use final geometry rather than stale/base geometry.

### Android

- Kotlin continues to read the archive, build the Compose form, store form state and host the WebView runtime.
- Use the shared runtime for content measurement/layout/rendering; do not add a Kotlin geometry implementation.
- Preserve the current bridge protocol if possible and update mirrored DTOs only for result/schema fields that actually cross the bridge.
- Ensure layout warnings and failures are visible through existing result/error conventions.
- Verify values are re-rendered from base geometry on every update.
- Print the final rendered HTML using the final document dimensions/paper policy.
- If the document grows beyond standard A4, define the policy clearly (custom receipt media if supported, fixed-page overflow, or later pagination); do not imply arbitrary-size printing works without verifying platform support.
- Ensure editor-only guide lines never reach print output.

---

## 13. Required implementation phases

Implement in small, reviewable phases. Both guide orientations must be covered by the core solver and acceptance tests before the feature is declared done.

### Phase 0 — Audit the currently implemented plan

1. Inspect the existing branch and earlier implementation.
2. List implemented schema, guide tools, attachments, expansion controls, solver, runtime measurement, document growth, tests and known limitations.
3. Run current typecheck/lint/unit/integration tests and record baseline failures.
4. Identify whether current parent/group semantics support layout containers or need a distinct relation.

**Exit gate:** A short implementation inventory exists; no code has been overwritten blindly.

### Phase 1 — Finalize and validate the relationship model

1. Confirm per-axis expansion semantics.
2. Confirm both guide orientations and all compatible object edges.
3. Add/complete container and anchor metadata.
4. Define collision/overlap and parent-growth precedence.
5. Validate IDs, parent cycles, guide cycles, edge/orientation combinations, bounds and caps.
6. Add schema fixtures and migration tests.

**Exit gate:** Legacy templates still pass; invalid hierarchy/guide data fails clearly; the JSON model can represent the user's nested-rectangle scenario.

### Phase 2 — Complete the pure solver for X and Y

1. Normalize immutable base geometry.
2. Resolve field size demand in both axes.
3. Resolve horizontal and vertical guide displacement in the same core milestone.
4. Apply move/stretch attachment semantics.
5. Resolve anchors within parents.
6. Recalculate a child's container and propagate changes outward to the outer rectangle/document.
7. Apply collision handling, finite caps, convergence and diagnostics.
8. Test repeated renders for no cumulative drift.

**Exit gate:** Pure unit tests demonstrate X-only, Y-only, combined X/Y expansion, nested container propagation, static sibling anchoring and both guide orientations.

### Phase 3 — Integrate measuring with the renderer

1. Measure content using the real rendering typography.
2. Insert the layout pass after data binding/computation/repeat expansion and before final HTML object generation.
3. Re-measure when width changes affect wrapping.
4. Use final geometry for all relevant object types.
5. Preserve warnings/refusals and extend diagnostics appropriately.

**Exit gate:** Long text grows correctly in HTML with the expected guide, child, container, and document behaviour. No invalid overlaps are silently introduced.

### Phase 4 — Complete editor workflows

1. Complete horizontal and vertical guide drawing/moving/selecting/deleting.
2. Complete field X/Y expansion settings.
3. Add or complete container designation and membership/parent assignment.
4. Add child anchor controls and guide-edge attachment controls.
5. Add undo/redo, save/load, zoom/pan and reference validation.
6. Show layout diagnostics/final bounds in editor/preview.

**Exit gate:** Designer can create the complete scenario from the UI, save it, reopen it, and get the same layout.

### Phase 5 — Repeat bands and complex cases

1. Add variable row heights if not already supported.
2. Recalculate table grid/borders and footer positions.
3. Test rows with long values and existing computed totals.

**Exit gate:** Dynamic tables use final row geometry and maintain correct computations.

### Phase 6 — Android, exports, and print verification

1. Confirm template/package metadata survives Android import.
2. Confirm WebView runs the same shared TypeScript solver.
3. Confirm diagnostics work across the bridge.
4. Verify output page dimensions/orientation and long-receipt policy.
5. Run the full Android/Web build and tests.

**Exit gate:** Same `.btpkg` layout rules work on Web and Android; print uses the final geometry and no guide overlay is printed.

### Phase 7 — Hardening and release

1. Add a demo template for X and a demo template for Y, plus one nested-container scenario.
2. Measure solver performance for a large template and repeat table.
3. Document supported object types and limitations.
4. Verify legacy golden output and report test results.

**Exit gate:** Acceptance criteria pass and incomplete items are explicitly reported.

---

## 14. Mandatory test scenarios

### 14.1 Axis/guide symmetry

1. X fixed, Y fixed: geometry remains unchanged; long content returns a diagnostic.
2. X fixed, Y unbounded: wraps at base width and grows downward; associated horizontal guide can move.
3. X fixed, Y bounded: grows only to max; overflow diagnostic when insufficient.
4. X unbounded, Y fixed: grows width; associated vertical guide can move right; overflow if height cannot fit.
5. X bounded, Y fixed: respects width cap and reports insufficiency.
6. Both axes expandable: deterministic result with a documented growth priority; both guide orientations work if associated.
7. A vertical guide attachment to `left`/`right` works; a horizontal guide attachment to `top`/`bottom` works.
8. Invalid orientation/edge combinations are rejected.
9. Guide movement caps are respected in both orientations.

### 14.2 The crucial nested-rectangle/sibling case

Create a parent rectangle with:

- an expandable field near its top;
- a static text label below it;
- a bottom-anchored label or child panel;
- the parent rectangle configured to grow vertically;
- an outer rectangle configured to grow vertically;
- a horizontal guide associated with the inner section;
- one optional vertical guide to verify X expansion symmetry.

Test short content and long content:

- Short content: layout matches base geometry.
- Long content: field expands; inner parent grows enough to contain it plus configured padding; bottom-anchored sibling moves with the parent's bottom edge and retains its inset; top-anchored sibling keeps its top offset.
- If a top-anchored sibling would collide with the field, apply the selected collision rule or report a diagnostic—never silently overlay it.
- The outer rectangle grows recursively to contain the expanded inner rectangle and content plus its margin.
- Unrelated objects outside the container remain unchanged unless explicitly attached to a moved guide/container.

### 14.3 Guide and object relationships

- A guide does not affect unrelated objects just because it crosses them.
- One field demand can move its matching guide and attached boundaries.
- Two fields sharing one guide produce the required max displacement rather than a sum of sibling demand.
- Distinct sequential guides can propagate cumulative displacement.
- A `stretch` attachment preserves the opposite edge.
- A `move` attachment preserves object size.
- Two opposite-edge attachments produce a valid non-negative size.
- Deleting a guide with attachments is handled safely.
- Cycles and contradictions are rejected or diagnosed.

### 14.4 Nested containers and document growth

- Child grows; inner rectangle expands; outer rectangle expands; document expands only if its own policy says so.
- Fixed container refuses growth and reports overflow.
- Fixed document with growing outer rectangle reports page overflow according to policy.
- Expanded document respects max width/height.
- Parent padding/insets remain correct after growth.
- Multiple levels of nested parents propagate correctly.
- A decorative rectangle not designated as a container does not unexpectedly grow.

### 14.5 Stability, text, and safety

- Long/short strings, whitespace, punctuation, Unicode and explicit newlines.
- Width changes that reduce or increase wrapping.
- Font settings and padding changes.
- HTML-sensitive input stays escaped and non-executable.
- Repeated renders from different values do not accumulate geometry changes.
- The iteration limit stops non-convergent layouts safely.
- Invalid values/coordinates and extreme growth cannot make the runtime hang or allocate unreasonable output.

### 14.6 Repeating tables and legacy

- Variable-height rows and table footer positioning.
- Existing maxItems and calculation semantics unchanged.
- Existing version-2 packages/fixtures preserve their legacy rendering.
- Guides are not present in HTML, exports or print output.
- Web and Android agree on geometry within a defined tolerance.

---

## 15. Definition of Done

Do not declare the feature complete unless all applicable items are satisfied:

- [ ] The existing implementation was audited before changes were made.
- [ ] Field growth is independently configurable for X and Y.
- [ ] Horizontal and vertical guides are both fully supported.
- [ ] Horizontal guide movement responds to Y growth; vertical guide movement responds to X growth.
- [ ] Both orientations support valid edge attachments and movement/stretch behaviour.
- [ ] Layout containers can be explicitly defined using supported parent/member relationships.
- [ ] Child growth can cause parent/inner rectangle growth according to container policy.
- [ ] Parent growth propagates outward to the outer rectangle/document only according to their own policies.
- [ ] Bottom/right-anchored siblings can follow a growing parent's edge; top/left-anchored siblings can keep their offsets.
- [ ] Collision between growing fields and anchored text is handled explicitly, never silently overlaid.
- [ ] Unrelated objects remain fixed unless explicit relationships require changes.
- [ ] Document growth is distinct from visible outer-rectangle growth.
- [ ] Growth caps, invalid references, collisions, overflow and non-convergence produce useful diagnostics.
- [ ] Every render begins from base geometry and has no cumulative drift.
- [ ] The pure solver is in shared TypeScript and the DOM measurement adapter is kept separate.
- [ ] Variable-height repeat rows are supported or clearly declared unfinished and excluded from claims of full table support.
- [ ] Guides do not appear in final output unless explicitly created as ordinary artwork.
- [ ] Existing fixed/version-2 templates remain compatible.
- [ ] Web and Android use the same layout semantics.
- [ ] Preview, export and print use final calculated geometry.
- [ ] Tests/builds were actually run and results are accurately reported.

---

## 16. Coding-agent guardrails

1. Inspect the current branch and prior implementation before touching code; this is a refinement, not a greenfield rewrite.
2. Preserve existing working behaviour and renderer code wherever possible.
3. Do not make Kotlin a second layout engine.
4. Do not put DOM APIs in the pure solver/bridge.
5. Do not mutate base geometry during rendering.
6. Do not infer parent membership or guide attachments from proximity/intersection.
7. Do not automatically expand every rectangle; require explicit container behaviour or a defined existing semantic.
8. Do not automatically move all content below or to the side of a field. Respect each sibling's anchor and explicit constraints.
9. Do not ignore horizontal expansion or vertical guides. Both axes are part of required completion.
10. Do not call an unbounded setting truly infinite; enforce finite safety limits.
11. Do not silently shrink text, clip content, or overlap objects to make a test pass.
12. Do not change the package version without confirming the archive contract requires it.
13. Do not claim Android print correctness from browser preview alone.
14. After each phase, run targeted tests and report actual results before proceeding.
15. If current code structure prevents a stated behaviour, propose a minimal architecture adjustment, update the plan with the reason, and retain the user-visible requirements.

---

## 17. Suggested end-to-end demo based on `Variable_Test.json`

Use the uploaded `Variable_Test.json` or a minimized derived fixture as the concrete regression test. Do not hardcode its coordinates/IDs in the algorithm.

The sample contains an outer rectangle, several internal rectangles, one text field with X fixed/Y unbounded and wrap strategy, a horizontal guide, attachments, and document growth settings. Inspect its actual interpretation in the current code before altering it.

Configure the demo to demonstrate:

1. A customer/details rectangle as an explicit vertical-growing layout container.
2. A text field inside it: X fixed, Y unbounded, wrapping enabled, growth associated with a horizontal guide.
3. A separate static label below the field inside the same container, anchored to the parent's bottom edge so it preserves its bottom inset as the parent grows.
4. A top-anchored static object that preserves its top offset.
5. An inner rectangle that grows with its participating children.
6. A lower section attached to the inner container's moving bottom boundary and moved according to its explicit edge rule.
7. An outer rectangle that grows vertically to contain all final content plus its margin.
8. A vertical guide on a right-side region, with an X-expandable field or container demonstrating horizontal expansion.
9. A case where an X expansion increases field width and reduces text wrapping, proving the layout engine recalculates the coupled Y requirement.
10. A short-value preview identical to the authored base layout and a long-value preview showing the calculated growth.

For the sibling under the field, include one deliberate collision test: configure it as top-anchored while the field expands into it. The runtime must follow the configured collision policy or produce a clear warning. Then configure it bottom-anchored and verify that parent growth carries it down while preserving its distance from the parent's bottom edge.

---

## 18. Required final report from the coding agent

At completion, report:

1. What was already implemented before this revision and what was added/fixed.
2. Final relationship model: field, guide, container, anchor, document, and collision semantics.
3. Final schema example for both horizontal and vertical guides and for a child growing inside a parent with bottom-anchored static content.
4. Files changed and why.
5. The layout/measurement pipeline and how Web/Android invoke it.
6. How version-2/legacy templates are kept compatible.
7. Tests/commands run and their actual outcomes.
8. Paths to demo templates/packages and how to reproduce the short/long-content cases.
9. Known limitations and any acceptance criteria not met.

Do not report success for any item not verified by implementation/tests.

---

## Core principle

**Preserve the authored template as immutable base geometry. Measure content, resolve both X and Y expansion, apply explicit horizontal/vertical guide constraints, keep sibling placement governed by anchors, grow opted-in parent rectangles from their children and padding, then propagate growth to the outer rectangle/document according to their separate policies—all in the shared TypeScript layout pipeline before final HTML generation.**

---

## 19. Implementation status (2026-10-15)

Audited against this document by running the repository's own checks. Numbers
below are from the run that produced this section, not from memory.

### Verified present

| Requirement | Evidence |
|---|---|
| Per-axis `fixed` / `bounded` / `unbounded`, `maxGrowth` as a delta | `types.ts`, `tests/layout.test.ts` |
| Horizontal **and** vertical guides, caps, cycle detection | `tests/layoutXAxis.test.ts` (23 cases), `e2e/layout-guides.spec.ts` |
| Attachments `move` / `stretch`, edge-orientation validation | `tests/layoutXAxis.test.ts`, `lib/package/layout.ts` |
| Explicit containers (`container.enabled` + `layoutParentId`) with padding, min/max | `tests/layoutHierarchy.test.ts`, `tests/layoutPackageValidate.test.ts` |
| Child anchors `start` / `end` / `stretch` on both axes | `tests/layoutHierarchy.test.ts` |
| Sibling collision `report` / `allow`, never auto-pushed | `tests/layoutHierarchy.test.ts` |
| Document growth (fixed/expand, max W/H) distinct from outer rectangle | `tests/layoutXAxis.test.ts` |
| Variable repeat-row heights, `maxItems`, computed totals independent of geometry | `tests/rowHeights*.test.ts`, `e2e/rows.spec.ts` |
| Layout metadata validated when a `.btpkg` is opened | `tests/layoutPackageValidate.test.ts` |
| Authoring surface reaches `template.json` (padding, limits, parent, anchor, layout block) | `tests/layoutEditorSurface.test.ts` |
| The `Variable_Test.json` bill, end to end in a browser | `tests/variableLayoutBill.test.ts`, `e2e/variable-layout.spec.ts` |
| Re-measure when X growth changes wrapping | `tests/layoutRender.test.ts` |
| Legacy `templateVersion: 2` renders byte-identically | `tests/renderGolden.test.ts` |
| Guides never reach output | `tests/guidesNeverRender.test.ts` |

### Defects found and fixed during this pass

1. **`growthX: "expand"` was a no-op.** An unbounded X axis was clamped to the
   authored page edge, so content could never widen a page that was supposed to
   grow. Fixed in `lib/render/layout.ts`.
2. **Attachments teleported boxes onto guides that had not moved.** A box drawn
   clear of a marking line was snapped onto it on the first render, before any
   value changed. Edges now follow the boundary's travel and keep their drawn
   offset; only an edge authored *on* the line sits on it.
3. **A container capped by its own `maxWidth`/`maxHeight` reported nothing** while
   its content silently ran past it. It now produces a diagnostic naming the box
   and the limit.
4. **Three hierarchy validations never executed**, because their `describe` block
   was nested inside a running `it`. They now run - and pass.
5. **The shipped bundles could lag the source.** Every host runs
   `public/billkit.js`, not `lib/`; a stale bundle serves old layout while the
   unit suite stays green. `tests/bundleFreshness.test.ts` now guards this.

### Deliberately not implemented

- **Pagination** (§1.5, §8.9). Deferred; the renderer has no page model.
- **Automatic collision resolution.** Only `report` (default) and `allow` exist.
  The solver never pushes a sibling the author did not ask to move.
- **Font-load timing.** Measurement is synchronous; a web font that has not
  finished loading is measured with the fallback face.
- **Android.** This repository has no `Android/` module. WebView rendering,
  printing and the Android DTOs are verified in the separate pipeline
  repository, and no claim is made here about them.
- **Multi-select layout editing.** `LayoutPanel` mounts for single selection
  only.
- **General iteration.** X growth triggers exactly one re-solve; there is no
  general convergence loop.

### Checks run

- `tsc --noEmit`: clean.
- `eslint .`: 0 errors, 2 warnings, both pre-existing.
- `vitest run`: 916 tests across 56 files, all passing.
- `playwright test`: the layout, render, share and row specs pass. Five
  canvas-interaction specs fail in this environment (`tablegrid.spec.ts` dialog,
  `workflow.spec.ts` wheel-zoom, snapping rules, stroke rasterisation). They
  exercise canvas drawing and dialogs, not the layout solver, and are reported
  here as pre-existing rather than claimed as fixed.
