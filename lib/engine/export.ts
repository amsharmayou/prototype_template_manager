/**
 * The browser print pipeline: fonts from the font set, one render, one
 * display list, one PDF.
 *
 * A host's contract is small: give a template (and, for a filled document,
 * values and computed rules), get back print-ready bytes. Everything inside
 * is the same pure engine the tests drive in Node, which is what makes the
 * PDF here the same PDF anywhere.
 */

import { FontBook } from "@/lib/engine/fonts";
import { buildDisplayPages } from "@/lib/engine/list";
import { writePdf } from "@/lib/engine/pdf";
import { renderDocument } from "@/lib/render/document";
import type { ComputedSpec } from "@/lib/package/format";
import type { ContentMeasurement } from "@/lib/render/measure";
import type { BillTemplate } from "@/lib/template/types";
import { displayMapFor } from "@/lib/template/dataBinding";

/**
 * Fetch the font set once. The engine refuses at write time if a face a
 * document needs is absent from the response, so a truncated fetch fails the
 * print instead of shrinking the output.
 */
export async function loadFontBook(): Promise<FontBook> {
  const { SYNCFONTS } = await import("@/lib/engine/fontFiles");
  const sources: Array<[string, Uint8Array]> = [];
  for (const file of SYNCFONTS) {
    const response = await fetch(file);
    if (!response.ok) continue;
    sources.push([file, new Uint8Array(await response.arrayBuffer())]);
  }
  const { book } = FontBook.load(sources);
  // The shaper is optional by contract: a runtime that cannot load it keeps
  // printing Latin documents and refuses complex-script runs with a named
  // message rather than substituting.
  await book.attachShaper();
  return book;
}

export interface EngineRenderInput {
  template: BillTemplate;
  values?: Readonly<Record<string, string>>;
  computed?: readonly ComputedSpec[];
  currencyScale?: number;
  rounding?: "halfAwayFromZero" | "halfEven";
  qtyScale?: number;
  measurements?: Record<string, ContentMeasurement>;
  title?: string;
}

/**
 * Render, lay out and write the PDF; returns bytes and the writer's refusals
 * (empty when the print is clean).
 */
export async function renderToPdf(
  input: EngineRenderInput,
  book: FontBook,
  loadImage?: Parameters<typeof writePdf>[1]["loadImage"],
): Promise<{ bytes: Uint8Array; refusals: string[]; warnings: string[] }> {
  const { template } = input;
  const values = input.values ?? {};
  const computed = input.computed ?? [];
  const rendered = renderDocument(template, values, {
    computed,
    ...(input.currencyScale !== undefined ? { currencyScale: input.currencyScale } : {}),
    ...(input.rounding !== undefined ? { rounding: input.rounding } : {}),
    ...(input.qtyScale !== undefined ? { qtyScale: input.qtyScale } : {}),
    ...(input.measurements !== undefined ? { measurements: input.measurements } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    display: displayMapFor(template),
  });
  const lists = buildDisplayPages(rendered.pages, rendered.warnings, { book });
  const { bytes, refusals } = await writePdf(lists, {
    book,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(loadImage ? { loadImage } : {}),
  });
  return { bytes, refusals, warnings: lists[0]?.warnings ?? [] };
}
