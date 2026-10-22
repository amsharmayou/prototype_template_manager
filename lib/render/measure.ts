/**
 * What the content of one dynamic slot needs from the environment it will be
 * laid out in.
 *
 * Supplied by the host rather than measured here. Text metrics depend on the
 * font engine - the browser on web, the WebView on Android - and this package
 * is pure TypeScript with no DOM, which is what lets the same numbers drive
 * both frontends. A host with nowhere to measure (a unit test, a server)
 * passes nothing, and every object then keeps its authored geometry.
 *
 * `height` is measured at the object's *base* width. Widening a box can only
 * reduce the number of wrapped lines, so that value is an upper bound for any
 * wider layout too, and reusing it avoids a second measurement round-trip for
 * what is, in the common case, a strict improvement.
 */
export interface ContentMeasurement {
  /** Width the content needs on one line. */
  naturalWidth: number;
  /** Height needed when wrapped at the base width. */
  height: number;
}

/** How the content was measured, so a caller can tell a real figure from an estimate. */
export type MeasurementSource = "measured" | "estimated";