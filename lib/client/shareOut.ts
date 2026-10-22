import { downloadText, safeFilename } from "@/lib/export/download";
import { buildShareDocument } from "@/lib/share/document";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Fetch the built share kit and download one offline HTML file carrying both
 * the kit and the template. Throws when the kit is missing; the caller turns
 * that into a toast that says how to build it.
 */
export async function shareTemplateAsHtml(
  name: string,
  template: BillTemplate,
): Promise<void> {
  const response = await fetch("/sharekit.js");
  if (!response.ok) {
    throw new Error(`the share kit is unavailable (${response.status})`);
  }
  const kit = await response.text();
  downloadText(
    buildShareDocument(template, kit),
    `${safeFilename(name || "template")}.html`,
    "text/html;charset=utf-8",
  );
}
