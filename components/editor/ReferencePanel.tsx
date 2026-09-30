"use client";

import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { Button, Checkbox, Panel } from "@/components/ui/Controls";

export default function ReferencePanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  if (!state.hasReference) {
    return (
      <Panel title="Reference Image">
        <p className="text-[11px] leading-relaxed text-neutral-500">
          No reference loaded. The bill image is an authoring aid only: it is
          never written into the template and never appears in an export.
        </p>
        <Button onClick={() => controller.removeReference()} disabled>
          Remove Reference
        </Button>
      </Panel>
    );
  }

  return (
    <Panel title="Reference Image">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-600">
            Opacity
          </span>
          <span className="text-[11px] tabular-nums text-neutral-500">
            {Math.round(state.referenceOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          className="tight-range w-full"
          value={Math.round(state.referenceOpacity * 100)}
          onChange={(e) =>
            controller.setReferenceOpacity(Number(e.target.value) / 100)
          }
        />
      </div>

      <Checkbox
        label="Show reference"
        checked={state.referenceVisible}
        onChange={(v) => controller.setReferenceVisible(v)}
      />
      <Checkbox
        label={state.referenceLocked ? "🔒 Reference locked" : "Reference unlocked"}
        checked={state.referenceLocked}
        onChange={(v) => controller.setReferenceLocked(v)}
      />

      <Button
        variant="danger"
        onClick={() => controller.removeReference()}
        className="w-full"
      >
        Remove Reference
      </Button>

      <p className="text-[10px] leading-relaxed text-neutral-400">
        The reference sits at the bottom layer and is excluded from JSON, SVG,
        PDF, DOCX and PNG exports.
      </p>
    </Panel>
  );
}
