"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import { renderSampleBill } from "@/lib/client/sampleBill";
import { readImageFile } from "@/lib/client/readImageFile";
import { readTemplateFile } from "@/lib/client/readTemplateFile";
import type { EditorDraft } from "@/lib/client/draftStore";
import type { BillTemplate } from "@/lib/template/types";

/**
 * First screen: start from a bill photo, or open something made earlier.
 * Nothing is uploaded; files are read in the browser via FileReader.
 */
export default function UploadScreen({
  onImage,
  onTemplate,
  onTemplateForRender,
  draft,
  onResumeDraft,
  onDiscardDraft,
}: {
  onImage: (dataUrl: string, name: string) => void;
  onTemplate: (t: BillTemplate) => void;
  onTemplateForRender: (t: BillTemplate) => void;
  draft: EditorDraft | null;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const renderInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();

  const readImage = useCallback(
    async (file: File) => {
      try {
        onImage(await readImageFile(file), file.name);
      } catch (error) {
        toast({
          kind: "error",
          title: "Could not open that picture",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [onImage, toast],
  );

  const readTemplate = useCallback(
    async (file: File, hand: (t: BillTemplate) => void) => {
      try {
        hand(await readTemplateFile(file));
      } catch (error) {
        toast({
          kind: "error",
          title: "That file isn't a bill template",
          detail: error instanceof Error ? error.message : "Choose a supported .json template file.",
        });
      }
    },
    [toast],
  );

  const useSample = useCallback(() => {
    try {
      onImage(renderSampleBill(), "Sample bill");
    } catch (error) {
      toast({
        kind: "error",
        title: "Could not draw the sample bill",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [onImage, toast]);

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-6 transition-colors ${
        dragging ? "bg-ledger-wash" : "bg-desk"
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
      <div className="w-full max-w-2xl">
        <p className="font-display text-[13px] font-semibold tracking-wide text-ink-faint">
          Bill Template Maker
        </p>
        <h1 className="mt-2 font-display text-[28px] leading-tight font-semibold text-ink">
          Turn your paper bill into a digital bill
        </h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-soft">
          Take a photo of your bill and trace over it once. After that you can
          fill it in on screen, print it, and send it — as many times as you
          like.
        </p>

        <div
          className={`mt-6 rounded-xl border-2 border-dashed bg-paper p-8 text-center transition-colors ${
            dragging ? "border-ledger" : "border-rule"
          }`}
        >
          <ImagePlus aria-hidden className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mt-3 text-[15px] font-medium text-ink">
            Drop a photo of your bill here
          </p>
          <p className="mt-1 text-[12px] text-ink-soft">
            PNG, JPG or WebP — the photo stays on your computer
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={() => imageInput.current?.click()}
            >
              Choose a photo
            </Button>
            <Button size="lg" onClick={useSample}>
              Try a sample bill
            </Button>
          </div>
        </div>

        {draft ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ledger/30 bg-ledger-wash p-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Draft ready to resume: {draft.name}</p>
              <p className="mt-1 text-[11px] text-ink-soft">
                Saved {draft.savedAt}. The tracing photo is not stored in the draft.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={onResumeDraft}>Resume draft</Button>
              <Button onClick={onDiscardDraft}>Discard</Button>
            </div>
          </div>
        ) : null}

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
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readTemplate(file, onTemplate);
          }}
        />
        <input
          ref={renderInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readTemplate(file, onTemplateForRender);
          }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-rule bg-paper p-4">
          <p className="text-[13px] font-medium text-ink">
            Already made a template?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => jsonInput.current?.click()}>
              Open a saved template…
            </Button>
            <Button onClick={() => renderInput.current?.click()}>
              Fill &amp; print a saved template…
            </Button>
          </div>
          <p className="w-full text-[12px] leading-relaxed text-ink-soft">
            Opening one from disk skips the tracing step and goes straight to
            the form where you fill in the numbers.
          </p>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          Nothing is uploaded to a server, and nothing is guessed for you — you
          decide what every line, box and field means.
        </p>
      </div>
    </div>
  );
}
