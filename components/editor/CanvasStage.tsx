"use client";

import { useEffect, useRef } from "react";

import type { EditorController } from "@/lib/canvas/EditorController";

/**
 * Hosts the Fabric canvas plus the inline cell editor.
 *
 * The stage no longer scrolls: the canvas fills it, and panning and zooming
 * are an affine viewport transform applied to the scene (and, because Fabric
 * renders the reference as `backgroundImage`, to the bill image as well).
 * Overlays — grid and the document bounds — are positioned from that same
 * view state, so every layer moves as one surface.
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
      if (stage.clientWidth > 0) {
        controller.setViewportSize(stage.clientWidth, stage.clientHeight);
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
  // Move and release are tracked on the window, and the pointer delta maps
  // directly onto the viewport translation: dragging right moves the page
  // right, exactly like grabbing a sheet of paper.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let dragging = false;
    let last: { x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!dragging || !last) return;
      controller.panBy(e.clientX - last.x, e.clientY - last.y);
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

  const state = controller.getSnapshot();

  return (
    <div
      ref={stageRef}
      data-btm-stage="canvas"
      className="editor-scroll relative flex-1 overflow-hidden bg-neutral-200"
    >
      <canvas ref={canvasRef} />

      {/* Grid overlay: one sibling layer exactly over the canvas, offset by
          the same viewport translation, so the grid never drifts from the
          traced objects it is a guide for. */}
      {gridVisible ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(37,99,235,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.16) 1px, transparent 1px)",
            backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
            backgroundPosition: `${state.tx}px ${state.ty}px`,
          }}
        />
      ) : null}

      {/* Snap guides: same overlay layer as the grid, also positioned from the
          view state so a guide always sits on the geometry it announces. */}
      {state.snaps.length > 0 ? (
        <div className="pointer-events-none absolute inset-0">
          {state.snaps.map((s, i) =>
            s.axis === "y" ? (
              <div
                key={`h${i}`}
                className="absolute inset-x-0"
                style={{
                  top: s.pos * state.zoom + state.ty,
                  borderTop: "1px solid rgba(37,99,235,0.6)",
                }}
              />
            ) : (
              <div
                key={`v${i}`}
                className="absolute inset-y-0"
                style={{
                  left: s.pos * state.zoom + state.tx,
                  borderLeft: "1px solid rgba(37,99,235,0.6)",
                }}
              />
            ),
          )}
        </div>
      ) : null}

      {/* Document bounds: a plain ring + shadow drawn from the view state,
          pointer-transparent, so panning the page moves its edge with it. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: state.tx,
          top: state.ty,
          width: documentSize.width * zoom,
          height: documentSize.height * zoom,
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.18), 0 12px 32px rgba(0,0,0,0.16)",
        }}
      />

      {editingCell ? (
        <CellEditor controller={controller} textareaRef={textareaRef} />
      ) : null}
    </div>
  );
}

/**
 * Inline cell editor. Positioned `fixed` from the canvas's viewport rect so it
 * stays glued to its cell wherever the view has panned or zoomed to.
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
  const projected = controller.projectToScreen({
    x: table.left ?? 0,
    y: table.top ?? 0,
  });
  const left = (canvasRect?.left ?? 0) + projected.x + (colStart + table.padding) * state.zoom;
  const top = (canvasRect?.top ?? 0) + projected.y + (rowStart + table.padding) * state.zoom;

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
        left,
        top,
        width: Math.max(24, (table.colWidths[col] ?? 0) * state.zoom - 4),
        height: Math.max(16, (table.rowHeights[row] ?? 0) * state.zoom - 2),
        fontSize: Math.max(9, cell.fontSize * state.zoom),
        textAlign: cell.textAlign,
      }}
    />
  );
}
