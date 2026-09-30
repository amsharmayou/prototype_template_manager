"use client";

import type { EditorController, EditorState } from "@/lib/canvas/EditorController";

const TYPE_GLYPH: Record<string, string> = {
  rect: "▭",
  "rounded-rect": "▢",
  ellipse: "◯",
  line: "╱",
  hr: "―",
  vr: "│",
  polygon: "△",
  freehand: "✎",
  text: "T",
  iText: "T",
  textbox: "T",
  table: "▦",
  BillTable: "▦",
  "image-placeholder": "▧",
  BillImagePlaceholder: "▧",
  group: "▣",
};

export default function LayersPanel({
  controller,
  state,
  onSelect,
}: {
  controller: EditorController;
  state: EditorState;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Layers
        </h2>
        <span className="text-[10px] text-neutral-400">{state.objectCount}</span>
      </header>

      <div className="editor-scroll flex-1 overflow-auto p-2">
        {state.hasReference ? (
          <div className="mb-1 flex items-center gap-2 rounded border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1.5">
            <span className="text-neutral-400">🖼</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
              {state.referenceName}
            </span>
            <span className="shrink-0 text-[10px] text-neutral-400">
              {state.referenceLocked ? "🔒" : "○"}
            </span>
          </div>
        ) : null}

        {state.layers.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-neutral-400">
            No objects yet. Pick a tool and drag on the canvas.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {state.layers.map((layer) => {
              const selected = state.selection.includes(layer.id);
              return (
                <li key={layer.id}>
                  <div
                    className={`group flex items-center gap-1 rounded pr-1 transition-colors ${
                      selected
                        ? "bg-blue-50 ring-1 ring-blue-300"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(layer.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <span className="w-4 shrink-0 text-center text-[11px] text-neutral-400">
                        {TYPE_GLYPH[layer.type] ?? "•"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-neutral-700">
                          {layer.name}
                        </span>
                        {layer.role ? (
                          <span className="block truncate font-mono text-[9px] text-neutral-400">
                            {layer.role}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={layer.visible ? "Hide" : "Show"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(layer.id);
                          if (obj) {
                            controller.applyToSelection(() => {}, "");
                            obj.set({ visible: !obj.visible } as never);
                            obj.setCoords();
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle visibility");
                            onSelect(layer.id);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {layer.visible ? "◉" : "○"}
                      </button>
                      <button
                        type="button"
                        title={layer.locked ? "Unlock" : "Lock"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(layer.id);
                          if (obj) {
                            const next = !layer.locked;
                            obj.set({
                              locked: next,
                              selectable: !next,
                              evented: !next,
                            } as never);
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle lock");
                            onSelect(layer.id);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {layer.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        title="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.moveLayer(layer.id, "up");
                          onSelect(layer.id);
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.moveLayer(layer.id, "down");
                          onSelect(layer.id);
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
