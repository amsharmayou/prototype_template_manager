import type { Package } from "@/lib/package/format";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";
import { TEMPLATE_VERSION } from "@/lib/template/types";

import { strFromU8 } from "fflate";

const SCHEME = "pkg://";

/**
 * Extension to image type, for a package written before `ManifestAsset` recorded a
 * mime.
 *
 * This inverts a lossy transform rather than repeating it: `buildPackage` sanitises
 * a declared subtype into a filename-safe token, so `image/svg+xml` is archived as
 * `.svg-xml`. Only types whose token is still the subtype survive the round trip,
 * which is why the map is short. An extension it does not recognise yields
 * undefined and the reference is reported, not guessed at.
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
  ".svg-xml": "image/svg+xml",
};

function extensionOf(path: string): string {
  const at = path.lastIndexOf(".");
  return at < 0 ? "" : path.slice(at).toLowerCase();
}

/**
 * What the bytes at `path` are declared to be, or undefined if that cannot be
 * established.
 *
 * The manifest's `mime` wins whenever it is present and is an image type. A
 * manifest arrives through an unvalidated `JSON.parse` cast, so a `mime` that is
 * absent, not a string, or not an image type counts as no declaration at all
 * rather than as one to trust - the same allowlist `isSafeImageSrc` enforces at the
 * far end of the pipeline.
 */
function mimeFor(pkg: Package, path: string): string | undefined {
  const declared = pkg?.manifest?.assets?.find((a) => a?.file === path)?.mime;
  if (typeof declared === "string" && declared.startsWith("image/")) return declared;
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
 * Two things are reported rather than papered over, and both are left in place for
 * the same reason. `lib/render`'s `isSafeImageSrc` rejects the `pkg://` scheme, so
 * an unresolved object renders as an empty slot and records a refusal naming the
 * file - a diagnosable failure, where a substituted value is a wrong answer that
 * renders broken and says nothing:
 *
 * - a reference naming a member the package does not carry, and
 * - a reference whose type cannot be established. A guessed `image/png` around
 *   bytes that are not a PNG still satisfies `isSafeImageSrc`, so it would reach
 *   the page as a silently broken image.
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
