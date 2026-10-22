"use client";

import { useState } from "react";

import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { Button, Checkbox, Field, NumberInput, Panel } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import type { ReferenceCrop } from "@/lib/canvas/referenceBackground";

export default function ReferencePanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const [crop, setCrop] = useState<ReferenceCrop>(state.referenceCrop);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const apply = async (nextCrop = crop, rotation = state.referenceRotation) => {
    setBusy(true);
    try {
      await controller.setReferenceAdjustments(nextCrop, rotation);
      setCrop(nextCrop);
    } catch (error) {
      toast({
        kind: "error",
        title: "Could not adjust the reference photo",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!state.hasReference) {
    return (
      <Panel title="Your bill photo">
        <p className="text-[12px] leading-relaxed text-ink-soft">
          No photo loaded yet. The photo is a tracing aid only &mdash; it is
          never saved into the template and never appears in an export.
        </p>
        <Button onClick={() => controller.removeReference()} disabled>
          Remove Reference
        </Button>
      </Panel>
    );
  }

  return (
    <Panel title="Your bill photo">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-medium text-neutral-600">
            Opacity
          </span>
          <span className="text-[12px] tabular-nums text-neutral-500">
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

      <div className="space-y-2 border-t border-rule pt-2">
        <p className="text-[12px] font-medium text-ink-soft">Crop edges (%)</p>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Trim blank margins from the tracing photo. These changes never alter the template or its exports.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Field key={side} label={side[0]!.toUpperCase() + side.slice(1)}>
              <NumberInput
                value={crop[side]}
                min={0}
                max={90}
                onChange={(value) => setCrop((current) => ({ ...current, [side]: value }))}
              />
            </Field>
          ))}
        </div>
        <Button className="w-full" disabled={busy} onClick={() => void apply()}>
          Apply crop
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void apply(crop, ((state.referenceRotation + 270) % 360) as 0 | 90 | 180 | 270)}>
            Rotate left
          </Button>
          <Button disabled={busy} onClick={() => void apply(crop, ((state.referenceRotation + 90) % 360) as 0 | 90 | 180 | 270)}>
            Rotate right
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => {
            setBusy(true);
            void controller.fitReferenceToPage()
              .then(() => setCrop(controller.getSnapshot().referenceCrop))
              .catch((error: unknown) => toast({ kind: "error", title: "Could not fit the photo", detail: error instanceof Error ? error.message : String(error) }))
              .finally(() => setBusy(false));
          }}>
            Fit to page
          </Button>
          <Button disabled={busy} onClick={() => {
            setCrop({ top: 0, right: 0, bottom: 0, left: 0 });
            void apply({ top: 0, right: 0, bottom: 0, left: 0 }, 0);
          }}>
            Reset photo
          </Button>
        </div>
        <p className="text-[11px] text-ink-faint">Rotation: {state.referenceRotation}°</p>
      </div>

      <Checkbox
        label="Whiten paper on new parts"
        checked={state.normaliseBillParts}
        onChange={(v) => controller.setNormaliseBillParts(v)}
      />

      <p className="text-[12px] leading-relaxed text-ink-faint">
        Cut-out pictures can keep the paper&rsquo;s colour or clean it to white.
        This sets the default for new cut-outs; each one keeps its own choice
        and can be taken again from its Cut-out picture panel.
      </p>

      <Button
        variant="danger"
        onClick={() => controller.removeReference()}
        className="w-full"
      >
        Remove Reference
      </Button>

      <p className="text-[12px] leading-relaxed text-ink-faint">
        The photo sits at the bottom layer and is left out of every export.
      </p>
    </Panel>
  );
}
