"use client";

import { jsPDF } from "jspdf";

import { downloadBlob, safeFilename } from "./download";
import { templateToSvgString } from "./renderTemplate";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Export a single page PDF sized to the document, not the browser viewport.
 *
 * The page is created in `px` units so 1 document unit maps to 1 PDF unit and
 * the traced geometry keeps its coordinates. Content comes from the template
 * SVG, so the reference image is never included.
 *
 * `page` is the size the document was actually *drawn* at, which is not always
 * the size it was traced at: a variable-layout bill grows to fit its content,
 * and taking the height from `template.document` would put a grown receipt on
 * a sheet sized for the short one.
 */
export async function exportPdf(
  template: BillTemplate,
  page?: { width: number; height: number },
): Promise<void> {
  const width = page && page.width > 0 ? page.width : template.document.width;
  const height = page && page.height > 0 ? page.height : template.document.height;
  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
  });

  const svg = await templateToSvgString(template);

  try {
    // jsPDF renders the SVG through canvg at a resolution derived from the
    // page size, which keeps strokes and text crisp at print scale.
    pdf.addSvgAsImage(svg, 0, 0, width, height, "bill-template", true);
  } catch {
    // Fallback: a 3x raster of the template only. The reference image is
    // still absent, because the raster is rendered from the template.
    const { renderTemplate } = await import("./renderTemplate");
    const sc = await renderTemplate(template, 3);
    try {
      const dataUrl = sc.toDataURL({ format: "png", multiplier: 1 });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
    } finally {
      sc.dispose();
    }
  }

  downloadBlob(
    pdf.output("blob"),
    `${safeFilename(template.meta.name)}.pdf`,
  );
}
