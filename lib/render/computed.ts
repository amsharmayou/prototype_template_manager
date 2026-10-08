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

import type { ComputedSpec } from "@/lib/package/format";

import type { Values } from "./values";

/**
 * A rate is read at this scale, so `18` and `18.5` both arrive as a whole number
 * of ten-millionths and neither has to be divided before it is used.
 */
const RATE_SCALE = 6;

const safeScale = (scale: number): number =>
  Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;

/**
 * Read a decimal string into minor units.
 *
 * The fraction is padded or truncated to `scale` digits and concatenated onto the
 * integer part as text, so `19.99` becomes `1999` without ever being a float. A
 * half rounds up, which is the convention a customer expects on a rounded bill.
 */
export function parseMinorUnits(value: unknown, scale: number): number {
  const s = safeScale(scale);
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 10 ** s) : 0;
  }
  if (typeof value !== "string") return 0;

  const trimmed = value.trim().replace(/,/g, "").replace(/^[^0-9.-]+/, "");
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] && match[2].length > 0 ? match[2] : "0";
  const fracPart = match[3] ?? "";

  if (fracPart.length > s) {
    // More decimals than the scale allows: round on the first dropped digit.
    const kept = fracPart.slice(0, s).padEnd(s, "0");
    const next = Number(fracPart[s] ?? "0");
    const base = Number(s === 0 ? whole : `${whole}${kept}`) || 0;
    return sign * (next >= 5 ? base + 1 : base);
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

/** One cell of a dotted arg at a given row index. */
function cell(
  arg: string,
  values: Values,
  numeric: Record<string, number>,
  s: number,
  row: Record<string, unknown> | undefined,
): number {
  const dot = arg.indexOf(".");
  if (dot <= 0) return row ? parseMinorUnits(row[arg], s) : flat(arg, values, numeric, s);
  return parseMinorUnits(row?.[arg.slice(dot + 1)], s);
}

const split = (arg: string): [string, string] => {
  const dot = arg.indexOf(".");
  return dot > 0 ? [arg.slice(0, dot), arg.slice(dot + 1)] : ["", arg];
};

/**
 * A product of two counts that each already carry `scale`, brought back to one.
 *
 * Two factors at one scale multiply to a figure at two scales, so the raw product
 * has to come down by `divisor` before it is a money figure again. Both factors
 * and the divisor are integers, so a product that divides evenly is exact, and a
 * division that does not is correctly rounded, which is where the half rounds.
 * A product too large for a JS number to hold exactly reads as zero, the same
 * convention `parseMinorUnits` uses for an input it cannot hold.
 */
function scaledProduct(a: number, b: number, divisor: number): number {
  const raw = a * b;
  if (!Number.isSafeInteger(raw)) return 0;
  return Math.round(raw / divisor);
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
): number {
  if (rateKey === undefined) return 0;
  if (has(numeric, rateKey)) return numeric[rateKey]! * 10 ** (RATE_SCALE - s);
  return parseMinorUnits(values[rateKey], RATE_SCALE);
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
): Record<string, string> {
  const s = safeScale(scale);
  const numeric: Record<string, number> = Object.create(null);
  const out: Record<string, string> = Object.create(null);

  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string" || spec.key.length === 0) continue;
    const args = Array.isArray(spec.args) ? spec.args.filter((a) => typeof a === "string") : [];
    let result = 0;

    switch (spec.op) {
      case "sum": {
        for (const arg of args) {
          const [repeatKey] = split(arg);
          if (repeatKey) {
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
          const aRows = aKey ? rowsFor(values, aKey) : [];
          const bRows = bKey ? rowsFor(values, bKey) : [];
          // One row per item of whichever side repeats; when both are flat this
          // is a single product, which is what a bare `sum-times` means.
          const count = Math.max(aRows.length, bRows.length, aKey || bKey ? 0 : 1);
          for (let i = 0; i < count; i += 1) {
            const av = cell(a, values, numeric, s, aRows[i]);
            const bv = cell(b, values, numeric, s, bRows[i]);
            result += scaledProduct(av, bv, 10 ** s);
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
          if (spec.op === "multiply") result = scaledProduct(result, nums[i]!, 10 ** s);
          else if (spec.op === "add") result += nums[i]!;
          else result -= nums[i]!;
        }
        break;
      }
      case "percent": {
        const base = args.length > 0 ? flat(args[0]!, values, numeric, s) : 0;
        const rate = rateOf(spec.rateKey, values, numeric, s);
        result = scaledProduct(base, rate, 100 * 10 ** RATE_SCALE);
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
