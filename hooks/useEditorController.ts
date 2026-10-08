"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { EditorController, type EditorState } from "@/lib/canvas/EditorController";
import { renderHtml } from "@/lib/render";

/**
 * Owns the single controller instance and mirrors it into React.
 *
 * Fabric state never lives in React state; components subscribe to the
 * controller's store so a drag does not re-render the panels on every frame.
 */
export function useEditorController(): {
  controller: EditorController;
  state: EditorState;
} {
  // A lazy initialiser keeps the controller instance stable across renders
  // without reading a ref during render.
  const [controller] = useState(() => new EditorController());

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // Expose the controller in development so the editor can be driven and
  // inspected from the console or an automated browser test.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__btm = controller;
      (window as unknown as Record<string, unknown>).__btmRender = renderHtml;
    }
  }, [controller]);

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return { controller, state };
}

/** Global keyboard shortcuts. Skips typing contexts and canvas text editing. */
export function useKeyboardShortcuts(
  controller: EditorController,
  handlers: Record<string, () => void>,
): void {
  const ref = useRef(handlers);
  // Kept in an effect so the render pass never mutates a ref.
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !isTypingTarget(e.target)) {
        controller.setSpaceHeld(true);
        // Space is the pan modifier. Without this the browser treats it as
        // "page down" and scrolls the canvas pane out from under the user.
        e.preventDefault();
      }
      if (isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Canvas text editing owns the keyboard while active.
      if (controller.getCanvas()?.getActiveObject()) {
        const active = controller.getCanvas()!.getActiveObject() as {
          isEditing?: boolean;
        };
        if (active?.isEditing) return;
      }

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) controller.redo();
        else controller.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        controller.redo();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        controller.duplicateSelection();
        return;
      }
      if (mod && key === "g" && e.shiftKey) {
        e.preventDefault();
        controller.ungroupSelection();
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        controller.groupSelection();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        controller.selectAll();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        ref.current.save?.();
        return;
      }
      if (mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        controller.deleteSelection();
        return;
      }
      if (e.key === "Escape") {
        controller.cancelPolygon();
        controller.cancelPendingTable();
        return;
      }
      if (e.key === "Enter") {
        if (controller.isDrawingPolygon) controller.finishPolygon();
        else if (controller.getSnapshot().pendingTable) controller.confirmTable(3, 3);
        return;
      }

      const map: Record<string, string> = {
        v: "select",
        l: "line",
        r: "rect",
        c: "ellipse",
        p: "polygon",
        t: "text",
        g: "table",
        i: "image-placeholder",
        f: "field",
        h: "hr",
        e: "freehand",
        k: "eyedropper",
        b: "bill-part",
      };
      const tool = map[key];
      if (tool) {
        e.preventDefault();
        controller.setTool(tool as never);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") controller.setSpaceHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controller]);
}
