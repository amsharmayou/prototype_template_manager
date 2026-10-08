/**
 * Validation for a `.btpkg` archive.
 *
 * Every entry point here *reports*; none of them throw. A package arrives from
 * outside, so the one thing worse than a malformed package is a validator that
 * throws on the first bad field and leaves the caller with a stack trace instead
 * of a list. Each `Issue` carries the dotted path of the offending field so a
 * host can point at it in its own UI.
 */

import type { Issue, Package } from "@/lib/package/format";
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

const COMPUTED_OPS = new Set(["sum", "sum-times", "add", "subtract", "multiply", "percent"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(path: string, message: string): Issue {
  return { severity: "error", path, message };
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

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  assets.forEach((a, i) => {
    if (!isRecord(a)) {
      out.push(issue(`assets[${i}]`, "asset entry is not an object"));
      return;
    }
    if (typeof a.file !== "string" || a.file.length === 0) {
      out.push(issue(`assets[${i}].file`, "asset has no file"));
    } else if (!files.has(a.file)) {
      out.push(issue(`assets[${i}].file`, `asset file ${a.file} is not in the archive`));
    }
  });

  const fonts = Array.isArray(manifest.fonts) ? manifest.fonts : [];
  fonts.forEach((f, i) => {
    if (!isRecord(f)) {
      out.push(issue(`fonts[${i}]`, "font entry is not an object"));
      return;
    }
    if (typeof f.file !== "string" || !files.has(f.file)) {
      out.push(issue(`fonts[${i}].file`, `font file ${String(f.file)} is not in the archive`));
    }
  });

  const fields = Array.isArray(manifest.fields) ? manifest.fields : [];
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
    }
    if (typeof f.type !== "string" || !FIELD_TYPES.has(f.type)) {
      out.push(issue(`fields[${i}].type`, `unknown field type ${String(f.type)}`));
    }
    if (f.type === "repeating" && (!Array.isArray(f.columns) || f.columns.length === 0)) {
      out.push(issue(`fields[${i}].columns`, "a repeating field must declare its columns"));
    }
    if (f.pattern !== undefined && typeof f.pattern !== "string") {
      out.push(issue(`fields[${i}].pattern`, "pattern must be a string"));
    }
  });

  const computed = Array.isArray(manifest.computed) ? manifest.computed : [];
  computed.forEach((c, i) => {
    if (!isRecord(c)) {
      out.push(issue(`computed[${i}]`, "computed entry is not an object"));
      return;
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
