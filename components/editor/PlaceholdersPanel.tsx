"use client";

import { useMemo, useState } from "react";

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
import type { PlaceholderSpec } from "@/lib/template/types";

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
  { value: "Arial", label: "Arial" },
  { value: "Helvetica", label: "Helvetica" },
  { value: "Segoe UI", label: "Segoe UI" },
  { value: "Verdana", label: "Verdana" },
  { value: "Calibri", label: "Calibri" },
  { value: "Cambria", label: "Cambria" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Lucida Console", label: "Lucida Console" },
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
    return extractTemplateFields(template).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      isImage: f.type === "image",
      objectName: f.objectName,
      configured: state.placeholders.some((p) => p.key === f.key),
    }));
  }, [controller, state]);

  const specFor = (key: string): PlaceholderSpec | undefined =>
    state.placeholders.find((p) => p.key === key);

  return (
    <Panel title="Placeholders">
      {rows.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-neutral-500">
          Add a {"{{token}}"} to a text box, or drop in an image placeholder,
          and it turns up here. Each one can carry its own label, input type and
          printed style.
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
                {open ? (
                  <SpecEditor
                    fieldKey={row.key}
                    spec={specFor(row.key)}
                    isImage={row.isImage}
                    objectName={row.objectName}
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
    </Panel>
  );
}

function SpecEditor({
  fieldKey,
  spec,
  isImage,
  objectName,
  onChange,
}: {
  fieldKey: string;
  spec: PlaceholderSpec | undefined;
  isImage: boolean;
  objectName: string;
  onChange: (patch: Partial<PlaceholderSpec>) => void;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);

  const shownLabel = label ?? spec?.label ?? "";
  const shownFamily = family ?? spec?.fontFamily ?? "";
  const bold = spec?.fontWeight === "bold";
  const italic = spec?.fontStyle === "italic";

  return (
    <div className="space-y-2 border-t border-neutral-200 p-2">
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

      {isImage ? (
        <p className="text-[10px] leading-relaxed text-neutral-400">
          Image slots always ask for a picture, so they have no input type.
        </p>
      ) : (
        <>
          <Field label="Input type">
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
            label="Max length"
            hint="0 lets the field grow with the answer."
          >
            <NumberInput
              value={spec?.maxLength ?? 0}
              min={0}
              onChange={(v) => onChange({ maxLength: v > 0 ? v : undefined })}
            />
          </Field>
        </>
      )}

      <Field
        label="Printed style"
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
          <p className="text-[10px] text-neutral-400">In: {objectName}</p>
        </div>
      </Field>
    </div>
  );
}

function isListedFamily(family: string): boolean {
  return FAMILY_OPTIONS.slice(1).some((o) => o.value === family);
}