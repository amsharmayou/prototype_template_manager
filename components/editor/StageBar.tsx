"use client";

import { Minus, Plus } from "lucide-react";

import { Button, IconButton } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";

/** Under the stage: where the sheet is, and how to look at it. */
export default function StageBar({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft">
      <span className="tabular-nums">
        Page{" "}
        <span className="font-mono text-ink">
          {state.document.width} × {state.document.height}
        </span>
      </span>
      <span className="tabular-nums">
        Objects <span className="font-mono text-ink">{state.objectCount}</span>
      </span>
      <span className="tabular-nums">
        Selected <span className="font-mono text-ink">{state.selection.length}</span>
      </span>

      {state.sampledColour ? (
        <span className="flex items-center gap-1.5 tabular-nums">
          <span
            className="inline-block h-3 w-3 rounded-full border border-rule"
            style={{ backgroundColor: state.sampledColour }}
          />
          <span className="font-mono text-ink">{state.sampledColour}</span>
        </span>
      ) : null}

      <span className="text-ink-faint">Wheel to zoom · Space+drag to pan</span>
      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => controller.zoomOut()}>
          <Minus aria-hidden className="h-4 w-4" />
        </IconButton>
        <Button
          onClick={() => controller.resetZoom()}
          title="Reset zoom to 100%"
        >
          {Math.round(state.zoom * 100)}%
        </Button>
        <IconButton label="Zoom in" onClick={() => controller.zoomIn()}>
          <Plus aria-hidden className="h-4 w-4" />
        </IconButton>
        <Button
          onClick={() => controller.fit()}
          title="Fit the whole document in the pane"
        >
          Fit
        </Button>
      </div>
    </div>
  );
}
