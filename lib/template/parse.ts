import { migrateTemplate } from "./migrate";
import { TEMPLATE_VERSION, type BillTemplate } from "./types";

const OBJECT_TYPES = new Set([
  "line", "rect", "rounded-rect", "ellipse", "polygon", "freehand",
  "text", "hr", "vr", "table", "image-placeholder", "field", "cell-field", "group", "bill-part",
]);
const MAX_PAGE_PX = 20_000;
const MAX_OBJECT_COORDINATE = 100_000;
const MAX_OBJECTS = 5_000;

/** Validate untrusted JSON, migrate supported older versions, and return a template. */
export function parseTemplate(raw: unknown): BillTemplate {
  if (!isRecord(raw)) throw new Error("The file must contain a template object.");
  if (typeof raw.templateVersion === "number" && raw.templateVersion > TEMPLATE_VERSION) {
    throw new Error(`This template uses version ${raw.templateVersion}; this editor supports version ${TEMPLATE_VERSION}.`);
  }
  const document = raw.document;
  if (!isRecord(document) || !validPageDimension(document.width) || !validPageDimension(document.height)) {
    throw new Error("The template needs a page width and height between 100 and 20,000 px.");
  }
  if (!Array.isArray(raw.objects) || raw.objects.length > MAX_OBJECTS) {
    throw new Error(`The template must contain no more than ${MAX_OBJECTS} objects.`);
  }
  if (isRecord(raw.meta) && raw.meta.placeholders !== undefined) {
    if (!Array.isArray(raw.meta.placeholders)) throw new Error("Template field settings must be a list.");
    const keys = new Set<string>();
    for (const spec of raw.meta.placeholders) {
      if (!isRecord(spec) || typeof spec.key !== "string" || !/^[A-Za-z0-9_.-]+$/.test(spec.key)) {
        throw new Error("A field setting has an invalid key.");
      }
      if (keys.has(spec.key)) throw new Error(`Field settings for “${spec.key}” are duplicated.`);
      keys.add(spec.key);
      if (spec.required !== undefined && typeof spec.required !== "boolean") {
        throw new Error(`The required setting for “${spec.key}” is invalid.`);
      }
      if (spec.defaultValue !== undefined && typeof spec.defaultValue !== "string") {
        throw new Error(`The default value for “${spec.key}” must be text.`);
      }
      if (spec.type !== undefined && !["text", "number", "date", "currency", "tickmark", "checkbox"].includes(spec.type as string)) {
        throw new Error(`The answer type for “${spec.key}” is not supported.`);
      }
      if (spec.maxLength !== undefined && (typeof spec.maxLength !== "number" || !Number.isInteger(spec.maxLength) || spec.maxLength < 1 || spec.maxLength > 100_000)) {
        throw new Error(`The maximum length for “${spec.key}” is invalid.`);
      }
      if (spec.min !== undefined && (typeof spec.min !== "number" || !Number.isFinite(spec.min))) {
        throw new Error(`The minimum for “${spec.key}” must be a finite number.`);
      }
      if (spec.max !== undefined && (typeof spec.max !== "number" || !Number.isFinite(spec.max))) {
        throw new Error(`The maximum for “${spec.key}” must be a finite number.`);
      }
      if (typeof spec.min === "number" && typeof spec.max === "number" && spec.min > spec.max) {
        throw new Error(`The minimum for “${spec.key}” cannot exceed its maximum.`);
      }
    }
  }
  if (isRecord(raw.meta) && raw.meta.computed !== undefined) {
    if (!Array.isArray(raw.meta.computed) || raw.meta.computed.length > 100) {
      throw new Error("Template calculations must be a list of at most 100 rules.");
    }
    const keys = new Set<string>();
    for (const spec of raw.meta.computed) {
      if (!isRecord(spec) || typeof spec.key !== "string" || !/^[A-Za-z0-9_.-]+$/.test(spec.key)) {
        throw new Error("A calculation has an invalid output key.");
      }
      if (keys.has(spec.key)) throw new Error(`Calculation output “${spec.key}” is duplicated.`);
      keys.add(spec.key);
      if (!["sum", "sum-times", "add", "subtract", "multiply", "percent"].includes(String(spec.op))) {
        throw new Error(`Calculation “${spec.key}” uses an unsupported operation.`);
      }
      if (!Array.isArray(spec.args) || !spec.args.every((arg) => typeof arg === "string")) {
        throw new Error(`Calculation “${spec.key}” needs a list of field keys.`);
      }
      if (spec.op === "percent" && typeof spec.rateKey !== "string") {
        throw new Error(`Percentage calculation “${spec.key}” needs a rate field.`);
      }
    }
  }

  const ids = new Set<string>();
  for (let i = 0; i < raw.objects.length; i += 1) {
    const item: unknown = raw.objects[i];
    if (!isRecord(item) || typeof item.type !== "string" || !OBJECT_TYPES.has(item.type)) {
      throw new Error(`Object ${i + 1} has an unsupported or missing type.`);
    }
    for (const key of ["x", "y", "width", "height"]) {
      const coordinate = item[key];
      if (
        typeof coordinate !== "number" || !Number.isFinite(coordinate) ||
        Math.abs(coordinate) > MAX_OBJECT_COORDINATE ||
        ((key === "width" || key === "height") && coordinate < 0) ||
        ((key === "width" || key === "height") && coordinate > MAX_PAGE_PX)
      ) {
        throw new Error(`Object ${i + 1} has an invalid ${key} coordinate.`);
      }
    }
    if (typeof item.id === "string") {
      if (ids.has(item.id)) throw new Error(`Object ID “${item.id}” is used more than once.`);
      ids.add(item.id);
    }
    if (item.type === "table") {
      if (
        !Number.isInteger(item.rows) || !Number.isInteger(item.columns) ||
        (item.rows as number) < 1 || (item.rows as number) > 200 ||
        (item.columns as number) < 1 || (item.columns as number) > 50 ||
        !Array.isArray(item.cells) || item.cells.length !== (item.rows as number) * (item.columns as number)
      ) {
        throw new Error(`Table ${i + 1} has inconsistent rows, columns, or cells.`);
      }
      if (!item.cells.every((cell: unknown) => isRecord(cell) && typeof cell.text === "string")) {
        throw new Error(`Table ${i + 1} contains a cell without valid text.`);
      }
      const badColumns = item.colWidths !== undefined &&
        (!Array.isArray(item.colWidths) || item.colWidths.length !== item.columns ||
          !item.colWidths.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0));
      const badRows = item.rowHeights !== undefined &&
        (!Array.isArray(item.rowHeights) || item.rowHeights.length !== item.rows ||
          !item.rowHeights.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0));
      if (badColumns || badRows) {
        throw new Error(`Table ${i + 1} has invalid row or column sizes.`);
      }
      if (item.repeat !== undefined) {
        const repeat = item.repeat;
        if (!isRecord(repeat) || !Number.isInteger(repeat.startRow) || !Number.isInteger(repeat.endRow) ||
          (repeat.startRow as number) < 0 || (repeat.endRow as number) < (repeat.startRow as number) ||
          (repeat.endRow as number) >= (item.rows as number) || typeof repeat.key !== "string" ||
          !/^[A-Za-z0-9_.-]+$/.test(repeat.key) ||
          (repeat.maxItems !== undefined && (!Number.isInteger(repeat.maxItems) || (repeat.maxItems as number) < 1 || (repeat.maxItems as number) > 200))) {
          throw new Error(`Table ${i + 1} has an invalid repeating row band or item cap (maximum 200).`);
        }
      }
    }
    if ((item.type === "text" || item.type === "field") && typeof item.text !== "string") {
      throw new Error(`Text object ${i + 1} has no valid text value.`);
    }
    if (item.type === "field" && typeof item.key !== "string") {
      throw new Error(`Data field ${i + 1} has no field key.`);
    }
    if (item.type === "field" && !/^[A-Za-z0-9_.-]+$/.test(item.key as string)) {
      throw new Error(`Data field ${i + 1} has an invalid key.`);
    }
    if (item.type === "polygon" && (!Array.isArray(item.points) || item.points.length < 3 ||
      !item.points.every((point: unknown) => Array.isArray(point) && point.length === 2 &&
        point.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_OBJECT_COORDINATE)))) {
      throw new Error(`Polygon ${i + 1} needs at least three valid points.`);
    }
    if (item.type === "freehand" && (typeof item.path !== "string" || item.path.length > 1_000_000)) {
      throw new Error(`Freehand object ${i + 1} has an invalid or oversized path.`);
    }
  }

  const migrated = migrateTemplate(raw).template;
  return migrated;
}

function validPageDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 100 && value <= MAX_PAGE_PX;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
