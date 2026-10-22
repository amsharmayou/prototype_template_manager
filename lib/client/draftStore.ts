"use client";

import { parseTemplate } from "@/lib/template/parse";
import type { BillTemplate } from "@/lib/template/types";

const DRAFT_KEY = "btm:recovery-draft";

export interface EditorDraft {
  name: string;
  savedAt: string;
  template: BillTemplate;
}

/** Save the latest editable document locally. The tracing reference is absent from BillTemplate. */
export function saveDraft(name: string, template: BillTemplate): boolean {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: name.trim() || "Untitled bill template",
      savedAt: new Date().toISOString(),
      template,
    }));
    return true;
  } catch {
    return false;
  }
}

/** Read and validate a recoverable draft; corrupt drafts are ignored safely. */
export function loadDraft(): EditorDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.savedAt !== "string") return null;
    return {
      name: record.name,
      savedAt: record.savedAt,
      template: parseTemplate(record.template),
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}
