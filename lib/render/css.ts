export interface Refusal {
  field: string;
  value: string;
  reason: string;
}

/**
 * Collected reasons a template value was refused. A bad value never fails the
 * render: the default is used and the caller is told, so one malformed colour
 * cannot cost a shop the whole page.
 *
 * An entry repeated verbatim is dropped. A table's own colours and lengths are
 * looked up once per cell, and a caller that shows this list would otherwise see
 * the same sentence nine times with nothing to tell the entries apart. Two
 * *different* values refused at the same field are both kept: that is two
 * distinct things to fix.
 */
export class Refusals {
  private readonly items: Refusal[] = [];
  private readonly seen = new Set<string>();
  add(field: string, value: string, reason: string): void {
    const key = `${field} ${value} ${reason}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ field, value, reason });
  }
  list(): Refusal[] {
    return this.items;
  }
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\.\d+)\s*)?\)$/i;
const HSL = /^hsla?\(\s*\d{1,3}(?:deg|rad|turn)?(?:\s*,\s*|\s+)[\d.]+%(?:\s*,\s*|\s+)[\d.]+%(?:\s*(?:,\s*|\s*\/\s*)(?:0|1|0?\.\d+|\.\d+|[\d.]+%))?\s*\)$/i;
/**
 * CSS named colours, lowercased, without rgb()/none equivalents that overlap
 * other branches. A whitelist is used rather than a `letters-only` pattern so
 * a typo fails visibly (a refusal) instead of shipping a dead declaration.
 */
const NAMED = new Set([
  "aliceblue","antiquewhite","aqua","aquamarine","azure",
  "beige","bisque","black","blanchedalmond","blue","blueviolet","brown","burlywood",
  "cadetblue","chartreuse","chocolate","coral","cornflowerblue","cornsilk","crimson","cyan",
  "darkblue","darkcyan","darkgoldenrod","darkgray","darkgreen","darkgrey","darkkhaki","darkmagenta","darkolivegreen","darkorange","darkorchid","darkred","darksalmon","darkseagreen","darkslateblue","darkslategray","darkslategrey","darkturquoise","darkviolet","deeppink","deepskyblue","dimgray","dimgrey","dodgerblue",
  "firebrick","floralwhite","forestgreen","fuchsia",
  "gainsboro","ghostwhite","gold","goldenrod","gray","green","greenyellow","grey",
  "honeydew","hotpink",
  "indianred","indigo","ivory","khaki",
  "lavender","lavenderblush","lawngreen","lemonchiffon","lightblue","lightcoral","lightcyan","lightgoldenrodyellow","lightgray","lightgreen","lightgrey","lightpink","lightsalmon","lightseagreen","lightskyblue","lightslategray","lightslategrey","lightsteelblue","lightyellow","lime","limegreen","linen",
  "magenta","maroon","mediumaquamarine","mediumblue","mediumorchid","mediumpurple","mediumseagreen","mediumslateblue","mediumspringgreen","mediumturquoise","mediumvioletred","midnightblue","mintcream","mistyrose","moccasin",
  "navajowhite","navy",
  "oldlace","olive","olivedrab","orange","orangered","orchid",
  "palegoldenrod","palegreen","paleturquoise","palevioletred","papayawhip","peachpuff","peru","pink","plum","powderblue","purple",
  "rebeccapurple","red","rosybrown","royalblue",
  "saddlebrown","salmon","sandybrown","seagreen","seashell","sienna","silver","skyblue","slateblue","slategray","slategrey","snow","springgreen","steelblue",
  "tan","teal","thistle","tomato","turquoise",
  "violet",
  "wheat","white","whitesmoke",
  "yellow","yellowgreen",
]);

/**
 * Check a colour against a whitelist. Escaping is the wrong tool here:
 * `&lt;` does not defend against `fill: red; } body { display: none }`.
 * Anything unrecognised is refused and never emitted.
 */
export function safeColor(v: unknown, fallback: string, r: Refusals, field = "color"): string {
  if (typeof v !== "string") {
    r.add(field, String(v), "not a string");
    return fallback;
  }
  const t = v.trim();
  if (
    HEX.test(t) ||
    RGB.test(t) ||
    HSL.test(t) ||
    NAMED.has(t.toLowerCase()) ||
    t.toLowerCase() === "transparent" ||
    t.toLowerCase() === "none" ||
    t.toLowerCase() === "currentcolor"
  ) {
    return t;
  }
  r.add(field, v, "not a recognised colour");
  return fallback;
}

const FAMILIES: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  "helvetica neue": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "segoe ui": '"Segoe UI", system-ui, Arial, sans-serif',
  verdana: "Verdana, Geneva, sans-serif",
  calibri: "Calibri, Carlito, Arial, sans-serif",
  cambria: "Cambria, Georgia, serif",
  "times new roman": '"Times New Roman", Times, serif',
  georgia: "Georgia, 'Times New Roman', serif",
  palatino: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  "palatino linotype": '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  "book antiqua": '"Book Antiqua", Palatino, Georgia, serif',
  garamond: "Garamond, 'EB Garamond', Georgia, serif",
  "century gothic": '"Century Gothic", Futura, sans-serif',
  impact: "Impact, 'Arial Narrow Bold', sans-serif",
  "comic sans ms": '"Comic Sans MS", "Comic Sans", cursive',
  "courier new": '"Courier New", Courier, monospace',
  courier: '"Courier New", Courier, monospace',
  "lucida console": '"Lucida Console", Monaco, monospace',
  monospace: "ui-monospace, Menlo, Consolas, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "Helvetica, Arial, sans-serif",
};

/**
 * Map a family to a stack. Known families get their full stack; anything else
 * is a quoted pass-through with a best-effort generic fallback, because a
 * typed family name may be a locally installed face the whitelist cannot know
 * about. Substituting a *different* family here would be a silent visual lie.
 *
 * The sanitising pass is load-bearing: a raw string reaches an HTML attribute
 * that is then consumed as CSS, so anything outside letters/digits/space/`_`/`-`
 * is removed. A quote in the name could otherwise break out of the CSS string.
 */
export function fontStack(family: unknown): string {
  if (typeof family !== "string") return FAMILIES["sans-serif"]!;
  const key = family.trim().toLowerCase();
  if (Object.hasOwn(FAMILIES, key)) return FAMILIES[key]!;

  const cleaned = family.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 100);
  if (cleaned.length === 0) return FAMILIES["sans-serif"]!;

  const probe = cleaned.toLowerCase();
  const generic = probe.includes("mono") || probe.includes("courier") || probe.includes("consol")
    ? FAMILIES["monospace"]!
    : probe.includes("serif")
      ? FAMILIES["serif"]!
      : FAMILIES["sans-serif"]!;
  return `"${cleaned}", ${generic}`;
}

export function safeLength(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * A rotation in degrees, refusing anything that is not a finite number.
 *
 * Deliberately *not* clamped to a "sane" range. A rotation is applied modulo a
 * full turn, so `rotate(370deg)` and `rotate(10deg)` put the object in the same
 * place, and Fabric accumulates `angle` past a full turn on its own when a user
 * keeps rotating. Clamping would therefore move a traced object rather than
 * tidy its input, and the value is inert either way: it is a number in a
 * `rotate()` argument, not something a parser can be talked into executing.
 */
export function safeAngle(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function safeOpacity(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}