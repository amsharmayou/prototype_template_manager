import type { ComputedSpec, Package, PackageManifest } from "./format";
import { PACKAGE_VERSION } from "./format";
import { sha256HexBytes } from "../render/sha256";
import { extractTemplateFields } from "../template/dataBinding";
import { extractVariables } from "../template/placeholders";
import type { BillTemplate, TableObject, TemplateObject } from "../template/types";

import { strToU8, zipSync } from "fflate";

export interface BuildOptions {
  computed?: ComputedSpec[];
  currencyScale?: number;
}

/**
 * An inline image, capturing its declared type.
 *
 * Not global: a shared `/g` regex carries `lastIndex` between `exec` calls and
 * silently stops matching.
 */
const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,/i;

/**
 * The image type an inline data URI declares, lowercased, e.g. `image/webp`.
 *
 * Undefined for anything that is not a base64 image data URI - the same condition
 * `DATA_IMAGE.test` reports - so this and `imageExtension` read one definition of
 * what a data URI looks like rather than each holding their own.
 *
 * This is the type the URI *declared*, not one recovered from the bytes. A file
 * that was already wrong before it was inlined stays wrong here; sniffing the
 * actual content is a separate feature, and this is not content validation.
 */
function declaredMime(src: string): string | undefined {
  return DATA_IMAGE.exec(src)?.[1]?.toLowerCase();
}

/**
 * Archive extension taken from the URI's declared mime subtype.
 *
 * The sanitising below is lossy, which is why `ManifestAsset` also records the mime
 * itself: `image/svg+xml` becomes `svg-xml`, and a reader working from the name
 * alone cannot put the original back.
 */
function imageExtension(src: string): string {
  const subtype = declaredMime(src)?.split("/")[1] ?? "";
  const cleaned = subtype
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return cleaned.length > 0 ? cleaned : "img";
}

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
 * Images move out of the JSON and into the archive.
 *
 * The archive-level size win is small - measured at 2-3%, not the third that
 * base64's overhead suggests, because deflate's Huffman coding already recovers
 * most of that inflation: base64 carries 6 bits per character, so it compresses
 * almost back down before extraction is even considered. What extraction
 * actually buys is that template.json stops carrying megabytes of text, so
 * reading the template is cheap and each image is a separately addressable member
 * a host can fetch without parsing the whole document.
 */
export function buildPackage(template: BillTemplate, options: BuildOptions = {}): Package {
  const files = new Map<string, Uint8Array>();
  const assets: PackageManifest["assets"] = [];
  const bySrc = new Map<string, string>();

  const uniqueAssetName = (id: string, ext: string): string => {
    const base = `assets/${safeName(id)}.${ext}`;
    if (!files.has(base)) return base;
    let n = 2;
    while (files.has(`assets/${safeName(id)}-${n}.${ext}`)) n += 1;
    return `assets/${safeName(id)}-${n}.${ext}`;
  };

  const objects: TemplateObject[] = template.objects.map((o) => {
    const src = (o as { src?: unknown }).src;
    // Only inline data is extracted. A remote src is left exactly as it is, so
    // the package never claims to carry bytes it does not have.
    if (typeof src !== "string" || !DATA_IMAGE.test(src)) return { ...o };

    const known = bySrc.get(src);
    if (known) return { ...o, src: `pkg://${known}` } as TemplateObject;

    const role = o.type === "bill-part" ? "bill-part" : "image-placeholder";
    const name = uniqueAssetName(o.id, imageExtension(src));
    // Decoded before any of `files`, `bySrc` or `assets` is touched, so a throw
    // cannot leave a name reserved against an asset that was never archived.
    const bytes = decodeDataUri(src, `object "${o.id}" (${o.name})`);
    bySrc.set(src, name);
    files.set(name, bytes);
    assets.push({
      id: o.id,
      role,
      file: name,
      // Sound: `DATA_IMAGE.test(src)` is the guard two lines above, so the URI
      // declares a type.
      mime: declaredMime(src)!,
      width: Math.round(o.width),
      height: Math.round(o.height),
    });
    return { ...o, src: `pkg://${name}` } as TemplateObject;
  });

  // `meta.modifiedAt` is neutralised on the way in. It is editor bookkeeping -
  // "when this document was last saved" - and serialising it makes the archive a
  // function of the clock rather than of the template, which would make any
  // `sha256(bytes)` taken of the package unusable as a content address.
  // `writePackage` already pins the other half of the same problem, the zip
  // timestamps; this is its content-side twin. The field keeps its type and its
  // key, so a reader still finds a string where `TemplateMeta.modifiedAt` is
  // declared, and `emptyTemplate` already uses `""` for the same "no timestamp"
  // meaning. The renderer excludes it for the same reason, by reducing `meta` to
  // its name at `version 1/lib/render/index.ts:179`.
  const templateJson = JSON.stringify(
    { ...template, meta: { ...template.meta, modifiedAt: "" }, objects },
    null,
    2,
  );
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
    if (o.type !== "table" || !o.repeat) continue;
    // This loop is the only place a band key can be normalised, and every other
    // layer that reads one already trims: `validateManifest` compares `key.trim()`
    // and `repeatsOf` in `deriveForm` stores `band.key.trim()`. Emitting the raw
    // value declared a repeat under a name no computed arg could resolve against,
    // so the package failed its own validator - and a form derived from it would
    // bind a different name than the manifest declared.
    const key = typeof o.repeat.key === "string" ? o.repeat.key.trim() : "";
    // Whitespace-only names no values array a form could bind to, and would put a
    // blank field key into the manifest, which the validator rejects outright.
    if (key.length === 0) continue;
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
      // A band whose cells carry no `{{token}}` yields `[]`, and the validator
      // rejects a `repeating` field with no columns at `fields[n].columns`. That
      // is left to surface at validation rather than suppressed here: a band with
      // no tokens is an authoring mistake, and inventing a placeholder column to
      // satisfy the shape check would hide it behind a field nothing fills. The
      // package reports the problem instead of shipping clean and silently
      // omitting the line items.
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
 *
 * `mtime` is pinned, not defaulted. fflate otherwise stamps `Date.now()` into
 * every local file header and into the central directory, so two builds of one
 * template seconds apart are different byte strings with different SHA-256s.
 * An id taken from those bytes would then not be a function of the content: the
 * same template exported twice yields two rows and two files, dedupe never
 * hits, and the id stops being able to carry an integrity claim.
 *
 * 315532800000 is the ZIP epoch, 1980-01-01T00:00:00Z - the earliest instant
 * DOS time can encode. Not `0`: that is 1970, which fflate rejects outright with
 * "date not in range 1980-1999".
 */
export function writePackage(pkg: Package): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of pkg.files) entries[name] = bytes;
  entries["manifest.json"] = strToU8(JSON.stringify(pkg.manifest, null, 2));
  entries["manifest.json.sha256"] = strToU8(sha256HexBytes(entries["manifest.json"]!));
  return zipSync(entries, { level: 6, mtime: 315532800000 });
}
