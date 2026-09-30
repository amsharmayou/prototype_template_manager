"use client";

import { StaticCanvas } from "fabric";

import { hydrateTemplate } from "@/lib/template/hydrate";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Render a template into a throwaway, document-sized canvas.
 *
 * Every exporter goes through this function. Because it builds a brand new
 * canvas from the template alone, the reference image cannot leak into an
 * export even by accident.
 */
export async function renderTemplate(
  template: BillTemplate,
  scale = 1,
): Promise<StaticCanvas> {
  const el = document.createElement("canvas");
  const canvas = new StaticCanvas(el, {
    width: Math.max(1, Math.round(template.document.width * scale)),
    height: Math.max(1, Math.round(template.document.height * scale)),
    backgroundColor: "#ffffff",
    enableRetinaScaling: false,
  });

  const objects = hydrateTemplate(template);
  for (const o of objects) {
    if (scale !== 1) {
      o.set({
        left: (o.left ?? 0) * scale,
        top: (o.top ?? 0) * scale,
        width: (o.width ?? 0) * scale,
        height: (o.height ?? 0) * scale,
      } as never);
    }
    canvas.add(o);
  }
  canvas.renderAll();
  return canvas;
}

/** Serialise the template to an SVG string sized to the document. */
export async function templateToSvgString(
  template: BillTemplate,
  options: { includeXmlDeclaration?: boolean } = {},
): Promise<string> {
  const canvas = await renderTemplate(template, 1);
  try {
    return canvas.toSVG({
      suppressPreamble: options.includeXmlDeclaration !== true,
      viewBox: {
        x: 0,
        y: 0,
        width: template.document.width,
        height: template.document.height,
      },
      width: String(template.document.width),
      height: String(template.document.height),
    });
  } finally {
    canvas.dispose();
  }
}
