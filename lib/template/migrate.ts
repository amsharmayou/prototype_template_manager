import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type PlaceholderSpec,
  type TemplateObject,
} from "@/lib/template/types";

/**
 * Bring an untrusted template of any supported version up to this build's
 * version.
 *
 * This exists because there was no migration layer: the only version check in
 * the codebase was a throw inside `renderHtml`, and `EditorController.loadTemplate`
 * did not check the version at all, so a file from a newer build was accepted
 * and rendered with whatever fields this build happened to recognise.
 *
 * Every field read is defensive. All three template load sites cast
 * `JSON.parse` output straight to `BillTemplate`, so a truncated or hand-edited
 * file arrives with missing pieces.
 */
export function migrateTemplate(raw: unknown): { template: BillTemplate; notes: string[] } {
  const notes: string[] = [];
  const root =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const claimed = root.templateVersion;
  if (typeof claimed === "number" && claimed > TEMPLATE_VERSION) {
    throw new Error(`template version ${claimed} exceeds the supported ${TEMPLATE_VERSION}`);
  }
  notes.push(
    typeof claimed === "number"
      ? `template read as version ${claimed}, migrated to ${TEMPLATE_VERSION}`
      : `template carried no version, treated as version 1 and migrated to ${TEMPLATE_VERSION}`,
  );

  const doc =
    typeof root.document === "object" && root.document !== null
      ? (root.document as Record<string, unknown>)
      : {};
  const width = typeof doc.width === "number" && doc.width > 0 ? doc.width : A4_WIDTH;
  const height = typeof doc.height === "number" && doc.height > 0 ? doc.height : A4_HEIGHT;
  if (width !== doc.width || height !== doc.height) {
    notes.push(`document size filled in to ${width}x${height}`);
  }

  const meta =
    typeof root.meta === "object" && root.meta !== null
      ? (root.meta as Record<string, unknown>)
      : {};
  const name =
    typeof meta.name === "string" && meta.name.length > 0 ? meta.name : "Untitled bill";
  const modifiedAt = typeof meta.modifiedAt === "string" ? meta.modifiedAt : "";

  const objects: TemplateObject[] = Array.isArray(root.objects)
    ? (root.objects as TemplateObject[])
    : [];

  // The per-key placeholder contracts are carried through, not rebuilt from
  // name and date alone: `extractTemplateFields` and `fillTemplate` both read
  // `meta.placeholders`, so dropping it here would silently degrade every typed
  // slot back to a bare token. The key is left off entirely when it is not an
  // array, because absent and present-but-empty are distinct states here.
  const placeholders = Array.isArray(meta.placeholders)
    ? (meta.placeholders as PlaceholderSpec[])
    : undefined;

  return {
    template: {
      templateVersion: TEMPLATE_VERSION,
      document: { width, height },
      meta:
        placeholders === undefined
          ? { name, modifiedAt }
          : { name, modifiedAt, placeholders },
      objects,
    },
    notes,
  };
}