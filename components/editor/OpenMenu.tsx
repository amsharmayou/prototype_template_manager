"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { listTemplates, loadTemplate } from "@/lib/client/templateStore";
import type { BillTemplate } from "@/lib/template/types";

/**
 * "Open…" is one button doing two jobs: the templates saved on this device
 * (the same library the fill & print page lists), or any .json from disk.
 */
export default function OpenMenu({
  onOpenFile,
  onPickSaved,
}: {
  onOpenFile: () => void;
  onPickSaved: (t: BillTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const saved = open ? listTemplates().slice(0, 5) : [];

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

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        title="Open a template saved on this device, or a .json file"
      >
        Open…
      </Button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-rule bg-paper shadow-lg">
          <p className="border-b border-rule px-3 py-2 text-[12px] font-medium text-ink-soft">
            Saved on this device
          </p>
          {saved.length === 0 ? (
            <p className="px-3 py-2 text-[12px] leading-relaxed text-ink-faint">
              Nothing saved yet — Save puts a copy here.
            </p>
          ) : (
            saved.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setOpen(false);
                  const loaded = loadTemplate(t.name);
                  if (loaded) onPickSaved(loaded);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-desk"
              >
                <span className="text-[13px] font-medium text-ink">{t.name}</span>
                <span className="text-[12px] text-ink-faint">
                  {new Date(t.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenFile();
            }}
            className="w-full border-t border-rule px-3 py-2 text-left text-[13px] font-medium text-ink hover:bg-desk"
          >
            Open a file…
          </button>
        </div>
      ) : null}
    </div>
  );
}
