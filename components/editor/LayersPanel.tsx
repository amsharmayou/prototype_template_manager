"use client";

import { ActiveSelection } from "fabric";

import type {
  EditorController,
  EditorState,
  LayerEntry,
} from "@/lib/canvas/EditorController";

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
  // A group is authoring state, so the tree is derived here rather than read
  // off the canvas: the scene stays flat and membership lives in the
  // controller. Every object appears exactly once — nested under its group, or
  // at the top level when it is loose.
  const groups = controller.getGroups();
  const rows: Array<{
    key: string;
    depth: number;
    label: string;
    glyph: string;
    role: string | null;
    id: string | null;
    layer: LayerEntry | null;
  }> = [];
  const grouped = new Set<string>();
  const walk = (groupId: string, depth: number): void => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    rows.push({
      key: `g:${group.id}`,
      depth,
      label: group.name,
      glyph: TYPE_GLYPH.group ?? "▣",
      role: null,
      id: null,
      layer: null,
    });
    for (const member of group.members) {
      const child = groups.find((g) => g.id === member);
      if (child) {
        walk(child.id, depth + 1);
        continue;
      }
      const layer = state.layers.find((l) => l.id === member);
      if (!layer) continue;
      grouped.add(layer.id);
      rows.push({
        key: layer.id,
        depth: depth + 1,
        label: layer.name,
        glyph: TYPE_GLYPH[layer.type] ?? "•",
        role: layer.role,
        id: layer.id,
        layer,
      });
    }
  };
  for (const group of groups.filter((g) => g.parentId === null)) {
    walk(group.id, 0);
  }
  for (const layer of state.layers) {
    if (grouped.has(layer.id)) continue;
    if (groups.some((g) => g.members.includes(layer.id))) continue;
    rows.push({
      key: layer.id,
      depth: 0,
      label: layer.name,
      glyph: TYPE_GLYPH[layer.type] ?? "•",
      role: layer.role,
      id: layer.id,
      layer,
    });
  }

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
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-neutral-400">
            No objects yet. Pick a tool and drag on the canvas.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((row) => {
              const selected = row.id !== null && state.selection.includes(row.id);
              return (
                <li key={row.key}>
                  <div
                    className={`group flex items-center gap-1 rounded pr-1 transition-colors ${
                      selected
                        ? "bg-blue-50 ring-1 ring-blue-300"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (row.id !== null) {
                          onSelect(row.id);
                          return;
                        }
                        // A group row selects the whole structure.
                        const canvas = controller.getCanvas();
                        const members = controller.groupObjectsOf(
                          row.key.replace(/^g:/, ""),
                        );
                        if (canvas && members.length > 0) {
                          canvas.discardActiveObject();
                          canvas.setActiveObject(
                            members.length === 1
                              ? members[0]!
                              : new ActiveSelection(members, { canvas }),
                          );
                          canvas.requestRenderAll();
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
                      style={{ paddingLeft: `${8 + row.depth * 12}px` }}
                    >
                      <span className="w-4 shrink-0 text-center text-[11px] text-neutral-400">
                        {row.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[11px] ${
                            row.id === null
                              ? "font-semibold text-neutral-600"
                              : "text-neutral-700"
                          }`}
                        >
                          {row.label}
                        </span>
                        {row.role ? (
                          <span className="block truncate font-mono text-[9px] text-neutral-400">
                            {row.role}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {row.layer ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={row.layer.visible ? "Hide" : "Show"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(row.id!);
                          if (obj) {
                            obj.set({ visible: !obj.visible } as never);
                            obj.setCoords();
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle visibility");
                            onSelect(row.id!);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {row.layer.visible ? "◉" : "○"}
                      </button>
                      <button
                        type="button"
                        title={row.layer.locked ? "Unlock" : "Lock"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(row.id!);
                          if (obj) {
                            const next = !row.layer!.locked;
                            obj.set({
                              locked: next,
                              selectable: !next,
                              evented: !next,
                            } as never);
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle lock");
                            onSelect(row.id!);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {row.layer.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        title="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.moveLayer(row.id!, "up");
                          onSelect(row.id!);
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
                          controller.moveLayer(row.id!, "down");
                          onSelect(row.id!);
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        ↓
                      </button>
                    </span>
                    ) : null}
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
