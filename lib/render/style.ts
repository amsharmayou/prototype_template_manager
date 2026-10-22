/**
 * The document stylesheet, a pure function of the page size.
 *
 * Every length is in px and the page is declared at the traced size rather
 * than A4, because a traced bill is usually not A4 and must print at its true
 * size. px-only also means a browser's minimum-font-size setting cannot move
 * anything, and nothing is loaded from outside the page.
 *
 * `print-color-adjust: exact` is the difference between a shaded table header
 * on screen and no header on paper: browsers drop backgrounds when printing
 * unless told not to, and no unit test can catch that - only paper can.
 */

/** The px constants the template format uses for an A4 sheet, at 96 dpi. */
const A4_PX: Readonly<{ w: number; h: number }> = { w: 794, h: 1123 };

/**
 * The `@page` size declaration.
 *
 * An A4 sheet declares the paper by *name*: `794px` by `1123px` is 210.08 by
 * 297.13 mm, a fraction wider and taller than the real sheet, and a printer
 * left to reconcile the difference could scale the page or spill a second
 * blank one. A custom sheet keeps its measured size in px, which is still the
 * exact geometry the template was traced at.
 */
export function pageRule(docW: number, docH: number): string {
  if (docW === A4_PX.w && docH === A4_PX.h) {
    return "@page { size: A4; margin: 0; }";
  }
  return `@page { size: ${docW}px ${docH}px; margin: 0; }`;
}

export function stylesheet(docW: number, docH: number): string {
  return [
    pageRule(docW, docH),
    `html, body { margin: 0; padding: 0; background: #fff; }`,
    `body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`,
    `.sheet { position: relative; width: ${docW}px; height: ${docH}px; overflow: hidden; background: #fff; }`,
    `.o { position: absolute; }`,
    `.t { white-space: pre; }`,
    `.tx { display: flex; flex-direction: column; }`,
    `.tbl { border-collapse: collapse; table-layout: fixed; }`,
    `.ph { border: 1px dashed #9ca3af; display: flex; align-items: center; justify-content: center; color: #6b7280; }`,
    `* { box-sizing: border-box; }`,
    `* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`,
  ].join("\n");
}