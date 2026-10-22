"use client";

import { useRef } from "react";

import { Redo2, Undo2 } from "lucide-react";

import CopyMenu from "./ExportMenu";
import OpenMenu from "./OpenMenu";
import { Button, IconButton, TextInput } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { BillTemplate } from "@/lib/template/types";
import { readTemplateFile } from "@/lib/client/readTemplateFile";

export default function TopBar({
  controller,
  state,
  onOpenImage,
  onLoadTemplate,
  onTogglePreview,
  onSave,
  onFillAndPrint,
  onShare,
  preview,
}: {
  controller: EditorController;
  state: EditorState;
  onOpenImage: () => void;
  onLoadTemplate: (t: BillTemplate) => void;
  onTogglePreview: () => void;
  onSave: () => void;
  onFillAndPrint: () => void;
  onShare: () => void;
  preview: boolean;
}) {
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  return (
    <header className="flex items-center gap-2 border-b border-rule bg-paper px-3 pt-1.5 pb-[5px]">
      <h1 className="mr-1 shrink-0 font-display text-[13px] font-semibold text-ink">
        Bill Template Maker
      </h1>
      <label className="sr-only" htmlFor="btm-doc-name">
        Bill name
      </label>
      <div className="w-44 shrink-0">
        <TextInput
          id="btm-doc-name"
          value={state.documentName}
          placeholder="Untitled bill"
          onChange={(e) => controller.setDocumentName(e.target.value)}
          className="h-8"
        />
      </div>

      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />
      <IconButton
        label="Undo"
        onClick={() => controller.undo()}
        disabled={!state.canUndo}
      >
        <Undo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Redo"
        onClick={() => controller.redo()}
        disabled={!state.canRedo}
      >
        <Redo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />

      <Button onClick={onOpenImage} title="Choose a photo of your bill">
        Add bill photo
      </Button>
      <OpenMenu
        onOpenFile={() => jsonInput.current?.click()}
        onPickSaved={onLoadTemplate}
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
            onLoadTemplate(await readTemplateFile(file));
          } catch (error) {
            toast({
              kind: "error",
              title: "That file isn't a bill template",
              detail: error instanceof Error ? error.message : "Choose a supported .json template file.",
            });
          }
        }}
      />

      <div className="flex-1" />

      <Button
        onClick={onTogglePreview}
        variant={preview ? "primary" : "default"}
        title="Preview the reconstructed template without the reference"
      >
        {preview ? "Back to Editor" : "Preview"}
      </Button>
      <Button onClick={onSave} title="Keep a copy on this device">
        Save
      </Button>
      <Button variant="primary" onClick={onFillAndPrint}>
        Fill &amp; print
      </Button>
      <Button
        onClick={onShare}
        title="Download one offline HTML file that fills, previews and prints this template"
      >
        Share
      </Button>
      <CopyMenu controller={controller} />
    </header>
  );
}
