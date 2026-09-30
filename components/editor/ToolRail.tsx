"use client";

import type { EditorController, ToolId } from "@/lib/canvas/EditorController";
import { TOOL_LABELS } from "@/lib/canvas/EditorController";

const TOOL_ICONS: Record<ToolId, string> = {
  select: "▸",
  line: "╱",
  rect: "▭",
  "rounded-rect": "▢",
  ellipse: "◯",
  polygon: "△",
  freehand: "✎",
  text: "T",
  table: "▦",
  hr: "―",
  vr: "│",
  "image-placeholder": "▧",
};

const ORDER: ToolId[] = [
  "select",
  "line",
  "hr",
  "vr",
  "rect",
  "rounded-rect",
  "ellipse",
  "polygon",
  "freehand",
  "text",
  "table",
  "image-placeholder",
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
  hr: "H",
  freehand: "E",
};

export default function ToolRail({
  controller,
  activeTool,
}: {
  controller: EditorController;
  activeTool: ToolId;
}) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto editor-scroll px-2 py-1.5 bg-white border-b border-neutral-200">
      {ORDER.map((tool) => {
        const active = tool === activeTool;
        return (
          <button
            key={tool}
            type="button"
            onClick={() => controller.setTool(tool)}
            title={`${TOOL_LABELS[tool]}${SHORTCUTS[tool] ? ` (${SHORTCUTS[tool]})` : ""}`}
            className={`flex shrink-0 flex-col items-center gap-0.5 rounded px-2 py-1 min-w-[46px] transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <span className="text-sm leading-none">{TOOL_ICONS[tool]}</span>
            <span className="text-[9px] leading-none whitespace-nowrap">
              {TOOL_LABELS[tool]}
            </span>
          </button>
        );
      })}
      {activeTool === "polygon" ? (
        <button
          type="button"
          onClick={() => controller.finishPolygon()}
          className="ml-2 shrink-0 rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700"
        >
          Close polygon (Enter)
        </button>
      ) : null}
    </div>
  );
}
