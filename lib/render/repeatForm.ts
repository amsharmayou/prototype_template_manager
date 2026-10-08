import { itemsOf } from "./computed";
import type { Values } from "./values";

function blankRow(columns: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of columns) row[c] = "";
  return row;
}

export function repeatValue(rows: Record<string, string>[], columns: string[]): string {
  const filled = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = typeof row[c] === "string" ? row[c] : "";
    return out;
  });
  return JSON.stringify(filled);
}

export function rowsFromValue(value: string, columns: string[]): Record<string, string>[] {
  const parsed = itemsOf({ repeat: value } as Values, "repeat");
  if (parsed.length === 0) return [blankRow(columns)];
  return parsed.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      const v = row[c];
      out[c] = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    }
    return out;
  });
}
