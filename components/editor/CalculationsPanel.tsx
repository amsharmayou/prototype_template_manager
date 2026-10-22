"use client";

import { useMemo, useState } from "react";

import { Button, Field, Panel, Select, TextInput } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { ComputedOp, ComputedSpec } from "@/lib/package/format";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import { extractVariables } from "@/lib/template/placeholders";

const OPERATIONS: Array<{ value: ComputedOp; label: string }> = [
  { value: "add", label: "Add values" },
  { value: "subtract", label: "Subtract values" },
  { value: "multiply", label: "Multiply values" },
  { value: "percent", label: "Percent of a value" },
  { value: "sum", label: "Sum a column or values" },
  { value: "sum-times", label: "Sum quantity × rate rows" },
];

export default function CalculationsPanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const [key, setKey] = useState("");
  const [op, setOp] = useState<ComputedOp>("add");
  const [arg1, setArg1] = useState("");
  const [arg2, setArg2] = useState("");
  const [rateKey, setRateKey] = useState("");
  const [error, setError] = useState("");

  const { args, outputKeys } = useMemo(() => {
    const template = controller.getTemplate();
    const choices = new Set<string>(extractTemplateFields(template).map((field) => field.key));
    for (const table of template.objects) {
      if (table.type !== "table" || !table.repeat) continue;
      for (let row = table.repeat.startRow; row <= table.repeat.endRow; row += 1) {
        for (let column = 0; column < table.columns; column += 1) {
          for (const columnKey of extractVariables(table.cells[row * table.columns + column]?.text ?? "")) {
            choices.add(`${table.repeat.key}.${columnKey}`);
          }
        }
      }
    }
    for (const spec of state.computedSpecs) choices.add(spec.key);
    const options = [...choices].sort().map((value) => ({ value, label: value }));
    return { args: options, outputKeys: new Set(state.computedSpecs.map((spec) => spec.key)) };
  }, [controller, state]);

  const saveRule = () => {
    const output = key.trim();
    const requiredArgs = op === "percent" ? [arg1] : op === "sum" ? [arg1 || arg2].filter(Boolean) : [arg1, arg2].filter(Boolean);
    if (!/^[A-Za-z0-9_.-]+$/.test(output)) {
      setError("Use letters, numbers, dots, dashes, or underscores for the result key.");
      return;
    }
    if (requiredArgs.length === 0 || (op !== "sum" && op !== "percent" && requiredArgs.length < 2)) {
      setError("Choose the required input fields for this calculation.");
      return;
    }
    if (op === "percent" && !rateKey) {
      setError("Choose the percentage rate field.");
      return;
    }
    if (outputKeys.has(output) && !state.computedSpecs.some((spec) => spec.key === output)) {
      setError("That result key is already used by an automatic calculation.");
      return;
    }
    const spec: ComputedSpec = {
      key: output,
      op,
      args: op === "sum" ? [arg1 || arg2] : op === "percent" ? [arg1] : [arg1, arg2],
      ...(op === "percent" ? { rateKey } : {}),
    };
    controller.setComputedSpecs([...state.computedSpecs.filter((item) => item.key !== output), spec]);
    setKey("");
    setError("");
  };

  const removeRule = (keyToRemove: string) => controller.setComputedSpecs(state.computedSpecs.filter((spec) => spec.key !== keyToRemove));

  return (
    <Panel title="Calculations">
      <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
        Define safe bill math once. Example: tax_amount = 5% of subtotal, then total = subtotal + tax_amount. Results use the renderer’s decimal-safe money rules.
      </p>
      {state.computedSpecs.length === 0 ? <p className="mb-2 text-[11px] text-ink-faint">No custom rules yet. Repeat tables can still supply an automatic subtotal.</p> : null}
      <div className="space-y-2">
        {state.computedSpecs.map((spec) => (
          <div key={spec.key} className="flex items-start justify-between gap-2 rounded border border-rule p-2">
            <div className="min-w-0 text-[11px]">
              <button type="button" className="font-semibold text-ink underline" onClick={() => controller.selectDynamicKey(spec.key)}>{`{{${spec.key}}}`}</button>
              <p className="break-all text-ink-faint">{spec.op}: {spec.args.join(", ")}{spec.rateKey ? ` · rate ${spec.rateKey}` : ""}</p>
            </div>
            <Button variant="danger" onClick={() => removeRule(spec.key)}>Remove</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2 border-t border-rule pt-3">
        <Field label="Result key"><TextInput value={key} placeholder="tax_amount" onChange={(event) => setKey(event.target.value)} /></Field>
        <Field label="Operation"><Select value={op} onChange={(value) => setOp(value as ComputedOp)} options={OPERATIONS} /></Field>
        <Field label={op === "sum-times" ? "Quantity field / repeat column" : op === "sum" ? "Field or repeat column to sum" : "First value"}>
          <Select value={arg1} onChange={setArg1} options={[{ value: "", label: "Choose a field" }, ...args]} />
        </Field>
        {op !== "percent" && op !== "sum" ? (
          <Field label={op === "sum-times" ? "Price / rate field" : "Second value"}>
            <Select value={arg2} onChange={setArg2} options={[{ value: "", label: "Choose a field" }, ...args]} />
          </Field>
        ) : null}
        {op === "percent" ? (
          <Field label="Percentage rate field"><Select value={rateKey} onChange={setRateKey} options={[{ value: "", label: "Choose a rate field" }, ...args]} /></Field>
        ) : null}
        <Button variant="primary" className="w-full" onClick={saveRule}>Save calculation</Button>
        {error ? <p role="alert" className="text-[11px] text-red-700">{error}</p> : null}
      </div>
    </Panel>
  );
}
