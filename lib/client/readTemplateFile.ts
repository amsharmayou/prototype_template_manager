import { parseTemplate } from "@/lib/template/parse";
import type { BillTemplate } from "@/lib/template/types";

const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

/** Read a bounded JSON template and validate/migrate it before handing it to a consumer. */
export async function readTemplateFile(file: File): Promise<BillTemplate> {
  if (file.size <= 0 || file.size > MAX_TEMPLATE_BYTES) {
    throw new Error("Template files must be smaller than 15 MB.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  return parseTemplate(raw);
}
