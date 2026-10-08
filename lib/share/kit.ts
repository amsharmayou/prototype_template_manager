import { extractTemplateFields, fillTemplate } from "@/lib/template/dataBinding";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

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
.thumb{margin-top:4px;max-height:64px;border:1px solid #e3e5e8;border-radius:4px;object-fit:contain;background:#fff}
iframe{flex:1;width:100%;height:100%;border:0;background:#8b8f96}
#status{padding:6px 16px;font-size:11px;color:#6b7280;background:#fff;border-top:1px solid #e3e5e8}
.empty{font-size:12px;color:#6b7280}
@media print{header,form,#status{display:none}iframe{border:0}}
`;

const FIELD_GROUPS: Array<{ title: string; source: string }> = [
  { title: "Text fields", source: "text" },
  // Every object placed with the field tool reports `source: "field"`. This
  // group used to be missing, so those fields were filtered out of the shared
  // page entirely — and a template built only from fields reported that it had
  // nothing to fill.
  { title: "Fields", source: "field" },
  { title: "Table cells", source: "table" },
  { title: "Images & signatures", source: "image-placeholder" },
];

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

/** Build one input per discovered placeholder, grouped by where it came from. */
function buildForm(
  fields: ReturnType<typeof extractTemplateFields>,
  onInput: () => void,
  imageValues: Record<string, string>,
): HTMLElement {
  const form = el("form");
  form.addEventListener("submit", (e) => e.preventDefault());

  const groups = FIELD_GROUPS.map((g) => ({
    title: g.title,
    items: fields.filter((f) => f.source === g.source),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    form.append(
      el(
        "p",
        "empty",
        "This template has no dynamic placeholders, so there is nothing to fill. Print it as it is.",
      ),
    );
    return form;
  }

  for (const group of groups) {
    const section = el("div", "group");
    section.append(el("h2", undefined, group.title));
    for (const field of group.items) {
      section.append(buildField(field, onInput, imageValues));
    }
    form.append(section);
  }
  return form;
}

function buildField(
  field: ReturnType<typeof extractTemplateFields>[number],
  onInput: () => void,
  imageValues: Record<string, string>,
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
      const reader = new FileReader();
      reader.onload = () => {
        const existing = holder.querySelector("img");
        const thumb = el("img", "thumb");
        thumb.alt = field.label;
        thumb.src = typeof reader.result === "string" ? reader.result : "";
        if (existing) existing.replaceWith(thumb);
        else holder.append(thumb);
        // The value store is what refresh() merges into the rendered template,
        // so the picked image actually reaches the preview.
        if (typeof reader.result === "string") {
          imageValues[field.key] = reader.result;
        } else {
          delete imageValues[field.key];
        }
        onInput();
      };
      reader.readAsDataURL(picked);
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
  } else if (field.type === "number") {
    input = el("input");
    input.type = "number";
    input.step = "any";
    input.addEventListener("input", onInput);
  } else {
    input = el("input");
    input.type = "text";
    if (field.maxLength) input.maxLength = field.maxLength;
    if (field.type === "currency") input.placeholder = "0.00";
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
  return label;
}

/**
 * Wire a shared template page: form on the left, live preview on the right.
 *
 * Values are read back out of the form by `name` rather than tracked in a
 * parallel map, so there is exactly one source of truth for what has been typed
 * and no way for the preview and the inputs to disagree.
 */
export function bootShareKit(
  root: HTMLElement,
  template: BillTemplate,
  preview: HTMLIFrameElement,
): void {
  const style = el("style");
  style.textContent = STYLE;
  document.head.append(style);

  const fields = extractTemplateFields(template);
  const imageValues: Record<string, string> = {};

  const header = el("header");
  const title = el("h1", undefined, template.meta?.name || "Document");
  const printButton = el("button", "primary", "Print / Save as PDF");
  header.append(title, printButton);

  const status = el("div");
  status.id = "status";

  const shell = el("main");
  const refresh = () => {
    const values: Record<string, string> = { ...imageValues };
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
    const rendered = renderHtml(fillTemplate(template, values));
    preview.srcdoc = rendered.html;
    const missing = rendered.variables.filter((v) => !(v in values) || !values[v]);
    status.textContent = missing.length
      ? `${missing.length} placeholder${missing.length === 1 ? "" : "s"} still empty: ${missing.join(", ")}`
      : "All placeholders filled.";
  };

  const form = buildForm(fields, refresh, imageValues);

  root.replaceChildren(header, shell);
  shell.append(form, preview);
  root.append(status);

  printButton.addEventListener("click", () => {
    preview.contentWindow?.focus();
    preview.contentWindow?.print();
  });

  refresh();
}