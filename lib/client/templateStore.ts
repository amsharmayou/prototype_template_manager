"use client";

/**
 * A tiny on-device template library.
 *
 * The editor saves templates here (`localStorage`) so the renderer page can
 * offer them without any upload, and a one-shot handoff slot
 * (`sessionStorage`) carries the template the user most recently came from,
 * so "Fill & Render" needs no save at all.
 */

import type { BillTemplate } from "@/lib/template/types";

const LIB_KEY = "btm:templates";
const PENDING_KEY = "btm:pendingTemplate";

export interface SavedTemplate {
  name: string;
  updatedAt: string;
  template: BillTemplate;
}

function readAll(): SavedTemplate[] {
  try {
    const raw = window.localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is SavedTemplate =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as SavedTemplate).name === "string" &&
        typeof (t as SavedTemplate).updatedAt === "string" &&
        typeof (t as SavedTemplate).template === "object",
    );
  } catch {
    return [];
  }
}

function writeAll(all: SavedTemplate[]): void {
  try {
    window.localStorage.setItem(LIB_KEY, JSON.stringify(all));
  } catch {
    // A quota or privacy-mode failure must never break the editor.
  }
}

export function listTemplates(): SavedTemplate[] {
  return readAll()
    .map((t) => t)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTemplate(name: string, template: BillTemplate): void {
  const now = new Date().toISOString();
  const all = readAll().filter((t) => t.name !== name);
  all.push({ name, updatedAt: now, template });
  writeAll(all);
}

export function loadTemplate(name: string): BillTemplate | null {
  return readAll().find((t) => t.name === name)?.template ?? null;
}

export function deleteTemplate(name: string): void {
  writeAll(readAll().filter((t) => t.name !== name));
}

export function setPendingTemplate(template: BillTemplate): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(template));
  } catch {
    // Best effort only; the renderer falls back to the library/upload path.
  }
}

export function consumePendingTemplate(): BillTemplate | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as BillTemplate;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.objects) ||
      !parsed.document ||
      typeof parsed.document.width !== "number" ||
      typeof parsed.document.height !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
