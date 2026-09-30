"use client";

import { useRef } from "react";

import ExportMenu from "./ExportMenu";
import { Button } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { exportJson } from "@/lib/export/toSvg";
import type { BillTemplate } from "@/lib/template/types";

export default function TopBar({
  controller,
  state,
  onOpenImage,
  onLoadTemplate,
  onTogglePreview,
  preview,
}: {
  controller: EditorController;
  state: EditorState;
  onOpenImage: () => void;
  onLoadTemplate: (t: BillTemplate) => void;
  onTogglePreview: () => void;
  preview: boolean;
}) {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const jsonInput = useRef<HTMLInputElement | null>(null);

  return (
    <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      <h1 className="mr-2 text-sm font-semibold text-neutral-800">
        Bill Template Maker
      </h1>

      <Button onClick={onOpenImage}>Open Bill</Button>
      <Button onClick={() => exportJson(controller.getTemplate())}>
        Save Template
      </Button>
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={() => undefined}
        id="btm-image-input"
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
            const text = await file.text();
            onLoadTemplate(JSON.parse(text) as BillTemplate);
          } catch {
            window.alert("That file is not a valid bill template JSON.");
          }
        }}
      />
      <Button onClick={() => jsonInput.current?.click()}>Load Template</Button>

      <span className="mx-1 h-5 w-px bg-neutral-200" />

      <Button
        onClick={() => controller.undo()}
        disabled={!state.canUndo}
        title="Undo (Ctrl/Cmd+Z)"
      >
        ↶ Undo
      </Button>
      <Button
        onClick={() => controller.redo()}
        disabled={!state.canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
      >
        ↷ Redo
      </Button>

      <div className="flex-1" />

      <Button
        onClick={onTogglePreview}
        variant={preview ? "primary" : "default"}
        title="Preview the reconstructed template without the reference"
      >
        {preview ? "Back to Editor" : "Preview"}
      </Button>
      <ExportMenu controller={controller} />
    </header>
  );
}
