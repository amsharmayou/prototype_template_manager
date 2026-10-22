"use client";

import { Button, Panel } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { StepId } from "@/lib/client/steps";
import { emptyTemplate } from "@/lib/template/types";

import PlaceholdersPanel from "./PlaceholdersPanel";
import ReferencePanel from "./ReferencePanel";
import PreflightPanel from "./PreflightPanel";
import CalculationsPanel from "./CalculationsPanel";

const HINTS: Record<StepId, string> = {
  bill: "This is your bill photo. Next, trace over it.",
  trace: "Draw over the paper — the photo itself is never exported.",
  mark: "Mark what changes each time: fields, variables, repeating rows.",
  test: "Fill in example values and check the printed result.",
  share: "Keep a copy on this device, or hand someone a single file.",
};

/**
 * The column that follows the step. Every control it shows is owned by a step,
 * and the step path is always one click away — the guide opens doors, it does
 * not lock them.
 */
export default function ContextPanel({
  step,
  controller,
  state,
  onOpenGridSettings,
  onOpenPageSettings,
  onFillAndPrint,
  onSave,
  onShare,
}: {
  step: StepId;
  controller: EditorController;
  state: EditorState;
  onOpenGridSettings: () => void;
  onOpenPageSettings: () => void;
  onFillAndPrint: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  return (
    <>
      <p className="border-b border-rule bg-desk px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
        {HINTS[step]}
      </p>

      {step === "bill" || step === "trace" ? (
        <>
          <ReferencePanel controller={controller} state={state} />
          <GridPanel
            state={state}
            onOpenGridSettings={onOpenGridSettings}
          />
          <DocumentPanel controller={controller} state={state} onOpenPageSettings={onOpenPageSettings} />
        </>
      ) : null}

      {step === "mark" ? (
        <>
          <PlaceholdersPanel controller={controller} state={state} />
          <CalculationsPanel controller={controller} state={state} />
        </>
      ) : null}

      {step === "test" ? (
        <>
          <PreflightPanel controller={controller} />
          <Panel title="Try it out">
            <p className="text-[12px] leading-relaxed text-ink-soft">
              Fill in example values and see what the printed bill looks like.
              Nothing is kept unless you save it.
            </p>
            <Button variant="primary" size="lg" className="w-full" onClick={onFillAndPrint}>
              Fill &amp; print
            </Button>
          </Panel>
        </>
      ) : null}

      {step === "share" ? (
        <Panel title="Save & share">
          <Button variant="primary" className="w-full" onClick={onSave}>
            Save on this device
          </Button>
          <Button className="w-full" onClick={onFillAndPrint}>
            Fill &amp; print…
          </Button>
          <Button className="w-full" onClick={onShare}>
            Share as one file
          </Button>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            PDF, PNG, Word, SVG, JSON, .btpkg and HTML live under “Get a copy”
            in the top bar.
          </p>
        </Panel>
      ) : null}
    </>
  );
}

function GridPanel({
  state,
  onOpenGridSettings,
}: {
  state: EditorState;
  onOpenGridSettings: () => void;
}) {
  return (
    <Panel title="Grid">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-soft">
          {state.gridVisible ? `Visible · ${state.gridSize} px` : "Hidden"}
          {state.snapToGrid ? " · snap on" : ""}
        </span>
        <Button onClick={onOpenGridSettings}>Grid Settings…</Button>
      </div>
    </Panel>
  );
}

function DocumentPanel({
  controller,
  state,
  onOpenPageSettings,
}: {
  controller: EditorController;
  state: EditorState;
  onOpenPageSettings: () => void;
}) {
  return (
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
      <Button className="w-full" onClick={onOpenPageSettings}>
        Page size &amp; layout…
      </Button>
      <Button
        variant={state.structureLocked ? "primary" : "default"}
        className="w-full"
        onClick={() => controller.setStructureLocked(!state.structureLocked)}
      >
        {state.structureLocked ? "Unlock structure" : "Lock structure"}
      </Button>
      <p className="text-[12px] text-ink-faint">
        {state.document.width} × {state.document.height} px
      </p>
    </Panel>
  );
}
