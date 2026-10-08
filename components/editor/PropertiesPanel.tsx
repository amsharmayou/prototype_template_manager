"use client";

import { useState } from "react";

import type { FabricObject } from "fabric";

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
import { BillTable } from "@/lib/canvas/objects/BillTable";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import {
  acceptsSharedPaint,
  sharedSelection,
} from "@/lib/canvas/sharedSelection";
import { SUGGESTED_VARIABLES, toToken } from "@/lib/template/placeholders";
import type { TemplateObject } from "@/lib/template/types";

const FONTS = [
  { value: "Arial", label: "Arial" },
  { value: "Helvetica", label: "Helvetica" },
  { value: "Segoe UI", label: "Segoe UI" },
  { value: "Tahoma", label: "Tahoma" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Verdana", label: "Verdana" },
  { value: "Calibri", label: "Calibri" },
  { value: "Cambria", label: "Cambria" },
  { value: "Georgia", label: "Georgia" },
  { value: "Palatino Linotype", label: "Palatino Linotype" },
  { value: "Book Antiqua", label: "Book Antiqua" },
  { value: "Garamond", label: "Garamond" },
  { value: "Century Gothic", label: "Century Gothic" },
  { value: "Impact", label: "Impact" },
  { value: "Comic Sans MS", label: "Comic Sans MS" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Lucida Console", label: "Lucida Console" },
];

/** A small free-text family input committing only on blur/Enter. */
function CustomFontInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextInput
      value={draft ?? value}
      placeholder="Any installed family"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() && draft !== value) {
          onCommit(draft.trim());
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft !== null && draft.trim()) {
          onCommit(draft.trim());
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function PropertiesPanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const selected = controller.getSelectedTemplates();

  if (state.editingCell) {
    return <TableCellPanel controller={controller} state={state} />;
  }
  if (selected.length === 0) {
    return (
      <Panel title="Properties">
        <p className="text-[11px] leading-relaxed text-neutral-500">
          Nothing selected. Pick an object on the canvas to edit its geometry,
          styling and semantic role.
        </p>
      </Panel>
    );
  }
  if (selected.length > 1) {
    return (
      <MultiSelectPanel controller={controller} state={state} selected={selected} />
    );
  }
  const object = selected[0]!;
  // Keyed so each object gets fresh local field state when the selection
  // changes, instead of syncing props into state with an effect.
  return (
    <SinglePanel
      key={object.id}
      controller={controller}
      state={state}
      object={object}
    />
  );
}

function SinglePanel({
  controller,
  state,
  object: o,
}: {
  controller: EditorController;
  state: EditorState;
  object: TemplateObject;
}) {
  const [name, setName] = useState(o.name);
  const [role, setRole] = useState(o.role ?? "");


  const apply = (fn: (obj: FabricObject) => void, label?: string) =>
    controller.applyToSelection(fn, label);

  const preview = (fn: (obj: FabricObject) => void) =>
    controller.previewSelection(fn);

  return (
    <>
      <Panel title="Object">
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== o.name) {
                apply((obj) => obj.set({ name } as never), "Rename");
              }
            }}
          />
        </Field>
        <Field label="Role" hint="Semantic tag, e.g. header, title, items, footer">
          <TextInput
            value={role}
            placeholder="header"
            onChange={(e) => setRole(e.target.value)}
            onBlur={() => {
              if (role !== (o.role ?? "")) {
                apply((obj) => obj.set({ role: role || null } as never), "Set role");
              }
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput
              value={o.x}
              onChange={(v) => apply((obj) => {
                obj.set({ left: v } as never);
              }, "Move")}
            />
          </Field>
          <Field label="Y">
            <NumberInput
              value={o.y}
              onChange={(v) => apply((obj) => {
                obj.set({ top: v } as never);
              }, "Move")}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              value={o.width}
              onChange={(v) => apply((obj) => {
                // A table's width is the sum of its column widths, so the raw
                // set would desync the two and leave the grid drawn inside an
                // oversized selection box.
                if (obj instanceof BillTable) obj.resizeColumnsTo(v);
                else if (o.type === "ellipse") {
                  obj.set({ width: v, rx: v / 2 } as never);
                } else obj.set({ width: v } as never);
              }, "Resize")}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={o.height}
              onChange={(v) => apply((obj) => {
                if (obj instanceof BillTable) obj.resizeRowsTo(v);
                else if (o.type === "ellipse") {
                  obj.set({ height: v, ry: v / 2 } as never);
                } else obj.set({ height: v } as never);
              }, "Resize")}
            />
          </Field>
        </div>
        <Field label="Rotation">
          <NumberInput
            value={o.rotation}
            onChange={(v) => apply((obj) => {
              obj.set({ angle: v } as never);
            }, "Rotate")}
          />
        </Field>
        <Field label="Opacity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              className="tight-range flex-1"
              value={Math.round(o.opacity * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                preview((obj) => obj.set({ opacity: v } as never));
              }}
              onPointerUp={() => controller.commit("Opacity")}
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-neutral-500">
              {Math.round(o.opacity * 100)}%
            </span>
          </div>
        </Field>
        <Checkbox
          label="Locked"
          checked={o.locked}
          onChange={(v) => apply((obj) => {
            obj.set({ locked: v, selectable: !v, evented: !v } as never);
          }, "Lock")}
        />
        <Checkbox
          label="Visible"
          checked={o.visible}
          onChange={(v) => apply((obj) => obj.set({ visible: v } as never), "Visibility")}
        />
      </Panel>

      <Panel title="Appearance">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stroke">
            <ColorInput
              value={o.stroke}
              onChange={(v) => apply((obj) => obj.set({ stroke: v } as never), "Stroke")}
            />
          </Field>
          <Field label="Stroke width">
            <NumberInput
              value={o.strokeWidth}
              step={0.5}
              min={0}
              onChange={(v) => apply((obj) => obj.set({ strokeWidth: v } as never), "Stroke")}
            />
          </Field>
        </div>
        <Field label="Fill">
          <ColorInput
            value={o.fill}
            onChange={(v) => apply((obj) => obj.set({ fill: v } as never), "Fill")}
          />
        </Field>
      </Panel>

      {o.type === "text" ? <TextPanel controller={controller} o={o} /> : null}
      {o.type === "table" ? <TablePanel controller={controller} o={o} /> : null}
      {o.type === "image-placeholder" ? <PlaceholderPanel controller={controller} o={o} /> : null}
      {o.type === "field" ? <FieldPanel controller={controller} o={o} /> : null}
      {o.type === "bill-part" ? (
        <Panel title="Bill Part">
          <p className="text-[10px] text-neutral-400">
            Recapture uses the object&rsquo;s current canvas position to replace its image.
          </p>
          <Checkbox
            label="Whiten paper"
            checked={o.normalized === true}
            disabled={!state.hasReference}
            onChange={(v) => controller.recaptureBillPart(o.id, v)}
          />
          <p className="text-[10px] text-neutral-400">
            Turning this re-cuts the part from where it sits, with or without the
            paper whitened. Recapture keeps whatever is set here.
          </p>
          <Button
            onClick={() => controller.recaptureBillPart(o.id)}
            disabled={!state.hasReference}
          >
            Recapture from current position
          </Button>
        </Panel>
      ) : null}

      <Panel title="Align">
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["left", "Align left"],
              ["center", "Align centre"],
              ["right", "Align right"],
            ] as const
          ).map(([k, t]) => (
            <Button key={k} title={t} onClick={() => controller.align(k)}>
              {k === "left" ? "⇤" : k === "center" ? "⇔" : "⇥"}
            </Button>
          ))}
          {(
            [
              ["top", "Align top"],
              ["middle", "Align middle"],
              ["bottom", "Align bottom"],
            ] as const
          ).map(([k, t]) => (
            <Button key={k} title={t} onClick={() => controller.align(k)}>
              {k === "top" ? "⤒" : k === "middle" ? "⇕" : "⤓"}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={() => controller.distribute("horizontal")}>
            Distribute H
          </Button>
          <Button onClick={() => controller.distribute("vertical")}>
            Distribute V
          </Button>
        </div>
      </Panel>

      <p className="px-3 py-2 text-[10px] text-neutral-400">
        {state.selection.length} selected
      </p>
    </>
  );
}

function TextPanel({
  controller,
  o,
}: {
  controller: EditorController;
  o: Extract<TemplateObject, { type: "text" }>;
}) {
  const [text, setText] = useState(o.text);
  // A wrapped box is a Fabric `Textbox`; an auto-width box is an `IText`. The
  // template's `wrapWidth` is the durable answer and is what survives a reload.
  const isWrapped = (o as unknown as { wrapWidth?: number }).wrapWidth !== undefined;

  const apply = (fn: (obj: FabricObject) => void, label?: string) =>
    controller.applyToSelection(fn, label);

  return (
    <Panel title="Text">
      <Field label="Text" hint="Wrap a value in {{ }} to make it a variable">
        <textarea
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== o.text) {
              apply((obj) => {
                obj.set({ text } as never);
                obj.setCoords();
              }, "Edit text");
            }
          }}
        />
      </Field>
      <Field label="Insert variable">
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_VARIABLES.slice(0, 12).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                const next = `${text}${toToken(v)}`;
                setText(next);
                apply((obj) => obj.set({ text: next } as never), "Insert variable");
              }}
              className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 hover:border-blue-400 hover:text-blue-700"
            >
              {v}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font">
          <Select
            value={o.fontFamily}
            onChange={(v) => apply((obj) => obj.set({ fontFamily: v } as never), "Font")}
            options={FONTS}
          />
        </Field>
        <Field label="Size">
          <NumberInput
            value={o.fontSize}
            min={4}
            onChange={(v) => apply((obj) => obj.set({ fontSize: v } as never), "Font size")}
          />
        </Field>
        <Field label="Weight">
          <Select
            value={o.fontWeight}
            onChange={(v) => apply((obj) => obj.set({ fontWeight: v } as never), "Weight")}
            options={[
              { value: "normal", label: "Normal" },
              { value: "bold", label: "Bold" },
            ]}
          />
        </Field>
        <Field label="Style">
          <Select
            value={o.fontStyle}
            onChange={(v) => apply((obj) => obj.set({ fontStyle: v } as never), "Font style")}
            options={[
              { value: "normal", label: "Normal" },
              { value: "italic", label: "Italic" },
            ]}
          />
        </Field>
        <Field label="Align">
          <Select
            value={o.textAlign}
            onChange={(v) => apply((obj) => obj.set({ textAlign: v } as never), "Align")}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
              { value: "right", label: "Right" },
            ]}
          />
        </Field>
<Field label="Custom family" hint="Any installed face, e.g. My Custom Font">
        <CustomFontInput
          value={o.fontFamily}
          onCommit={(v) => apply((obj) => obj.set({ fontFamily: v } as never), "Font family")}
        />
      </Field>
      <Field
        label="Wrap"
        hint="Fixed width: the text wraps and the box grows downward. Off means one auto-width line."
      >
        <Button
          className="w-full"
          variant={isWrapped ? "primary" : "default"}
          onClick={() => controller.setTextWrap(!isWrapped)}
        >
          {isWrapped ? "Wrapped — click to unwrap" : "Wrap at this width"}
        </Button>
      </Field>
      </div>
      <div className="rounded bg-neutral-50 px-2 py-1.5 text-[10px] text-neutral-500">
        <div>
          Kind: <span className="font-medium">{o.roleKind}</span>
        </div>
        <div className="mt-0.5">
          Variable:{" "}
          <span className="font-mono">
            {o.roleKind === "variable" ? (o.role ?? "(mixed)") : "—"}
          </span>
        </div>
      </div>
    </Panel>
  );
}

function TablePanel({
  controller,
  o,
}: {
  controller: EditorController;
  o: Extract<TemplateObject, { type: "table" }>;
}) {
  // The controller owns the live table object; the panel never mutates it.
  const setRows = (r: number) => {
    controller.updateTable((t) => {
      const current = t.rows;
      if (r > current) t.addRow(current, t.rowHeights[0] ?? 24);
      else while (t.rows > r) t.removeRow(t.rows - 1);
    }, "Rows");
  };
  const setCols = (c: number) => {
    controller.updateTable((t) => {
      const current = t.columns;
      if (c > current) t.addColumn(current, t.colWidths[0] ?? 40);
      else while (t.columns > c) t.removeColumn(t.columns - 1);
    }, "Columns");
  };

  return (
    <Panel title="Table">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rows">
          <NumberInput value={o.rows} min={1} max={60} onChange={setRows} />
        </Field>
        <Field label="Columns">
          <NumberInput value={o.columns} min={1} max={30} onChange={setCols} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Border colour">
          <ColorInput
            value={o.borderColor}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.borderColor = v;
              }, "Table border")
            }
          />
        </Field>
        <Field label="Border width">
          <NumberInput
            value={o.borderWidth}
            step={0.5}
            min={0}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.borderWidth = v;
              }, "Table border")
            }
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cell fill">
          <ColorInput
            value={o.cellFill}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.cellFill = v;
              }, "Cell fill")
            }
          />
        </Field>
        <Field label="Padding">
          <NumberInput
            value={o.padding}
            min={0}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.padding = v;
              }, "Padding")
            }
          />
        </Field>
      </div>
      <Checkbox
        label="Header row"
        checked={o.headerRow}
        onChange={(v) =>
          controller.updateTable((t) => {
            t.headerRow = v;
          }, "Header row")
        }
      />
      <Field label="Header fill">
        <ColorInput
          value={o.headerFill}
          onChange={(v) =>
            controller.updateTable((t) => {
              t.headerFill = v;
            }, "Header fill")
          }
        />
      </Field>

      <details className="rounded border border-neutral-200">
        <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-neutral-600">
          Column widths
        </summary>
        <div className="space-y-1.5 p-2">
          {o.colWidths.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] text-neutral-500">
                Col {i + 1}
              </span>
              <NumberInput
                value={w}
                min={8}
                onChange={(v) =>
                  controller.updateTable((t) => t.setColumnWidth(i, v), "Column width")
                }
              />
            </div>
          ))}
        </div>
      </details>

      <details className="rounded border border-neutral-200">
        <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-neutral-600">
          Row heights
        </summary>
        <div className="space-y-1.5 p-2">
          {o.rowHeights.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] text-neutral-500">
                Row {i + 1}
              </span>
              <NumberInput
                value={h}
                min={8}
                onChange={(v) =>
                  controller.updateTable((t) => t.setRowHeight(i, v), "Row height")
                }
              />
            </div>
          ))}
        </div>
      </details>

      <details className="rounded border border-neutral-200">
        <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-neutral-600">
          Cell contents
        </summary>
        <div className="editor-scroll max-h-64 overflow-auto p-2">
          <table className="w-full border-collapse text-[10px]">
            <tbody>
              {Array.from({ length: o.rows }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: o.columns }).map((_, c) => {
                    const idx = r * o.columns + c;
                    const cell = o.cells[idx];
                    return (
                      <td key={c} className="border border-neutral-200 p-0.5">
                        <input
                          className="w-full bg-transparent px-1 py-0.5 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                          value={cell?.text ?? ""}
                          onChange={(e) => {
                            controller.updateTable(
                              (t) => t.setCellText(r, c, e.target.value),
                              "Cell text",
                            );
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-neutral-400">
            Tip: double click a cell on the canvas to edit it in place. Use
            double brace tokens such as item_name for dynamic data.
          </p>
        </div>
      </details>
    </Panel>
  );
}

function TableCellPanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const table = controller
    .getCanvas()
    ?.getObjects()
    .find((x): x is BillTable => x instanceof BillTable);
  if (!table || !state.editingCell) {
    return <Panel title="Cell">No active cell.</Panel>;
  }
  const idx = state.editingCell.index;
  const cell = table.getCell(Math.floor(idx / table.columns), idx % table.columns);

  return (
    <Panel title="Cell">
      <Field label="Text">
        <TextInput
          value={cell.text}
          onChange={(e) => controller.updateCell(table, idx, e.target.value)}
        />
      </Field>
      <Field label="Alignment">
        <Select
          value={cell.textAlign}
          onChange={(v) => {
            table.setCellAlign(
              Math.floor(idx / table.columns),
              idx % table.columns,
              v as never,
            );
            controller.commit("Cell align");
          }}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
        />
      </Field>
      <Button
        className="w-full"
        onClick={() => controller.endCellEdit(table)}
        variant="primary"
      >
        Done editing cell
      </Button>
      <p className="text-[10px] text-neutral-400">
        Tab moves to the next cell, Enter or Escape finishes.
      </p>
    </Panel>
  );
}

function PlaceholderPanel({
  controller,
  o,
}: {
  controller: EditorController;
  o: Extract<TemplateObject, { type: "image-placeholder" }>;
}) {
  const [label, setLabel] = useState(o.label);

  return (
    <Panel title="Image Placeholder">
      <Field label="Role">
        <Select
          value={o.placeholderRole}
          onChange={(v) =>
            controller.applyToSelection((obj) => obj.set({ placeholderRole: v } as never), "Placeholder role")
          }
          options={[
            { value: "logo", label: "Logo" },
            { value: "qr", label: "QR code" },
            { value: "stamp", label: "Stamp" },
            { value: "signature", label: "Signature" },
            { value: "product", label: "Product image" },
            { value: "image", label: "Image" },
          ]}
        />
      </Field>
      <Field label="Label">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== o.label) {
              controller.applyToSelection((obj) => obj.set({ label } as never), "Label");
            }
          }}
        />
      </Field>
    </Panel>
  );
}

function FieldPanel({
  controller,
  o,
}: {
  controller: EditorController;
  o: Extract<TemplateObject, { type: "field" }>;
}) {
  const [key, setKey] = useState(o.key);

  return (
    <Panel title="Field">
      <Field label="Key" hint="Form key, e.g. invoice_date">
        <TextInput
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => {
            const next = key.trim();
            if (next && next !== o.key) {
              controller.applyToSelection((obj) => {
                obj.set({ key: next, label: `{{${next}}}` } as never);
              }, "Field key");
            }
          }}
        />
      </Field>
      <Field label="Type">
        <Select
          value={o.fieldType}
          onChange={(v) =>
            controller.applyToSelection(
              (obj) => obj.set({ fieldType: v } as never),
              "Field type",
            )
          }
          options={[
            { value: "text", label: "Text" },
            { value: "number", label: "Number" },
            { value: "date", label: "Date" },
            { value: "currency", label: "Currency" },
            { value: "tickmark", label: "Tickmark (✓/✗)" },
            { value: "checkbox", label: "Checkbox" },
          ]}
        />
      </Field>
      <Field label="Ink colour" hint="Also the colour the value prints in">
        <ColorInput
          value={o.fill}
          onChange={(v) =>
            controller.applyToSelection((obj) => {
              // The marker's ink and the printed value's ink are one colour.
              // `fill` is deliberately not touched: on a field it is the tint
              // behind the dashed box, and painting that would fill the slot
              // with ink instead.
              obj.set({ textColor: v } as never);
              obj.setCoords();
            }, "Field colour")
          }
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font">
          <Select
            value={o.fontFamily}
            onChange={(v) =>
              controller.applyToSelection(
                (obj) => obj.set({ fontFamily: v } as never),
                "Font",
              )
            }
            options={FONTS}
          />
        </Field>
        <Field label="Size">
          <NumberInput
            value={o.fontSize}
            min={4}
            onChange={(v) =>
              controller.applyToSelection(
                (obj) => obj.set({ fontSize: v } as never),
                "Font size",
              )
            }
          />
        </Field>
        <Field label="Weight">
          <Select
            value={o.fontWeight}
            onChange={(v) =>
              controller.applyToSelection(
                (obj) => obj.set({ fontWeight: v } as never),
                "Weight",
              )
            }
            options={[
              { value: "normal", label: "Normal" },
              { value: "bold", label: "Bold" },
            ]}
          />
        </Field>
        <Field label="Style">
          <Select
            value={o.fontStyle}
            onChange={(v) =>
              controller.applyToSelection(
                (obj) => obj.set({ fontStyle: v } as never),
                "Font style",
              )
            }
            options={[
              { value: "normal", label: "Normal" },
              { value: "italic", label: "Italic" },
            ]}
          />
        </Field>
      </div>
      <Field label="Align" hint="Left, centre or right, as in a text box">
        <Select
          value={o.textAlign}
          onChange={(v) =>
            controller.applyToSelection(
              (obj) => obj.set({ textAlign: v } as never),
              "Align",
            )
          }
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
        />
      </Field>
      <Field label="Custom family" hint="Any installed face, e.g. My Custom Font">
        <CustomFontInput
          value={o.fontFamily}
          onCommit={(v) =>
            controller.applyToSelection(
              (obj) => obj.set({ fontFamily: v } as never),
              "Font family",
            )
          }
        />
      </Field>
    </Panel>
  );
}

/**
 * Properties a whole selection agrees on, edited once.
 *
 * A control whose value the objects disagree on shows a dash instead of one
 * object's value, so the panel never claims a shared state that is not there.
 * Choosing a new value writes it across the selection as a single edit, so one
 * change is one undo step rather than one per object.
 */
function MultiAppearancePanel({
  controller,
  state,
  selected,
}: {
  controller: EditorController;
  state: EditorState;
  selected: TemplateObject[];
}) {
  const shared = sharedSelection(selected);
  const paintable = selected.filter(acceptsSharedPaint);

  return (
    <Panel title="Appearance">
      {paintable.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stroke">
            <div className="flex items-center gap-1">
              {shared.stroke === undefined ? <Mixed /> : null}
              <ColorInput
                // A mixed selection has no single colour to show, so the swatch
                // opens on black. The dash beside it is what says "these do not
                // agree", and the control stays live so picking a colour is
                // still how the disagreement gets settled.
                value={shared.stroke ?? "#000000"}
                onChange={(v) => controller.applyShared("stroke", v, "Stroke")}
              />
            </div>
          </Field>
          <Field label="Stroke width">
            <div className="flex items-center gap-1">
              {shared.strokeWidth === undefined ? <Mixed /> : null}
              <NumberInput
                // Empty rather than a made-up number: the field must not claim
                // a width the selection does not have.
                value={shared.strokeWidth ?? Number.NaN}
                step={0.5}
                min={0}
                onChange={(v) =>
                  controller.applyShared("strokeWidth", v, "Stroke width")
                }
              />
            </div>
          </Field>
          <Field label="Fill">
            <div className="flex items-center gap-1">
              {shared.fill === undefined ? <Mixed /> : null}
              <ColorInput
                value={shared.fill ?? "#000000"}
                onChange={(v) => controller.applyShared("fill", v, "Fill")}
              />
            </div>
          </Field>
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed text-neutral-400">
          None of these carry a stroke or fill of their own — a table&rsquo;s
          borders and a bill part&rsquo;s image have their own settings, so there
          is nothing here to share.
        </p>
      )}

      {shared.opacity !== undefined ? (
        <Field label="Opacity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              className="tight-range flex-1"
              // The mean of the selection, so the slider starts somewhere real
              // even when the objects disagree.
              value={Math.round(shared.opacity * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                controller.previewSelection((obj) => obj.set({ opacity: v } as never));
              }}
              onPointerUp={() => controller.commit("Opacity")}
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-neutral-500">
              {Math.round(shared.opacity * 100)}%
            </span>
          </div>
        </Field>
      ) : null}

      <Checkbox
        label="Visible"
        checked={shared.visible === true}
        onChange={(v) => controller.applyShared("visible", v, "Visibility")}
      />
      <Checkbox
        label="Locked"
        checked={shared.locked === true}
        onChange={(v) => controller.applyShared("locked", v, "Lock")}
      />

      <p className="text-[10px] leading-relaxed text-neutral-400">
        A dash means the selection does not agree yet; pick a value and it
        applies to every object that has one. {state.objectCount} objects in
        document.
      </p>
    </Panel>
  );
}

/**
 * Marks a property the selection does not agree on.
 *
 * It sits beside the control rather than replacing it: a dash has to say
 * "mixed" without making the property impossible to set, because choosing a
 * value for a mixed property is exactly how the disagreement is resolved.
 */
function Mixed() {
  return (
    <span
      title="The selection does not agree on this"
      className="flex h-7 shrink-0 items-center rounded border border-dashed border-neutral-300 px-1.5 text-[11px] text-neutral-400"
    >
      &mdash;
    </span>
  );
}

function MultiSelectPanel({
  controller,
  state,
  selected,
}: {
  controller: EditorController;
  state: EditorState;
  selected: TemplateObject[];
}) {
  return (
    <>
      <Panel title={`${selected.length} objects`}>
        <ul className="editor-scroll max-h-40 space-y-1 overflow-auto text-[11px]">
          {selected.map((o) => (
            <li key={o.id} className="truncate text-neutral-600">
              {o.name} <span className="text-neutral-400">({o.type})</span>
            </li>
          ))}
        </ul>
      </Panel>
      <MultiAppearancePanel
        controller={controller}
        state={state}
        selected={selected}
      />
      <Panel title="Align">
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["left", "⇤"],
              ["center", "⇔"],
              ["right", "⇥"],
              ["top", "⤒"],
              ["middle", "⇕"],
              ["bottom", "⤓"],
            ] as const
          ).map(([k, icon]) => (
            <Button key={k} title={`Align ${k}`} onClick={() => controller.align(k)}>
              {icon}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={() => controller.distribute("horizontal")}>Distribute H</Button>
          <Button onClick={() => controller.distribute("vertical")}>Distribute V</Button>
        </div>
      </Panel>
      <Panel title="Group">
        <div className="grid grid-cols-2 gap-1">
          <Button
            onClick={() => controller.groupSelection()}
            title="Ctrl+G"
          >
            Group
          </Button>
          <Button
            onClick={() => controller.ungroupSelection()}
            title="Ctrl+Shift+G"
          >
            Ungroup
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-neutral-400">
          A group moves and selects as one structure. Groups are an editing aid
          only — the exported bill is identical either way. Ungroup dissolves one
          without deleting anything.
        </p>
      </Panel>
      <p className="px-3 py-2 text-[10px] text-neutral-400">
        {state.objectCount} objects in document
      </p>
    </>
  );
}
