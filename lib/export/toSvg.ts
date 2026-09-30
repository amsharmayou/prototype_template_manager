"use client";

import { downloadJson, downloadText, safeFilename } from "./download";
import { renderTemplate, templateToSvgString } from "./renderTemplate";
import type { BillTemplate } from "@/lib/template/types";

/** Download the application-level template JSON. */
export function exportJson(template: BillTemplate): void {
  downloadJson(template, `${safeFilename(template.meta.name)}.json`);
}

/** Download the reconstructed structure as SVG. Reference-free. */
export async function exportSvg(template: BillTemplate): Promise<void> {
  const svg = await templateToSvgString(template, {
    includeXmlDeclaration: true,
  });
  downloadText(
    svg,
    `${safeFilename(template.meta.name)}.svg`,
    "image/svg+xml;charset=utf-8",
  );
}

/** Download a high resolution PNG preview. Reference-free. */
export async function exportPng(
  template: BillTemplate,
  multiplier = 2,
): Promise<void> {
  const canvas = await renderTemplate(template, multiplier);
  try {
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${safeFilename(template.meta.name)}.png`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    canvas.dispose();
  }
}
