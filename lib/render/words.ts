/**
 * Spelled-out money for the Indian numbering system.
 *
 * Built from integer minor units - never from a float, and a float that does
 * arrive is rounded to the nearest minor unit first, because a rounding
 * remainder of -0.40 paise is not a debt and must not print "Minus Zero".
 * Pure; English only; the Indian ladder (kharab, arab, crore, lakh, thousand,
 * hundred) rather than the western millions, because that is how the reader
 * of these bills says numbers out loud. Group names run out at kharab: past
 * that magnitude the top group prints as digits, which are unambiguous where
 * a word is not.
 */

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** Words for a non-negative integer below one hundred. */
function underHundred(value: number): string {
  if (value < 20) return ONES[value]!;
  const tens = TENS[Math.floor(value / 10)]!;
  const rest = value % 10;
  return rest === 0 ? tens : `${tens} ${ONES[rest]}`;
}

/** Words for a non-negative integer below one hundred. */
function underThousand(value: number): string {
  if (value < 100) return underHundred(value);
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return rest === 0
    ? `${ONES[hundreds]} Hundred`
    : `${ONES[hundreds]} Hundred ${underHundred(rest)}`;
}

/** Words for a non-negative integer below one lakh (thousand, hundred). */
function underLakh(value: number): string {
  if (value < 1000) return underThousand(value);
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  return rest === 0
    ? `${underThousand(thousands)} Thousand`
    : `${underThousand(thousands)} Thousand ${underThousand(rest)}`;
}

/**
 * Words for one group value, where "One Hundred" and up read as digits.
 *
 * A group value only reaches three digits when the magnitude outran the names
 * the ladder carries (ten thousand kharab, say); recursing into more group
 * words there produced doubled names, and digits cannot disagree.
 */
function groupValue(value: number): string {
  return value > 0 && value < 100 ? underHundred(value) : String(value);
}

/** Whole words for a non-negative rupee figure, Indian ladder. */
function indianWords(value: number): string {
  const ladder: Array<[number, string]> = [
    [10 ** 11, "Kharab"],
    [10 ** 9, "Arab"],
    [10 ** 7, "Crore"],
    [10 ** 5, "Lakh"],
    [1000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = value;
  for (const [size, name] of ladder) {
    const group = Math.floor(rest / size);
    rest %= size;
    if (group > 0) parts.push(`${groupValue(group)} ${name}`);
  }
  if (rest > 0) parts.push(underLakh(rest));
  return parts.length > 0 ? parts.join(" ") : "Zero";
}

/** "Rupees" -> "Rupee", "Dollars" -> "Dollar"; abbreviations pass through. */
function singularOf(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && word.length > 1) return word.slice(0, -1);
  return word;
}

/**
 * `1050` at scale 2 reads "Ten Rupees and Fifty Paise Only".
 *
 * The currency word is dropped when there are no whole units ("Forty Paise
 * Only", the shape a sub-unit round-off line takes) unless everything is
 * zero, where "Zero Rupees Only" is the only line that does not look like a
 * rendering bug. The sign rides the words - "Minus One Rupee Only" - because
 * a credit note prints it. Whole-unit counts of one take the singular.
 */
export function spellMoney(
  minor: number,
  scale: number,
  currency = "Rupees",
  subunit = "Paise",
  subunitSingular = "Paisa",
): string {
  const s = Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;
  // A host that computed in floats hands over a fraction of a minor unit;
  // rounding to the nearest unit keeps the spelled words consistent with the
  // printed figures.
  const units = Math.round(minor);
  if (units === 0) return `Zero ${currency} Only`;

  const prefix = units < 0 ? "Minus " : "";
  const magnitude = Math.abs(units);
  const unit = 10 ** s;
  const whole = Math.floor(magnitude / unit);
  const fraction = magnitude % unit;

  const body: string[] = [];
  if (whole > 0) {
    body.push(whole === 1 ? `One ${singularOf(currency)}` : `${indianWords(whole)} ${currency}`);
  }
  if (fraction > 0 && s > 0) {
    body.push(`${indianWords(fraction)} ${fraction === 1 ? subunitSingular : subunit}`);
  }
  if (body.length === 0) body.push(`Zero ${currency}`);
  return `${prefix}${body.join(" ")} Only`;
}
