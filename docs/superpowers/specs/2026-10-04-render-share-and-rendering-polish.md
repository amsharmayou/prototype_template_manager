# Zoom pan clamp redesign, ellipse fix, file-based template picking, placeholder metadata, local fonts, and single-file .html share export

Date: 2026-10-04
Status: implemented

## Implementation notes

Built as specified, with three deliberate departures:

1. **Spec style is applied in `fillTemplate`, not `renderHtml`.** A style belongs to
   the *slot*, not to the drawing call, so it is resolved where the value is
   spliced in (`lib/template/dataBinding.ts`). A pure `{{token}}` text box or
   table cell takes the spec's family, size, weight, style and colour; a token
   sharing a line with other text keeps its host box's styling, because there is
   no way to restyle one run of an already-laid-out box. This also keeps
   `lib/render` a pure function of (template, values) with no knowledge of
   contracts, so the static export path is unaffected.
2. **Table cells can only carry size and weight.** `TableCell` has no font
   family or text colour of its own - both live on the table object - so a
   per-cell family or colour would be a schema change, not a rendering fix. The
   panel accepts the setting and the size/weight half takes effect; the
   limitation is stated in the README rather than silently dropped.
3. **Generated form inputs carry `name={key}`.** Added to `DynamicForm` so the
   app's form and the share kit agree on how a value is identified, and so a
   browser's autofill and the E2E tests can address a field without relying on
   label text.

## Follow-up fix: why the authorship colours never reached HTML

After shipping the share export, two defects surfaced: the traced colours were
missing from every HTML output, and placeholder customisations seemed ignored.

Root causes, per the audit:

| Property | Fabric preview / SVG / PDF path | HTML Document, `/render`, share |
|---|---|---|
| text ink (`fill`) | kept | **dropped** - `renderText` never read it (bug, always fallback) |
| font family not in a 10-entry whitelist | kept | **replaced by generic sans-serif** |
| table cell ink | only table-level `cellTextColor`/`headerTextColor` | n/a - no per-cell field existed |
| named CSS colour in hand-edited JSON | kept | refused (whitelisted hex/rgb only) |

Corrections:

- `renderText` now emits `color: ${safeColor(o.fill, "#000000", ...)}`, matching
  the Fabric semantics where a Text object's `fill` is its ink.
- `safeColor` now also accepts named colours and `hsl()/hsla()` in the standard
  syntaxes, still whitelist-constrained so an unknown word is refused rather
  than shipped as a dead declaration.
- `fontStack` now passes unknown family names through quoted (`"Name", sans-serif`)
  with a serif/mono cue heuristic, instead of silently substituting `sans-serif`;
  the whitelist was expanded to the full font list the editor offers.
- `TableCell.color` was added as an optional field; `fillTemplate` propagates a
  placeholder spec's colour onto cells, `serialize` keeps it, and `cellStyle`
  emits it over the table-level ink.

Known limits to state in docs rather than fix: text box background colour is
still not captured (no editor control for it), mixed-text placeholders keep the
host styling (pure-token rule per the product decision), and font *files* are
not embedded - a recipient needs the named face installed for true fidelity.

Two bugs were found by the new tests rather than by review: an empty-string
label beat key-name inference (`"" ?? "Ref"` is `""`, not `"Ref"`), and the share
kit's first draft wrote `""` for untouched inputs, which *erased* unfilled
placeholders instead of leaving them legible.

## Background

Users handle three workflows:

1. **Editor (`/`)** — trace a bill image into a structural template, save it, export formats.
2. **Renderer (`/render`)** — pick a template, get the dynamic form, fill values, preview and print the final document.
3. **Files shared out** — a template leaves this app and must drive the same generate-form → fill → print flow on a machine with no server.

The four reported problems during previous testing:

- An editor-drawn ellipse never paints on canvas, and Fabric-based exports (SVG/PDF/PNG) silently drop it.
- On the very first zoom step the page's edges behave like they weld to the pane top/bottom, and brushing vertically reads as "stuck at the margins."
- There was no way to pick a template file *for the renderer* on the first screen or from the editor handed setting.
- Placeholders were write-only: beyond `{{token}}` typing, the editor offers no way to declare the runtime contract of a variable (label, type, max length, style), forcing edits via raw JSON.

Scope of this design: the two bugs, a new file-import entry point, placeholder metadata, an expanded local font list, and the single-file `.html` share export ("no server on the recipient's side" deliverable).

---

## 1. Ellipse paints on canvas and through Fabric exports

Root cause (confirmed in `lib/canvas/EditorController.ts` and `lib/template/hydrate.ts`, and in `node_modules/fabric/dist/index.mjs`):

- Fabric 7 `Ellipse`'s only default is `ownDefaults = { rx: 0, ry: 0 }`. `_set` only does `width = rx * 2; height = ry * 2` when `rx`/`ry` are assigned; there is **no path** from `{ width, height }` back to `rx`/`ry`.
- `EditorController` constructs `new Ellipse({ left, top, width: 1, height: 1 })` and later calls `obj.set({ width, height })` — `rx`/`ry` stay `0` and `Ellipse._render` draws nothing. Toggling prediction arrays, Fabric path, `objectBox`/serialiser surface width/height only, the canvas paint breaks for that object shape. The HTML renderer does not use it — it applies `border-radius: 50%`.
- `hydrateShape` produces the same zero-radius ellipse, so every export that relies on Fabric (`exportSvg`, `exportPdf`, `exportPng`) also misses a scripted ellipse.

Fix, applied to all three constructionsites (`beginShape`, `updateDrawing`, `hydrateShape`):

```
obj.set({ width: w, height: h });
obj.set({ rx: w / 2, ry: h / 2 });
```

(and supply `rx`/`ry` when constructing: `rx: width / 2, ry: height / 2`).

**Testing**

- unit: an ellipse mutated through the template-serialise → hydrate cycle carries `rx = width/2`, `ry = height/2`.
- E2E: an ellipse drawn in the editor shows a non-zero `rx`/`ry` on the live canvas object (and still serialises as `type: "ellipse"`).

## 2. Zoom/pan clamp: free overscroll, no edge-welded page

For axes where the content is narrower than the pane we centre it, as before. The weld comes from the no-overscroll range `[pane - img, 0]`, which, for a page very close to the pane's size, is functionally zero.

New contract for `clampPan(t, paneSize, imgSize)`:

| case | allowed `t` |
|---|---|
| `imgSize <= paneSize` | `(paneSize - imgSize) / 2` (centred) |
| `imgSize > paneSize` | `[paneSize - imgSize - SLACK, SLACK]`, with `SLACK = 32` |

32 px lets the user unstick a page stuck at either margin, while keeping a page-sized strip visible at all times — the user can never lose the border by panning.

`fit()` and the wheel-anchored `zoomAt` keep their per-axis "contain + centre" semantics — the clamp only bounds the outcome, so whatever the article says today behaves like before at fit. `panBy(0, 0)` now ALSO re-clamps correctly along the new margins (used by `restoreSnapshot` to coerce a foreign template's larger page into the current pane).

**Testing**

- `tests/viewport.test.ts` — every `clampPan`/`panBy` case asserts the new ranges; the "edge pinning" cases assert the 32 px slush instead of exact edge contact.
- `e2e/workflow.spec.ts` — the "panning never goes past the image boundary" case changes from a strict edge-pin assertion to asserting both the 32 px slack on one side (`tx <= 32`, `ty <= 32`) and the slack on the other side (`tx >= paneW - docW*zoom - 32`).

## 3. Pick a template file from the home page

`UploadScreen` gains a second drop area next to the bill drop area that accepts only `application/json`/`.json`, parses it, and routes directly to `/render`:

```
onTemplateForRender: read file → JSON.parse → setPendingTemplate → router.push("/render")
```

The dynamic form is already derived from any picked template on `/render`, so this is purely an entry-point completeness change; the existing "Open saved template instead" (editor path) remains.

## 4. Placeholder metadata inside the editor

The editor can already put `{{tokens}}` into any text box and can already place `image-placeholder` slots. What it cannot do is tell the runtime what a variable is called, what type of value it wants, or how its final substitution should look. This design fixes that.

### 4.1 Schema: `meta.placeholders[]`

`BillTemplate.meta` gains an optional array:

```jsonc
{
  "meta": {
    "name": "acme-invoice",
    "modifiedAt": "…",
    "placeholders": [
      {
        "key": "customer_name",      // `{{customer_name}}` token, or an image slot's placeholderRole
        "label": "Customer name",    // label rendered in the /render form
        "type": "text",              // "text"|"number"|"date"|"currency"|"image"
        "maxLength": 60,             // applied to text inputs in the form
        "fontFamily": "Georgia",
        "fontSize": 15,
        "fontWeight": "bold",        // "normal"|"bold"
        "fontStyle": "italic",       // "normal"|"italic"
        "color": "#111111"           // fill of the rendered value
      }
    ]
  }
}
```

Optional array, absent ⇒ everything behaves exactly as today. `TEMPLATE_VERSION` stays `1`.

### 4.2 Detection

`extractTemplateFields` visits every object:

- `text` and table cells: derive keys via `extractVariables`, as today.
- `image-placeholder`: derive one key per slot, keyed by `placeholderRole`.

For each key, the matching `meta.placeholders` entry **overrides** the inferred label/type/presets: the form type directly (or `defaultValue`) drives the input type on `/render` (`type: "number"` ⇒ a numeric input; `maxLength` is passed through), the label is what the user sees next to the input, and the style fields reach `renderHtml` for the rendered document (see 4.4).

### 4.3 Creation UX

In the properties panel, with any object selected, a new **Placeholder fields** section lists every discovered `key` plus (separately) image slots. Each row exposes that key's metadata with form inputs:

- **Shown label** (free text)
- **Type**: touchy picker — text / number / date / currency / image
- **Max length**: number input (only meaningful for text)
- **Font**: the expanded local-system list (Section 5)
- **Size**: number input in pixels
- **Bold / Italic**: checkboxes pair
- **Fill**: colour input

Editing any field writes the spec back into `meta.placeholders` (creating the array if absent). Deleting a spec from the doc (clearing the characters) reverts that key to today's inferred behaviour. An extra inline block lists the tokens to type for convenience. Image placeholders carry the same row set for role/roles that are deliberately orthogonal by var; I don't tie image contents to type; they're `type: "image"` and take a fill colour only.

### 4.4 Style is the final appearance

Implemented explicitly through static CSS in `lib/render/primitives.ts`: when a spec exists for a triggered slot, the rendered value gets `font-family`, `font-size`, `font-weight`, `font-style`, `color` as inline style on its rendered node, not just as parameters for the input. If a token appears in a text box that also carries explicit formatting, the spec overrides: "Design the contract; the value honors the spec."

## 5. Fonts: extend the local list

`FONTS` in `PropertiesPanel.tsx` expands from six families to the standard local kit, and a free-text fallback stays behind a « Custom… » input so cualquier browser-installed face still works. The list:

`Arial`, `Helvetica`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Impact`, `Comic Sans MS`, `Georgia`, `Palatino Linotype`, `Book Antiqua`, `Times New Roman`, `Courier New`, `Lucida Console`, `Segoe UI`, `Calibri`, `Cambria`, `Garamond`, `Century Gothic`.

Bold/Italic are already selects on the text panel — I extend them with direct toggle-style checkboxes so italic is as easy to flip as bold(e.g. long lists), and the new placeholder-spec panel exposes the same pair. The placeholder-spec style fields use the same constant.

## 6. Single-file HTML template share export

Design goal: a recipient double-clicks → a page opens (no server) with the dynamic form derived from the template, fill from own data, preview rendered HTML, print. No React/Fabric needed on load. DataBinding/Render runs through `lib/template/dataBinding` and `lib/render` — already platform-free. I need a thin browser-formbyse host.

### 6.1 Builder

`npm run build:share` (esbuild, an existing transitive dep I'll wire up):

```
esbuild lib/share/main.ts \
  --bundle --minify --format=iife \
  --outfile=public/sharekit.js
```

`lib/share/main.ts` is a small vanilla-TS entry:

- `bootShareKit(root, template, previewIframe)` — builds form fields via `extractTemplateFields` (merging `meta.placeholders` overrides), wires them to a `values` map with a change listener that re-`fillTemplate`s and refreshes the preview iframe's `srcdoc` with `renderHtml`.
- Print button calls `iframe.contentWindow.print()`.
- Nothing in it imports from `fabric`, `react` — the share bundle is self-contained.

### 6.2 Editor surface

New action in the top bar: **Share as .html…**. Implementation:

1. `fetch("/sharekit.js")` in the editor (dev + prod both serve `public/`); 2. inline that code as a `<script>…</script>` block; 3. template JSON inlined as a quoted, `</script>`-escaped piece inside `<script type="application/json">`; 4.  `bootShareKit(document.getElementById('share-app'), tmpl, document.querySelector('iframe'))`. Download the assembled string as `{template-name}.html`.

Recipient flow: saved file → opens in browser → form fields derived from `meta.placeholders` + tokens are live → fill → preview renders from `renderHtml` → Print → in the print dialog « Save as PDF » is the desktop route to the final printable PDF.

## 7. Testing additions

- `tests/viewport.test.ts` is updated per §2.
- A new `tests/ellipse.test.ts`-style case: hydrate an ellipse object through `hydrateShape` → `rx/ry` match the document dimensions; serialise/hydrate round-trip check.
- `tests/dataBinding.test.ts` gains cases for spec overrides.
- `e2e/render.spec.ts` gains: spec overrides form label/type/maxLength.

## Files it touches

```
choices:
├─ lib/canvas/EditorController.ts       (ellipse beginShape + updateDrawing ellipse set)
├─ lib/template/hydrate.ts              (hydrateShape ellipse arc rx/ry)
├─ lib/canvas/viewport.ts               (§2 clampPan contract)
├─ app/upload screen component          (§3 "Fill a template from disk" path)
├─ lib/template/types.ts                (§4.1 meta.placeholders)
├─ lib/template/placeholders.ts         (§4 spec parsing helpers)
├─ lib/template/dataBinding.ts          (§4.2 spec overrides)
├─ lib/render/primitives.ts             (§4.4 spec-style injection)
├─ components/editor/PropertiesPanel.tsx (§5 fonts + §4.3 placeholder table)
├─ app/render/RenderClient.tsx          (maxLength / label propagation is through DynamicForm only via fields)
├─ components/render/DynamicForm.tsx    (§4.2 label/type/maxLength propagation)
├─ TopBar                               (§6.2 "Share as .html…")
├─ esbuild/tsup.config or package script (§6.1 build:share)
├─ lib/share/main.ts                    (§6.1 standalone JS entry)
├─ public/sharekit.js                   (§6.1 built artifact, generated)
└─ tests / e2e                          (§7)
```

## Decision log

| question | answer |
| --- | --- |
| "stuck at top and bottom" is which of the proposed variants (a)-(c)? | (b): the page welds to the pane top/bottom when near-full vertical coverage; accepted fix is §2's overscroll. |
| Placeholder metadata's style feeds the final doc or the form? | Final document; form uses label/type/maxLength only. |
| Font list foundation? | Local-system fonts + an optional custom family name. |
| For "zip vs single html" template transfer: | Single `.html` per template (with embedded share-engine), local form derived, print-to-PDF at print time. |
