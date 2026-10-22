import type { MeasurementRequest, Measurements } from "./bridge";

/**
 * Measures filled text against a real font engine.
 *
 * The only module in the runtime allowed to touch the DOM. Everything that
 * decides *what* to measure lives in `bridge.ts`, which stays pure; this file
 * is arithmetic on an element, so it has as little decision-making in it as
 * possible.
 *
 * Measurement is **synchronous**. Appending an element and reading
 * `getBoundingClientRect()` forces the layout the browser was going to do
 * anyway, so there is no promise to await and no change to the string-in,
 * string-out contract the Android runtime already speaks. That is the whole
 * reason this could be added without touching the host's call signature.
 *
 * The declarations below are copied from `renderText` on purpose. A measurer
 * that used different typography would size boxes the renderer never produces,
 * and the error would show up only as a bill that is slightly wrong.
 */

const HOST_ID = "__billkit_measure";

/**
 * The style the renderer paints text with.
 *
 * `white-space` is the one that matters most: `pre` never wraps, `pre-wrap`
 * wraps at the box, and `break-word` is what lets a single unbreakable token
 * (a GSTIN, an email) break rather than run past the edge.
 */
function styleFor(r: MeasurementRequest): string {
  const family = /[^a-zA-Z0-9\s-]/.test(r.fontFamily)
    ? "Arial, sans-serif"
    : `"${r.fontFamily}", Arial, sans-serif`;
  const line = Math.round(r.fontSize * r.lineHeight * 100) / 100;
  return [
    "position:absolute",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    "margin:0",
    "padding:0",
    "border:0",
    `font-family:${family}`,
    `font-size:${r.fontSize}px`,
    `line-height:${line}px`,
    `font-weight:${r.fontWeight}`,
    `font-style:${r.fontStyle}`,
    `letter-spacing:${r.charSpacing / 1000}em`,
    "word-spacing:normal",
    "text-transform:none",
    "text-indent:0",
  ].join(";");
}

/**
 * Measure a list of boxes.
 *
 * Returns an empty record for an empty plan rather than touching the document
 * at all, so a host with no growing fields pays nothing for having asked.
 */
export function measureDom(requests: readonly MeasurementRequest[]): Measurements {
  const out: Measurements = {};
  if (!requests.length || typeof document === "undefined") return out;

  const host = document.createElement("div");
  host.id = HOST_ID;
  // The measurer must not be laid out inside the page it is measuring: the
  // bill's own stylesheet sets page-wide rules that would change these numbers.
  host.style.cssText =
    "position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;contain:strict";
  document.body.appendChild(host);

  try {
    for (const r of requests) {
      const width = Number.isFinite(r.width) && r.width > 0 ? r.width : 0;

      // Natural width first, on an unwrapped box: this is what an unbounded X
      // axis is asking for.
      const line = document.createElement("div");
      line.setAttribute("style", `${styleFor(r)};white-space:pre;width:auto`);
      // textContent, never innerHTML: the text came from a package, and
      // injecting it as markup would run whatever it contained.
      line.textContent = r.text;
      host.appendChild(line);
      const naturalWidth = line.getBoundingClientRect().width;

      // Then the height at the width the box actually has, wrapping the way the
      // renderer will wrap it.
      const box = document.createElement("div");
      box.setAttribute(
        "style",
        `${styleFor(r)};white-space:${r.wrap ? "pre-wrap" : "pre"};` +
          `overflow-wrap:${r.wrap ? "break-word" : "normal"};width:${width}px`,
      );
      box.textContent = r.text;
      // A table cell centres or right-aligns its text inside the column, and
      // alignment cannot change how many lines it wraps to - but it must match
      // the renderer anyway, because a cell measured left-aligned and painted
      // right-aligned is two different measurements of one page.
      if (r.kind === "cell" && r.textAlign) box.style.textAlign = r.textAlign;
      host.appendChild(box);
      const height = box.getBoundingClientRect().height;

      line.remove();
      box.remove();

      if (!Number.isFinite(naturalWidth) || !Number.isFinite(height)) continue;
      out[r.id] = { naturalWidth: Math.round(naturalWidth * 100) / 100, height: Math.round(height * 100) / 100 };
    }
  } finally {
    // Removed even when a request throws: a measurer left behind would keep
    // relaying on every render and quietly slow the host down.
    host.remove();
  }

  return out;
}