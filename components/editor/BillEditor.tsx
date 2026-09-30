"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import CanvasStage from "./CanvasStage";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";
import ReferencePanel from "./ReferencePanel";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";
import UploadScreen from "./UploadScreen";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  NumberInput,
  Panel,
} from "@/components/ui/Controls";
import {
  useEditorController,
  useKeyboardShortcuts,
} from "@/hooks/useEditorController";
import { emptyTemplate, type BillTemplate } from "@/lib/template/types";
import { exportJson } from "@/lib/export/toSvg";

type Stage = "upload" | "editor";

export default function BillEditor() {
  const { controller, state } = useEditorController();
  const [stage, setStage] = useState<Stage>("upload");
  const [preview, setPreview] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);

  const handleImage = useCallback(
    (dataUrl: string, name: string) => {
      setStage("editor");
      setPreview(false);
      void controller
        .whenReady()
        .then(() => controller.addReference(dataUrl))
        .then(() => {
          controller.setDocumentName(name.replace(/\.[^.]+$/, ""));
          controller.setGridVisible(true);
          controller.setGridSize(10);
        })
        .catch((e: unknown) => {
          window.alert(
            `Could not load that image: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    },
    [controller],
  );

  const handleTemplate = useCallback(
    (t: BillTemplate) => {
      setStage("editor");
      setPreview(false);
      void controller.whenReady().then(() => {
        controller.loadTemplate(t);
        const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
        controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
      });
    },
    [controller],
  );

  useKeyboardShortcuts(controller, {
    save: () => exportJson(controller.getTemplate()),
  });

  // Entering preview hides the reference image; leaving restores whatever the
  // user had chosen before. Declared before the early return so hook order is
  // stable across the upload and editor stages.
  const prePreviewRef = useRef<boolean | null>(null);
  const referenceVisible = state.referenceVisible;
  useEffect(() => {
    if (preview) {
      if (prePreviewRef.current === null) {
        prePreviewRef.current = referenceVisible;
      }
      if (referenceVisible) controller.setReferenceVisible(false);
      return;
    }
    const saved = prePreviewRef.current;
    if (saved !== null) {
      prePreviewRef.current = null;
      controller.setReferenceVisible(saved);
    }
  }, [controller, preview, referenceVisible]);

  const pending = state.pendingTable;
  const [gridOpen, setGridOpen] = useState(false);

  if (stage === "upload") {
    return <UploadScreen onImage={handleImage} onTemplate={handleTemplate} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        controller={controller}
        state={state}
        preview={preview}
        onOpenImage={() => imageInput.current?.click()}
        onLoadTemplate={handleTemplate}
        onTogglePreview={() => setPreview((v) => !v)}
      />

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              void controller.addReference(reader.result);
            }
          };
          reader.readAsDataURL(file);
        }}
      />

      {preview ? (
        <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] text-neutral-500">
          Preview — reference image and editor controls are hidden. This is
          what the exports contain.
        </div>
      ) : (
        <ToolRail controller={controller} activeTool={state.tool} />
      )}

      <div className="flex min-h-0 flex-1">
        {preview ? null : (
          <aside className="editor-scroll w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white">
            <ReferencePanel controller={controller} state={state} />
            <Panel title="Grid">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-500">
                  {state.gridVisible
                    ? `Visible · ${state.gridSize} px`
                    : "Hidden"}
                  {state.snapToGrid ? " · snap on" : ""}
                </span>
                <Button onClick={() => setGridOpen(true)}>Grid Settings…</Button>
              </div>
            </Panel>
            <Panel title="Document">
              <Button
                variant="default"
                className="w-full"
                onClick={() => {
                  controller.loadTemplate(emptyTemplate());
                }}
              >
                New blank document
              </Button>
              <p className="text-[10px] text-neutral-400">
                {state.document.width} × {state.document.height} px
              </p>
            </Panel>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            <CanvasStage
              controller={controller}
              gridVisible={!preview && state.gridVisible}
              gridSize={state.gridSize}
              zoom={state.zoom}
              documentSize={state.document}
              editingCell={preview ? null : state.editingCell}
            />

            {pending ? (
              <TablePrompt
                onConfirm={(rows, cols) => {
                  controller.confirmTable(rows, cols);
                }}
                onCancel={() => {
                  controller.cancelPendingTable();
                }}
              />
            ) : null}
          </div>

          {preview ? null : <StatusBar controller={controller} state={state} />}
        </div>

        {preview ? null : (
          <aside className="flex w-64 shrink-0 flex-col border-l border-neutral-200 bg-white">
            <div className="editor-scroll min-h-0 flex-1 overflow-y-auto">
              <PropertiesPanel controller={controller} state={state} />
            </div>
            <div className="h-56 shrink-0 border-t border-neutral-200">
              <LayersPanel
                controller={controller}
                state={state}
                onSelect={(id) => {
                  const obj = controller.getObjectById(id);
                  if (obj) {
                    controller.getCanvas()?.setActiveObject(obj);
                    controller.getCanvas()?.requestRenderAll();
                  }
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {gridOpen ? (
        <GridSettingsDialog
          controller={controller}
          state={state}
          onClose={() => setGridOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TablePrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (rows: number, cols: number) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Dialog
      open
      title="Create table"
      description="Choose the grid size for the area you just drew. You can change this later."
      onClose={onCancel}
      width="w-80"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(rows, cols)}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rows">
          <NumberInput value={rows} min={1} max={60} onChange={setRows} />
        </Field>
        <Field label="Columns">
          <NumberInput value={cols} min={1} max={30} onChange={setCols} />
        </Field>
      </div>
    </Dialog>
  );
}

function GridSettingsDialog({
  controller,
  state,
  onClose,
}: {
  controller: ReturnType<typeof useEditorController>["controller"];
  state: ReturnType<typeof useEditorController>["state"];
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      title="Grid"
      description="A guide grid for tracing accurately. Snap locks objects to it."
      onClose={onClose}
      width="w-72"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <Field label="Grid size (px)">
        <NumberInput
          value={state.gridSize}
          min={2}
          max={500}
          onChange={(v) => controller.setGridSize(Math.round(v))}
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox
          label="Show grid"
          checked={state.gridVisible}
          onChange={(v) => controller.setGridVisible(v)}
        />
        <Checkbox
          label="Snap to grid"
          checked={state.snapToGrid}
          onChange={(v) => controller.setSnapEnabled(v)}
        />
      </div>
      <p className="text-[10px] text-neutral-400">
        Snap rounds the top-left corner of an object to the nearest grid line
        while it is dragged.
      </p>
    </Dialog>
  );
}

function StatusBar({
  controller,
  state,
}: {
  controller: ReturnType<typeof useEditorController>["controller"];
  state: ReturnType<typeof useEditorController>["state"];
}) {
  return (
    <div className="flex items-center gap-3 border-t border-neutral-200 bg-white px-3 py-1.5 text-[11px] text-neutral-500">
      <span className="tabular-nums">
        Zoom: <span className="font-medium text-neutral-700">{Math.round(state.zoom * 100)}%</span>
      </span>
      <span className="tabular-nums">
        Document:{" "}
        <span className="font-medium text-neutral-700">
          {state.document.width} × {state.document.height}
        </span>
      </span>
      <span className="tabular-nums">
        Objects:{" "}
        <span className="font-medium text-neutral-700">{state.objectCount}</span>
      </span>
      <span className="tabular-nums">
        Selected:{" "}
        <span className="font-medium text-neutral-700">{state.selection.length}</span>
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <Button onClick={() => controller.zoomOut()} title="Zoom out">
          −
        </Button>
        <Button onClick={() => controller.resetZoom()} title="Reset zoom to 100%">
          100%
        </Button>
        <Button onClick={() => controller.zoomIn()} title="Zoom in">
          +
        </Button>
        <Button
          onClick={() => controller.fit()}
          title="Fit the whole document in the pane"
        >
          Fit
        </Button>
      </div>
      <span className="text-neutral-400">
        Scroll to move · Ctrl+scroll to zoom · Space+drag to pan
      </span>
    </div>
  );
}

