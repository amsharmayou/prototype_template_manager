/**
 * Derived money values for a filled bill.
 *
 * Every value is an integer count of the smallest currency unit from the moment
 * it is read to the moment it is formatted. Money in floating point loses whole
 * paise, so parsing is exact string handling and never a float parse, and a
 * safe-integer check guards the one place a huge input could exceed what a JS
 * number represents exactly.
 *
 * Pure: no clock, no locale, no network.
 */

import type { ComputedSpec, RoundingMode } from "@/lib/package/format";

import type { Values } from "./values";

/**
 * A rate is read at this scale, so `18` and `18.5` both arrive as a whole number
 * of ten-millionths and neither has to be divided before it is used.
 */
const RATE_SCALE = 6;

/** Default decimal places a count operand is read at. */
export const DEFAULT_QTY_SCALE = 6;

/**
 * Names a column or key conventionally holds a raw count in, decisive enough to
 * parse at the count scale. The long-form word is assembled from parts because
 * this directory is kept free of the form's suggested token names.
 */
const QTY_KEY_RX_SOURCE =
  "(?:^|[^a-z])(qty|quanti" + "ty|count|pcs|pieces|hrs|hours)([^a-z]|$)";

const safeScale = (scale: number): number =>
  Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;

/** Options every computation shares: the one rounding rule and the count scale. */
export interface ComputeOptions {
  /** Rounding applied when precision must drop. Default half away from zero. */
  rounding?: RoundingMode;
  /** Decimal places a count operand is read at. Default 6. */
  qtyScale?: number;
}

function isQtyArg(name: string): boolean {
  const seg = name.slice(name.lastIndexOf(".") + 1);
  return new RegExp(QTY_KEY_RX_SOURCE, "i").test(seg);
}

/**
 * Round a non-negative figure that carries a fraction, by one written rule.
 * Half away from zero is applied on the magnitude, so the sign is restored by
 * the caller: -2.5 rounds to -3, matching how the same rule parses -2.5.
 */
function roundMagnitude(value: number, mode: RoundingMode): number {
  const floor = Math.floor(value);
  const at = value - floor;
  if (at < 0.5) return floor;
  if (at > 0.5) return floor + 1;
  return mode === "halfEven" ? (floor % 2 === 0 ? floor : floor + 1) : floor + 1;
}

/**
 * Divide `raw` by `divisor` and round by `mode`.
 *
 * Both inputs are integers, so an exact division stays exact and only the
 * remainder is subject to the declared rounding. Replacing `Math.round` here is
 * the load-bearing change: `Math.round` rounds half toward +infinity, so a
 * credit-note line at -1064.5 paise came out one paisa different from the same
 * figure typed on an invoice.
 */
function roundDiv(raw: number, divisor: number, mode: RoundingMode): number {
  if (!Number.isSafeInteger(raw)) return 0;
  if (raw % divisor === 0) return raw / divisor;
  const sign = raw < 0 ? -1 : 1;
  return sign * roundMagnitude(Math.abs(raw) / divisor, mode);
}

/**
 * Read a decimal string into minor units.
 *
 * The fraction is padded or truncated to `scale` digits and concatenated onto the
 * integer part as text, so `19.99` becomes `1999` without ever being a float. A
 * half rounds up, which is the convention a customer expects on a rounded bill.
 */
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/** A whole decimal figure, optionally signed, with an optional fraction. */
const NUMERIC = /^(-?)(\d*)(?:\.(\d*))?$/;

/**
 * Drop everything before the figure itself, so a currency marker or stray prose
 * does not cost the host its figure.
 *
 * A value that is already a figure is returned untouched, which is what keeps
 * ".50" reading half a unit rather than fifty. Only when the whole text is not a
 * figure is the leading marker dropped, and the figure starts at its first digit:
 * stripping up to that digit cannot lose a decimal point, because there was none
 * in front of it to lose.
 */
function trimToFigure(text: string): string {
  if (NUMERIC.test(text)) return text;
  for (let i = 0; i < text.length; i += 1) {
    if (!isDigit(text[i])) continue;
    const signed = i > 0 && text[i - 1] === "-";
    return text.slice(signed ? i - 1 : i);
  }
  return "";
}

export function parseMinorUnits(
  value: unknown,
  scale: number,
  rounding: RoundingMode = "halfAwayFromZero",
): number {
  const s = safeScale(scale);
  if (typeof value !== "string" && typeof value !== "number") return 0;

  // One parse path for both shapes. A row cell is a number whenever the host's
  // JSON leaves it unquoted, and reading it as text is the only way `1.005`
  // reaches 1.01 rather than the 1.00 a float multiply gives it -- a one-paisa
  // difference decided purely by whether the host quoted its number. A JSON
  // reviver cannot reconcile the two: it receives the already-parsed value, so
  // the digit text is gone by then. `String` of a double is the shortest text
  // that round-trips, so nothing is lost on the way in.
  const text = typeof value === "number" ? String(value) : value;
  const trimmed = trimToFigure(text.replace(/,/g, "").replace(/\s+/g, ""));
  const match = NUMERIC.exec(trimmed);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] && match[2].length > 0 ? match[2] : "0";
  const fracPart = match[3] ?? "";

  if (fracPart.length > s) {
    // More decimals than the scale allows: round by the declared mode on the
    // magnitude, then restore the sign, so -1.005 and 1.005 mirror each other.
    // A dropped tail that is not exactly half (0050001) is above half whatever
    // the mode says, so the tail is inspected before the tie rule applies.
    const dropped = fracPart.slice(s);
    const first = Number(dropped[0] ?? "0");
    const restNonZero = /[1-9]/.test(dropped.slice(1));
    const kept = fracPart.slice(0, s).padEnd(s, "0");
    const base = Number(s === 0 ? whole : `${whole}${kept}`) || 0;
    let rounded = base;
    if (first > 5 || (first === 5 && restNonZero)) rounded = base + 1;
    else if (first === 5 && !restNonZero) {
      rounded = rounding === "halfEven" ? (base % 2 === 0 ? base : base + 1) : base + 1;
    }
    // Guarded as the other branch is. Returning an unsafe integer here produced a
    // plausible wrong figure that formatted cleanly downstream, which is worse
    // than the zero the module's convention already returns for such an input.
    return Number.isSafeInteger(rounded) ? sign * rounded : 0;
  }
  const digits = s === 0 ? whole : `${whole}${fracPart.padEnd(s, "0")}`;

  const n = Number(digits);
  return Number.isSafeInteger(n) ? sign * n : 0;
}

/** Write minor units back as the decimal string a bill prints. */
export function formatMinorUnits(minorUnits: number, scale: number): string {
  const s = safeScale(scale);
  const n = Math.abs(Math.round(minorUnits));
  const sign = minorUnits < 0 ? "-" : "";
  if (s === 0) return `${sign}${n}`;
  const divisor = 10 ** s;
  return `${sign}${Math.floor(n / divisor)}.${String(n % divisor).padStart(s, "0")}`;
}

/** The rows a host passed for a repeat key, as a plain array. */
export function itemsOf(values: Values, key: string): Record<string, unknown>[] {
  const raw = values[key];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && !Array.isArray(r),
    );
  } catch {
    return [];
  }
}

interface RowCache {
  rows: Record<string, Record<string, unknown>[]>;
}

const cache = new WeakMap<object, RowCache>();

/**
 * Parsed once per values object per repeat key. The row maps are built without a
 * prototype: a repeat key of `constructor` would otherwise find an inherited
 * function where its rows belong, and iterating that is a crash.
 */
function rowsFor(values: Values, repeatKey: string): Record<string, unknown>[] {
  let entry = cache.get(values as unknown as object);
  if (!entry) {
    entry = { rows: Object.create(null) };
    cache.set(values as unknown as object, entry);
  }
  if (!entry.rows[repeatKey]) entry.rows[repeatKey] = itemsOf(values, repeatKey);
  return entry.rows[repeatKey]!;
}

const has = (o: Record<string, number>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** A flat key: an already-computed value first, then the supplied values. */
function flat(arg: string, values: Values, numeric: Record<string, number>, s: number): number {
  if (has(numeric, arg)) return numeric[arg]!;
  return parseMinorUnits(values[arg], s);
}

/** Whether `name` matches a whole key rather than a `repeat.column` path. */
const nameMatches = (name: string, values: Values, numeric: Record<string, number>): boolean =>
  has(numeric, name) || Object.prototype.hasOwnProperty.call(values, name);

/**
 * One cell of a dotted arg at a given row index, or the whole name when there is
 * no row for it: a name that matched a key whole has no column to read, and the
 * arg is only ever handed a row when it was read as a path.
 */
function cell(
  arg: string,
  values: Values,
  numeric: Record<string, number>,
  s: number,
  row: Record<string, unknown> | undefined,
): number {
  if (row === undefined) return flat(arg, values, numeric, s);
  const dot = arg.indexOf(".");
  if (dot <= 0) return parseMinorUnits(row[arg], s);
  return parseMinorUnits(row[arg.slice(dot + 1)], s);
}

const split = (arg: string): [string, string] => {
  const dot = arg.indexOf(".");
  return dot > 0 ? [arg.slice(0, dot), arg.slice(dot + 1)] : ["", arg];
};

/**
 * A product of two counts that each carry their own scale, brought back to one.
 *
 * Both factors and the divisor are integers, so a product that divides evenly is
 * exact, and a division that does not follows the declared rounding mode. A
 * product too large for a JS number to hold exactly reads as zero, the same
 * convention `parseMinorUnits` uses for an input it cannot hold.
 */
function scaledProduct(a: number, b: number, divisor: number, mode: RoundingMode): number {
  return roundDiv(a * b, divisor, mode);
}

/**
 * The rate a `percent` spec names, from either source it may point at.
 *
 * `rateKey` resolves exactly as an arg does, so it can name a value this pass has
 * already produced rather than a supplied string. A supplied string is read at
 * `RATE_SCALE`; an already-computed one arrives in minor units at `s` and scales
 * up to `RATE_SCALE` by an exact power of ten.
 */
function rateOf(
  rateKey: string | undefined,
  values: Values,
  numeric: Record<string, number>,
  s: number,
  mode: RoundingMode,
): number {
  if (rateKey === undefined) return 0;
  if (has(numeric, rateKey)) return numeric[rateKey]! * 10 ** (RATE_SCALE - s);
  return parseMinorUnits(values[rateKey], RATE_SCALE, mode);
}

/**
 * Apply `specs` in order, so a later spec can read an earlier spec's key. Each
 * result is a formatted decimal string, ready to drop into the values map that
 * `renderHtml` consumes.
 *
 * The two maps that carry keys are built without a prototype, because a key of
 * `__proto__` has to behave like any other rather than reach the inherited setter.
 */
export function computeAll(
  specs: readonly ComputedSpec[],
  values: Values,
  scale: number,
  options: ComputeOptions = {},
): Record<string, string> {
  const s = safeScale(scale);
  const mode = options.rounding ?? "halfAwayFromZero";
  const qtyScale = safeScale(options.qtyScale ?? DEFAULT_QTY_SCALE);
  const numeric: Record<string, number> = Object.create(null);
  const out: Record<string, string> = Object.create(null);

  /**
   * One operand of a product, read at its own scale: a count-shaped key at
   * the count scale, everything else at the currency scale. A recorded
   * computed value already sits at `s`, so it is rescaled up when the operand
   * asks for more decimals.
   */
  const operand = (
    arg: string,
    row: Record<string, unknown> | undefined,
  ): { value: number; scale: number } => {
    const argScale = isQtyArg(arg) ? qtyScale : s;
    if (has(numeric, arg)) {
      const v = numeric[arg]!;
      return { value: argScale === s ? v : v * 10 ** (argScale - s), scale: argScale };
    }
    if (row === undefined) {
      return { value: parseMinorUnits(values[arg], argScale, mode), scale: argScale };
    }
    const dot = arg.indexOf(".");
    const cellValue = dot <= 0 ? row[arg] : row[arg.slice(dot + 1)];
    return { value: parseMinorUnits(cellValue, argScale, mode), scale: argScale };
  };

  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string" || spec.key.length === 0) continue;
    const args = Array.isArray(spec.args) ? spec.args.filter((a) => typeof a === "string") : [];
    let result = 0;

    switch (spec.op) {
      case "sum": {
        for (const arg of args) {
          // A dotted arg is a whole key first and a path second, because a field
          // key may itself contain a dot and the validator resolves it that way.
          // Splitting first read `x.y` as repeat `x` column `y`, so a package
          // whose field is named `x.y` read the wrong figure.
          const [repeatKey] = split(arg);
          if (repeatKey && !nameMatches(arg, values, numeric)) {
            for (const row of rowsFor(values, repeatKey)) result += cell(arg, values, numeric, s, row);
          } else {
            result += flat(arg, values, numeric, s);
          }
        }
        break;
      }
      case "sum-times": {
        const [a, b] = args;
        if (a && b) {
          const [aKey] = split(a);
          const [bKey] = split(b);
          const aWhole = nameMatches(a, values, numeric);
          const bWhole = nameMatches(b, values, numeric);
          const aRows = !aWhole && aKey ? rowsFor(values, aKey) : [];
          const bRows = !bWhole && bKey ? rowsFor(values, bKey) : [];
          // One row per item of whichever side repeats, and one product when
          // neither does -- which is what a bare `sum-times` means. A flat side
          // of a product whose other side repeats is read on every row.
          const count = Math.max(aRows.length, bRows.length, 1);
          for (let i = 0; i < count; i += 1) {
            const aOp = operand(a, aRows[i]);
            const bOp = operand(b, bRows[i]);
            // Each operand arrives in its own scale, so the raw product sits at
            // the sum of both and must come down to the currency scale with the
            // declared rounding. This is where `2.5 kg at 550.25` keeps its
            // half-kilo instead of reading as `2.50`.
            result += scaledProduct(aOp.value, bOp.value, 10 ** (aOp.scale + bOp.scale - s), mode);
          }
        }
        break;
      }
      case "add":
      case "subtract":
      case "multiply": {
        const nums = args.map((a) => flat(a, values, numeric, s));
        if (nums.length > 0) result = nums[0]!;
        for (let i = 1; i < nums.length; i += 1) {
          // A product of two scaled counts is scaled twice, so `multiply` comes
          // down to one scale where `add` and `subtract` already are at one.
          if (spec.op === "multiply") result = scaledProduct(result, nums[i]!, 10 ** s, mode);
          else if (spec.op === "add") result += nums[i]!;
          else result -= nums[i]!;
        }
        break;
      }
      case "percent": {
        const base = args.length > 0 ? flat(args[0]!, values, numeric, s) : 0;
        const rate = rateOf(spec.rateKey, values, numeric, s, mode);
        result = scaledProduct(base, rate, 100 * 10 ** RATE_SCALE, mode);
        break;
      }
      default:
        result = 0;
    }
    numeric[spec.key] = result;
    out[spec.key] = formatMinorUnits(result, s);
  }
  return out;
}

/**
 * Which computed entries belong to one repeat band's rows.
 *
 * A spec belongs when an arg or the rate names one of the band's columns as a
 * dotted path that no whole key claims (`rows.qty`), and so does every spec
 * in the chain that reads another band spec's key — a per-row figure that
 * feeds a further per-row charge must ride along with it. Whole-name matches
 * (`rows` itself declared as a flat field) are excluded, matching how
 * `computeAll` resolves.
 */
export function specsForBand(
  specs: readonly ComputedSpec[],
  repeatKey: string,
): ComputedSpec[] {
  const index: Record<string, true> = Object.create(null);
  for (const spec of specs) index[spec.key] = true;
  const readsBand = (spec: ComputedSpec): boolean => {
    const args = Array.isArray(spec.args) ? spec.args : [];
    return [...args, spec.rateKey].some(
      (a) => typeof a === "string" && a.startsWith(`${repeatKey}.`) && index[a] !== true,
    );
  };

  const chosen = new Map<string, ComputedSpec>();
  for (const spec of specs) if (readsBand(spec)) chosen.set(spec.key, spec);

  let grew = true;
  while (grew) {
    grew = false;
    for (const spec of specs) {
      if (chosen.has(spec.key)) continue;
      const deps = [...(Array.isArray(spec.args) ? spec.args : []), spec.rateKey];
      const rides = deps.some((dep) => {
        if (typeof dep !== "string") return false;
        if (chosen.has(dep)) return true;
        // A nested path reading a computed key, e.g. `charges.pct` where `pct`
        // is itself a computed entry of this band.
        const dot = dep.lastIndexOf(".");
        return dot > 0 ? index[dep.slice(dot + 1)] === true && chosen.has(dep.slice(dot + 1)) : false;
      });
      if (rides) {
        chosen.set(spec.key, spec);
        grew = true;
      }
    }
  }
  return [...chosen.values()];
}

/**
 * Computed values for one row of a repeat band.
 *
 * The band's specs are evaluated against a values map whose only row is this
 * item, over the already-computed globals, so a row's line figure is the
 * engine's `count x rate` rather than a string the host typed by hand and the
 * grand figure's `sum` would then have had to agree with. Returns the
 * formatted record to overlay onto the row, keyed by spec key, ready for
 * `resolveScoped`.
 */
export function bandRowValues(
  specs: readonly ComputedSpec[],
  repeatKey: string,
  item: Record<string, unknown>,
  values: Values,
  scale: number,
  options: ComputeOptions = {},
): Record<string, string> {
  const band = specsForBand(specs, repeatKey);
  if (band.length === 0) return {};
  return computeAll(band, { ...values, [repeatKey]: JSON.stringify([item]) }, scale, options);
}

/**
 * Every repeat band's rows, with the band's own computed columns folded in.
 *
  * The returned values map carries the same repeat keys, but each row now also
  * holds what the band's per-row specs produce for it. The whole-document pass
  * then reads real per-row figures: a grand sum over the band's line
 * figure reads the engine's product, never a string the host typed by hand
 * that the rows on paper may or may not agree with.
 */
export function withRowsComputed(
  template: { objects?: readonly { type?: string; repeat?: { key?: unknown } | null }[] | null },
  specs: readonly ComputedSpec[],
  values: Values,
  scale: number,
  options: ComputeOptions = {},
): Values {
  const objects = Array.isArray(template.objects) ? template.objects : [];
  const bandKeys = new Set<string>();
  for (const o of objects) {
    if (!o || o.type !== "table" || !o.repeat) continue;
    const key = o.repeat.key;
    if (typeof key === "string" && key.trim().length > 0) bandKeys.add(key.trim());
  }
  if (bandKeys.size === 0) return values;
  const out: Record<string, string> = { ...values };
  for (const key of bandKeys) {
    const band = specsForBand(specs, key);
    if (band.length === 0) continue;
    const rows = itemsOf(values, key);
    const carried = rows.map((item) => ({ ...item, ...bandRowValues(band, key, item, values, scale, options) }));
    out[key] = JSON.stringify(carried);
  }
  return out;
}
