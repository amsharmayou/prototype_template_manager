import type { ComputedSpec, Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { sha256HexBytes } from "@/lib/render/sha256";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import { extractVariables } from "@/lib/template/placeholders";
import type { BillTemplate, TableObject, TemplateObject } from "@/lib/template/types";

import { strToU8, zipSync } from "fflate";

export interface BuildOptions {
  computed?: ComputedSpec[];
  currencyScale?: number;
}

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * Decode an inline image to the bytes that will actually be archived.
 *
 * Throws when the runtime has no base64 decoder, naming the object that owns the
 * image. The alternative - substituting an empty `Uint8Array` - is not a graceful
 * degradation: a zero-byte asset has a perfectly good checksum, so the package
 * would validate clean and the bill would print with a part silently missing. The
 * archived bytes are internally consistent, so no later validator can catch it.
 * Build time is the only place it can be caught, and it must be loud.
 *
 * `what` is the caller's description of the object, so the message points an
 * author at one editable thing rather than at the package as a whole.
 */
function decodeDataUri(src: string, what: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error(
      `cannot decode the inline image of ${what}: this runtime has no base64 decoder, ` +
        `so the image cannot be archived and the package would be unusable`,
    );
  }
  const b64 = src.slice(src.indexOf(",") + 1);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Archive names must be safe and unique; ids come from the editor, so neither is assumed. */
function safeName(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "asset";
}

/**
 * The distinct `{{token}}` names inside a repeat band, in band order.
 *
 * The same rule `deriveForm` applies in `lib/package/form.ts`, declared here so the
 * manifest and the form a host derives from it cannot disagree: a column the
 * manifest omits is a column the generated line-item editor never offers, while a
 * computed total that reads it resolves against nothing.
 */
function bandColumns(t: TableObject, startRow: number, endRow: number): string[] {
  const width = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const text = cells[r * width + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

/**
 * Turn a template into the distributable package form.
 *
 * Images move out of the JSON and into the archive. Base64 inflates binary by a
 * third, and holding the bytes in one place is what lets a host read one asset
 * without parsing the whole document.
 */
export function buildPackage(template: BillTemplate, options: BuildOptions = {}): Package {
  const files = new Map<string, Uint8Array>();
  const assets: PackageManifest["assets"] = [];
  const bySrc = new Map<string, string>();

  const uniqueAssetName = (id: string): string => {
    const base = `assets/${safeName(id)}.png`;
    if (!files.has(base)) return base;
    let n = 2;
    while (files.has(`assets/${safeName(id)}-${n}.png`)) n += 1;
    return `assets/${safeName(id)}-${n}.png`;
  };

  const objects: TemplateObject[] = template.objects.map((o) => {
    const src = (o as { src?: unknown }).src;
    // Only inline data is extracted. A remote src is left exactly as it is, so
    // the package never claims to carry bytes it does not have.
    if (typeof src !== "string" || !DATA_IMAGE.test(src)) return { ...o };

    const known = bySrc.get(src);
    if (known) return { ...o, src: `pkg://${known}` } as TemplateObject;

    const role = o.type === "bill-part" ? "bill-part" : "image-placeholder";
    const name = uniqueAssetName(o.id);
    // Decoded before any of `files`, `bySrc` or `assets` is touched, so a throw
    // cannot leave a name reserved against an asset that was never archived.
    const bytes = decodeDataUri(src, `object "${o.id}" (${o.name})`);
    bySrc.set(src, name);
    files.set(name, bytes);
    assets.push({
      id: o.id,
      role,
      file: name,
      width: Math.round(o.width),
      height: Math.round(o.height),
    });
    return { ...o, src: `pkg://${name}` } as TemplateObject;
  });

  const templateJson = JSON.stringify({ ...template, objects }, null, 2);
  files.set("template.json", strToU8(templateJson));

  const fields: PackageManifest["fields"] = extractTemplateFields({ ...template, objects }).map(
    (f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      source: f.source,
      objectName: f.objectName,
      ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
    }),
  );

  // One manifest field per repeat band. Without this the manifest declares no
  // `repeating` field at all, and a host deriving a form from it would show no
  // line-item editor while the renderer's computed totals still reference
  // `items.amount` - a form that silently cannot be filled in.
  for (const o of template.objects) {
    if (o.type !== "table" || !o.repeat || typeof o.repeat.key !== "string") continue;
    const key = o.repeat.key;
    // A band key is also a candidate flat token, so `extractTemplateFields` may
    // already have claimed it. `repeats` is keyed by field key and needs one
    // entry per band, so an exact-key hit retypes that field instead of adding a
    // second entry under a name the validator would reject as a duplicate. Two
    // bands sharing a key remain a duplicate, which is the correct report: the
    // second band's rows resolve against the first band's columns.
    const at = fields.findIndex((f) => f.key === key);
    const repeat = {
      key,
      label: o.name || key,
      type: "repeating" as const,
      source: "table" as const,
      objectName: o.name,
      columns: bandColumns(o, o.repeat.startRow, o.repeat.endRow),
      maxItems: o.repeat.maxItems,
    };
    if (at < 0) fields.push(repeat);
    else fields[at] = { ...fields[at], ...repeat };
  }

  const checksums: Record<string, string> = {};
  for (const [name, bytes] of files) checksums[name] = sha256HexBytes(bytes);

  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    templateVersion: template.templateVersion,
    name: template.meta?.name ?? "Untitled bill",
    document: {
      width: template.document?.width ?? 794,
      height: template.document?.height ?? 1123,
      unit: "px",
      dpi: 96,
      paper:
        template.document?.width === 794 && template.document?.height === 1123 ? "A4" : "custom",
      currencyScale: options.currencyScale ?? 2,
    },
    template: "template.json",
    assets,
    fonts: [],
    fields,
    computed: options.computed ?? [],
    checksums,
  };

  return { manifest, files };
}

/**
 * Serialise the package to zip bytes.
 *
 * The manifest is written alongside a sibling `manifest.json.sha256` digest, so
 * the manifest itself is covered by a checksum. It cannot carry its own digest
 * inside `checksums`, because hashing bytes that embed their own hash is
 * impossible; a reader verifies the manifest against this sibling member instead.
 */
export function writePackage(pkg: Package): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of pkg.files) entries[name] = bytes;
  entries["manifest.json"] = strToU8(JSON.stringify(pkg.manifest, null, 2));
  entries["manifest.json.sha256"] = strToU8(sha256HexBytes(entries["manifest.json"]!));
  return zipSync(entries, { level: 6 });
}
