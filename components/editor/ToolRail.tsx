"use client";

import type { ReactNode } from "react";

import {
  Braces,
  Check,
  Circle,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  PenLine,
  Pipette,
  Scissors,
  Slash,
  Square,
  Squircle,
  Table,
  Triangle,
  Type,
  Grid2x2,
} from "lucide-react";

import { Button } from "@/components/ui/Controls";
import type { EditorController, ToolId } from "@/lib/canvas/EditorController";
import { TOOL_LABELS } from "@/lib/canvas/EditorController";

const iconClass = "h-4 w-4";

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  select: <MousePointer2 aria-hidden className={iconClass} />,
  "guide-h": <MoveHorizontal aria-hidden className={iconClass} />,
  "guide-v": <MoveVertical aria-hidden className={iconClass} />,
  line: <Slash aria-hidden className={iconClass} />,
  hr: <Minus aria-hidden className={iconClass} />,
  vr: <Minus aria-hidden className={`${iconClass} rotate-90`} />,
  rect: <Square aria-hidden className={iconClass} />,
  "rounded-rect": <Squircle aria-hidden className={iconClass} />,
  ellipse: <Circle aria-hidden className={iconClass} />,
  polygon: <Triangle aria-hidden className={iconClass} />,
  freehand: <PenLine aria-hidden className={iconClass} />,
  text: <Type aria-hidden className={iconClass} />,
  table: <Table aria-hidden className={iconClass} />,
  "image-placeholder": <ImageIcon aria-hidden className={iconClass} />,
  "bill-part": <Scissors aria-hidden className={iconClass} />,
  field: <Braces aria-hidden className={iconClass} />,
  "cell-field": <Grid2x2 aria-hidden className={iconClass} />,
  eyedropper: <Pipette aria-hidden className={iconClass} />,
};

/**
 * Grouped by what the owner is trying to do, not by what the tool draws.
 * Order within a group is frequency of use.
 */
const GROUPS: Array<{ title: string; tools: ToolId[] }> = [
  {
    title: "Draw",
    tools: ["line", "hr", "vr", "rect", "rounded-rect", "ellipse", "polygon", "freehand"],
  },
  { title: "Structure", tools: ["guide-h", "guide-v", "table"] },
  { title: "Content", tools: ["text", "image-placeholder", "bill-part", "field", "cell-field"] },
  { title: "Tools", tools: ["select", "eyedropper"] },
];

const SHORTCUTS: Partial<Record<ToolId, string>> = {
  select: "V",
  line: "L",
  rect: "R",
  ellipse: "C",
  polygon: "P",
  text: "T",
  table: "G",
  "image-placeholder": "I",
  "bill-part": "B",
  field: "F",
  "cell-field": "X",
  hr: "H",
  freehand: "E",
  eyedropper: "K",
};

export default function ToolRail({
  controller,
  activeTool,
}: {
  controller: EditorController;
  activeTool: ToolId;
}) {
  return (
    <div className="editor-scroll flex w-[148px] shrink-0 flex-col overflow-y-auto border-r border-rule bg-paper py-1.5">
      {GROUPS.map((group) => (
        <div key={group.title} className="pb-0.5">
          <p className="px-2.5 pt-1.5 pb-0.5 text-[12px] font-semibold text-ink-faint">
            {group.title}
          </p>
          {group.tools.map((tool) => {
            const active = tool === activeTool;
            return (
              <button
                key={tool}
                type="button"
                onClick={() => controller.setTool(tool)}
                title={`${TOOL_LABELS[tool]}${SHORTCUTS[tool] ? ` (${SHORTCUTS[tool]})` : ""}`}
                aria-pressed={active}
                className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors ${
                  active
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:bg-desk hover:text-ink"
                }`}
              >
                <span className="shrink-0">{TOOL_ICONS[tool]}</span>
                <span className="min-w-0 flex-1 truncate">{TOOL_LABELS[tool]}</span>
                {SHORTCUTS[tool] ? (
                  <kbd
                    aria-hidden
                    className={`shrink-0 rounded border px-1 text-[12px] ${
                      active ? "border-paper/40 text-paper" : "border-rule text-ink-faint"
                    }`}
                  >
                    {SHORTCUTS[tool]}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}

      {activeTool === "polygon" ? (
        <div className="px-2 pb-1">
          <p className="mb-1 text-[11px] leading-tight text-ink-faint">
            Click to add points · Enter to close · Esc to cancel
          </p>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => controller.finishPolygon()}
          >
            <Check aria-hidden className="h-3.5 w-3.5" />
            Close polygon
          </Button>
        </div>
      ) : null}
    </div>
  );
}
