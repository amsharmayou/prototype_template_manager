/**
 * Output shaping for values a form supplied as plain text.
 *
 * Money arrives from a number input as `3510` and prints as `3,510.00`; a date
 * arrives ISO-shaped and prints in the pattern the document was authored with.
 * Both conversions are lenient by contract: a value that does not parse as the
 * kind it is declared to be is passed through untouched, because rewriting
 * prose into dashes is a worse failure than printing it as it was typed.
 *
 * Pure: no clock, no locale, no network. The Indian grouping is written as a
 * digit rule rather than read from the platform's locale object, so the same
 * bytes come out everywhere.
 */

export type Grouping = "off" | "indian" | "western";

/** How one token prints. Same shape the package manifest declares per field. */
export interface TokenDisplay {
  /** Calendar output pattern with `DD`, `MM` and `YYYY` tokens. Default `DD/MM/YYYY`. */
  date?: string;
  /** Thousands grouping for numeric fields. Default `indian`. */
  grouping?: Grouping;
}

/** Re-declared locally: this directory keeps no package-format import. */
export type DisplayMap = Readonly<Record<string, TokenDisplay>>;

const DEFAULT_DATE_PATTERN = "DD/MM/YYYY";

/** `2026-10-03`, or null when the text is not the stored shape of a date. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bare decimal, optionally signed, after separators are removed. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Group an integer digit run in threes. */
function groupWestern(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * Group an integer digit run the Indian way: the rightmost group holds three,
 * every group after holds two, so `1234567` reads `12,34,567`.
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(-3);
  let out = "";
  for (let i = 0; i < head.length; i += 1) {
    const fromRight = head.length - i;
    if (i > 0 && fromRight % 2 === 0) out += ",";
    out += head[i];
  }
  return `${out},${tail}`;
}

/**
 * Shape a numeric string with the declared grouping. The fraction is kept
 * exactly as supplied: re-rounding here would move printed figures away from
 * the exact minor-unit maths the computed layer already did.
 */
function groupNumber(text: string, mode: Grouping): string {
  if (mode === "off") return text;
  const match = DECIMAL.exec(text.replace(/,/g, "").replace(/\s+/g, ""));
  if (!match) return text;
  const sign = match[1] ?? "";
  const whole = match[2]!;
  const frac = match[3];
  const grouped = mode === "indian" ? groupIndian(whole) : groupWestern(whole);
  return frac !== undefined ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/**
 * Shape an ISO date into the pattern. Anything that is not the stored ISO
 * shape leaves untouched, so prose in a date slot cannot be mangled.
 */
function formatDate(text: string, pattern: string): string {
  const match = ISO_DATE.exec(text.trim());
  if (!match) return text;
  const [, y, m, d] = match;
  return pattern
    .replace(/YYYY/g, y!)
    .replace(/MM/g, m!)
    .replace(/DD/g, d!);
}

/** Which token a key formats as, from the template-provided map alone. */
function displayForKey(map: DisplayMap, key: string): TokenDisplay | undefined {
  if (hasOwn(map, key)) return map[key];
  const dot = key.lastIndexOf(".");
  if (dot > 0 && hasOwn(map, key.slice(dot + 1))) return map[key.slice(dot + 1)];
  return undefined;
}

function hasOwn(map: DisplayMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Apply declared shapes over a values map, returning a new map with the same
 * keys. Keys with no declaration, values that do not parse, and computed
 * results are all ordinary values here: a declaration is the only thing that
 * turns `2026-10-03` into `03/10/2026`.
 */
export function applyDisplayFormats(
  values: Readonly<Record<string, string>>,
  display: DisplayMap,
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const key of Object.keys(values)) {
    const spec = displayForKey(display, key);
    if (!spec) continue;
    const raw = values[key];
    if (typeof raw !== "string" || raw.length === 0) continue;
    if (spec.date !== undefined) {
      const pattern = spec.date.length > 0 ? spec.date : DEFAULT_DATE_PATTERN;
      const shaped = formatDate(raw, pattern);
      if (shaped !== raw) out[key] = shaped;
      continue;
    }
    if (spec.grouping !== undefined) {
      const shaped = groupNumber(raw, spec.grouping);
      if (shaped !== raw) out[key] = shaped;
    }
  }
  return out;
}
