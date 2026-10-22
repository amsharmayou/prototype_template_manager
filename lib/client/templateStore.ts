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
import { parseTemplate } from "@/lib/template/parse";

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
    const valid: SavedTemplate[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" || item === null ||
        typeof (item as SavedTemplate).name !== "string" ||
        typeof (item as SavedTemplate).updatedAt !== "string"
      ) continue;
      try {
        valid.push({
          name: (item as SavedTemplate).name,
          updatedAt: (item as SavedTemplate).updatedAt,
          template: parseTemplate((item as SavedTemplate).template),
        });
      } catch {
        // Ignore a corrupt entry without hiding healthy templates.
      }
    }
    return valid;
  } catch {
    return [];
  }
}

function writeAll(all: SavedTemplate[]): boolean {
  try {
    window.localStorage.setItem(LIB_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function listTemplates(): SavedTemplate[] {
  return readAll()
    .map((t) => t)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTemplate(name: string, template: BillTemplate): boolean {
  const now = new Date().toISOString();
  const all = readAll().filter((t) => t.name !== name);
  all.push({ name, updatedAt: now, template });
  return writeAll(all);
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
    return parseTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
}
