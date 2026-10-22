import type {
  BillPartObject,
  FreehandObject,
  ImagePlaceholderObject,
  LineObject,
  PolygonObject,
  ShapeObject,
  TableCell,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";

import { Refusals, fontStack, safeAngle, safeColor, safeLength, safeOpacity } from "./css";
import { attr, escapeHtml } from "./escape";
import { resolveText } from "./values";

/**
 * Whether an unfilled slot is painted at all.
 *
 * Named here rather than imported from `./index` because `index` is the caller
 * and importing back would make the two modules circular.
 */
export type PlaceholderMode = "hide" | "show";

/**
 * Two decimals is the precision the traced geometry is stored at, so a longer
 * tail would be noise. It also keeps a float artefact out of the output:
 * 12 * 1.16 is 13.919999999999998 in binary floating point, not 13.92.
 */
function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** One style attribute, from one declaration per entry. */
function css(parts: readonly string[]): string {
  return `${parts.join("; ")};`;
}

/**
 * Every element carries a name derived from its index in the draw order. The
 * index is stable for a given template, which is what makes it worth having,
 * and it is unique within a sheet, so two objects cannot collide.
 */
function anchor(index: number): string {
  return `id="o${index}"`;
}

function div(index: number, cls: string, style: string, inner = ""): string {
  return `<div class="${cls}" ${anchor(index)} style="${attr(style)}">${inner}</div>`;
}

/**
 * The box, paint order and transparency every placed object shares.
 *
 * `x` and `y` are positions, not lengths, and are deliberately not run through
 * `length`: a negative offset is meaningful — an object may hang off the page
 * edge, where the sheet's `overflow: hidden` clips it — and `finiteBox` has
 * already refused a non-finite one. `width` and `height` are lengths, and a
 * negative one is discarded by the CSS parser, which would quietly hand the
 * element `width: auto` and let it size itself from its content instead of from
 * the box it was traced into.
 */
function placed(o: TemplateObject, r: Refusals): string[] {
  const id = typeof o.id === "string" ? o.id : "?";
  return [
    "position: absolute",
    `left: ${num(o.x)}px`,
    `top: ${num(o.y)}px`,
    `width: ${num(length(o.width, r, `${id}.width`, 0))}px`,
    `height: ${num(length(o.height, r, `${id}.height`, 0))}px`,
    // A fractional z-index is dropped by the CSS parser, which would lose the
    // paint order silently, so it is rounded to the whole number it stands for.
    `z-index: ${num(Math.round(safeLength(o.zIndex, 0)))}`,
    `opacity: ${num(safeOpacity(o.opacity))}`,
  ];
}

function shell(
  o: TemplateObject,
  r: Refusals,
  extra: readonly string[] = [],
  scale?: { x: number; y: number },
): string {
  const rotation = safeAngle(o.rotation);
  const parts = placed(o, r);
  const sx = scale?.x ?? 1;
  const sy = scale?.y ?? 1;
  // Whether a stretch is painted at all is independent of whether it is
  // uniform: a uniform drag is still a stretch, and dropping it because the
  // two factors happen to match is how a widened box silently comes back at
  // its natural size.
  const stretched = Math.abs(sx - 1) >= 0.001 || Math.abs(sy - 1) >= 0.001;
  const scalePart = `scale(${num(sx)}, ${num(sy)})`;
  if (rotation !== 0 && stretched) {
    // Rotate and stretch compose, and the order is not interchangeable:
    // Fabric's transform is `rotate * scale` about the object's centre, so the
    // scale is applied first and the turn second. Written the other way round
    // the box would tilt along a different diagonal.
    parts.push(
      `transform: rotate(${num(rotation)}deg) ${scalePart}`,
      "transform-origin: 50% 50%",
    );
  } else if (rotation !== 0) {
    parts.push(`transform: rotate(${num(rotation)}deg)`, "transform-origin: 50% 50%");
  } else if (stretched) {
    // Fabric scales a text object about its top-left, because that is the
    // origin the template records the box with.
    parts.push(`transform: ${scalePart}`, "transform-origin: 0 0");
  }
  return css([...parts, ...extra]);
}

const ALIGNMENTS = new Set(["left", "center", "right"]);

/**
 * Same grammar as `TOKEN_SOURCE` in `./values` and `TOKEN_SOURCE` in
 * `../template/placeholders`.
 *
 * Duplicated a third time on purpose. `values.ts` is part of the vendored
 * format package, so exporting from it would mean the admin server's copy has
 * to change with this file; this renderer is not vendored and is free to carry
 * its own. `renderPlaceholders.test.ts` asserts the three agree, which is what
 * makes the duplication safe rather than merely tolerated.
 */
const UNRESOLVED_TOKEN = /\{\{[^}]*\}\}/g;

/**
 * Removes the tokens that survived resolution because no value was supplied.
 *
 * `resolveText` deliberately leaves such a token in place, so a half-filled
 * page stays legible. That is the right call while authoring and the wrong one
 * on paper, where `{{Consignment OR}}` reads as content rather than as an
 * instruction, so this is applied only when the caller asked for a clean page.
 *
 * Deliberately wider than the grammar resolution uses. `resolveText` matches
 * `[a-zA-Z0-9_.-]+`, so a hand-authored token with a space in it -
 * `{{Consignment OR}}` - is not a token the renderer can ever resolve, and it
 * stays a literal mark on the bill forever. Hiding is the right answer for
 * those too: whatever survived resolution has no value and cannot acquire one,
 * so under this mode it is a placeholder mark rather than content.
 *
 * Only the token goes: a label with an unfilled slot keeps the words the author
 * traced around it, and a box whose whole content was one token empties to
 * nothing. An empty box carries no border, so it simply is not there.
 */
function stripUnresolvedTokens(text: string): string {
  return text.replace(UNRESOLVED_TOKEN, "");
}

function align(v: unknown, r: Refusals, field: string): "left" | "center" | "right" {
  if (typeof v === "string" && ALIGNMENTS.has(v)) return v as "left" | "center" | "right";
  r.add(field, String(v), "not an alignment; falling back to left");
  return "left";
}

function justify(v: unknown): "flex-start" | "center" | "flex-end" {
  if (v === "middle") return "center";
  if (v === "bottom") return "flex-end";
  return "flex-start";
}

function length(v: unknown, r: Refusals, field: string, fallback: number): number {
  const n = safeLength(v, fallback);
  if (n < 0) {
    r.add(field, String(v), "negative length; falling back to zero");
    return 0;
  }
  return n;
}

/**
 * A recorded stretch factor. Absent means "not stretched", which is 1; a
 * non-finite or non-positive value would collapse the transform and take the
 * whole text box with it, so it falls back to 1 and says so.
 */
function safeScale(v: unknown, r: Refusals, field: string): number {
  if (v === undefined || v === null) return 1;
  const n = safeLength(v, 1);
  if (!Number.isFinite(n) || n <= 0) {
    r.add(field, String(v), "not a positive scale; falling back to 1");
    return 1;
  }
  return n;
}

function finiteBox(o: TemplateObject): boolean {
  return (
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    Number.isFinite(o.width) &&
    Number.isFinite(o.height)
  );
}

function renderShape(o: ShapeObject, index: number, r: Refusals): string {
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const fill = safeColor(o.fill, "transparent", r, `${o.id}.fill`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  const radius =
    o.type === "ellipse" ? "50%" : `${num(length(o.cornerRadius, r, `${o.id}.cornerRadius`, 0))}px`;
  return div(
    index,
    "o",
    shell(o, r, [
      `border: ${num(width)}px solid ${stroke}`,
      `background: ${fill}`,
      `border-radius: ${radius}`,
    ]),
  );
}

function renderLine(o: LineObject, index: number, r: Refusals): string | null {
  const dx = o.x2 - o.x;
  const dy = o.y2 - o.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len)) {
    r.add(`${o.id}.endpoint`, `x2=${o.x2},y2=${o.y2}`, "not a finite length");
    return null;
  }
  if (len === 0) return null;
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const thickness = Math.max(length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1), 0.75);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // The bar is laid out flat and turned from its own left edge, so a traced
  // vertical line needs no width to begin with. The endpoints are absolute
  // document coordinates, so the traced slope is the whole line's direction on
  // its own; `rotation` is a further turn that Fabric re-applies at
  // `hydrate.ts:52`, on top of the same endpoints. Adding it rather than
  // dropping it is what reproduces the on-canvas slope of a rotated rule.
  const turn = angle + safeAngle(o.rotation);
  return div(
    index,
    "o",
    css([
      "position: absolute",
      `left: ${num(o.x)}px`,
      `top: ${num(o.y - thickness / 2)}px`,
      `width: ${num(len)}px`,
      `height: ${num(thickness)}px`,
      `z-index: ${num(Math.round(safeLength(o.zIndex, 0)))}`,
      `opacity: ${num(safeOpacity(o.opacity))}`,
      `background: ${stroke}`,
      "transform-origin: 0 50%",
      `transform: rotate(${num(turn)}deg)`,
    ]),
  );
}

function renderPolygon(o: PolygonObject, index: number, r: Refusals): string | null {
  const points = (Array.isArray(o.points) ? o.points : []).filter(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  if (points.length < 2) {
    r.add(`${o.id}.points`, String(points.length), "fewer than two finite points");
    return null;
  }
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  const pointsAttr = attr(points.map((p) => `${num(p[0])},${num(p[1])}`).join(" "));
  return (
    `<svg class="o" ${anchor(index)} style="${attr(shell(o, r, ["overflow: visible"]))}">` +
    `<polygon points="${pointsAttr}" fill="${attr(safeColor(o.fill, "transparent", r, `${o.id}.fill`))}"` +
    ` stroke="${attr(stroke)}" stroke-width="${num(width)}" /></svg>`
  );
}

function renderFreehand(o: FreehandObject, index: number, r: Refusals): string | null {
  // A template traced before the serialiser fix carries an empty string here,
  // and an empty path would put a zero-length mark on the page for every
  // pencil stroke the template ever had.
  if (typeof o.path !== "string" || o.path.trim() === "") {
    r.add(`${o.id}.path`, String(o.path), "empty path data");
    return null;
  }
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  return (
    `<svg class="o" ${anchor(index)} style="${attr(shell(o, r, ["overflow: visible"]))}">` +
    `<path d="${attr(o.path)}" fill="none" stroke="${attr(stroke)}"` +
    ` stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round" /></svg>`
  );
}

function renderText(
  o: TextObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  /** Extra declarations, appended last so they win over the defaults. */
  extra: readonly string[] = [],
  placeholders: PlaceholderMode = "hide",
): string {
  const size = length(o.fontSize, r, `${o.id}.fontSize`, 12);
  // Letter spacing is a font-relative measure, so it is stated in em and stays
  // correct when the family is substituted. It cannot move anything on the
  // page: the box is absolutely placed and the text is never wrapped.
  const tracking = num(safeLength(o.charSpacing, 0) / 1000);
  const distribution = justify(o.textVerticalAlign);
  // `fill` is the text's ink (Fabric semantics on Text), and it is the only
  // place a traced text box or a placeholder spec can state a colour. The
  // fallback matches every other object renderer: a traced box paints black.
  const ink = safeColor(o.fill, "#000000", r, `${o.id}.fill`);
  // A side or diagonal drag is stored as `scaleX`/`scaleY` beside the unscaled
  // text metrics, exactly as Fabric holds it. The element keeps those unscaled
  // metrics so the text still lays out against its own box — the transform is
  // what stretches it, so scaling the box as well would count the stretch
  // twice.
  const sx = safeScale(o.scaleX, r, `${o.id}.scaleX`);
  const sy = safeScale(o.scaleY, r, `${o.id}.scaleY`);
  // A wrapped box keeps its width and grows downward, so the traced height is
  // not a boundary. `overflow-wrap` is not cosmetic: `pre-wrap` alone will not
  // break a single unbreakable token, and a filled-in GSTIN or email address
  // would run straight past the box.
  const rawWrap = (o as { wrapWidth?: unknown }).wrapWidth;
  const wrapWidth =
    typeof rawWrap === "number" && rawWrap > 0
      ? length(rawWrap, r, `${o.id}.wrapWidth`, 0)
      : 0;
  const decls: string[] = [
    wrapWidth ? "white-space: pre-wrap" : "white-space: pre",
    ...(wrapWidth ? ["overflow-wrap: break-word"] : []),
    `color: ${ink}`,
    `font-family: ${fontStack(o.fontFamily)}`,
    `font-size: ${num(size)}px`,
    `line-height: ${num(size * safeLength(o.lineHeight, 1.16))}px`,
    `font-weight: ${o.fontWeight === "bold" ? "bold" : "normal"}`,
    `font-style: ${o.fontStyle === "italic" ? "italic" : "normal"}`,
    `text-align: ${align(o.textAlign, r, `${o.id}.textAlign`)}`,
    `letter-spacing: ${tracking}em`,
  ];
  const resolved = resolveText(typeof o.text === "string" ? o.text : "", values);
  const body =
    `<div class="tx" style="${attr(css([
      "display: flex",
      "flex-direction: column",
      `justify-content: ${distribution}`,
    ]))}">${escapeHtml(
      placeholders === "hide" ? stripUnresolvedTokens(resolved) : resolved,
    )}</div>`;
  return div(
    index,
    "o t",
    shell(
      o,
      r,
      // `height: auto` comes after `placed()` so it wins: the text grows past
      // the traced box instead of being clipped at it.
      [...decls, ...(wrapWidth ? ["height: auto"] : []), ...extra],
      { x: sx, y: sy },
    ),
    body,
  );
}

/**
 * The declarations every cell of one table shares, resolved once.
 *
 * These are all table-level fields, so looking them up inside the per-cell loop
 * re-validated the same value once per cell and reported one refusal per cell
 * for it. `refusals` is something a caller can show, so nine copies of the same
 * sentence with nothing to tell them apart is noise, not information.
 */
interface TableStyle {
  border: string;
  padding: string;
  family: string;
  headerFill: string;
  headerInk: string;
  cellFill: string;
  cellInk: string;
}

function tableStyle(o: TableObject, r: Refusals): TableStyle {
  return {
    border: `${num(length(o.borderWidth, r, `${o.id}.borderWidth`, 1))}px solid ${safeColor(o.borderColor, "#000000", r, `${o.id}.borderColor`)}`,
    padding: `${num(length(o.padding, r, `${o.id}.padding`, 4))}px`,
    family: fontStack(o.fontFamily),
    headerFill: safeColor(o.headerFill, "transparent", r, `${o.id}.headerFill`),
    headerInk: safeColor(o.headerTextColor, "#000000", r, `${o.id}.headerTextColor`),
    cellFill: safeColor(o.cellFill, "transparent", r, `${o.id}.cellFill`),
    cellInk: safeColor(o.cellTextColor, "#000000", r, `${o.id}.cellTextColor`),
  };
}

function cellStyle(
  cell: TableCell | undefined,
  o: TableObject,
  t: TableStyle,
  r: Refusals,
  isHeader: boolean,
): string {
  const baseInk = isHeader ? t.headerInk : t.cellInk;
  const ink =
    typeof cell?.color === "string"
      ? safeColor(cell.color, baseInk, r, `${o.id}.cellColor`)
      : baseInk;
  return css([
    `border: ${t.border}`,
    `padding: ${t.padding}`,
    `font-family: ${t.family}`,
    `font-size: ${num(length(cell?.fontSize, r, `${o.id}.cellFontSize`, 12))}px`,
    `font-weight: ${cell?.fontWeight === "bold" ? "bold" : "normal"}`,
    `color: ${ink}`,
    `background: ${isHeader ? t.headerFill : t.cellFill}`,
    `text-align: ${align(cell?.textAlign, r, `${o.id}.cellTextAlign`)}`,
    // The one wrap rule, the same one measurement applies: a cell wraps inside
    // its column, so a full line prints on two lines instead of being clipped
    // at a boundary the row height already made room for. Overflow stays the
    // boundary guarantee for a single unbreakable token.
    "white-space: pre-wrap",
    "overflow-wrap: break-word",
    "overflow: hidden",
  ]);
}

function renderTable(
  o: TableObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {
  const cols = (Array.isArray(o.colWidths) ? o.colWidths : []).map((w, i) =>
    length(w, r, `${o.id}.colWidths[${i}]`, 0),
  );
  const rows = (Array.isArray(o.rowHeights) ? o.rowHeights : []).map((h, i) =>
    length(h, r, `${o.id}.rowHeights[${i}]`, 0),
  );
  const width = cols.reduce((a, b) => a + b, 0);
  if (cols.length === 0 || !(width > 0)) {
    r.add(`${o.id}.colWidths`, String(width), "no usable column widths");
    return null;
  }
  const cells = Array.isArray(o.cells) ? o.cells : [];
  const shared = tableStyle(o, r);

  const row = (at: number, isHeader: boolean): string => {
    const body: string[] = [];
    for (let c = 0; c < cols.length; c++) {
      const cell = cells[at * cols.length + c];
      const tag = isHeader ? "th" : "td";
      const resolved = resolveText(typeof cell?.text === "string" ? cell.text : "", values);
      const text = escapeHtml(
        placeholders === "hide" ? stripUnresolvedTokens(resolved) : resolved,
      );
      body.push(`<${tag} style="${attr(cellStyle(cell, o, shared, r, isHeader))}">${text}</${tag}>`);
    }
    return `<tr style="height: ${num(rows[at] ?? 0)}px">${body.join("")}</tr>`;
  };

  let sections: string;
  if (o.headerRow && rows.length > 0) {
    sections = `<thead>${row(0, true)}</thead>`;
    if (rows.length > 1) {
      sections += `<tbody>${rows.slice(1).map((_, i) => row(i + 1, false)).join("")}</tbody>`;
    }
  } else {
    sections = `<tbody>${rows.map((_, i) => row(i, false)).join("")}</tbody>`;
  }

  const colgroup = cols.map((w) => `<col style="width: ${num(w)}px" />`).join("");
  const table = `<table class="tbl" style="width: ${num(width)}px"><colgroup>${colgroup}</colgroup>${sections}</table>`;
  // The wrapper takes the traced corner and the summed width; the table itself
  // is left unpositioned, so the browser engine owns the one element on the
  // page that can outgrow the box it was traced into.
  const box: TableObject = {
    ...o,
    width,
    height: rows.reduce((a, b) => a + b, 0),
  };
  return div(index, "o", shell(box, r), table);
}

/**
 * Only these src forms are emitted: a user-supplied value never reaches `src`
 * unchecked, so `javascript:` and friends cannot be smuggled into the page
 * through a bound image slot.
 */
function isSafeImageSrc(src: unknown): src is string {
  return (
    typeof src === "string" &&
    (src.startsWith("data:image/") ||
      src.startsWith("blob:") ||
      src.startsWith("https://") ||
      src.startsWith("http://"))
  );
}

function renderPlaceholder(
  o: ImagePlaceholderObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {
  // A bound image wins over the dashed slot: values win over the template's
  // own src so a statically-filled template can be re-bound at export time.
  const fromValues = values[o.placeholderRole];
  const src = isSafeImageSrc(fromValues) ? fromValues : o.src;
  if (isSafeImageSrc(src)) {
    return `<img class="o" ${anchor(index)} style="${attr(
      shell(o, r, ["object-fit: contain"]),
    )}" src="${attr(src)}" alt="${attr(typeof o.label === "string" ? o.label : "")}" />`;
  }
  // Nothing bound, so on paper the slot has no content at all. Drawing the
  // dashed box and its label would print "put an image here" onto a finished
  // bill - an instruction the reader cannot act on.
  // `null` drops the object; the caller filters nulls out of the body.
  if (placeholders === "hide") return null;
  return div(
    index,
    "o ph",
    shell(o, r, [
      "border: 1px dashed #9ca3af",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "color: #6b7280",
    ]),
    escapeHtml(typeof o.label === "string" ? o.label : ""),
  );
}

/**
 * A cut-out of the reference bill, painted from the crop the template carries.
 *
 * The `src` is the embedded crop rather than the original upload, so the page
 * is self-contained and no authoring reference has to come along with it. It
 * goes through the same `isSafeImageSrc` guard as a bound image slot: a hand
 * edited template must not be able to smuggle a `javascript:` URL onto the
 * page through this one either.
 */
function renderBillPart(o: BillPartObject, index: number, r: Refusals): string | null {
  if (!isSafeImageSrc(o.src)) {
    r.add(`${o.id}.src`, typeof o.src, "not a safe image source");
    return null;
  }
  return `<img class="o" ${anchor(index)} style="${attr(
    shell(o, r, ["object-fit: contain"]),
  )}" src="${attr(o.src)}" alt="${attr(typeof o.name === "string" ? o.name : "")}" />`;
}

/**
 * Render one template object to HTML, or `null` when it must not be emitted.
 *
 * `values` is the third parameter and the refusal log the fourth, so a caller
 * wiring up a whole page cannot pass the two the wrong way round.
 */
export function renderObject(
  o: TemplateObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {
  // A conditional block paints only when the form's value satisfies it. The
  // condition reads the *resolved* values (computed lines included), so a
  // block can key off a derived figure exactly as it keys off a typed field.
  // An absent value is an absent block: that is the entire point of the
  // feature - an advisory line that is part of the story only when the thing
  // it talks about happened.
  const when = o.visibleWhen;
  if (when !== undefined && typeof when === "object" && typeof when.key === "string") {
    const value = values[when.key];
    const present = typeof value === "string" && value.trim().length > 0;
    const ok = present && (when.equals === undefined || value === when.equals);
    if (!ok) return null;
  }
  // The switch below covers every member of the union, so TypeScript treats the
  // implicit end as unreachable and never asks for a default. A template that
  // arrives through an unvalidated cast can still carry a type this renderer
  // has never heard of, and falling out of the switch would return `undefined`,
  // which the declared `string | null` forbids and which the caller's filter
  // does not remove. This is the same `default: return null` that
  // `hydrateObject` uses, plus a refusal so the dropped object is visible.
  const id = typeof o.id === "string" ? o.id : "?";
  // Read while `o` is still the whole union: once the switch has matched every
  // case, TypeScript narrows it to `never` and `o.type` no longer exists. The
  // default arm needs the discriminant to name in its refusal.
  const kind = String(o.type);
  // A group is a serialised ActiveSelection with no children of its own, and
  // the shared fields give it a black border and a fill, so painting it would
  // draw a rectangle that is not on the bill.
  if (o.type === "group") return null;
  if (o.visible === false) return null;
  if (!finiteBox(o)) {
    r.add(`${id}.box`, `x=${o.x},y=${o.y},w=${o.width},h=${o.height}`, "not a finite box");
    return null;
  }
  switch (o.type) {
    case "rect":
    case "rounded-rect":
    case "ellipse":
      return renderShape(o, index, r);
    case "line":
    case "hr":
    case "vr":
      return renderLine(o, index, r);
    case "polygon":
      return renderPolygon(o, index, r);
    case "freehand":
      return renderFreehand(o, index, r);
    case "text":
      return renderText(o, index, values, r, [], placeholders);
    case "field": {
      // A field is a box the author drew to a purpose — a tick, a checkbox, a
      // date — so its value is bounded by that box rather than spilling across
      // the bill. A field the author chose to wrap is the exception: it grows
      // downward by design, so clipping it would cut the value short.
      //
      // A field is a slot with a width, and that width is its wrap boundary: a
      // value too wide for the box goes onto the next line instead of being cut
      // off, and the box grows downward so that line is actually visible. CSS
      // wraps at the container's width, so the field's own `width` is forced in
      // as the wrap width — a stray `wrapWidth` cannot claim a boundary the
      // container does not have.
      //
      // `overflow: hidden` stays as the boundary guarantee — it is what stops
      // anything painting outside the slot the author drew. With `height: auto`
      // it clips nothing in the normal case, because the box is exactly as tall
      // as the wrapped text.
      const o2 = o as unknown as TextObject;
      return renderText(
        { ...o2, wrapWidth: o2.width },
        index,
        values,
        r,
        ["overflow: hidden"],
        placeholders,
      );
    }
    case "table":
      return renderTable(o, index, values, r, placeholders);
    case "image-placeholder":
      return renderPlaceholder(o, index, values, r, placeholders);
    case "bill-part":
      return renderBillPart(o, index, r);
    default:
      // Unreachable as far as TypeScript is concerned, and it stays: the switch
      // is exhaustive over a union that arrives through an unvalidated cast, so
      // this arm is the only thing standing between a hand-edited template and
      // an `undefined` that the caller's null filter would not remove. The
      // discriminant is read from `kind` above, because `o` is `never` in here.
      r.add(`${id}.type`, kind, "unknown object type");
      return null;
  }
}