"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import CanvasStage from "./CanvasStage";
import ContextPanel from "./ContextPanel";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";
import StageBar from "./StageBar";
import StepPath from "./StepPath";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";
import UploadScreen from "./UploadScreen";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  NumberInput,
  Select,
} from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import {
  useEditorController,
  useKeyboardShortcuts,
} from "@/hooks/useEditorController";
import { shareTemplateAsHtml } from "@/lib/client/shareOut";
import {
  firstIncomplete,
  stepDone,
  type StepFacts,
  type StepId,
} from "@/lib/client/steps";
import { saveTemplate, setPendingTemplate } from "@/lib/client/templateStore";
import { clearDraft, loadDraft, saveDraft, type EditorDraft } from "@/lib/client/draftStore";
import { billNameFromFile } from "@/lib/client/billNameFromFile";
import { readImageFile } from "@/lib/client/readImageFile";
import type { BillTemplate } from "@/lib/template/types";

type Stage = "upload" | "editor";

export default function BillEditor() {
  const { controller, state } = useEditorController();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [recoverableDraft, setRecoverableDraft] = useState<EditorDraft | null>(null);
  const draftArmed = useRef(false);
  const lastDraftJson = useRef("");
  const [preview, setPreview] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const persistRecoveryDraft = useCallback((name = state.documentName) => {
    try {
      const template = controller.getTemplate();
      const stableJson = JSON.stringify({ ...template, meta: { ...template.meta, modifiedAt: "" } });
      if (saveDraft(name, template)) lastDraftJson.current = stableJson;
    } catch {
      // Draft saving is best-effort. The explicit Save action reports errors.
    }
  }, [controller, state.documentName]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRecoverableDraft(loadDraft()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleImage = useCallback(
    (dataUrl: string, name: string) => {
      draftArmed.current = false;
      setStage("editor");
      setPreview(false);
      void controller
        .whenReady()
        .then(() => controller.addReference(dataUrl))
        .then(() => {
          const billName = billNameFromFile(name);
          controller.setDocumentName(billName);
          controller.setGridVisible(true);
          controller.setGridSize(10);
          draftArmed.current = true;
          persistRecoveryDraft(billName);
        })
        .catch((e: unknown) => {
          toast({
            kind: "error",
            title: "Could not load that picture",
            detail: e instanceof Error ? e.message : String(e),
          });
        });
    },
    [controller, persistRecoveryDraft, toast],
  );

  const handleTemplate = useCallback(
    (t: BillTemplate) => {
      draftArmed.current = false;
      setStage("editor");
      setPreview(false);
      void controller.whenReady().then(() => {
        controller.loadTemplate(t);
        draftArmed.current = true;
        const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
        controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
        persistRecoveryDraft(typeof t.meta?.name === "string" ? t.meta.name : "Untitled bill template");
      });
    },
    [controller, persistRecoveryDraft],
  );

  // The no-editor path: pick a template file, hand it straight to the
  // renderer, which derives its dynamic form from the placeholders inside.
  const handleTemplateForRender = useCallback(
    (t: BillTemplate) => {
      setPendingTemplate(t);
      router.push("/render");
    },
    [router],
  );

  const handleResumeDraft = useCallback(() => {
    if (!recoverableDraft) return;
    draftArmed.current = false;
    setStage("editor");
    setPreview(false);
    void controller.whenReady().then(() => {
      controller.loadTemplate(recoverableDraft.template);
      controller.setDocumentName(recoverableDraft.name);
      const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
      controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
      draftArmed.current = true;
      persistRecoveryDraft(recoverableDraft.name);
    });
  }, [controller, persistRecoveryDraft, recoverableDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setRecoverableDraft(null);
    lastDraftJson.current = "";
  }, []);

  // Debounce local recovery saves so a drag or a quick series of inspector edits
  // writes once. The tracing reference is intentionally absent from the model.
  useEffect(() => {
    if (stage !== "editor" || !state.ready || !draftArmed.current) return;
    const timer = window.setTimeout(() => {
      try {
        const template = controller.getTemplate();
        const stableJson = JSON.stringify({
          ...template,
          meta: { ...template.meta, modifiedAt: "" },
        });
        if (stableJson === lastDraftJson.current) return;
        if (saveDraft(state.documentName, template)) {
          lastDraftJson.current = stableJson;
        }
      } catch {
        // Draft saving is best-effort. The explicit Save action reports errors.
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [controller, stage, state, state.documentName, state.ready]);

  // The step guide is declared before the action callbacks so the "save" and
  // "fill & print" handlers can mark their facts directly.
  const [step, setStep] = useState<StepId>("bill");
  const [testedOnce, setTestedOnce] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const handleSave = useCallback(() => {
    const saved = saveTemplate(
      state.documentName || "Untitled bill template",
      controller.getTemplate(),
    );
    if (!saved) {
      toast({
        kind: "error",
        title: "Could not save on this device",
        detail: "Browser storage may be full or unavailable. Download a JSON or Bill Package copy instead.",
      });
      return;
    }
    setSavedOnce(true);
    toast({
      kind: "success",
      title: "Saved to this device",
      detail: "Open it again any time from the Fill & print page.",
    });
  }, [controller, state.documentName, toast]);

  const handleFillAndPrint = useCallback(() => {
    setTestedOnce(true);
    setPendingTemplate(controller.getTemplate());
    router.push("/render");
  }, [controller, router]);

  const handleShare = useCallback(() => {
    void shareTemplateAsHtml(
      state.documentName,
      controller.getTemplate(),
    ).catch((error: unknown) => {
      toast({
        kind: "error",
        title: "Could not build the shareable file",
        detail: `${error instanceof Error ? error.message : String(error)} — run npm run build:share and reload.`,
      });
    });
  }, [controller, state.documentName, toast]);

  useKeyboardShortcuts(controller, { save: handleSave });

  const facts: StepFacts = {
    hasReference: state.hasReference,
    objectCount: state.objectCount,
    dataFieldCount: state.dataFieldCount,
    testedOnce,
    savedOnce,
  };
  const done = stepDone(facts);

  const completedBefore = useRef(done[step]);
  const selectStep = useCallback(
    (next: StepId) => {
      // A click that selects an already-finished step must stick: remember the
      // step's own fact at selection time, so only a later flip can advance.
      completedBefore.current = done[next];
      setStep(next);
      // Step ③'s job is marking data; hand the owner the right tool for it.
      if (next === "mark") controller.setTool("field");
    },
    [controller, done],
  );

  // Auto-advance fires from the controller's own notifications — calling
  // setState inside the subscription callback, never synchronously in the
  // effect body — and only when the *current* step's own fact flips from
  // false to true.
  useEffect(() => {
    return controller.subscribe(() => {
      const snap = controller.getSnapshot();
      const nextDone = stepDone({
        hasReference: snap.hasReference,
        objectCount: snap.objectCount,
        dataFieldCount: snap.dataFieldCount,
        testedOnce,
        savedOnce,
      });
      const was = completedBefore.current;
      // Step ③ is where a field is configured, so finishing a field there must
      // not walk the author away mid-edit. The Next step button is the way on.
      if (!was && nextDone[step] && step !== "mark") {
        const next = firstIncomplete(nextDone);
        if (next && next !== step) {
          completedBefore.current = nextDone[next];
          setStep(next);
          return;
        }
      }
      completedBefore.current = nextDone[step];
    });
  }, [controller, step, testedOnce, savedOnce]);

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
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);

  if (stage === "upload") {
    return (
      <UploadScreen
        onImage={handleImage}
        onTemplate={handleTemplate}
        onTemplateForRender={handleTemplateForRender}
        draft={recoverableDraft}
        onResumeDraft={handleResumeDraft}
        onDiscardDraft={handleDiscardDraft}
      />
    );
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
        onSave={handleSave}
        onFillAndPrint={handleFillAndPrint}
        onShare={handleShare}
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
          void readImageFile(file)
            .then((dataUrl) => handleImage(dataUrl, file.name))
            .catch((error: unknown) => {
              toast({
                kind: "error",
                title: "Could not open that picture",
                detail: error instanceof Error ? error.message : String(error),
              });
            });
        }}
      />

      {preview ? (
        <div className="border-b border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft">
          Preview — reference image and editor controls are hidden. This is
          what the exports contain.
        </div>
      ) : (
        <StepPath done={done} current={step} onSelect={selectStep} />
      )}

      <div className="flex min-h-0 flex-1">
        {preview ? null : (
          <ToolRail controller={controller} activeTool={state.tool} />
        )}

        {preview ? null : (
          <aside className="editor-scroll w-[280px] shrink-0 overflow-y-auto border-r border-rule bg-paper">
            <ContextPanel
              step={step}
              controller={controller}
              state={state}
              onOpenGridSettings={() => setGridOpen(true)}
              onOpenPageSettings={() => setPageSettingsOpen(true)}
              onFillAndPrint={handleFillAndPrint}
              onSave={handleSave}
              onShare={handleShare}
            />
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

          {preview ? null : <StageBar controller={controller} state={state} />}
        </div>

        {preview ? null : (
          <aside className="flex w-80 shrink-0 flex-col border-l border-rule bg-paper">
            <div className="editor-scroll min-h-0 flex-1 overflow-y-auto">
              <PropertiesPanel controller={controller} state={state} />
            </div>
            <div className="h-56 shrink-0 border-t border-rule">
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
      {pageSettingsOpen ? (
        <PageSettingsDialog
          document={state.document}
          onApply={(width, height) => {
            controller.setDocument(width, height);
            setPageSettingsOpen(false);
          }}
          onClose={() => setPageSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

const PAGE_PRESETS = [
  { value: "custom", label: "Custom size" },
  { value: "a4", label: "A4 · 210 × 297 mm" },
  { value: "letter", label: "US Letter · 8.5 × 11 in" },
  { value: "receipt58", label: "Receipt · 58 mm wide" },
  { value: "receipt80", label: "Receipt · 80 mm wide" },
] as const;
type PagePreset = (typeof PAGE_PRESETS)[number]["value"];
type PageUnit = "mm" | "in" | "px";
const PX_PER_INCH = 96;
const pxToUnit = (px: number, unit: PageUnit) =>
  unit === "mm" ? (px * 25.4) / PX_PER_INCH : unit === "in" ? px / PX_PER_INCH : px;
const unitToPx = (value: number, unit: PageUnit) =>
  unit === "mm" ? (value * PX_PER_INCH) / 25.4 : unit === "in" ? value * PX_PER_INCH : value;

function PageSettingsDialog({
  document,
  onApply,
  onClose,
}: {
  document: { width: number; height: number };
  onApply: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const [widthPx, setWidthPx] = useState(document.width);
  const [heightPx, setHeightPx] = useState(document.height);
  const [unit, setUnit] = useState<PageUnit>("mm");
  const [preset, setPreset] = useState<PagePreset>("custom");
  const setPresetSize = (next: PagePreset) => {
    setPreset(next);
    const sizes: Partial<Record<PagePreset, [number, number]>> = {
      a4: [794, 1123],
      letter: [816, 1056],
      receipt58: [219, 1200],
      receipt80: [302, 1600],
    };
    const size = sizes[next];
    if (size) {
      setWidthPx(size[0]);
      setHeightPx(size[1]);
    }
  };
  const width = pxToUnit(widthPx, unit);
  const height = pxToUnit(heightPx, unit);
  const valid =
    Number.isFinite(widthPx) && Number.isFinite(heightPx) &&
    widthPx >= 100 && heightPx >= 100 && widthPx <= 20000 && heightPx <= 20000;

  return (
    <Dialog
      open
      title="Page size & layout"
      description="Dimensions use 96 px per inch. Changing page size resizes the tracing reference to the new page."
      onClose={onClose}
      width="w-[420px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply(widthPx, heightPx)}>
            Apply page size
          </Button>
        </>
      }
    >
      <Field label="Page preset">
        <Select value={preset} onChange={(v) => setPresetSize(v as PagePreset)} options={[...PAGE_PRESETS]} />
      </Field>
      <Field label="Enter dimensions in">
        <Select
          value={unit}
          onChange={(v) => setUnit(v as PageUnit)}
          options={[
            { value: "mm", label: "Millimetres" },
            { value: "in", label: "Inches" },
            { value: "px", label: "Pixels" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Width (${unit})`}>
          <NumberInput value={Math.round(width * 100) / 100} min={unit === "px" ? 100 : 25} max={unit === "px" ? 20000 : 5292} step={0.1} onChange={(v) => { setWidthPx(unitToPx(v, unit)); setPreset("custom"); }} />
        </Field>
        <Field label={`Height (${unit})`}>
          <NumberInput value={Math.round(height * 100) / 100} min={unit === "px" ? 100 : 25} max={unit === "px" ? 20000 : 5292} step={0.1} onChange={(v) => { setHeightPx(unitToPx(v, unit)); setPreset("custom"); }} />
        </Field>
      </div>
      <p className="text-[12px] text-ink-faint">
        Current page: {Math.round(widthPx)} × {Math.round(heightPx)} px. Receipt presets use a practical starter height; increase it for longer forms.
      </p>
    </Dialog>
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
        <Checkbox
          label="Snap to objects"
          checked={state.snapToObjects}
          onChange={(v) => controller.setSnapToObjects(v)}
        />
        <Checkbox
          label="Full-span rules"
          checked={state.fullSpanRules}
          onChange={(v) => controller.setFullSpanRules(v)}
        />
      </div>
      <p className="text-[12px] text-ink-faint">
        Snap rounds the top-left corner of an object to the nearest grid line
        while it is dragged.
      </p>
    </Dialog>
  );
}
