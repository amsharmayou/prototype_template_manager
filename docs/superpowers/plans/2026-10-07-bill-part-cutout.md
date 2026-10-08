# Bill Part Cutout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Bill Part tool that captures a normalized rectangular crop from the bill reference and stores it in the standalone template.

**Architecture:** A small DOM crop/normalization module extracts an offscreen PNG and a `bill-part` Fabric object represents it on the canvas. Template serialisation, hydration, the canvas renderer, and export all treat the new object independently; the reference remains an editing aid only.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Fabric.js 7.4, Vitest (node), Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-07-bill-part-cutout-design.md`

## Global Constraints

- Windows PowerShell. `npm.cmd` / `npx.cmd`; bare `npm`/`npx` fail.
- E2E: `$env:PORT="3000"; npx.cmd playwright test`.
- Gate: `npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run lint`, `$env:PORT="3000"; npx.cmd playwright test`, `npm.cmd run build` — all clean.
- Existing `image-placeholder` objects and table imports must continue to hydrate/export unchanged.
- Serialized `bill-part.src` is a data URL, so template output stays standalone.
- No commits unless the user explicitly asks.

---

### Task 1: Template model and serialiser

**Files:**
- Modify: `lib/template/types.ts`
- Modify: `lib/template/serialize.ts`
- Modify: `lib/canvas/EditorController.ts`
- Test: `tests/serialize.test.ts`

**Interfaces:**
- Consumes: existing `TemplateObjectBase`, `ObjectType`, and `SerialisableObject`.
- Produces: `BillPartObject`, `"bill-part"`, `serialiseBillPart`.

- [ ] **Step 1: Add the failing type/serialiser tests**

Append to `tests/serialize.test.ts`:

```ts
describe("serialiseObject: bill parts", () => {
  it("keeps the embedded crop and recapture metadata", () => {
    const out = serialiseObject(
      fake({
        type: "billpart",
        appType: "bill-part",
        src: "data:image/png;base64,AAAA",
        normalized: true,
        sourceRect: { x: 10, y: 20, width: 30, height: 40 },
        width: 30,
        height: 40,
      }),
      0,
    ) as unknown as Record<string, unknown>;

    expect(out.type).toBe("bill-part");
    expect(out.src).toBe("data:image/png;base64,AAAA");
    expect(out.normalized).toBe(true);
    expect(out.sourceRect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm the failure**

Run: `npm.cmd test -- serialize`
Expected: a failure because `serialiseObject` drops the unknown `"bill-part"` type.

- [ ] **Step 3: Extend the template types**

Add to `lib/template/types.ts`:

```ts
  | "bill-part"
```

Add after `ImagePlaceholderObject`:

```ts
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BillPartObject extends TemplateObjectBase {
  type: "bill-part";
  /** Embedded crop, normalised for white paper. */
  src?: string;
  normalized?: boolean;
  sourceRect?: SourceRect;
}
```

Update `TemplateObject`:

```ts
  | ImagePlaceholderObject
  | BillPartObject
  | FieldObject
  ...
```

- [ ] **Step 4: Serialise the new fields**

In `lib/template/serialize.ts`, import and insert `BillPartObject`.
In `defaultName`, add:

```ts
    "bill-part": "Bill Part",
```

Add:

```ts
function serialiseBillPart(
  o: SerialisableObject,
  zIndex: number,
): BillPartObject {
  const sourceRect =
    o.sourceRect &&
    typeof o.sourceRect === "object" &&
    typeof (o.sourceRect as SourceRect).x === "number" &&
    typeof (o.sourceRect as SourceRect).y === "number" &&
    typeof (o.sourceRect as SourceRect).width === "number" &&
    typeof (o.sourceRect as SourceRect).height === "number"
      ? (o.sourceRect as SourceRect)
      : undefined;
  return {
    ...baseFields(o, zIndex),
    type: "bill-part",
    ...(typeof o.src === "string" && o.src.length > 0 ? { src: o.src } : {}),
    normalized: o.normalized === true,
    ...(sourceRect ? { sourceRect } : {}),
  };
}
```

Update imports:

```ts
import type {
  ...
  BillPartObject,
  SourceRect,
  ...
} from "@/lib/template/types";
```

Add the switch arm:

```ts
    case "bill-part":
      return serialiseBillPart(o, zIndex);
```

- [ ] **Step 5: Associate the app type**

In `lib/canvas/EditorController.ts`, add to `APP_TYPE_FOR`:

```ts
  "bill-part": "bill-part",
```

- [ ] **Step 6: Verify**

Run: `npm.cmd test -- serialize`
Expected: PASS.

---

### Task 2: Paper normalization

**Files:**
- Create: `lib/canvas/paperNormalise.ts`
- Create: `tests/paperNormalise.test.ts`

**Interfaces:**
- Consumes: a raw RGBA pixel array backing an `ImageData` object.
- Produces: `estimatePaperColour`, `normalisePaper`.

- [ ] **Step 1: Add failing normalizer tests**

Create `tests/paperNormalise.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimatePaperColour, normalisePaper } from "@/lib/canvas/paperNormalise";

function rgb(data: Uint8ClampedArray, index: number): [number, number, number] {
  return [data[index * 4]!, data[index * 4 + 1]!, data[index * 4 + 2]!];
}

describe("estimatePaperColour", () => {
  it("uses the border tint", () => {
    const data = new Uint8ClampedArray(4);
    for (let i = 0; i < 4; i++) data.set([238, 226, 200, 255], i * 4);
    expect(estimatePaperColour(data, 2, 2)).toEqual([238, 226, 200]);
  });
});

describe("normalisePaper", () => {
  it("turns border-connected tinted paper white and keeps content", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([238, 226, 200, 255], i * 4);
    data.set([0, 0, 0, 255], (1 * width + 1) * 4);
    data.set([10, 90, 200, 255], (2 * width + 2) * 4);

    normalisePaper(data, width, height);

    expect(rgb(data, 0)).toEqual([255, 255, 255]);
    expect(rgb(data, 1 * width + 1)).toEqual([0, 0, 0]);
    expect(rgb(data, 2 * width + 2)).toEqual([10, 90, 200]);
  });

  it("does not recolour an enclosed patch that never connects to the border", () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([238, 226, 200, 255], i * 4);
    for (let y = 1; y < 4; y++) data.set([30, 30, 30, 255], (y * width + 1) * 4);
    for (let x = 1; x < 4; x++) data.set([30, 30, 30, 255], (3 * width + x) * 4);
    for (let y = 1; y < 4; y++) data.set([30, 30, 30, 255], (y * width + 3) * 4);
    data.set([238, 226, 200, 255], (2 * width + 2) * 4);

    normalisePaper(data, width, height);

    expect(rgb(data, 0)).toEqual([255, 255, 255]);
    expect(rgb(data, 2 * width + 2)).toEqual([238, 226, 200]);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm.cmd test -- paperNormalise`
Expected: missing module.

- [ ] **Step 3: Implement the normalizer**

Create `lib/canvas/paperNormalise.ts`:

```ts
const clampChannel = (n: number): number =>
  Math.min(255, Math.max(0, Math.round(n)));

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
  i: number,
  data: Uint8ClampedArray,
): number {
  const dr = a[0] - data[i]!;
  const dg = a[1] - data[i + 1]!;
  const db = a[2] - data[i + 2]!;
  return Math.sqrt(dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114);
}

export function estimatePaperColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  return n === 0 ? [255, 255, 255] : [clampChannel(r / n), clampChannel(g / n), clampChannel(b / n)];
}

export function normalisePaper(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const paper = estimatePaperColour(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue: Array<[number, number]> = [];
  const max = 54;
  for (let x = 0; x < width; x++) {
    queue.push([x, 0], [x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push([0, y], [width - 1, y]);
  }

  const canReplace = (x: number, y: number): boolean => {
    const i = pixelAt(data, width, x, y);
    const d = distance(paper, paper, i, data);
    return d < max;
  };

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const index = y * width + x;
    if (visited[index]) continue;
    visited[index] = 1;
    if (!canReplace(x, y)) continue;
    const i = pixelAt(data, width, x, y);
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm.cmd test -- paperNormalise`
Expected: PASS.

---

### Task 3: Document-to-image crop geometry

**Files:**
- Modify: `lib/canvas/paperNormalise.ts` is not required here.
- Create: `lib/canvas/billPartCrop.ts`
- Create: `tests/billPartCrop.test.ts`

**Interfaces:**
- Consumes: `ReferenceHandle`, template document dimensions, and a document-space box.
- Produces: `imageRectForBox`, `cropBillPart`, `BillPartCrop`.

- [ ] **Step 1: Add the failing geometry test**

Create `tests/billPartCrop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageRectForBox } from "@/lib/canvas/billPartCrop";

describe("imageRectForBox", () => {
  it("maps a document box to reference pixels", () => {
    expect(
      imageRectForBox(
        { left: 100, top: 60, width: 200, height: 80 },
        { width: 1000, height: 700 },
        { width: 500, height: 350 },
      ),
    ).toEqual({ left: 50, top: 30, width: 100, height: 40 });
  });

  it("clips to the reference image", () => {
    expect(
      imageRectForBox(
        { left: 400, top: 300, width: 400, height: 400 },
        { width: 500, height: 350 },
        { width: 1000, height: 700 },
      ),
    ).toEqual({ left: 800, top: 600, width: 200, height: 100 });
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm.cmd test -- billPartCrop`
Expected: missing module.

- [ ] **Step 3: Implement geometry + crop**

Create `lib/canvas/billPartCrop.ts`:

```ts
import { normalisePaper } from "@/lib/canvas/paperNormalise";
import type { ReferenceHandle } from "@/lib/canvas/referenceBackground";
import type { SourceRect } from "@/lib/template/types";

export interface DocumentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function imageRectForBox(
  rect: DocumentRect,
  doc: { width: number; height: number },
  image: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const sx = image.width / Math.max(1, doc.width);
  const sy = image.height / Math.max(1, doc.height);
  const left = Math.max(0, Math.round(rect.left * sx));
  const top = Math.max(0, Math.round(rect.top * sy));
  const right = Math.min(image.width, Math.round((rect.left + rect.width) * sx));
  const bottom = Math.min(image.height, Math.round((rect.top + rect.height) * sy));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export interface BillPartCrop {
  src: string;
  sourceRect: SourceRect;
  width: number;
  height: number;
  image: HTMLImageElement;
}

export function cropBillPart(
  ref: ReferenceHandle,
  doc: { width: number; height: number },
  rect: DocumentRect,
): BillPartCrop | null {
  const box = imageRectForBox(rect, doc, { width: ref.width, height: ref.height });
  if (box.width < 2 || box.height < 2) return null;
  const source = ref.image.getElement() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  const imageData = ctx.getImageData(0, 0, box.width, box.height);
  normalisePaper(imageData.data, box.width, box.height);
  ctx.putImageData(imageData, 0, 0);
  const src = canvas.toDataURL("image/png");
  const image = new Image();
  image.src = src;
  return {
    src,
    sourceRect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    width: box.width,
    height: box.height,
    image,
  };
}
```

- [ ] **Step 4: Verify**

Run: `npm.cmd test -- billPartCrop`
Expected: PASS.

---

### Task 4: BillPart Fabric object

**Files:**
- Create: `lib/canvas/objects/BillPartObject.ts`
- Modify: `lib/template/hydrate.ts`
- Test: add to `tests/serialize.test.ts` or E2E once Task 6 covers hydration.

**Interfaces:**
- Consumes: `fabric`, application metadata, and a stored image source data URL.
- Produces: `BillPartObject`, `hydrateBillPart`.

- [ ] **Step 1: Prove hydration is missing**

Run: `npm.cmd test -- serialize`
Expected: currently no specific `bill-part` hydration assertion. Add an assertion in Task 6 instead of forcing a Fabric-jsdom unit path.

- [ ] **Step 2: Add the object class**

Create `lib/canvas/objects/BillPartObject.ts`:

```ts
import { FabricObject } from "fabric";

import type { SourceRect } from "@/lib/template/types";

export class BillPartObject extends FabricObject {
  static type = "BillPart";
  readonly appType = "bill-part";
  readonly src: string;
  readonly normalized: boolean;
  readonly sourceRect?: SourceRect;
  private element: HTMLCanvasElement | HTMLImageElement;

  constructor(options: {
    src?: string;
    normalized?: boolean;
    sourceRect?: SourceRect;
    image?: HTMLCanvasElement | HTMLImageElement;
  } = {}) {
    super();
    this.src = options.src ?? "";
    this.normalized = options.normalized === true;
    this.sourceRect = options.sourceRect;
    this.element = options.image ?? BillPartObject.blank();
    this.width ??= 1;
    this.height ??= 1;
    (this as unknown as { _controlsVisibility: Record<string, boolean> })._controlsVisibility = {
      tl: true,
      tr: true,
      bl: true,
      br: true,
      mtr: true,
    };
    this.set({ objectCaching: false } as never);
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const width = this.width ?? 1;
    const height = this.height ?? 1;
    if (this.src) {
      ctx.drawImage(this.element, -width / 2, -height / 2, width, height);
      return;
    }
    ctx.fillStyle = "rgba(147,51,234,0.06)";
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeStyle = "#9333ea";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
  }

  override _toSVG(): string[] {
    const { width = 0, height = 0 } = this;
    const src = this.src.replaceAll('"', "&quot;");
    return [
      `<image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${src}" preserveAspectRatio="none" />`,
    ];
  }

  override toObject(props: string[] = []): Record<string, unknown> {
    return {
      ...super.toObject(props),
      type: BillPartObject.type,
      appType: this.appType,
      src: this.src,
      normalized: this.normalized,
      ...(this.sourceRect ? { sourceRect: this.sourceRect } : {}),
    };
  }

  private static blank(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    c.getContext("2d")?.fillRect(0, 0, 1, 1);
    return c;
  }
}
```

- [ ] **Step 3: Hydrate from the template**

In `lib/template/hydrate.ts`, add to imports:

```ts
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
import type { BillPartObject as TemplateBillPart } from "@/lib/template/types";
```

Add:

```ts
function hydrateBillPart(o: TemplateBillPart, zIndex: number): FabricObject {
  const obj = new BillPartObject({
    src: typeof o.src === "string" ? o.src : undefined,
    normalized: o.normalized === true,
    sourceRect: o.sourceRect,
  });
  obj.set({
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(obj, o, zIndex);
}
```

Add:

```ts
    case "bill-part":
      return hydrateBillPart(o as TemplateBillPart, zIndex);
```

- [ ] **Step 4: Verify types**

Run: `npx.cmd tsc --noEmit`
Expected: no `bill-part` type errors.

---

### Task 5: Tool, canvas creation, and recapture

**Files:**
- Modify: `lib/canvas/EditorController.ts`
- Modify: `lib/canvas/objects/BillPartObject.ts`
- Modify: `lib/canvas/billPartCrop.ts`
- Modify: `components/editor/ToolRail.tsx`
- Modify: `components/editor/PropertiesPanel.tsx`

**Interfaces:**
- Consumes: `ToolId`, `EditorState`, `cropBillPart`, `BillPartObject`.
- Produces: `setTool("bill-part")`, `createBillPartFromBox`, `recaptureBillPart`.

- [ ] **Step 1: Add the toolbar identity**

In `lib/canvas/EditorController.ts`, extend `ToolId`:

```ts
  | "bill-part"
```

and `TOOL_LABELS`:

```ts
  "bill-part": "Bill Part",
```

In `ToolRail.tsx`, add icon:

```ts
  "bill-part": "✂",
```

and order:

```ts
  "bill-part",
```

after `"image-placeholder"`.

Add shortcut:

```ts
  "bill-part": "B",
```

- [ ] **Step 2: Draw the selection box before the crop**

In `EditorController.ts`, import:

```ts
import { cropBillPart } from "@/lib/canvas/billPartCrop";
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
```

Add the tool case:

```ts
      case "bill-part":
        this.beginBillPart();
        break;
```

and:

```ts
  private beginBillPart(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const obj = new BillPartObject();
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "bill-part", "Bill Part 1");
    canvas.add(obj);
    this.drawing = obj;
  }
```

- [ ] **Step 3: Replace the crop placeholder after mouseup**

In `onMouseUp`, after `const box = this.finaliseDrawing();` and the tiny-box bail, add:

```ts
    if ((obj as unknown as { appType?: string }).appType === "bill-part") {
      this.finishBillPart(obj, box);
      this.setTool("select");
      return;
    }
```

Add:

```ts
  private finishBillPart(
    obj: FabricObject,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) {
      canvas?.remove(obj);
      canvas?.requestRenderAll();
      this.refresh();
      return;
    }
    const crop = cropBillPart(
      this.reference,
      this.state.document,
      {
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
      },
    );
    canvas.remove(obj);
    if (!crop) {
      canvas.requestRenderAll();
      this.refresh();
      return;
    }
    const next = new BillPartObject({
      src: crop.src,
      normalized: true,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    next.set({
      id: (obj as unknown as { id?: string }).id,
      name: (obj as unknown as { name?: string }).name,
      role: (obj as unknown as { role?: string }).role,
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      selectable: true,
      evented: true,
    } as never);
    canvas.add(next);
    this.commit("Add bill part");
    this.selectFinished(next);
  }
```

- [ ] **Step 4: Recapture from the current box**

Add:

```ts
  recaptureBillPart(id: string): void {
    const canvas = this.canvas;
    const target = canvas?.getObjects().find(
      (o) =>
        (o as unknown as { id?: string }).id === id &&
        (o as unknown as { appType?: string }).appType === "bill-part",
    );
    if (!canvas || !this.reference || !target) return;
    const box = target.getBoundingRect();
    const crop = cropBillPart(this.reference, this.state.document, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    });
    if (!crop) return;
    const next = new BillPartObject({
      src: crop.src,
      normalized: true,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    const old = target as BillPartObject;
    next.set({
      id: (target as unknown as { id?: string }).id,
      name: (target as unknown as { name?: string }).name,
      role: (target as unknown as { role?: string }).role,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      angle: target.angle ?? 0,
      opacity: target.opacity ?? 1,
      visible: target.visible !== false,
      selectable: true,
      evented: true,
    } as never);
    canvas.remove(old);
    canvas.add(next);
    canvas.setActiveObject(next);
    this.commit("Recapture bill part");
  }
```

Use the same `crop.width/crop.height` relationship to keep the aspect ratio stable. If you preserve x/y props directly, use the drawn box's own `width/height`, not the crop natural size, and store `scaleX = box.width / crop.width` / `scaleY = box.height / crop.height`.

- [ ] **Step 5: Preserve initial crop proportions on resize**

In `EditorController`'s `object:scaling` handler, immediately before the grid/object snap pass, add:

```ts
    if (target instanceof BillPartObject) {
      const xFactor = target.scaleX ?? 1;
      const yFactor = target.scaleY ?? 1;
      const factor =
        Math.abs(xFactor - 1) >= Math.abs(yFactor - 1) ? xFactor : yFactor;
      target.set({ scaleX: factor, scaleY: factor } as never);
      target.setCoords();
    }

    if (this.state.snapToGrid) {
```

This makes every resize a corner resize and sets both axes proportionally. Keep the existing `_controlsVisibility` map in `BillPartObject` hiding edge handles so the user cannot create a sidewise "stretch" gesture.

- [ ] **Step 6: Add the recapture panel**

In `PropertiesPanel.tsx`, import/add:

```tsx
      {o.type === "bill-part" ? (
        <Panel title="Bill Part">
          <p className="text-[10px] text-neutral-400">
            Recapture uses the object's current canvas position to replace its image.
          </p>
          <Button onClick={() => controller.recaptureBillPart(o.id)}>
            Recapture from current position
          </Button>
        </Panel>
      ) : null}
```

Use `Bill Part` as the button name in E2E.

- [ ] **Step 7: Verify**

Run: `npx.cmd tsc --noEmit`
Expected: no errors in controller, panel, object, or tool files.

---

### Task 6: Renderer, exports, and persistence round-trip

**Files:**
- Modify: `lib/template/hydrate.ts`
- Modify: `lib/export/renderTemplate.ts`
- Modify: `lib/render/primitives.ts`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Consumes: a parsed `bill-part` template object with a data URL.
- Produces: a canvas object and an HTML renderer that keep the embedded image without the authoring reference.

- [ ] **Step 1: Add a renderer test**

Append to `tests/render.test.ts`:

```ts
it("renders a bill part as an embedded image", () => {
  const r = new Refusals();
  const out = renderObject(
    {
      ...base,
      type: "bill-part",
      src: "data:image/png;base64,AAAA",
      normalized: true,
      sourceRect: { x: 10, y: 20, width: 30, height: 40 },
    } as never,
    0,
    {},
    r,
  )!;

  expect(out).toContain("data:image/png;base64,AAAA");
  expect(out).toContain("<img");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm.cmd test -- render`
Expected: the new case is missing and the renderer refuses the unknown type or produces no image.

- [ ] **Step 3: Add the renderer case**

In `lib/render/primitives.ts`, import `BillPartObject` type and add:

```ts
function renderBillPart(o: BillPartObject, index: number, r: Refusals): string | null {
  if (!isSafeImageSrc(o.src)) {
    r.add(`${o.id}.src`, typeof o.src, "not a safe image source");
    return null;
  }
  return `<img class="o" ${anchor(index)} style="${attr(
    shell(o, r, ["object-fit: contain"]),
  )}" src="${attr(o.src)}" alt="${attr(o.name)}" />`;
}
```

Update import:

```ts
import type {
  ...
  BillPartObject,
  ...
} from "@/lib/template/types";
```

Add the dispatch case:

```ts
    case "bill-part":
      return renderBillPart(o, index, r);
```

- [ ] **Step 4: Ensure export hydration includes it**

In `lib/export/renderTemplate.ts`, change the preload filter:

```ts
      if (o.type !== "image-placeholder" && o.type !== "bill-part") return;
```

For `bill-part`, hydration already uses its own embedded `src`; do not import the reference.

- [ ] **Step 5: Verify**

Run:

```powershell
npm.cmd test -- render
npm.cmd test -- serialize
npx.cmd tsc --noEmit
```

Expected: PASS / PASS / no output.

---

### Task 7: E2E coverage

**Files:**
- Modify: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: fixture bill, `openEditorWithBill`, `docToPage`, and the editor controller hook.
- Produces: BillPart draw, recapture, no-reference behavior.

- [ ] **Step 1: Add the test sketches**

In the workflow suite, create a bill-part test:

```ts
test.describe("Bill part cutouts", () => {
  test("captures an off-white bill part and normalizes its background", async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    await openEditorWithBill(page);
    await page.evaluate(() => window.__btm.setZoom(0.5));

    await page.getByRole("button", { name: "Bill Part" }).click();
    const P = await docToPage(page);
    const a = await P(40, 40);
    const b = await P(180, 160);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const part = await page.evaluate(() => {
      const objs = window.__btm.getTemplate().objects as Array<Record<string, unknown>>;
      return objs.find((o) => o.type === "bill-part") as
        | (Record<string, unknown> & { src?: string; sourceRect?: unknown })
        | undefined;
    });

    expect(part).toBeTruthy();
    expect(part?.src).toMatch(/^data:image\/png/);
  });
});
```

For `Recapture`, add a second test in the same describe block. Reuse the Bill Part creation steps from the first test until `page.waitForTimeout(250)`, then:

```ts
    const before = await page.evaluate(() => {
      const o = (window.__btm.getTemplate().objects as Array<Record<string, unknown>>).find(
        (x) => x.type === "bill-part",
      );
      return o
        ? { id: o.id, src: o.src, x: o.x, y: o.y, width: o.width, height: o.height }
        : undefined;
    });
    expect(before).toBeTruthy();

    await page.evaluate((id) => {
      const canvas = window.__btm.getCanvas();
      const obj = canvas?.getObjects().find(
        (x) => (x as unknown as { id?: string }).id === id,
      );
      obj?.set({ left: ((obj.left as number) ?? 0) + 20 } as never);
      obj?.setCoords();
      canvas?.requestRenderAll();
    }, before!.id as string);

    const P = await docToPage(page);
    const inside = await P(
      (before!.x as number) + 20 + (before!.width as number) / 2,
      (before!.y as number) + (before!.height as number) / 2,
    );
    await page.mouse.click(inside.x, inside.y);
    await page.getByRole("button", { name: "Recapture from current position" }).click();

    const after = await page.evaluate(() => {
      const o = (window.__btm.getTemplate().objects as Array<Record<string, unknown>>).find(
        (x) => x.type === "bill-part",
      );
      return o ? { src: o.src, sourceRect: o.sourceRect } : undefined;
    });
    expect(after).toBeTruthy();
    expect(after!.src).not.toBe(before!.src);
  });
});
```

- [ ] **Step 2: Make the E2E test meaningful**

Use a real fixture that has a visibly tinted region or a "logo" block. If the current fixture is purely white, add a small tinted block to `e2e/make-fixture.ts` first, then regenerate:

```powershell
npm.cmd run fixture
```

- [ ] **Step 3: Run**

```powershell
$env:PORT="3000"; npx.cmd playwright test --grep "bill part|Bill Part"
```

Expected: PASS.

---

### Task 8: Full verification and Review

**Files:** all touched files above.

**Interfaces:** none.

- [ ] **Step 1: Typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Unit tests**

Run: `npm.cmd test`
Expected: all existing tests plus the new serialiser, normalizer, crop, hydrate/render, and template tests pass.

- [ ] **Step 3: E2E**

Run:

```powershell
$env:PORT="3000"; npx.cmd playwright test
```

Expected: all existing specs plus the new Bill Part flow pass.

- [ ] **Step 4: Lint and build**

Run:

```powershell
npm.cmd run lint
npm.cmd run build
```

Expected: clean.

- [ ] **Step 5: Ask before committing**

Do not commit unless the user explicitly requests it.
