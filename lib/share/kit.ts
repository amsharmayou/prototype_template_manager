import {
  displayMapFor,
  extractTemplateFields,
  validateTemplateValues,
  validateRepeatingValues,
  type TemplateField,
} from "@/lib/template/dataBinding";
import { renderDocument } from "@/lib/render/document";
import { measureBridge } from "@/lib/billkit/bridge";
import { measureDom } from "@/lib/billkit/measure-dom";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { deriveForm, type FormSchema } from "@/lib/package/form";
import type { BillTemplate } from "@/lib/template/types";
import { readImageFile } from "@/lib/client/readImageFile";

/**
 * The browser half of a shared template: a page with no server, no framework
 * and no network behind it. Everything it needs is derived from the template it
 * was handed - the form from its placeholders, the preview from the same
 * renderer the app uses - so a shared file behaves like the app's own
 * renderer page with the dependency graph cut off at the door.
 */

const STYLE = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328;background:#f4f5f7}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #e3e5e8}
header h1{margin:0;font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;font-size:13px;padding:6px 12px;border-radius:6px;border:1px solid #cfd3d8;background:#fff;cursor:pointer}
button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
button:hover{filter:brightness(.97)}
main{display:flex;height:calc(100vh - 53px)}
form{width:340px;flex:none;overflow-y:auto;padding:14px;background:#fff;border-right:1px solid #e3e5e8}
.group{margin-bottom:14px}
.group h2{margin:0 0 6px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
label.field{display:block;margin-bottom:9px}
label.field>span{display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:3px}
label.field>span em{font-style:normal;font-weight:400;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;color:#9ca3af}
input,select{width:100%;font:inherit;font-size:13px;padding:5px 7px;border:1px solid #cfd3d8;border-radius:5px;background:#fff}
input[type=file]{padding:4px;font-size:11px}
.hint{margin:2px 0 0;font-size:10px;color:#9ca3af}
.repeat{margin-bottom:14px}
.repeat>h2{margin:0 0 6px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
.repeat-row{display:flex;gap:6px;align-items:flex-end;border:1px solid #e3e5e8;border-radius:6px;padding:6px;margin-bottom:6px;background:#fafafa}
.repeat-index{flex:none;font-size:10px;color:#9ca3af;padding-bottom:7px}
.repeat-row label{flex:1;min-width:0;display:block;margin-bottom:0}
.repeat-row span{display:block;font-size:10px;color:#6b7280;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repeat-remove{flex:none;width:24px;padding:6px 0;text-align:center;border-color:#e3e5e8;color:#9ca3af}
.repeat-add{display:block;width:100%;border-style:dashed;color:#4a5570}
.thumb{margin-top:4px;max-height:64px;border:1px solid #e3e5e8;border-radius:4px;object-fit:contain;background:#fff}
iframe{flex:1;width:100%;height:100%;border:0;background:#8b8f96}
#status{padding:6px 16px;font-size:11px;color:#6b7280;background:#fff;border-top:1px solid #e3e5e8}
.empty{font-size:12px;color:#6b7280}
@media print{header,form,#status{display:none}iframe{border:0}}
`;

/** The three states a tickmark can be in, shared with the app-side form. */
export const TICKMARK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "—" },
  { value: "✓", label: "✓" },
  { value: "✗", label: "✗" },
];

/** What a ticked box prints. */
export const CHECKED_MARK = "✓";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build one input per derived form field, grouped by the schema the package
 * contract promises. The schema is the same `deriveForm` output the app's
 * render page and a native host both read, so the shared page can never show
 * a form that disagrees with either.
 */
function buildForm(
  schema: FormSchema,
  fieldsByKey: ReadonlyMap<string, TemplateField>,
  repeaterValues: Record<string, string>,
  onInput: () => void,
  imageValues: Record<string, string>,
  onError: (message: string) => void,
): HTMLElement {
  const form = el("form");
  form.addEventListener("submit", (e) => e.preventDefault());

  if (schema.fields.length === 0) {
    form.append(
      el(
        "p",
        "empty",
        "This template has no dynamic placeholders, so there is nothing to fill. Print it as it is.",
      ),
    );
    return form;
  }

  for (const group of schema.groups) {
    const section = el("div", "group");
    section.append(el("h2", undefined, group.title));
    for (const field of group.fields) {
      if (field.type === "repeating") {
        const repeat = schema.repeats.find((r) => r.key === field.key);
        if (repeat) {
          section.append(
            buildRepeater(repeat, fieldsByKey, repeaterValues, onInput, onError),
          );
        }
        continue;
      }
      const declared = fieldsByKey.get(field.key);
      if (declared) {
        section.append(buildField(declared, onInput, imageValues, onError));
      }
    }
    form.append(section);
  }
  return form;
}

/**
 * The line-item editor a repeating field deserves: one row set per item, with
 * add and remove, so a bill of five goods is typed as five rows instead of a
 * JSON array into one textarea.
 */
function buildRepeater(
  repeat: NonNullable<FormSchema["repeats"][number]>,
  fieldsByKey: ReadonlyMap<string, TemplateField>,
  repeaterValues: Record<string, string>,
  onInput: () => void,
  onError: (message: string) => void,
): HTMLElement {
  const wrap = el("div", "repeat");
  wrap.dataset.repeatKey = repeat.key;
  wrap.append(el("h2", undefined, repeat.objectName || repeat.key));

  let rows: Record<string, string>[] = [];
  try {
    const parsed: unknown = JSON.parse(repeaterValues[repeat.key] ?? "[]");
    if (Array.isArray(parsed)) {
      rows = parsed.filter(
        (r): r is Record<string, string> =>
          typeof r === "object" && r !== null && !Array.isArray(r),
      );
    }
  } catch {
    rows = [];
  }

  const store = document.createElement("input");
  store.type = "hidden";
  store.name = repeat.key;
  const commit = () => store.value = JSON.stringify(rows);

  const rowsHost = el("div", "repeat-rows");

  const rowAt = (row: Record<string, string>, index: number): HTMLElement => {
    const line = el("div", "repeat-row");
    line.append(el("span", "repeat-index", String(index + 1)));
    for (const column of repeat.columns) {
      const declared =
        fieldsByKey.get(column) ??
        ({
          key: column,
          label: column,
          type: "text" as const,
          source: "table" as const,
          objectName: repeat.objectName,
        } as TemplateField);
      const holder = el("label");
      const cap = el("span");
      cap.textContent = declared.label;
      holder.append(cap);
      const input = document.createElement("input");
      input.type = declared.type === "date" ? "date"
        : declared.type === "number" || declared.type === "currency" ? "number"
        : "text";
      input.step = "any";
      input.value = row[column] ?? "";
      input.addEventListener("input", () => {
        row[column] = input.value;
        commit();
        onInput();
      });
      holder.append(input);
      line.append(holder);
    }
    const remove = el("button", "repeat-remove", "×");
    remove.type = "button";
    remove.title = "Remove this row";
    remove.addEventListener("click", () => {
      rows = rows.filter((r, i) => i !== index);
      commit();
      redraw();
      onInput();
    });
    line.append(remove);
    return line;
  };

  const redraw = () => {
    rowsHost.replaceChildren(...rows.map((row, i) => rowAt(row, i)));
    if (rows.length === 0) {
      rowsHost.append(el("p", "hint", "No rows yet. Add one with the button below."));
    }
  };

  const add = el("button", "repeat-add", `Add a row`);
  add.type = "button";
  add.addEventListener("click", () => {
    if (rows.length >= repeat.maxItems) {
      onError(`This table allows at most ${repeat.maxItems} rows.`);
      return;
    }
    rows = [...rows, {}];
    commit();
    redraw();
    onInput();
  });

  commit();
  wrap.append(store, rowsHost, add);
  redraw();
  return wrap;
}

function buildField(
  field: ReturnType<typeof extractTemplateFields>[number],
  onInput: () => void,
  imageValues: Record<string, string>,
  onError: (message: string) => void,
): HTMLLabelElement {
  const label = el("label", "field");

  const caption = el("span");
  caption.append(document.createTextNode(field.label));
  if (field.label !== field.key) {
    const key = el("em");
    key.textContent = ` ${field.key}`;
    caption.append(key);
  }
  label.append(caption);

  const holder = el("div");
  let input: HTMLInputElement | HTMLSelectElement;

  if (field.type === "image") {
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.addEventListener("change", () => {
      const picked = file.files && file.files[0];
      file.value = "";
      if (!picked) return;
      void readImageFile(picked).then((dataUrl) => {
        const existing = holder.querySelector("img");
        const thumb = el("img", "thumb");
        thumb.alt = field.label;
        thumb.src = dataUrl;
        if (existing) existing.replaceWith(thumb);
        else holder.append(thumb);
        imageValues[field.key] = dataUrl;
        onInput();
      }).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Could not read this image.");
      });
    });
    input = file;
  } else if (field.type === "tickmark") {
    // A three-way pick — none, correct, wrong — rather than free text, which
    // is what the field's own declared type asked for. Both fell through to a
    // plain text box before, so a tickmark could not be answered at all.
    const select = el("select");
    for (const opt of TICKMARK_OPTIONS) {
      const option = el("option", undefined, opt.label);
      option.value = opt.value;
      select.append(option);
    }
    select.addEventListener("input", onInput);
    input = select;
  } else if (field.type === "checkbox") {
    const box = el("input");
    box.type = "checkbox";
    // Carrying the glyph as the input's value is what makes the existing
    // value reader work untouched: ticked reads back as "✓", unticked as "",
    // and an empty value is deliberately left out of the map so the printed
    // page keeps showing `{{key}}` rather than erasing the slot.
    box.value = CHECKED_MARK;
    box.addEventListener("input", onInput);
    input = box;
  } else if (field.type === "date") {
    input = el("input");
    input.type = "date";
    input.addEventListener("input", onInput);
  } else if (field.type === "number" || field.type === "currency") {
    input = el("input");
    input.type = "number";
    input.step = "any";
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.addEventListener("input", onInput);
  } else {
    input = el("input");
    input.type = "text";
    if (field.maxLength) input.maxLength = field.maxLength;
    input.addEventListener("input", onInput);
  }

  // One `name` per key, so the form is a readable record of the template and a
  // browser's own autofill has something stable to key on.
  input.name = field.key;
  holder.append(input);
  label.append(holder);

  if (field.source === "image-placeholder") {
    label.append(el("p", "hint", "image slot"));
  }
  input.required = field.required === true;
  if (field.defaultValue !== undefined) {
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      input.checked = field.defaultValue === CHECKED_MARK;
    } else {
      input.value = field.defaultValue;
    }
  }
  if (input instanceof HTMLInputElement && (field.type === "number" || field.type === "currency")) {
    input.step = "any";
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
  }
  return label;
}

/**
 * Wire a shared template page: form on the left, live preview on the right.
 *
 * Values are read back out of the form by `name` rather than tracked in a
 * parallel map, so there is exactly one source of truth for what has been typed
 * and no way for the preview and the inputs to disagree. Repeating fields are
 * the one exception: their DOM lives in the row editor and their single named
 * input carries the rows as JSON.
 */
export function bootShareKit(
  root: HTMLElement,
  template: BillTemplate,
  preview: HTMLIFrameElement,
): void {
  const style = el("style");
  style.textContent = STYLE;
  document.head.append(style);

  const computed = computedSpecsFor(template);
  const computedKeys = computed.map((spec) => spec.key);
  const schema = deriveForm(
    {
      packageVersion: 2,
      templateVersion: template.templateVersion,
      name: template.meta?.name ?? "Untitled bill",
      document: {
        width: template.document?.width ?? 794,
        height: template.document?.height ?? 1123,
        unit: "px",
        dpi: 96,
        paper: "A4",
        currencyScale: 2,
      },
      template: "template.json",
      assets: [],
      fonts: [],
      fields: [],
      computed,
      checksums: {},
    },
    template,
  );
  const fieldsByKey = new Map<string, TemplateField>(
    extractTemplateFields(template).map((f) => [f.key, f]),
  );
  const allFields = extractTemplateFields(template);
  const repeaterValues: Record<string, string> = {};
  for (const repeat of schema.repeats) repeaterValues[repeat.key] = "[]";
  const imageValues: Record<string, string> = {};
  let validationErrors: string[] = [];

  const header = el("header");
  const title = el("h1", undefined, template.meta?.name || "Document");
  const printButton = el("button", "primary", "Print / Save as PDF");
  header.append(title, printButton);

  const status = el("div");
  status.id = "status";

  const shell = el("main");
  const refresh = () => {
    const values: Record<string, string> = { ...imageValues, ...repeaterValues };
    for (const element of Array.from(root.querySelectorAll("input,select"))) {
      const named = element as HTMLInputElement;
      if (!named.name) continue;
      // Image values are tracked separately: a file input has no editable
      // value to read, so the data URL travels in imageValues instead.
      if (named.type === "file") continue;
      // A checkbox's `value` is its *ticked* glyph and reads back as that
      // whether or not the box is ticked, so its state has to be consulted
      // separately. Reading `value` alone would print a tick in a box nobody
      // ever ticked.
      const value =
        named.type === "checkbox"
          ? named.checked
            ? named.value
            : ""
          : named.value;
      // An untouched field is left out of the map rather than recorded as "".
      // Resolution replaces a token with any string it is given, so an empty
      // string would erase the placeholder from the printed page instead of
      // leaving it visible as `{{key}}` for whoever fills the form next.
      if (value !== "") values[named.name] = value;
    }
    // Measure before rendering, exactly as the app and the preview page do.
    //
    // Without this the shared page is a third renderer, disagreeing with both:
    // a variable-layout bill grows in the app and in the editor's preview but
    // not in the page an author sends to a customer, which is precisely the
    // artefact nobody is checking.
    const fillable = allFields.filter(
      (f) =>
        f.type !== "image" &&
        !computedKeys.includes(f.key) &&
        !schema.repeats.some((r) => r.key === f.key),
    );
    validationErrors = [
      ...validateTemplateValues(fillable, values),
      ...validateRepeatingValues(template, allFields, values),
    ];
    const plan = measureBridge(
      JSON.stringify(template),
      JSON.stringify(values),
      JSON.stringify(computed),
    );
    const measurements = measureDom(plan);
    // Same second measurement pass the app performs: a field the solver widened
    // is measured again at its final width, so a shared page shows the height
    // the text is really painted at.
    const remeasure = (id: string, width: number) => {
      const request = plan.find((r) => r.id === id);
      if (!request) return undefined;
      return measureDom([{ ...request, width }])[id];
    };
    const rendered = renderDocument(template, values, {
      computed,
      measurements,
      remeasure,
      display: displayMapFor(template),
    });
    preview.srcdoc = rendered.html;
    const missing = rendered.variables.filter((v) => {
      if (schema.repeats.some((r) => r.key === v || r.columns.includes(v))) return false;
      if (computedKeys.includes(v)) return false;
      const field = fillable.find((f) => f.key === v);
      return field === undefined ? true : !(v in values) || !values[v];
    });
    status.textContent = validationErrors.length
      ? validationErrors.join(" ")
      : missing.length
      ? `${missing.length} placeholder${missing.length === 1 ? "" : "s"} still empty: ${missing.join(", ")}`
      : "All placeholders filled.";
  };

  const form = buildForm(schema, fieldsByKey, repeaterValues, refresh, imageValues, (message) => {
    status.textContent = message;
  });

  root.replaceChildren(header, shell);
  shell.append(form, preview);
  root.append(status);

  printButton.addEventListener("click", () => {
    refresh();
    if (validationErrors.length) return;
    preview.contentWindow?.focus();
    preview.contentWindow?.print();
  });

  refresh();
}
