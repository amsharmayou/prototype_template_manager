/**
 * `{{placeholder}}` support.
 *
 * Nothing here infers meaning from an image. The user decides, by typing a
 * token, that a text region stands for a dynamic value.
 */

const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

/**
 * A fresh regex per use. A shared global regex carries `lastIndex` between
 * calls, which silently makes later matches return nothing.
 */
function tokenRegex(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

/** Suggested variables offered in the properties panel. */
export const SUGGESTED_VARIABLES = [
  "company_name",
  "company_address",
  "company_gstin",
  "invoice_number",
  "invoice_date",
  "due_date",
  "customer_name",
  "customer_address",
  "customer_gstin",
  "item_no",
  "item_name",
  "item_description",
  "quantity",
  "price",
  "amount",
  "subtotal",
  "discount",
  "tax",
  "tax_rate",
  "total",
  "amount_in_words",
  "bank_name",
  "account_number",
  "ifsc_code",
  "signature",
] as const;

export interface PlaceholderInfo {
  /** All distinct variable names found, in first-appearance order. */
  variables: string[];
  /** True when the whole string is exactly one placeholder. */
  isPureVariable: boolean;
  /**
   * Role to assign: the single variable name when the text is a pure
   * placeholder, otherwise null (mixed or static text).
   */
  role: string | null;
  roleKind: "static" | "variable";
}

/** Extract every `{{name}}` from arbitrary text. */
export function extractVariables(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(tokenRegex())) {
    const name = m[1];
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Build the canonical `{{name}}` form used for display in the editor. */
export function toToken(name: string): string {
  return `{{${name}}}`;
}

export function hasVariable(text: string): boolean {
  return new RegExp(TOKEN_SOURCE).test(text);
}

/**
 * Whether a traced object is a drawn data-field box.
 *
 * The step guide counts these, so a field the author has placed but not yet
 * configured still counts as marked data — and re-typing or re-labelling it
 * later cannot change whether the step is done.
 */
export function isDataFieldObject(obj: { appType?: string }): boolean {
  return obj.appType === "field";
}

export function analysePlaceholders(text: string): PlaceholderInfo {
  const variables = extractVariables(text);
  if (variables.length === 0) {
    return {
      variables: [],
      isPureVariable: false,
      role: null,
      roleKind: "static",
    };
  }
  const isPureVariable = variables.length === 1 && toToken(variables[0]) === text.trim();
  return {
    variables,
    isPureVariable,
    role: isPureVariable ? variables[0] : null,
    roleKind: "variable",
  };
}

/** Every distinct variable used anywhere in the document, sorted. */
export function collectDocumentVariables(
  texts: Iterable<string>,
): string[] {
  const all = new Set<string>();
  for (const t of texts) {
    for (const v of extractVariables(t)) all.add(v);
  }
  return [...all].sort();
}
