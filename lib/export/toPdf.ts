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
 */
export async function exportPdf(template: BillTemplate): Promise<void> {
  const { width, height } = template.document;
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
