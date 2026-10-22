import { describe, expect, it } from "vitest";

import {
  MAX_TOASTS,
  autoDismissMs,
  dismissToast,
  pushToast,
  type ToastItem,
} from "@/lib/client/toastQueue";

const item = (title: string): Omit<ToastItem, "id"> => ({
  kind: "info",
  title,
});

describe("toast queue", () => {
  it("appends with the supplied id", () => {
    const list = pushToast([], item("One"), 1);
    expect(list).toEqual([{ id: 1, kind: "info", title: "One" }]);
  });

  it("keeps only the newest toasts once the stack is full", () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i++) {
      list = pushToast(list, item(`T${i}`), i);
    }
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list.map((t) => t.title)).toEqual(["T3", "T4", "T5"]);
  });

  it("dismisses by id and ignores unknown ids", () => {
    const list = pushToast(pushToast([], item("A"), 1), item("B"), 2);
    expect(dismissToast(list, 1).map((t) => t.id)).toEqual([2]);
    expect(dismissToast(list, 99)).toHaveLength(2);
  });

  it("auto-dismisses info and success, but not warnings or errors", () => {
    expect(autoDismissMs("info")).toBe(6000);
    expect(autoDismissMs("success")).toBe(6000);
    expect(autoDismissMs("warning")).toBeNull();
    expect(autoDismissMs("error")).toBeNull();
  });
});
