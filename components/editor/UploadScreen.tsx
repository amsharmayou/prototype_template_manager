"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import type { BillTemplate } from "@/lib/template/types";

/**
 * First screen: pick a bill image from the local machine. Nothing is
 * uploaded; the file is read in the browser via FileReader.
 */
export default function UploadScreen({
  onImage,
  onTemplate,
}: {
  onImage: (dataUrl: string, name: string) => void;
  onTemplate: (t: BillTemplate) => void;
}) {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const readImage = useCallback(
    (file: File) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        window.alert("Please choose a PNG, JPG or WebP image.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onImage(reader.result, file.name);
        }
      };
      reader.readAsDataURL(file);
    },
    [onImage],
  );

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-6 transition-colors ${
        dragging ? "bg-blue-50" : "bg-neutral-100"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) readImage(file);
      }}
    >
      <div className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">
          Bill Template Maker
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
          Load a bill image, then manually trace its structure. The image is
          kept as a faint, locked reference layer and is never part of the
          exported template.
        </p>

        <div className="mt-8 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10">
          <p className="text-base font-medium text-neutral-700">
            Upload Bill Image
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            PNG / JPG / JPEG / WebP — processed entirely in your browser
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button variant="primary" onClick={() => imageInput.current?.click()}>
              Choose File
            </Button>
          </div>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) readImage(file);
          }}
        />
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              onTemplate(JSON.parse(await file.text()) as BillTemplate);
            } catch {
              window.alert("That file is not a valid bill template JSON.");
            }
          }}
        />

        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={() => jsonInput.current?.click()}>
            Open saved template instead
          </Button>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-neutral-400">
          Nothing is uploaded to a server. No OCR or automatic interpretation is
          performed — you decide what every line, box and text field means.
        </p>
      </div>
    </div>
  );
}
