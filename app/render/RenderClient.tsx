"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import DynamicForm from "@/components/render/DynamicForm";
import { deriveForm } from "@/lib/package/form";
import { PACKAGE_VERSION } from "@/lib/package/format";
import type { ComputedSpec, PackageManifest } from "@/lib/package/format";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { Button } from "@/components/ui/Controls";
import { renderToPdf, loadFontBook } from "@/lib/engine/export";
import { downloadBlob, downloadText, safeFilename } from "@/lib/export/download";
import {
  extractTemplateFields,
  extractFillableFields,
  defaultValuesForTemplate,
  displayMapFor,
  validateTemplateValues,
  validateRepeatingValues,
  type TemplateField,
} from "@/lib/template/dataBinding";
import { renderDocument } from "@/lib/render/document";
import { measureBridge } from "@/lib/billkit/bridge";
import { measureDom } from "@/lib/billkit/measure-dom";
import { CHECKED_MARK } from "@/lib/share/kit";
import {
  consumePendingTemplate,
  deleteTemplate,
  listTemplates,
  loadTemplate,
  saveTemplate,
  type SavedTemplate,
} from "@/lib/client/templateStore";
import type { BillTemplate } from "@/lib/template/types";
import { readTemplateFile } from "@/lib/client/readTemplateFile";

/**
 * Data-bound rendering page. The template carries only structure and
 * placeholders; this page derives a form from it, collects values, and
 * renders the final document  for preview, PDF download or print.
 */
export default function RenderClient() {
  // The page is client-only (ssr: false via next/dynamic), so browser storage
  // is readable in initialisers. The editor handoff wins over the library.
  const [initialTemplate] = useState<BillTemplate | null>(() =>
    consumePendingTemplate(),
  );
  const [template, setTemplate] = useState<BillTemplate | null>(initialTemplate);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialTemplate
      ? defaultValuesForTemplate(initialTemplate, computedSpecsFor(initialTemplate).map((spec) => spec.key))
      : {},
  );
  const [saved, setSaved] = useState<SavedTemplate[]>(() => listTemplates());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState(
    () => initialTemplate?.meta?.name ?? "",
  );
  const [savePrompt, setSavePrompt] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileRef2 = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const computed: ComputedSpec[] = useMemo(
    () => template ? computedSpecsFor(template) : [],
    [template],
  );

  const fields: TemplateField[] = useMemo(
    () => (template ? extractFillableFields(template, computed.map((spec) => spec.key)) : []),
    [template, computed],
  );
  const allFields: TemplateField[] = useMemo(
    () => (template ? extractTemplateFields(template) : []),
    [template],
  );

  const schema = useMemo(() => {
    if (!template) return undefined;
    const computed = computedSpecsFor(template);
    const manifest: PackageManifest = {
      packageVersion: PACKAGE_VERSION,
      templateVersion: template.templateVersion,
      name: template.meta?.name ?? "Untitled bill",
      document: {
        width: template.document.width,
        height: template.document.height,
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
    };
    return deriveForm(manifest, template);
  }, [template]);

  /**
   * Measure, then render.
   *
   * The same two steps `WebViewBillKitRuntime` takes on Android, in the same
   * order and through the same two functions. measureBridge reads the authored
   * template and applies computation and display shaping itself, and
   * renderDocument runs the same rules in the same order for the output, so
   * the preview here is the same document a customer's device prints rather
   * than a third renderer's version of it.
   *
   * Both halves are pure, so this runs in a `useMemo` without an effect: the
   * measurement is a synchronous DOM read of detached elements, which is why
   * the render stays a plain function of state.
   */
  const rendered = useMemo(() => {
    if (!template) return null;
    const plan = measureBridge(
      JSON.stringify(template),
      JSON.stringify(values),
      JSON.stringify(computed),
    );
    const measurements = measureDom(plan);
    // A field the solver widened is measured again at its new width, so the
    // height it is painted with is the wrapped height at that width rather than
    // the upper bound measured at the base width.
    const remeasure = (id: string, width: number) => {
      const request = plan.find((r) => r.id === id);
      if (!request) return undefined;
      return measureDom([{ ...request, width }])[id];
    };
    return renderDocument(template, values, {
      computed,
      measurements,
      remeasure,
      display: displayMapFor(template),
    });
  }, [template, values, computed]);

  const setValue = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const fillSample = () => {
    setError(null);
    setValues((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (next[f.key]) continue;
        next[f.key] = sampleValue(f);
      }
      for (const repeat of schema?.repeats ?? []) {
        if (next[repeat.key]) continue;
        const row = Object.fromEntries(repeat.columns.map((column) => {
          const field = allFields.find((candidate) => candidate.key === column) ?? {
            key: column,
            label: column,
            type: "text" as const,
            source: "table" as const,
            objectName: repeat.objectName,
          };
          return [column, sampleValue(field)];
        }));
        next[repeat.key] = JSON.stringify([row]);
      }
      return next;
    });
  };

  const clearAll = () => {
    setError(null);
    setValues({});
  };

  const exportValues = () => {
    downloadText(
      JSON.stringify(values, null, 2),
      `${safeFilename(templateName || "values")}.json`,
      "application/json;charset=utf-8",
    );
  };

  const importValues = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("expected a JSON object of field values");
      }
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") clean[k] = v;
      }
      setValues(clean);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importTemplate = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await readTemplateFile(file);
      setTemplate(parsed);
      setTemplateName(parsed.meta?.name ?? file.name.replace(/\.json$/i, ""));
      setValues(defaultValuesForTemplate(parsed, computedSpecsFor(parsed).map((spec) => spec.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file is not a valid bill template JSON.");
    }
  };

  const fieldErrors = [
    ...validateTemplateValues(fields, values),
    ...(template ? validateRepeatingValues(template, allFields, values) : []),
  ];
  const unfilledOptionalFields = fields.filter(
    (field) => !field.required && !values[field.key]?.trim(),
  );

  const runPdf = async () => {
    if (!template) return;
    const validation = fieldErrors;
    if (validation.length) {
      setError(validation.join(" "));
      return;
    }
    setBusy("pdf");
    setError(null);
    try {
      // The print path is the engine: fonts from the bundled set, layout from
      // those metrics, one display list, one vector PDF. There is no second
      // renderer to drift from the preview.
      const book = await loadFontBook();
      const { bytes, refusals } = await renderToPdf(
        { template, values, computed, title: template.meta?.name || "Document" },
        book,
      );
      if (refusals.length) {
        setError(`${refusals[0]}${refusals.length > 1 ? ` (+${refusals.length - 1} more)` : ""}`);
        return;
      }
      downloadBlob(
        new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
        `${safeFilename(String(template.meta?.name ?? "document"))}.pdf`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runHtml = () => {
    if (!rendered || !template) return;
    const validation = fieldErrors;
    if (validation.length) {
      setError(validation.join(" "));
      return;
    }
    downloadText(
      rendered.html,
      `${safeFilename(template.meta?.name ?? "document")}.html`,
      "text/html;charset=utf-8",
    );
  };

  const runPrint = () => {
    const validation = fieldErrors;
    if (validation.length) {
      setError(validation.join(" "));
      return;
    }
    iframeRef.current?.contentWindow?.print();
  };

  /* ---------------------------------------------------------------- */
  /* Chooser                                                           */
  /* ---------------------------------------------------------------- */

  if (!template) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-neutral-900">Render a document</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            Pick the template built in the editor. This page will turn it into
            a form and render the filled-in document — no server involved.
          </p>

          <div className="mt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Saved templates on this device
            </h2>
            {saved.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                Nothing saved yet. Use “Save to My Templates” in the editor.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {saved.map((t) => (
                  <li key={t.name} className="flex items-center gap-2">
                    <button
                      className="min-w-0 flex-1 truncate rounded border border-neutral-200 px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-50"
                      onClick={() => {
                        const loaded = loadTemplate(t.name);
                        if (loaded) {
                          setTemplate(loaded);
                          setTemplateName(t.name);
                          setValues(defaultValuesForTemplate(loaded, computedSpecsFor(loaded).map((spec) => spec.key)));
                        }
                      }}
                    >
                      {t.name}
                      <span className="ml-2 text-[10px] text-neutral-400">
                        {new Date(t.updatedAt).toLocaleString()}
                      </span>
                    </button>
                    <button
                      className="rounded border border-neutral-200 px-2 py-2 text-[10px] text-neutral-400 hover:text-red-500"
                      onClick={() => {
                        deleteTemplate(t.name);
                        setSaved(listTemplates());
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 flex items-center gap-2">
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              Upload template JSON
            </Button>
            <Link href="/" className="text-xs text-blue-600 hover:underline">
              Open the editor →
            </Link>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void importTemplate(f);
            }}
          />
          {error ? (
            <p className="mt-3 text-[11px] text-red-600">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Form + preview                                                    */
  /* ---------------------------------------------------------------- */

  const refusals = rendered?.refusals ?? [];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
        <h1 className="text-sm font-semibold text-neutral-800">Fill &amp; Render</h1>
        <span className="truncate text-[11px] text-neutral-400">
          {templateName} · {fields.length} field{fields.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <Button onClick={() => { setTemplate(null); setValues({}); setSaved(listTemplates()); }}>
          Change template
        </Button>
        <Link href="/" className="text-xs text-blue-600 hover:underline">
          Editor
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="editor-scroll w-80 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Button onClick={fillSample}>Fill sample data</Button>
            <Button onClick={clearAll}>Clear</Button>
            <Button onClick={exportValues}>Export values</Button>
            <Button onClick={() => fileRef2.current?.click()}>Import values</Button>
            <input
              ref={fileRef2}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void importValues(f);
              }}
            />
          </div>

          {fields.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-neutral-500">
              This template has no <code className="font-mono">{"{{placeholders}}"}</code>{" "}
              or image slots, so there is nothing to fill. Add variables in the
              editor (text like <code className="font-mono">{"{{customer_name}}"}</code>)
              and the form appears here.
            </p>
          ) : (
            <DynamicForm
              fields={fields}
              values={values}
              onChange={(key, value) => { setError(null); setValue(key, value); }}
              schema={schema}
              onError={setError}
            />
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-white px-3 py-1.5">
            <Button variant="primary" disabled={busy !== null || fieldErrors.length > 0} onClick={runPdf}>
              {busy === "pdf" ? "Rendering PDF…" : "Download PDF"}
            </Button>
            <Button disabled={fieldErrors.length > 0} onClick={runHtml}>Download HTML</Button>
            <Button disabled={fieldErrors.length > 0} onClick={runPrint}>Print</Button>
            <div className="flex-1" />
            <button
              className="text-[11px] text-neutral-400 hover:text-neutral-600"
              onClick={() => setSavePrompt((v) => !v)}
            >
              {savePrompt ? "Cancel" : "Save template to this device…"}
            </button>
          </div>

          {savePrompt ? (
            <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
              <input
                className="w-64 rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <Button
                variant="primary"
                onClick={() => {
                  if (templateName.trim()) {
                    if (saveTemplate(templateName.trim(), template)) {
                      setSavePrompt(false);
                      setSaved(listTemplates());
                      setError(null);
                    } else {
                      setError("Could not save on this device. Browser storage may be full or unavailable.");
                    }
                  }
                }}
              >
                Save “{templateName || "…"}”
              </Button>
            </div>
          ) : null}

          {error ? (
            <p className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
          {refusals.length > 0 ? (
            <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
              {refusals.length} template value{refusals.length === 1 ? "" : "s"} refused:{" "}
              {refusals
                .slice(0, 3)
                .map((r) => `${r.field} (${r.reason})`)
                .join(", ")}
              {refusals.length > 3 ? "…" : ""}
            </p>
          ) : null}
          {fieldErrors.length > 0 ? (
            <div role="alert" className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
              <strong>Complete or correct these fields before generating the bill:</strong>{" "}
              {fieldErrors.join(" ")}
            </div>
          ) : null}
          {rendered?.warnings.length ? (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              <strong>Preview checks:</strong> {rendered.warnings.slice(0, 4).join(" · ")}
              {rendered.warnings.length > 4 ? ` · and ${rendered.warnings.length - 4} more` : ""}
            </div>
          ) : null}
          {unfilledOptionalFields.length > 0 ? (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              <strong>Optional fields left blank:</strong>{" "}
              {unfilledOptionalFields.slice(0, 5).map((field) => field.label).join(", ")}
              {unfilledOptionalFields.length > 5 ? `, and ${unfilledOptionalFields.length - 5} more` : ""}. Blank placeholders are omitted from output.
            </div>
          ) : null}

          <div className="editor-scroll min-h-0 flex-1 overflow-auto bg-neutral-200 p-4">
            <div className="mx-auto w-fit shadow-lg ring-1 ring-neutral-300">
              <iframe
                ref={iframeRef}
                title="Rendered document preview"
                className="bg-white"
                style={{
                  width: rendered?.page.width ?? template.document.width,
                  height: rendered?.page.height ?? template.document.height,
                }}
                srcDoc={rendered?.html ?? ""}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Predictable sample values, keyed off the traced variable names. */
function sampleValue(field: TemplateField): string {
  const k = field.key.toLowerCase();
  if (field.type === "image") return "";
  if (field.type === "tickmark") return CHECKED_MARK;
  if (field.type === "checkbox") return CHECKED_MARK;
  if (field.type === "date") return "2026-10-03";
  if (field.type === "number") {
    if (k.includes("qty") || k.includes("quantity")) return "2";
    if (k.includes("count")) return "3";
    return "1";
  }
  if (field.type === "currency") {
    if (k.includes("tax_rate") || k.includes("rate")) return "18";
    if (k.includes("tax")) return "537";
    if (k.includes("discount")) return "0";
    if (k.includes("subtotal")) return "2972";
    if (k.includes("total")) return "3510";
    return "100";
  }
  if (k.includes("customer_name") || k === "customer") return "Sharma & Sons";
  if (k.includes("company_name") || k === "company") return "Acme Trading Co.";
  if (k.includes("customer_address") || k.includes("billing_address")) return "14 Mall Road, Pune 411001";
  if (k.includes("company_address")) return "23 Ring Road, Mumbai 400001";
  if (k.includes("gstin")) return "27ABCDE1234F1Z5";
  if (k.includes("invoice") || k.includes("number") || k.includes("no")) return "INV-2026-1042";
  if (k.includes("due_date") || k.includes("date")) return "2026-10-03";
  if (k.includes("phone") || k.includes("mobile")) return "+91 98765 43210";
  if (k.includes("email")) return "bills@example.com";
  if (k.includes("item_name") || k.includes("description")) return "A4 Notebook, 200 pages";
  if (k.includes("hsn")) return "4820";
  if (k.includes("bank")) return "State Bank of India";
  if (k.includes("account")) return "12987654321";
  if (k.includes("ifsc")) return "SBIN0001234";
  return "Sample";
}
