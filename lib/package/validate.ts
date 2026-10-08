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

import { strToU8 } from "fflate";

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

/**
 * The single constructor for issues, and it always produces `"error"`.
 *
 * There is deliberately no warning path. `Issue` carries `Severity`, so the
 * union has room for one, but nothing this module can decide is advisory: it
 * sees the manifest and the file bytes, so what it can reach is exactly what is
 * wrong. See `validatePackage` for where a warning would come from.
 */
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

/** A computed entry as a graph node. `deps` are node references, not names. */
type ComputedNode = {
  key: string;
  index: number;
  spec: Record<string, unknown>;
  deps: ComputedNode[];
  /** How far the depth-first walk has got through `deps`. */
  at: number;
};

const UNSEEN = 0;
const ON_STACK = 1;
const DONE = 2;

/**
 * Report every cycle in the computed reference graph.
 *
 * A cycle is worse than uncomputable in principle. `computeAll` evaluates specs
 * in array order, so the first entry of a cycle reads a value that has not been
 * computed yet; the lookup falls through to the supplied values map, finds
 * nothing, and contributes zero. The bill then prints a total that is quietly
 * wrong, with nothing anywhere reporting why. This is the only place the defect
 * can be caught before the bill leaves the building.
 *
 * **One issue per cycle**, anchored at the earliest-declared member, rather than
 * one for the whole graph. A manifest can hold several independent cycles, and a
 * single graph-level issue would make the author fix one, reload, and discover
 * the next - exactly the one-problem-per-reload failure this validator exists to
 * remove. The message names every entry in the cycle, so splitting costs the
 * author nothing.
 *
 * Self-reference is deliberately excluded from the edges: it is the length-1
 * cycle, already reported at its own arg, and admitting it here would report the
 * same defect twice.
 *
 * An arg that names no computed entry is a leaf. That covers both a name matching
 * nothing and a dotted arg, which resolves into a repeat's columns - data, not a
 * computed entry, so a chain may legitimately run through one.
 */
function reportComputedCycles(
  computed: unknown[],
  computedKeys: ReadonlySet<string>,
  out: Issue[],
): void {
  const nodes = new Map<string, ComputedNode>();
  computed.forEach((c, i) => {
    if (!isRecord(c)) return;
    const key = c.key;
    // Only entries that actually entered the resolvable set are nodes, so the
    // graph and resolution cannot disagree about who exists.
    if (typeof key !== "string" || !computedKeys.has(key) || nodes.has(key)) return;
    nodes.set(key, { key, index: i, spec: c, deps: [], at: 0 });
  });

  for (const node of nodes.values()) {
    const args = Array.isArray(node.spec.args) ? node.spec.args : [];
    for (const name of [...args, node.spec.rateKey]) {
      if (typeof name !== "string" || name === node.key) continue;
      const target = nodes.get(name);
      if (target && !node.deps.includes(target)) node.deps.push(target);
    }
  }

  const state = new Map<string, number>();
  const stack: ComputedNode[] = [];

  for (const root of nodes.values()) {
    if ((state.get(root.key) ?? UNSEEN) !== UNSEEN) continue;
    state.set(root.key, ON_STACK);
    stack.push(root);
    while (stack.length > 0) {
      const node = stack[stack.length - 1];
      if (node.at >= node.deps.length) {
        state.set(node.key, DONE);
        stack.pop();
        continue;
      }
      const next = node.deps[node.at];
      node.at += 1;
      const seen = state.get(next.key) ?? UNSEEN;
      if (seen === DONE) continue;
      if (seen === ON_STACK) {
        // `ON_STACK` is only ever set at the moment a node is pushed, so an
        // on-stack node is by construction present in the stack and `from` is
        // never -1. Guarded anyway: `stack.length = -1` would throw, and this
        // module's contract is that it never does. A contract that depends on
        // an invariant forty lines up is not one a reader can check.
        const from = stack.indexOf(next);
        if (from < 0) continue;
        const cycle = stack.slice(from);
        const anchor = cycle.reduce((earliest, n) =>
          n.index < earliest.index ? n : earliest,
        );
        const chain = [...cycle.map((n) => n.key), cycle[0].key].join(" -> ");
        out.push(
          issue(
            `computed[${anchor.index}]`,
            `these computed entries form a cycle, so no order can evaluate them: ${chain}`,
          ),
        );
        // Retire the cycle so the same one is not reported again from another
        // entry into it.
        for (const n of cycle) state.set(n.key, DONE);
        stack.length = from;
        continue;
      }
      state.set(next.key, ON_STACK);
      stack.push(next);
    }
  }
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
  manifestBytes?: Uint8Array,
  manifestSha256?: string,
): Issue[] {
  const out: Issue[] = [];
  if (!isRecord(manifest)) return [issue("", "manifest is not an object")];

  // `checksums` below cannot cover the manifest: a file cannot contain its own
  // hash, so the digest is written beside it and both are handed in together.
  //
  // Two separate things can drift from that digest, and checking only the first
  // blesses the second. The archived bytes can be altered, which is the case a
  // checksum catches. Or the parsed manifest can be edited in memory after the
  // parse - a host that rewrites `name` or drops an asset from a package it
  // already loaded - in which case the bytes and the sibling digest still agree
  // with each other and only disagree with the object actually being validated.
  //
  // Re-serialising is what ties the object to the digest, and it is exact:
  // `writePackage` writes the manifest with `JSON.stringify(..., null, 2)` and
  // `JSON.parse` preserves key order, so an untouched manifest reproduces its
  // archived bytes bit for bit. Both messages are reported as the same `manifest`
  // path because to a host they are one fact: this manifest is not the one that
  // was signed over.
  if (manifestSha256 !== undefined) {
    if (manifestBytes && sha256HexBytes(manifestBytes) !== manifestSha256) {
      out.push(issue("manifest", "manifest does not match the checksum stored beside it"));
    } else if (sha256HexBytes(strToU8(JSON.stringify(manifest, null, 2))) !== manifestSha256) {
      out.push(issue("manifest", "manifest was edited after it was read"));
    }
  }

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
    // `.trim()` rather than a length test, matching `computed[].key`. A computed
    // arg is an arbitrary manifest string, not a token, so an author really can
    // write `args: [" "]` and land on such a field; `fieldKeys` is load-bearing
    // for resolution in exactly the way `computedKeys` is.
    const usable = typeof key === "string" && key.trim().length > 0;
    const fresh = usable && !seen.has(key);
    if (!usable) {
      out.push(issue(`fields[${i}].key`, "field has no key"));
    } else if (!fresh) {
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
    // Only repeating fields have columns, so only they can be a path head, and
    // only a field whose key was *accepted* becomes one: a key rejected above as
    // a duplicate must not become the head a dotted arg resolves against, or the
    // author is shown a resolution message about a field that was never
    // declared. `fresh` already implies the key is unseen, so no separate
    // `repeats.has` test is needed. The non-string filter keeps the map to
    // columns a resolution could match: one that is not a string can never equal
    // a string arg, so admitting it would only widen what resolves.
    if (f.type === "repeating" && typeof key === "string" && fresh) {
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
    // Both branches are errors because this name set is load-bearing: resolution
    // reads it, so a duplicate makes what an arg resolves *to* depend on which
    // of the two entries a reader happened to find, and an entry with no usable
    // key is an entry nothing can be resolved against. Duplicates are reported
    // on the second occurrence, as field keys are.
    if (typeof c.key !== "string" || c.key.trim().length === 0) {
      out.push(issue(`computed[${i}].key`, "a computed entry must declare a key"));
    } else if (seenComputed.has(c.key)) {
      out.push(issue(`computed[${i}].key`, `duplicate computed key ${c.key}`));
    } else {
      seenComputed.add(c.key);
      computedKeys.add(c.key);
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

  reportComputedCycles(computed, computedKeys, out);

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

/**
 * `ok` is false when at least one **error** was found, and that is the whole
 * definition: `ok` means "no errors", nothing more.
 *
 * `Severity` also admits `"warning"`, but no rule here emits one yet — every
 * check below is a hard failure, and inventing a soft one would be a guess. The
 * warning exists so that the checks which *are* advisory can be added later
 * without changing this signature or `ok`'s meaning: a host that renders
 * `issues` verbatim already has somewhere to put them, and a warning can never
 * flip `ok`. The advisory checks belong to the layer that can read the template
 * bytes — things like a field no cell ever fills — which `validateManifest`
 * deliberately does not receive.
 */
export function validatePackage(pkg: Package): { ok: boolean; issues: Issue[] } {
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();
  // The manifest is excluded from `files` by the parser, so its bytes are carried
  // alongside the digest and verified here.
  const manifestBytes = pkg?.manifestBytes;
  const issues = validateManifest(
    pkg?.manifest,
    files,
    manifestBytes,
    pkg?.manifestSha256,
  );
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
