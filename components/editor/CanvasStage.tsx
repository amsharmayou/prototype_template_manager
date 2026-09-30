"use client";

import { useEffect, useRef, useState } from "react";

import type { EditorController } from "@/lib/canvas/EditorController";

/**
 * Hosts the Fabric canvas plus the inline cell editor.
 *
 * The stage is a native scroll container: the canvas element is sized to
 * `document * zoom`, so a page taller than the pane simply scrolls, and a page
 * that fits is centred. Nothing here implements scrolling itself, which keeps
 * scrolling, the grid overlay and the cell editor in agreement.
 */
export default function CanvasStage({
  controller,
  gridVisible,
  gridSize,
  zoom,
  documentSize,
  editingCell,
}: {
  controller: EditorController;
  gridVisible: boolean;
  gridSize: number;
  zoom: number;
  documentSize: { width: number; height: number };
  editingCell: { tableId: string; index: number } | null;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    controller.attach(el);
    return () => controller.detach();
  }, [controller]);

  // Keep the controller pointed at the live pane and refit while the user has
  // not chosen a zoom level, so the page is always fully visible after load.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    controller.setStageElement(stage);
    const observer = new ResizeObserver(() => {
      setPane({ width: stage.clientWidth, height: stage.clientHeight });
      if (stage.clientWidth > 0) {
        controller.setViewportSize(
          Math.max(120, stage.clientWidth - 48),
          Math.max(120, stage.clientHeight - 48),
        );
      }
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      controller.setStageElement(null);
    };
  }, [controller]);

  // Drag to pan. Handled here, in screen coordinates, because panning is a
  // viewport concern and must not be mixed up with Fabric's scene points.
  // Captured on the stage so Fabric never sees the gesture. Move and release
  // are tracked on the window: `setPointerCapture` makes Chromium scroll the
  // element into view, which would jump the view on pointer down.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let dragging = false;
    let last: { x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!dragging || !last) return;
      stage.scrollLeft -= e.clientX - last.x;
      stage.scrollTop -= e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    const end = () => {
      if (!dragging) return;
      dragging = false;
      last = null;
      stage.style.cursor = controller.isSpaceHeld() ? "grab" : "";
    };

    const onDown = (e: PointerEvent) => {
      const wantsPan = e.altKey || e.button === 1 || controller.isSpaceHeld();
      if (!wantsPan) return;
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      stage.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    stage.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      stage.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [controller]);

  // The page is the boundary: only inset it while it fits, so scrolling can
  // never reveal empty space beyond the image's edge.
  const pageW = documentSize.width * zoom;
  const pageH = documentSize.height * zoom;
  const fits = pageW + 48 <= pane.width && pageH + 48 <= pane.height;
  const pad = fits ? 24 : 0;

  return (
    <div
      ref={stageRef}
      data-btm-stage="canvas"
      className="editor-scroll relative flex-1 overflow-auto bg-neutral-200"
    >
      <div className="flex min-h-full min-w-full">
        <div className="m-auto shrink-0" style={{ padding: pad }}>
          <div
            className="relative shadow-lg ring-1 ring-neutral-300"
            style={
              gridVisible
                ? {
                    backgroundImage:
                      "linear-gradient(to right, rgba(37,99,235,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.16) 1px, transparent 1px)",
                    backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                  }
                : undefined
            }
          >
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>

      {editingCell ? (
        <CellEditor controller={controller} textareaRef={textareaRef} />
      ) : null}
    </div>
  );
}

/**
 * Inline cell editor. Positioned `fixed` from the canvas's viewport rect so it
 * stays glued to its cell while the stage is scrolled.
 */
function CellEditor({
  controller,
  textareaRef,
}: {
  controller: EditorController;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const state = controller.getSnapshot();
  const canvas = controller.getCanvas();
  const table = controller.getTable();
  const editing = state.editingCell;
  if (!editing || !table) return null;

  const cols = table.columns;
  const row = Math.floor(editing.index / cols);
  const col = editing.index % cols;
  const colStart = table.colWidths.slice(0, col).reduce((a, b) => a + b, 0);
  const rowStart = table.rowHeights.slice(0, row).reduce((a, b) => a + b, 0);
  const cell = table.getCell(row, col);

  const canvasRect = canvas?.upperCanvasEl?.getBoundingClientRect();
  const left = (canvasRect?.left ?? 0) + (table.left ?? 0) * state.zoom;
  const top = (canvasRect?.top ?? 0) + (table.top ?? 0) * state.zoom;

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      value={cell.text}
      spellCheck={false}
      onChange={(e) => controller.updateCell(table, editing.index, e.target.value)}
      onBlur={() => controller.endCellEdit(table)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          controller.endCellEdit(table);
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const next = (editing.index + 1) % (table.rows * table.columns);
          controller.beginCellEdit(table, next);
        }
      }}
      className="fixed resize-none rounded-sm border-2 border-blue-600 bg-white/95 p-1 text-xs text-neutral-900 outline-none"
      style={{
        left: left + colStart * state.zoom + table.padding * state.zoom,
        top: top + rowStart * state.zoom + table.padding * state.zoom,
        width: Math.max(24, (table.colWidths[col] ?? 0) * state.zoom - 4),
        height: Math.max(16, (table.rowHeights[row] ?? 0) * state.zoom - 2),
        fontSize: Math.max(9, cell.fontSize * state.zoom),
        textAlign: cell.textAlign,
      }}
    />
  );
}
