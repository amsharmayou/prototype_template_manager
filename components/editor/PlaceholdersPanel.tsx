"use client";

import { useMemo, useState } from "react";

import { BUNDLED_FONTS } from "@/lib/fonts/bundled";

import {
  Button,
  Checkbox,
  ColorInput,
  Field,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import type { PlaceholderSpec, TableObject } from "@/lib/template/types";
import { computedSpecsFor } from "@/lib/package/computedSpecs";

const TYPE_OPTIONS = [
  { value: "", label: "Automatic" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "currency", label: "Currency" },
  { value: "tickmark", label: "Tickmark (✓/✗)" },
  { value: "checkbox", label: "Checkbox" },
];

const FAMILY_OPTIONS = [
  { value: "", label: "From text box" },
  ...BUNDLED_FONTS.map((f) => ({ value: f.value, label: f.label })),
];

interface Row {
  key: string;
  label: string;
  type: string;
  isImage: boolean;
  objectName: string;
  configured: boolean;
}

/**
 * Per-placeholder contracts for the template: what the generated form asks
 * for, and how the answered value is allowed to look in the finished document.
 * Everything here is optional — a row with no overrides behaves exactly as
 * before, inferring its label from the key and inheriting the text box styling.
 */
export default function PlaceholdersPanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    let template;
    try {
      template = controller.getTemplate();
    } catch {
      return [];
    }
    const computedKeys = new Set(computedSpecsFor(template).map((spec) => spec.key));
    return extractTemplateFields(template).filter((field) => !computedKeys.has(field.key)).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      isImage: f.type === "image",
      objectName: f.objectName,
      configured: state.placeholders.some((p) => p.key === f.key),
    }));
  }, [controller, state]);
  let repeatTables: TableObject[];
  try {
    repeatTables = controller.getTemplate().objects.filter((object) => object.type === "table");
  } catch {
    repeatTables = [];
  }

  const specFor = (key: string): PlaceholderSpec | undefined =>
    state.placeholders.find((p) => p.key === key);

  return (
    <Panel title="Data fields">
      {rows.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-soft">
          Add a {"{{token}}"} to a text box, or drop in a picture slot, and it
          turns up here. Each one can get its own label, answer type and print
          style.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const open = openKey === row.key;
            return (
              <div key={row.key} className="rounded border border-neutral-200">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : row.key)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-neutral-800">
                      {row.label}
                    </span>
                    <span className="block truncate text-[10px] text-neutral-400">
                      {"{{" + row.key + "}}"}
                      {row.isImage ? " · image" : ""}
                    </span>
                  </span>
                  {row.configured ? (
                    <span
                      title="Has overrides"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                    />
                  ) : (
                    <span className="shrink-0 text-[10px] text-neutral-400">
                      {open ? "▾" : "▸"}
                    </span>
                  )}
                </button>
                <Button className="mx-2 mb-1" onClick={() => controller.selectDynamicKey(row.key)}>Select on page</Button>
                {open ? (
                  <SpecEditor
                    fieldKey={row.key}
                    spec={specFor(row.key)}
                    isImage={row.isImage}
                    objectName={row.objectName}
                    onRename={(nextKey) => controller.renamePlaceholderKey(row.key, nextKey)}
                    onChange={(patch) =>
                      controller.updatePlaceholder(row.key, patch)
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 border-t border-rule pt-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Repeating rows</h3>
        {repeatTables.length === 0 ? <p className="text-[12px] text-ink-faint">Add a table first to configure line items.</p> : null}
        <div className="space-y-2">
          {repeatTables.map((table) => (
            <div key={table.id} className="rounded border border-rule p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-medium">{table.name}</span>
                <Button onClick={() => controller.selectObjectById(table.id)}>Select</Button>
              </div>
              {!table.repeat ? (
                <Button className="mt-2 w-full" onClick={() => controller.setTableRepeat(table.id, {
                  startRow: table.headerRow && table.rows > 1 ? 1 : 0,
                  endRow: table.rows - 1,
                  key: "items",
                  maxItems: 20,
                  repeatHeader: table.headerRow,
                })}>Use as item rows</Button>
              ) : (
                <div className="mt-2 space-y-2">
                  <Field label="Form collection key">
                    <TextInput value={table.repeat.key} onChange={(event) => controller.setTableRepeat(table.id, { ...table.repeat, key: event.target.value || "items" })} />
                  </Field>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Field label="First row">
                      <NumberInput value={table.repeat.startRow + 1} min={1} max={table.rows} onChange={(value) => controller.setTableRepeat(table.id, { ...table.repeat!, startRow: Math.min(value - 1, table.repeat!.endRow) })} />
                    </Field>
                    <Field label="Last row">
                      <NumberInput value={table.repeat.endRow + 1} min={table.repeat.startRow + 1} max={table.rows} onChange={(value) => controller.setTableRepeat(table.id, { ...table.repeat!, endRow: Math.max(table.repeat!.startRow, value - 1) })} />
                    </Field>
                    <Field label="Max items">
                      <NumberInput value={table.repeat.maxItems ?? 200} min={1} max={200} onChange={(value) => controller.setTableRepeat(table.id, { ...table.repeat!, maxItems: value })} />
                    </Field>
                  </div>
                  <p className="text-[10px] leading-relaxed text-ink-faint">Columns come from the {"{{token}}"} values inside this row band. Customer forms stop at the item cap.</p>
                  <Button variant="danger" onClick={() => controller.setTableRepeat(table.id, null)}>Remove repeating behavior</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SpecEditor({
  fieldKey,
  spec,
  isImage,
  objectName,
  onRename,
  onChange,
}: {
  fieldKey: string;
  spec: PlaceholderSpec | undefined;
  isImage: boolean;
  objectName: string;
  onRename: (key: string) => string | null;
  onChange: (patch: Partial<PlaceholderSpec>) => void;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const shownLabel = label ?? spec?.label ?? "";
  const shownFamily = family ?? spec?.fontFamily ?? "";
  const bold = spec?.fontWeight === "bold";
  const italic = spec?.fontStyle === "italic";

  const commitKey = () => {
    if (keyDraft === null || keyDraft.trim() === fieldKey) {
      setKeyDraft(null);
      setKeyError(null);
      return;
    }
    const error = onRename(keyDraft);
    if (error) {
      setKeyError(error);
      return;
    }
    setKeyDraft(null);
    setKeyError(null);
  };

  return (
    <div className="space-y-2 border-t border-neutral-200 p-2">
      {!isImage ? (
        <Field label="Field key" hint="Renaming updates every matching token and table cell.">
          <TextInput
            value={keyDraft ?? fieldKey}
            onChange={(e) => { setKeyDraft(e.target.value); setKeyError(null); }}
            onBlur={commitKey}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.currentTarget.blur(); }
            }}
          />
          {keyError ? <span role="alert" className="text-[12px] text-red-700">{keyError}</span> : null}
        </Field>
      ) : null}
      <Field label="Form label">
        <TextInput
          value={shownLabel}
          placeholder="Auto from key"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const next = (label ?? spec?.label ?? "").trim();
            if (next !== (spec?.label ?? "")) onChange({ label: next || undefined });
          }}
        />
      </Field>

      <Checkbox
        label="Required before making the bill"
        checked={spec?.required === true}
        onChange={(required) => onChange({ required: required || undefined })}
      />
      {!isImage ? (
        <Field label="Starting answer" hint="Customers can change this when they fill in the form.">
          <TextInput
            value={spec?.defaultValue ?? ""}
            onChange={(e) => onChange({ defaultValue: e.target.value || undefined })}
          />
        </Field>
      ) : null}
      {isImage ? (
        <p className="text-[12px] leading-relaxed text-neutral-400">
          Picture slots always ask for a picture.
        </p>
      ) : (
        <>
          <Field label="Type of answer">
            <Select
              value={spec?.type ?? ""}
              onChange={(v) =>
                onChange({
                  type: (v || undefined) as PlaceholderSpec["type"],
                })
              }
              options={TYPE_OPTIONS}
            />
          </Field>
          <Field
            label="Maximum length"
            hint="0 lets the field grow with the answer."
          >
            <NumberInput
              value={spec?.maxLength ?? 0}
              min={0}
              onChange={(v) => onChange({ maxLength: v > 0 ? v : undefined })}
            />
          </Field>
          {spec?.type === "number" || spec?.type === "currency" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Minimum value">
                <NumberInput value={spec?.min ?? 0} min={-1_000_000_000} onChange={(v) => onChange({ min: v !== 0 ? v : undefined })} />
              </Field>
              <Field label="Maximum value">
                <NumberInput value={spec?.max ?? 0} min={-1_000_000_000} onChange={(v) => onChange({ max: v !== 0 ? v : undefined })} />
              </Field>
            </div>
          ) : null}
        </>
      )}

      <Field
        label="How it prints"
        hint={`Applies when {"{{"}${fieldKey}${"}}"} fills the whole text box.`}
      >
        <div className="space-y-1.5">
          <Select
            value={isListedFamily(shownFamily) ? shownFamily : ""}
            onChange={(v) => {
              setFamily(v);
              onChange({ fontFamily: v || undefined });
            }}
            options={FAMILY_OPTIONS}
          />
          <TextInput
            value={shownFamily}
            placeholder="Or any installed family"
            onChange={(e) => setFamily(e.target.value)}
            onBlur={() => {
              const next = (family ?? "").trim();
              if (next !== (spec?.fontFamily ?? "")) {
                onChange({ fontFamily: next || undefined });
              }
              setFamily(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <div className="flex items-center gap-2">
            <NumberInput
              value={spec?.fontSize ?? 0}
              min={0}
              onChange={(v) => onChange({ fontSize: v > 0 ? v : undefined })}
            />
            <Checkbox
              label="Bold"
              checked={bold}
              onChange={(v) => onChange({ fontWeight: v ? "bold" : undefined })}
            />
            <Checkbox
              label="Italic"
              checked={italic}
              onChange={(v) => onChange({ fontStyle: v ? "italic" : undefined })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-500">Colour</span>
            <ColorInput
              value={spec?.color ?? "transparent"}
              onChange={(v) => onChange({ color: v === "transparent" ? undefined : v })}
            />
            {spec?.fontFamily || spec?.fontSize || spec?.fontWeight ||
            spec?.fontStyle || spec?.color ? (
              <Button
                variant="ghost"
                onClick={() =>
                  onChange({
                    fontFamily: undefined,
                    fontSize: undefined,
                    fontWeight: undefined,
                    fontStyle: undefined,
                    color: undefined,
                  })
                }
              >
                Clear style
              </Button>
            ) : null}
          </div>
          <p className="text-[12px] text-neutral-400">In: {objectName}</p>
        </div>
      </Field>
    </div>
  );
}

function isListedFamily(family: string): boolean {
  return FAMILY_OPTIONS.slice(1).some((o) => o.value === family);
}
