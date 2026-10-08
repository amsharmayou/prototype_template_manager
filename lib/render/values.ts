export type Values = Readonly<Record<string, string>>;

/**
 * Same grammar as `TOKEN_SOURCE` in `lib/template/placeholders`. Duplicated
 * because resolution needs match positions, not just the distinct names; the
 * two must stay in step and a test asserts they agree.
 */
const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

/**
 * A fresh regex per use, for the reason `lib/template/placeholders` gives: a
 * shared global regex carries `lastIndex` between calls. `String.replace` resets
 * it, so a module-level one would work today, and the next call site that
 * reaches for `.test` or `.exec` instead would silently stop matching.
 */
function tokenRegex(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

/**
 * Replace `{{key}}` with the value for that key, or leave the token literally
 * in place when the key is absent or not a string. Substitution is what makes
 * a static render a subset of the data-bound one rather than a separate path.
 *
 * The value is returned raw: the primitive that emits it escapes, so a value
 * substituted into two places is not escaped twice.
 */
export function resolveText(text: string, values: Values): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    const v = values[key];
    return typeof v === "string" ? v : token;
  });
}