# Editor Template Authoring Completion Plan

**Date:** 2026-10-17  
**Status:** In progress — authoring foundations implemented; product-critical gaps remain  
**Scope:** Complete the template authoring experience in the web editor so a business owner can create a reusable, accurate bill template from a scan or from a blank page, configure its dynamic fields and repeated rows, and verify the result before saving/exporting it.

This plan covers editor and template-authoring work. Hosting, user accounts, customer links, submission storage, and the hosted PDF pipeline belong to a separate product/backend plan.

## Implementation progress (2026-10-17)

Implemented in the current workspace:

- Page setup for A4, Letter, 58/80 mm receipts, and custom dimensions with mm/in/px entry. Document changes are undoable. Reference images now fit proportionally instead of being silently stretched.
- Bounded image intake (file bytes, decoded dimensions/pixels) and clearer load errors.
- Required, numeric min/max, and max-length field contracts; field-key edits update token occurrences and are undoable.
- Template JSON validation/migration at import and local-library boundaries, plus surfaced local-save failures.
- An editor preflight panel for structural/render warnings and off-page objects.
- Render and standalone-share forms now omit row-local repeat columns from ordinary inputs, validate repeated row data with the field contract, and apply computed values through the same renderer path.
- Automatic subtotal/total behavior is conservative when tax or discount fields exist; the preflight warns rather than guessing a financially meaningful formula.
- A “Check with sample values” preflight action measures long representative answers and three repeat rows in the browser, runs the same layout solver as output, and reports clipping/layout warnings and resulting page growth.
- Reference-photo crop, quarter-turn rotation, page-fit crop, and reset controls. These remain authoring-only and do not enter the template or exports.
- Debounced local recovery drafts with resume/discard on the start screen; references remain excluded from recovered template data.
- Preflight warnings now link to their field/object or layout guide, including unresolved tokens and sample-layout diagnostics.
- The Fields step now groups dynamic fields and repeating table bands in one place, with direct canvas selection, repeat key/band configuration, and a 200-row cap.
- Calculation rules can be stored with the template and package, using the renderer's decimal-safe `sum`, `sum-times`, `add`, `subtract`, `multiply`, and `percent` operations. Authors can define explicit tax/discount formulas and a final total.
- Preflight can stress the declared maximum repeat rows, and an in-editor print preview renders the same sample values through the standard HTML renderer and reports final page dimensions.
- App chrome uses local system font stacks so production builds do not need network access to Google Fonts.
- Placeholder contracts now support starting answers, and the customer form applies those defaults while leaving repeat-only and image fields out of ordinary form values.
- Defaults, required flags, numeric bounds and length limits now travel in the `.btpkg` manifest for native hosts; manifest validation rejects malformed contract values.

Still needed before describing the authoring workflow as production-complete:

- An explicit physical-size/DPI contract; perspective correction is not included.
- Stable template IDs and a clear single-page/import/export support contract. Local browser recovery drafts are implemented.
- Direct table-cell navigation from preflight, max-cap checks for real representative bills, and print preview acceptance across supported browsers/printers.
- Tool interaction/accessibility/onboarding audit and real-world acceptance workflows.

The workspace had pre-existing uncommitted changes before this implementation pass. Keep those changes intact when reviewing or continuing this work.

## 1. What the editor does today

The application mounts `BillEditor` at `/`. Its authoring state is held by `EditorController`, which owns a Fabric canvas and exposes a serializable `BillTemplate` contract. The main path is:

1. `UploadScreen` reads a PNG, JPEG, or WebP locally, or opens template JSON. The selected image becomes the editor's reference background.
2. The image's pixel dimensions become the document dimensions. A new blank document instead starts at the A4 pixel constants.
3. The owner traces using shape, line, freehand, text, table, field, image-slot, guide, and bill-part tools. The reference is not selectable and is excluded from serialization.
4. Properties, layers, grid/snapping, layout guides, and growth policies configure the traced structure.
5. The renderer derives fillable inputs from placeholders and fields, renders a preview, and offers PDF/HTML/print output.
6. Save writes to browser `localStorage`; JSON and `.btpkg` are downloadable formats. Share currently downloads a standalone HTML file.

The template layer is intentionally separate from Fabric: `lib/template/types.ts` defines the portable model; `serialize.ts` writes it; `hydrate.ts` reconstructs canvas objects. The pure renderer under `lib/render/` and layout solver are substantial assets to retain.

## 2. Completion target

An owner should be able to:

- Choose a known paper/receipt size or enter a custom page size, including units, when starting blank or preparing a scan.
- Align a photo/scan to the page, correct its orientation and framing, control its visibility while tracing, and avoid accidentally tracing a distorted or mismatched page.
- Trace the visible bill faithfully and make static artwork distinct from fields and repeated data.
- Define every dynamic field with a stable key, human label, input type, required/optional status, formatting and validation rules.
- Define line-item rows and totals without relying on undocumented placeholder naming conventions.
- Preview with representative values, see actionable errors/warnings for clipping, overflow, unresolved fields, invalid layout links, and unsupported export behavior, and correct them in the editor.
- Save a validated, versioned template and reopen it without losing page setup, field contracts, or layout configuration.

“Complete” is relative to an explicitly supported template contract. It does not mean arbitrary paper layouts or every country's legal/tax rules are inferred automatically.

## 3. Findings to address

### Authoring setup

- A reference image automatically sets page width and height from image pixels. There is no visible page-size, unit, DPI, crop, rotate, or perspective-correction workflow before tracing.
- A blank document uses A4 defaults; the visible Document panel offers “New blank document” and structure locking, but no page setup controls.
- `readImage` validates MIME type only and reads the whole image as a data URL. It has no explicit file-size or pixel-dimension limit, and no useful load-error state.

### Template contract and input definition

- `PlaceholderSpec` supports key, label, type, max length, and visual style, but not required state, defaults, numeric bounds, format/mask, or business validation rules.
- Dynamic values can be expressed as tokens in text/table cells or as standalone field objects. Keep both mechanisms compatible, but give authors one discoverable place to manage the complete field list and detect duplicate/conflicting keys.
- Repeating table rows exist, but repeated-row authoring and calculated totals need a clear workflow and a validated contract rather than implicit conventions.

### Quality checks and lifecycle

- The “Test” step opens the fill page; it is not itself a template preflight with a list of issues and direct navigation back to the offending object.
- Save is a local browser-library operation. `templateStore.writeAll` swallows quota/storage errors while the editor reports success. This is acceptable for a prototype only if errors are surfaced and the owner can export a backup.
- Imported JSON is parsed and cast to `BillTemplate`; JSON syntax is not schema validation. Validate before hydrating or rendering.
- The model and renderer are currently single-page. Make that a clear v1 constraint and refuse/flag unsupported content rather than implying multi-page output is ready.

## 4. Proposed implementation phases

### Phase 0 — Authoring contract and invariants

**Goal:** Decide what a v1 template promises before adding more controls.

- Document supported page sizes/units and the pixel-to-print conversion rule.
- Define field semantics: stable key, label, input type, required flag, default, formatting, and validation constraints.
- Define repeated-row and computed-total semantics, including decimal precision/rounding and what happens when rows are empty or exceed the cap.
- Define single-page behavior, supported image formats, font fallback behavior, and unsupported renderer/export cases.
- Add a versioned validation/migration boundary for templates. Keep Fabric details out of the persisted contract.

**Exit criteria:** A written v1 contract with examples for a simple invoice, a receipt with repeated item rows, and a fixed form with no dynamic rows.

### Phase 1 — Page setup and reference preparation

**Goal:** Make tracing start from a correctly sized, aligned page.

- Add a Page setup panel/dialog for A4/Letter, common receipt sizes, and custom width/height. Store physical dimensions and units (or a canonical pixel size plus DPI) in the template contract; do not silently treat arbitrary image pixels as print units.
- On image intake, enforce configurable file-byte and decoded-pixel limits; handle decode failures and show the image's detected dimensions.
- Add reference-only rotate and crop/fit controls. Preserve aspect ratio by default; make any stretch operation explicit. For photographed paper, offer a perspective-correction step only if the chosen library can produce a reliable result; otherwise clearly limit v1 to flat/scan images.
- Allow matching the page to the image, fitting the image inside a selected page, and resetting the alignment. Keep the reference out of export and template output.
- Show page boundary, zoom/fit, and reference opacity/visibility in a consistent place.

**Exit criteria:** Owners can start blank or from a supported scan and see a correctly sized, aligned, printable page before tracing; too-large/invalid images fail with a useful message.

### Phase 2 — Tracing and canvas precision

**Goal:** Make the existing drawing tools predictable for bill geometry.

- Audit all tools against one interaction contract: cursor/shortcut, drag or click behavior, cancel behavior, selection behavior, undo entry, keyboard focus, and small-screen availability.
- Ensure shape/text/table drawing, resizing, snapping, rotation, and alignment stay in document coordinates at all zoom levels. Keep snap-to-grid and snap-to-object behavior visible and independently controllable.
- Add authoring actions commonly needed for faithful reconstruction: align/distribute, duplicate, precise numeric position/size, multi-select, lock/hide, layer ordering, and undo/redo coverage. Reuse current controller operations when they already satisfy this.
- Clarify the difference between visual tracing objects, data fields, image slots, and embedded bill-part artwork in tool names and onboarding.
- Provide a “structure locked” mode that protects static artwork while leaving dynamic fields selectable; make its state and unlock route obvious.
- Review groups versus layout containers. Do not imply that editor grouping changes customer output; surface layout-parent/anchor relationships in language owners can understand.

**Exit criteria:** A representative bill can be traced, edited precisely, and reopened with geometry unchanged; every authoring operation has an undo path and no hidden reference pixels leak into output.

### Phase 3 — Data-field and repeated-row authoring

**Goal:** Turn traced boxes into an explicit, reliable form schema.

- Add a central Fields panel listing every token, standalone field, image slot, and repeat collection, with duplicate-key and unused-field detection.
- Provide stable key generation and editable labels/types. Renaming a key must update all token occurrences and table references in one undoable operation.
- Add required/optional, default value, max length, numeric min/max, date rules, currency scale/format, checkbox/tickmark behavior, and safe display formatting to the template contract.
- Add help/examples for tokens and prevent malformed token syntax from silently being treated as ordinary static text.
- Make repeated table authoring explicit: choose header rows and repeat band, map columns to item properties, set an item cap, and preview zero/one/many rows.
- Add computed fields/totals using a small validated expression/operation model (for example quantity × price and sum of line totals). Avoid arbitrary JavaScript evaluation.
- Make error states actionable from the panel: selecting a field focuses its canvas object/cell and its input contract.

**Exit criteria:** A bill with customer fields, a repeated line-item table, tax/discount, and total can be configured entirely through supported controls and produces deterministic results.

### Phase 4 — Template preflight and print preview

**Goal:** Catch mistakes before save/export.

- Add a preflight result model that separates blocking errors from warnings and identifies the object/field/cell involved.
- Check schema validity, missing or duplicate keys, unresolved tokens, broken guide/container references, invalid repeat bands, image-slot requirements, and invalid computed dependencies.
- Run layout with representative/sample values and report text clipping, page overflow, repeat-cap overflow, zero-sized/off-page objects, and unsupported fonts/exports.
- Add a print preview that uses the same resolved template, measurement, and renderer path as final output. Show page bounds, actual output size, and warnings without editor-only guides/reference images.
- Make unresolved placeholder handling explicit: either block final generation for required values or preserve a deliberately visible token with a warning.

**Exit criteria:** A user can find and correct each blocking issue directly; preview and downloaded output use the same filled snapshot and page geometry.

### Phase 5 — Save, reopen, migration, and recovery

**Goal:** Protect the owner's template work.

- Add a schema validator and migration pipeline for JSON and `.btpkg` imports before canvas hydration.
- Replace silent local-save success with an explicit result; show storage/quota errors and offer immediate JSON/package backup.
- Use stable template IDs and version metadata rather than template name as the identity. Keep names editable without overwriting another template.
- Add local autosave/recovery for the current draft, dirty-state indication, and recovery after refresh/crash. Keep saved template versions distinct from the active draft.
- Round-trip page setup, placeholder contracts, repeat/computed configuration, guides, and layout relationships through save → reopen → save.

**Exit criteria:** No malformed import can partially corrupt editor state, a failed save is visible, and a reopened template matches the validated authored state.

### Phase 6 — Finish the authoring UX

**Goal:** Make the advanced editor learnable and dependable for nontechnical business owners.

- Update the step path so completion reflects preflight-ready state, not only “an object exists,” “a dynamic field exists,” or “save was clicked.”
- Add a guided first-template flow and contextual tool instructions; retain direct access to all tools for experienced users.
- Audit keyboard navigation, screen-reader names/states, focus handling, contrast, narrow viewports, and touch input.
- Add draft/template naming, duplicate-template action, and clear empty/error/loading states.
- Capture representative screenshots and maintain end-to-end workflows for scan-based bills, blank forms, repeated rows, dynamic fields, import/reopen, and export preview.

**Exit criteria:** A first-time owner can complete the supported authoring flow without knowing Fabric, JSON, tokens, or CSS terminology.

## 5. Recommended order and dependencies

Implement in this order:

1. Phase 0 contract (blocks correct page and field work).
2. Phase 1 page/reference setup (blocks accurate tracing).
3. Phase 3 field contract and repeated-row authoring (defines what the editor is authoring).
4. Phase 4 preflight (validates page and data semantics together).
5. Phase 2 precision and interaction audit (reuse existing tools; fix proven gaps).
6. Phase 5 persistence and migrations.
7. Phase 6 onboarding/accessibility polish.

The current editor already has many Phase 2 foundations; begin with a capability audit and focused gaps rather than replacing `EditorController`, Fabric, the pure template model, or the renderer wholesale.

## 6. Cross-cutting design rules

- The persisted template model is the contract; Fabric objects are an editing implementation detail.
- Editor preview, browser fill page, standalone share output, and any future server renderer must agree on field resolution, layout measurement, repeat behavior, and final page size.
- Never silently discard unsupported or invalid template data during import, migration, or export.
- Never include the tracing reference image in customer output unless the owner explicitly adds it as a bill-part/artwork object.
- Keep calculations deterministic and decimal-safe for money; define rounding at the contract boundary.
- Prefer an explicit refusal/warning over a plausible but clipped or financially incorrect bill.
- Keep the current single-page v1 promise explicit. Multi-page templates require a deliberate model, editor page navigation, and export implementation as a separate phase.

## 7. Initial acceptance scenarios

1. Create a blank A4 invoice, add static labels, configure customer fields and a repeated item table, add a total, and save/reopen without drift.
2. Import a supported scan, set the intended physical page size, align the reference, trace the bill, hide the reference, and verify that only template objects appear in preview/export.
3. Enter long names, large quantities/prices, empty optional fields, and the maximum supported number of rows; preflight identifies overflow and invalid values before final output.
4. Import malformed, outdated, duplicate-key, and oversized files; each is rejected or migrated with a useful report and leaves the current draft intact.
5. Fail local persistence deliberately (for example quota/private mode); the user sees the failure and can export a backup rather than receiving a false success message.

## 8. Current workspace notes

The working tree already contains uncommitted changes. This plan is additive and does not assume those changes should be reverted or overwritten. Existing editor redesign plans cover visual shell and inspector work; this plan complements them with authoring correctness, field semantics, preflight, and recovery requirements.
