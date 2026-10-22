"use client";

import { useRef } from "react";

import type { TemplateField } from "@/lib/template/dataBinding";
import type { FormSchema } from "@/lib/package/form";
import { repeatValue, rowsFromValue } from "@/lib/render/repeatForm";
import { CHECKED_MARK, TICKMARK_OPTIONS } from "@/lib/share/kit";
import { readImageFile } from "@/lib/client/readImageFile";

/**
 * A form generated from the template's own dynamic slots: one input per
 * discovered placeholder, grouped by source. Nothing here knows the template
 * format beyond the field list, so any template yields a working form.
 */
export default function DynamicForm({
  fields,
  values,
  onChange,
  schema,
  onError,
}: {
  fields: TemplateField[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  schema?: FormSchema;
  onError?: (message: string) => void;
}) {
  const groups: Array<{ title: string; items: TemplateField[] }> = [
    { title: "Text fields", items: fields.filter((f) => f.source === "text" || f.source === "field") },
    { title: "Table cells", items: fields.filter((f) => f.source === "table") },
    { title: "Images & signatures", items: fields.filter((f) => f.source === "image-placeholder") },
  ];

  const repeatingFields = schema?.fields.filter((f) => f.type === "repeating") ?? [];

  return (
    <div className="space-y-4">
      {repeatingFields.map((field) => {
        const repeat = schema?.repeats.find((r) => r.key === field.key);
        if (!repeat) return null;
        return (
          <fieldset key={field.key} className="rounded border border-neutral-200 p-2">
            <legend className="text-[11px] uppercase text-neutral-500">{field.label}</legend>
            {(() => {
              const rows = rowsFromValue(values[field.key] ?? "", repeat.columns);
              const commit = (next: Record<string, string>[]) =>
                onChange(field.key, repeatValue(next, repeat.columns));
              return (
                <div className="flex flex-col gap-1">
                  {rows.length > repeat.maxItems ? (
                    <p role="status" className="text-[11px] text-amber-800">
                      This answer has {rows.length} rows. Only the first {repeat.maxItems} will print; remove extra rows to keep the saved answer within the template limit.
                    </p>
                  ) : null}
                  {rows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      {repeat.columns.map((col) => (
                        <input
                          key={col}
                          aria-label={`${repeat.objectName} row ${i + 1} ${col}`}
                          className="flex-1 border px-1 py-0.5 text-[12px]"
                          value={row[col] ?? ""}
                          onChange={(e) => {
                            const next = rows.map((r, j) => (j === i ? { ...r, [col]: e.target.value } : r));
                            commit(next);
                          }}
                        />
                      ))}
                      <button
                        type="button"
                        className="px-2 text-[11px]"
                        disabled={rows.length <= 1}
                        onClick={() => commit(rows.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="self-start px-2 text-[11px]"
                    disabled={rows.length >= repeat.maxItems}
                    onClick={() => commit([...rows, {}])}
                  >
                    Add row
                  </button>
                </div>
              );
            })()}
          </fieldset>
        );
      })}
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.title}>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              {g.title}
            </h3>
            <div className="space-y-2">
              {g.items.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={onChange}
                  onError={onError}
                />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-blue-500";

function FieldRow({
  field,
  value,
  onChange,
  onError,
}: {
  field: TemplateField;
  value: string;
  onChange: (key: string, value: string) => void;
  onError?: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  let input: React.ReactNode = null;
  if (field.type === "image") {
    input = (
      <div className="mt-1">
        <input
          ref={fileRef}
          name={field.key}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          required={field.required}
          className="block w-full text-[11px] text-neutral-500 file:mr-2 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-[11px] file:text-neutral-600"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void readImageFile(file)
              .then((dataUrl) => onChange(field.key, dataUrl))
              .catch((error: unknown) => {
                onError?.(error instanceof Error ? error.message : "Could not read this image.");
              });
          }}
        />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={field.label}
            className="mt-1.5 max-h-16 rounded border border-neutral-200 object-contain"
          />
        ) : null}
      </div>
    );
  } else if (field.type === "tickmark") {
    input = (
      <select
        name={field.key}
        className={inputClass}
        required={field.required}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      >
        {TICKMARK_OPTIONS.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "checkbox") {
    input = (
      <label className="mt-1 flex items-center gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          name={field.key}
          required={field.required}
          checked={value === CHECKED_MARK}
          onChange={(e) =>
            onChange(field.key, e.target.checked ? CHECKED_MARK : "")
          }
          className="h-4 w-4 rounded border-neutral-300"
        />
        Checked
      </label>
    );
  } else if (field.type === "date") {
    input = (
      <input
        type="date"
        name={field.key}
        className={inputClass}
        required={field.required}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  } else if (field.type === "number") {
    input = (
      <input
        type="number"
        name={field.key}
        inputMode="decimal"
        className={inputClass}
        required={field.required}
        min={field.min}
        max={field.max}
        step="any"
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  } else if (field.type === "currency") {
    input = (
      <input
        type="number"
        name={field.key}
        inputMode="decimal"
        step="any"
        min={field.min}
        max={field.max}
        required={field.required}
        placeholder="0.00"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  } else {
    input = (
      <input
        type="text"
        name={field.key}
        placeholder={field.label}
        className={inputClass}
        value={value}
        maxLength={field.maxLength}
        required={field.required}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  }

  const sourceHint =
    field.source === "table"
      ? "table cell"
      : field.source === "image-placeholder"
        ? "image slot"
        : field.source === "field"
          ? "field"
          : field.objectName
            ? `text box in "${field.objectName}"`
            : "text box";

  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-600">
        {field.label}
        {field.required ? <span className="ml-1 text-red-600">Required</span> : null}
        {field.label !== field.key ? (
          <span className="ml-1 font-mono text-[10px] text-neutral-400">{field.key}</span>
        ) : null}
      </span>
      {input}
      <span className="mt-0.5 block text-[10px] text-neutral-400">
        {sourceHint}
      </span>
    </label>
  );
}
