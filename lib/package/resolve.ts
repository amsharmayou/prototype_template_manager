import type { Package } from "@/lib/package/format";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";
import { TEMPLATE_VERSION } from "@/lib/template/types";

import { strFromU8 } from "fflate";

const SCHEME = "pkg://";

function toDataUri(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${typeof btoa === "function" ? btoa(binary) : ""}`;
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
 * An unresolved reference is left in place rather than dropped.
 * `lib/render`'s `isSafeImageSrc` rejects the `pkg://` scheme, so the object
 * renders as an empty slot and records a refusal naming the file - a diagnosable
 * failure, where a dropped src is a part that silently disappears.
 */
export function resolvePackage(pkg: Package): { template: BillTemplate; unresolved: string[] } {
  const unresolved: string[] = [];
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

  const mimeFor = (path: string): string =>
    path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";

  const objects: TemplateObject[] = (Array.isArray(template.objects) ? template.objects : []).map(
    (o) => {
      const src = (o as { src?: unknown }).src;
      if (typeof src !== "string" || !src.startsWith(SCHEME)) return { ...o };
      const path = src.slice(SCHEME.length);
      const bytes = files.get(path);
      if (!bytes) {
        if (!unresolved.includes(path)) unresolved.push(path);
        return { ...o };
      }
      return { ...o, src: toDataUri(bytes, mimeFor(path)) } as TemplateObject;
    },
  );

  return { template: { ...template, objects }, unresolved };
}
