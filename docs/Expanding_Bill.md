# BillKit Variable Layout & Expandable Structure — Implementation Plan

**Status:** Proposed implementation plan  
**Audience:** A coding agent implementing this feature in the existing BillKit repository  
**Primary goal:** Add opt-in, content-aware expansion for fields and bill structures while preserving the current rendering behaviour of existing templates.

> **Important:** This document describes the target design. The existing codebase must be inspected before editing. Names and locations below are based on the current `PIPELINE.md`; adjust them if source code differs, and record any design changes in this plan. Do not assume the proposed types, functions, files, or schema already exist.

---

## 1. Problem statement

BillKit currently lets a designer trace a bill, place objects, define dynamic fields, package a template as `.btpkg`, open it in Web or Android, fill the form, render HTML, preview it, and print it.

The current renderer uses positioned elements and fixed page dimensions. That reproduces a traced bill accurately, but a text field that needs more space does not automatically move or resize nearby elements. It can wrap or overflow depending on its existing style, while the neighbouring bill structure remains at its original coordinates.

We want to introduce **Variable Layout** so that a designer can:

1. Mark an individual field as fixed, horizontally expandable, vertically expandable, or expandable in both axes.
2. Set maximum additional width and height, or leave an axis without a user-defined growth cap.
3. Draw special horizontal and vertical **marking lines** in the Web editor.
4. Connect field edges, borders, rectangles, sections, tables, and other objects to those lines.
5. Specify whether connected objects move, stretch, remain fixed, or follow a boundary.
6. Allow a line and the related bill structure to move when a field needs more room.
7. Optionally let the overall document/canvas grow, or use a fixed page with clear overflow behaviour.
8. Keep the same layout rules on Web and Android by keeping the actual layout semantics in shared TypeScript.

The structure may be asymmetric and irregular. This must **not** be implemented by assuming every bill is a uniform grid or that all objects in a row/column should move together.

## 2. Existing architecture to preserve

The current pipeline document describes these responsibilities:

- `lib/canvas/`: Fabric.js editor for tracing and manipulating bill objects.
- `lib/template/`: in-memory template types and data-binding rules.
- `lib/package/`: `.btpkg` build, parse, asset resolution, and validation.
- `lib/render/`: shared TypeScript renderer, computation, repeat-band expansion, HTML primitives and CSS.
- `lib/billkit/bridge.ts`: pure TypeScript bridge called with JSON strings.
- `lib/billkit/main.ts`: browser/runtime bundle that exposes the BillKit API to other frontends.
- Android reads package files in Kotlin, derives its own Compose input UI from the shared schema, calls the JavaScript runtime through a WebView, and handles printing itself.

The pipeline currently renders positioned objects into self-contained HTML, uses a `RenderResult` with HTML/variables/warnings/refusals, and supports repeat bands through a pre-pass. The currently documented template version is `2`; the archive/package version is `1`.

### Architectural rule

**Do not implement the layout rules separately in the Web editor, Android UI, or Kotlin ViewModel.** The editor authors configuration, the frontend collects values and supplies measurements as needed, and the shared TypeScript rendering layer determines the final geometry. Kotlin remains responsible for package file I/O, form state, preview hosting, and printing.

Keep `bridge.ts` pure: it must not access `window`, a DOM, network APIs, or the filesystem. Browser-specific text measurement, if required, belongs in a runtime/adapter layer. The core layout calculations must accept inputs and return outputs deterministically.

## 3. Scope and non-goals

### Included

- Backward-compatible, opt-in template metadata for variable layout.
- Per-field X and Y expansion policies.
- Text wrapping and actual required-size measurement.
- Horizontal and vertical marking lines.
- Explicit object-edge attachments and responses to guide movement.
- Propagation of movement through an irregular layout.
- Stretching of rectangles/borders and movement of selected objects.
- Document boundary and overflow policy.
- Repeating-table row-height support after the core free-form model is stable.
- Runtime integration, Web editor UX, Android preview/print integration, validation, tests, and diagnostics.

### Not included in the first iteration unless existing architecture makes them trivial

- A general-purpose CAD/constraint-solving engine.
- Arbitrary bidirectional physical simulation between every object.
- Automatic reconstruction of guide relationships from a traced image.
- Text shrinking as an implicit fallback. It changes visual design and must be an explicit future feature.
- Automatic redesign of legacy version-2 templates.
- Server-side processing. This feature should continue to run locally.

## 4. Terminology

Use the following terminology consistently in code and documentation:

- **Base geometry:** The original x/y/width/height authored in the template.
- **Final geometry:** The x/y/width/height calculated for one render after values and expansion rules are applied.
- **Expansion policy:** The allowed content-driven growth for a field on one axis.
- **Horizontal guide / marking line:** A horizontal line with a y-coordinate; it can move vertically.
- **Vertical guide / marking line:** A vertical line with an x-coordinate; it can move horizontally.
- **Guide attachment:** A relation between one edge of an object and one guide.
- **Layout pass:** The process measuring content, calculating expansion, moving guides, propagating changes, and returning final geometry.
- **Overflow:** Content or an object that cannot fit after the allowed layout changes have been applied.
- **Layout diagnostic:** A warning or error explaining a layout condition such as a cap being reached, an invalid binding, or a region exceeding the page.

Do not use `x-axis guide` ambiguously to mean both a horizontal line and horizontal movement. In serialized data, prefer `orientation: "horizontal" | "vertical"` and document which coordinate changes.

## 5. UX and behaviour requirements

### 5.1 Field expansion controls

When a designer selects an eligible text/field object, show an **Expansion** section in its properties panel.

For each axis independently, expose:

- `fixed`: no growth on that axis.
- `bounded`: can grow up to `maxGrowth` additional pixels beyond its base size.
- `unbounded`: no user-defined growth cap; document/runtime safety limits still apply.

Expose a text policy as appropriate:

- `wrap`: allow text to wrap within the final width.
- `noWrap`: prefer one line; if the configured width limit is reached, apply the explicitly configured fallback or report overflow.

The first version should not automatically shrink font size. It should not silently clip text when the configured layout cannot contain it.

Examples:

- Address: X fixed, Y unbounded, `wrap`.
- LR number: X fixed, Y fixed; preserve the original field box.
- Company name: X bounded, Y bounded; optionally allow wrap after X reaches its cap.
- Notes: X fixed, Y bounded; warn if the height cap is insufficient.

**Define `maxGrowth` as additional growth beyond base geometry, not the final absolute width/height.** This prevents confusion when designers resize the original field after setting the policy.

### 5.2 Growth direction and anchors

For the first release, apply expansion to the right for width and downward for height, with the top-left as the default anchor. Do not introduce leftward or upward growth until the basic feature is stable. If the existing editor already supports anchors, inspect it and design a compatible representation rather than duplicating it.

The calculated final width/height must not automatically move the field's top-left point unless a connected guide/constraint explicitly requires that movement.

### 5.3 Marking-line tool

Add a dedicated tool in the Web editor for creating layout guides:

- Horizontal guide: stores a base y-coordinate and controls a horizontal boundary.
- Vertical guide: stores a base x-coordinate and controls a vertical boundary.
- Guides have stable IDs, are selectable, can be moved, and expose properties.
- Guides are editor metadata/overlays, not bill artwork by default.
- Guides must not accidentally appear in final HTML, exports, or printed output.
- A separate normal line/rectangle object remains regular bill artwork.
- Add delete, duplicate if supported, undo, redo, selection, and serialization support using the editor's existing history model.

Guide properties should eventually include a movement mode and maximum displacement. Keep the first implementation small; only expose options that the engine actually supports.

### 5.4 Connecting objects to guides

Allow supported object edges to attach to guides:

- `left` / `right` edges attach to vertical guides.
- `top` / `bottom` edges attach to horizontal guides.

Each attachment defines a response:

- `move`: move the whole object to preserve its size while the attached edge follows the guide. If only one edge is attached, this behaviour must be carefully defined; for instance, a table's top edge following a guide should move the entire table.
- `stretch`: resize the object so that the attached edge follows the guide while its opposite edge stays anchored.
- `fixed`: ignore guide movement. Prefer to represent this as no attachment rather than an active attachment whose behaviour is `fixed`, unless consistency with existing data conventions argues otherwise.

The implementation must define behaviour when both opposite edges are attached. A rectangle with top and bottom attached to separate horizontal guides may stretch between them. A text object attached on both opposite edges must keep its text-internal padding and apply an explicit overflow rule.

Avoid implicit propagation to every object that happens to intersect a guide. Only configured relationships should change geometry.

### 5.5 Field-to-boundary association

A field must be able to identify which guide, if any, should respond when its own content needs additional room. At minimum, support a `growthGuideId` for each expandable axis:

- Y expansion pushes an associated horizontal guide down.
- X expansion pushes an associated vertical guide right.

If no growth guide is associated, the field can grow inside its own box/geometry according to its policy, but unrelated objects should not move automatically.

A guide may receive expansion demands from multiple fields. For fields that share the same boundary, the minimum movement needed to satisfy them should normally be the **maximum** demand, not the sum of every field's growth. Separate sequential regions may move different guides and therefore add movement through their own constraints.

### 5.6 Asymmetric layouts

Do not require the whole row, the whole column, or all neighbouring objects to resize together. A bill can contain multiple independent sections, cells of different heights, and free-form placements. Use guides plus explicit edge relationships to model those designs.

## 6. Proposed template model

This is a starting schema, not a claim about the current code. Inspect `lib/template/types.ts`, package format definitions, serialization and validation before finalizing names. Follow existing camel-case/type conventions.

A candidate structure could look like this:

```json
{
  "templateVersion": 3,
  "layout": {
    "mode": "variable",
    "document": {
      "growthX": "fixed",
      "growthY": "expand",
      "maxWidth": 1127,
      "maxHeight": 10000,
      "overflow": "warn"
    },
    "guides": [
      {
        "id": "customer-details-bottom",
        "orientation": "horizontal",
        "position": 220,
        "maxDisplacement": 600
      },
      {
        "id": "customer-details-right",
        "orientation": "vertical",
        "position": 500,
        "maxDisplacement": 300
      }
    ],
    "attachments": [
      {
        "id": "details-border-bottom",
        "objectId": "details-border",
        "edge": "bottom",
        "guideId": "customer-details-bottom",
        "behavior": "stretch"
      },
      {
        "id": "goods-table-top",
        "objectId": "goods-table",
        "edge": "top",
        "guideId": "customer-details-bottom",
        "behavior": "move"
      }
    ]
  },
  "objects": [
    {
      "id": "customer-address",
      "x": 100,
      "y": 160,
      "width": 150,
      "height": 30,
      "expansion": {
        "x": { "mode": "fixed", "maxGrowth": 0 },
        "y": {
          "mode": "unbounded",
          "strategy": "wrap",
          "growthGuideId": "customer-details-bottom"
        }
      }
    }
  ]
}
```

### Schema rules

1. Use the actual object's stable ID mechanism. Do not assume every current template object already has a unique `id`; inspect and add/migrate IDs only if required.
2. Keep layout guides and attachments separate from rendered bill objects. They are editor/layout metadata, not artwork.
3. Keep the original x/y/width/height as base geometry. Do not overwrite base geometry with the result of a previous render; repeated renders with different values must start from the same base geometry.
4. If a rendered repeat row is generated from a source table row, create deterministic per-render identities for its objects/constraints. Do not persist generated row identities back into the template.
5. Validate guide orientation and object-edge compatibility: a horizontal guide can control `top` or `bottom`; a vertical guide can control `left` or `right`.
6. A missing or invalid referenced guide/object must produce a useful validation error or runtime diagnostic, not a crash.
7. Decide on template versioning after checking the current version gates. A template format change of this scope should normally use a new `templateVersion` (likely `3`), while keeping package version `1` unless archive-level format changes actually require a package-version change.
8. Version-2 templates without layout metadata must continue down the legacy path and preserve existing output.
9. If version-3 templates allow `layout.mode: "fixed"`, the engine must still preserve legacy fixed behaviour where that mode is used; do not silently make all templates dynamic.

## 7. Runtime architecture and render pipeline

### 7.1 Keep pure calculations separate from browser measurement

Text dimensions depend on font metrics, line-height, padding, wrapping and the browser environment. The shared algorithm should remain deterministic, but a pure TypeScript function should not access DOM APIs.

Recommended separation:

1. **Content preparation (pure):** resolve field values, computed values and repeat bands using existing logic.
2. **Measurement adapter (runtime/browser):** measure the text/content using the rendering environment and return measurements keyed by stable render-object identity.
3. **Layout solver (pure):** accept base geometry, expansion policies, guide definitions, attachments and measurements; return final geometry plus diagnostics.
4. **HTML render (pure):** render the prepared objects using final geometry.
5. **Preview/print host:** display and print the resulting HTML as it does today.

The runtime adapter can use a hidden measurement container/element that reproduces the same font, padding, available width and wrapping CSS as the output field. Use `textContent` for plain text measurements; never inject user-entered text into HTML as executable markup. If rich text exists in the source model, inspect its sanitization and rendering rules before measuring it.

A canvas `measureText()` helper may help estimate unwrapped line width, but width alone is insufficient to calculate wrapped block height. Prefer measuring an element using the renderer's actual typography and wrapping rules.

The measurement layer must account for:

- Font family, font size, font weight, line height and letter spacing if supported.
- Horizontal/vertical padding and borders.
- Whitespace and line-breaking rules.
- Inline content/images where applicable.
- Loaded fonts. If the runtime can render before web fonts are ready, define how it waits or falls back and make the behaviour visible/testable.
- Repeated table cells, whose row measurement depends on their content and column widths.

### 7.2 Keep the bridge contract stable where possible

Current foreign-host communication crosses the boundary as JSON strings, and the Android WebView calls the BillKit runtime through `evaluateJavascript`. Try to keep the public top-level operations (`deriveForm` and `render`) unchanged.

If a browser measurement pass makes the current render call asynchronous, inspect the existing `main.ts`, Kotlin runtime and Web caller first. Do not silently introduce a Promise if callers expect a JSON string synchronously. Either orchestrate measurement within a compatible runtime wrapper or deliberately update the API contract and both clients together, with tests for success/error envelopes.

`bridge.ts` must remain pure. Do not put `document.createElement`, `window`, `WebView`, filesystem access or Android logic in it.

### 7.3 Suggested internal API boundaries

Use names that match the repository once inspected. Possible interfaces:

```ts
// Pure inputs describing a single render's layout.
interface LayoutInput {
  template: BillTemplate;
  objects: RenderObject[]; // after value binding and repeat expansion
  measurements: Record<string, ContentMeasurement>;
  guides: LayoutGuide[];
  attachments: GuideAttachment[];
  documentPolicy: DocumentLayoutPolicy;
}

interface LayoutOutput {
  objects: RenderObject[]; // copied objects with final geometry
  document: { width: number; height: number };
  diagnostics: LayoutDiagnostic[];
}

function calculateLayout(input: LayoutInput): LayoutOutput;
```

These are conceptual types. Do not copy them blindly if current renderer objects use a different shape. Prefer the smallest API that fits existing code, and avoid duplicating template objects unnecessarily.

### 7.4 Pipeline ordering

The current documented renderer conceptually performs value filling, computed calculations, repeat expansion, z-index sorting and object rendering. Integrate variable layout in a way that respects dependencies:

1. Parse/validate template and supplied values.
2. Fill flat tokens using current logic.
3. Calculate computed values using current exact-money behaviour.
4. Expand repeat bands using the current rules so all renderable rows/cells exist before measuring them.
5. Produce render-object identities and measurement requests.
6. Measure content using a runtime adapter.
7. Calculate expansion and guide positions.
8. Propagate object movement/stretching in dependency order.
9. Re-measure/re-solve only if a geometry change affects wrapping or another dependent measurement.
10. Enforce iteration and size limits; return diagnostics if stable layout cannot be reached.
11. Update document dimensions as configured.
12. Sort by z-index as today and generate final HTML/CSS.
13. Return `RenderResult` with the HTML and any layout diagnostics, preserving existing warning/refusal conventions where possible.

Check existing implementation before changing order. For example, `renderHtml` may currently own both computation and repeat expansion. Refactor only enough to insert the layout pass cleanly; avoid duplicating business logic.

## 8. Layout algorithm

Implement a deterministic, bounded algorithm; do not attempt unrestricted simultaneous constraint solving in the first release.

### 8.1 Initial geometry

- Read base geometry from the authored template for every render.
- Create fresh runtime geometry records.
- Never mutate/save the computed geometry back into the base template.
- Validate finite numeric values and reasonable document/object size caps before calculations.

### 8.2 Measure intrinsic content needs

For each eligible dynamic text object:

1. Resolve the final text content for this render.
2. Measure its natural/unwrapped width when X expansion or single-line assessment requires it.
3. Measure the wrapped height at the width allowed by the current constraints.
4. Include padding, borders and line height consistently with the final renderer.
5. Record the minimum required width/height and current available width/height.

Define a small measurement contract, for example:

```ts
interface ContentMeasurement {
  requiredWidth: number;
  requiredHeightAtWidth: number;
  measuredWidth: number;
  measuredHeight: number;
  source: "dom" | "fallback";
}
```

This is illustrative. If height depends on candidate width, the measurement adapter may need a function/request-response loop rather than one static height. Keep the contract typed and testable.

### 8.3 Apply per-axis policies

For every field:

- `fixed`: final dimension cannot exceed base dimension because of content expansion.
- `bounded`: final dimension is at most `base dimension + maxGrowth`.
- `unbounded`: use required content dimension, restricted only by safety/document constraints.
- Respect base minimum dimensions and preserve base geometry as the starting point.
- Make the order of axis allocation explicit. For the first version, recommend **X-first** only where X growth is enabled and the field opts in; otherwise wrap at the base width and grow Y. An alternative `growthPriority: "x-first" | "y-first"` can be added if it simplifies the product requirement. Do not let the order emerge accidentally from code execution.
- With X fixed and Y fixed, preserve the box and report overflow according to its configured policy.
- With X fixed and Y growable, wrap to the base width and calculate height.
- With X growable, compute a permitted width first, then remeasure height at the chosen width.
- With Y fixed, do not report a field as fitting just because its container height remains fixed; compare required content height and report overflow when necessary.

### 8.4 Generate guide movement demands

For each expandable field attached to a growth guide:

- Y growth requests movement from the relevant horizontal guide.
- X growth requests movement from the relevant vertical guide.
- Derive demand from the field's required final edge compared with the guide's base position.
- Apply guide `maxDisplacement` and any applicable document limit.
- Aggregate shared-boundary demands using the maximum required displacement by default.
- Store diagnostic information identifying which field caused a guide to move.

If several different guides form sequential sections, calculate their movements in dependency order so later sections can move by the combined result from earlier sections. Do not sum unrelated field demands into one shared guide.

### 8.5 Propagate guide movement

Build a dependency graph from guides and object attachments.

- Detect cycles before resolving the graph.
- Resolve acyclic dependencies in a stable deterministic order.
- An object with a `move` attachment should retain width/height while its position changes.
- An object with a `stretch` attachment should preserve its opposite anchored edge and change its relevant dimension.
- If both edges are attached, derive size from the final distance between guides and enforce a non-negative size/minimum size.
- Preserve the z-index ordering; geometry calculation should not reorder visual layering.
- Unattached objects must not move merely because they are nearby or overlap a guide in screen coordinates.

A simple directed graph/topological-order approach is preferable for the first release. If a cycle exists, reject it during template validation where possible and return a clear runtime diagnostic for malformed externally supplied templates.

### 8.6 Re-measurement and convergence

Moving a vertical guide can change a field's width, which can change line wrapping, which can change height. To handle this:

- Run a bounded layout loop only when dependencies require it.
- Use an iteration cap (for example 5–8 passes; tune using tests and measurements).
- Define stability using a small geometry tolerance suitable for px-based layout.
- Detect repeated geometry states or a loop that exceeds the cap.
- If layout cannot stabilize, return the safest bounded layout and a diagnostic. Never hang the UI or print operation.

Do not add a loop if a one-way dependency graph and a single measurement pass are sufficient for the chosen MVP. Add iteration only where cross-axis measurement or dependent guides makes it necessary.

### 8.7 Document bounds and overflow

Support these document policies:

- `fixed`: preserve original page size; diagnose content/objects beyond the boundary.
- `expand`: grow the selected dimension to include final object bounds, subject to explicit maximums.
- `paginate`: reserved for a later stage unless current renderer/export architecture supports it safely.

For MVP, implement `fixed` and vertical `expand`. Horizontal page expansion may be implemented if its interaction with printing has a clear rule. Avoid automatic pagination in the first pass unless it is already a supported renderer capability.

When a field exceeds a growth cap, a guide reaches its displacement cap, or the document reaches its maximum size, emit a warning with enough information for a user to identify the source field/guide. Reuse the existing `RenderResult.warnings` shape unless a typed diagnostics extension is justified and all consumers are updated.

## 9. Repeating table and variable row support

BillKit has repeat-band expansion, where a table-row band is cloned for each item. Dynamic row heights must integrate with this existing feature.

Treat repeating rows as a second implementation milestone after a simple free-form layout works, but include the work in the complete feature plan.

Requirements:

- Measure each populated cell at the final column width.
- A row's content-driven height is the maximum required height across its participating cells, subject to row/field limits.
- All cells in the same rendered row share the row's final height, while different rows may have different heights.
- Borders/grid lines associated with the table must follow the actual row positions and heights.
- The table trailer/footer moves after the full expanded band.
- Repeated object identities must be stable for one render and unique across rows, but must not be saved into the source template.
- Computed totals must continue reading the original values/repeat arrays and must not depend on the visual height of a row.
- Preserve `maxItems` and existing warnings for excess or unusable repeat entries.
- Verify a repeat band that cannot fit within a fixed page and a repeat band under vertical document expansion.

Do not break the existing 9x4 table demo or existing computed-total semantics while adding variable row heights.

## 10. Editor implementation details

Inspect the existing Fabric.js object adapters, selection/property panel, history stack, serialization, snapping, grouping and import/export paths before implementing this section.

### 10.1 Guide representation

Preferred direction:

- Store guides in a dedicated template-level `layout.guides` collection.
- Render them in the Fabric.js editor as temporary/overlay objects, or maintain a clear mapping from overlay object to serialized guide metadata.
- Do not serialize them as ordinary bill objects unless the editor's architecture requires a transient Fabric representation. If it does, filter them from bill artwork and runtime rendering.
- Keep the guide ID independent of Fabric's transient object index.

### 10.2 Drawing and editing

- Add a marking-line toolbar action.
- Click-drag to create a horizontal or vertical guide; snap its orientation to the selected mode.
- Make guide appearance distinct from actual bill borders (for example, dashed and a separate editor-only color).
- Support selection, keyboard delete, property editing, zoom/pan coordinate correctness, undo/redo, and save/load.
- Provide a way to select an object and attach a specific edge to a selected guide.
- Prevent accidental drawing of a guide when the normal line or shape tool is active.
- Ensure guides behave correctly with groups and object transforms. If group support is complicated, explicitly disable guide attachment to group-internal objects in MVP and document that limitation rather than silently miscalculating coordinates.

### 10.3 Preview behaviour

- The editor's rendered preview must run the same shared layout rules as the final renderer.
- Guide overlays are shown in the editing canvas but hidden from the final rendered preview.
- Changing a field or guide rule should invalidate/recalculate the preview using the editor's existing update pattern.
- Keep debouncing where necessary, but make sure a print/export request waits for the latest completed render.

## 11. Package build, opening and compatibility

Inspect the current build/parse/resolve/validate code and tests before modifying it.

Checklist:

- Ensure the new `layout` metadata is carried into `template.json` when building a `.btpkg`.
- Do not accidentally place guide overlays or editor-only data in asset payloads.
- Verify package checksums include the updated `template.json` as they do today.
- Confirm parse/resolve preserves the layout schema and continues resolving `pkg://` asset references.
- Add schema validation for every guide, attachment, expansion policy, growth cap, and document policy.
- Confirm old package version `1` files containing template version `2` still open and render through the old path.
- Confirm package/open errors identify malformed metadata instead of failing later in the WebView.
- Update the sample-package preparation script if a new variable-layout demo should ship with the Android APK.
- Do not change `packageVersion` solely because the template JSON changes; verify the repository's package-versioning policy first.

## 12. Android integration

Keep Android's role focused on hosting the shared engine and exposing the resulting UI.

Inspect the current code in `Android/feature/renderer/` before implementation, particularly `ZipPackageReader`, `AssetResolver`, renderer contracts/DTOs, `WebViewBillKitRuntime`, `RendererViewModel`, the Compose screen, and `PrintController`.

Required checks/changes:

1. Confirm Kotlin package reading does not strip or normalize away `layout` metadata.
2. If the Android DTOs mirror the form schema or render result, update them only for new fields that cross the bridge.
3. Keep core layout math out of the ViewModel and Kotlin domain layer.
4. Preserve the current JSON-string bridge convention and success/error envelope if possible.
5. If the runtime adds layout diagnostics, make them available to Android without crashing deserialization on older/newer result shapes. Follow the project's current serialization defaults and tests.
6. Ensure re-rendering after input changes recalculates layout from base geometry instead of repeatedly expanding the previous result.
7. Ensure print uses the final rendered HTML and the calculated final page size. If the document grows vertically, ensure `PrintController`/media-size logic can represent that receipt size or report a clear unsupported-size policy.
8. Do not print editor-only guides.
9. Test a fresh WebView and replacement WebView to protect the existing per-view runtime lifecycle.
10. Test WebView readiness, runtime errors and Android print errors using the existing logging/Result conventions.

Android should not recalculate guide positions independently. It should submit the template/values to the shared TypeScript runtime and consume the resulting HTML and diagnostics.

## 13. Suggested implementation phases and gates

Do work in small phases. Each phase should include implementation, tests, and a review of compatibility before starting the next.

### Phase 0 — Repository reconnaissance (mandatory)

- Read the actual template types, renderer, package format/validation, canvas editor, build script, public runtime entry, bridge, and Android call path.
- Trace one text object from Fabric editor serialization through `template.json` to `renderObject`.
- Trace one repeat band from values to `expandRepeats` to HTML.
- Identify whether current render calls are synchronous and how errors/warnings cross the bridge.
- Identify current supported object types and their geometry/style representation.
- Write a short design note in the PR or update this plan with file names and any changed assumptions.

**Gate:** The agent can explain the current object model and the exact point where layout geometry can be inserted without duplicating computation or repeat expansion.

### Phase 1 — Data model and validation

- Add expansion policies, guide metadata, attachments, and document policy types.
- Add versioning/migration handling after inspecting version gates.
- Keep missing layout metadata on existing templates equivalent to legacy fixed rendering.
- Add validation helpers and tests for valid/invalid combinations.
- Define typed internal layout diagnostics or map them to the existing warning system.

**Gate:** TypeScript type-checking and package/template tests pass; version-2 fixture output is unchanged.

### Phase 2 — Pure geometry solver

- Implement the smallest pure geometry solver that accepts already-measured content sizes.
- Start with vertical-only expansion, a horizontal guide, and move/stretch attachments.
- Add X-axis expansion and vertical guides after Y-axis cases pass.
- Implement shared boundary aggregation, topological propagation, caps, document bounds, and cycle detection.
- Do not add DOM APIs to the solver.

**Gate:** Unit tests cover fixed/bounded/unbounded axes, shared guide demand, movement, stretching, asymmetric layouts, cycles, caps and determinism.

### Phase 3 — Measurement adapter and render integration

- Implement browser/runtime content measurement using the renderer's typography and wrapping CSS.
- Integrate layout after content binding/computation and repeat expansion, and before final object HTML generation.
- Preserve original base geometry across repeated renders.
- Return warnings for unsatisfied expansion and layout constraints.
- Add tests proving calculation and repeat-band values remain correct.

**Gate:** A long address expands vertically, pushes a connected guide, stretches a border, moves the configured table/footer, and produces correct HTML with no overlap.

### Phase 4 — Editor UX

- Add expansion property controls.
- Add guide creation/selection/dragging and guide properties.
- Add object-edge attachment editing.
- Integrate history, serialization, loading, zoom/pan, and preview refresh.
- Ensure guides never render as bill artwork.

**Gate:** A designer can create a variable-layout template from scratch, save it in the template/package, reopen it, and get the same preview result.

### Phase 5 — Repeating rows and complex geometry

- Calculate row height from its cells.
- Place subsequent rows and table trailer/footer correctly.
- Integrate table borders, row/column geometry, maxItems and page bounds.
- Test multiple line items with different text lengths and totals.

**Gate:** Rows grow independently where allowed, the table boundary follows them, and computed amounts remain unchanged/correct.

### Phase 6 — Android, export and printing

- Confirm bundled runtime/demo package updates.
- Test shared runtime output on Android WebView and Web preview.
- Verify document dimensions, landscape/portrait handling, and long-receipt strategy in print.
- Update DTOs and error handling only where needed.
- Run tests/lint/builds specified by the repository.

**Gate:** The same `.btpkg` produces materially equivalent rendered geometry on Web and Android, and printing uses the final page dimensions without editor guides.

### Phase 7 — Hardening and rollout

- Add a variable-layout demo template.
- Add user-facing diagnostics for limits, invalid guide references and overflow.
- Add a feature flag or opt-in layout mode if useful.
- Check performance with a large bill and many repeat rows.
- Verify backwards compatibility and document known limitations.

**Gate:** All acceptance criteria below pass and the original sample bill remains visually unchanged in legacy mode.

## 14. Test plan

### 14.1 Pure unit tests

Test at least these cases:

1. Fixed X and fixed Y: final geometry remains at base size; excess content creates a diagnostic.
2. Fixed X, unbounded Y: text wraps at base width and field height grows.
3. Fixed X, bounded Y: field grows only to the configured cap and warns if still too small.
4. Bounded X, fixed Y: width grows within its cap; content that still does not fit is reported.
5. Unbounded X and fixed Y: width grows within document safety rules; verify the selected no-wrap/fallback policy.
6. Both axes expandable: explicit growth priority is applied deterministically.
7. A shared horizontal guide receives two demands and moves enough to satisfy the greater demand, not the sum.
8. Separate sequential guides propagate movement cumulatively.
9. Border edge stretches and keeps its opposite edge anchored.
10. A table or footer moves with a guide and retains its size.
11. An unattached object remains fixed even if visually close to the guide.
12. Invalid guide ID, invalid edge/orientation combination, duplicate IDs, negative limits and non-finite coordinates.
13. A cyclic guide/attachment dependency is rejected or diagnosed.
14. Guide maximum displacement and document maximum are respected.
15. Repeated renders with different values produce different layouts without cumulative geometry drift.
16. Object z-index ordering remains unchanged after layout.
17. A layout that fails to converge stops at the pass limit and returns a diagnostic rather than hanging.
18. Output is deterministic for identical normalized input and measurements.

### 14.2 Measurement tests

- Short string, long string, spaces, punctuation, Unicode, non-Latin text and line-break characters.
- Font family/size/weight/line-height/padding changes.
- Wrapped height changes as width changes.
- A loaded font and a fallback font, if the runtime uses packaged/web fonts.
- HTML-escaped plain-text input, including strings containing `<`, `>`, `&`, and script-looking text.
- Missing/empty text and a field whose content is only whitespace.

Measurement tests may need browser-based tests in addition to pure unit tests. Avoid flaky snapshots based on platform-specific antialiasing; assert dimensions and geometric relationships with a reasonable tolerance.

### 14.3 Editor tests

- Create horizontal and vertical guides.
- Drag/move/select/delete guides.
- Configure field X/Y expansion.
- Attach and detach object edges.
- Undo/redo every guide/rule action.
- Save and reopen without losing IDs or relationships.
- Zoom and pan coordinates remain correct.
- Guide overlays are visible in authoring mode and absent from rendered output/export/print.
- Invalid or deleted guide references are detected and recoverable.

### 14.4 Package and compatibility tests

- Build and parse a package containing variable-layout metadata.
- Verify manifest checksums and asset resolution remain correct.
- Open existing version-2 package fixtures and compare output with pre-feature golden output.
- Open malformed version-3 package fixtures and check useful validation errors.
- Ensure layout metadata survives package build, parse and asset resolution.

### 14.5 Repeat-band tests

- One row and multiple rows.
- Rows with short and long descriptions.
- Different cells in a row need different heights; row height equals the required height of the tallest supported cell.
- Correct placement of subsequent rows and trailer.
- `maxItems` is enforced and warning behaviour remains correct.
- Computed subtotal/total continues to use input values and is independent of row-height calculations.

### 14.6 Integration tests

- Web renderer with legacy and variable templates.
- Android bridge `deriveForm` and `render` contract.
- Android WebView runtime readiness and failure envelope.
- Preview refresh after text input changes.
- Print from final HTML, correct orientation and page bounds.
- Ensure a failed/unsupported layout produces a reported failure or warning, not a blank page without explanation.

### 14.7 Existing checks

The current pipeline document lists these commands; confirm scripts still exist in the actual repository and run the applicable checks:

```bash
# Web
npm run typecheck
npm run lint
npm test
npm run build:billkit
npm run prepare:android-assets

# Android (follow repo's current Gradle guidance)
./gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

Update test counts in final reporting rather than hard-coding expected counts; tests will be added by this feature.

## 15. Acceptance criteria / Definition of Done

The feature is ready for review only when all relevant criteria pass:

- [ ] A designer can enable expansion for a field independently on X and Y.
- [ ] Fixed, bounded and unbounded growth semantics are documented and tested.
- [ ] A field configured as X fixed / Y unbounded wraps and grows vertically without changing its width.
- [ ] A horizontal guide can move when connected field content grows.
- [ ] A vertical guide can move when horizontal expansion is enabled.
- [ ] Connected borders/rectangles can stretch while preserving their anchored opposite edge.
- [ ] Connected downstream objects can move without changing size.
- [ ] Unconnected objects stay put.
- [ ] Asymmetric layouts work without imposing a uniform grid.
- [ ] Multiple fields sharing a boundary are handled deterministically.
- [ ] Guide cycles, caps and impossible constraints are reported safely.
- [ ] Layout starts from base geometry on every render and never accumulates growth from previous renders.
- [ ] Variable-height repeating rows are supported before declaring the full table use case complete.
- [ ] Document growth/fixed-page overflow policy is explicit and honoured during print/export.
- [ ] Editor-only guides never appear in the final bill unless separately drawn as actual bill artwork.
- [ ] Existing template version 2 files preserve their legacy appearance/behaviour.
- [ ] Web and Android use the shared TypeScript layout semantics.
- [ ] Web typecheck/lint/tests and Android build/tests/lint pass, or any remaining failure is clearly identified and justified.
- [ ] A demo `.btpkg` illustrates the main feature and a brief implementation/limitation note is included in project docs.

## 16. Implementation guardrails for the coding agent

1. **Inspect before editing.** Read the real implementations and tests for template types, rendering, repeat bands, package validation, canvas serialization, bridge/runtime, Android DTOs and printing.
2. **Do not replace the renderer wholesale.** Add the layout pass at a clear seam and preserve the existing rendering primitives wherever possible.
3. **Do not break the pure bridge.** DOM measurement belongs in a browser/runtime adapter; the geometry solver must be pure.
4. **Do not make the Android frontend a second layout engine.** Kotlin must consume shared-render output.
5. **Do not mutate source geometry while rendering.** Each render is calculated from authored/base geometry.
6. **Do not use guide intersections as implicit constraints.** Only serialized bindings can cause objects to move/stretch.
7. **Do not silently degrade.** Invalid references, capped growth, overflow, and non-convergence should result in explicit diagnostics.
8. **Do not treat unbounded as truly infinite.** Use finite implementation limits and explain them.
9. **Do not silently change legacy output.** Version-2 templates must remain on their established path.
10. **Do not add support for every object kind at once.** Establish supported object kinds in code and tests; implement text + rectangles/borders first, then tables/repeat rows.
11. **Do not trust JSON.** Validate all imported template metadata and keep existing HTML escaping/safety guarantees.
12. **Do not claim print correctness based only on browser preview.** Verify the actual Android/Web print path and resulting page dimensions.
13. **Keep this plan current.** If a current-code constraint forces a change, update the relevant sections and explain why in the implementation summary.
14. **Work in small reviewable steps.** After each phase, run relevant tests and report files changed, behaviour added, tests run, results, and remaining limitations.

## 17. Suggested first demo scenario

Create a template with these objects:

- Fixed header and logo.
- Customer-details rectangle with a bottom horizontal guide and right vertical guide.
- Address field: X fixed, Y unbounded, wrapping enabled, tied to the bottom guide.
- Company-name field: X bounded, Y bounded.
- Vehicle details on the right, not attached to the customer address region unless explicitly configured.
- Goods table whose top edge follows the customer-details bottom guide.
- Table border that stretches vertically to contain its dynamic rows.
- Total/footer below the table, attached to the table's final bottom boundary or moved by the corresponding section layout rule.
- Outer document boundary set to vertical expansion with a safe maximum height.

Test at least three inputs:

1. Short address: the bill looks identical to the base design.
2. Long address: the details section expands down, the connected table and footer move down, and unrelated fields do not move.
3. Extremely long address: growth limit is reached and a useful warning is returned; no object is silently lost or allowed to make the runtime loop indefinitely.

Then add goods rows with short and long descriptions to verify variable-height row handling.

## 18. Expected final output from the coding agent

At the end of implementation, report:

1. A short description of the final layout model and any differences from this plan.
2. Files changed and the purpose of each change.
3. The final serialized schema with one realistic template example.
4. How the measurement adapter and pure solver interact.
5. The supported guide/attachment/object behaviours and known limitations.
6. How version-2 templates are kept compatible.
7. Tests/commands run and their actual results.
8. A demo package or template path that can be opened in Web and Android.
9. Any incomplete feature or unresolved issue; do not label the implementation complete if a required acceptance criterion remains unmet.

---

## Implementation principle in one sentence

**Keep the original traced layout as immutable base geometry; measure the filled content, compute final geometry using explicit X/Y expansion policies and guide attachments in the shared TypeScript layer, then render and print that calculated result through the existing Web and Android pipeline.**
