# Bill Part Cutouts

## Goal

Let an author capture a rectangular portion of the uploaded bill reference, normalize its background so it blends with the white digital bill, and keep the extracted image as a normal object in the template. The result must remain available without the original reference.

The cutout does not replace `image-placeholder`; that type remains for slots whose image is supplied dynamically when the bill is rendered.

## Scope

In scope:

- New **Bill Part** canvas tool, shortcut `B`.
- Drag-to-capture a rectangle from the current bill reference.
- Embed the resulting normalized crop in the template.
- Preserve the crop's aspect ratio during object placement and resizing.
- Move/copy a captured part anywhere else in the template.
- Replace the current image with **Recapture from current position**.
- Automatic paper-background whitening.
- Serialisation, hydration, undo/redo, layers, exports, and rendering support.

Out of scope:

- Freehand lasso extraction.
- A separate user-select-source-then-place panel.
- Advanced editing such as masking, denoising, OCR, colour grading, or manual background sampling.
- Retaining the entire reference in an exported standalone template.

## Type model

Add `bill-part` to `ObjectType` and a new object interface:

```ts
export interface BillPartObject extends TemplateObjectBase {
  type: "bill-part";
  /** Embedded normalized image data URL. Required after a successful capture. */
  src: string;
  /** Paper/tint removal was applied when `src` was produced. */
  normalized: boolean;
  /** Last successful capture bounds, in document coordinates. */
  sourceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

`TemplateObject`, `is...` guards, layer entry typing, and renderer dispatch include the new member.

The canvas instance can be a `FabricImage` with:

```ts
appType: "bill-part"
src: <the same embedded data URL>
normalized: boolean
sourceRect?: ...
```

Fabric's `type` remains `"image"`; the application type discriminates it, matching the existing pattern used by image placeholders.

## Tool behaviour

1. The author selects **Bill Part** (`B`) from the tool rail.
2. Dragging draws a box like a shape and does not commit until mouse-up.
3. If no reference is present, capture is disabled and an object is never created.
4. Releasing a sufficiently large box:
   - maps the box from document coordinates into reference-image natural pixels;
   - clips it to the valid reference bounds;
   - crops the reference;
   - normalizes the paper to white;
   - creates one embedded `bill-part` object at the captured location.
5. Releasing a too-small box, a box entirely outside the reference, or one whose crop has zero area creates nothing.

The default name is `Bill Part N`, where `N` is the count of existing bill parts plus one.

## Relocation and recapture

- Selecting, moving, duplicating, and layering a bill part does not modify `src`.
- The properties panel offers **Recapture from current position**.
- Recapture:
  - uses the object's current unrotated document-space bounds if available;
  - captures and normalizes a new crop;
  - replaces `src` and `sourceRect`;
  - preserves the existing id, name, role, layer position, selection, opacity, rotation, and visibility as appropriate;
  - creates one undo history step (“Recapture bill part”).
- Recapture requires a reference. If none is loaded, the button is disabled and the current embedded image is unchanged.
- If the object is rotated, the recapture source is the current axis-aligned bounding box in document coordinates; this is intentionally a coarse source remap rather than a rotated perspective crop.

## Background normalization

Normalization is opt-out. It is on by default so an existing author's crops are unchanged, and neither the capture path nor the normalizer is a global colour correction — it applies only to the crop being cut.

Two controls, with deliberately separate meanings:

- **Capture default** — `state.normaliseBillParts`, a checkbox in the Reference Image panel labelled "Whiten paper on new parts". It governs new cuts only.
- **Per-part override** — the selected part's own `normalized` flag, shown as a "Whiten paper" checkbox in its Bill Part panel. Ticking or unticking re-cuts that part from wherever it currently sits.

The Recapture button deliberately re-cuts at the part's *own* current setting rather than the editor default. If it followed the default it would silently undo whatever the part's checkbox had just done, and the two controls would fight.

When normalization is off the crop skips the `getImageData`/`putImageData` round-trip entirely rather than normalising to nothing, so an as-is crop stays pixel-exact and skips a full-canvas flood fill and re-encode.

An absent `normalized` reads as as-is. Nothing is destructive by default: a hand-edited template that omits the flag must not have its pixels whitened on reload.

Implementation is a small canvas-independent helper plus an offscreen-canvas wrapper.

Algorithm:

1. Build an RGBA copy of the crop.
2. Estimate the paper colour from pixels along the crop's border.
3. Estimate a tolerance from the border pixels' distances from the median paper colour, clamped to a practical range.
4. Start a flood fill from all border pixels.
5. Replace a border-connected pixel with white when its colour is within the paper tolerance.
6. Leave every unconnected pixel unchanged, so a light bill body enclosed by a coloured stamp/logo boundary does not get lost accidentally.
7. Preserve alpha and anti-aliased image structure; do not binarize the whole image to black and white.

This preserves ink, logo colours, and general object colour. It is not perfect removal of every scan shadow, but it should produce a white-looking background without turning the content white as well.

## Geometry and aspect ratio

- The source crop's width/height ratio is the object's intrinsic aspect ratio.
- The placed object width/height match the drawn document-space box, clipped to the reference.
- Corner resizing preserves that ratio; private narrow side handles remain allowed only when the controller explicitly chooses independent scaling for editor manipulation. Template exports always honour the saved width/height and therefore the saved aspect ratio.
- `sourceRect` is stored in document coordinates but is never required for rendering or export.

## Persistence

- `src` is embedded in the object as a PNG data URL.
- `sourceRect` is metadata used by recapture; it is not needed to display/export.
- `normalized` records whether the stored `src` is already background-normalized.
- Template save/load validates and round-trips all three fields.
- Undo/redo round-trips through the same serializer/hydrator path and must preserve the embedded image.

## Renderer and export

Renderer dispatch adds:

```ts
case "bill-part":
  renderBillPart(object, ...)
```

The output is a normal `<div/img>`/`position:absolute` image payload with the existing safe-image-src rules. Export preloads the object's `src`, like existing bound image placeholders, so the exported standalone template remains local and does not need the authoring reference.

## Failure handling

- No reference, missing image data, or an empty clipped source: no object/no replacement, existing state unchanged.
- Tiny crop: no object.
- Canvas API/data-URL conversion failure: command is surfaced as a no-op and no history entry is made.
- Missing embedded `src` on an imported malformed template: renderer shows the existing missing/invalid image handling rather than a broken absolute-positioned frame.

## Testing

Unit:

- Paper colour estimation from synthetic RGBA data.
- Border-connected white-paper replacement.
- Content pixels farther from paper survive unchanged.
- Enclosed non-border-connected regions are not recolored.
- Serialization/hydration round-trips `bill-part` with `src`, `normalized`, and `sourceRect`.

E2E:

- Create a reference segment with a visibly tinted paper colour and place a `bill-part` over it.
- `getTemplate()` reports the new type and embedded image src.
- Duplicate/move preserves the same src.
- Recapture with a missing reference is disabled/no-op.
- Rendered/exported HTML contains the embedded image, proving the viewer does not need the authoring reference.

## Verification gate

Before considering the work complete:

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
$env:PORT="3000"; npx.cmd playwright test
npm.cmd run build
```
