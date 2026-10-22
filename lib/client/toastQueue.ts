/**
 * The toast queue is pure state so the rules — newest wins, cap the stack,
 * errors stay until dismissed — are unit-testable without a DOM.
 */
export type ToastKind = "info" | "success" | "warning" | "error";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  /** One sentence telling the person what to do next. */
  detail?: string;
};

export const MAX_TOASTS = 3;

export function pushToast(
  list: ToastItem[],
  input: Omit<ToastItem, "id">,
  id: number,
): ToastItem[] {
  const next = [...list, { ...input, id }];
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
}

export function dismissToast(list: ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id);
}

/** Errors and warnings stay until dismissed; everything else fades. */
export function autoDismissMs(kind: ToastKind): number | null {
  return kind === "error" || kind === "warning" ? null : 6000;
}
