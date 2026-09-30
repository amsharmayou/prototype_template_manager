"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { downloadJson } from "@/lib/export/download";
import { exportDocx } from "@/lib/export/toDocx";
import { exportPdf } from "@/lib/export/toPdf";
import { exportJson, exportPng, exportSvg } from "@/lib/export/toSvg";
import type { EditorController } from "@/lib/canvas/EditorController";

type ExportItem = "json" | "svg" | "pdf" | "docx" | "png";

const ITEMS: Array<{ id: ExportItem; label: string; hint: string }> = [
  { id: "json", label: "JSON Template", hint: "Reusable template format" },
  { id: "svg", label: "SVG", hint: "Vector structure" },
  { id: "pdf", label: "PDF", hint: "Document sized page" },
  { id: "docx", label: "DOCX", hint: "Native Word tables & text" },
  { id: "png", label: "Preview PNG", hint: "2x raster" },
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
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = async (item: ExportItem) => {
    setBusy(item);
    setError(null);
    try {
      const template = controller.getTemplate();
      if (item === "json") exportJson(template);
      if (item === "svg") await exportSvg(template);
      if (item === "pdf") await exportPdf(template);
      if (item === "docx") await exportDocx(template);
      if (item === "png") await exportPng(template, 2);
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
        variant="primary"
        onClick={() => setOpen((v) => !v)}
        title="Export the reconstructed template"
      >
        Export ▾
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(item.id)}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
            >
              <span className="text-xs font-medium text-neutral-800">
                {busy === item.id ? "Exporting…" : item.label}
              </span>
              <span className="text-[10px] text-neutral-400">{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <span className="absolute right-0 top-full mt-1 z-30 w-60 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export { downloadJson };
