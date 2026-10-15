import type { Package } from "./format";
import type { BillTemplate, TemplateObject } from "../template/types";
import { TEMPLATE_VERSION } from "../template/types";

import { strFromU8 } from "fflate";

const SCHEME = "pkg://";

/**
 * Extension to image type, for a package written before `ManifestAsset` recorded a
 * mime.
 *
 * This inverts a lossy transform rather than repeating it: `buildPackage` sanitises
 * a declared subtype into a filename-safe token, so `image/svg+xml` is archived as
 * `.svg-xml`. Only types whose token is still the subtype are listed, which is why
 * `.svg-xml` is absent - its token is not the subtype, and mapping it back would be
 * the same guess this function exists to avoid. An extension the map does not know
 * yields undefined and the reference is reported.
 */
const FALLBACK_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function extensionOf(path: string): string {
  const at = path.lastIndexOf(".");
  return at < 0 ? "" : path.slice(at).toLowerCase();
}

/**
 * A mime that will become a well-formed `data:` image URI and nothing else: an
 * `image/` prefix followed by a bare subtype token.
 *
 * Anchored rather than a prefix test, because "a trusted mime yields
 * `data:image/<subtype>;base64,`" then holds by construction instead of by
 * accident. `attr()` escapes quotes and the `data:image/` prefix forecloses a
 * scheme escape, so a looser check is harmless *today* - but those are properties
 * of the renderer, not of this function, and they are not why a caller should be
 * able to trust the result.
 */
function isTrustedMime(mime: unknown): mime is string {
  return typeof mime === "string" && /^image\/[a-z0-9.+-]+$/.test(mime);
}

/**
 * What the bytes at `path` are declared to be, or undefined if that cannot be
 * established.
 *
 * The manifest's `mime` wins whenever it is present and trustworthy. A manifest
 * arrives through an unvalidated `JSON.parse` cast, so `assets` itself may not be
 * an array and a `mime` may be absent, not a string, or not a bare image subtype -
 * each of which counts as no declaration at all rather than as one to trust.
 */
function mimeFor(pkg: Package, path: string): string | undefined {
  const assets = pkg?.manifest?.assets;
  const declared = Array.isArray(assets)
    ? assets.find((a) => a?.file === path)?.mime
    : undefined;
  if (isTrustedMime(declared)) return declared;
  return FALLBACK_MIME[extensionOf(path)];
}

function toDataUri(bytes: Uint8Array, mime: string, path: string): string {
  if (typeof btoa !== "function") {
    throw new Error(
      `cannot encode the asset ${path}: this runtime has no base64 encoder, so the ` +
        `image cannot be inlined and the bill would print with a part missing`,
    );
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Turn a package back into the plain `BillTemplate` the renderer expects, with
 * `pkg://` asset references replaced by inline data URIs.
 *
 * The asymmetry is deliberate and load-bearing: the package is the *distributable*
 * format while `BillTemplate` with data URIs remains the *in-memory render*
 * format. Because resolution happens here, `renderHtml` and its whole pipeline
 * never learn that packages exist, and its purity guarantee and byte-for-byte
 * goldens keep holding.
 *
 * Two things are reported rather than papered over, and in both the `pkg://`
 * reference is left in place, because `lib/render`'s `isSafeImageSrc` rejects that
 * scheme. What the renderer then does differs by role, and the difference decides
 * whether the customer can see that anything went wrong:
 *
 * - An unresolved `image-placeholder` still paints its dashed slot, so the part
 *   remains visible on the page. Nothing is recorded for it, so it is the quiet
 *   case.
 * - An unresolved `bill-part` is *removed from the page entirely*.
 *   `renderBillPart` returns `null` and `renderHtml` filters nulls out of the body.
 *   A refusal is recorded, naming the object - though not the file, since it records
 *   `typeof o.src`, so the path is recoverable only from `unresolved` above.
 *
 * So the diagnosable failure exists for the role that drops the object, and only if
 * somebody reads it: a host that does not surface `refusals` will show a customer a
 * bill with a missing part and no indication anything was wrong.
 *
 * Whether an unresolved bill part should instead paint a visible placeholder is a
 * product decision with customer-visible consequences, and is deliberately not made
 * here.
 */
export function resolvePackage(pkg: Package): { template: BillTemplate; unresolved: string[] } {
  const unresolved: string[] = [];
  const note = (path: string): void => {
    if (!unresolved.includes(path)) unresolved.push(path);
  };

  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();

  const empty: BillTemplate = {
    templateVersion: TEMPLATE_VERSION,
    document: { width: 0, height: 0 },
    meta: { name: "", modifiedAt: "" },
    objects: [],
  };

  let template = empty;
  const raw = files.get(pkg?.manifest?.template ?? "template.json");
  if (raw) {
    try {
      template = JSON.parse(strFromU8(raw)) as BillTemplate;
    } catch {
      template = empty;
    }
  }

  const objects: TemplateObject[] = (Array.isArray(template.objects) ? template.objects : []).map(
    (o) => {
      const src = (o as { src?: unknown }).src;
      if (typeof src !== "string" || !src.startsWith(SCHEME)) return { ...o };

      const path = src.slice(SCHEME.length);
      const bytes = files.get(path);
      if (!bytes) {
        note(path);
        return { ...o };
      }

      const mime = mimeFor(pkg, path);
      if (mime === undefined) {
        note(path);
        return { ...o };
      }

      return { ...o, src: toDataUri(bytes, mime, path) } as TemplateObject;
    },
  );

  return { template: { ...template, objects }, unresolved };
}
