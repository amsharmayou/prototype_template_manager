"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { downloadBlob, downloadText, safeFilename } from "@/lib/export/download";
import { exportDocx } from "@/lib/export/toDocx";
import { exportPackage } from "@/lib/export/toPackage";
import { exportJson, exportPng, exportSvg } from "@/lib/export/toSvg";
import { renderHtml } from "@/lib/render";
import { loadFontBook, renderToPdf } from "@/lib/engine/export";
import type { EditorController } from "@/lib/canvas/EditorController";

type ExportItem = "json" | "svg" | "pdf" | "docx" | "png" | "html" | "btpkg";

/**
 * Outcome first, format second: the person picking here is deciding what they
 * want to *do* with the bill, not which file extension they need.
 */
const ITEMS: Array<{ id: ExportItem; outcome: string; format: string }> = [
  { id: "pdf", outcome: "Print it", format: "PDF document" },
  { id: "png", outcome: "A picture", format: "PNG image" },
  { id: "docx", outcome: "Open in Word", format: "DOCX file" },
  { id: "svg", outcome: "Edit elsewhere", format: "SVG drawing" },
  { id: "json", outcome: "Template for an app", format: "JSON template" },
  { id: "btpkg", outcome: "Template for an app", format: "Bill package (.btpkg)" },
  { id: "html", outcome: "A web page", format: "HTML document" },
];

export default function ExportMenu({ controller }: { controller: EditorController }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (item: ExportItem) => {
    setBusy(item);
    setError(null);
    try {
      const template = controller.getTemplate();
      if (item === "btpkg") exportPackage(template);
      if (item === "json") exportJson(template);
      if (item === "svg") await exportSvg(template);
      if (item === "pdf") {
        // Print output is the engine's vector PDF: same font book, same
        // display list, same bytes a filled render would deliver.
        const book = await loadFontBook();
        const { bytes, refusals } = await renderToPdf(
          { template, title: template.meta?.name || "Document" },
          book,
        );
        if (refusals.length) {
          throw new Error(
            `${refusals[0]}${refusals.length > 1 ? ` (+${refusals.length - 1} more)` : ""}`,
          );
        }
        downloadBlob(
          new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
          `${safeFilename(String(template.meta?.name ?? ""))}.pdf`,
        );
      }
      if (item === "docx") await exportDocx(template);
      if (item === "png") await exportPng(template, 2);
      if (item === "html") {
        const result = renderHtml(template);
        downloadText(
          result.html,
          `${safeFilename(String(template.meta?.name ?? ""))}.html`,
          "text/html;charset=utf-8",
        );
      }
    } catch (e) {
      // Surface the full stack in development; the UI only shows the message.
      if (process.env.NODE_ENV !== "production") {
        console.error(`[bill-template-maker] ${item} export failed`, e);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        title="Download a copy of this bill"
      >
        Get a copy ▾
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-rule bg-paper shadow-lg">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(item.id)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-desk disabled:opacity-50"
            >
              <span className="text-[13px] font-medium text-ink">
                {busy === item.id ? "Working…" : item.outcome}
              </span>
              <span className="text-[12px] text-ink-faint">{item.format}</span>
              {item.id === "btpkg" ? (
                <span className="text-[11px] text-stamp">v2: hash-verified bundle; long bills paginate across A4 sheets</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          data-export-error
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-stamp bg-stamp-wash px-3 py-2 text-[12px] text-stamp"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
