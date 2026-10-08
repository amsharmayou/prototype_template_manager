import { DEFAULT_REPEAT_MAX_ITEMS } from "@/lib/template/types";
import type { TableRepeat } from "@/lib/template/types";

export function normaliseRepeat(
  raw: Partial<TableRepeat> | null | undefined,
  rowCount: number,
): TableRepeat | null {
  if (!raw || typeof raw !== "object") return null;
  const { startRow, endRow, key } = raw;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return null;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return null;
  if (!Number.isInteger(rowCount) || rowCount <= 0 || endRow >= rowCount) return null;
  if (typeof key !== "string" || key.trim().length === 0) return null;
  return {
    startRow,
    endRow,
    key: key.trim(),
    repeatHeader: raw.repeatHeader === true,
    maxItems:
      typeof raw.maxItems === "number" && Number.isInteger(raw.maxItems) && raw.maxItems > 0
        ? raw.maxItems
        : DEFAULT_REPEAT_MAX_ITEMS,
  };
}
