/**
 * Validation for a `.btpkg` archive.
 *
 * Every entry point here *reports*; none of them throw. A package arrives from
 * outside, so the one thing worse than a malformed package is a validator that
 * throws on the first bad field and leaves the caller with a stack trace instead
 * of a list. Each `Issue` carries the dotted path of the offending field so a
 * host can point at it in its own UI.
 *
 * The checks fall into two classes. Shape checks ask whether a value is the kind
 * of thing the format says it is. Resolution checks ask whether the manifest
 * agrees with *itself*: whether every name a computed entry reads is actually
 * something a form will fill. The second class is the one that earns this
 * validator its keep - the manifest exists so a foreign frontend can generate a
 * form from it, and a shape-valid arg naming nothing produces a form with inputs
 * that no value ever reaches, with nothing anywhere reporting why.
 */

import type {
  ComputedSpec,
  Issue,
  ManifestField,
  Package,
} from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { sha256HexBytes } from "@/lib/render/sha256";
import { TEMPLATE_VERSION } from "@/lib/template/types";

const FIELD_TYPES = new Set([
  "text",
  "number",
  "date",
  "currency",
  "tickmark",
  "checkbox",
  "image",
  "repeating",
]);

const FIELD_SOURCES = new Set(["text", "table", "image-placeholder", "field"]);

const ASSET_ROLES = new Set(["bill-part", "image-placeholder"]);

const COMPUTED_OPS = new Set(["sum", "sum-times", "add", "subtract", "multiply", "percent"]);

/** Repeat field key -> the column names it declares. Resolution needs this map. */
type RepeatColumns = Map<ManifestField["key"], NonNullable<ManifestField["columns"]>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(path: string, message: string): Issue {
  return { severity: "error", path, message };
}

/** What a value turned out to be, for a message that has to name it. */
function typeName(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return typeof v;
  }
}

/**
 * Read one of the manifest's list sections.
 *
 * A *missing* key is fine: a package with no fonts is ordinary. A key of the
 * wrong type is not, and it is reported rather than coerced to `[]` - coercing
 * it is what let `fields: "oops"` validate clean, silently dropping every field
 * the exporter meant to declare.
 */
function section(value: unknown, key: string, out: Issue[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    out.push(issue(key, `${key} must be an array, but it is ${typeName(value)}`));
    return [];
  }
  return value;
}

/**
 * Split a dotted arg into its repeat and column parts.
 *
 * Split at the *first* dot only. The placeholder grammar admits dots inside a
 * variable name, so `amount.net` is itself a legal column, and `items.amount.net`
 * means column `amount.net` of repeat `items` - not a three-part path.
 */
function splitPath(arg: string): { head: string; tail: string } | undefined {
  const at = arg.indexOf(".");
  if (at < 0) return undefined;
  return { head: arg.slice(0, at), tail: arg.slice(at + 1) };
}

/**
 * Why a name cannot be resolved, or `undefined` when it resolves.
 *
 * Whole-name resolution is tried before path resolution so that a field
 * literally keyed `items.amount` wins over the dotted reading. Every entry in
 * the computed list counts, not just earlier ones: a chain is a set of
 * references, and which entry happens to be written first carries no meaning.
 */
function unresolved(
  name: string,
  fieldKeys: ReadonlySet<ManifestField["key"]>,
  computedKeys: ReadonlySet<ComputedSpec["key"]>,
  repeats: Readonly<RepeatColumns>,
): string | undefined {
  if (fieldKeys.has(name) || computedKeys.has(name)) return undefined;

  const path = splitPath(name);
  if (path) {
    const columns = repeats.get(path.head);
    if (columns === undefined) {
      return fieldKeys.has(path.head)
        ? `"${path.head}" is a declared field but not a repeating one, so it has no columns`
        : `it names no repeating field "${path.head}"`;
    }
    if (!columns.includes(path.tail)) {
      const have = columns.length > 0 ? columns.join(", ") : "none";
      return `repeat field "${path.head}" declares no column "${path.tail}" (columns: ${have})`;
    }
    return undefined;
  }

  return "it is neither a declared field key nor the key of another computed entry";
}

/**
 * Validate a manifest against the archive it claims to describe.
 *
 * Returns issues rather than throwing, so a host can show every problem at once
 * instead of surfacing them one reload at a time.
 */
export function validateManifest(
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
): Issue[] {
  const out: Issue[] = [];
  if (!isRecord(manifest)) return [issue("", "manifest is not an object")];

  if (manifest.packageVersion !== PACKAGE_VERSION) {
    out.push(
      issue(
        "packageVersion",
        `package version ${String(manifest.packageVersion)} is not supported; this build reads ${PACKAGE_VERSION}`,
      ),
    );
  }
  const tplVersion = manifest.templateVersion;
  if (typeof tplVersion !== "number" || !Number.isFinite(tplVersion)) {
    out.push(issue("templateVersion", "template version is not a number"));
  } else if (tplVersion > TEMPLATE_VERSION) {
    out.push(
      issue(
        "templateVersion",
        `template version ${tplVersion} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
      ),
    );
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    out.push(issue("name", "manifest has no name"));
  }

  const doc = manifest.document;
  if (!isRecord(doc)) {
    out.push(issue("document", "manifest has no document"));
  } else {
    for (const side of ["width", "height"] as const) {
      const v = doc[side];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        out.push(issue(`document.${side}`, `page ${side} must be a positive number`));
      }
    }
    const scale = doc.currencyScale;
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > 6) {
      out.push(issue("document.currencyScale", "currencyScale must be an integer from 0 to 6"));
    }
  }

  const templatePath = manifest.template;
  if (typeof templatePath !== "string" || templatePath.length === 0) {
    out.push(issue("template", "manifest names no template file"));
  } else if (!files.has(templatePath)) {
    out.push(issue("template", `template file ${templatePath} is not in the archive`));
  }

  const assets = section(manifest.assets, "assets", out);
  assets.forEach((a, i) => {
    if (!isRecord(a)) {
      out.push(issue(`assets[${i}]`, "asset entry is not an object"));
      return;
    }
    if (typeof a.role !== "string" || !ASSET_ROLES.has(a.role)) {
      out.push(issue(`assets[${i}].role`, `unknown asset role ${String(a.role)}`));
    }
    if (typeof a.file !== "string" || a.file.length === 0) {
      out.push(issue(`assets[${i}].file`, "asset has no file"));
    } else if (!files.has(a.file)) {
      out.push(issue(`assets[${i}].file`, `asset file ${a.file} is not in the archive`));
    }
  });

  const fonts = section(manifest.fonts, "fonts", out);
  fonts.forEach((f, i) => {
    if (!isRecord(f)) {
      out.push(issue(`fonts[${i}]`, "font entry is not an object"));
      return;
    }
    if (typeof f.file !== "string" || !files.has(f.file)) {
      out.push(issue(`fonts[${i}].file`, `font file ${String(f.file)} is not in the archive`));
    }
  });

  const fields = section(manifest.fields, "fields", out);
  const fieldKeys = new Set<ManifestField["key"]>();
  const repeats: RepeatColumns = new Map();
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!isRecord(f)) {
      out.push(issue(`fields[${i}]`, "field entry is not an object"));
      return;
    }
    const key = f.key;
    if (typeof key !== "string" || key.length === 0) {
      out.push(issue(`fields[${i}].key`, "field has no key"));
    } else if (seen.has(key)) {
      out.push(issue(`fields[${i}].key`, `duplicate field key ${key}`));
    } else {
      seen.add(key);
      fieldKeys.add(key);
    }
    if (typeof f.type !== "string" || !FIELD_TYPES.has(f.type)) {
      out.push(issue(`fields[${i}].type`, `unknown field type ${String(f.type)}`));
    }
    if (typeof f.source !== "string" || !FIELD_SOURCES.has(f.source)) {
      out.push(issue(`fields[${i}].source`, `unknown field source ${String(f.source)}`));
    }
    if (f.type === "repeating" && (!Array.isArray(f.columns) || f.columns.length === 0)) {
      out.push(issue(`fields[${i}].columns`, "a repeating field must declare its columns"));
    }
    if (f.pattern !== undefined && typeof f.pattern !== "string") {
      out.push(issue(`fields[${i}].pattern`, "pattern must be a string"));
    }
    // Only repeating fields have columns, so only they can be a path head. The
    // non-string filter keeps the map to columns a resolution could match: one
    // that is not a string can never equal a string arg, so admitting it would
    // only widen what resolves.
    if (f.type === "repeating" && typeof key === "string" && key.length > 0 && !repeats.has(key)) {
      const columns = Array.isArray(f.columns) ? f.columns : [];
      repeats.set(
        key,
        columns.filter((c): c is string => typeof c === "string"),
      );
    }
  });

  const computed = section(manifest.computed, "computed", out);
  const computedKeys = new Set<ComputedSpec["key"]>();
  const seenComputed = new Set<string>();
  computed.forEach((c, i) => {
    if (!isRecord(c)) {
      out.push(issue(`computed[${i}]`, "computed entry is not an object"));
      return;
    }
    // A duplicate is reported on the second occurrence, as for field keys. It
    // is an error rather than untidiness because resolution reads this set: two
    // entries under one key would make what an arg resolves *to* depend on
    // which of them the reader happened to find.
    if (typeof c.key === "string" && c.key.length > 0) {
      if (seenComputed.has(c.key)) {
        out.push(issue(`computed[${i}].key`, `duplicate computed key ${c.key}`));
      } else {
        seenComputed.add(c.key);
        computedKeys.add(c.key);
      }
    }
    if (typeof c.op !== "string" || !COMPUTED_OPS.has(c.op)) {
      out.push(issue(`computed[${i}].op`, `unknown computed op ${String(c.op)}`));
    }
    if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== "string")) {
      out.push(issue(`computed[${i}].args`, "computed args must all be strings"));
    }
    if (c.op === "percent" && (typeof c.rateKey !== "string" || c.rateKey.length === 0)) {
      out.push(issue(`computed[${i}].rateKey`, "a percent op must name the rate it applies"));
    }
  });

  // Second pass: with every declared name known, each reference can be resolved.
  computed.forEach((c, i) => {
    if (!isRecord(c)) return;
    const ownKey = typeof c.key === "string" && c.key.length > 0 ? c.key : undefined;
    const args = Array.isArray(c.args) ? c.args : [];
    args.forEach((a, j) => {
      if (typeof a !== "string" || a.length === 0) return;
      // Self-reference is the one cycle a name set can express, because
      // resolution deliberately admits every computed key including this
      // entry's own. `subtotal = subtotal` resolves perfectly and means nothing:
      // no evaluator can produce the value it would read. So it is an error,
      // reported at the arg that carries it.
      if (a === ownKey) {
        out.push(
          issue(
            `computed[${i}].args[${j}]`,
            `arg ${a}: a computed entry cannot read its own key; it names a value nothing produces`,
          ),
        );
        return;
      }
      const why = unresolved(a, fieldKeys, computedKeys, repeats);
      if (why) out.push(issue(`computed[${i}].args[${j}]`, `arg ${why}`));
    });
    if (typeof c.rateKey !== "string" || c.rateKey.length === 0) return;
    if (c.rateKey === ownKey) {
      out.push(
        issue(
          `computed[${i}].rateKey`,
          `rateKey ${c.rateKey}: a computed entry cannot use its own key as its own rate`,
        ),
      );
      return;
    }
    const why = unresolved(c.rateKey, fieldKeys, computedKeys, repeats);
    if (why) out.push(issue(`computed[${i}].rateKey`, `rateKey ${why}`));
  });

  const checksums = manifest.checksums;
  if (checksums !== undefined) {
    if (!isRecord(checksums)) {
      out.push(issue("checksums", "checksums must be an object"));
    } else {
      for (const [path, expected] of Object.entries(checksums)) {
        const bytes = files.get(path);
        if (!bytes) {
          out.push(issue(`checksums.${path}`, "checksum given for a file not in the archive"));
          continue;
        }
        if (typeof expected !== "string" || sha256HexBytes(bytes) !== expected) {
          out.push(issue(`checksums.${path}`, `checksum does not match the archived ${path}`));
        }
      }
    }
  }

  return out;
}

/** `ok` is false when at least one error was found. Warnings never block. */
export function validatePackage(pkg: Package): { ok: boolean; issues: Issue[] } {
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();
  const issues = validateManifest(pkg?.manifest, files);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
