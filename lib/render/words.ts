/**
 * Spell a money figure out in words.
 *
 * Hand-written tables rather than a locale-aware number formatter: locale
 * machinery is banned by the `lib/render` purity test, because the renderer has
 * to survive runtimes where it does not exist. `sha256.ts` avoids the platform
 * digest for the same reason. The wording also has to read the way the printed
 * form reads, which is a stricter requirement than a formatter is held to.
 *
 * Grouping follows the Indian system (crore / lakh / thousand), because the
 * figure-in-words line is a mandatory field on an Indian bill and Western
 * thousands grouping is what a reader of one would call wrong.
 */

interface CurrencyWords {
  majorOne: string;
  majorMany: string;
  minorOne: string;
  minorMany: string;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/**
 * Both forms are listed rather than derived by appending an "s". The sub-unit
 * of most currencies keeps its spelling whatever the count, so a naive suffix
 * prints "Fifty Paises Only" -- and a bill that says that is one a customer
 * queries.
 */
const CURRENCY: Record<string, CurrencyWords> = {
  inr: { majorOne: "Rupee", majorMany: "Rupees", minorOne: "Paisa", minorMany: "Paise" },
  usd: { majorOne: "Dollar", majorMany: "Dollars", minorOne: "Cent", minorMany: "Cents" },
  eur: { majorOne: "Euro", majorMany: "Euros", minorOne: "Cent", minorMany: "Cents" },
  gbp: { majorOne: "Pound", majorMany: "Pounds", minorOne: "Penny", minorMany: "Pennies" },
};

const UNKNOWN: CurrencyWords = {
  majorOne: "Unit",
  majorMany: "Units",
  minorOne: "Cent",
  minorMany: "Cents",
};

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  return `${TENS[Math.floor(n / 10)] ?? ""}${n % 10 ? ` ${ONES[n % 10]}` : ""}`.trim();
}

function under1000(n: number): string {
  const head = Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : "";
  const tail = under100(n % 100);
  return [head, tail].filter(Boolean).join(" ");
}

/** Indian grouping: crore (10^7), lakh (10^5), thousand (10^3). */
function groupWords(n: number): string {
  if (n <= 0) return "";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${groupWords(crore)} Crore` : "",
    lakh ? `${under100(lakh)} Lakh` : "",
    thousand ? `${under100(thousand)} Thousand` : "",
    rest ? under1000(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * `minorUnits` is an integer count of the smallest currency unit, so the whole
 * conversion stays exact; `scale` is how many decimal places that unit carries.
 *
 * The sub-unit is read through `groupWords` rather than `under1000`: at four or
 * more decimals the sub-unit count runs past three digits, and a helper capped
 * at 999 answers for the thousands column with `undefined`.
 */
export function spellMoney(minorUnits: number, scale: number, currency?: string): string {
  const safe = Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;
  const words = CURRENCY[(currency ?? "inr").toLowerCase()] ?? UNKNOWN;
  const n = Number.isFinite(minorUnits) ? Math.abs(Math.round(minorUnits)) : 0;

  let majorUnits = n;
  let minorPart = 0;
  if (safe > 0) {
    const divisor = 10 ** safe;
    majorUnits = Math.floor(n / divisor);
    minorPart = n % divisor;
  }

  const pieces: string[] = [];
  if (minorUnits < 0) pieces.push("Minus");
  if (majorUnits === 0 && minorPart === 0) {
    pieces.push(`Zero ${words.majorMany} Only`);
  } else {
    if (majorUnits > 0) {
      const unit = majorUnits === 1 ? words.majorOne : words.majorMany;
      pieces.push(`${groupWords(majorUnits)} ${unit}`);
    }
    if (minorPart > 0) {
      const unit = minorPart === 1 ? words.minorOne : words.minorMany;
      pieces.push(`${groupWords(minorPart)} ${unit}`);
    }
    pieces.push("Only");
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}
