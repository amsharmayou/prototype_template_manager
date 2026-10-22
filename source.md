# Source Code — version 1

101 source files (comments removed).

## app/globals.css

```css
@import "tailwindcss";

:root {
  --font-archivo: Arial, Helvetica, sans-serif;
  --font-bitter: Georgia, "Times New Roman", serif;
  --font-plex-mono: "Cascadia Mono", Consolas, monospace;
}

@theme {
  --color-ink: #16203a;
  --color-ink-soft: #4a5570;
  --color-ink-faint: #8891a8;
  --color-paper: #fbfaf7;
  --color-desk: #e7e6e1;
  --color-rule: #d6d5cf;
  --color-ledger: #0e7c5a;
  --color-stamp: #b3242b;
  --color-marker: #c77e0a;
  --color-ledger-wash: #e6f4ee;
  --color-stamp-wash: #fbeceb;
  --color-marker-wash: #fdf3e3;
}

@theme inline {
  --font-sans: var(--font-archivo);
  --font-mono: var(--font-plex-mono);
  --font-display: var(--font-bitter);
}

@layer base {

  :focus-visible {
    outline: 2px solid var(--color-ink);
    outline-offset: 2px;
  }
  ::selection {
    background: var(--color-ledger-wash);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

html,
body {
  height: 100%;
}

.editor-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--color-rule) transparent;
}
.editor-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.editor-scroll::-webkit-scrollbar-thumb {
  background-color: var(--color-rule);
  border-radius: 4px;
}
.editor-scroll::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-ink-faint);
}
.editor-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.num-input::-webkit-outer-spin-button,
.num-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.num-input {
  -moz-appearance: textfield;
  appearance: textfield;
}

input[type="range"].tight-range {
  height: 1rem;
}
input[type="range"].tight-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 0.9rem;
  width: 0.9rem;
  border-radius: 9999px;
  background: var(--color-ink);
  cursor: pointer;
}
input[type="range"].tight-range::-webkit-slider-runnable-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--color-rule);
}
input[type="range"].tight-range::-moz-range-thumb {
  height: 0.9rem;
  width: 0.9rem;
  border: none;
  border-radius: 9999px;
  background: var(--color-ink);
  cursor: pointer;
}
input[type="range"].tight-range::-moz-range-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--color-rule);
}

```

## app/layout.tsx

```tsx
import type { Metadata } from "next";
import "./globals.css";

import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Bill Template Maker",
  description: "Turn a photo of your paper bill into a fillable digital bill.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-desk font-sans text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

```

## app/page.tsx

```tsx
import BillEditor from "@/components/editor/BillEditor";

export default function Page() {
  return <BillEditor />;
}

```

## app/render/page.tsx

```tsx
"use client";

import dynamic from "next/dynamic";

const RenderClient = dynamic(() => import("./RenderClient"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 text-[11px] text-neutral-400">
      Loading the renderer…
    </div>
  ),
});

export default function RenderPage() {
  return <RenderClient />;
}

```

## app/render/RenderClient.tsx

```tsx
"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import DynamicForm from "@/components/render/DynamicForm";
import { deriveForm } from "@/lib/package/form";
import { PACKAGE_VERSION } from "@/lib/package/format";
import type { ComputedSpec, PackageManifest } from "@/lib/package/format";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { Button } from "@/components/ui/Controls";
import { exportPdf } from "@/lib/export/toPdf";
import { downloadText, safeFilename } from "@/lib/export/download";
import {
  extractTemplateFields,
  extractFillableFields,
  defaultValuesForTemplate,
  fillTemplate,
  validateTemplateValues,
  validateRepeatingValues,
  type TemplateField,
} from "@/lib/template/dataBinding";
import { renderHtml } from "@/lib/render";
import { computeAll } from "@/lib/render/computed";
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

export default function RenderClient() {

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

  const filled = useMemo(
    () => {
      if (!template) return null;
      const derived = computeAll(computed, values, 2);
      return fillTemplate(template, { ...values, ...derived });
    },
    [template, values, computed],
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

  const rendered = useMemo(() => {
    if (!filled) return null;
    const plan = measureBridge(
      JSON.stringify(filled),
      JSON.stringify(values),
      JSON.stringify(computed),
    );
    const measurements = measureDom(plan);

    const remeasure = (id: string, width: number) => {
      const request = plan.find((r) => r.id === id);
      if (!request) return undefined;
      return measureDom([{ ...request, width }])[id];
    };
    return renderHtml(filled, values, { computed, measurements, remeasure });
  }, [filled, values, computed]);

  const renderedTemplate = useMemo(() => {
    if (!filled || !rendered?.objects?.length) return filled;
    return {
      ...filled,
      objects: rendered.objects,
      document: {
        ...filled.document,
        width: rendered.page.width,
        height: rendered.page.height,
      },
    };
  }, [filled, rendered]);

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
    if (!filled || !template) return;
    const validation = fieldErrors;
    if (validation.length) {
      setError(validation.join(" "));
      return;
    }
    setBusy("pdf");
    setError(null);
    try {
      await exportPdf(renderedTemplate ?? filled ?? template, rendered?.page);
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

```

## components/editor/BillEditor.tsx

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import CanvasStage from "./CanvasStage";
import ContextPanel from "./ContextPanel";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";
import StageBar from "./StageBar";
import StepPath from "./StepPath";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";
import UploadScreen from "./UploadScreen";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  NumberInput,
  Select,
} from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import {
  useEditorController,
  useKeyboardShortcuts,
} from "@/hooks/useEditorController";
import { shareTemplateAsHtml } from "@/lib/client/shareOut";
import {
  firstIncomplete,
  stepDone,
  type StepFacts,
  type StepId,
} from "@/lib/client/steps";
import { saveTemplate, setPendingTemplate } from "@/lib/client/templateStore";
import { clearDraft, loadDraft, saveDraft, type EditorDraft } from "@/lib/client/draftStore";
import { billNameFromFile } from "@/lib/client/billNameFromFile";
import { readImageFile } from "@/lib/client/readImageFile";
import type { BillTemplate } from "@/lib/template/types";

type Stage = "upload" | "editor";

export default function BillEditor() {
  const { controller, state } = useEditorController();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [recoverableDraft, setRecoverableDraft] = useState<EditorDraft | null>(null);
  const draftArmed = useRef(false);
  const lastDraftJson = useRef("");
  const [preview, setPreview] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const persistRecoveryDraft = useCallback((name = state.documentName) => {
    try {
      const template = controller.getTemplate();
      const stableJson = JSON.stringify({ ...template, meta: { ...template.meta, modifiedAt: "" } });
      if (saveDraft(name, template)) lastDraftJson.current = stableJson;
    } catch {

    }
  }, [controller, state.documentName]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRecoverableDraft(loadDraft()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleImage = useCallback(
    (dataUrl: string, name: string) => {
      draftArmed.current = false;
      setStage("editor");
      setPreview(false);
      void controller
        .whenReady()
        .then(() => controller.addReference(dataUrl))
        .then(() => {
          const billName = billNameFromFile(name);
          controller.setDocumentName(billName);
          controller.setGridVisible(true);
          controller.setGridSize(10);
          draftArmed.current = true;
          persistRecoveryDraft(billName);
        })
        .catch((e: unknown) => {
          toast({
            kind: "error",
            title: "Could not load that picture",
            detail: e instanceof Error ? e.message : String(e),
          });
        });
    },
    [controller, persistRecoveryDraft, toast],
  );

  const handleTemplate = useCallback(
    (t: BillTemplate) => {
      draftArmed.current = false;
      setStage("editor");
      setPreview(false);
      void controller.whenReady().then(() => {
        controller.loadTemplate(t);
        draftArmed.current = true;
        const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
        controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
        persistRecoveryDraft(typeof t.meta?.name === "string" ? t.meta.name : "Untitled bill template");
      });
    },
    [controller, persistRecoveryDraft],
  );

  const handleTemplateForRender = useCallback(
    (t: BillTemplate) => {
      setPendingTemplate(t);
      router.push("/render");
    },
    [router],
  );

  const handleResumeDraft = useCallback(() => {
    if (!recoverableDraft) return;
    draftArmed.current = false;
    setStage("editor");
    setPreview(false);
    void controller.whenReady().then(() => {
      controller.loadTemplate(recoverableDraft.template);
      controller.setDocumentName(recoverableDraft.name);
      const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
      controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
      draftArmed.current = true;
      persistRecoveryDraft(recoverableDraft.name);
    });
  }, [controller, persistRecoveryDraft, recoverableDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setRecoverableDraft(null);
    lastDraftJson.current = "";
  }, []);

  useEffect(() => {
    if (stage !== "editor" || !state.ready || !draftArmed.current) return;
    const timer = window.setTimeout(() => {
      try {
        const template = controller.getTemplate();
        const stableJson = JSON.stringify({
          ...template,
          meta: { ...template.meta, modifiedAt: "" },
        });
        if (stableJson === lastDraftJson.current) return;
        if (saveDraft(state.documentName, template)) {
          lastDraftJson.current = stableJson;
        }
      } catch {

      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [controller, stage, state, state.documentName, state.ready]);

  const [step, setStep] = useState<StepId>("bill");
  const [testedOnce, setTestedOnce] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const handleSave = useCallback(() => {
    const saved = saveTemplate(
      state.documentName || "Untitled bill template",
      controller.getTemplate(),
    );
    if (!saved) {
      toast({
        kind: "error",
        title: "Could not save on this device",
        detail: "Browser storage may be full or unavailable. Download a JSON or Bill Package copy instead.",
      });
      return;
    }
    setSavedOnce(true);
    toast({
      kind: "success",
      title: "Saved to this device",
      detail: "Open it again any time from the Fill & print page.",
    });
  }, [controller, state.documentName, toast]);

  const handleFillAndPrint = useCallback(() => {
    setTestedOnce(true);
    setPendingTemplate(controller.getTemplate());
    router.push("/render");
  }, [controller, router]);

  const handleShare = useCallback(() => {
    void shareTemplateAsHtml(
      state.documentName,
      controller.getTemplate(),
    ).catch((error: unknown) => {
      toast({
        kind: "error",
        title: "Could not build the shareable file",
        detail: `${error instanceof Error ? error.message : String(error)} — run npm run build:share and reload.`,
      });
    });
  }, [controller, state.documentName, toast]);

  useKeyboardShortcuts(controller, { save: handleSave });

  const facts: StepFacts = {
    hasReference: state.hasReference,
    objectCount: state.objectCount,
    dataFieldCount: state.dataFieldCount,
    testedOnce,
    savedOnce,
  };
  const done = stepDone(facts);

  const completedBefore = useRef(done[step]);
  const selectStep = useCallback(
    (next: StepId) => {

      completedBefore.current = done[next];
      setStep(next);

      if (next === "mark") controller.setTool("field");
    },
    [controller, done],
  );

  useEffect(() => {
    return controller.subscribe(() => {
      const snap = controller.getSnapshot();
      const nextDone = stepDone({
        hasReference: snap.hasReference,
        objectCount: snap.objectCount,
        dataFieldCount: snap.dataFieldCount,
        testedOnce,
        savedOnce,
      });
      const was = completedBefore.current;

      if (!was && nextDone[step] && step !== "mark") {
        const next = firstIncomplete(nextDone);
        if (next && next !== step) {
          completedBefore.current = nextDone[next];
          setStep(next);
          return;
        }
      }
      completedBefore.current = nextDone[step];
    });
  }, [controller, step, testedOnce, savedOnce]);

  const prePreviewRef = useRef<boolean | null>(null);
  const referenceVisible = state.referenceVisible;
  useEffect(() => {
    if (preview) {
      if (prePreviewRef.current === null) {
        prePreviewRef.current = referenceVisible;
      }
      if (referenceVisible) controller.setReferenceVisible(false);
      return;
    }
    const saved = prePreviewRef.current;
    if (saved !== null) {
      prePreviewRef.current = null;
      controller.setReferenceVisible(saved);
    }
  }, [controller, preview, referenceVisible]);

  const pending = state.pendingTable;
  const [gridOpen, setGridOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);

  if (stage === "upload") {
    return (
      <UploadScreen
        onImage={handleImage}
        onTemplate={handleTemplate}
        onTemplateForRender={handleTemplateForRender}
        draft={recoverableDraft}
        onResumeDraft={handleResumeDraft}
        onDiscardDraft={handleDiscardDraft}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        controller={controller}
        state={state}
        preview={preview}
        onOpenImage={() => imageInput.current?.click()}
        onLoadTemplate={handleTemplate}
        onTogglePreview={() => setPreview((v) => !v)}
        onSave={handleSave}
        onFillAndPrint={handleFillAndPrint}
        onShare={handleShare}
      />

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void readImageFile(file)
            .then((dataUrl) => handleImage(dataUrl, file.name))
            .catch((error: unknown) => {
              toast({
                kind: "error",
                title: "Could not open that picture",
                detail: error instanceof Error ? error.message : String(error),
              });
            });
        }}
      />

      {preview ? (
        <div className="border-b border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft">
          Preview — reference image and editor controls are hidden. This is
          what the exports contain.
        </div>
      ) : (
        <StepPath done={done} current={step} onSelect={selectStep} />
      )}

      <div className="flex min-h-0 flex-1">
        {preview ? null : (
          <ToolRail controller={controller} activeTool={state.tool} />
        )}

        {preview ? null : (
          <aside className="editor-scroll w-[280px] shrink-0 overflow-y-auto border-r border-rule bg-paper">
            <ContextPanel
              step={step}
              controller={controller}
              state={state}
              onOpenGridSettings={() => setGridOpen(true)}
              onOpenPageSettings={() => setPageSettingsOpen(true)}
              onFillAndPrint={handleFillAndPrint}
              onSave={handleSave}
              onShare={handleShare}
            />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            <CanvasStage
              controller={controller}
              gridVisible={!preview && state.gridVisible}
              gridSize={state.gridSize}
              zoom={state.zoom}
              documentSize={state.document}
              editingCell={preview ? null : state.editingCell}
            />

            {pending ? (
              <TablePrompt
                onConfirm={(rows, cols) => {
                  controller.confirmTable(rows, cols);
                }}
                onCancel={() => {
                  controller.cancelPendingTable();
                }}
              />
            ) : null}
          </div>

          {preview ? null : <StageBar controller={controller} state={state} />}
        </div>

        {preview ? null : (
          <aside className="flex w-80 shrink-0 flex-col border-l border-rule bg-paper">
            <div className="editor-scroll min-h-0 flex-1 overflow-y-auto">
              <PropertiesPanel controller={controller} state={state} />
            </div>
            <div className="h-56 shrink-0 border-t border-rule">
              <LayersPanel
                controller={controller}
                state={state}
                onSelect={(id) => {
                  const obj = controller.getObjectById(id);
                  if (obj) {
                    controller.getCanvas()?.setActiveObject(obj);
                    controller.getCanvas()?.requestRenderAll();
                  }
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {gridOpen ? (
        <GridSettingsDialog
          controller={controller}
          state={state}
          onClose={() => setGridOpen(false)}
        />
      ) : null}
      {pageSettingsOpen ? (
        <PageSettingsDialog
          document={state.document}
          onApply={(width, height) => {
            controller.setDocument(width, height);
            setPageSettingsOpen(false);
          }}
          onClose={() => setPageSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

const PAGE_PRESETS = [
  { value: "custom", label: "Custom size" },
  { value: "a4", label: "A4 · 210 × 297 mm" },
  { value: "letter", label: "US Letter · 8.5 × 11 in" },
  { value: "receipt58", label: "Receipt · 58 mm wide" },
  { value: "receipt80", label: "Receipt · 80 mm wide" },
] as const;
type PagePreset = (typeof PAGE_PRESETS)[number]["value"];
type PageUnit = "mm" | "in" | "px";
const PX_PER_INCH = 96;
const pxToUnit = (px: number, unit: PageUnit) =>
  unit === "mm" ? (px * 25.4) / PX_PER_INCH : unit === "in" ? px / PX_PER_INCH : px;
const unitToPx = (value: number, unit: PageUnit) =>
  unit === "mm" ? (value * PX_PER_INCH) / 25.4 : unit === "in" ? value * PX_PER_INCH : value;

function PageSettingsDialog({
  document,
  onApply,
  onClose,
}: {
  document: { width: number; height: number };
  onApply: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const [widthPx, setWidthPx] = useState(document.width);
  const [heightPx, setHeightPx] = useState(document.height);
  const [unit, setUnit] = useState<PageUnit>("mm");
  const [preset, setPreset] = useState<PagePreset>("custom");
  const setPresetSize = (next: PagePreset) => {
    setPreset(next);
    const sizes: Partial<Record<PagePreset, [number, number]>> = {
      a4: [794, 1123],
      letter: [816, 1056],
      receipt58: [219, 1200],
      receipt80: [302, 1600],
    };
    const size = sizes[next];
    if (size) {
      setWidthPx(size[0]);
      setHeightPx(size[1]);
    }
  };
  const width = pxToUnit(widthPx, unit);
  const height = pxToUnit(heightPx, unit);
  const valid =
    Number.isFinite(widthPx) && Number.isFinite(heightPx) &&
    widthPx >= 100 && heightPx >= 100 && widthPx <= 20000 && heightPx <= 20000;

  return (
    <Dialog
      open
      title="Page size & layout"
      description="Dimensions use 96 px per inch. Changing page size resizes the tracing reference to the new page."
      onClose={onClose}
      width="w-[420px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply(widthPx, heightPx)}>
            Apply page size
          </Button>
        </>
      }
    >
      <Field label="Page preset">
        <Select value={preset} onChange={(v) => setPresetSize(v as PagePreset)} options={[...PAGE_PRESETS]} />
      </Field>
      <Field label="Enter dimensions in">
        <Select
          value={unit}
          onChange={(v) => setUnit(v as PageUnit)}
          options={[
            { value: "mm", label: "Millimetres" },
            { value: "in", label: "Inches" },
            { value: "px", label: "Pixels" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Width (${unit})`}>
          <NumberInput value={Math.round(width * 100) / 100} min={unit === "px" ? 100 : 25} max={unit === "px" ? 20000 : 5292} step={0.1} onChange={(v) => { setWidthPx(unitToPx(v, unit)); setPreset("custom"); }} />
        </Field>
        <Field label={`Height (${unit})`}>
          <NumberInput value={Math.round(height * 100) / 100} min={unit === "px" ? 100 : 25} max={unit === "px" ? 20000 : 5292} step={0.1} onChange={(v) => { setHeightPx(unitToPx(v, unit)); setPreset("custom"); }} />
        </Field>
      </div>
      <p className="text-[12px] text-ink-faint">
        Current page: {Math.round(widthPx)} × {Math.round(heightPx)} px. Receipt presets use a practical starter height; increase it for longer forms.
      </p>
    </Dialog>
  );
}

function TablePrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (rows: number, cols: number) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Dialog
      open
      title="Create table"
      description="Choose the grid size for the area you just drew. You can change this later."
      onClose={onCancel}
      width="w-80"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(rows, cols)}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rows">
          <NumberInput value={rows} min={1} max={60} onChange={setRows} />
        </Field>
        <Field label="Columns">
          <NumberInput value={cols} min={1} max={30} onChange={setCols} />
        </Field>
      </div>
    </Dialog>
  );
}

function GridSettingsDialog({
  controller,
  state,
  onClose,
}: {
  controller: ReturnType<typeof useEditorController>["controller"];
  state: ReturnType<typeof useEditorController>["state"];
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      title="Grid"
      description="A guide grid for tracing accurately. Snap locks objects to it."
      onClose={onClose}
      width="w-72"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <Field label="Grid size (px)">
        <NumberInput
          value={state.gridSize}
          min={2}
          max={500}
          onChange={(v) => controller.setGridSize(Math.round(v))}
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox
          label="Show grid"
          checked={state.gridVisible}
          onChange={(v) => controller.setGridVisible(v)}
        />
        <Checkbox
          label="Snap to grid"
          checked={state.snapToGrid}
          onChange={(v) => controller.setSnapEnabled(v)}
        />
        <Checkbox
          label="Snap to objects"
          checked={state.snapToObjects}
          onChange={(v) => controller.setSnapToObjects(v)}
        />
        <Checkbox
          label="Full-span rules"
          checked={state.fullSpanRules}
          onChange={(v) => controller.setFullSpanRules(v)}
        />
      </div>
      <p className="text-[12px] text-ink-faint">
        Snap rounds the top-left corner of an object to the nearest grid line
        while it is dragged.
      </p>
    </Dialog>
  );
}

```

## components/editor/CalculationsPanel.tsx

```tsx
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

```

## components/editor/CanvasStage.tsx

```tsx
"use client";

import { useEffect, useRef } from "react";

import type { EditorController } from "@/lib/canvas/EditorController";

export default function CanvasStage({
  controller,
  gridVisible,
  gridSize,
  zoom,
  documentSize,
  editingCell,
}: {
  controller: EditorController;
  gridVisible: boolean;
  gridSize: number;
  zoom: number;
  documentSize: { width: number; height: number };
  editingCell: { tableId: string; index: number } | null;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    controller.attach(el);
    return () => controller.detach();
  }, [controller]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    controller.setStageElement(stage);
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth > 0) {
        controller.setViewportSize(stage.clientWidth, stage.clientHeight);
      }
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      controller.setStageElement(null);
    };
  }, [controller]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let dragging = false;
    let last: { x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      if (!dragging || !last) return;
      controller.panBy(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    const end = () => {
      if (!dragging) return;
      dragging = false;
      last = null;
      stage.style.cursor = controller.isSpaceHeld() ? "grab" : "";
    };

    const onDown = (e: PointerEvent) => {
      const wantsPan = e.altKey || e.button === 1 || controller.isSpaceHeld();
      if (!wantsPan) return;
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      stage.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    stage.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      stage.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [controller]);

  const state = controller.getSnapshot();

  return (
    <div
      ref={stageRef}
      data-btm-stage="canvas"
      className="editor-scroll relative flex-1 overflow-hidden bg-neutral-200"
    >
      <canvas ref={canvasRef} />

      {
}
      {gridVisible ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(37,99,235,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.16) 1px, transparent 1px)",
            backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
            backgroundPosition: `${state.tx}px ${state.ty}px`,
          }}
        />
      ) : null}

      {
}
      {state.snaps.length > 0 ? (
        <div className="pointer-events-none absolute inset-0">
          {state.snaps.map((s, i) =>
            s.axis === "y" ? (
              <div
                key={`h${i}`}
                className="absolute inset-x-0"
                style={{
                  top: s.pos * state.zoom + state.ty,
                  borderTop: "1px solid rgba(37,99,235,0.6)",
                }}
              />
            ) : (
              <div
                key={`v${i}`}
                className="absolute inset-y-0"
                style={{
                  left: s.pos * state.zoom + state.tx,
                  borderLeft: "1px solid rgba(37,99,235,0.6)",
                }}
              />
            ),
          )}
        </div>
      ) : null}

      {
}
      <div
        className="pointer-events-none absolute"
        style={{
          left: state.tx,
          top: state.ty,
          width: documentSize.width * zoom,
          height: documentSize.height * zoom,
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.18), 0 12px 32px rgba(0,0,0,0.16)",
        }}
      />

      {editingCell ? (
        <CellEditor controller={controller} textareaRef={textareaRef} />
      ) : null}
    </div>
  );
}

function CellEditor({
  controller,
  textareaRef,
}: {
  controller: EditorController;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const state = controller.getSnapshot();
  const canvas = controller.getCanvas();
  const editing = state.editingCell;

  const table = editing ? controller.getTableById(editing.tableId) : null;
  if (!editing || !table) return null;

  const cols = table.columns;
  const row = Math.floor(editing.index / cols);
  const col = editing.index % cols;
  const colStart = table.colWidths.slice(0, col).reduce((a, b) => a + b, 0);
  const rowStart = table.rowHeights.slice(0, row).reduce((a, b) => a + b, 0);
  const cell = table.getCell(row, col);

  const canvasRect = canvas?.upperCanvasEl?.getBoundingClientRect();
  const projected = controller.projectToScreen({
    x: table.left ?? 0,
    y: table.top ?? 0,
  });
  const left = (canvasRect?.left ?? 0) + projected.x + (colStart + table.padding) * state.zoom;
  const top = (canvasRect?.top ?? 0) + projected.y + (rowStart + table.padding) * state.zoom;

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      value={cell.text}
      spellCheck={false}
      onChange={(e) => controller.updateCell(table, editing.index, e.target.value)}
      onBlur={() => controller.endCellEdit(table)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          controller.endCellEdit(table);
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const next = (editing.index + 1) % (table.rows * table.columns);
          controller.beginCellEdit(table, next);
        }
      }}
      className="fixed resize-none rounded-sm border-2 border-blue-600 bg-white/95 p-1 text-xs text-neutral-900 outline-none"
      style={{
        left,
        top,
        width: Math.max(24, (table.colWidths[col] ?? 0) * state.zoom - 4),
        height: Math.max(16, (table.rowHeights[row] ?? 0) * state.zoom - 2),
        fontSize: Math.max(9, cell.fontSize * state.zoom),
        textAlign: cell.textAlign,
      }}
    />
  );
}

```

## components/editor/ContextPanel.tsx

```tsx
"use client";

import { Button, Panel } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { StepId } from "@/lib/client/steps";
import { emptyTemplate } from "@/lib/template/types";

import PlaceholdersPanel from "./PlaceholdersPanel";
import ReferencePanel from "./ReferencePanel";
import PreflightPanel from "./PreflightPanel";
import CalculationsPanel from "./CalculationsPanel";

const HINTS: Record<StepId, string> = {
  bill: "This is your bill photo. Next, trace over it.",
  trace: "Draw over the paper — the photo itself is never exported.",
  mark: "Mark what changes each time: fields, variables, repeating rows.",
  test: "Fill in example values and check the printed result.",
  share: "Keep a copy on this device, or hand someone a single file.",
};

export default function ContextPanel({
  step,
  controller,
  state,
  onOpenGridSettings,
  onOpenPageSettings,
  onFillAndPrint,
  onSave,
  onShare,
}: {
  step: StepId;
  controller: EditorController;
  state: EditorState;
  onOpenGridSettings: () => void;
  onOpenPageSettings: () => void;
  onFillAndPrint: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  return (
    <>
      <p className="border-b border-rule bg-desk px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
        {HINTS[step]}
      </p>

      {step === "bill" || step === "trace" ? (
        <>
          <ReferencePanel controller={controller} state={state} />
          <GridPanel
            state={state}
            onOpenGridSettings={onOpenGridSettings}
          />
          <DocumentPanel controller={controller} state={state} onOpenPageSettings={onOpenPageSettings} />
        </>
      ) : null}

      {step === "mark" ? (
        <>
          <PlaceholdersPanel controller={controller} state={state} />
          <CalculationsPanel controller={controller} state={state} />
        </>
      ) : null}

      {step === "test" ? (
        <>
          <PreflightPanel controller={controller} />
          <Panel title="Try it out">
            <p className="text-[12px] leading-relaxed text-ink-soft">
              Fill in example values and see what the printed bill looks like.
              Nothing is kept unless you save it.
            </p>
            <Button variant="primary" size="lg" className="w-full" onClick={onFillAndPrint}>
              Fill &amp; print
            </Button>
          </Panel>
        </>
      ) : null}

      {step === "share" ? (
        <Panel title="Save & share">
          <Button variant="primary" className="w-full" onClick={onSave}>
            Save on this device
          </Button>
          <Button className="w-full" onClick={onFillAndPrint}>
            Fill &amp; print…
          </Button>
          <Button className="w-full" onClick={onShare}>
            Share as one file
          </Button>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            PDF, PNG, Word, SVG, JSON, .btpkg and HTML live under “Get a copy”
            in the top bar.
          </p>
        </Panel>
      ) : null}
    </>
  );
}

function GridPanel({
  state,
  onOpenGridSettings,
}: {
  state: EditorState;
  onOpenGridSettings: () => void;
}) {
  return (
    <Panel title="Grid">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-soft">
          {state.gridVisible ? `Visible · ${state.gridSize} px` : "Hidden"}
          {state.snapToGrid ? " · snap on" : ""}
        </span>
        <Button onClick={onOpenGridSettings}>Grid Settings…</Button>
      </div>
    </Panel>
  );
}

function DocumentPanel({
  controller,
  state,
  onOpenPageSettings,
}: {
  controller: EditorController;
  state: EditorState;
  onOpenPageSettings: () => void;
}) {
  return (
    <Panel title="Document">
      <Button
        variant="default"
        className="w-full"
        onClick={() => {
          controller.loadTemplate(emptyTemplate());
        }}
      >
        New blank document
      </Button>
      <Button className="w-full" onClick={onOpenPageSettings}>
        Page size &amp; layout…
      </Button>
      <Button
        variant={state.structureLocked ? "primary" : "default"}
        className="w-full"
        onClick={() => controller.setStructureLocked(!state.structureLocked)}
      >
        {state.structureLocked ? "Unlock structure" : "Lock structure"}
      </Button>
      <p className="text-[12px] text-ink-faint">
        {state.document.width} × {state.document.height} px
      </p>
    </Panel>
  );
}

```

## components/editor/ExportMenu.tsx

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { downloadText, safeFilename } from "@/lib/export/download";
import { exportDocx } from "@/lib/export/toDocx";
import { exportPdf } from "@/lib/export/toPdf";
import { exportPackage } from "@/lib/export/toPackage";
import { exportJson, exportPng, exportSvg } from "@/lib/export/toSvg";
import { renderHtml } from "@/lib/render";
import type { EditorController } from "@/lib/canvas/EditorController";

type ExportItem = "json" | "svg" | "pdf" | "docx" | "png" | "html" | "btpkg";

const ITEMS: Array<{ id: ExportItem; outcome: string; format: string }> = [
  { id: "pdf", outcome: "Print it", format: "PDF document" },
  { id: "png", outcome: "A picture", format: "PNG image" },
  { id: "docx", outcome: "Open in Word", format: "DOCX file" },
  { id: "svg", outcome: "Edit elsewhere", format: "SVG drawing" },
  { id: "json", outcome: "Template for an app", format: "JSON template" },
  { id: "btpkg", outcome: "Template for an app", format: "Bill package (.btpkg)" },
  { id: "html", outcome: "A web page", format: "HTML document" },
];

export default function ExportMenu({ controller }: { controller: EditorController }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (item: ExportItem) => {
    setBusy(item);
    setError(null);
    try {
      const template = controller.getTemplate();
      if (item === "btpkg") exportPackage(template);
      if (item === "json") exportJson(template);
      if (item === "svg") await exportSvg(template);
      if (item === "pdf") await exportPdf(template);
      if (item === "docx") await exportDocx(template);
      if (item === "png") await exportPng(template, 2);
      if (item === "html") {
        const result = renderHtml(template);
        downloadText(
          result.html,
          `${safeFilename(String(template.meta?.name ?? ""))}.html`,
          "text/html;charset=utf-8",
        );
      }
    } catch (e) {

      if (process.env.NODE_ENV !== "production") {
        console.error(`[bill-template-maker] ${item} export failed`, e);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        title="Download a copy of this bill"
      >
        Get a copy ▾
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-rule bg-paper shadow-lg">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(item.id)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-desk disabled:opacity-50"
            >
              <span className="text-[13px] font-medium text-ink">
                {busy === item.id ? "Working…" : item.outcome}
              </span>
              <span className="text-[12px] text-ink-faint">{item.format}</span>
              {item.id === "btpkg" ? (
                <span className="text-[11px] text-stamp">v1 only: single page, no multi-page, no OCR</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          data-export-error
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-stamp bg-stamp-wash px-3 py-2 text-[12px] text-stamp"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

```

## components/editor/LayersPanel.tsx

```tsx
"use client";

import { ActiveSelection } from "fabric";

import type {
  EditorController,
  EditorState,
  LayerEntry,
} from "@/lib/canvas/EditorController";

const TYPE_GLYPH: Record<string, string> = {
  rect: "▭",
  "rounded-rect": "▢",
  ellipse: "◯",
  line: "╱",
  hr: "―",
  vr: "│",
  polygon: "△",
  freehand: "✎",
  text: "T",
  iText: "T",
  textbox: "T",
  table: "▦",
  BillTable: "▦",
  "image-placeholder": "▧",
  BillImagePlaceholder: "▧",
  group: "▣",
};

export default function LayersPanel({
  controller,
  state,
  onSelect,
}: {
  controller: EditorController;
  state: EditorState;
  onSelect: (id: string) => void;
}) {

  const groups = controller.getGroups();
  const rows: Array<{
    key: string;
    depth: number;
    label: string;
    glyph: string;
    role: string | null;
    id: string | null;
    layer: LayerEntry | null;
  }> = [];
  const grouped = new Set<string>();
  const walk = (groupId: string, depth: number): void => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    rows.push({
      key: `g:${group.id}`,
      depth,
      label: group.name,
      glyph: TYPE_GLYPH.group ?? "▣",
      role: null,
      id: null,
      layer: null,
    });
    for (const member of group.members) {
      const child = groups.find((g) => g.id === member);
      if (child) {
        walk(child.id, depth + 1);
        continue;
      }
      const layer = state.layers.find((l) => l.id === member);
      if (!layer) continue;
      grouped.add(layer.id);
      rows.push({
        key: layer.id,
        depth: depth + 1,
        label: layer.name,
        glyph: TYPE_GLYPH[layer.type] ?? "•",
        role: layer.role,
        id: layer.id,
        layer,
      });
    }
  };
  for (const group of groups.filter((g) => g.parentId === null)) {
    walk(group.id, 0);
  }
  for (const layer of state.layers) {
    if (grouped.has(layer.id)) continue;
    if (groups.some((g) => g.members.includes(layer.id))) continue;
    rows.push({
      key: layer.id,
      depth: 0,
      label: layer.name,
      glyph: TYPE_GLYPH[layer.type] ?? "•",
      role: layer.role,
      id: layer.id,
      layer,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Layers
        </h2>
        <span className="text-[10px] text-neutral-400">{state.objectCount}</span>
      </header>

      <div className="editor-scroll flex-1 overflow-auto p-2">
        {state.hasReference ? (
          <div className="mb-1 flex items-center gap-2 rounded border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1.5">
            <span className="text-neutral-400">🖼</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
              {state.referenceName}
            </span>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-neutral-400">
            No objects yet. Pick a tool and drag on the canvas.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((row) => {
              const selected = row.id !== null && state.selection.includes(row.id);
              return (
                <li key={row.key}>
                  <div
                    className={`group flex items-center gap-1 rounded pr-1 transition-colors ${
                      selected
                        ? "bg-blue-50 ring-1 ring-blue-300"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (row.id !== null) {
                          onSelect(row.id);
                          return;
                        }

                        const canvas = controller.getCanvas();
                        const members = controller.groupObjectsOf(
                          row.key.replace(/^g:/, ""),
                        );
                        if (canvas && members.length > 0) {
                          canvas.discardActiveObject();
                          canvas.setActiveObject(
                            members.length === 1
                              ? members[0]!
                              : new ActiveSelection(members, { canvas }),
                          );
                          canvas.requestRenderAll();
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
                      style={{ paddingLeft: `${8 + row.depth * 12}px` }}
                    >
                      <span className="w-4 shrink-0 text-center text-[11px] text-neutral-400">
                        {row.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[11px] ${
                            row.id === null
                              ? "font-semibold text-neutral-600"
                              : "text-neutral-700"
                          }`}
                        >
                          {row.label}
                        </span>
                        {row.role ? (
                          <span className="block truncate font-mono text-[9px] text-neutral-400">
                            {row.role}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {row.layer ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={row.layer.visible ? "Hide" : "Show"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(row.id!);
                          if (obj) {
                            obj.set({ visible: !obj.visible } as never);
                            obj.setCoords();
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle visibility");
                            onSelect(row.id!);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {row.layer.visible ? "◉" : "○"}
                      </button>
                      <button
                        type="button"
                        title={row.layer.locked ? "Unlock" : "Lock"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const obj = controller.getObjectById(row.id!);
                          if (obj) {
                            const next = !row.layer!.locked;
                            obj.set({
                              locked: next,
                              selectable: !next,
                              evented: !next,
                            } as never);
                            controller.getCanvas()?.requestRenderAll();
                            controller.commit("Toggle lock");
                            onSelect(row.id!);
                          }
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        {row.layer.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        title="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.moveLayer(row.id!, "up");
                          onSelect(row.id!);
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.moveLayer(row.id!, "down");
                          onSelect(row.id!);
                        }}
                        className="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200"
                      >
                        ↓
                      </button>
                    </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

```

## components/editor/LayoutPanel.tsx

```tsx
"use client";

import { Checkbox, Field, NumberInput, Section, Select } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { setGuideCap } from "@/lib/canvas/guides";
import type {
  AnchorRule,
  AttachmentBehavior,
  AttachmentEdge,
  ChildAnchor,
  CollisionPolicy,
  ContainerGrowth,
  ContainerPolicy,
  DocumentGrowth,
  GrowthMode,
  LayoutGuide,
  ObjectExpansion,
  TemplateObject,
  TextWrapPolicy,
} from "@/lib/template/types";

const GROWTH_OPTIONS: { value: GrowthMode; label: string }[] = [
  { value: "fixed", label: "Keep the size" },
  { value: "unbounded", label: "Grow if needed" },
  { value: "bounded", label: "Grow, up to a limit" },
];

const EDGE_OPTIONS: { value: AttachmentEdge; label: string }[] = [
  { value: "top", label: "What the top edge follows" },
  { value: "bottom", label: "What the bottom edge follows" },
  { value: "left", label: "What the left edge follows" },
  { value: "right", label: "What the right edge follows" },
];

const STRATEGY_OPTIONS: { value: TextWrapPolicy; label: string }[] = [
  { value: "wrap", label: "Let it wrap" },
  { value: "noWrap", label: "Keep on one line" },
];

const BEHAVIOR_OPTIONS: { value: AttachmentBehavior; label: string }[] = [
  { value: "move", label: "Follow along without changing size" },
  { value: "stretch", label: "Stretch to keep touching" },
];

const DOCUMENT_GROWTH_OPTIONS: { value: DocumentGrowth; label: string }[] = [
  { value: "fixed", label: "Keep the paper size" },
  { value: "expand", label: "Let the page grow" },
];

const anchorOptions = (
  axis: "horizontal" | "vertical",
): { value: AnchorRule; label: string }[] => [
  {
    value: "start",
    label: axis === "horizontal" ? "Keep the left edge" : "Keep the top edge",
  },
  {
    value: "end",
    label: axis === "horizontal" ? "Keep the right edge" : "Keep the bottom edge",
  },
  { value: "stretch", label: "Stretch with the frame" },
];

const CONTAINER_GROWTH_OPTIONS: { value: ContainerGrowth; label: string }[] = [
  { value: "content", label: "Around its contents" },
  { value: "fixed", label: "Keep the same size" },
];

const COLLISION_OPTIONS: { value: CollisionPolicy; label: string }[] = [
  { value: "report", label: "Warn me" },
  { value: "allow", label: "Leave it" },
];

function isContainerShape(type: TemplateObject["type"]): boolean {
  return type === "rect" || type === "rounded-rect" || type === "ellipse";
}

function HierarchySection({
  controller,
  objectId,
  objectType,
  layoutParentId,
  anchor,
  container,
  parents,
}: {
  controller: EditorController;
  objectId: string;
  objectType: TemplateObject["type"];
  layoutParentId?: string | null;
  anchor?: ChildAnchor;
  container?: ContainerPolicy;
  parents: { id: string; name: string }[];
}) {
  const choices = parents.filter((p) => p.id !== objectId);
  const enabled = container?.enabled === true;
  const withPolicy = (patch: Partial<ContainerPolicy>): ContainerPolicy => ({
    enabled: true,
    growthX: container?.growthX ?? "content",
    growthY: container?.growthY ?? "content",
    ...(container?.padding !== undefined ? { padding: container.padding } : {}),
    ...(container?.minWidth !== undefined ? { minWidth: container.minWidth } : {}),
    ...(container?.minHeight !== undefined ? { minHeight: container.minHeight } : {}),
    ...(container?.maxWidth !== undefined ? { maxWidth: container.maxWidth } : {}),
    ...(container?.maxHeight !== undefined ? { maxHeight: container.maxHeight } : {}),
    ...patch,
  });
  const setAnchorAxis = (axis: "horizontal" | "vertical", value: AnchorRule) => {
    controller.setAnchor(objectId, { ...anchor, [axis]: value }, "Anchor");
  };
  const setGrowth = (axis: "growthX" | "growthY", value: ContainerGrowth) => {
    controller.setContainer(objectId, withPolicy({ [axis]: value }), "Container");
  };

  const optionalSize = (v: number): number | undefined =>
    Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  const setSize = (key: "minWidth" | "minHeight" | "maxWidth" | "maxHeight", v: number, label: string) => {
    const value = optionalSize(v);
    const next = { ...container };
    if (value === undefined) delete next[key];
    else next[key] = value;
    controller.setContainer(objectId, withPolicy(next), label);
  };
  const setPadding = (side: "top" | "right" | "bottom" | "left", v: number) => {
    const current = container?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    controller.setContainer(
      objectId,
      withPolicy({ padding: { ...current, [side]: Math.max(0, Math.round(Number.isFinite(v) ? v : 0)) } }),
      "Container padding",
    );
  };

  return (
    <Section id="frame" title="Inside its frame">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        A frame holds the objects you add to it &mdash; being near it is not
        enough.
      </p>
      <Field label="Which frame holds it" hint="This is separate from grouping.">
        <Select
          value={layoutParentId ?? ""}
          options={[
            { value: "", label: "Not in a frame" },
            ...choices.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` })),
          ]}
          onChange={(v) => controller.setLayoutParent(objectId, v || null, "Which frame holds it")}
        />
      </Field>
      {layoutParentId ? (
        <>
          <Field label="Horizontal anchor">
            <Select
              value={anchor?.horizontal ?? "start"}
              options={anchorOptions("horizontal")}
              onChange={(v) => setAnchorAxis("horizontal", v as AnchorRule)}
            />
          </Field>
          <Field label="Vertical anchor">
            <Select
              value={anchor?.vertical ?? "start"}
              options={anchorOptions("vertical")}
              onChange={(v) => setAnchorAxis("vertical", v as AnchorRule)}
            />
          </Field>
        </>
      ) : null}
      {isContainerShape(objectType) ? (
        <>
          <Checkbox
            label="Shrink-wrap the frame around its contents"
            checked={enabled}
            onChange={(v) =>
              v
                ? controller.setContainer(objectId, withPolicy({}), "Container")
                : controller.setContainer(objectId, undefined, "Container")
            }
          />
          {enabled ? (
            <>
              <Field label="Horizontal container">
                <Select
                  value={container?.growthX ?? "content"}
                  options={CONTAINER_GROWTH_OPTIONS}
                  onChange={(v) => setGrowth("growthX", v as ContainerGrowth)}
                />
              </Field>
              <Field label="Vertical container">
                <Select
                  value={container?.growthY ?? "content"}
                  options={CONTAINER_GROWTH_OPTIONS}
                  onChange={(v) => setGrowth("growthY", v as ContainerGrowth)}
                />
              </Field>
              <div className="space-y-1 border-t border-neutral-100 pt-2">
                <p className="text-[11px] font-medium text-neutral-600">
                  Space kept inside the frame (px)
                </p>
                <p className="text-[12px] text-neutral-400">
                  The gap the frame keeps around its contents when it grows. At
                  0, a child can reach the frame&apos;s own edge.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["top", "right", "bottom", "left"] as const).map((side) => (
                    <Field key={side} label={side[0]!.toUpperCase() + side.slice(1)}>
                      <NumberInput
                        value={container?.padding?.[side] ?? 0}
                        min={0}
                        onChange={(v) => setPadding(side, v)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
              <div className="space-y-1 border-t border-neutral-100 pt-2">
                <p className="text-[11px] font-medium text-neutral-600">
                  Smallest / largest size (px)
                </p>
                <p className="text-[12px] text-neutral-400">
                  Blank means no limit. A frame that stops at its largest size
                  reports the child that no longer fits.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Smallest width">
                    <NumberInput
                      value={container?.minWidth ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("minWidth", v, "Container minimum")}
                    />
                  </Field>
                  <Field label="Smallest height">
                    <NumberInput
                      value={container?.minHeight ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("minHeight", v, "Container minimum")}
                    />
                  </Field>
                  <Field label="Largest width">
                    <NumberInput
                      value={container?.maxWidth ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("maxWidth", v, "Container maximum")}
                    />
                  </Field>
                  <Field label="Largest height">
                    <NumberInput
                      value={container?.maxHeight ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("maxHeight", v, "Container maximum")}
                    />
                  </Field>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

function edgesFor(guides: readonly LayoutGuide[]): AttachmentEdge[] {
  const hasVertical = guides.some((g) => g.orientation === "vertical");
  const hasHorizontal = guides.some((g) => g.orientation === "horizontal");
  if (!hasVertical && !hasHorizontal) return [];
  return EDGE_OPTIONS.filter((e) =>
    e.value === "left" || e.value === "right"
      ? hasVertical
      : hasHorizontal,
  ).map((e) => e.value);
}

function ExpansionSection({
  controller,
  objectId,
  expansion,
  guides,
}: {
  controller: EditorController;
  objectId: string;
  expansion?: ObjectExpansion;
  guides: readonly LayoutGuide[];
}) {
  const setAxis = (axis: "x" | "y", mode: GrowthMode) => {
    const current = expansion ?? { x: { mode: "fixed" }, y: { mode: "fixed" } };
    const next: ObjectExpansion = { ...current, [axis]: { ...current[axis], mode } };

    if (mode === "fixed") {
      next[axis] = { mode: "fixed" };
    }
    controller.setExpansion(objectId, next, "Expansion");
  };

  const setCap = (axis: "x" | "y", value: number | null) => {
    const current = expansion ?? { x: { mode: "fixed" }, y: { mode: "fixed" } };
    const piece = { ...current[axis] };
    if (value === null || !Number.isFinite(value)) delete piece.maxGrowth;
    else piece.maxGrowth = value;
    controller.setExpansion(objectId, { ...current, [axis]: piece }, "Expansion limit");
  };

  const setStrategy = (axis: "x" | "y", strategy: TextWrapPolicy | undefined) => {
    const current = expansion ?? { x: { mode: "fixed" }, y: { mode: "fixed" } };
    const piece = { ...current[axis] };
    if (strategy === undefined) delete piece.strategy;
    else piece.strategy = strategy;
    controller.setExpansion(objectId, { ...current, [axis]: piece }, "Wrap policy");
  };

  const setGrowthGuide = (axis: "x" | "y", guideId: string | null) => {
    const current = expansion ?? { x: { mode: "fixed" }, y: { mode: "fixed" } };
    const piece = { ...current[axis] };
    if (guideId === null) delete piece.growthGuideId;
    else piece.growthGuideId = guideId;
    controller.setExpansion(objectId, { ...current, [axis]: piece }, "Growth guide");
  };

  const growthGuidesFor = (axis: "x" | "y") => {

    const want = axis === "y" ? "horizontal" : "vertical";
    return guides.filter((g) => g.orientation === want);
  };

  const axisRow = (axis: "x" | "y", label: string) => {
    const mode = expansion?.[axis]?.mode ?? "fixed";
    const strategy = expansion?.[axis]?.strategy;
    const growthGuideId = expansion?.[axis]?.growthGuideId ?? "";
    const growthGuides = growthGuidesFor(axis);
    return (
      <div key={axis} className="space-y-1">
        <Field label={`${label} growth`}>
          <Select
            value={mode}
            options={GROWTH_OPTIONS}
            onChange={(v) => setAxis(axis, v as GrowthMode)}
          />
        </Field>
        {mode === "bounded" ? (
          <Field label="Stop growing after (px)">
            <NumberInput
              value={expansion?.[axis]?.maxGrowth ?? 0}
              onChange={(v) => setCap(axis, v)}
            />
          </Field>
        ) : null}
        {mode !== "fixed" ? (
          <>
            <Field
              label="Text layout"
              hint={
                axis === "y"
                  ? "Wrap grows the box downward; one line keeps its height."
                  : "One line lets the box widen; wrap still reflows first."
              }
            >
              <Select
                value={strategy ?? ""}
                options={[
                  { value: "", label: "Automatic" },
                  ...STRATEGY_OPTIONS,
                ]}
                onChange={(v) =>
                  setStrategy(axis, (v || undefined) as TextWrapPolicy | undefined)
                }
              />
            </Field>
            {growthGuides.length > 0 ? (
              <Field
                label="Which line moves with it"
                hint="When this side outgrows its box, the chosen boundary moves with it."
              >
                <Select
                  value={growthGuideId}
                  options={[
                    { value: "", label: "No guide — grow in place" },
                    ...growthGuides.map((g) => ({
                      value: g.id,
                      label: `${g.id} (${Math.round(g.position)}px)`,
                    })),
                  ]}
                  onChange={(v) => setGrowthGuide(axis, v || null)}
                />
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <Section id="growth" title="When data is longer">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Lets this object take more room when a value is longer than the space
        traced for it.
      </p>
      {axisRow("y", "Vertical")}
      {axisRow("x", "Horizontal")}
    </Section>
  );
}

function AttachSection({
  controller,
  objectId,
  guides,
  attachments,
}: {
  controller: EditorController;
  objectId: string;
  guides: readonly LayoutGuide[];
  attachments: readonly {
    objectId: string;
    edge: AttachmentEdge;
    guideId: string;
    behavior?: AttachmentBehavior;
  }[];
}) {
  const edges = edgesFor(guides);
  if (guides.length === 0) return null;

  const guideFor = (edge: AttachmentEdge) =>
    attachments.find((a) => a.objectId === objectId && a.edge === edge)?.guideId ?? "";

  const behaviorFor = (edge: AttachmentEdge): AttachmentBehavior =>
    attachments.find((a) => a.objectId === objectId && a.edge === edge)?.behavior ??
    "move";

  const guideOptions = (edge: AttachmentEdge) => [
    { value: "", label: "Not attached" },
    ...guides
      .filter(
        (g) =>
          (edge === "left" || edge === "right")
            ? g.orientation === "vertical"
            : g.orientation === "horizontal",
      )
      .map((g) => ({
        value: g.id,
        label: `${g.id} (${Math.round(g.position)}px)`,
      })),
  ];

  return (
    <Section id="follows" title="What moves with this">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Each edge can follow a line. Following along keeps the size; stretching
        holds the opposite edge where it is.
      </p>
      {edges.map((edge) => {
        const attached = guideFor(edge) !== "";
        return (
          <div key={edge} className="space-y-1">
            <Field label={EDGE_OPTIONS.find((e) => e.value === edge)?.label ?? edge}>
              <Select
                value={guideFor(edge)}
                options={guideOptions(edge)}
                onChange={(v) =>
                  controller.setAttachment(
                    objectId,
                    edge,
                    v || null,
                    behaviorFor(edge),
                  )
                }
              />
            </Field>
            {attached ? (
              <Field label="How it follows">
                <Select
                  value={behaviorFor(edge)}
                  options={BEHAVIOR_OPTIONS}
                  onChange={(v) =>
                    controller.setAttachment(
                      objectId,
                      edge,
                      guideFor(edge) || null,
                      v as AttachmentBehavior,
                    )
                  }
                />
              </Field>
            ) : null}
          </div>
        );
      })}
    </Section>
  );
}

function GuidesSection({
  controller,
  guides,
  documentHeight,
}: {
  controller: EditorController;
  guides: readonly LayoutGuide[];
  documentHeight: number;
}) {
  if (guides.length === 0) return null;
  return (
    <Section id="guides" title={`Guide lines (${guides.length})`}>
      {guides.map((g) => (
        <div
          key={g.id}
          className="flex items-end gap-2 border-b border-neutral-100 py-1 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-neutral-700">
              {g.id} · {g.orientation === "horizontal" ? "horizontal" : "vertical"} @{" "}
              {Math.round(g.position)}px
            </p>
            <Field label="How far this line can move">
              <NumberInput
                value={g.maxDisplacement ?? 0}
                onChange={(v) =>
                  controller.updateLayout(
                    (layout) => ({
                      ...(layout ?? { mode: "variable" as const }),
                      guides: setGuideCap(layout?.guides ?? [], g.id, v),
                    }),
                    "Guide limit",
                  )
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <p className="text-[12px] text-neutral-400">
        Page is {Math.round(documentHeight)}px tall. Select a guide and press
        Delete to remove it.
      </p>
    </Section>
  );
}

function DocumentSection({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const doc = state.layout?.document;

  const growthX = doc?.growthX ?? "fixed";
  const growthY = doc?.growthY ?? "fixed";

  const setDoc = (
    patch: Partial<{ growthX: DocumentGrowth; growthY: DocumentGrowth }>,
    label: string,
  ) => {
    controller.updateLayout((layout) => {

      if (!layout && Object.keys(patch).length === 0) return undefined;
      const nextDoc = { growthX, growthY, ...doc, ...patch };
      const base = layout ?? { mode: "variable" as const };
      const withDoc = { ...base, document: nextDoc };
      const guides = withDoc.guides ?? [];
      const attachments = withDoc.attachments ?? [];
      if (guides.length === 0 && attachments.length === 0) {
        const fixed =
          nextDoc.growthX === "fixed" &&
          nextDoc.growthY === "fixed" &&
          nextDoc.maxWidth === undefined &&
          nextDoc.maxHeight === undefined;
        if (fixed) return undefined;
      }
      return withDoc;
    }, label);
  };

  const setCap = (side: "maxWidth" | "maxHeight", value: number | null) => {
    controller.updateLayout((layout) => {
      const base = layout ?? { mode: "variable" as const };
      const current = base.document ?? { growthX, growthY };
      const nextDoc: typeof current & { maxWidth?: number; maxHeight?: number } = {
        ...current,
      };
      if (value === null || !Number.isFinite(value) || value <= 0) {
        delete nextDoc[side];
      } else {
        nextDoc[side] = value;
      }
      return { ...base, document: nextDoc };
    }, "Page limit");
  };

  const setCollision = (value: CollisionPolicy) => {
    controller.updateLayout((layout) => {
      const base = layout ?? { mode: "variable" as const };
      return { ...base, collision: value };
    }, "Collision policy");
  };

  const hasLayout = state.layout !== undefined;
  const hasGrowth =
    growthX !== "fixed" || growthY !== "fixed" || doc?.maxWidth !== undefined || doc?.maxHeight !== undefined;
  if (!hasLayout && !hasGrowth) return null;

  return (
    <Section id="page" title="The page">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        Keeping the paper size keeps the traced sheet and reports anything that
        spills. Letting the page grow follows the content.
      </p>
      <Field label="Horizontal page">
        <Select
          value={growthX}
          options={DOCUMENT_GROWTH_OPTIONS}
          onChange={(v) => setDoc({ growthX: v as DocumentGrowth }, "Page growth")}
        />
      </Field>
      <Field label="Vertical page">
        <Select
          value={growthY}
          options={DOCUMENT_GROWTH_OPTIONS}
          onChange={(v) => setDoc({ growthY: v as DocumentGrowth }, "Page growth")}
        />
      </Field>
      <Field label="Largest page width" hint="Leave blank for no limit.">
        <NumberInput
          value={doc?.maxWidth ?? Number.NaN}
          onChange={(v) =>
            setCap("maxWidth", !Number.isFinite(v) || v <= 0 ? null : v)
          }
        />
      </Field>
      <Field label="Largest page height" hint="Leave blank for no limit.">
        <NumberInput
          value={doc?.maxHeight ?? Number.NaN}
          onChange={(v) =>
            setCap("maxHeight", !Number.isFinite(v) || v <= 0 ? null : v)
          }
        />
      </Field>
      <Field label="If objects overlap" hint="Warn me keeps the layout and warns; Leave it stays quiet.">
        <Select
          value={state.layout?.collision ?? "report"}
          options={COLLISION_OPTIONS}
          onChange={(v) => setCollision(v as CollisionPolicy)}
        />
      </Field>
    </Section>
  );
}

export default function LayoutPanels({
  controller,
  state,
  objectId,
  expansion,
  objectType,
  layoutParentId,
  anchor,
  container,
  parents,
}: {
  controller: EditorController;
  state: EditorState;

  objectId: string;
  expansion?: ObjectExpansion;
  objectType?: TemplateObject["type"];
  layoutParentId?: string | null;
  anchor?: ChildAnchor;
  container?: ContainerPolicy;
  parents?: { id: string; name: string }[];
}) {
  const layout = state.layout;
  const guides = layout?.guides ?? [];
  const attachments = layout?.attachments ?? [];

  return (
    <>
      {objectId ? (
        <>
          <ExpansionSection
            controller={controller}
            objectId={objectId}
            expansion={expansion}
            guides={guides}
          />
          <AttachSection
            controller={controller}
            objectId={objectId}
            guides={guides}
            attachments={attachments}
          />
          <HierarchySection
            controller={controller}
            objectId={objectId}
            objectType={objectType ?? "rect"}
            layoutParentId={layoutParentId}
            anchor={anchor}
            container={container}
            parents={parents ?? []}
          />
        </>
      ) : null}
      <DocumentSection controller={controller} state={state} />
      <GuidesSection
        controller={controller}
        guides={guides}
        documentHeight={state.document.height}
      />
    </>
  );
}
```

## components/editor/OpenMenu.tsx

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { listTemplates, loadTemplate } from "@/lib/client/templateStore";
import type { BillTemplate } from "@/lib/template/types";

export default function OpenMenu({
  onOpenFile,
  onPickSaved,
}: {
  onOpenFile: () => void;
  onPickSaved: (t: BillTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const saved = open ? listTemplates().slice(0, 5) : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        title="Open a template saved on this device, or a .json file"
      >
        Open…
      </Button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-rule bg-paper shadow-lg">
          <p className="border-b border-rule px-3 py-2 text-[12px] font-medium text-ink-soft">
            Saved on this device
          </p>
          {saved.length === 0 ? (
            <p className="px-3 py-2 text-[12px] leading-relaxed text-ink-faint">
              Nothing saved yet — Save puts a copy here.
            </p>
          ) : (
            saved.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setOpen(false);
                  const loaded = loadTemplate(t.name);
                  if (loaded) onPickSaved(loaded);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-desk"
              >
                <span className="text-[13px] font-medium text-ink">{t.name}</span>
                <span className="text-[12px] text-ink-faint">
                  {new Date(t.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenFile();
            }}
            className="w-full border-t border-rule px-3 py-2 text-left text-[13px] font-medium text-ink hover:bg-desk"
          >
            Open a file…
          </button>
        </div>
      ) : null}
    </div>
  );
}

```

## components/editor/PlaceholdersPanel.tsx

```tsx
﻿"use client";

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

```

## components/editor/PreflightPanel.tsx

```tsx
"use client";

import { useState } from "react";

import { Button, Dialog, Panel } from "@/components/ui/Controls";
import { measureDom } from "@/lib/billkit/measure-dom";
import { measureBridge } from "@/lib/billkit/bridge";
import type { EditorController } from "@/lib/canvas/EditorController";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { preflightTemplate, sampleValuesForTemplate, type TemplatePreflightIssue } from "@/lib/template/preflight";
import { renderHtml } from "@/lib/render";

interface PrintPreview {
  html: string;
  width: number;
  height: number;
}

export default function PreflightPanel({
  controller,
}: {
  controller: EditorController;
}) {
  const [sampleCheck, setSampleCheck] = useState<{ template: string; issues: TemplatePreflightIssue[] } | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);
  const template = controller.getTemplate();
  const templateKey = JSON.stringify({
    ...template,
    meta: { ...template.meta, modifiedAt: "" },
  });
  const sampleIssues = sampleCheck?.template === templateKey ? sampleCheck.issues : null;
  let issues: TemplatePreflightIssue[];
  try {
    issues = preflightTemplate(template);
  } catch (error) {
    issues = [{ severity: "error", message: error instanceof Error ? error.message : "Could not inspect the template." }];
  }

  const runSampleCheck = (maxRepeatItems = false) => {
    try {
      const values = sampleValuesForTemplate(template, { maxRepeatItems });
      const computed = computedSpecsFor(template);
      const plan = measureBridge(JSON.stringify(template), JSON.stringify(values), JSON.stringify(computed));
      const measurements = measureDom(plan);
      const remeasure = (id: string, width: number) => {
        const request = plan.find((candidate) => candidate.id === id);
        return request ? measureDom([{ ...request, width }])[id] : undefined;
      };
      setSampleCheck({
        template: templateKey,
        issues: preflightTemplate(template, { sampleValues: values, measurements, remeasure, maxRepeatItems }),
      });
    } catch (error) {
      setSampleCheck({
        template: templateKey,
        issues: [{
          severity: "error",
          message: error instanceof Error ? error.message : "Could not check sample values.",
        }],
      });
    }
  };

  const openPrintPreview = () => {
    try {
      const values = sampleValuesForTemplate(template);
      const computed = computedSpecsFor(template);
      const plan = measureBridge(JSON.stringify(template), JSON.stringify(values), JSON.stringify(computed));
      const measurements = measureDom(plan);
      const remeasure = (id: string, width: number) => {
        const request = plan.find((candidate) => candidate.id === id);
        return request ? measureDom([{ ...request, width }])[id] : undefined;
      };
      const rendered = renderHtml(template, values, {
        placeholders: "hide",
        computed,
        measurements,
        remeasure,
      });
      setPrintPreview({ html: rendered.html, width: rendered.page.width, height: rendered.page.height });
    } catch (error) {
      setSampleCheck({
        template: templateKey,
        issues: [{ severity: "error", message: error instanceof Error ? error.message : "Could not prepare the print preview." }],
      });
    }
  };

  const shownIssues = sampleIssues ?? issues;

  return (
    <Panel title="Before you fill it in">
      <Button onClick={runSampleCheck}>
        {sampleIssues ? "Run sample check again" : "Check with sample values"}
      </Button>
      <Button className="mt-1 w-full" onClick={() => runSampleCheck(true)}>
        Check maximum repeat rows
      </Button>
      <Button className="mt-1 w-full" onClick={openPrintPreview}>Preview printed page</Button>
      {shownIssues.length === 0 ? (
        <p className="text-[12px] text-green-800">No template issues found.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Template preflight results">
          {shownIssues.map((issue, index) => (
            <li key={`${issue.message}-${index}`} className="text-[12px] leading-relaxed">
              <span className={issue.severity === "error" ? "font-semibold text-red-700" : "text-amber-800"}>
                {issue.severity === "error" ? "Fix: " : "Check: "}{issue.message}
              </span>
              {issue.objectId || issue.guideId ? (
                <Button
                  className="ml-1"
                  onClick={() => {
                    if (issue.guideId) {
                      controller.selectGuide(issue.guideId);
                      return;
                    }
                    const object = controller.getObjectById(issue.objectId!);
                    const canvas = controller.getCanvas();
                    if (object && canvas) {
                      canvas.setActiveObject(object);
                      canvas.requestRenderAll();
                      controller.refresh();
                    }
                  }}
                >
                  {issue.guideId ? "Select guide" : "Select"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-ink-faint">
        Sample checks use long answers and three representative repeat rows, measured with this browser’s fonts.
      </p>
      {printPreview ? (
        <Dialog open title="Print preview" description={`Rendered page: ${Math.round(printPreview.width)} × ${Math.round(printPreview.height)} px`} onClose={() => setPrintPreview(null)} width="w-[min(90vw,900px)]">
          <iframe title="Rendered print preview" sandbox="allow-same-origin" srcDoc={printPreview.html} className="h-[70vh] w-full rounded border border-rule bg-white" />
        </Dialog>
      ) : null}
    </Panel>
  );
}

```

## components/editor/PropertiesPanel.tsx

```tsx
"use client";

import { useState } from "react";

import type { FabricObject } from "fabric";

import {
  Button,
  Checkbox,
  Chip,
  ColorInput,
  Field,
  IndexNav,
  NumberInput,
  Section,
  Select,
  TextInput,
} from "@/components/ui/Controls";
import { BillTable } from "@/lib/canvas/objects/BillTable";
import LayoutPanels from "@/components/editor/LayoutPanel";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import {
  acceptsSharedPaint,
  sharedSelection,
} from "@/lib/canvas/sharedSelection";
import { SUGGESTED_VARIABLES, toToken } from "@/lib/template/placeholders";
import type {
  ChildAnchor,
  ContainerPolicy,
  ObjectExpansion,
  TemplateObject,
} from "@/lib/template/types";

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

const FONT_OPTIONS = FONTS.map((f) => ({
  ...f,
  style: { fontFamily: f.value },
}));

const ROLE_CHIPS = ["header", "title", "item", "total", "footer"] as const;

function BoldItalicButtons({
  bold,
  italic,
  onToggleBold,
  onToggleItalic,
}: {
  bold: boolean;
  italic: boolean;
  onToggleBold: () => void;
  onToggleItalic: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-ink-soft">
        Bold &amp; italic
      </span>
      <div className="flex gap-1">
        <Button
          className="w-10 font-bold"
          label="Bold"
          title="Bold"
          pressed={bold}
          variant={bold ? "primary" : "default"}
          onClick={onToggleBold}
        >
          B
        </Button>
        <Button
          className="w-10 italic"
          label="Italic"
          title="Italic"
          pressed={italic}
          variant={italic ? "primary" : "default"}
          onClick={onToggleItalic}
        >
          I
        </Button>
      </div>
    </div>
  );
}

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
      <Section id="properties" title="Properties">
        <p className="text-[12px] leading-relaxed text-ink-soft">
          Nothing selected yet. Click an object on the paper to change how it
          looks.
        </p>
      </Section>
    );
  }
  if (selected.length > 1) {
    return (
      <MultiSelectPanel controller={controller} state={state} selected={selected} />
    );
  }
  const object = selected[0]!;

  return (
    <SinglePanel
      key={object.id}
      controller={controller}
      state={state}
      object={object}
    />
  );
}

const ALIGN_BUTTONS = [
  ["left", "Align left", "⇤ Left"],
  ["center", "Align centre", "⇔ Centre"],
  ["right", "Align right", "⇥ Right"],
  ["top", "Align top", "⤒ Top"],
  ["middle", "Align middle", "⇕ Middle"],
  ["bottom", "Align bottom", "⤓ Bottom"],
] as const;

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

  const guides = state.layout?.guides ?? [];
  const doc = state.layout?.document;
  const hasGrowth =
    (doc?.growthX ?? "fixed") !== "fixed" ||
    (doc?.growthY ?? "fixed") !== "fixed" ||
    doc?.maxWidth !== undefined ||
    doc?.maxHeight !== undefined;
  const sections = [
    { id: "object", label: "This object" },
    { id: "size", label: "Size & position" },
    { id: "ink", label: "Ink & outline" },
    ...(o.type === "text" ? [{ id: "text", label: "Text" }] : []),
    ...(o.type === "table" ? [{ id: "table", label: "Table" }] : []),
    ...(o.type === "image-placeholder"
      ? [{ id: "slot", label: "Picture slot" }]
      : []),
    ...(o.type === "field" ? [{ id: "data-field", label: "Data field" }] : []),
    ...(o.type === "bill-part" ? [{ id: "cut-out", label: "Cut-out picture" }] : []),
    { id: "lineup", label: "Line up" },
    { id: "growth", label: "When data is longer" },
    ...(guides.length > 0
      ? [{ id: "follows", label: "What moves with this" }]
      : []),
    { id: "frame", label: "Inside its frame" },
    ...(state.layout !== undefined || hasGrowth
      ? [{ id: "page", label: "The page" }]
      : []),
    ...(guides.length > 0
      ? [{ id: "guides", label: `Guide lines (${guides.length})` }]
      : []),
  ];

  return (
    <>
      <IndexNav sections={sections} />
      <Section id="object" title="This object">
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
        <div className="space-y-1">
          <span className="block text-[12px] font-medium text-ink-soft">
            What this is
          </span>
          <div className="flex flex-wrap gap-1">
            {ROLE_CHIPS.map((r) => (
              <Chip
                key={r}
                label={r[0]!.toUpperCase() + r.slice(1)}
                selected={role.trim().toLowerCase() === r}
                onClick={() => {
                  const next = role.trim().toLowerCase() === r ? "" : r;
                  setRole(next);
                  apply((obj) => obj.set({ role: next || null } as never), "Set role");
                }}
              />
            ))}
          </div>
          <TextInput
            value={role}
            placeholder="Or type your own, e.g. items"
            onChange={(e) => setRole(e.target.value)}
            onBlur={() => {
              if (role !== (o.role ?? "")) {
                apply((obj) => obj.set({ role: role || null } as never), "Set role");
              }
            }}
          />
          <span className="block text-[12px] text-ink-faint">
            Used when a value fills this object in.
          </span>
        </div>
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
      </Section>

      <Section id="size" title="Size & position">
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
      </Section>

      <Section id="ink" title="Ink & outline">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Line colour">
            <ColorInput
              value={o.stroke}
              onChange={(v) => apply((obj) => obj.set({ stroke: v } as never), "Stroke")}
            />
          </Field>
          <Field label="Line thickness">
            <NumberInput
              value={o.strokeWidth}
              step={0.5}
              min={0}
              onChange={(v) => apply((obj) => obj.set({ strokeWidth: v } as never), "Stroke")}
            />
          </Field>
        </div>
        <Field label="Fill colour">
          <ColorInput
            value={o.fill}
            onChange={(v) => apply((obj) => obj.set({ fill: v } as never), "Fill")}
          />
        </Field>
      </Section>

      {o.type === "text" ? <TextPanel controller={controller} o={o} /> : null}
      {o.type === "table" ? <TablePanel controller={controller} state={state} o={o} /> : null}
      {o.type === "image-placeholder" ? <PlaceholderPanel controller={controller} o={o} /> : null}
      {o.type === "field" ? <FieldPanel controller={controller} o={o} /> : null}
      {o.type === "bill-part" ? (
        <Section id="cut-out" title="Cut-out picture">
          <Checkbox
            label="Clean the paper to white"
            checked={o.normalized === true}
            disabled={!state.hasReference}
            onChange={(v) => controller.recaptureBillPart(o.id, v)}
          />
          <p className="text-[12px] leading-relaxed text-ink-faint">
            The check re-cuts the picture from the paper with the paper cleaned
            to white. Taking it again always uses where the cut-out sits now and
            keeps this setting.
          </p>
          <Button
            onClick={() => controller.recaptureBillPart(o.id)}
            disabled={!state.hasReference}
          >
            Take it again from the photo
          </Button>
        </Section>
      ) : null}

      <Section id="lineup" title="Line up">
        <div className="grid grid-cols-3 gap-1">
          {ALIGN_BUTTONS.map(([k, t, word]) => (
            <Button key={k} title={t} onClick={() => controller.align(k)}>
              {word}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={() => controller.distribute("horizontal")}>
            Space evenly (H)
          </Button>
          <Button onClick={() => controller.distribute("vertical")}>
            Space evenly (V)
          </Button>
        </div>
      </Section>

      <LayoutPanels
        controller={controller}
        state={state}
        objectId={o.id}
        expansion={
          (o as unknown as { expansion?: ObjectExpansion }).expansion
        }
        objectType={o.type}
        layoutParentId={
          (o as unknown as { layoutParentId?: string | null }).layoutParentId ?? null
        }
        anchor={(o as unknown as { anchor?: ChildAnchor }).anchor}
        container={(o as unknown as { container?: ContainerPolicy }).container}
        parents={controller.listLayoutParents(o.id)}
      />

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

  const isWrapped = (o as unknown as { wrapWidth?: number }).wrapWidth !== undefined;

  const apply = (fn: (obj: FabricObject) => void, label?: string) =>
    controller.applyToSelection(fn, label);

  return (
    <Section id="text" title="Text">
      <Field label="Text" hint="Wrap a value in {{ }} to make it a variable">
        <textarea
          className="w-full rounded border border-rule bg-paper px-2 py-1 font-mono text-[12px] focus:border-ink focus:outline-none"
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
      <Field label="Insert a variable">
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
              className="rounded border border-rule bg-desk px-1.5 py-0.5 font-mono text-[12px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
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
            options={FONT_OPTIONS}
          />
        </Field>
        <Field label="Size">
          <NumberInput
            value={o.fontSize}
            min={4}
            onChange={(v) => apply((obj) => obj.set({ fontSize: v } as never), "Font size")}
          />
        </Field>
      </div>
      <BoldItalicButtons
        bold={o.fontWeight === "bold"}
        italic={o.fontStyle === "italic"}
        onToggleBold={() =>
          apply(
            (obj) =>
              obj.set({
                fontWeight: o.fontWeight === "bold" ? "normal" : "bold",
              } as never),
            "Weight",
          )
        }
        onToggleItalic={() =>
          apply(
            (obj) =>
              obj.set({
                fontStyle: o.fontStyle === "italic" ? "normal" : "italic",
              } as never),
            "Font style",
          )
        }
      />
      <Field label="Alignment">
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
      <Field label="Custom font" hint="Any installed face, e.g. My Custom Font">
        <CustomFontInput
          value={o.fontFamily}
          onCommit={(v) => apply((obj) => obj.set({ fontFamily: v } as never), "Font family")}
        />
      </Field>
      <Checkbox
        label="Let the text wrap onto more lines"
        checked={isWrapped}
        onChange={() => controller.setTextWrap(!isWrapped)}
      />
      <p className="text-[12px] leading-relaxed text-ink-faint">
        Wrapped text keeps this box&rsquo;s width and grows downward. Unwrapped,
        the box stays one auto-width line.
      </p>
      {o.roleKind === "variable" ? (
        <p className="text-[12px] leading-relaxed text-ink-soft">
          This fills from{" "}
          <span className="font-mono text-ledger">{o.role ?? "these values"}</span>{" "}
          when the bill is filled in.
        </p>
      ) : (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Fixed text &mdash; the same on every bill.
        </p>
      )}
    </Section>
  );
}

function TablePanel({
  controller,
  state,
  o,
}: {
  controller: EditorController;
  state: EditorState;
  o: Extract<TemplateObject, { type: "table" }>;
}) {

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
    <Section id="table" title="Table">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rows">
          <NumberInput value={o.rows} min={1} max={60} onChange={setRows} />
        </Field>
        <Field label="Columns">
          <NumberInput value={o.columns} min={1} max={30} onChange={setCols} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Line colour">
          <ColorInput
            value={o.borderColor}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.borderColor = v;
              }, "Table border")
            }
          />
        </Field>
        <Field label="Line thickness">
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
        <Field label="Cell background">
          <ColorInput
            value={o.cellFill}
            onChange={(v) =>
              controller.updateTable((t) => {
                t.cellFill = v;
              }, "Cell fill")
            }
          />
        </Field>
        <Field label="Cell padding">
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
      <Field label="Header background">
        <ColorInput
          value={o.headerFill}
          onChange={(v) =>
            controller.updateTable((t) => {
              t.headerFill = v;
            }, "Header fill")
          }
        />
      </Field>

      {state.selectedTable ? (
        <div className="mt-3 rounded border border-neutral-200 p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-neutral-500">Repeating rows</div>
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={Boolean(state.selectedTable.repeat)}
              onChange={(e) => {
                const t = state.selectedTable!;
                const lastRow = Math.max(0, t.rows - 1);
                controller.setTableRepeat(
                  t.id,
                  e.target.checked
                    ? { startRow: Math.min(1, lastRow), endRow: lastRow, key: "items" }
                    : null,
                );
              }}
            />
            Repeat these rows once per item
          </label>
          {state.selectedTable.repeat ? (
            <div className="mt-1 grid grid-cols-2 gap-2">
              <label className="text-[12px]">
                From row
                <input
                  type="number"
                  min={0}
                  max={state.selectedTable.rows - 1}
                  value={state.selectedTable.repeat.startRow}
                  onChange={(e) =>
                    controller.setTableRepeat(state.selectedTable!.id, {
                      ...state.selectedTable!.repeat!,
                      startRow: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-[12px]">
                To row
                <input
                  type="number"
                  min={0}
                  max={state.selectedTable.rows - 1}
                  value={state.selectedTable.repeat.endRow}
                  onChange={(e) =>
                    controller.setTableRepeat(state.selectedTable!.id, {
                      ...state.selectedTable!.repeat!,
                      endRow: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="col-span-2 text-[12px]">
                Data name
                <input
                  type="text"
                  value={state.selectedTable.repeat.key}
                  onChange={(e) =>
                    controller.setTableRepeat(state.selectedTable!.id, {
                      ...state.selectedTable!.repeat!,
                      key: e.target.value,
                    })
                  }
                />
              </label>
              <label className="text-[12px]">
                Maximum
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={state.selectedTable.repeat.maxItems ?? 200}
                  onChange={(e) =>
                    controller.setTableRepeat(state.selectedTable!.id, {
                      ...state.selectedTable!.repeat!,
                      maxItems: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={state.selectedTable.repeat.repeatHeader === true}
                  onChange={(e) =>
                    controller.setTableRepeat(state.selectedTable!.id, {
                      ...state.selectedTable!.repeat!,
                      repeatHeader: e.target.checked,
                    })
                  }
                />
                Repeat the header
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

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
          Cell text
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
          <p className="mt-1.5 text-[12px] text-neutral-400">
            Tip: double click a cell on the canvas to edit it in place. Use
            double brace tokens such as item_name for dynamic data.
          </p>
        </div>
      </details>
    </Section>
  );
}

function TableCellPanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {

  const table = state.editingCell
    ? controller.getTableById(state.editingCell.tableId)
    : controller.getCanvas()
        ?.getObjects()
        .find((x): x is BillTable => x instanceof BillTable);
  if (!table || !state.editingCell) {
    return <Section id="cell" title="Cell">No active cell.</Section>;
  }
  const idx = state.editingCell.index;
  const cell = table.getCell(Math.floor(idx / table.columns), idx % table.columns);

  return (
    <Section id="cell" title="Cell">
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
    </Section>
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
    <Section id="slot" title="Picture slot">
      <Field label="What goes here">
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
    </Section>
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
    <Section id="data-field" title="Data field">
      <Field label="Name" hint="The name this answer is saved under, e.g. invoice_date">
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
      <Field label="Type of answer">
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
      <Field label="Colour" hint="Also the colour the value prints in">
        <ColorInput
          value={o.fill}
          onChange={(v) =>
            controller.applyToSelection((obj) => {

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
            options={FONT_OPTIONS}
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
      </div>
      <BoldItalicButtons
        bold={o.fontWeight === "bold"}
        italic={o.fontStyle === "italic"}
        onToggleBold={() =>
          controller.applyToSelection(
            (obj) =>
              obj.set({
                fontWeight: o.fontWeight === "bold" ? "normal" : "bold",
              } as never),
            "Weight",
          )
        }
        onToggleItalic={() =>
          controller.applyToSelection(
            (obj) =>
              obj.set({
                fontStyle: o.fontStyle === "italic" ? "normal" : "italic",
              } as never),
            "Font style",
          )
        }
      />
      <Field label="Alignment" hint="Left, centre or right, as in a text box">
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
      <Field label="Custom font" hint="Any installed face, e.g. My Custom Font">
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
    </Section>
  );
}

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
    <Section id="ink" title="Ink & outline">
      {paintable.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Line colour">
            <div className="flex items-center gap-1">
              {shared.stroke === undefined ? <Mixed /> : null}
              <ColorInput

                value={shared.stroke ?? "#000000"}
                onChange={(v) => controller.applyShared("stroke", v, "Stroke")}
              />
            </div>
          </Field>
          <Field label="Line thickness">
            <div className="flex items-center gap-1">
              {shared.strokeWidth === undefined ? <Mixed /> : null}
              <NumberInput

                value={shared.strokeWidth ?? Number.NaN}
                step={0.5}
                min={0}
                onChange={(v) =>
                  controller.applyShared("strokeWidth", v, "Stroke width")
                }
              />
            </div>
          </Field>
          <Field label="Fill colour">
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
    </Section>
  );
}

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
      <IndexNav
        sections={[
          { id: "objects", label: `${selected.length} objects` },
          { id: "ink", label: "Ink & outline" },
          { id: "lineup", label: "Line up" },
          { id: "group", label: "Group" },
        ]}
      />
      <Section id="objects" title={`${selected.length} objects`}>
        <ul className="editor-scroll max-h-40 space-y-1 overflow-auto text-[11px]">
          {selected.map((o) => (
            <li key={o.id} className="truncate text-neutral-600">
              {o.name} <span className="text-neutral-400">({o.type})</span>
            </li>
          ))}
        </ul>
      </Section>
      <MultiAppearancePanel
        controller={controller}
        state={state}
        selected={selected}
      />
      <Section id="lineup" title="Line up">
        <div className="grid grid-cols-3 gap-1">
          {ALIGN_BUTTONS.map(([k, t, word]) => (
            <Button key={k} title={t} onClick={() => controller.align(k)}>
              {word}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={() => controller.distribute("horizontal")}>
            Space evenly (H)
          </Button>
          <Button onClick={() => controller.distribute("vertical")}>
            Space evenly (V)
          </Button>
        </div>
      </Section>
      <Section id="group" title="Group">
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
      </Section>
      <p className="px-3 py-2 text-[10px] text-neutral-400">
        {state.objectCount} objects in document
      </p>
    </>
  );
}

```

## components/editor/ReferencePanel.tsx

```tsx
"use client";

import { useState } from "react";

import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import { Button, Checkbox, Field, NumberInput, Panel } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import type { ReferenceCrop } from "@/lib/canvas/referenceBackground";

export default function ReferencePanel({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  const [crop, setCrop] = useState<ReferenceCrop>(state.referenceCrop);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const apply = async (nextCrop = crop, rotation = state.referenceRotation) => {
    setBusy(true);
    try {
      await controller.setReferenceAdjustments(nextCrop, rotation);
      setCrop(nextCrop);
    } catch (error) {
      toast({
        kind: "error",
        title: "Could not adjust the reference photo",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!state.hasReference) {
    return (
      <Panel title="Your bill photo">
        <p className="text-[12px] leading-relaxed text-ink-soft">
          No photo loaded yet. The photo is a tracing aid only &mdash; it is
          never saved into the template and never appears in an export.
        </p>
        <Button onClick={() => controller.removeReference()} disabled>
          Remove Reference
        </Button>
      </Panel>
    );
  }

  return (
    <Panel title="Your bill photo">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-medium text-neutral-600">
            Opacity
          </span>
          <span className="text-[12px] tabular-nums text-neutral-500">
            {Math.round(state.referenceOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          className="tight-range w-full"
          value={Math.round(state.referenceOpacity * 100)}
          onChange={(e) =>
            controller.setReferenceOpacity(Number(e.target.value) / 100)
          }
        />
      </div>

      <Checkbox
        label="Show reference"
        checked={state.referenceVisible}
        onChange={(v) => controller.setReferenceVisible(v)}
      />

      <div className="space-y-2 border-t border-rule pt-2">
        <p className="text-[12px] font-medium text-ink-soft">Crop edges (%)</p>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Trim blank margins from the tracing photo. These changes never alter the template or its exports.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Field key={side} label={side[0]!.toUpperCase() + side.slice(1)}>
              <NumberInput
                value={crop[side]}
                min={0}
                max={90}
                onChange={(value) => setCrop((current) => ({ ...current, [side]: value }))}
              />
            </Field>
          ))}
        </div>
        <Button className="w-full" disabled={busy} onClick={() => void apply()}>
          Apply crop
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void apply(crop, ((state.referenceRotation + 270) % 360) as 0 | 90 | 180 | 270)}>
            Rotate left
          </Button>
          <Button disabled={busy} onClick={() => void apply(crop, ((state.referenceRotation + 90) % 360) as 0 | 90 | 180 | 270)}>
            Rotate right
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => {
            setBusy(true);
            void controller.fitReferenceToPage()
              .then(() => setCrop(controller.getSnapshot().referenceCrop))
              .catch((error: unknown) => toast({ kind: "error", title: "Could not fit the photo", detail: error instanceof Error ? error.message : String(error) }))
              .finally(() => setBusy(false));
          }}>
            Fit to page
          </Button>
          <Button disabled={busy} onClick={() => {
            setCrop({ top: 0, right: 0, bottom: 0, left: 0 });
            void apply({ top: 0, right: 0, bottom: 0, left: 0 }, 0);
          }}>
            Reset photo
          </Button>
        </div>
        <p className="text-[11px] text-ink-faint">Rotation: {state.referenceRotation}°</p>
      </div>

      <Checkbox
        label="Whiten paper on new parts"
        checked={state.normaliseBillParts}
        onChange={(v) => controller.setNormaliseBillParts(v)}
      />

      <p className="text-[12px] leading-relaxed text-ink-faint">
        Cut-out pictures can keep the paper&rsquo;s colour or clean it to white.
        This sets the default for new cut-outs; each one keeps its own choice
        and can be taken again from its Cut-out picture panel.
      </p>

      <Button
        variant="danger"
        onClick={() => controller.removeReference()}
        className="w-full"
      >
        Remove Reference
      </Button>

      <p className="text-[12px] leading-relaxed text-ink-faint">
        The photo sits at the bottom layer and is left out of every export.
      </p>
    </Panel>
  );
}

```

## components/editor/StageBar.tsx

```tsx
"use client";

import { Minus, Plus } from "lucide-react";

import { Button, IconButton } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";

export default function StageBar({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft">
      <span className="tabular-nums">
        Page{" "}
        <span className="font-mono text-ink">
          {state.document.width} × {state.document.height}
        </span>
      </span>
      <span className="tabular-nums">
        Objects <span className="font-mono text-ink">{state.objectCount}</span>
      </span>
      <span className="tabular-nums">
        Selected <span className="font-mono text-ink">{state.selection.length}</span>
      </span>

      {state.sampledColour ? (
        <span className="flex items-center gap-1.5 tabular-nums">
          <span
            className="inline-block h-3 w-3 rounded-full border border-rule"
            style={{ backgroundColor: state.sampledColour }}
          />
          <span className="font-mono text-ink">{state.sampledColour}</span>
        </span>
      ) : null}

      <span className="text-ink-faint">Wheel to zoom · Space+drag to pan</span>
      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => controller.zoomOut()}>
          <Minus aria-hidden className="h-4 w-4" />
        </IconButton>
        <Button
          onClick={() => controller.resetZoom()}
          title="Reset zoom to 100%"
        >
          {Math.round(state.zoom * 100)}%
        </Button>
        <IconButton label="Zoom in" onClick={() => controller.zoomIn()}>
          <Plus aria-hidden className="h-4 w-4" />
        </IconButton>
        <Button
          onClick={() => controller.fit()}
          title="Fit the whole document in the pane"
        >
          Fit
        </Button>
      </div>
    </div>
  );
}

```

## components/editor/StepPath.tsx

```tsx
"use client";

import { Fragment } from "react";

import { Check } from "lucide-react";

import { STEP_LABELS, STEP_ORDER, nextStep, type StepId } from "@/lib/client/steps";

export default function StepPath({
  done,
  current,
  onSelect,
}: {
  done: Record<StepId, boolean>;
  current: StepId;
  onSelect: (step: StepId) => void;
}) {
  const next = nextStep(current);
  return (
    <nav
      aria-label="Steps"
      className="flex flex-wrap items-center gap-1 border-b border-rule bg-paper px-3 py-1"
    >
      {STEP_ORDER.map((step, i) => {
        const isCurrent = step === current;
        const isDone = done[step];
        return (
          <Fragment key={step}>
            {i > 0 ? (
              <span aria-hidden className="px-1 text-[12px] text-ink-faint">
                →
              </span>
            ) : null}
            <button
              type="button"
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(step)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const dir = e.key === "ArrowRight" ? 1 : -1;
                const next =
                  STEP_ORDER[(i + dir + STEP_ORDER.length) % STEP_ORDER.length];
                onSelect(next);

                const buttons = e.currentTarget.parentElement?.querySelectorAll(
                  "button",
                );
                const target = buttons?.[STEP_ORDER.indexOf(next)];
                (target as HTMLElement | undefined)?.focus();
              }}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                isCurrent
                  ? "bg-ink text-paper"
                  : isDone
                    ? "text-ledger hover:bg-ledger-wash"
                    : "text-ink-soft hover:bg-desk hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[12px] ${
                  isCurrent
                    ? "border-paper/50 text-paper"
                    : isDone
                      ? "border-ledger text-ledger"
                      : "border-rule text-ink-faint"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span>{STEP_LABELS[step]}</span>
              {isDone ? <span className="sr-only"> (done)</span> : null}
            </button>
          </Fragment>
        );
      })}
      {next ? (
        <button
          type="button"
          aria-label="Next step"
          onClick={() => onSelect(next)}
          className="ml-auto flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:bg-desk hover:text-ink"
        >
          Next: {STEP_LABELS[next]}
        </button>
      ) : null}
    </nav>
  );
}

```

## components/editor/ToolRail.tsx

```tsx
"use client";

import type { ReactNode } from "react";

import {
  Braces,
  Check,
  Circle,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  PenLine,
  Pipette,
  Scissors,
  Slash,
  Square,
  Squircle,
  Table,
  Triangle,
  Type,
} from "lucide-react";

import { Button } from "@/components/ui/Controls";
import type { EditorController, ToolId } from "@/lib/canvas/EditorController";
import { TOOL_LABELS } from "@/lib/canvas/EditorController";

const iconClass = "h-4 w-4";

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  select: <MousePointer2 aria-hidden className={iconClass} />,
  "guide-h": <MoveHorizontal aria-hidden className={iconClass} />,
  "guide-v": <MoveVertical aria-hidden className={iconClass} />,
  line: <Slash aria-hidden className={iconClass} />,
  hr: <Minus aria-hidden className={iconClass} />,
  vr: <Minus aria-hidden className={`${iconClass} rotate-90`} />,
  rect: <Square aria-hidden className={iconClass} />,
  "rounded-rect": <Squircle aria-hidden className={iconClass} />,
  ellipse: <Circle aria-hidden className={iconClass} />,
  polygon: <Triangle aria-hidden className={iconClass} />,
  freehand: <PenLine aria-hidden className={iconClass} />,
  text: <Type aria-hidden className={iconClass} />,
  table: <Table aria-hidden className={iconClass} />,
  "image-placeholder": <ImageIcon aria-hidden className={iconClass} />,
  "bill-part": <Scissors aria-hidden className={iconClass} />,
  field: <Braces aria-hidden className={iconClass} />,
  eyedropper: <Pipette aria-hidden className={iconClass} />,
};

const GROUPS: Array<{ title: string; tools: ToolId[] }> = [
  {
    title: "Draw",
    tools: ["line", "hr", "vr", "rect", "rounded-rect", "ellipse", "polygon", "freehand"],
  },
  { title: "Structure", tools: ["guide-h", "guide-v", "table"] },
  { title: "Content", tools: ["text", "image-placeholder", "bill-part", "field"] },
  { title: "Tools", tools: ["select", "eyedropper"] },
];

const SHORTCUTS: Partial<Record<ToolId, string>> = {
  select: "V",
  line: "L",
  rect: "R",
  ellipse: "C",
  polygon: "P",
  text: "T",
  table: "G",
  "image-placeholder": "I",
  "bill-part": "B",
  field: "F",
  hr: "H",
  freehand: "E",
  eyedropper: "K",
};

export default function ToolRail({
  controller,
  activeTool,
}: {
  controller: EditorController;
  activeTool: ToolId;
}) {
  return (
    <div className="editor-scroll flex w-[148px] shrink-0 flex-col overflow-y-auto border-r border-rule bg-paper py-1.5">
      {GROUPS.map((group) => (
        <div key={group.title} className="pb-0.5">
          <p className="px-2.5 pt-1.5 pb-0.5 text-[12px] font-semibold text-ink-faint">
            {group.title}
          </p>
          {group.tools.map((tool) => {
            const active = tool === activeTool;
            return (
              <button
                key={tool}
                type="button"
                onClick={() => controller.setTool(tool)}
                title={`${TOOL_LABELS[tool]}${SHORTCUTS[tool] ? ` (${SHORTCUTS[tool]})` : ""}`}
                aria-pressed={active}
                className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors ${
                  active
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:bg-desk hover:text-ink"
                }`}
              >
                <span className="shrink-0">{TOOL_ICONS[tool]}</span>
                <span className="min-w-0 flex-1 truncate">{TOOL_LABELS[tool]}</span>
                {SHORTCUTS[tool] ? (
                  <kbd
                    aria-hidden
                    className={`shrink-0 rounded border px-1 text-[12px] ${
                      active ? "border-paper/40 text-paper" : "border-rule text-ink-faint"
                    }`}
                  >
                    {SHORTCUTS[tool]}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}

      {activeTool === "polygon" ? (
        <div className="px-2 pb-1">
          <p className="mb-1 text-[11px] leading-tight text-ink-faint">
            Click to add points · Enter to close · Esc to cancel
          </p>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => controller.finishPolygon()}
          >
            <Check aria-hidden className="h-3.5 w-3.5" />
            Close polygon
          </Button>
        </div>
      ) : null}
    </div>
  );
}

```

## components/editor/TopBar.tsx

```tsx
﻿"use client";

import { useRef } from "react";

import { Redo2, Undo2 } from "lucide-react";

import CopyMenu from "./ExportMenu";
import OpenMenu from "./OpenMenu";
import { Button, IconButton, TextInput } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { BillTemplate } from "@/lib/template/types";
import { readTemplateFile } from "@/lib/client/readTemplateFile";

export default function TopBar({
  controller,
  state,
  onOpenImage,
  onLoadTemplate,
  onTogglePreview,
  onSave,
  onFillAndPrint,
  onShare,
  preview,
}: {
  controller: EditorController;
  state: EditorState;
  onOpenImage: () => void;
  onLoadTemplate: (t: BillTemplate) => void;
  onTogglePreview: () => void;
  onSave: () => void;
  onFillAndPrint: () => void;
  onShare: () => void;
  preview: boolean;
}) {
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  return (
    <header className="flex items-center gap-2 border-b border-rule bg-paper px-3 pt-1.5 pb-[5px]">
      <h1 className="mr-1 shrink-0 font-display text-[13px] font-semibold text-ink">
        Bill Template Maker
      </h1>
      <label className="sr-only" htmlFor="btm-doc-name">
        Bill name
      </label>
      <div className="w-44 shrink-0">
        <TextInput
          id="btm-doc-name"
          value={state.documentName}
          placeholder="Untitled bill"
          onChange={(e) => controller.setDocumentName(e.target.value)}
          className="h-8"
        />
      </div>

      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />
      <IconButton
        label="Undo"
        onClick={() => controller.undo()}
        disabled={!state.canUndo}
      >
        <Undo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Redo"
        onClick={() => controller.redo()}
        disabled={!state.canRedo}
      >
        <Redo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />

      <Button onClick={onOpenImage} title="Choose a photo of your bill">
        Add bill photo
      </Button>
      <OpenMenu
        onOpenFile={() => jsonInput.current?.click()}
        onPickSaved={onLoadTemplate}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            onLoadTemplate(await readTemplateFile(file));
          } catch (error) {
            toast({
              kind: "error",
              title: "That file isn't a bill template",
              detail: error instanceof Error ? error.message : "Choose a supported .json template file.",
            });
          }
        }}
      />

      <div className="flex-1" />

      <Button
        onClick={onTogglePreview}
        variant={preview ? "primary" : "default"}
        title="Preview the reconstructed template without the reference"
      >
        {preview ? "Back to Editor" : "Preview"}
      </Button>
      <Button onClick={onSave} title="Keep a copy on this device">
        Save
      </Button>
      <Button variant="primary" onClick={onFillAndPrint}>
        Fill &amp; print
      </Button>
      <Button
        onClick={onShare}
        title="Download one offline HTML file that fills, previews and prints this template"
      >
        Share
      </Button>
      <CopyMenu controller={controller} />
    </header>
  );
}

```

## components/editor/UploadScreen.tsx

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import { renderSampleBill } from "@/lib/client/sampleBill";
import { readImageFile } from "@/lib/client/readImageFile";
import { readTemplateFile } from "@/lib/client/readTemplateFile";
import type { EditorDraft } from "@/lib/client/draftStore";
import type { BillTemplate } from "@/lib/template/types";

export default function UploadScreen({
  onImage,
  onTemplate,
  onTemplateForRender,
  draft,
  onResumeDraft,
  onDiscardDraft,
}: {
  onImage: (dataUrl: string, name: string) => void;
  onTemplate: (t: BillTemplate) => void;
  onTemplateForRender: (t: BillTemplate) => void;
  draft: EditorDraft | null;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const renderInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();

  const readImage = useCallback(
    async (file: File) => {
      try {
        onImage(await readImageFile(file), file.name);
      } catch (error) {
        toast({
          kind: "error",
          title: "Could not open that picture",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [onImage, toast],
  );

  const readTemplate = useCallback(
    async (file: File, hand: (t: BillTemplate) => void) => {
      try {
        hand(await readTemplateFile(file));
      } catch (error) {
        toast({
          kind: "error",
          title: "That file isn't a bill template",
          detail: error instanceof Error ? error.message : "Choose a supported .json template file.",
        });
      }
    },
    [toast],
  );

  const useSample = useCallback(() => {
    try {
      onImage(renderSampleBill(), "Sample bill");
    } catch (error) {
      toast({
        kind: "error",
        title: "Could not draw the sample bill",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [onImage, toast]);

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-6 transition-colors ${
        dragging ? "bg-ledger-wash" : "bg-desk"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) readImage(file);
      }}
    >
      <div className="w-full max-w-2xl">
        <p className="font-display text-[13px] font-semibold tracking-wide text-ink-faint">
          Bill Template Maker
        </p>
        <h1 className="mt-2 font-display text-[28px] leading-tight font-semibold text-ink">
          Turn your paper bill into a digital bill
        </h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-soft">
          Take a photo of your bill and trace over it once. After that you can
          fill it in on screen, print it, and send it — as many times as you
          like.
        </p>

        <div
          className={`mt-6 rounded-xl border-2 border-dashed bg-paper p-8 text-center transition-colors ${
            dragging ? "border-ledger" : "border-rule"
          }`}
        >
          <ImagePlus aria-hidden className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mt-3 text-[15px] font-medium text-ink">
            Drop a photo of your bill here
          </p>
          <p className="mt-1 text-[12px] text-ink-soft">
            PNG, JPG or WebP — the photo stays on your computer
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={() => imageInput.current?.click()}
            >
              Choose a photo
            </Button>
            <Button size="lg" onClick={useSample}>
              Try a sample bill
            </Button>
          </div>
        </div>

        {draft ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ledger/30 bg-ledger-wash p-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Draft ready to resume: {draft.name}</p>
              <p className="mt-1 text-[11px] text-ink-soft">
                Saved {draft.savedAt}. The tracing photo is not stored in the draft.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={onResumeDraft}>Resume draft</Button>
              <Button onClick={onDiscardDraft}>Discard</Button>
            </div>
          </div>
        ) : null}

        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) readImage(file);
          }}
        />
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readTemplate(file, onTemplate);
          }}
        />
        <input
          ref={renderInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readTemplate(file, onTemplateForRender);
          }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-rule bg-paper p-4">
          <p className="text-[13px] font-medium text-ink">
            Already made a template?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => jsonInput.current?.click()}>
              Open a saved template…
            </Button>
            <Button onClick={() => renderInput.current?.click()}>
              Fill &amp; print a saved template…
            </Button>
          </div>
          <p className="w-full text-[12px] leading-relaxed text-ink-soft">
            Opening one from disk skips the tracing step and goes straight to
            the form where you fill in the numbers.
          </p>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          Nothing is uploaded to a server, and nothing is guessed for you — you
          decide what every line, box and field means.
        </p>
      </div>
    </div>
  );
}

```

## components/render/DynamicForm.tsx

```tsx
﻿"use client";

import { useRef } from "react";

import type { TemplateField } from "@/lib/template/dataBinding";
import type { FormSchema } from "@/lib/package/form";
import { repeatValue, rowsFromValue } from "@/lib/render/repeatForm";
import { CHECKED_MARK, TICKMARK_OPTIONS } from "@/lib/share/kit";
import { readImageFile } from "@/lib/client/readImageFile";

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

```

## components/ui/Controls.tsx

```tsx
"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b border-rule">
      <header className="flex items-center justify-between gap-2 border-b border-rule bg-paper px-3 py-2">
        <h2 className="font-display text-[13px] font-semibold text-ink">
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-3 space-y-2.5">{children}</div>
    </section>
  );
}

const collapsedSections = new Set<string>();

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !collapsedSections.has(id));

  const toggle = () => {
    const next = !open;
    if (next) collapsedSections.delete(id);
    else collapsedSections.add(id);
    setOpen(next);
  };

  return (
    <section
      id={`inspector-${id}`}
      className="scroll-mt-[calc(var(--inspector-nav-h,44px)_+_4px)] border-b border-rule"
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex w-full items-center justify-between gap-2 border-b border-rule bg-paper px-3 py-2 text-left transition-colors hover:bg-desk"
        >
          <span className="font-display text-[13px] font-semibold text-ink">
            {title}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </button>
      </h2>
      {open ? <div className="space-y-2.5 p-3">{children}</div> : null}
    </section>
  );
}

export function IndexNav({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest<HTMLElement>(".editor-scroll");
    if (!nav || !scroller) return;
    const publish = () =>
      scroller.style.setProperty("--inspector-nav-h", `${nav.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  if (sections.length < 2) return null;
  return (
    <nav
      ref={navRef}
      aria-label="Inspector"
      className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-rule bg-paper px-2 py-1.5"
    >
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() =>
            document
              .getElementById(`inspector-${s.id}`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
          className="h-8 rounded-full border border-rule px-2.5 text-[12px] text-ink-soft transition-colors hover:bg-desk hover:text-ink"
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-8 rounded-full border px-2.5 text-[12px] transition-colors ${
        selected
          ? "border-ink bg-ink text-paper"
          : "border-rule text-ink-soft hover:bg-desk hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-ink-soft mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[12px] text-ink-faint mt-0.5">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-rule bg-paper px-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-ink disabled:opacity-50";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(round2(value)) : "");

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {

      onChange(value);
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      className={`${inputClass} num-input ${className ?? ""}`}
      value={shown}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {

        setDraft(e.target.value);
        const parsed = Number.parseFloat(e.target.value);
        if (!Number.isNaN(parsed)) {
          let next = parsed;
          if (min !== undefined) next = Math.max(min, next);
          if (max !== undefined) next = Math.min(max, next);
          onChange(next);
        }
      }}
      onFocus={(e) => {

        e.target.select();
      }}
      onBlur={(e) => {
        commit(e.target.value);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit(e.currentTarget.value);
          setDraft(null);
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }

        e.stopPropagation();
      }}
    />
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; style?: React.CSSProperties }>;
  className?: string;
}) {
  return (
    <select
      className={`${inputClass} ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={o.style}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ColorInput({
  value,
  onChange,
  allowTransparent = true,
}: {
  value: string;
  onChange: (v: string) => void;
  allowTransparent?: boolean;
}) {
  const isTransparent = value === "transparent" || value === "";
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label="Colour"
        className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-rule bg-paper p-0.5"
        value={isTransparent ? "#000000" : value.slice(0, 7)}
        onChange={(e) => onChange(e.target.value)}
      />
      {allowTransparent ? (
        <button
          type="button"
          onClick={() => onChange(isTransparent ? "#000000" : "transparent")}
          className={`h-8 rounded-md border px-2 text-[12px] transition-colors ${
            isTransparent
              ? "border-ink bg-ink text-paper"
              : "border-rule text-ink-soft hover:bg-desk"
          }`}
          title="Toggle transparent"
        >
          {isTransparent ? "None" : "Solid"}
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
  label,
  pressed,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "lg";
  disabled?: boolean;
  title?: string;
  label?: string;
  pressed?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    default: "border-rule bg-paper text-ink hover:bg-desk disabled:opacity-40",
    primary:
      "border-ink bg-ink text-paper hover:border-ink-soft hover:bg-ink-soft disabled:opacity-40",
    ghost: "border-transparent text-ink-soft hover:bg-desk disabled:opacity-40",
    danger:
      "border-rule bg-paper text-stamp hover:border-stamp hover:bg-stamp-wash disabled:opacity-40",
  };
  const sizes: Record<string, string> = {
    md: "h-8 px-2.5",
    lg: "h-10 px-3.5 text-[14px]",
  };
  return (
    <button
      type={type}
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${sizes[size]} ${styles[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-desk hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[13px] text-ink select-none ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-ink"
      />
      {label}
    </label>
  );
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "w-80",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${width} rounded-xl border border-rule bg-paper p-4 shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="mt-3 space-y-3">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

```

## components/ui/Toast.tsx

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleCheck, Info, TriangleAlert, X, XCircle } from "lucide-react";

import { IconButton } from "@/components/ui/Controls";
import {
  autoDismissMs,
  dismissToast,
  pushToast,
  type ToastItem,
  type ToastKind,
} from "@/lib/client/toastQueue";

type ToastInput = Omit<ToastItem, "id">;
type ToastApi = { toast: (input: ToastInput) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

const KIND_STYLES: Record<ToastKind, { bar: string; icon: ReactNode }> = {
  info: {
    bar: "border-l-ink",
    icon: <Info aria-hidden className="h-4 w-4 text-ink" />,
  },
  success: {
    bar: "border-l-ledger",
    icon: <CircleCheck aria-hidden className="h-4 w-4 text-ledger" />,
  },
  warning: {
    bar: "border-l-marker",
    icon: <TriangleAlert aria-hidden className="h-4 w-4 text-marker" />,
  },
  error: {
    bar: "border-l-stamp",
    icon: <XCircle aria-hidden className="h-4 w-4 text-stamp" />,
  },
};

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const loud = item.kind === "error" || item.kind === "warning";
  return (
    <div
      role={loud ? "alert" : "status"}
      aria-live={loud ? "assertive" : "polite"}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border border-rule border-l-4 bg-paper p-3 shadow-lg ${KIND_STYLES[item.kind].bar}`}
    >
      <span className="mt-0.5 shrink-0">{KIND_STYLES[item.kind].icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{item.title}</p>
        {item.detail ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
            {item.detail}
          </p>
        ) : null}
      </div>
      <IconButton label="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1">
        <X aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => dismissToast(list, id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => pushToast(list, input, id));
      const ms = autoDismissMs(input.kind);
      if (ms !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((item) => (
          <ToastCard
            key={item.id}
            item={item}
            onDismiss={() => dismiss(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

```

## components/ui/tokens.ts

```ts


export const PALETTE = {
  ink: "#16203a",
  inkSoft: "#4a5570",
  inkFaint: "#8891a8",
  paper: "#fbfaf7",
  desk: "#e7e6e1",
  rule: "#d6d5cf",
  ledger: "#0e7c5a",
  stamp: "#b3242b",
  marker: "#c77e0a",
  ledgerWash: "#e6f4ee",
  stampWash: "#fbeceb",
  markerWash: "#fdf3e3",
} as const;

export type PaletteToken = keyof typeof PALETTE;

```

## hooks/useEditorController.ts

```ts
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { EditorController, type EditorState } from "@/lib/canvas/EditorController";
import { renderHtml } from "@/lib/render";

export function useEditorController(): {
  controller: EditorController;
  state: EditorState;
} {

  const [controller] = useState(() => new EditorController());

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__btm = controller;
      (window as unknown as Record<string, unknown>).__btmRender = renderHtml;
    }
  }, [controller]);

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return { controller, state };
}

export function useKeyboardShortcuts(
  controller: EditorController,
  handlers: Record<string, () => void>,
): void {
  const ref = useRef(handlers);

  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !isTypingTarget(e.target)) {
        controller.setSpaceHeld(true);

        e.preventDefault();
      }
      if (isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (controller.getCanvas()?.getActiveObject()) {
        const active = controller.getCanvas()!.getActiveObject() as {
          isEditing?: boolean;
        };
        if (active?.isEditing) return;
      }

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) controller.redo();
        else controller.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        controller.redo();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        controller.duplicateSelection();
        return;
      }
      if (mod && key === "g" && e.shiftKey) {
        e.preventDefault();
        controller.ungroupSelection();
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        controller.groupSelection();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        controller.selectAll();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        ref.current.save?.();
        return;
      }
      if (mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        controller.deleteSelection();
        return;
      }
      if (e.key === "Escape") {
        controller.cancelPolygon();
        controller.cancelPendingTable();
        return;
      }
      if (e.key === "Enter") {
        if (controller.isDrawingPolygon) controller.finishPolygon();
        else if (controller.getSnapshot().pendingTable) controller.confirmTable(3, 3);
        return;
      }

      const map: Record<string, string> = {
        v: "select",
        l: "line",
        r: "rect",
        c: "ellipse",
        p: "polygon",
        t: "text",
        g: "table",
        i: "image-placeholder",
        f: "field",
        h: "hr",
        e: "freehand",
        k: "eyedropper",
        b: "bill-part",
      };
      const tool = map[key];
      if (tool) {
        e.preventDefault();
        controller.setTool(tool as never);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") controller.setSpaceHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controller]);
}

```

## lib/billkit/bridge.ts

```ts
﻿

import type { ComputedSpec, PackageManifest } from "@/lib/package/format";
import { deriveForm, type FormSchema } from "@/lib/package/form";
import { renderHtml } from "@/lib/render";
import { cellRequests } from "@/lib/render/rowHeights";
import { fillTemplate } from "@/lib/template/dataBinding";
import type { BillTemplate } from "@/lib/template/types";

export function deriveFormBridge(manifestJson: string, templateJson?: string): FormSchema {
  const manifest = JSON.parse(manifestJson) as PackageManifest;
  const template = templateJson
    ? (JSON.parse(templateJson) as BillTemplate | undefined)
    : undefined;
  return deriveForm(manifest, template);
}

export interface RenderBridgeResult {
  html: string;

  variables: string[];
  warnings: string[];
  refusals: Array<{ field: string; value: string; reason: string }>;

  page: { width: number; height: number };
}

export interface MeasurementRequest {
  id: string;

  kind?: "box" | "cell";

  textAlign?: "left" | "center" | "right";

  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";

  lineHeight: number;

  charSpacing: number;

  width: number;

  wrap: boolean;
}

export type Measurements = Record<string, { naturalWidth: number; height: number }>;

export function measureBridge(
  templateJson: string,
  valuesJson: string,
  computedJson?: string,
): MeasurementRequest[] {
  const template = JSON.parse(templateJson) as BillTemplate;
  if (!template || template.layout?.mode !== "variable") return [];
  const values = valuesJson ? (JSON.parse(valuesJson) as Record<string, string>) : {};
  const computed = computedJson ? (JSON.parse(computedJson) as ComputedSpec[]) : [];

const filled = fillTemplate(template, values);
  const requests: MeasurementRequest[] = [];

  for (const o of filled.objects) {
    if (o.type !== "text" && o.type !== "field") continue;
    const policy = (o as { expansion?: unknown }).expansion;
    if (typeof policy !== "object" || policy === null) continue;

    const y = (policy as { y?: { strategy?: unknown } }).y;

    const wraps = o.type === "field" || y?.strategy === "wrap";

    requests.push({
      id: o.id,
      kind: "box",
      text: typeof o.text === "string" ? o.text : "",
      fontFamily: o.fontFamily,
      fontSize: o.fontSize,
      fontWeight: o.fontWeight,
      fontStyle: o.fontStyle,
      lineHeight: o.lineHeight,
      charSpacing: o.charSpacing,
      width: o.width,
      wrap: wraps,
    });
  }

  for (const cell of cellRequests(template, values, computed)) {
    requests.push({
      id: cell.id,
      kind: "cell",
      textAlign: cell.textAlign,
      text: cell.text,
      fontFamily: cell.fontFamily,
      fontSize: cell.fontSize,
      fontWeight: cell.fontWeight,
      fontStyle: "normal",
      lineHeight: 1.2,
      charSpacing: 0,
      width: cell.width,
      wrap: cell.wrap,
    });
  }

  return requests;
}

export function renderBridge(
  templateJson: string,
  valuesJson: string,
  computedJson?: string,
  measurementsJson?: string,
): RenderBridgeResult {
  const template = JSON.parse(templateJson) as BillTemplate;
  const values = JSON.parse(valuesJson) as Record<string, string>;
  const computed = computedJson ? (JSON.parse(computedJson) as ComputedSpec[]) : [];

  let measurements: Measurements | undefined;
  if (measurementsJson) {
    try {
      const parsed = JSON.parse(measurementsJson) as Measurements;
      if (parsed && typeof parsed === "object") measurements = parsed;
    } catch {
      measurements = undefined;
    }
  }

  const filled = fillTemplate(template, values);
  const result = renderHtml(filled, values, { computed, measurements });

return {
    html: result.html,
    variables: result.variables,
    warnings: result.warnings,
    refusals: result.refusals.map((r) => ({
      field: r.field,
      value: r.value,
      reason: r.reason,
    })),
    page: { width: result.page.width, height: result.page.height },
  };
}


```

## lib/billkit/main.ts

```ts
import { deriveFormBridge, measureBridge, renderBridge } from "./bridge";
import { measureDom } from "./measure-dom";

declare global {
  interface Window {
    billkit: {
      deriveForm: typeof deriveFormBridge;

      measurePlan: typeof measureBridge;

      measure: typeof measureDom;
      render: typeof renderBridge;
    };
  }
}

if (typeof window !== "undefined") {
  const globalScope = window as unknown as {
    billkit?: Window["billkit"];
  };
  globalScope.billkit = {
    deriveForm: deriveFormBridge,
    measurePlan: measureBridge,
    measure: measureDom,
    render: renderBridge,
  };
}

```

## lib/billkit/measure-dom.ts

```ts
import type { MeasurementRequest, Measurements } from "./bridge";

const HOST_ID = "__billkit_measure";

function styleFor(r: MeasurementRequest): string {
  const family = /[^a-zA-Z0-9\s-]/.test(r.fontFamily)
    ? "Arial, sans-serif"
    : `"${r.fontFamily}", Arial, sans-serif`;
  const line = Math.round(r.fontSize * r.lineHeight * 100) / 100;
  return [
    "position:absolute",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    "margin:0",
    "padding:0",
    "border:0",
    `font-family:${family}`,
    `font-size:${r.fontSize}px`,
    `line-height:${line}px`,
    `font-weight:${r.fontWeight}`,
    `font-style:${r.fontStyle}`,
    `letter-spacing:${r.charSpacing / 1000}em`,
    "word-spacing:normal",
    "text-transform:none",
    "text-indent:0",
  ].join(";");
}

export function measureDom(requests: readonly MeasurementRequest[]): Measurements {
  const out: Measurements = {};
  if (!requests.length || typeof document === "undefined") return out;

  const host = document.createElement("div");
  host.id = HOST_ID;

  host.style.cssText =
    "position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;contain:strict";
  document.body.appendChild(host);

  try {
    for (const r of requests) {
      const width = Number.isFinite(r.width) && r.width > 0 ? r.width : 0;

      const line = document.createElement("div");
      line.setAttribute("style", `${styleFor(r)};white-space:pre;width:auto`);

      line.textContent = r.text;
      host.appendChild(line);
      const naturalWidth = line.getBoundingClientRect().width;

      const box = document.createElement("div");
      box.setAttribute(
        "style",
        `${styleFor(r)};white-space:${r.wrap ? "pre-wrap" : "pre"};` +
          `overflow-wrap:${r.wrap ? "break-word" : "normal"};width:${width}px`,
      );
      box.textContent = r.text;

      if (r.kind === "cell" && r.textAlign) box.style.textAlign = r.textAlign;
      host.appendChild(box);
      const height = box.getBoundingClientRect().height;

      line.remove();
      box.remove();

      if (!Number.isFinite(naturalWidth) || !Number.isFinite(height)) continue;
      out[r.id] = { naturalWidth: Math.round(naturalWidth * 100) / 100, height: Math.round(height * 100) / 100 };
    }
  } finally {

    host.remove();
  }

  return out;
}
```

## lib/canvas/billPartCrop.ts

```ts
import { normalisePaper } from "@/lib/canvas/paperNormalise";
import type { ReferenceHandle } from "@/lib/canvas/referenceBackground";
import type { SourceRect } from "@/lib/template/types";

export interface DocumentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function imageRectForBox(
  rect: DocumentRect,
  doc: { width: number; height: number },
  image: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const sx = image.width / Math.max(1, doc.width);
  const sy = image.height / Math.max(1, doc.height);
  const left = Math.max(0, Math.round(rect.left * sx));
  const top = Math.max(0, Math.round(rect.top * sy));
  const right = Math.min(image.width, Math.round((rect.left + rect.width) * sx));
  const bottom = Math.min(image.height, Math.round((rect.top + rect.height) * sy));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function clippedDocumentRect(
  rect: DocumentRect,
  doc: { width: number; height: number },
  image: { width: number; height: number },
): DocumentRect {
  const box = imageRectForBox(rect, doc, image);
  const sx = image.width / Math.max(1, doc.width);
  const sy = image.height / Math.max(1, doc.height);
  const left = box.left / sx;
  const top = box.top / sy;
  return {
    left,
    top,
    width: (box.left + box.width) / sx - left,
    height: (box.top + box.height) / sy - top,
  };
}

export interface BillPartCrop {
  src: string;

  rect: DocumentRect;
  sourceRect: SourceRect;

  normalized: boolean;
  width: number;
  height: number;

  image: HTMLCanvasElement | HTMLImageElement;
}

export interface CropOptions {

  normalise?: boolean;
}

export function cropBillPart(
  ref: ReferenceHandle,
  doc: { width: number; height: number },
  rect: DocumentRect,
  options: CropOptions = {},
): BillPartCrop | null {
  const normalise = options.normalise !== false;
  const box = imageRectForBox(rect, doc, { width: ref.width, height: ref.height });
  if (box.width < 2 || box.height < 2) return null;
  const source = ref.image.getElement() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  if (normalise) {
    const imageData = ctx.getImageData(0, 0, box.width, box.height);
    normalisePaper(imageData.data, box.width, box.height);
    ctx.putImageData(imageData, 0, 0);
  }
  const placed = clippedDocumentRect(rect, doc, {
    width: ref.width,
    height: ref.height,
  });
  return {
    src: canvas.toDataURL("image/png"),
    rect: placed,
    sourceRect: {
      x: placed.left,
      y: placed.top,
      width: placed.width,
      height: placed.height,
    },
    normalized: normalise,
    width: box.width,
    height: box.height,
    image: canvas,
  };
}

```

## lib/canvas/EditorController.ts

```ts
"use client";

import {
  ActiveSelection,
  Canvas,
  Circle,
  Ellipse,
  FabricObject,
  IText,
  Line,
  Path,
  PencilBrush,
  Polygon,
  Rect,
  Textbox,
  type TPointerEvent,
  type TPointerEventInfo,
} from "fabric";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import {
  GUIDE_APP_TYPE,
  guidesFromObjects,
  isGuide,
  nextGuideId,
  withLayoutMode,
} from "@/lib/canvas/guides";
import type {
  AttachmentBehavior,
  AttachmentEdge,
  BillTemplate,
  ChildAnchor,
  ContainerPolicy,
  ObjectExpansion,
  PlaceholderSpec,
  LayoutConfig,
  TableObject,
  TableRepeat,
  TemplateObject,
} from "@/lib/template/types";
import { normaliseRepeat } from "@/lib/canvas/tableRepeat";
import { interiorGridLevels } from "@/lib/canvas/tableGrid";
import { FieldObject } from "@/lib/canvas/objects/BillField";
import {
  groupObjects as groupObjectsIn,
  pruneGroups,
  ungroup as ungroupIn,
  subtreeIds,
  type GroupNode,
} from "@/lib/canvas/groups";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { cropBillPart, type BillPartCrop } from "@/lib/canvas/billPartCrop";
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
import {
  levelsFromBounds,
  snapToLevels,
  type Levels,
  type SnapLine,
} from "@/lib/canvas/snap";
import {
  DEFAULT_STROKE_WIDTH,
  applyStrokeFloor,
  usesDefaultStroke,
} from "@/lib/canvas/strokeDefaults";
import { extractVariables, isDataFieldObject } from "@/lib/template/placeholders";
import {
  acceptsSharedPaint,
  acceptsVisibility,
  sharedSelection,
  type SharedKey,
  type SharedSelection,
} from "@/lib/canvas/sharedSelection";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { HistoryStack } from "@/lib/canvas/history";
import {
  buildAdjustedReference,
  cropForPage,
  EMPTY_REFERENCE_CROP,
  fitTo,
  install,
  remove,
  sampleBorderColor,
  setOpacity,
  setVisible,
  type ReferenceCrop,
  type ReferenceHandle,
} from "@/lib/canvas/referenceBackground";
import {
  clampZoom,
  containScale,
  panBy as panViewBy,
  sceneToScreen,
  screenToScene,
  viewportTransform,
  zoomAbout,
  type Viewport,
} from "@/lib/canvas/viewport";
import { evenSizes, MIN_COL_WIDTH, MIN_ROW_HEIGHT } from "@/lib/template/geometry";
import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObjects, defaultName } from "@/lib/template/serialize";
import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { resolvePackage } from "@/lib/package/resolve";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { ComputedSpec } from "@/lib/package/format";
import { renderHtml } from "@/lib/render";
import type { LayoutGuide } from "@/lib/template/types";
import { A4_HEIGHT, A4_WIDTH } from "@/lib/template/types";

registerAppProperties();

export type ToolId =
  | "select"
  | "guide-h"
  | "guide-v"
  | "line"
  | "rect"
  | "rounded-rect"
  | "ellipse"
  | "polygon"
  | "freehand"
  | "text"
  | "table"
  | "hr"
  | "vr"
  | "image-placeholder"
  | "bill-part"
  | "field"
  | "eyedropper";

export const TOOL_LABELS: Record<ToolId, string> = {
  select: "Select",
  "guide-h": "Guide H",
  "guide-v": "Guide V",
  line: "Line",
  rect: "Rectangle",
  "rounded-rect": "Rounded Rect",
  ellipse: "Ellipse",
  polygon: "Polygon",
  freehand: "Freehand",
  text: "Text",
  table: "Table",
  hr: "Horizontal Rule",
  vr: "Vertical Rule",
  "image-placeholder": "Image Placeholder",
  "bill-part": "Bill Part",
  field: "Field",
  eyedropper: "Eyedropper",
};

export interface LayerEntry {
  id: string;
  type: string;
  name: string;
  role: string | null;
  visible: boolean;
  locked: boolean;
  isReference: boolean;
}

export interface EditorState {
  ready: boolean;
  tool: ToolId;
  zoom: number;

  tx: number;
  ty: number;
  document: { width: number; height: number };
  selection: string[];
  layers: LayerEntry[];
  hasReference: boolean;
  referenceVisible: boolean;
  referenceOpacity: number;
  referenceCrop: ReferenceCrop;
  referenceRotation: 0 | 90 | 180 | 270;
  referenceName: string;
  gridVisible: boolean;
  snapToGrid: boolean;
  gridSize: number;
  canUndo: boolean;
  canRedo: boolean;

  editingCell: { tableId: string; index: number } | null;

  selectedTable: (TableObject & { repeat?: TableRepeat }) | null;

  pendingTable: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  documentName: string;
  objectCount: number;

  dataFieldCount: number;

  placeholders: PlaceholderSpec[];
  computedSpecs: ComputedSpec[];

  layout?: LayoutConfig;

  sampledColour: string | null;

  structureLocked: boolean;

  groups: GroupNode[];

  snapToObjects: boolean;

  fullSpanRules: boolean;

  normaliseBillParts: boolean;

  snaps: SnapLine[];
}

type Listener = () => void;

 const APP_TYPE_FOR: Record<string, string> = {
  "rounded-rect": "rounded-rect",
  rect: "rect",
  ellipse: "ellipse",
  polygon: "polygon",
  freehand: "path",
  text: "text",
  table: "table",
  "image-placeholder": "image-placeholder",
  "bill-part": "bill-part",
  field: "field",
  line: "line",
  hr: "hr",
  vr: "vr",
};

export function snap(value: number, size: number): number {
  if (size <= 0) return Math.round(value);
  return Math.round(value / size) * size;
}

export function normalisePlaceholderSpecs(
  specs: PlaceholderSpec[] | undefined,
): PlaceholderSpec[] {
  if (!Array.isArray(specs)) return [];
  const seen = new Set<string>();
  const out: PlaceholderSpec[] = [];
  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string") continue;
    const key = spec.key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const clean: PlaceholderSpec = { key };
    if (spec.label) clean.label = spec.label;
    if (spec.type) clean.type = spec.type;
    if (typeof spec.required === "boolean") clean.required = spec.required;
    if (typeof spec.defaultValue === "string") clean.defaultValue = spec.defaultValue;
    if (typeof spec.maxLength === "number" && spec.maxLength > 0) {
      clean.maxLength = spec.maxLength;
    }
    if (typeof spec.min === "number" && Number.isFinite(spec.min)) clean.min = spec.min;
    if (typeof spec.max === "number" && Number.isFinite(spec.max)) clean.max = spec.max;
    if (spec.fontFamily) clean.fontFamily = spec.fontFamily;
    if (typeof spec.fontSize === "number" && spec.fontSize > 0) {
      clean.fontSize = spec.fontSize;
    }
    if (spec.fontWeight) clean.fontWeight = spec.fontWeight;
    if (spec.fontStyle) clean.fontStyle = spec.fontStyle;
    if (spec.color) clean.color = spec.color;
    out.push(clean);
  }
  return out;
}

export class EditorController {
  private canvas: Canvas | null = null;
  private listeners = new Set<Listener>();
  private history = new HistoryStack<string>();
  private state: EditorState = {
    ready: false,
    tool: "select",
    zoom: 1,
    tx: 0,
    ty: 0,
    document: { width: A4_WIDTH, height: A4_HEIGHT },
    selection: [],
    layers: [],
    hasReference: false,
    referenceVisible: true,
    referenceOpacity: 0.25,
    referenceCrop: { ...EMPTY_REFERENCE_CROP },
    referenceRotation: 0,
    referenceName: "Bill reference",
    gridVisible: false,
    snapToGrid: false,
    gridSize: 10,
    canUndo: false,
    canRedo: false,
    editingCell: null,
    selectedTable: null,
    pendingTable: null,
    documentName: "Untitled bill template",
    objectCount: 0,
    dataFieldCount: 0,
    placeholders: [],
    computedSpecs: [],
    sampledColour: null,
    structureLocked: false,
    groups: [],
    snapToObjects: true,
    fullSpanRules: false,
    normaliseBillParts: true,
    snaps: [],
  };

  private reference: ReferenceHandle | null = null;
  private drawing: FabricObject | null = null;
  private drawOrigin: { x: number; y: number } | null = null;
  private polygonPoints: Array<{ x: number; y: number }> = [];
  private polygonPreview: Polygon | null = null;

  private polygonMarkers: FabricObject[] = [];
  private polygonGuide: Line | null = null;
  private pencil: PencilBrush | null = null;

  private spanTarget: FabricObject | null = null;

  private gestureAnchor: { left: number; top: number } | null = null;

  private lastKnownScenePoint: { x: number; y: number } | null = null;

  private lastSelected: FabricObject[] = [];
  private isPanning = false;
  private spaceHeld = false;
  private lastPan: { x: number; y: number } | null = null;
  private suppressHistory = false;
  private disposed = false;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.state;

  private refreshStrokeFloors(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const zoom = () => canvas.getZoom();
    for (const obj of canvas.getObjects()) {
      if (!usesDefaultStroke(obj as unknown as { appType?: string })) continue;
      applyStrokeFloor(obj as unknown as Record<string, unknown> & { strokeWidth?: number }, zoom);
    }
  }

  private setState(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  whenReady(): Promise<void> {
    if (this.canvas) return Promise.resolve();
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.readyResolvers.push(resolve);
      });
    }
    return this.readyPromise;
  }

  private markReady(): void {
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    this.readyPromise = null;
    for (const r of resolvers) r();
  }

  attach(element: HTMLCanvasElement): void {
    registerAppProperties();
    const canvas = new Canvas(element, {
      width: Math.max(1, Math.round(this.viewport.width)),
      height: Math.max(1, Math.round(this.viewport.height)),
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.canvas = canvas;

    canvas.on("mouse:down", this.onMouseDown);
    canvas.on("mouse:dblclick", this.onMouseDblClick);
    canvas.on("mouse:move", this.onMouseMove);
    canvas.on("mouse:up", this.onMouseUp);
    canvas.on("mouse:wheel", this.onWheel);
    canvas.on("object:moving", this.onObjectMoving);
    canvas.on("object:scaling", this.onObjectScaling);
    canvas.on("object:skewing", this.onObjectSkewing);
    canvas.on("object:modified", this.onObjectModified);
    canvas.on("text:changed", this.onTextChanged);
    canvas.on("selection:created", this.onSelectionChanged);
    canvas.on("selection:updated", this.onSelectionChanged);
    canvas.on("selection:cleared", this.onSelectionChanged);

    canvas.on("object:added", () => {
      this.refreshStrokeFloors();
    });

    this.pencil = new PencilBrush(canvas);
    this.pencil.color = "#000000";

    this.pencil.width = DEFAULT_STROKE_WIDTH;

    this.refreshStrokeFloors();

    this.markBaseline();
    this.refresh();
    this.setState({ ready: true });
    this.markReady();
  }

  detach(): void {
    this.disposed = true;
    const canvas = this.canvas;
    if (canvas) {
      canvas.off("mouse:down", this.onMouseDown);
      canvas.off("mouse:dblclick", this.onMouseDblClick);
      canvas.off("mouse:move", this.onMouseMove);
      canvas.off("mouse:up", this.onMouseUp);
      canvas.off("mouse:wheel", this.onWheel);
      canvas.off("object:moving", this.onObjectMoving);
      canvas.off("object:scaling", this.onObjectScaling);
      canvas.off("object:skewing", this.onObjectSkewing);
      canvas.off("object:modified", this.onObjectModified);
      canvas.off("text:changed", this.onTextChanged);
      canvas.off("selection:created", this.onSelectionChanged);
      canvas.off("selection:updated", this.onSelectionChanged);
      canvas.off("selection:cleared", this.onSelectionChanged);
      canvas.dispose();
    }
    this.canvas = null;
    this.reference = null;
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  getCanvas(): Canvas | null {
    return this.canvas;
  }

  private lockReferenceToDocument(): void {
    if (this.reference) fitTo(this.reference, this.state.document);
    this.canvas?.requestRenderAll();
  }

  setDocument(width: number, height: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (
      !Number.isFinite(width) || !Number.isFinite(height) ||
      width < 100 || height < 100 || width > 20000 || height > 20000
    ) return;
    if (width === this.state.document.width && height === this.state.document.height) return;
    this.setState({ document: { width, height } });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    this.fit();
    this.commit("Change page size");
  }

  private applyCanvasSize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.setDimensions({
      width: Math.max(1, Math.round(this.viewport.width)),
      height: Math.max(1, Math.round(this.viewport.height)),
    });
  }

  get view(): Viewport {
    return { zoom: this.state.zoom, tx: this.state.tx, ty: this.state.ty };
  }

  projectToScreen(point: { x: number; y: number }): { x: number; y: number } {
    return sceneToScreen(point, this.view);
  }

  screenToScenePoint(point: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    return screenToScene(point, this.view);
  }

  private applyView(view: Viewport): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.setViewportTransform(viewportTransform(view));
    this.setState({ zoom: view.zoom, tx: view.tx, ty: view.ty });

    this.refreshStrokeFloors();
    canvas.requestRenderAll();
  }

  setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const centre = {
      x: this.viewport.width / 2,
      y: this.viewport.height / 2,
    };
    const next = zoomAbout(
      anchor ?? centre,
      zoom,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.userHasZoomed = true;
    this.applyView(next);
  }

  zoomAt(anchor: { x: number; y: number }, zoom: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const next = zoomAbout(
      anchor,
      zoom,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.userHasZoomed = true;
    this.applyView(next);
  }

  zoomIn(): void {
    this.setZoom(this.state.zoom * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.state.zoom / 1.2);
  }

  resetZoom(): void {
    this.fit();
  }

  panBy(dx: number, dy: number): void {
    const next = panViewBy(
      dx,
      dy,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.applyView(next);
  }

  private stageEl: HTMLElement | null = null;

  setStageElement(el: HTMLElement | null): void {
    this.stageEl = el;
    if (el) this.setViewportSize(el.clientWidth, el.clientHeight);
  }

  private viewport = { width: 800, height: 1000 };

  private userHasZoomed = false;

  setViewportSize(width: number, height: number): void {
    const changed =
      Math.abs(width - this.viewport.width) > 1 ||
      Math.abs(height - this.viewport.height) > 1;
    this.viewport = { width, height };
    this.applyCanvasSize();

    if (changed && !this.userHasZoomed) this.fit();
  }

  getViewportSize(): { width: number; height: number } {
    return this.viewport;
  }

  fit(): void {
    const { width, height } = this.state.document;
    const margin = 24;
    const fitted = {
      width: Math.max(120, this.viewport.width - margin * 2),
      height: Math.max(120, this.viewport.height - margin * 2),
    };
    const zoom = clampZoom(
      containScale(fitted, { width, height }),
      fitted,
      { width, height },
    );
    this.userHasZoomed = false;
    this.applyView({
      zoom,
      tx: (this.viewport.width - width * zoom) / 2,
      ty: (this.viewport.height - height * zoom) / 2,
    });
  }

  fitToView(viewportWidth: number, viewportHeight: number): void {
    this.setViewportSize(viewportWidth, viewportHeight);
    this.fit();
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.defaultCursor = held ? "grab" : "default";
    canvas.selection = !held && this.state.tool === "select";
  }

  isSpaceHeld(): boolean {
    return this.spaceHeld;
  }

  async addReference(dataUrl: string): Promise<{ width: number; height: number }> {
    const canvas = this.canvas;
    if (!canvas) throw new Error("Canvas not ready");
    const ref = await install(canvas, dataUrl, this.state.referenceOpacity);
    this.reference?.image.dispose();
    this.reference = ref;

    const docWidth = ref.width || A4_WIDTH;
    const docHeight = ref.height || A4_HEIGHT;
    this.setState({
      document: { width: docWidth, height: docHeight },
      hasReference: true,
      referenceVisible: true,
      referenceCrop: { ...EMPTY_REFERENCE_CROP },
      referenceRotation: 0,
    });
    fitTo(ref, { width: docWidth, height: docHeight });
    this.applyCanvasSize();

    this.fit();
    this.markBaseline();
    this.refresh();
    return { width: docWidth, height: docHeight };
  }

  setReferenceOpacity(value: number): void {
    const opacity = Math.min(1, Math.max(0, value));
    setOpacity(this.reference, opacity);
    this.canvas?.requestRenderAll();
    this.setState({ referenceOpacity: opacity });
  }

  setReferenceVisible(visible: boolean): void {
    if (this.canvas) setVisible(this.canvas, this.reference, visible);
    this.setState({ referenceVisible: visible });
  }

  async setReferenceAdjustments(
    crop: ReferenceCrop,
    rotation: 0 | 90 | 180 | 270,
  ): Promise<void> {
    const canvas = this.canvas;
    const current = this.reference;
    if (!canvas || !current) return;
    const next = await buildAdjustedReference(current, crop, rotation, this.state.referenceOpacity);
    next.image.set({ selectable: false, evented: false } as never);
    canvas.backgroundImage = this.state.referenceVisible ? next.image : undefined;
    canvas.backgroundColor = sampleBorderColor(next.image);
    fitTo(next, this.state.document);
    canvas.requestRenderAll();
    current.image.dispose();
    this.reference = next;
    this.setState({ referenceCrop: next.crop, referenceRotation: next.rotation });
  }

  async rotateReference(direction: "left" | "right"): Promise<void> {
    const turn = direction === "right" ? 90 : 270;
    const rotation = ((this.state.referenceRotation + turn) % 360) as 0 | 90 | 180 | 270;
    await this.setReferenceAdjustments(this.state.referenceCrop, rotation);
  }

  async fitReferenceToPage(): Promise<void> {
    const current = this.reference;
    if (!current) return;
    const crop = cropForPage(current.sourceWidth, current.sourceHeight, this.state.document, this.state.referenceRotation);
    await this.setReferenceAdjustments(crop, this.state.referenceRotation);
  }

  async resetReferenceAdjustments(): Promise<void> {
    await this.setReferenceAdjustments({ ...EMPTY_REFERENCE_CROP }, 0);
  }

  selectGuide(guideId: string): boolean {
    const canvas = this.canvas;
    const guide = canvas?.getObjects().find((object) => isGuide(object) && (object as { guideId?: string }).guideId === guideId);
    if (!canvas || !guide) return false;
    this.setTool("select");
    canvas.setActiveObject(guide);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  removeReference(): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) return;
    this.reference.image.dispose();
    this.reference = null;
    remove(canvas);
    this.setState({
      hasReference: false,
      referenceVisible: false,
      referenceCrop: { ...EMPTY_REFERENCE_CROP },
      referenceRotation: 0,
    });
    this.refresh();
  }

  setTool(tool: ToolId): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.cancelPolygon();

    this.setState({ tool, editingCell: null });
    if (tool === "freehand" && this.pencil) {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush = this.pencil;
    } else {
      canvas.isDrawingMode = false;
    }
    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "select" ? "default" : "crosshair";
    canvas.forEachObject((o) => {
      o.selectable = tool === "select" && !this.isLocked(o);
      o.evented = tool === "select";
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    this.spanTarget = null;
    this.setSnaps([]);
    this.refresh();
  }

  private isLocked(o: FabricObject): boolean {
    return (o as unknown as { locked?: boolean }).locked === true;
  }

  private selectFinished(o: FabricObject): void {
    const canvas = this.canvas;
    if (!canvas) return;
    o.set({ selectable: true, evented: true } as never);
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
  }

  private getId(o: FabricObject): string {
    const id = (o as unknown as { id?: string }).id;
    return typeof id === "string" && id ? id : createId();
  }

  private tag(
    o: FabricObject,
    type: string,
    name?: string,
    role: string | null = null,
  ): void {
    o.set({
      id: createId(type.replace(/[^a-z]/gi, "")),
      name: name || defaultName(type, this.canvas?.getObjects().length ?? 0),
      role,

      appType: APP_TYPE_FOR[type] ?? type,
    } as never);
  }

  private sampleColourAt(p: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const vpt = canvas.viewportTransform;
    const el = canvas.lowerCanvasEl;
    const pxScaleX = el.width / Math.max(1, canvas.width);
    const pxScaleY = el.height / Math.max(1, canvas.height);
    const px = Math.round((p.x * vpt[0] + vpt[4]) * pxScaleX);
    const py = Math.round((p.y * vpt[3] + vpt[5]) * pxScaleY);
    try {
      const data = el
        .getContext("2d")!
        .getImageData(px, py, 1, 1).data;
      const hex = `#${[data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
      const alive = this.lastSelected.filter((o) =>
        canvas.getObjects().includes(o),
      );
      if (alive.length === 1) {
        alive[0]!.set({ fill: hex } as never);
        this.commit("Set colour");
      }
      this.setState({ sampledColour: hex });
    } catch {

    }
  }

  private onMouseDblClick = (opt: TPointerEventInfo): void => {
    const table = opt.target;
    if (!(table instanceof BillTable)) return;
    if (this.state.tool !== "select") return;
    if (this.spaceHeld) return;

    const p = opt.scenePoint;
    const cell = table.cellAtCanvasPoint(p.x, p.y);
    if (!cell) return;

    this.beginCellEdit(table, cell.row * table.columns + cell.column);
  };

  private onMouseDown = (opt: TPointerEventInfo): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const p = opt.scenePoint;

    if (opt.target instanceof BillTable) {
      opt.target.beginResizeGesture({ x: p.x, y: p.y });
    }

    this.gestureAnchor = opt.target
      ? { left: opt.target.left ?? 0, top: opt.target.top ?? 0 }
      : null;
    this.lastKnownScenePoint = { x: p.x, y: p.y };

    if (
      this.state.tool === "select" &&
      opt.target &&
      !(opt.target instanceof BillTable)
    ) {
      const group = this.state.groups.find((g) =>
        g.members.includes(this.getId(opt.target!)),
      );
      if (group) {
        const members = opt.e?.altKey
          ? [opt.target]
          : this.groupObjectsOf(group.id);
        if (members.length > 0) {
          canvas.discardActiveObject();
          canvas.setActiveObject(
            members.length === 1
              ? members[0]!
              : new ActiveSelection(members, { canvas }),
          );
          canvas.requestRenderAll();
          this.refresh();
          return;
        }
      }
    }

    if (this.spaceHeld || opt.e?.altKey) return;

    const tool = this.state.tool;
    if (tool === "select") return;

    if (tool === "eyedropper") {
      this.sampleColourAt(p);
      return;
    }

    this.drawOrigin = { x: p.x, y: p.y };
    this.spanTarget = null;

    switch (tool) {
      case "line":
      case "hr":
      case "vr": {

        if (this.state.fullSpanRules) {
          const hits = canvas
            .getObjects()
            .filter((o) => {
              const at = (o as unknown as { appType?: string }).appType;
              if (at !== "rect" && at !== "rounded-rect") return false;
              const b = o.getBoundingRect();
              return (
                p.x >= b.left &&
                p.x <= b.left + b.width &&
                p.y >= b.top &&
                p.y <= b.top + b.height
              );
            })
            .sort((a, b) => {
              const ra = a.getBoundingRect();
              const rb = b.getBoundingRect();
              return ra.width * ra.height - rb.width * rb.height;
            });
          this.spanTarget = hits[0] ?? null;
        }
        this.beginLine(tool);
        break;
      }
      case "rect":
      case "rounded-rect":
      case "ellipse":
        this.beginShape(tool);
        break;
      case "image-placeholder":
        this.beginImagePlaceholder();
        break;
      case "guide-h":
      case "guide-v":
        this.addGuide(tool === "guide-h" ? "horizontal" : "vertical", p);
        break;
      case "bill-part":
        this.beginBillPart();
        break;
      case "field":
        this.beginField();
        break;
      case "table":

        this.setState({
          pendingTable: { id: "", x: p.x, y: p.y, width: 0, height: 0 },
        });
        this.beginTableBox();
        break;
      case "text": {
        const obj = new IText("Text", {
          left: p.x,
          top: p.y,
          fontFamily: "Arial",
          fontSize: 14,
          fill: "#000000",
        });
        this.tag(obj, "text");
        canvas.add(obj);
        this.commit("Add text");

        this.setTool("select");
        this.selectFinished(obj);
        break;
      }
      case "polygon":
        this.addPolygonVertex(p.x, p.y);
        break;
      case "freehand":

        break;
      default:
        break;
    }
  };

  private onMouseMove = (opt: TPointerEventInfo): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const p = opt.scenePoint;
    this.lastKnownScenePoint = { x: p.x, y: p.y };

    if (this.drawOrigin && this.drawing) {
      const dx = p.x - this.drawOrigin.x;
      const dy = p.y - this.drawOrigin.y;
      this.updateDrawing(dx, dy);
    } else if (this.state.tool === "polygon" && this.polygonPoints.length > 0) {
      this.updatePolygonGuide(p.x, p.y);
    }
  };

  private onMouseUp = (): void => {
    if (this.state.tool === "freehand" && this.canvas?.isDrawingMode) {

      const paths = this.canvas.getObjects().filter(
        (o) => o.type === "path",
      );
      const last = paths[paths.length - 1];
      if (last) {
        this.tag(last, "freehand");
        this.normaliseFreehand(last);
        this.commit("Freehand");
      }
      return;
    }

    this.spanTarget = null;
    this.setSnaps([]);

    if (!this.drawing) return;
    const obj = this.drawing;
    const box = this.finaliseDrawing();
    this.drawing = null;
    this.drawOrigin = null;

    if (!box) return;
    if (box.width < 2 && box.height < 2) {
      this.canvas?.remove(obj);
      this.canvas?.requestRenderAll();
      this.setState({ pendingTable: null });
      return;
    }

    const isTable =
      (obj as unknown as { appType?: string }).appType === "table";
    if ((obj as unknown as { appType?: string }).appType === "bill-part") {
      this.setTool("select");
      this.finishBillPart(obj, box);
      return;
    }
    if (isTable) {
      this.setState({
        pendingTable: {

          id: this.getId(obj),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
      });
    }
    this.commit(isTable ? "Add table" : "Add shape");
    this.setTool("select");

    if (!isTable) this.selectFinished(obj);
  };

  private beginLine(tool: "line" | "hr" | "vr"): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const line = new Line([o.x, o.y, o.x, o.y], {
      stroke: "#000000",
      strokeWidth: DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });
    line.set({ x2: o.x, y2: o.y, ruleKind: tool } as never);
    this.tag(line, tool);
    canvas.add(line);
    this.drawing = line;
  }

  private beginShape(tool: "rect" | "rounded-rect" | "ellipse"): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const common = {
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,

      originX: "left" as const,
      originY: "top" as const,
    };
    const obj =
      tool === "ellipse"
        ? new Ellipse({ ...common, rx: 0.5, ry: 0.5 })
        : new Rect({
            ...common,
            rx: tool === "rounded-rect" ? 8 : 0,
            ry: tool === "rounded-rect" ? 8 : 0,
          });
    this.tag(obj, tool);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginImagePlaceholder(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const obj = new ImagePlaceholderObject({
      placeholderRole: "image",
      label: "IMAGE",
    });
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "image-placeholder", "Image Placeholder 1");
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginBillPart(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const count = this.tracedObjects().filter(
      (x) => (x as unknown as { appType?: string }).appType === "bill-part",
    ).length;
    const obj = new BillPartObject();
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "bill-part", `Bill Part ${count + 1}`);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginField(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const count = this.tracedObjects().filter(
      (x) => (x as unknown as { appType?: string }).appType === "field",
    ).length;
    const key = `field_${count + 1}`;
    const obj = new FieldObject({
      key,
      fieldType: "text",
      label: `{{${key}}}`,
    });
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "field", `Field ${count + 1}`);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginTableBox(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const table = new BillTable({
      colWidths: [MIN_COL_WIDTH * 4, MIN_COL_WIDTH * 4],
      rowHeights: [MIN_ROW_HEIGHT * 3, MIN_ROW_HEIGHT * 3],
    });
    table.set({
      left: o.x,
      top: o.y,
      selectable: false,
      evented: false,
    } as never);

    this.tag(table, "table", this.nextTableName(), "items");
    canvas.add(table);
    this.drawing = table;
  }

  private updateDrawing(dx: number, dy: number): void {
    const obj = this.drawing;
    const origin = this.drawOrigin;
    if (!obj || !origin) return;
    const canvas = this.canvas;
    if (!canvas) return;

    const appType = (obj as unknown as { appType?: string }).appType;
    const ruleKind = (obj as unknown as { ruleKind?: string }).ruleKind;

    if (ruleKind === "line" || ruleKind === "hr" || ruleKind === "vr") {

      if (this.spanTarget) {
        const b = this.spanTarget.getBoundingRect();

        const horizontal =
          ruleKind === "hr" ||
          (ruleKind === "line" && Math.abs(dy) <= Math.abs(dx));
        if (horizontal) {

          obj.set({
            x1: b.left,
            y1: origin.y,
            x2: b.left + b.width,
            y2: origin.y,
          } as never);
          this.setSnaps([{ axis: "y", pos: origin.y }]);
        } else {
          obj.set({
            x1: origin.x,
            y1: b.top,
            x2: origin.x,
            y2: b.top + b.height,
          } as never);
          this.setSnaps([{ axis: "x", pos: origin.x }]);
        }
        obj.setCoords();
        canvas.requestRenderAll();
        return;
      }

      let x2 = origin.x + dx;
      let y2 = origin.y + dy;
      if (ruleKind === "hr") y2 = origin.y;
      if (ruleKind === "vr") x2 = origin.x;

      if (this.state.snapToObjects) {
        const tol = 6 / (this.state.zoom || 1);
        const levels = this.levelsForSnapTargets(obj);
        if (ruleKind === "hr") {
          const hit = snapToLevels(
            { left: origin.x, centreX: (origin.x + x2) / 2, right: x2, top: y2, centreY: y2, bottom: y2 },
            levels, tol,
          );
          if (hit.dy !== 0) y2 += hit.dy;
          if (hit.dx !== 0) x2 += hit.dx;
          this.setSnaps(hit.guides);
        } else if (ruleKind === "vr") {
          const hit = snapToLevels(
            { left: x2, centreX: x2, right: x2, top: origin.y, centreY: (origin.y + y2) / 2, bottom: y2 },
            levels, tol,
          );
          if (hit.dx !== 0) x2 += hit.dx;
          if (hit.dy !== 0) y2 += hit.dy;
          this.setSnaps(hit.guides);
        } else {
          const hit = snapToLevels(
            {
              left: Math.min(origin.x, x2),
              centreX: (origin.x + x2) / 2,
              right: Math.max(origin.x, x2),
              top: Math.min(origin.y, y2),
              centreY: (origin.y + y2) / 2,
              bottom: Math.max(origin.y, y2),
            },
            levels, tol,
          );
          if (hit.dx !== 0) x2 += hit.dx;
          if (hit.dy !== 0) y2 += hit.dy;
          this.setSnaps(hit.guides);
        }
      } else if (this.state.snaps.length > 0) {
        this.setSnaps([]);
      }
      obj.set({ x2, y2 } as never);
      obj.setCoords();
    } else if (appType === "table") {
      const table = obj as BillTable;
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      table.colWidths = evenSizes(
        table.columns,
        Math.max(MIN_COL_WIDTH * 2, w),
        MIN_COL_WIDTH,
      );
      table.rowHeights = evenSizes(
        table.rows,
        Math.max(MIN_ROW_HEIGHT * 2, h),
        MIN_ROW_HEIGHT,
      );
      table.syncDimensions();
    } else {
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      const left = dx < 0 ? origin.x + dx : origin.x;
      const top = dy < 0 ? origin.y + dy : origin.y;
      obj.set({ left, top, width: w, height: h } as never);

      if (appType === "ellipse") {
        obj.set({ rx: w / 2, ry: h / 2 } as never);
      }
      obj.setCoords();
    }
    canvas.requestRenderAll();
  }

  private finaliseDrawing(): { x: number; y: number; width: number; height: number } | null {
    const obj = this.drawing;
    if (!obj) return null;
    obj.set({ selectable: true, evented: true } as never);
    obj.setCoords();
    if (ruleKindOf(obj)) {
      const x2 = (obj as unknown as { x2?: number }).x2 ?? obj.left ?? 0;
      const y2 = (obj as unknown as { y2?: number }).y2 ?? obj.top ?? 0;
      const x1 = obj.left ?? 0;
      const y1 = obj.top ?? 0;
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }
    return {
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      width: obj.width ?? 0,
      height: obj.height ?? 0,
    };
  }

  private finishBillPart(
    obj: FabricObject,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) {
      canvas?.remove(obj);
      canvas?.requestRenderAll();
      this.refresh();
      return;
    }

    let crop: BillPartCrop | null = null;
    try {
      crop = cropBillPart(
        this.reference,
        this.state.document,
        {
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        },
        { normalise: this.state.normaliseBillParts },
      );
    } catch {
      crop = null;
    }
    canvas.remove(obj);
    if (!crop) {
      canvas.requestRenderAll();
      this.refresh();
      return;
    }
    const next = new BillPartObject({
      src: crop.src,
      normalized: crop.normalized,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    next.set({
      id: (obj as unknown as { id?: string }).id,
      name: (obj as unknown as { name?: string }).name,
      role: (obj as unknown as { role?: string }).role,

      left: crop.rect.left,
      top: crop.rect.top,
      width: crop.width,
      height: crop.height,
      scaleX: crop.rect.width / crop.width,
      scaleY: crop.rect.height / crop.height,
      selectable: true,
      evented: true,
    } as never);
    canvas.add(next);
    this.commit("Add bill part");
    this.selectFinished(next);
  }

  private addPolygonVertex(x: number, y: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.polygonPoints.push({ x, y });
    this.addPolygonMarker(x, y);

    if (this.polygonPreview) {
      this.polygonPreview.set({ points: [...this.polygonPoints] } as never);
      this.polygonPreview.setCoords();
    } else {
      this.polygonPreview = new Polygon([...this.polygonPoints], {
        fill: "transparent",
        stroke: "#000000",
        strokeWidth: DEFAULT_STROKE_WIDTH,
        selectable: false,
        evented: false,
      });
      canvas.add(this.polygonPreview);
    }
    canvas.requestRenderAll();
  }

  finishPolygon(): void {
    const canvas = this.canvas;
    if (!canvas || this.polygonPoints.length < 2) {
      this.cancelPolygon();
      return;
    }
    const preview = this.polygonPreview;
    if (preview) {
      preview.set({ points: [...this.polygonPoints] } as never);
      preview.set({ fill: "rgba(0,0,0,0.05)" } as never);
      this.tag(preview, "polygon");
      preview.set({ selectable: true, evented: true } as never);
      preview.setCoords();
      this.commit("Add polygon");
    }
    this.clearPolygonMarkers();
    this.polygonPoints = [];
    this.polygonPreview = null;
    this.setTool("select");
  }

  cancelPolygon(): void {
    this.clearPolygonMarkers();
    if (this.polygonPreview) {
      this.canvas?.remove(this.polygonPreview);
      this.polygonPreview = null;
    }
    this.polygonPoints = [];
    this.canvas?.requestRenderAll();
  }

  private addPolygonMarker(x: number, y: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const dot = new Circle({
      left: x,
      top: y,
      radius: 4 / this.state.zoom,
      originX: "center",
      originY: "center",
      fill: "#000000",
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    dot.set({ appType: POLYGON_MARKER_APP_TYPE } as never);
    canvas.add(dot);
    this.polygonMarkers.push(dot);
  }

  private updatePolygonGuide(x: number, y: number): void {
    const canvas = this.canvas;
    const from = this.polygonPoints[this.polygonPoints.length - 1];
    if (!canvas || !from) return;
    if (this.polygonGuide) {
      this.polygonGuide.set({ x1: from.x, y1: from.y, x2: x, y2: y } as never);
      this.polygonGuide.setCoords();
    } else {
      this.polygonGuide = new Line([from.x, from.y, x, y], {
        stroke: "#000000",
        strokeWidth: 1 / this.state.zoom,
        strokeDashArray: [6 / this.state.zoom, 4 / this.state.zoom],
        selectable: false,
        evented: false,
      });
      this.polygonGuide.set({ appType: POLYGON_MARKER_APP_TYPE } as never);
      canvas.add(this.polygonGuide);
    }
    canvas.requestRenderAll();
  }

  private clearPolygonMarkers(): void {
    const canvas = this.canvas;
    for (const marker of this.polygonMarkers) canvas?.remove(marker);
    this.polygonMarkers = [];
    if (this.polygonGuide) {
      canvas?.remove(this.polygonGuide);
      this.polygonGuide = null;
    }
    canvas?.requestRenderAll();
  }

  get isDrawingPolygon(): boolean {
    return this.polygonPoints.length > 0;
  }

  private normaliseFreehand(path: FabricObject): void {
    const raw = (path as unknown as { path?: Array<[number, number]> }).path;
    if (!Array.isArray(raw) || raw.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    for (const [px, py] of raw) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
    }
    const shifted = raw.map(
      ([px, py], i) => (i === 0 ? ["M", px - minX, py - minY] : ["L", px - minX, py - minY]) as ["M" | "L", number, number],
    );
    const p = new Path(shifted, {
      fill: "",
      stroke: (path.stroke as string) || "#000000",
      strokeWidth: (path.strokeWidth as number) || DEFAULT_STROKE_WIDTH,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    });
    p.set({ left: minX, top: minY } as never);
    (p as unknown as Record<string, unknown>).id = this.getId(path);
    (p as unknown as Record<string, unknown>).name = (
      path as unknown as { name?: string }
    ).name;
    (p as unknown as Record<string, unknown>).role = (
      path as unknown as { role?: string }
    ).role;
    p.setCoords();
    this.canvas?.remove(path);
    this.canvas?.add(p);
    this.canvas?.requestRenderAll();
  }

  private onObjectMoving = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!target) return;
    if (this.state.snapToGrid) {
      const size = this.state.gridSize;
      target.set({
        left: snap(target.left ?? 0, size),
        top: snap(target.top ?? 0, size),
      } as never);
      target.setCoords();
    }

    if (this.state.snapToObjects) {
      const b = target.getBoundingRect();
      const hit = snapToLevels(
        {
          left: b.left,
          centreX: b.left + b.width / 2,
          right: b.left + b.width,
          top: b.top,
          centreY: b.top + b.height / 2,
          bottom: b.top + b.height,
        },
        this.levelsForSnapTargets(target),
        6 / (this.state.zoom || 1),
      );
      if (hit.dx !== 0 || hit.dy !== 0) {
        target.set({
          left: (target.left ?? 0) + hit.dx,
          top: (target.top ?? 0) + hit.dy,
        } as never);
        target.setCoords();
      }
      this.setSnaps(hit.guides);
      this.canvas?.requestRenderAll();
    } else if (this.state.snaps.length > 0) {
      this.setSnaps([]);
      this.canvas?.requestRenderAll();
    }
  };

  private levelsForSnapTargets(exclude: FabricObject | null): Levels {
    const canvas = this.canvas;
    if (!canvas) return { x: [], y: [] };
    const boxes: Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
    }> = [];
    for (const o of canvas.getObjects()) {
      if (o === exclude) continue;
      const b = o.getBoundingRect();
      boxes.push({
        left: b.left,
        top: b.top,
        right: b.left + b.width,
        bottom: b.top + b.height,
      });
    }

    const ruleX: number[] = [];
    const ruleY: number[] = [];
    for (const o of canvas.getObjects()) {
      if (o === exclude) continue;
      const kind =
        (o as unknown as { appType?: string }).appType ?? o.type ?? "";
      if (kind === "hr") {
        const b = o.getBoundingRect();
        ruleY.push(b.top);
      } else if (kind === "vr") {
        const b = o.getBoundingRect();
        ruleX.push(b.left);
      }
    }
    const levels = levelsFromBounds(boxes);
    levels.x.push(...ruleX);
    levels.y.push(...ruleY);

    for (const o of canvas.getObjects()) {
      if (o === exclude || !(o instanceof BillTable)) continue;
      const b = o.getBoundingRect();
      const inner = interiorGridLevels(o.colWidths, o.rowHeights, {
        x: b.left,
        y: b.top,
      });
      levels.x.push(...inner.x);
      levels.y.push(...inner.y);
    }
    return levels;
  }

  private setSnaps(snaps: SnapLine[]): void {
    const current = this.state.snaps;
    const unchanged =
      snaps.length === current.length &&
      snaps.every(
        (s, i) => s.axis === current[i]!.axis && s.pos === current[i]!.pos,
      );
    if (unchanged) return;
    this.setState({ snaps });
  }

  setSnapToObjects(on: boolean): void {
    this.setState({ snapToObjects: on });
  }

  setFullSpanRules(on: boolean): void {
    this.setState({ fullSpanRules: on });
  }

  setNormaliseBillParts(on: boolean): void {
    this.setState({ normaliseBillParts: on });
  }

  private resolveScenePoint(
    e: TPointerEvent | undefined,
  ): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (canvas && e) {
      const p = canvas.getScenePoint(e);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        this.lastKnownScenePoint = { x: p.x, y: p.y };
        return this.lastKnownScenePoint;
      }
    }
    return this.lastKnownScenePoint;
  }

  private onObjectScaling = (opt: {
    target?: FabricObject;
    e?: TPointerEvent;
  }): void => {
    const target = opt.target;
    if (!target) return;

    const appType = (target as unknown as { appType?: string }).appType;
    if (appType === "table") {

      const table = target as BillTable;
      const gesture = table.resizeGesture;
      const p = this.resolveScenePoint(opt.e);
      if (gesture && p) {

        const width = gesture.width + (p.x - gesture.startX) * gesture.signX;
        const height = gesture.height + (p.y - gesture.startY) * gesture.signY;
        table.set({
          left: this.gestureAnchor?.left ?? table.left,
          top: this.gestureAnchor?.top ?? table.top,
        } as never);
        table.resizeColumnsTo(width);
        table.resizeRowsTo(height);
      } else {

        const factorX = table.scaleX;
        const factorY = table.scaleY;
        table.scaleColumns(factorX);
        table.scaleRows(factorY);
      }

      table.set({ scaleX: 1, scaleY: 1 } as never);
      table.setCoords();
      this.canvas?.requestRenderAll();
      return;
    }

    if (target instanceof BillPartObject) {
      const xFactor = target.scaleX ?? 1;
      const yFactor = target.scaleY ?? 1;
      const factor =
        Math.abs(xFactor - 1) >= Math.abs(yFactor - 1) ? xFactor : yFactor;
      target.set({ scaleX: factor, scaleY: factor } as never);
      target.setCoords();
    }

    if (this.state.snapToGrid) {
      const size = this.state.gridSize;
      target.set({
        left: snap(target.left ?? 0, size),
        top: snap(target.top ?? 0, size),
      } as never);
    }
    target.setCoords();

    if (this.state.snapToObjects) {
      const b = target.getBoundingRect();
      const hit = snapToLevels(
        {
          left: b.left,
          centreX: b.left + b.width / 2,
          right: b.left + b.width,
          top: b.top,
          centreY: b.top + b.height / 2,
          bottom: b.top + b.height,
        },
        this.levelsForSnapTargets(target),
        6 / (this.state.zoom || 1),
      );
      this.setSnaps(hit.guides);
      this.canvas?.requestRenderAll();
    } else if (this.state.snaps.length > 0) {
      this.setSnaps([]);
      this.canvas?.requestRenderAll();
    }
  };

  private onObjectSkewing = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!(target instanceof BillTable)) return;
    target.set({ skewX: 0, skewY: 0, scaleX: 1, scaleY: 1 } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
  };

  private onObjectModified = (opt: { target?: FabricObject }): void => {

if (opt.target instanceof BillTable) opt.target.endResizeGesture();
      else this.getTable()?.endResizeGesture();

      if (opt.target && isGuide(opt.target)) this.syncGuides();
      this.lastKnownScenePoint = null;
      this.commit("Transform");
    };

  private onTextChanged = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!target) return;
    const text = (target as unknown as { text?: string }).text ?? "";
    const info = analysePlaceholdersSafe(text);
    (target as unknown as Record<string, unknown>).roleKind = info.roleKind;
    if (info.role) {
      (target as unknown as Record<string, unknown>).role = info.role;
    }
  };

  private onSelectionChanged = (): void => {
    const active = this.canvas?.getActiveObjects();
    if (active && active.length > 0) {
      this.lastSelected = [...active];
    }
    this.refresh();
  };

  private onWheel = (opt: TPointerEventInfo<WheelEvent>): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const e = opt.e;

    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY;
    const factor = 0.999 ** delta;
    this.zoomAt(
      { x: opt.viewportPoint.x, y: opt.viewportPoint.y },
      this.state.zoom * factor,
    );
  };

  private addGuide(
    orientation: "horizontal" | "vertical",
    at: { x: number; y: number },
  ): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const existing = guidesFromObjects(canvas.getObjects());
    const guide: LayoutGuide = {
      id: nextGuideId(existing),
      orientation,
      position: orientation === "horizontal" ? at.y : at.x,
    };

    canvas.add(this.makeGuideOverlay(guide));
    this.syncGuides();
    this.commit("Add guide");
    this.setTool("select");
  }

  private makeGuideOverlay(guide: LayoutGuide): Line {
    const { width, height } = this.state.document;
    const points: [number, number, number, number] =
      guide.orientation === "horizontal"
        ? [0, 0, width, 0]
        : [0, 0, 0, height];
    const line = new Line(points, {
      left: 0,
      top: guide.position,
      stroke: "#2563eb",
      strokeWidth: 1,
      strokeDashArray: [6, 4],
      strokeUniform: true,
      originX: "left",
      originY: "top",
      selectable: true,
      evented: true,
      hasControls: false,
      excludeFromExport: true,
    });
    this.tag(line, GUIDE_APP_TYPE, `Guide ${guide.id}`);
    line.set({
      guideId: guide.id,
      guideOrientation: guide.orientation,
      ...(guide.maxDisplacement !== undefined
        ? { guideMaxDisplacement: guide.maxDisplacement }
        : {}),
    } as never);
    return line;
  }

  private restoreGuides(guides: readonly LayoutGuide[]): void {
    const canvas = this.canvas;
    if (!canvas) return;
    for (const g of guides) canvas.add(this.makeGuideOverlay(g));
  }

  private syncGuides(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const guides = guidesFromObjects(canvas.getObjects());
    this.setState({ layout: withLayoutMode(this.state.layout, guides) ?? undefined });
  }

  private tracedObjects(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    return canvas.getObjects().filter((o) => !isGuide(o) && !isPolygonMarker(o));
  }

  private snapshot(): string {
    const canvas = this.canvas;
    if (!canvas) return "";
    const template = serialiseObjects(
      this.tracedObjects() as never,
      this.state.document,
      this.state.documentName,
      this.state.layout,
    );
    if (this.state.placeholders.length > 0) {
      template.meta.placeholders = this.state.placeholders;
    }
    if (this.state.computedSpecs.length > 0) {
      template.meta.computed = this.state.computedSpecs;
    }
    return JSON.stringify({
      template,
      groups: this.state.groups,
    });
  }

  private baseline: string | null = null;

  private markBaseline(): void {
    this.baseline = this.snapshot();
  }

  private restoreSnapshot(raw: string): void {
    const canvas = this.canvas;
    if (!canvas || !raw) return;
    let template: BillTemplate;
    let groups: GroupNode[] = [];
    try {
      const parsed = JSON.parse(raw) as {
        template?: BillTemplate;
        groups?: GroupNode[];
      } & BillTemplate;

      template = (parsed.template ?? parsed) as BillTemplate;
      groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      if (
        !template ||
        typeof template !== "object" ||
        !Array.isArray(template.objects) ||
        !template.document ||
        typeof template.document.width !== "number" ||
        typeof template.document.height !== "number"
      ) {
        return;
      }
    } catch {

      return;
    }
    this.suppressHistory = true;
    canvas.discardActiveObject();
    for (const o of this.tracedObjects()) canvas.remove(o);
    const objects = hydrateTemplate(template);
    for (const o of objects) canvas.add(o);
    this.refreshStrokeFloors();
    canvas.requestRenderAll();
    this.suppressHistory = false;
    this.setState({
      editingCell: null,
      pendingTable: null,
      document: { ...template.document },
      placeholders: normalisePlaceholderSpecs(template.meta?.placeholders),
      computedSpecs: Array.isArray(template.meta?.computed) ? template.meta.computed : [],
      groups,

      layout: template.layout,
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();

    this.panBy(0, 0);
    this.refresh();
  }

  commit(label: string): void {
    if (this.suppressHistory) return;
    const canvas = this.canvas;
    if (!canvas) return;
    const after = this.snapshot();
    const before = this.baseline;
    this.baseline = after;

    if (before !== null && before !== after) {
      this.history.push({ label, before, after });
    }
    this.setState({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.refresh();
  }

  undo(): void {
    const entry = this.history.undo();
    if (!entry) return;
    this.restoreSnapshot(entry.before);
    this.baseline = this.snapshot();
    this.setState({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  redo(): void {
    const entry = this.history.redo();
    if (!entry) return;
    this.restoreSnapshot(entry.after);
    this.baseline = this.snapshot();
    this.setState({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  getGroups(): GroupNode[] {
    return this.state.groups;
  }

  setTextWrap(on: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const source = this.getActiveObjects().find(
      (o): o is IText | Textbox =>
        !this.isLocked(o) && (o instanceof IText || o instanceof Textbox),
    );
    if (!source) return;
    const asTextbox = on && !(source instanceof Textbox);
    const asText = !on && source instanceof Textbox;
    if (!asTextbox && !asText) return;

    const shared = {
      left: source.left,
      top: source.top,
      fontFamily: source.fontFamily,
      fontSize: source.fontSize,
      fontWeight: source.fontWeight,
      fontStyle: source.fontStyle,
      textAlign: source.textAlign,
      lineHeight: source.lineHeight,
      charSpacing: source.charSpacing,
      fill: source.fill,
      stroke: source.stroke,
      strokeWidth: source.strokeWidth,
      scaleX: source.scaleX,
      scaleY: source.scaleY,
    };
    const next: IText | Textbox = asTextbox
      ? new Textbox(source.text, {
          ...shared,

          width: source.width,
        })
      : new IText(source.text, shared);

    const carried = source as unknown as Record<string, unknown>;
    const nextCarried = next as unknown as Record<string, unknown>;
    for (const key of [
      "id",
      "name",
      "role",
      "roleKind",
      "locked",
      "zIndex",
      "parentId",
      "visible",
      "opacity",
    ]) {
      nextCarried[key] = carried[key];
    }
    nextCarried.appType = "text";
    nextCarried.wrapWidth = asTextbox ? source.width : undefined;
    next.set({
      selectable: true,
      evented: true,
      angle: source.angle,
    } as never);

    canvas.remove(source);
    canvas.add(next);
    next.setCoords();
    canvas.setActiveObject(next);
    canvas.requestRenderAll();
    this.commit(on ? "Wrap text" : "Stop wrapping");
    this.refresh();
  }

  groupObjectsOf(groupId: string): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const ids = new Set(subtreeIds(groupId, this.state.groups));
    const wanted = new Set<string>();
    for (const g of this.state.groups) {
      if (!ids.has(g.id)) continue;
      for (const m of g.members) wanted.add(m);
    }
    return canvas.getObjects().filter((o) => wanted.has(this.getId(o)));
  }

  groupSelection(): void {
    if (!this.canvas) return;
    const targets = this.getActiveObjects().filter((o) => !this.isLocked(o));
    if (targets.length < 2) return;
    const ids = targets.map((o) => this.getId(o));
    const name = `Group ${this.state.groups.length + 1}`;
    const next = groupObjectsIn(ids, createId("grp"), name, this.state.groups);
    this.setState({ groups: next });
    this.commit("Group");
  }

  ungroupSelection(): void {
    if (!this.canvas) return;
    const target = this.state.groups.find((g) =>
      this.getActiveObjects().some((o) => g.members.includes(this.getId(o))),
    );
    if (!target) return;
    this.setState({ groups: ungroupIn(target.id, this.state.groups) });
    this.commit("Ungroup");
  }

  getActiveObjects(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const active = canvas.getActiveObject();
    if (!active) return [];
    if (active instanceof ActiveSelection) return active.getObjects();
    return [active];
  }

  deleteSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    const groupIds = new Set<string>();
    const objects: FabricObject[] = [];
    const droppedGuides = new Set<string>();
    for (const o of this.getActiveObjects()) {
      const id = this.getId(o);
      for (const g of this.state.groups) {
        if (g.members.includes(id)) groupIds.add(g.id);
      }
      if (isGuide(o)) {

        const guideId = (o as unknown as { guideId?: string }).guideId;
        if (typeof guideId === "string") droppedGuides.add(guideId);
      }
      if (!this.isLocked(o)) objects.push(o);
    }
    if (groupIds.size === 0 && objects.length === 0) return;
    canvas.discardActiveObject();

    const removedIds = new Set(objects.map((o) => this.getId(o)));
    for (const o of canvas.getObjects()) {
      const rec = o as unknown as { layoutParentId?: unknown };
      if (typeof rec.layoutParentId === "string" && removedIds.has(rec.layoutParentId)) {
        o.set({ layoutParentId: null } as never);
      }
    }
    for (const o of objects) this.removeRecursive(o);
    const survivors = this.state.groups.filter((g) => !groupIds.has(g.id));
    this.setState({
      groups: pruneGroups(
        canvas.getObjects().map((o) => this.getId(o)),
        survivors,
      ),
    });

    if (objects.some(isGuide)) {
      const guides = guidesFromObjects(canvas.getObjects());
      const attachments = (this.state.layout?.attachments ?? []).filter(
        (a) => !droppedGuides.has(a.guideId),
      );
      const next = withLayoutMode(this.state.layout, guides);
      this.setState({
        layout:
          next && attachments.length > 0 ? { ...next, attachments } : next,
      });
    }
    canvas.requestRenderAll();
    this.commit(
      objects.length > 1 ? "Delete objects" : "Delete object",
    );
  }

  private removeRecursive(o: FabricObject): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (o instanceof BillTable || o instanceof ImagePlaceholderObject) {
      canvas.remove(o);
      return;
    }
    const group = o as unknown as { getObjects?: () => FabricObject[] };
    if (typeof group.getObjects === "function") {
      for (const child of group.getObjects()) this.removeRecursive(child);
    }
    canvas.remove(o);
  }

  duplicateSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const targets = this.getActiveObjects().filter(
      (o) => !this.isLocked(o),
    );
    if (targets.length === 0) return;
    const clones: FabricObject[] = [];
    for (const o of targets) {
      o.clone().then((clone) => {
        if (!clone) return;
        clone.set({
          left: (clone.left ?? 0) + 12,
          top: (clone.top ?? 0) + 12,
        } as never);
        (clone as unknown as Record<string, unknown>).id = createId();
        (clone as unknown as Record<string, unknown>).name = `${(o as unknown as { name?: string }).name ?? "Object"} copy`;
        canvas.add(clone);
        clones.push(clone);
        canvas.requestRenderAll();
        if (clones.length === targets.length) {
          if (clones.length === 1) {
            canvas.setActiveObject(clones[0]!);
          } else {
            canvas.setActiveObject(
              new ActiveSelection(clones, { canvas }),
            );
          }
          this.commit("Duplicate");
        }
      });
    }
  }

  selectAll(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objs = this.tracedObjects().filter((o) => !this.isLocked(o));
    if (objs.length === 0) return;
    if (objs.length === 1) canvas.setActiveObject(objs[0]!);
    else canvas.setActiveObject(new ActiveSelection(objs, { canvas }));
    canvas.requestRenderAll();
    this.refresh();
  }

  private selectionBounds(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return null;
    if (objects.length === 1) {
      const o = objects[0]!;
      return {
        left: o.left ?? 0,
        top: o.top ?? 0,
        width: o.getScaledWidth(),
        height: o.getScaledHeight(),
      };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const o of objects) {
      const b = o.getBoundingRect();
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      right = Math.max(right, b.left + b.width);
      bottom = Math.max(bottom, b.top + b.height);
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  align(kind: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return;
    const bounds = this.selectionBounds();
    if (!bounds) return;
    for (const o of objects) {
      const w = o.getScaledWidth();
      const h = o.getScaledHeight();
      switch (kind) {
        case "left":
          o.set({ left: bounds.left } as never);
          break;
        case "center":
          o.set({ left: bounds.left + (bounds.width - w) / 2 } as never);
          break;
        case "right":
          o.set({ left: bounds.left + bounds.width - w } as never);
          break;
        case "top":
          o.set({ top: bounds.top } as never);
          break;
        case "middle":
          o.set({ top: bounds.top + (bounds.height - h) / 2 } as never);
          break;
        case "bottom":
          o.set({ top: bounds.top + bounds.height - h } as never);
          break;
      }
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(`Align ${kind}`);
  }

  distribute(axis: "horizontal" | "vertical"): void {
    const objects = this.getActiveObjects();
    if (objects.length < 3) return;
    const horizontal = axis === "horizontal";
    const key = horizontal ? "left" : "top";
    const sizeKey = horizontal ? "getScaledWidth" : "getScaledHeight";

    const sorted = [...objects].sort(
      (a, b) => (a[key] ?? 0) - (b[key] ?? 0),
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const start = first[key] ?? 0;
    const end = (last[key] ?? 0) + last[sizeKey]();
    const totalSize = sorted.reduce((acc, o) => acc + o[sizeKey](), 0);
    const gap = (end - start - totalSize) / (sorted.length - 1);

    let cursor = start;
    for (const o of sorted) {
      o.set({ [key]: cursor } as never);
      cursor += o[sizeKey]() + gap;
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(`Distribute ${axis}`);
  }

  moveLayer(id: string, direction: "up" | "down" | "front" | "back"): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const target = canvas
      .getObjects()
      .find((o) => this.getId(o) === id);
    if (!target) return;
    if (direction === "up") canvas.bringObjectForward(target);
    if (direction === "down") canvas.sendObjectBackwards(target);
    if (direction === "front") canvas.bringObjectToFront(target);
    if (direction === "back") {
      canvas.sendObjectToBack(target);
    }
    canvas.requestRenderAll();
    this.commit("Reorder");
  }

  confirmTable(rows: number, columns: number): BillTable | null {
    const pending = this.state.pendingTable;
    const canvas = this.canvas;
    if (!pending || !canvas) return null;

    const table = canvas.getObjects().find(
      (o): o is BillTable => o instanceof BillTable && this.getId(o) === pending.id,
    );

    const r = Math.max(1, Math.min(60, Math.round(rows)));
    const c = Math.max(1, Math.min(30, Math.round(columns)));

    let target: BillTable;
    if (table) {

      table.colWidths = evenSizes(c, pending.width, MIN_COL_WIDTH);
      table.rowHeights = evenSizes(r, pending.height, MIN_ROW_HEIGHT);
      table.headerRow = r > 1;
      table.syncDimensions();
      target = table;
    } else {

      target = new BillTable({
        colWidths: evenSizes(c, Math.max(120, pending.width), MIN_COL_WIDTH),
        rowHeights: evenSizes(r, Math.max(80, pending.height), MIN_ROW_HEIGHT),
      });
      target.set({
        left: pending.x,
        top: pending.y,
        selectable: true,
        evented: true,
      } as never);
      this.tag(target, "table", this.nextTableName(), "items");
      canvas.add(target);
    }

    this.setState({ pendingTable: null });
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    this.commit("Create table");
    return target;
  }

  private nextTableName(): string {
    const existing = (
      this.canvas?.getObjects() ?? []
    ).filter((o) => o instanceof BillTable).length;
    return `Table ${existing + 1}`;
  }

  cancelPendingTable(): void {
    const canvas = this.canvas;
    const pending = this.state.pendingTable;

    if (canvas && pending?.id) {
      const stale = canvas
        .getObjects()
        .find(
          (o): o is BillTable =>
            o instanceof BillTable && this.getId(o) === pending.id,
        );
      if (stale) {
        canvas.remove(stale);
        canvas.requestRenderAll();
        this.commit("Cancel table");
      }
    }
    this.setState({ pendingTable: null });
  }

  beginCellEdit(table: BillTable, index: number): void {
    table.editingCell = index;
    this.setState({
      editingCell: { tableId: this.getId(table), index },
    });
    this.canvas?.requestRenderAll();
  }

  updateCell(table: BillTable, index: number, text: string): void {
    const cols = table.columns;
    const row = Math.floor(index / cols);
    const column = index % cols;
    table.setCellText(row, column, text);
    table.editingCell = index;
    this.canvas?.requestRenderAll();
    this.markCellDirty(table);
  }

  endCellEdit(table: BillTable): void {
    table.editingCell = -1;
    this.setState({ editingCell: null });
    this.canvas?.requestRenderAll();
    this.markCellDirty(table);
  }

  private cellDirty = new WeakSet<FabricObject>();
  private cellDirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolvers: Array<() => void> = [];

  private markCellDirty(table: BillTable): void {
    if (this.cellDirty.has(table)) return;
    this.cellDirty.add(table);
    if (this.cellDirtyTimer) clearTimeout(this.cellDirtyTimer);
    this.cellDirtyTimer = setTimeout(() => {
      this.cellDirty.delete(table);
      this.cellDirtyTimer = null;
      this.commit("Edit cell");
    }, 600);
  }

  applyToSelection(fn: (o: FabricObject) => void, label = "Edit object"): void {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return;
    for (const o of objects) {
      fn(o);
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  updateLayout(
    mutate: (layout: LayoutConfig | undefined) => LayoutConfig | undefined,
    label = "Edit layout",
  ): void {
    this.setState({ layout: mutate(this.state.layout) });
    this.commit(label);
  }

  setExpansion(
    objectId: string,
    expansion: ObjectExpansion | undefined,
    label = "Expansion",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ expansion } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  setLayoutParent(objectId: string, parentId: string | null, label = "Layout parent"): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    if (parentId !== null) {
      if (parentId === objectId) return;
      const exists = this.canvas?.getObjects().some((o) => this.getId(o) === parentId);
      if (!exists) return;
    }
    target.set({ layoutParentId: parentId } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  setAnchor(
    objectId: string,
    anchor: ChildAnchor | undefined,
    label = "Anchor",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ anchor } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  setContainer(
    objectId: string,
    container: ContainerPolicy | undefined,
    label = "Container",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ container } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  listLayoutParents(exceptId?: string): { id: string; name: string }[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const out: { id: string; name: string }[] = [];
    for (const o of canvas.getObjects()) {
      if (isGuide(o)) continue;
      const id = this.getId(o);
      if (!id || id === exceptId) continue;
      const rec = o as unknown as { name?: unknown };
      out.push({ id, name: typeof rec.name === "string" && rec.name ? rec.name : id });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  setAttachment(
    objectId: string,
    edge: AttachmentEdge,
    guideId: string | null,
    behaviorOrLabel: AttachmentBehavior | string = "move",
    label = "Attachment",
  ): void {
    const behavior: AttachmentBehavior =
      behaviorOrLabel === "stretch" ? "stretch" : "move";
    const historyLabel =
      behaviorOrLabel === "move" || behaviorOrLabel === "stretch"
        ? label
        : behaviorOrLabel;
    this.updateLayout((layout) => {
      const guides = layout?.guides ?? [];

      const others = (layout?.attachments ?? []).filter(
        (a) => !(a.objectId === objectId && a.edge === edge),
      );
      const attachments = guideId
        ? [
            ...others,
            {
              id: `att-${objectId}-${edge}`,
              objectId,
              edge,
              guideId,
              behavior: behavior === "stretch" ? ("stretch" as const) : ("move" as const),
            },
          ]
        : others;
      const base = withLayoutMode(layout, guides);
      if (!base) return undefined;

      return attachments.length > 0 ? { ...base, attachments } : undefined;
    }, historyLabel);
  }

  previewSelection(fn: (o: FabricObject) => void): void {
    const objects = this.getActiveObjects();
    for (const o of objects) {
      fn(o);
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
  }

  getTable(): BillTable | null {
    return (
      this.canvas?.getObjects().find(
        (o): o is BillTable =>
          (o as unknown as { appType?: string }).appType === "table",
      ) ?? null
    );
  }

  getTableById(tableId: string): BillTable | null {
    return (
      this.canvas
        ?.getObjects()
        .find(
          (o): o is BillTable =>
            (o as unknown as { appType?: string }).appType === "table" &&
            (o as unknown as { id?: string }).id === tableId,
        ) ?? null
    );
  }

   updateTable(mutate: (table: BillTable) => void, label = "Edit table"): void {
     const table = this.getTable();
     if (!table) return;
     mutate(table);
     table.syncDimensions();
     this.canvas?.requestRenderAll();
     this.commit(label);
   }

  setTableRepeat(tableId: string, repeat: Partial<TableRepeat> | null): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const target = canvas.getObjects().find((o) => o instanceof BillTable && this.getId(o) === tableId);
    if (!(target instanceof BillTable)) return;

    if (repeat === null) {
      target.repeat = undefined;
      this.commit("Clear repeating rows");
      canvas.requestRenderAll();
      return;
    }
    const rowCount = Array.isArray(target.rowHeights) ? target.rowHeights.length : 0;
    const next = normaliseRepeat(repeat, rowCount);
    if (!next) return;
    target.repeat = next;
    this.commit("Set repeating rows");
    canvas.requestRenderAll();
  }

  selectDynamicKey(key: string): boolean {
    const canvas = this.canvas;
    if (!canvas) return false;
    const token = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`);
    const target = canvas.getObjects().find((object) => {
      const type = (object as unknown as { appType?: string }).appType;
      if (type === "field") return (object as unknown as { key?: string }).key === key;
      if (type === "text") return token.test(String((object as unknown as { text?: string }).text ?? ""));
      if (object instanceof BillTable) {
        for (let row = 0; row < object.rows; row += 1) {
          for (let column = 0; column < object.columns; column += 1) {
            if (token.test(object.getCell(row, column).text)) return true;
          }
        }
      }
      return type === "image-placeholder" && (object as unknown as { placeholderRole?: string }).placeholderRole === key;
    });
    if (!target) return false;
    this.setTool("select");
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  renderHtmlForTest(template: BillTemplate, values: Record<string, string> = {}): string {
    return renderHtml(template, values, { computed: computedSpecsFor(template) }).html;
  }

  packageRoundTripHtml(template: BillTemplate): string {
    const pkg = buildPackage(template);
    const { template: resolved } = resolvePackage(parsePackage(writePackage(pkg)));
    return renderHtml(resolved, {}, { computed: computedSpecsFor(template) }).html;
  }

  recaptureBillPart(id: string, normalise?: boolean): void {
    const canvas = this.canvas;
    const target = canvas?.getObjects().find(
      (o) =>
        (o as unknown as { id?: string }).id === id &&
        (o as unknown as { appType?: string }).appType === "bill-part",
    );
    if (!canvas || !this.reference || !target) return;
    const old = target as BillPartObject;
    const box = target.getBoundingRect();

    let crop: BillPartCrop | null = null;
    try {
      crop = cropBillPart(
        this.reference,
        this.state.document,
        {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        },

        { normalise: normalise ?? old.normalized },
      );
    } catch {
      return;
    }
    if (!crop) return;
    const next = new BillPartObject({
      src: crop.src,
      normalized: crop.normalized,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    next.set({
      id: (target as unknown as { id?: string }).id,
      name: (target as unknown as { name?: string }).name,
      role: (target as unknown as { role?: string }).role,
      left: crop.rect.left,
      top: crop.rect.top,
      width: crop.width,
      height: crop.height,
      scaleX: crop.rect.width / crop.width,
      scaleY: crop.rect.height / crop.height,
      angle: target.angle ?? 0,
      opacity: target.opacity ?? 1,
      visible: target.visible !== false,
      selectable: true,
      evented: true,
    } as never);
    canvas.remove(old);
    canvas.add(next);
    canvas.setActiveObject(next);
    this.commit("Recapture bill part");
  }

  setGridVisible(visible: boolean): void {
    this.setState({ gridVisible: visible });
  }

  setSnapEnabled(enabled: boolean): void {
    this.setState({ snapToGrid: enabled });
  }

  setGridSize(size: number): void {
    this.setState({ gridSize: Math.max(2, size) });
  }

  getTemplate(): BillTemplate {
    const template = serialiseObjects(
      this.tracedObjects() as never,
      this.state.document,
      this.state.documentName,
      this.state.layout,
    );
    if (this.state.placeholders.length > 0) {
      template.meta.placeholders = this.state.placeholders;
    }
    if (this.state.computedSpecs.length > 0) {
      template.meta.computed = this.state.computedSpecs;
    }
    return template;
  }

  setDocumentName(name: string): void {
    this.setState({ documentName: name });
  }

  updatePlaceholder(key: string, patch: Partial<PlaceholderSpec>): void {
    const current = this.state.placeholders.find((p) => p.key === key);
    const merged: PlaceholderSpec = { ...(current ?? { key }), ...patch, key };
    const isEmpty = Object.entries(merged).every(
      ([k, v]) => k === "key" || v === undefined,
    );
    const next = isEmpty
      ? this.state.placeholders.filter((p) => p.key !== key)
      : current
        ? this.state.placeholders.map((p) => (p.key === key ? merged : p))
        : [...this.state.placeholders, merged];
    this.setState({ placeholders: next });
    this.commit("Edit data field");
  }

  setComputedSpecs(specs: ComputedSpec[]): void {
    this.setState({ computedSpecs: specs.map((spec) => ({ ...spec, args: [...spec.args] })) });
    this.commit("Edit calculations");
  }

  renamePlaceholderKey(oldKey: string, newKey: string): string | null {
    const next = newKey.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(next)) {
      return "Use letters, numbers, dots, dashes, or underscores for a field key.";
    }
    if (next === oldKey) return null;
    const template = this.getTemplate();
    const alreadyUsed = template.objects.some((object) => {
      if (object.type === "field") return object.key === next;
      if (object.type === "text") return extractVariables(object.text).includes(next);
      if (object.type === "table") return object.cells.some((cell) => extractVariables(cell.text).includes(next));
      return object.type === "image-placeholder" && object.placeholderRole === next;
    });
    if (alreadyUsed) return `The key “${next}” is already used.`;

    const token = new RegExp(`\\{\\{\\s*${escapeRegExp(oldKey)}\\s*\\}\\}`, "g");
    const canvas = this.canvas;
    if (!canvas) return "The editor is not ready.";
    for (const object of canvas.getObjects()) {
      const appType = (object as unknown as { appType?: string }).appType;
      if (appType === "text" || appType === "field") {
        const textObject = object as unknown as {
          text: string;
          set: (props: Record<string, unknown>) => void;
        } & { key?: string };
        const text = textObject.text.replace(token, `{{${next}}}`);
        textObject.set({ text, ...(appType === "field" ? { key: next } : {}) });
      } else if (appType === "table") {
        const table = object as BillTable;
        for (let row = 0; row < table.rows; row += 1) {
          for (let column = 0; column < table.columns; column += 1) {
            const cell = table.getCell(row, column);
            const text = cell.text.replace(token, `{{${next}}}`);
            if (text !== cell.text) table.setCellText(row, column, text);
          }
        }
      }
    }
    this.setState({
      placeholders: this.state.placeholders.map((spec) =>
        spec.key === oldKey ? { ...spec, key: next } : spec,
      ),
      computedSpecs: this.state.computedSpecs.map((spec) => ({
        ...spec,
        args: spec.args.map((arg) => arg === oldKey ? next : arg.endsWith(`.${oldKey}`) ? `${arg.slice(0, -oldKey.length)}${next}` : arg),
        ...(spec.rateKey ? { rateKey: spec.rateKey === oldKey ? next : spec.rateKey.endsWith(`.${oldKey}`) ? `${spec.rateKey.slice(0, -oldKey.length)}${next}` : spec.rateKey } : {}),
      })),
    });
    canvas.requestRenderAll();
    this.refresh();
    this.commit("Rename data field");
    return null;
  }

  setStructureLocked(locked: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.forEachObject((o) => {
      const appType = (o as unknown as { appType?: string }).appType;
      if (appType === "field") return;
      o.set({ locked, selectable: !locked, evented: !locked } as never);
    });
    canvas.requestRenderAll();
    this.setState({ structureLocked: locked });
    this.commit(locked ? "Lock structure" : "Unlock structure");
  }

  loadTemplate(template: BillTemplate): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (
      !template ||
      typeof template !== "object" ||
      !Array.isArray(template.objects) ||
      !template.document ||
      typeof template.document.width !== "number" ||
      typeof template.document.height !== "number"
    ) {
      return;
    }
    this.history.clear();
    canvas.discardActiveObject();

    for (const o of canvas.getObjects()) canvas.remove(o);
    for (const o of hydrateTemplate(template)) canvas.add(o);
    this.restoreGuides(template.layout?.guides ?? []);
    this.refreshStrokeFloors();
    canvas.requestRenderAll();
    this.setState({
      document: { ...template.document },
      documentName: template.meta?.name ?? "Untitled bill template",
placeholders: normalisePlaceholderSpecs(template.meta?.placeholders),
      computedSpecs: Array.isArray(template.meta?.computed) ? template.meta.computed : [],

    layout: template.layout,
    canUndo: false,
      canRedo: false,
      pendingTable: null,
      editingCell: null,
      structureLocked: false,

      groups: [],
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    this.fit();
    this.history.clear();
    this.markBaseline();
    this.refresh();
  }

  refresh(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const selection = this.getActiveObjects()
      .map((o) => this.getId(o));

    const traced = this.tracedObjects();
    const layers: LayerEntry[] = [...traced].reverse().map((o) => ({
      id: this.getId(o),
      type: o.type,
      name: (o as unknown as { name?: string }).name ?? "Object",
      role: (o as unknown as { role?: string | null }).role ?? null,
      visible: o.visible !== false,
      locked: this.isLocked(o),
      isReference: false,
    }));

    const selectedTemplates = this.getSelectedTemplates();
    const selectedTable =
      selectedTemplates.length === 1 && selectedTemplates[0]!.type === "table"
        ? (selectedTemplates[0] as TableObject & { repeat?: TableRepeat })
        : null;

    const dataFieldCount =
      traced.filter((o) =>
        isDataFieldObject({
          appType: (o as unknown as { appType?: string }).appType,
        }),
      ).length + (selectedTable?.repeat ? 1 : 0);

    this.setState({
      selection,
      layers,
      objectCount: traced.length,
      dataFieldCount,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selectedTable,
    });
  }

  getObjectIds(): string[] {
    return this.tracedObjects().map((o) => this.getId(o));
  }

  getObjectById(id: string): FabricObject | null {
    return (
      this.canvas?.getObjects().find((o) => this.getId(o) === id) ?? null
    );
  }

  selectObjectById(id: string): boolean {
    const canvas = this.canvas;
    const object = this.getObjectById(id);
    if (!canvas || !object) return false;
    this.setTool("select");
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  getSelectedTemplates(): TemplateObject[] {
    const objects = this.getActiveObjects();
    return objects
      .map((o) => {
        const all = this.getTemplate().objects;
        return all.find((t) => t.id === this.getId(o)) ?? null;
      })
      .filter((t): t is TemplateObject => t !== null);
  }

  getSharedSelection(): SharedSelection {
    return sharedSelection(this.getSelectedTemplates());
  }

  applyShared(key: SharedKey, value: unknown, label: string): void {
    this.applyToSelection((o) => {
      const t = this.getTemplate().objects.find((x) => x.id === this.getId(o));
      if (!t) return;
      if (this.isLocked(o) && key !== "locked") return;
      if ((key === "stroke" || key === "strokeWidth" || key === "fill") && !acceptsSharedPaint(t)) {
        return;
      }
      if (key === "visible" && !acceptsVisibility(t)) return;
      o.set({ [key]: value } as never);
    }, label);
  }
}

function ruleKindOf(
  o: FabricObject,
): "line" | "hr" | "vr" | null {
  const kind = (o as unknown as { ruleKind?: string }).ruleKind;
  if (kind === "hr" || kind === "vr" || kind === "line") return kind;
  return o.type === "line" ? "line" : null;
}
function analysePlaceholdersSafe(text: string): {  role: string | null;
  roleKind: "static" | "variable";
} {
  const m = /^\s*\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\s*$/.exec(text);
  if (m && m[1]) return { role: m[1], roleKind: "variable" };
  return {
    role: null,
    roleKind: /\{\{[^}]*\}\}/.test(text) ? "variable" : "static",
  };
}

const POLYGON_MARKER_APP_TYPE = "polygon-marker";

function isPolygonMarker(o: unknown): boolean {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { appType?: string }).appType === POLYGON_MARKER_APP_TYPE
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

```

## lib/canvas/fabricSetup.ts

```ts


import { FabricObject } from "fabric";

export const APP_PROPERTIES = [
  "id",
  "name",
  "role",
  "roleKind",
  "locked",
] as const;

let registered = false;

export function registerAppProperties(): void {
  if (registered) return;
  const target = FabricObject as unknown as { customProperties: string[] };
  target.customProperties = [...(target.customProperties ?? []), ...APP_PROPERTIES];
  registered = true;
}

let counter = 0;
export function createId(prefix = "obj"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter.toString(36)}${rand}`;
}

```

## lib/canvas/groups.ts

```ts


export interface GroupNode {
  id: string;
  name: string;
  parentId: string | null;

  members: string[];
}

const byId = (groups: GroupNode[], id: string): GroupNode | undefined =>
  groups.find((g) => g.id === id);

export function ancestorsOf(memberId: string, groups: GroupNode[]): string[] {
  const direct = groups.find((g) => g.members.includes(memberId));
  if (!direct) return [];
  const out: string[] = [];
  let current: GroupNode | undefined = direct;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    out.push(current.id);
    current = current.parentId ? byId(groups, current.parentId) : undefined;
  }
  return out;
}

export function groupOf(objectId: string, groups: GroupNode[]): GroupNode | null {
  return groups.find((g) => g.members.includes(objectId)) ?? null;
}

export function subtreeIds(rootId: string, groups: GroupNode[]): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    if (out.includes(id)) return;
    out.push(id);
    for (const g of groups) {
      if (g.parentId === id) walk(g.id);
    }
  };
  walk(rootId);
  return out;
}

export function canNest(
  parentId: string | null,
  childId: string,
  groups: GroupNode[],
): boolean {
  if (parentId === null) return true;
  if (parentId === childId) return false;

  let current: string | null = parentId;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current)) {
    if (current === childId) return false;
    guard.add(current);
    current = byId(groups, current)?.parentId ?? null;
  }
  return true;
}

export function groupObjects(
  objectIds: string[],
  newId: string,
  name: string,
  groups: GroupNode[],
): GroupNode[] {
  const wanted = [...new Set(objectIds)];
  if (wanted.length === 0) return groups;

  const absorbed = groups.filter((g) => g.members.some((m) => wanted.includes(m)));
  const absorbedIds = new Set(absorbed.map((g) => g.id));

  const promoted = new Set<string>(wanted);
  for (const g of absorbed) {
    for (const m of g.members) promoted.add(m);
  }

  const survivors = groups
    .filter((g) => !absorbedIds.has(g.id))
    .map((g) => ({
      ...g,
      members: g.members.filter(
        (m) => !absorbedIds.has(m) && !wanted.includes(m),
      ),
      parentId: g.parentId && absorbedIds.has(g.parentId) ? null : g.parentId,
    }));

  return [
    ...survivors,
    { id: newId, name, parentId: null, members: [...promoted].sort() },
  ];
}

export function ungroup(groupId: string, groups: GroupNode[]): GroupNode[] {
  const target = byId(groups, groupId);
  if (!target) return groups;
  const removedIds = new Set(subtreeIds(groupId, groups));
  const heir =
    target.parentId && !removedIds.has(target.parentId) ? target.parentId : null;
  const orphans: string[] = [];
  for (const id of removedIds) {
    for (const m of byId(groups, id)?.members ?? []) {
      if (!orphans.includes(m)) orphans.push(m);
    }
  }
  return groups
    .filter((g) => !removedIds.has(g.id))
    .map((g) => {
      const parentId = g.parentId && removedIds.has(g.parentId) ? heir : g.parentId;
      const members = [...g.members];
      if (heir !== null && g.id === heir) {
        for (const m of orphans) if (!members.includes(m)) members.push(m);
      }
      return { ...g, members, parentId };
    });
}

export function pruneGroups(
  liveObjectIds: string[],
  groups: GroupNode[],
): GroupNode[] {
  const live = new Set(liveObjectIds);
  const groupIds = new Set(groups.map((g) => g.id));
  const first = groups
    .map((g) => ({
      ...g,
      members: g.members.filter((m) => live.has(m) || groupIds.has(m)),
      parentId: g.parentId && groupIds.has(g.parentId) ? g.parentId : null,
    }))
    .filter((g) => g.members.length > 0);
  const keptIds = new Set(first.map((g) => g.id));
  return first.filter((g) => g.parentId === null || keptIds.has(g.parentId));
}

```

## lib/canvas/guides.ts

```ts
import type { GuideAttachment, LayoutConfig, LayoutGuide } from "@/lib/template/types";

export const GUIDE_APP_TYPE = "guide";

export interface GuideOverlay {
  appType?: string;
  guideId?: string;
  guideOrientation?: string;
  guideMaxDisplacement?: number;
  left?: number;
  top?: number;
}

export function isGuide(o: unknown): boolean {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as GuideOverlay).appType === GUIDE_APP_TYPE
  );
}

export function nextGuideId(existing: readonly LayoutGuide[]): string {
  const taken = new Set(existing.map((g) => g.id));
  let n = existing.length + 1;
  while (taken.has(`guide-${n}`)) n += 1;
  return `guide-${n}`;
}

export function guidesFromObjects(objects: readonly unknown[]): LayoutGuide[] {
  const out: LayoutGuide[] = [];
  for (const raw of objects) {
    if (!isGuide(raw)) continue;
    const o = raw as GuideOverlay;
    if (typeof o.guideId !== "string" || o.guideId.length === 0) continue;
    const orientation =
      o.guideOrientation === "horizontal" || o.guideOrientation === "vertical"
        ? o.guideOrientation
        : null;
    if (!orientation) continue;

    const position = orientation === "horizontal" ? o.top : o.left;
    if (typeof position !== "number" || !Number.isFinite(position)) continue;

    const guide: LayoutGuide = { id: o.guideId, orientation, position };
    if (typeof o.guideMaxDisplacement === "number" && Number.isFinite(o.guideMaxDisplacement)) {
      guide.maxDisplacement = o.guideMaxDisplacement;
    }
    out.push(guide);
  }
  return out;
}

export function guideAt(guides: readonly LayoutGuide[], id: string): LayoutGuide | undefined {
  return guides.find((g) => g.id === id);
}

export function setGuideCap(
  guides: readonly LayoutGuide[],
  id: string,
  cap: number,
): LayoutGuide[] {
  return guides.map((g) => {
    if (g.id !== id) return g;
    if (!Number.isFinite(cap) || cap <= 0) {
      return { id: g.id, orientation: g.orientation, position: g.position };
    }
    return { ...g, maxDisplacement: cap };
  });
}

export function removeGuide(guides: readonly LayoutGuide[], id: string): LayoutGuide[] {
  return guides.filter((g) => g.id !== id);
}

export function attachmentsFor(
  attachments: readonly GuideAttachment[],
  guideId: string,
): GuideAttachment[] {
  return attachments.filter((a) => a.guideId === guideId);
}

export function withLayoutMode(
  existing: LayoutConfig | undefined,
  guides: readonly LayoutGuide[],
): LayoutConfig | undefined {
  const attached = existing?.attachments ?? [];
  if (!existing && guides.length === 0) return undefined;
  return {
    mode: "variable",
    ...(existing?.document ? { document: existing.document } : {}),
    guides: [...guides],
    ...(attached.length > 0 ? { attachments: [...attached] } : {}),

    ...(existing?.collision !== undefined ? { collision: existing.collision } : {}),
  };
}

export function createGuide(guide: LayoutGuide): GuideOverlay & Record<string, unknown> {
  const common = {
    appType: GUIDE_APP_TYPE,
    guideId: guide.id,
    guideOrientation: guide.orientation,
    ...(guide.maxDisplacement !== undefined
      ? { guideMaxDisplacement: guide.maxDisplacement }
      : {}),
  };
  return guide.orientation === "horizontal"
    ? { ...common, left: 0, top: guide.position, width: 0, height: 0 }
    : { ...common, left: guide.position, top: 0, width: 0, height: 0 };
}
```

## lib/canvas/history.ts

```ts


export interface HistoryEntry<T> {
  label: string;

  before: T;

  after: T;
}

export class HistoryStack<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  push(entry: HistoryEntry<T>): void {
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): HistoryEntry<T> | null {
    const entry = this.past.pop();
    if (entry) this.future.push(entry);
    return entry ?? null;
  }

  redo(): HistoryEntry<T> | null {
    const entry = this.future.pop();
    if (entry) this.past.push(entry);
    return entry ?? null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get size(): number {
    return this.past.length;
  }
}

```

## lib/canvas/objects/BillField.ts

```ts
import { FabricObject, classRegistry } from "fabric";

import type { FieldType } from "@/lib/template/types";

export interface FieldSpec {
  key: string;
  fieldType: FieldType;
  label: string;
  borderColor: string;
  borderWidth: number;
  fill: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right";
}

export const DEFAULT_FIELD: FieldSpec = {
  key: "field",
  fieldType: "text",
  label: "FIELD",
  borderColor: "#2563eb",
  borderWidth: 1,

  fill: "rgba(37,99,235,0.06)",

  textColor: "#000000",
  fontFamily: "Arial",

  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left",
};

export class FieldObject extends FabricObject {
  static type = "BillField";

  readonly appType = "field" as const;

  declare key: string;
  declare fieldType: FieldType;
  declare label: string;
  declare borderColor: string;
  declare borderWidth: number;
  declare textColor: string;
  declare fontFamily: string;
  declare fontSize: number;
  declare fontWeight: "normal" | "bold";
  declare fontStyle: "normal" | "italic";
  declare textAlign: "left" | "center" | "right";

  constructor(spec: Partial<FieldSpec> = {}) {
    const merged = { ...DEFAULT_FIELD, ...spec };
    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: merged.fill,
      stroke: merged.borderColor,
      strokeWidth: merged.borderWidth,
      objectCaching: false,
    });
    this.key = merged.key;
    this.fieldType = merged.fieldType;
    this.label = merged.label;
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.textColor = merged.textColor;
    this.fontFamily = merged.fontFamily;
    this.fontSize = merged.fontSize;
    this.fontWeight = merged.fontWeight;
    this.fontStyle = merged.fontStyle;
    this.textAlign = merged.textAlign;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
  }

  private labelFont(): string {
    const style = this.fontStyle === "italic" ? "italic " : "";
    const weight = this.fontWeight === "bold" ? "600 " : "400 ";
    const size = this.fontSize > 0 ? this.fontSize : DEFAULT_FIELD.fontSize;
    return `${style}${weight}${size}px ${this.fontFamily || DEFAULT_FIELD.fontFamily}`;
  }

  private labelX(ox: number, w: number): number {
    if (this.textAlign === "left") return ox + 4;
    if (this.textAlign === "right") return ox + w - 4;
    return ox + w / 2;
  }

  private anchorFor(): CanvasTextAlign {
    if (this.textAlign === "left") return "left";
    if (this.textAlign === "right") return "right";
    return "center";
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();

    const fill = this.fill as unknown as string | undefined;
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fillRect(ox, oy, w, h);
    }

    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = this.borderColor || "#2563eb";
    ctx.lineWidth = this.borderWidth || 1;
    ctx.strokeRect(
      ox + 0.5,
      oy + 0.5,
      Math.max(0, w - 1),
      Math.max(0, h - 1),
    );
    ctx.restore();

    const label = this.label || this.key;
    ctx.fillStyle = this.textColor || "#2563eb";
    ctx.font = this.labelFont();
    ctx.textAlign = this.anchorFor();
    ctx.textBaseline = "middle";

    const gutter = this.textAlign === "center" ? 8 : 4;
    const maxWidth = Math.max(0, w - gutter);
    const x = this.labelX(ox, w);
    if (ctx.measureText(label).width <= maxWidth) {
      ctx.fillText(label, x, oy + h / 2, maxWidth);
    } else {
      const clipped = `${label.slice(0, Math.max(1, Math.floor(label.length / 2)))}...`;
      ctx.fillText(clipped, x, oy + h / 2, maxWidth);
    }
  }

  override _toSVG(): string[] {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();
    const label = this.label || this.key;
    const anchor =
      this.textAlign === "left"
        ? "start"
        : this.textAlign === "right"
          ? "end"
          : "middle";
    const tx =
      this.textAlign === "left"
        ? ox + 4
        : this.textAlign === "right"
          ? ox + w - 4
          : ox + w / 2;
    const size = this.fontSize > 0 ? this.fontSize : DEFAULT_FIELD.fontSize;
    return [
      this.fill && this.fill !== "transparent"
        ? `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${this.fill}" />`
        : "",
      `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}" stroke-dasharray="4 3" />`,
      `<text x="${tx}" y="${oy + h / 2}" font-family="${this.fontFamily}" font-size="${size}" font-weight="${this.fontWeight === "bold" ? 600 : 400}" font-style="${this.fontStyle}" text-anchor="${anchor}" dominant-baseline="central" fill="${this.textColor}">${this.esc(label)}</text>`,
    ].filter(Boolean);
  }

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillField",
      key: this.key,
      fieldType: this.fieldType,
      label: this.label,
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      textColor: this.textColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      textAlign: this.textAlign,
    };
  }

  static async fromObject(
    object: Record<string, unknown>,
  ): Promise<FieldObject> {
    const {
      key,
      fieldType,
      label,
      borderColor,
      borderWidth,
      textColor,
      fill,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      textAlign,
      ...fabricProps
    } = object as Record<string, unknown>;
    const field = new FieldObject({
      key: (key as string) ?? "field",
      fieldType: (fieldType as FieldType) ?? "text",
      label: (label as string) ?? "FIELD",
      borderColor: (borderColor as string) ?? DEFAULT_FIELD.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_FIELD.borderWidth,
      textColor: (textColor as string) ?? DEFAULT_FIELD.textColor,
      fill: (fill as string) ?? DEFAULT_FIELD.fill,
      fontFamily: (fontFamily as string) ?? DEFAULT_FIELD.fontFamily,
      fontSize: (fontSize as number) ?? DEFAULT_FIELD.fontSize,
      fontWeight: (fontWeight as "normal" | "bold") ?? DEFAULT_FIELD.fontWeight,
      fontStyle:
        (fontStyle as "normal" | "italic") ?? DEFAULT_FIELD.fontStyle,
      textAlign:
        (textAlign as "left" | "center" | "right") ?? DEFAULT_FIELD.textAlign,
    });
    field.set(fabricProps as never);
    field.setCoords();
    return field;
  }
}

classRegistry.setClass(FieldObject, "BillField");
classRegistry.setClass(FieldObject, "field");

```

## lib/canvas/objects/BillPartObject.ts

```ts
import { FabricObject, classRegistry } from "fabric";

import type { SourceRect } from "@/lib/template/types";

export class BillPartObject extends FabricObject {
  static type = "BillPart";
  readonly appType = "bill-part";
  readonly src: string;
  readonly normalized: boolean;
  readonly sourceRect?: SourceRect;
  private element: HTMLCanvasElement | HTMLImageElement;

  constructor(options: {
    src?: string;
    normalized?: boolean;
    sourceRect?: SourceRect;
    image?: HTMLCanvasElement | HTMLImageElement;
  } = {}) {
    super({

      originX: "left",
      originY: "top",
    });
    this.src = options.src ?? "";
    this.normalized = options.normalized === true;
    this.sourceRect = options.sourceRect;
    this.element = options.image ?? BillPartObject.blank();
    if (!options.image && this.src) {

      this.selfLoad();
    }
    this.width ??= 1;
    this.height ??= 1;

    (this as unknown as { _controlsVisibility: Record<string, boolean> })._controlsVisibility = {
      tl: true,
      tr: true,
      bl: true,
      br: true,
      mtr: true,
    };
    this.set({ objectCaching: false } as never);
  }

  private get decoded(): boolean {
    const el = this.element as HTMLCanvasElement & { complete?: boolean; naturalWidth?: number };
    if (typeof el.complete === "boolean") {
      return el.complete && (el.naturalWidth ?? 0) > 0;
    }

    return el.width > 0 && el.height > 0;
  }

  private selfLoad(): void {
    const img = new Image();
    this.element = img;
    img.onload = () => {
      this.dirty = true;

      this.canvas?.requestRenderAll();
    };
    img.src = this.src;
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const width = this.width ?? 1;
    const height = this.height ?? 1;

    if (this.src && this.decoded) {
      ctx.drawImage(this.element, -width / 2, -height / 2, width, height);
      return;
    }
    ctx.fillStyle = "rgba(147,51,234,0.06)";
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeStyle = "#9333ea";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
  }

  override _toSVG(): string[] {
    const { width = 0, height = 0 } = this;

    const src = this.src.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return [
      `<image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${src}" preserveAspectRatio="none" />`,
    ];
  }

  override toObject(props: string[] = []): Record<string, unknown> {
    return {
      ...super.toObject(props),
      type: BillPartObject.type,
      appType: this.appType,
      src: this.src,
      normalized: this.normalized,
      ...(this.sourceRect ? { sourceRect: this.sourceRect } : {}),
    };
  }

  static async fromObject(object: Record<string, unknown>): Promise<BillPartObject> {
    const { src, normalized, sourceRect, ...fabricProps } = object as {
      src?: unknown;
      normalized?: unknown;
      sourceRect?: SourceRect;
    } & Record<string, unknown>;

    delete fabricProps.type;
    delete fabricProps.appType;
    const part = new BillPartObject({
      src: typeof src === "string" ? src : "",
      normalized: normalized === true,
      sourceRect,
    });
    part.set(fabricProps as never);
    part.setCoords();
    return part;
  }

  private static blank(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    c.getContext("2d")?.fillRect(0, 0, 1, 1);
    return c;
  }
}

classRegistry.setClass(BillPartObject, "BillPart");
classRegistry.setClass(BillPartObject, "bill-part");

```

## lib/canvas/objects/BillTable.ts

```ts
import { FabricObject, classRegistry } from "fabric";

import {
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  cellRect,
  cellIndex,
  columnLines,
  hitTestCell,
  normaliseSizes,
  rowLines,
  scaleColWidths,
  scaleRowHeights,
  sum,
  totalHeight,
  totalWidth,
  type CellRect,
} from "@/lib/template/geometry";
import { gridSegments } from "@/lib/canvas/tableGrid";
import { DEFAULT_STROKE_WIDTH } from "@/lib/canvas/strokeDefaults";
import type { TableCell, TableRepeat, TextAlign } from "@/lib/template/types";

export interface BillTableSpec {
  colWidths: number[];
  rowHeights: number[];
  cells: TableCell[];
  borderColor: string;
  borderWidth: number;
  cellFill: string;
  headerRow: boolean;
  headerFill: string;
  headerTextColor: string;
  cellTextColor: string;
  padding: number;
  fontFamily: string;
  repeat?: TableRepeat;
}

export interface TableResizeGesture {
  colWidths: number[];
  rowHeights: number[];
  width: number;
  height: number;
  startX: number;
  startY: number;
  signX: 1 | -1;
  signY: 1 | -1;
}

export const DEFAULT_TABLE_SPEC: BillTableSpec = {
  colWidths: [120, 120],
  rowHeights: [30, 30],
  cells: [],
  borderColor: "#000000",

  borderWidth: DEFAULT_STROKE_WIDTH,
  cellFill: "transparent",
  headerRow: true,
  headerFill: "transparent",
  headerTextColor: "#000000",
  cellTextColor: "#000000",
  padding: 4,
  fontFamily: "Arial",
};

function makeCells(rows: number, cols: number, template?: TableCell[]): TableCell[] {
  const out: TableCell[] = [];
  for (let i = 0; i < rows * cols; i++) {
    out.push(
      template?.[i] ?? {
        text: "",
        textAlign: "left",
        fontSize: 12,
        fontWeight: "normal",
      },
    );
  }
  return out;
}

export class BillTable extends FabricObject {
  static type = "BillTable";

  readonly appType = "table" as const;

  declare colWidths: number[];
  declare rowHeights: number[];
  declare cells: TableCell[];
  declare borderColor: string;
  declare borderWidth: number;
  declare cellFill: string;
  declare headerRow: boolean;
  declare headerFill: string;
  declare headerTextColor: string;
  declare cellTextColor: string;
  declare padding: number;
  declare fontFamily: string;
  declare repeat?: TableRepeat;

  editingCell = -1;

  resizeGesture: TableResizeGesture | null = null;

  constructor(spec: Partial<BillTableSpec> = {}) {
    const merged = { ...DEFAULT_TABLE_SPEC, ...spec };
    const colWidths = normaliseSizes(merged.colWidths, 8);
    const rowHeights = normaliseSizes(merged.rowHeights, 8);

    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: "transparent",
      strokeWidth: 0,
      objectCaching: false,
    });

    this.colWidths = colWidths;
    this.rowHeights = rowHeights;
    this.repeat = merged.repeat;
    this.cells = makeCells(
      rowHeights.length,
      colWidths.length,
      merged.cells,
    );
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.cellFill = merged.cellFill;
    this.headerRow = merged.headerRow;
    this.headerFill = merged.headerFill;
    this.headerTextColor = merged.headerTextColor;
    this.cellTextColor = merged.cellTextColor;
    this.padding = merged.padding;
    this.fontFamily = merged.fontFamily;

    this.syncDimensions();
  }

  get rows(): number {
    return this.rowHeights.length;
  }

  get columns(): number {
    return this.colWidths.length;
  }

  get isResizableByScaling(): boolean {
    return false;
  }

  syncDimensions(): void {
    this.set({
      width: totalWidth(this.colWidths),
      height: totalHeight(this.rowHeights),
      scaleX: 1,
      scaleY: 1,
    } as never);
    this.setCoords();
  }

  cellAtCanvasPoint(x: number, y: number): CellRect | null {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const cx = (this.left ?? 0) + w / 2;
    const cy = (this.top ?? 0) + h / 2;
    const angle = ((this.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = x - cx;
    const dy = y - cy;

    const lx = dx * cos - dy * sin + w / 2;
    const ly = dx * sin + dy * cos + h / 2;
    return this.cellAtLocalPoint(lx, ly);
  }

  cellAtLocalPoint(x: number, y: number): CellRect | null {
    return hitTestCell(this.colWidths, this.rowHeights, x, y);
  }

  private ensureSize(): void {
    const needed = this.rows * this.columns;
    while (this.cells.length < needed) {
      this.cells.push({
        text: "",
        textAlign: "left",
        fontSize: 12,
        fontWeight: "normal",
      });
    }
    if (this.cells.length > needed) this.cells.length = needed;
  }

  getCell(row: number, column: number): TableCell {
    this.ensureSize();
    return this.cells[cellIndex(this.colWidths, this.rowHeights, row, column)]!;
  }

  setCellText(row: number, column: number, text: string): void {
    this.getCell(row, column).text = text;
  }

  setCellAlign(row: number, column: number, textAlign: TextAlign): void {
    this.getCell(row, column).textAlign = textAlign;
  }

  setAllCellsAlign(textAlign: TextAlign): void {
    for (const c of this.cells) c.textAlign = textAlign;
  }

  setColumnWidth(index: number, value: number): void {
    if (index < 0 || index >= this.columns) return;
    const next = [...this.colWidths];
    next[index] = Math.max(8, Math.round(value));
    this.colWidths = normaliseSizes(next, 8);
    this.syncDimensions();
  }

  beginResizeGesture(startPointer: { x: number; y: number }): void {
    const w = totalWidth(this.colWidths);
    const h = totalHeight(this.rowHeights);
    const cx = (this.left ?? 0) + w / 2;
    const cy = (this.top ?? 0) + h / 2;
    this.resizeGesture = {
      colWidths: [...this.colWidths],
      rowHeights: [...this.rowHeights],
      width: w,
      height: h,
      startX: startPointer.x,
      startY: startPointer.y,
      signX: startPointer.x >= cx ? 1 : -1,
      signY: startPointer.y >= cy ? 1 : -1,
    };
  }

  resizeColumnsTo(targetWidth: number): void {
    if (!Number.isFinite(targetWidth)) return;
    const base = this.resizeGesture?.colWidths ?? this.colWidths;
    this.colWidths = scaleColWidths(base, targetWidth, MIN_COL_WIDTH);
    this.syncDimensions();
  }

  resizeRowsTo(targetHeight: number): void {
    if (!Number.isFinite(targetHeight)) return;
    const base = this.resizeGesture?.rowHeights ?? this.rowHeights;
    this.rowHeights = scaleRowHeights(base, targetHeight, MIN_ROW_HEIGHT);
    this.syncDimensions();
  }

  endResizeGesture(): void {
    this.resizeGesture = null;
  }

  scaleColumns(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
    const current = totalWidth(this.colWidths);
    const next = current * factor;
    if (next < MIN_COL_WIDTH * this.columns) return;
    this.colWidths = scaleColWidths(this.colWidths, next, MIN_COL_WIDTH);
    this.syncDimensions();
  }

  scaleRows(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
    const current = totalHeight(this.rowHeights);
    const next = current * factor;
    if (next < MIN_ROW_HEIGHT * this.rows) return;
    this.rowHeights = scaleRowHeights(this.rowHeights, next, MIN_ROW_HEIGHT);
    this.syncDimensions();
  }

  setRowHeight(index: number, value: number): void {
    if (index < 0 || index >= this.rows) return;
    const next = [...this.rowHeights];
    next[index] = Math.max(8, Math.round(value));
    this.rowHeights = normaliseSizes(next, 8);
    this.syncDimensions();
  }

  addColumn(at = this.columns, width?: number): void {
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    const w = width ?? Math.max(24, Math.round(totalWidth(this.colWidths) / this.columns));
    const next = [...this.colWidths];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, w);
    this.colWidths = next;
    this.syncDimensions();
    this.ensureSize();
    this.relocateCells(snapshot, (r, c) => ({ row: r, col: c >= at ? c + 1 : c }));
  }

  addRow(at = this.rows, height?: number): void {
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    const h = height ?? Math.max(20, Math.round(totalHeight(this.rowHeights) / this.rows));
    const next = [...this.rowHeights];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, h);
    this.rowHeights = next;
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) => ({ row: r >= at ? r + 1 : r, col: c }));
  }

  removeColumn(index: number): void {
    if (this.columns <= 1 || index < 0 || index >= this.columns) return;
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    this.colWidths = this.colWidths.filter((_, i) => i !== index);
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) =>
      c === index ? null : { row: r, col: c > index ? c - 1 : c },
    );
  }

  removeRow(index: number): void {
    if (this.rows <= 1 || index < 0 || index >= this.rows) return;
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    this.rowHeights = this.rowHeights.filter((_, i) => i !== index);
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) =>
      r === index ? null : { row: r > index ? r - 1 : r, col: c },
    );
  }

  private relocateCells(
    snapshot: { rows: number; cols: number; cells: TableCell[] },
    mapPosition: (r: number, c: number) => { row: number; col: number } | null,
  ): void {
    const next = makeCells(this.rows, this.columns);
    const expected = snapshot.rows * snapshot.cols;
    for (let i = 0; i < expected && i < snapshot.cells.length; i++) {
      const r = Math.floor(i / snapshot.cols);
      const c = i % snapshot.cols;
      const target = mapPosition(r, c);
      if (
        target &&
        target.row >= 0 &&
        target.row < this.rows &&
        target.col >= 0 &&
        target.col < this.columns
      ) {
        next[target.row * this.columns + target.col] = { ...snapshot.cells[i]! };
      }
    }
    this.cells = next;
  }

  resizeTo(width: number, height: number): void {
    this.colWidths = scaleColWidths(this.colWidths, width);
    this.rowHeights = scaleRowHeights(this.rowHeights, height);
    this.syncDimensions();
  }

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillTable",
      resizeGesture: null,
      colWidths: [...this.colWidths],
      rowHeights: [...this.rowHeights],
      cells: this.cells.map((c) => ({ ...c })),
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      cellFill: this.cellFill,
      headerRow: this.headerRow,
      headerFill: this.headerFill,
      headerTextColor: this.headerTextColor,
      cellTextColor: this.cellTextColor,
      padding: this.padding,
      fontFamily: this.fontFamily,
    };
  }

  static async fromObject(object: Record<string, unknown>): Promise<BillTable> {
    const {
      colWidths,
      rowHeights,
      cells,
      borderColor,
      borderWidth,
      cellFill,
      headerRow,
      headerFill,
      headerTextColor,
      cellTextColor,
      padding,
      fontFamily,
      ...fabricProps
    } = object as Record<string, unknown> & Partial<BillTableSpec>;

    const table = new BillTable({
      colWidths: (colWidths as number[]) ?? DEFAULT_TABLE_SPEC.colWidths,
      rowHeights: (rowHeights as number[]) ?? DEFAULT_TABLE_SPEC.rowHeights,
      cells: (cells as TableCell[]) ?? [],
      borderColor: (borderColor as string) ?? DEFAULT_TABLE_SPEC.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_TABLE_SPEC.borderWidth,
      cellFill: (cellFill as string) ?? DEFAULT_TABLE_SPEC.cellFill,
      headerRow: (headerRow as boolean) ?? DEFAULT_TABLE_SPEC.headerRow,
      headerFill: (headerFill as string) ?? DEFAULT_TABLE_SPEC.headerFill,
      headerTextColor:
        (headerTextColor as string) ?? DEFAULT_TABLE_SPEC.headerTextColor,
      cellTextColor:
        (cellTextColor as string) ?? DEFAULT_TABLE_SPEC.cellTextColor,
      padding: (padding as number) ?? DEFAULT_TABLE_SPEC.padding,
      fontFamily: (fontFamily as string) ?? DEFAULT_TABLE_SPEC.fontFamily,
    });

    delete fabricProps.type;
    table.set(fabricProps as never);
    table.resizeGesture = null;
    table.setCoords();
    return table;
  }

  private isHeader(row: number): boolean {
    return this.headerRow && row === 0;
  }

  private paintCell(
    ctx: CanvasRenderingContext2D,
    row: number,
    column: number,
    ox: number,
    oy: number,
  ): void {
    const r = cellRect(this.colWidths, this.rowHeights, row, column);
    const x = r.x + ox;
    const y = r.y + oy;
    const cell = this.getCell(row, column);
    const header = this.isHeader(row);

    const fill = header ? this.headerFill : this.cellFill;
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, r.width, r.height);
    }

    const text = cell.text;
    if (!text) return;

    ctx.fillStyle = header ? this.headerTextColor : this.cellTextColor;
    ctx.font = `${cell.fontWeight === "bold" ? "bold " : ""}${cell.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "middle";

    const pad = this.padding;
    const maxTextWidth = Math.max(0, r.width - pad * 2);
    let tx = x + pad;
    if (cell.textAlign === "center") {
      ctx.textAlign = "center";
      tx = x + r.width / 2;
    } else if (cell.textAlign === "right") {
      ctx.textAlign = "right";
      tx = x + r.width - pad;
    } else {
      ctx.textAlign = "left";
    }
    const ty = y + r.height / 2;

    let display = text;
    if (ctx.measureText(display).width > maxTextWidth) {
      while (display.length > 1 && ctx.measureText(`${display}...`).width > maxTextWidth) {
        display = display.slice(0, -1);
      }
      display = `${display}...`;
    }
    ctx.fillText(display, tx, ty, maxTextWidth);
  }

  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
  }

  private paintGrid(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.borderWidth <= 0 || !this.borderColor) return;
    const half = this.borderWidth / 2;
    ctx.save();
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.beginPath();
    for (const seg of gridSegments(this.colWidths, this.rowHeights)) {
      if (seg.vertical) {

        ctx.moveTo(ox + seg.at + half, oy + half);
        ctx.lineTo(ox + seg.at + half, oy + seg.length - half);
      } else {
        ctx.moveTo(ox + half, oy + seg.at + half);
        ctx.lineTo(ox + seg.length - half, oy + seg.at + half);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const { x: ox, y: oy } = this.originOffset();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        this.paintCell(ctx, r, c, ox, oy);
      }
    }

    this.paintGrid(ctx, ox, oy);
    this.paintActiveCell(ctx, ox, oy);
  }

  private paintActiveCell(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
  ): void {
    if (this.editingCell < 0 || this.editingCell >= this.cells.length) return;
    const cols = this.columns;
    const row = Math.floor(this.editingCell / cols);
    const col = this.editingCell % cols;
    const r = cellRect(this.colWidths, this.rowHeights, row, col);
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + ox, r.y + oy, r.width, r.height);
    ctx.restore();
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  override _toSVG(): string[] {
    const parts: string[] = [];
    const { x: ox, y: oy } = this.originOffset();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const rect = cellRect(this.colWidths, this.rowHeights, r, c);
        const x = rect.x + ox;
        const y = rect.y + oy;
        const cell = this.getCell(r, c);
        const header = this.isHeader(r);
        const fill = header ? this.headerFill : this.cellFill;

        if (fill && fill !== "transparent") {
          parts.push(
            `<rect x="${x}" y="${y}" width="${rect.width}" height="${rect.height}" fill="${fill}" />`,
          );
        }

        if (cell.text) {
          const pad = this.padding;
          let anchor = "start";
          let tx = x + pad;
          if (cell.textAlign === "center") {
            anchor = "middle";
            tx = x + rect.width / 2;
          } else if (cell.textAlign === "right") {
            anchor = "end";
            tx = x + rect.width - pad;
          }
          const ty = y + rect.height / 2;
          parts.push(
            `<text x="${tx}" y="${ty}" font-family="${this.fontFamily}" font-size="${cell.fontSize}" font-weight="${cell.fontWeight}" text-anchor="${anchor}" dominant-baseline="central" fill="${header ? this.headerTextColor : this.cellTextColor}">${this.esc(cell.text)}</text>`,
          );
        }
      }
    }

    if (this.borderWidth > 0 && this.borderColor) {
      const half = this.borderWidth / 2;
      const shared =
        `fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}"`;
      for (const seg of gridSegments(this.colWidths, this.rowHeights)) {
        if (seg.vertical) {
          parts.push(
            `<line x1="${ox + seg.at + half}" y1="${oy + half}" x2="${ox + seg.at + half}" y2="${oy + seg.length - half}" ${shared} />`,
          );
        } else {
          parts.push(
            `<line x1="${ox + half}" y1="${oy + seg.at + half}" x2="${ox + seg.length - half}" y2="${oy + seg.at + half}" ${shared} />`,
          );
        }
      }
    }

    return parts;
  }

  getColumnEdges(): number[] {
    return columnLines(this.colWidths);
  }

  getRowEdges(): number[] {
    return rowLines(this.rowHeights);
  }

  getColumnSpan(index: number): number {
    return this.colWidths[index] ?? 0;
  }

  getRowSpan(index: number): number {
    return this.rowHeights[index] ?? 0;
  }

  getGridTotal(): { width: number; height: number } {
    return {
      width: sum(this.colWidths),
      height: sum(this.rowHeights),
    };
  }
}

classRegistry.setClass(BillTable, "BillTable");
classRegistry.setClass(BillTable, "table");

export { cellRect };

```

## lib/canvas/objects/ImagePlaceholder.ts

```ts
import { FabricObject, classRegistry } from "fabric";

import type { ImagePlaceholderRole } from "@/lib/template/types";

export interface ImagePlaceholderSpec {
  placeholderRole: ImagePlaceholderRole;
  label: string;
  borderColor: string;
  borderWidth: number;
  fill: string;
  textColor: string;
}

export const DEFAULT_IMAGE_PLACEHOLDER: ImagePlaceholderSpec = {
  placeholderRole: "image",
  label: "IMAGE",
  borderColor: "#6b7280",
  borderWidth: 1,
  fill: "rgba(107,114,128,0.06)",
  textColor: "#6b7280",
};

export class ImagePlaceholderObject extends FabricObject {
  static type = "BillImagePlaceholder";

  readonly appType = "image-placeholder" as const;

  declare placeholderRole: ImagePlaceholderRole;
  declare label: string;
  declare borderColor: string;
  declare borderWidth: number;
  declare textColor: string;

  constructor(spec: Partial<ImagePlaceholderSpec> = {}) {
    const merged = { ...DEFAULT_IMAGE_PLACEHOLDER, ...spec };
    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: merged.fill,
      stroke: merged.borderColor,
      strokeWidth: merged.borderWidth,
      objectCaching: false,
    });
    this.placeholderRole = merged.placeholderRole;
    this.label = merged.label;
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.textColor = merged.textColor;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();

    const fill = this.fill as unknown as string | undefined;
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fillRect(ox, oy, w, h);
    }

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = this.borderColor || "#6b7280";
    ctx.lineWidth = this.borderWidth || 1;
    ctx.strokeRect(
      ox + 0.5,
      oy + 0.5,
      Math.max(0, w - 1),
      Math.max(0, h - 1),
    );
    ctx.restore();

    const label = this.label || this.placeholderRole.toUpperCase();
    ctx.fillStyle = this.textColor || "#6b7280";
    ctx.font = `600 11px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = Math.max(0, w - 12);
    if (ctx.measureText(label).width <= maxWidth) {
      ctx.fillText(label, ox + w / 2, oy + h / 2, maxWidth);
    } else {
      const clipped = `${label.slice(0, Math.max(1, Math.floor(label.length / 2)))}...`;
      ctx.fillText(clipped, ox + w / 2, oy + h / 2, maxWidth);
    }
  }

  override _toSVG(): string[] {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();
    const label = this.label || this.placeholderRole.toUpperCase();
    return [
      this.fill && this.fill !== "transparent"
        ? `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${this.fill}" />`
        : "",
      `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}" stroke-dasharray="6 4" />`,
      `<text x="${ox + w / 2}" y="${oy + h / 2}" font-family="Arial, sans-serif" font-size="11" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${this.textColor}">${this.esc(label)}</text>`,
    ].filter(Boolean);
  }

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillImagePlaceholder",
      placeholderRole: this.placeholderRole,
      label: this.label,
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      textColor: this.textColor,
    };
  }

  static async fromObject(
    object: Record<string, unknown>,
  ): Promise<ImagePlaceholderObject> {
    const {
      placeholderRole,
      label,
      borderColor,
      borderWidth,
      textColor,
      fill,
      ...fabricProps
    } = object as Record<string, unknown>;
    const ph = new ImagePlaceholderObject({
      placeholderRole: (placeholderRole as ImagePlaceholderRole) ?? "image",
      label: (label as string) ?? "IMAGE",
      borderColor: (borderColor as string) ?? DEFAULT_IMAGE_PLACEHOLDER.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_IMAGE_PLACEHOLDER.borderWidth,
      textColor: (textColor as string) ?? DEFAULT_IMAGE_PLACEHOLDER.textColor,
      fill: (fill as string) ?? DEFAULT_IMAGE_PLACEHOLDER.fill,
    });
    ph.set(fabricProps as never);
    ph.setCoords();
    return ph;
  }
}

classRegistry.setClass(ImagePlaceholderObject, "BillImagePlaceholder");
classRegistry.setClass(ImagePlaceholderObject, "image-placeholder");

```

## lib/canvas/paperNormalise.ts

```ts
const clampChannel = (n: number): number =>
  Math.min(255, Math.max(0, Math.round(n)));

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
  i: number,
  data: Uint8ClampedArray,
): number {
  const dr = a[0] - data[i]!;
  const dg = a[1] - data[i + 1]!;
  const db = a[2] - data[i + 2]!;
  return Math.sqrt(dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114);
}

export function estimatePaperColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const i = pixelAt(data, width, x, y);
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  return n === 0 ? [255, 255, 255] : [clampChannel(r / n), clampChannel(g / n), clampChannel(b / n)];
}

export function normalisePaper(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const paper = estimatePaperColour(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue: Array<[number, number]> = [];
  const max = 54;
  for (let x = 0; x < width; x++) {
    queue.push([x, 0], [x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push([0, y], [width - 1, y]);
  }

  const canReplace = (x: number, y: number): boolean => {
    const i = pixelAt(data, width, x, y);
    const d = distance(paper, paper, i, data);
    return d < max;
  };

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const index = y * width + x;
    if (visited[index]) continue;
    visited[index] = 1;
    if (!canReplace(x, y)) continue;
    const i = pixelAt(data, width, x, y);
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
}

```

## lib/canvas/referenceBackground.ts

```ts


import { FabricImage, type Canvas } from "fabric";

export interface ReferenceHandle {
  image: FabricImage;

  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;

  sourceDataUrl: string;
  crop: ReferenceCrop;
  rotation: 0 | 90 | 180 | 270;
}

export interface ReferenceCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const EMPTY_REFERENCE_CROP: ReferenceCrop = { top: 0, right: 0, bottom: 0, left: 0 };

export function sampleBorderColor(image: FabricImage): string {
  try {
    const nw = image.width || 0;
    const nh = image.height || 0;
    if (nw <= 0 || nh <= 0) return "#ffffff";
    const scale = Math.min(1, 32 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const el = document.createElement("canvas");
    el.width = w;
    el.height = h;
    const ctx = el.getContext("2d");
    if (!ctx) return "#ffffff";
    const src = image.getElement() as HTMLImageElement;
    ctx.drawImage(src, 0, 0, w, h);
    const ring = [
      ...row(ctx, 0, 0, w),
      ...row(ctx, 0, h - 1, w),
      ...column(ctx, 0, 0, h),
      ...column(ctx, w - 1, 0, h),
    ];
    if (ring.length === 0) return "#ffffff";
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [cr, cg, cb] of ring) {
      r += cr;
      g += cg;
      b += cb;
    }
    const n = ring.length;
    const hex = (v: number) =>
      Math.round(v / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return "#ffffff";
  }
}

function row(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < w; i++) {
    const d = ctx.getImageData(x + i, y, 1, 1).data;
    out.push([d[0]!, d[1]!, d[2]!]);
  }
  return out;
}

function column(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < h; i++) {
    const d = ctx.getImageData(x, y + i, 1, 1).data;
    out.push([d[0]!, d[1]!, d[2]!]);
  }
  return out;
}

export async function install(
  canvas: Canvas,
  dataUrl: string,
  opacity: number,
): Promise<ReferenceHandle> {
  const image = await FabricImage.fromURL(dataUrl, {
    crossOrigin: "anonymous",
  });
  const width = Math.round(image.width ?? 0);
  const height = Math.round(image.height ?? 0);
  const ref: ReferenceHandle = {
    image,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    sourceDataUrl: dataUrl,
    crop: { ...EMPTY_REFERENCE_CROP },
    rotation: 0,
  };
  image.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
    opacity: clampOpacity(opacity),
  } as never);
  fitTo(ref, { width: width || 1, height: height || 1 });
  canvas.backgroundImage = image;
  canvas.backgroundColor = sampleBorderColor(image);
  canvas.requestRenderAll();
  return ref;
}

export async function buildAdjustedReference(
  current: ReferenceHandle,
  crop: ReferenceCrop,
  rotation: 0 | 90 | 180 | 270,
  opacity: number,
): Promise<ReferenceHandle> {
  const source = await loadImage(current.sourceDataUrl);
  const safeCrop = clampCrop(crop);
  const sx = source.naturalWidth * safeCrop.left / 100;
  const sy = source.naturalHeight * safeCrop.top / 100;
  const sw = source.naturalWidth * (100 - safeCrop.left - safeCrop.right) / 100;
  const sh = source.naturalHeight * (100 - safeCrop.top - safeCrop.bottom) / 100;
  const sideways = rotation === 90 || rotation === 270;
  const outWidth = Math.max(1, Math.round(sideways ? sh : sw));
  const outHeight = Math.max(1, Math.round(sideways ? sw : sh));
  const work = document.createElement("canvas");
  work.width = outWidth;
  work.height = outHeight;
  const context = work.getContext("2d");
  if (!context) throw new Error("Could not prepare the cropped reference image.");
  if (rotation === 90) {
    context.translate(outWidth, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(outWidth, outHeight);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, outHeight);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  const image = await FabricImage.fromURL(work.toDataURL("image/png"), {
    crossOrigin: "anonymous",
  });
  image.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
    opacity: clampOpacity(opacity),
  } as never);
  return {
    image,
    width: Math.round(image.width ?? outWidth),
    height: Math.round(image.height ?? outHeight),
    sourceWidth: current.sourceWidth,
    sourceHeight: current.sourceHeight,
    sourceDataUrl: current.sourceDataUrl,
    crop: safeCrop,
    rotation,
  };
}

export function cropForPage(
  width: number,
  height: number,
  page: { width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
): ReferenceCrop {

  const sideways = rotation === 90 || rotation === 270;
  const imageAspect = width / Math.max(1, height);
  const pageAspect = sideways
    ? page.height / Math.max(1, page.width)
    : page.width / Math.max(1, page.height);
  if (imageAspect > pageAspect) {
    const keep = pageAspect / imageAspect;
    const trim = (100 - keep * 100) / 2;
    return { top: 0, right: trim, bottom: 0, left: trim };
  }
  const keep = imageAspect / pageAspect;
  const trim = (100 - keep * 100) / 2;
  return { top: trim, right: 0, bottom: trim, left: 0 };
}

function clampCrop(crop: ReferenceCrop): ReferenceCrop {
  const top = clampPercent(crop.top);
  const right = clampPercent(crop.right);
  const bottom = clampPercent(crop.bottom);
  const left = clampPercent(crop.left);
  const horizontalScale = Math.min(1, 90 / Math.max(1, left + right));
  const verticalScale = Math.min(1, 90 / Math.max(1, top + bottom));
  return {
    top: top * verticalScale,
    right: right * horizontalScale,
    bottom: bottom * verticalScale,
    left: left * horizontalScale,
  };
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(90, Math.max(0, value)) : 0;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the original reference image."));
    image.src = src;
  });
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

export function fitTo(
  ref: ReferenceHandle,
  doc: { width: number; height: number },
): void {
  const nw = ref.width || 1;
  const nh = ref.height || 1;
  const scale = Math.min(doc.width / nw, doc.height / nh);
  const width = nw * scale;
  const height = nh * scale;
  ref.image.set({
    left: (doc.width - width) / 2,
    top: (doc.height - height) / 2,
    originX: "left",
    originY: "top",
    scaleX: scale,
    scaleY: scale,
  } as never);
  ref.image.setCoords();
}

export function setVisible(
  canvas: Canvas,
  ref: ReferenceHandle | null,
  visible: boolean,
): void {
  if (!ref) return;
  canvas.backgroundImage = visible ? ref.image : undefined;
  canvas.requestRenderAll();
}

export function setOpacity(ref: ReferenceHandle | null, value: number): void {
  if (!ref) return;
  ref.image.set({ opacity: clampOpacity(value) } as never);
}

export function remove(canvas: Canvas): void {
  canvas.backgroundImage = undefined;
  canvas.backgroundColor = "";
  canvas.requestRenderAll();
}

```

## lib/canvas/sharedSelection.ts

```ts
import type { TemplateObject } from "@/lib/template/types";

export interface SharedSelection {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;

  opacity?: number;
  visible?: boolean;
  locked?: boolean;
}

export type SharedKey = "stroke" | "strokeWidth" | "fill" | "visible" | "locked";

export function acceptsSharedPaint(o: TemplateObject): boolean {
  return (
    o.type === "rect" ||
    o.type === "rounded-rect" ||
    o.type === "ellipse" ||
    o.type === "line" ||
    o.type === "hr" ||
    o.type === "vr" ||
    o.type === "polygon" ||
    o.type === "freehand" ||
    o.type === "text" ||
    o.type === "field"
  );
}

export function acceptsVisibility(o: TemplateObject): boolean {
  return o.type !== "table";
}

function agree<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0]!;
  return values.every((v) => v === first) ? first : undefined;
}

export function sharedSelection(
  objects: readonly TemplateObject[],
): SharedSelection {
  if (objects.length === 0) return {};

  const paintable = objects.filter(acceptsSharedPaint);
  const out: SharedSelection = {};

  if (paintable.length > 0) {
    out.stroke = agree(paintable.map((o) => o.stroke));
    out.strokeWidth = agree(paintable.map((o) => o.strokeWidth));

    const fills = paintable.map((o) => o.fill).filter((f) => f !== undefined);
    out.fill = agree(fills);
  }

  const opacities = objects.map((o) => o.opacity).filter((n) => typeof n === "number");
  if (opacities.length > 0) {

    out.opacity = opacities.reduce((a, b) => a + b, 0) / opacities.length;
  }

  const visible = objects.filter(acceptsVisibility);
  if (visible.length > 0) out.visible = agree(visible.map((o) => o.visible));

  out.locked = agree(objects.map((o) => o.locked));

  return out;
}
```

## lib/canvas/snap.ts

```ts


export interface Levels {
  x: number[];
  y: number[];
}

export interface SnapLine {

  axis: "x" | "y";
  pos: number;
}

export interface Edges {
  left: number;
  centreX: number;
  right: number;
  top: number;
  centreY: number;
  bottom: number;
}

export function levelsFromBounds(
  bounds: Array<{ left: number; top: number; right: number; bottom: number }>,
): Levels {
  const x: number[] = [];
  const y: number[] = [];
  for (const b of bounds) {
    x.push(b.left, (b.left + b.right) / 2, b.right);
    y.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  return { x, y };
}

export function snapToLevels(
  edges: Edges,
  levels: Levels,
  tolerance: number,
): { dx: number; dy: number; guides: SnapLine[] } {
  const bestX = bestOnAxis([edges.left, edges.centreX, edges.right], levels.x, tolerance);
  const bestY = bestOnAxis([edges.top, edges.centreY, edges.bottom], levels.y, tolerance);
  const guides: SnapLine[] = [];
  if (bestX) guides.push({ axis: "x", pos: bestX.level });
  if (bestY) guides.push({ axis: "y", pos: bestY.level });
  return {
    dx: bestX ? bestX.delta : 0,
    dy: bestY ? bestY.delta : 0,
    guides,
  };
}

interface Best {
  level: number;
  delta: number;
}

function bestOnAxis(moving: number[], candidates: number[], tolerance: number): Best | null {
  let best: Best | null = null;
  for (const m of moving) {
    for (const c of candidates) {
      const delta = c - m;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { level: c, delta };
    }
  }
  return best;
}

```

## lib/canvas/strokeDefaults.ts

```ts


export const DEFAULT_STROKE_WIDTH = 1.5;

export const MIN_STROKE_DEVICE_PX = 1;

export function renderedStrokeWidth(strokeWidth: number, zoom: number): number {
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) return strokeWidth;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(strokeWidth, MIN_STROKE_DEVICE_PX / z);
}

export function usesDefaultStroke(obj: {
  appType?: string;
  type?: string;
}): boolean {
  const kind = obj.appType ?? obj.type ?? "";
  return (
    kind === "line" ||
    kind === "hr" ||
    kind === "vr" ||
    kind === "rect" ||
    kind === "rounded-rect" ||
    kind === "ellipse" ||
    kind === "polygon" ||
    kind === "freehand"
  );
}

export function applyStrokeFloor(
  obj: {
    strokeWidth?: number;
    set?: (v: unknown, o?: unknown) => void;
  } & Record<string, unknown>,
  getZoom: () => number,
): void {
  const target = obj as {
    _render?: (ctx: CanvasRenderingContext2D) => void;
    strokeWidth?: number;
    set?: (v: unknown) => void;
    __strokeFloorInstalled?: boolean;
  };
  if (target.__strokeFloorInstalled || typeof target._render !== "function") return;
  target.__strokeFloorInstalled = true;
  target.set?.({ objectCaching: false, strokeUniform: true } as never);

  const inner = target._render.bind(obj) as (ctx: CanvasRenderingContext2D) => void;
  target._render = (ctx: CanvasRenderingContext2D): void => {
    const stored = (obj.strokeWidth ?? 0) as number;
    const painted = renderedStrokeWidth(stored, getZoom());
    if (painted === stored) {
      inner(ctx);
      return;
    }

    target.strokeWidth = painted;
    try {
      inner(ctx);
    } finally {
      target.strokeWidth = stored;
    }
  };
}
```

## lib/canvas/tableGrid.ts

```ts
import {
  columnLines,
  rowLines,
  sum,
  totalHeight,
  totalWidth,
} from "@/lib/template/geometry";

export interface GridSegment {
  vertical: boolean;
  at: number;
  length: number;

  interior: boolean;
}

export function gridSegments(
  colWidths: readonly number[],
  rowHeights: readonly number[],
): GridSegment[] {
  const xs = columnLines(colWidths);
  const ys = rowLines(rowHeights);
  const w = totalWidth(colWidths);
  const h = totalHeight(rowHeights);
  const out: GridSegment[] = [];
  const lastCol = xs.length - 1;
  const lastRow = ys.length - 1;

  for (let i = 0; i < xs.length; i += 1) {
    out.push({
      vertical: true,
      at: xs[i]!,
      length: h,
      interior: i > 0 && i < lastCol,
    });
  }

  for (let i = 0; i < ys.length; i += 1) {
    out.push({
      vertical: false,
      at: ys[i]!,
      length: w,
      interior: i > 0 && i < lastRow,
    });
  }
  return out;
}

export function gridWidth(colWidths: readonly number[]): number {
  return sum(colWidths);
}

export function gridHeight(rowHeights: readonly number[]): number {
  return sum(rowHeights);
}

export function interiorGridLevels(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  origin: { x: number; y: number },
): { x: number[]; y: number[] } {
  const x = new Set<number>();
  const y = new Set<number>();
  for (const seg of gridSegments(colWidths, rowHeights)) {
    if (!seg.interior) continue;

    if (seg.vertical) x.add(origin.x + seg.at);
    else y.add(origin.y + seg.at);
  }
  return { x: [...x], y: [...y] };
}
```

## lib/canvas/tableRepeat.ts

```ts
import { DEFAULT_REPEAT_MAX_ITEMS } from "@/lib/template/types";
import type { TableRepeat } from "@/lib/template/types";

export function normaliseRepeat(
  raw: Partial<TableRepeat> | null | undefined,
  rowCount: number,
): TableRepeat | null {
  if (!raw || typeof raw !== "object") return null;
  const { startRow, endRow, key } = raw;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return null;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return null;
  if (!Number.isInteger(rowCount) || rowCount <= 0 || endRow >= rowCount) return null;
  if (typeof key !== "string" || key.trim().length === 0) return null;
  return {
    startRow,
    endRow,
    key: key.trim(),
    repeatHeader: raw.repeatHeader === true,
    maxItems:
      typeof raw.maxItems === "number" && Number.isInteger(raw.maxItems) && raw.maxItems > 0
        ? Math.min(DEFAULT_REPEAT_MAX_ITEMS, raw.maxItems)
        : DEFAULT_REPEAT_MAX_ITEMS,
  };
}

```

## lib/canvas/viewport.ts

```ts


export const MAX_ZOOM = 8;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  zoom: number;
  tx: number;
  ty: number;
}

function isFiniteNumber(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

export function containScale(pane: Size, doc: Size): number {
  if (
    pane.width <= 0 ||
    pane.height <= 0 ||
    doc.width <= 0 ||
    doc.height <= 0
  ) {
    return 1;
  }
  return Math.min(pane.width / doc.width, pane.height / doc.height);
}

export function clampZoom(zoom: number, pane: Size, doc: Size): number {
  const fit = containScale(pane, doc);
  const floor = Math.min(MAX_ZOOM, Math.max(fit * 0.5, 0.05));
  if (!isFiniteNumber(zoom)) return floor;
  return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}

export const PAN_SLACK = 32;

export function clampPan(t: number, paneSize: number, imgSize: number): number {
  if (!isFiniteNumber(t) || !(paneSize > 0) || !(imgSize > 0)) {
    return (paneSize - imgSize) / 2;
  }
  if (imgSize <= paneSize) {
    return Math.min(paneSize - imgSize + PAN_SLACK, Math.max(-PAN_SLACK, t));
  }
  return Math.min(PAN_SLACK, Math.max(paneSize - imgSize - PAN_SLACK, t));
}

export function sceneToScreen(point: Point, view: Viewport): Point {
  return {
    x: point.x * view.zoom + view.tx,
    y: point.y * view.zoom + view.ty,
  };
}

export function screenToScene(point: Point, view: Viewport): Point {
  if (!(view.zoom > 0)) return { x: 0, y: 0 };
  return {
    x: (point.x - view.tx) / view.zoom,
    y: (point.y - view.ty) / view.zoom,
  };
}

export function viewportTransform(
  view: Viewport,
): [number, number, number, number, number, number] {
  return [view.zoom, 0, 0, view.zoom, view.tx, view.ty];
}

export function zoomAbout(
  cursor: Point,
  newZoom: number,
  view: Viewport,
  pane: Size,
  doc: Size,
): Viewport {
  const zoom = clampZoom(newZoom, pane, doc);
  const scene = screenToScene(cursor, view);
  const tx = cursor.x - scene.x * zoom;
  const ty = cursor.y - scene.y * zoom;
  return {
    zoom,
    tx: clampPan(tx, pane.width, doc.width * zoom),
    ty: clampPan(ty, pane.height, doc.height * zoom),
  };
}

export function fitView(pane: Size, doc: Size): Viewport {
  const zoom = clampZoom(containScale(pane, doc), pane, doc);
  return {
    zoom,
    tx: clampPan((pane.width - doc.width * zoom) / 2, pane.width, doc.width * zoom),
    ty: clampPan((pane.height - doc.height * zoom) / 2, pane.height, doc.height * zoom),
  };
}

export function panBy(
  dx: number,
  dy: number,
  view: Viewport,
  pane: Size,
  doc: Size,
): Viewport {
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return view;
  return {
    ...view,
    tx: clampPan(view.tx + dx, pane.width, doc.width * view.zoom),
    ty: clampPan(view.ty + dy, pane.height, doc.height * view.zoom),
  };
}

```

## lib/client/billNameFromFile.ts

```ts


const CAMERA_NAME = /^(img|dsc|dscn|pxl|mvimg|gopr|photo|image|snap|capture)[-_ ]?\d+$/i;

const CAMERA_TIMESTAMP_NAME =
  /^(img|dsc|dscn|pxl|mvimg|gopr|photo|image|snap|capture)[-_ ]+\d{8}([-_ ]\d{4,6})?$/i;

const SCREENSHOT_NAME = /^(screen[-_ ]?shot|screenshot|screen capture|cleanshot)([-_ ].*)?$/i;

const TIMESTAMP_ONLY = /^\d{4}[-_.]?\d{2}[-_.]?\d{2}([-_ .]\d{2,6})?$/;

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

function baseName(name: string): string {
  const parts = stripExtension(name).split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function tidy(name: string): string {
  return name
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .trim();
}

export function billNameFromFile(filename: string): string {
  const stem = baseName(filename);
  const cleaned = tidy(stem);

  if (cleaned.length === 0) return "Bill";
  if (CAMERA_NAME.test(cleaned)) return "Bill";
  if (CAMERA_TIMESTAMP_NAME.test(cleaned)) return "Bill";
  if (SCREENSHOT_NAME.test(cleaned)) return "Bill";
  if (TIMESTAMP_ONLY.test(cleaned)) return "Bill";

  if (/^\d+$/.test(cleaned)) return "Bill";

  return cleaned;
}

```

## lib/client/draftStore.ts

```ts
"use client";

import { parseTemplate } from "@/lib/template/parse";
import type { BillTemplate } from "@/lib/template/types";

const DRAFT_KEY = "btm:recovery-draft";

export interface EditorDraft {
  name: string;
  savedAt: string;
  template: BillTemplate;
}

export function saveDraft(name: string, template: BillTemplate): boolean {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: name.trim() || "Untitled bill template",
      savedAt: new Date().toISOString(),
      template,
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(): EditorDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.savedAt !== "string") return null;
    return {
      name: record.name,
      savedAt: record.savedAt,
      template: parseTemplate(record.template),
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {

  }
}

```

## lib/client/readImageFile.ts

```ts
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function readImageFile(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be smaller than 20 MB.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be decoded. Try exporting it as PNG or JPG.");
  }
  const pixels = bitmap.width * bitmap.height;
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  if (width > 20_000 || height > 20_000) {
    throw new Error("The image dimensions exceed the editor's 20,000 px page limit. Resize it first.");
  }
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new Error("The image is too large to edit. Resize it to 40 megapixels or less first.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onabort = () => reject(new Error("Image loading was cancelled."));
    reader.readAsDataURL(file);
  });
}

```

## lib/client/readTemplateFile.ts

```ts
import { parseTemplate } from "@/lib/template/parse";
import type { BillTemplate } from "@/lib/template/types";

const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

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

```

## lib/client/sampleBill.ts

```ts


export function renderSampleBill(): string {
  const width = 720;
  const height = 960;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser did not provide a drawing canvas.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1a1a1a";
  ctx.strokeStyle = "#1a1a1a";

  ctx.font = "bold 34px Georgia, serif";
  ctx.fillText("RIVERSTONE HARDWARE", 48, 88);
  ctx.font = "16px Georgia, serif";
  ctx.fillText("14 Mill Lane · Open 7 days", 48, 116);

  ctx.font = "16px Georgia, serif";
  ctx.fillText("Receipt #", 448, 88);
  ctx.fillText("Date", 448, 116);
  ctx.font = "16px monospace";
  ctx.fillText("10842", 560, 88);
  ctx.fillText("14 Oct 2026", 560, 116);

  ctx.beginPath();
  ctx.moveTo(48, 144);
  ctx.lineTo(672, 144);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = "bold 15px Georgia, serif";
  ctx.fillText("Item", 48, 176);
  ctx.fillText("Qty", 440, 176);
  ctx.fillText("Price", 512, 176);
  ctx.fillText("Amount", 596, 176);

  const items: Array<[string, string, string, string]> = [
    ["Galvanised nails, 50mm", "2", "6.40", "12.80"],
    ["Wood screws, 30mm", "1", "8.95", "8.95"],
    ["Hinge, brass 75mm", "4", "3.20", "12.80"],
    ["Wood glue 250ml", "1", "7.50", "7.50"],
    ["Sandpaper sheets", "6", "0.95", "5.70"],
  ];
  ctx.font = "15px Georgia, serif";
  let y = 212;
  for (const [item, qty, price, amount] of items) {
    ctx.fillText(item, 48, y);
    ctx.fillText(qty, 440, y);
    ctx.fillText(price, 512, y);
    ctx.fillText(amount, 596, y);
    y += 34;
  }

  ctx.beginPath();
  ctx.moveTo(48, y + 8);
  ctx.lineTo(672, y + 8);
  ctx.lineWidth = 1;
  ctx.stroke();
  y += 44;

  ctx.font = "15px Georgia, serif";
  ctx.fillText("Subtotal", 448, y);
  ctx.fillText("47.75", 596, y);
  ctx.fillText("Tax 8%", 448, y + 28);
  ctx.fillText("3.82", 596, y + 28);
  ctx.font = "bold 18px Georgia, serif";
  ctx.fillText("TOTAL", 448, y + 64);
  ctx.fillText("51.57", 596, y + 64);

  ctx.beginPath();
  ctx.moveTo(440, y + 76);
  ctx.lineTo(672, y + 76);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.strokeRect(512, y + 120, 160, 96);
  ctx.font = "14px Georgia, serif";
  ctx.fillText("PAID", 566, y + 174);

  ctx.font = "13px Georgia, serif";
  ctx.fillText("Thank you — please keep this receipt.", 48, height - 48);

  return canvas.toDataURL("image/png");
}

```

## lib/client/shareOut.ts

```ts
import { downloadText, safeFilename } from "@/lib/export/download";
import { buildShareDocument } from "@/lib/share/document";
import type { BillTemplate } from "@/lib/template/types";

export async function shareTemplateAsHtml(
  name: string,
  template: BillTemplate,
): Promise<void> {
  const response = await fetch("/sharekit.js");
  if (!response.ok) {
    throw new Error(`the share kit is unavailable (${response.status})`);
  }
  const kit = await response.text();
  downloadText(
    buildShareDocument(template, kit),
    `${safeFilename(name || "template")}.html`,
    "text/html;charset=utf-8",
  );
}

```

## lib/client/steps.ts

```ts


export type StepId = "bill" | "trace" | "mark" | "test" | "share";

export const STEP_ORDER: StepId[] = ["bill", "trace", "mark", "test", "share"];

export const STEP_LABELS: Record<StepId, string> = {
  bill: "Your bill",
  trace: "Trace",
  mark: "Mark data",
  test: "Test",
  share: "Save & share",
};

export interface StepFacts {

  hasReference: boolean;

  objectCount: number;

  dataFieldCount: number;

  testedOnce: boolean;

  savedOnce: boolean;
}

export const STEP_COMPLETE: Record<StepId, (facts: StepFacts) => boolean> = {
  bill: (f) => f.hasReference,
  trace: (f) => f.objectCount > 0,
  mark: (f) => f.dataFieldCount > 0,
  test: (f) => f.testedOnce,
  share: (f) => f.savedOnce,
};

export function stepDone(facts: StepFacts): Record<StepId, boolean> {
  const done = {} as Record<StepId, boolean>;
  for (const step of STEP_ORDER) done[step] = STEP_COMPLETE[step](facts);
  return done;
}

export function firstIncomplete(done: Record<StepId, boolean>): StepId | null {
  for (const step of STEP_ORDER) if (!done[step]) return step;
  return null;
}

export function nextStep(step: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(step);
  return index >= 0 && index < STEP_ORDER.length - 1
    ? STEP_ORDER[index + 1]
    : null;
}

```

## lib/client/templateStore.ts

```ts
"use client";

import type { BillTemplate } from "@/lib/template/types";
import { parseTemplate } from "@/lib/template/parse";

const LIB_KEY = "btm:templates";
const PENDING_KEY = "btm:pendingTemplate";

export interface SavedTemplate {
  name: string;
  updatedAt: string;
  template: BillTemplate;
}

function readAll(): SavedTemplate[] {
  try {
    const raw = window.localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: SavedTemplate[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" || item === null ||
        typeof (item as SavedTemplate).name !== "string" ||
        typeof (item as SavedTemplate).updatedAt !== "string"
      ) continue;
      try {
        valid.push({
          name: (item as SavedTemplate).name,
          updatedAt: (item as SavedTemplate).updatedAt,
          template: parseTemplate((item as SavedTemplate).template),
        });
      } catch {

      }
    }
    return valid;
  } catch {
    return [];
  }
}

function writeAll(all: SavedTemplate[]): boolean {
  try {
    window.localStorage.setItem(LIB_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function listTemplates(): SavedTemplate[] {
  return readAll()
    .map((t) => t)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTemplate(name: string, template: BillTemplate): boolean {
  const now = new Date().toISOString();
  const all = readAll().filter((t) => t.name !== name);
  all.push({ name, updatedAt: now, template });
  return writeAll(all);
}

export function loadTemplate(name: string): BillTemplate | null {
  return readAll().find((t) => t.name === name)?.template ?? null;
}

export function deleteTemplate(name: string): void {
  writeAll(readAll().filter((t) => t.name !== name));
}

export function setPendingTemplate(template: BillTemplate): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(template));
  } catch {

  }
}

export function consumePendingTemplate(): BillTemplate | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    return parseTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
}

```

## lib/client/toastQueue.ts

```ts


export type ToastKind = "info" | "success" | "warning" | "error";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;

  detail?: string;
};

export const MAX_TOASTS = 3;

export function pushToast(
  list: ToastItem[],
  input: Omit<ToastItem, "id">,
  id: number,
): ToastItem[] {
  const next = [...list, { ...input, id }];
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
}

export function dismissToast(list: ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id);
}

export function autoDismissMs(kind: ToastKind): number | null {
  return kind === "error" || kind === "warning" ? null : 6000;
}

```

## lib/export/download.ts

```ts
"use client";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(
  text: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadDataUrl(
  dataUrl: string,
  filename: string,
): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(
    JSON.stringify(value, null, 2),
    filename,
    "application/json;charset=utf-8",
  );
}

export function safeFilename(name: string, fallback = "bill-template"): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

```

## lib/export/renderTemplate.ts

```ts
"use client";

import { FabricImage, StaticCanvas } from "fabric";

import { hydrateTemplate } from "@/lib/template/hydrate";
import type { BillTemplate } from "@/lib/template/types";

async function preloadImages(
  template: BillTemplate,
): Promise<Map<string, FabricImage>> {
  const registry = new Map<string, FabricImage>();
  await Promise.all(
    template.objects.map(async (o) => {

      if (o.type !== "image-placeholder" && o.type !== "bill-part") return;
      const src = typeof o.src === "string" ? o.src : undefined;
      if (!src || registry.has(src)) return;
      try {
        registry.set(src, await FabricImage.fromURL(src, { crossOrigin: "anonymous" }));
      } catch {
        registry.delete(src);
      }
    }),
  );
  return registry;
}

export async function renderTemplate(
  template: BillTemplate,
  scale = 1,
): Promise<StaticCanvas> {
  const el = document.createElement("canvas");
  const canvas = new StaticCanvas(el, {
    width: Math.max(1, Math.round(template.document.width * scale)),
    height: Math.max(1, Math.round(template.document.height * scale)),
    backgroundColor: "#ffffff",
    enableRetinaScaling: false,
  });

  const images = await preloadImages(template);
  const objects = hydrateTemplate(template, images);
  for (const o of objects) {
    if (scale !== 1) {
      o.set({
        left: (o.left ?? 0) * scale,
        top: (o.top ?? 0) * scale,
        width: (o.width ?? 0) * scale,
        height: (o.height ?? 0) * scale,
      } as never);
    }
    canvas.add(o);
  }
  canvas.renderAll();
  return canvas;
}

export async function templateToSvgString(
  template: BillTemplate,
  options: { includeXmlDeclaration?: boolean } = {},
): Promise<string> {
  const canvas = await renderTemplate(template, 1);
  try {
    return canvas.toSVG({
      suppressPreamble: options.includeXmlDeclaration !== true,
      viewBox: {
        x: 0,
        y: 0,
        width: template.document.width,
        height: template.document.height,
      },
      width: String(template.document.width),
      height: String(template.document.height),
    });
  } finally {
    canvas.dispose();
  }
}

```

## lib/export/toDocx.ts

```ts
"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { downloadBlob, safeFilename } from "./download";
import type {
  BillTemplate,
  BillPartObject,
  ImagePlaceholderObject,
  LineObject,
  ShapeObject,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";

const PX_TO_TWIP = 15;
const PX_TO_HALF_PT = 1.5;

function twips(px: number): number {
  return Math.round(px * PX_TO_TWIP);
}

function halfPoints(px: number): number {
  return Math.max(2, Math.round(px * PX_TO_HALF_PT));
}

function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

interface Placed {
  object: TemplateObject;
  x: number;
  y: number;
  width: number;
  height: number;
}

function bounds(o: TemplateObject): Placed {
  return {
    object: o,
    x: o.x,
    y: o.y,
    width: Math.max(0, o.width),
    height: Math.max(0, o.height),
  };
}

function buildBands(items: Placed[], tolerance = 6): Placed[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Placed[][] = [];
  let current: Placed[] = [];
  let bottom = -Infinity;

  for (const item of sorted) {
    if (current.length === 0 || item.y < bottom - tolerance) {
      if (current.length) bands.push(current);
      current = [item];
      bottom = item.y + item.height;
    } else {
      current.push(item);
      bottom = Math.max(bottom, item.y + item.height);
    }
  }
  if (current.length) bands.push(current);
  return bands;
}

function border(color: string, size: number) {
  return {
    style: size > 0 ? BorderStyle.SINGLE : BorderStyle.NONE,
    size: Math.max(2, Math.round(size * 8)),
    color: color.replace("#", "").toUpperCase() || "000000",
  };
}

const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};

function textParagraph(
  o: TextObject,
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; indent?: number } = {},
): Paragraph {
  const color = (o.fill && o.fill !== "transparent" ? o.fill : "#000000")
    .replace("#", "")
    .toUpperCase();
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    indent: opts.indent ? { left: twips(opts.indent) } : undefined,
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({
        text: clean(o.text),
        font: o.fontFamily || "Arial",
        size: halfPoints(o.fontSize),
        bold: o.fontWeight === "bold",
        italics: o.fontStyle === "italic",
        color,
      }),
    ],
  });
}

function shapeParagraph(o: ShapeObject | LineObject): Paragraph {
  const isLineLike = o.type === "line" || o.type === "hr" || o.type === "vr";
  const indent = twips(Math.max(0, o.x));

  if (isLineLike) {
    const line = o as LineObject;
    const isVertical = o.type === "vr";
    const isHorizontal = o.type === "hr" || Math.abs(line.y2 - line.y) < 1.5;
    if (isVertical) {

      return new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: indent },
        border: { right: border(o.stroke, Math.max(0.5, o.strokeWidth)) },
        children: [new TextRun({ text: "", size: 2 })],
      });
    }
    if (isHorizontal) {
      return new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: indent },
        border: isHorizontal
          ? { bottom: border(o.stroke, Math.max(0.5, o.strokeWidth)) }
          : undefined,
        children: [new TextRun({ text: "", size: 2 })],
      });
    }
    return new Paragraph({
      spacing: { before: 0, after: 0 },
      indent: { left: indent },
      border: { bottom: border(o.stroke, Math.max(0.5, o.strokeWidth)) },
      children: [new TextRun({ text: "", size: 2 })],
    });
  }

  const shape = o as ShapeObject;
  const filled = shape.fill && shape.fill !== "transparent";
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    indent: { left: indent },
    border: {
      top: border(shape.stroke, shape.strokeWidth),
      bottom: border(shape.stroke, shape.strokeWidth),
      left: border(shape.stroke, shape.strokeWidth),
      right: border(shape.stroke, shape.strokeWidth),
    },
    shading: filled
      ? { fill: shape.fill.replace("#", "").toUpperCase() }
      : undefined,
    children: [
      new TextRun({
        text: "",
        size: halfPoints(Math.max(6, Math.min(24, shape.height))),
      }),
    ],
  });
}

function placeholderParagraph(
  o: ImagePlaceholderObject,
  indent?: number,
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    indent: indent ? { left: twips(indent) } : undefined,
    children: [
      new TextRun({
        text: `[${o.label || o.placeholderRole.toUpperCase()}]`,
        font: "Arial",
        size: halfPoints(11),
        color: "808080",
        italics: true,
      }),
    ],
  });
}

function billPartImageData(src: unknown): Uint8Array | null {
  if (typeof src !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/.exec(src);
  if (!match) return null;
  try {
    const binary = atob(match[1]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function billPartParagraph(
  o: BillPartObject,
  width: number,
  height: number,
  indent?: number,
): Paragraph {
  const data = billPartImageData(o.src);
  if (!data) {

    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      indent: indent ? { left: twips(indent) } : undefined,
      children: [
        new TextRun({
          text: `[${o.name || "BILL PART"}]`,
          font: "Arial",
          size: halfPoints(11),
          color: "808080",
          italics: true,
        }),
      ],
    });
  }
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    indent: indent ? { left: twips(indent) } : undefined,
    children: [
      new ImageRun({
        type: "png",
        data,
        transformation: {
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        },
        altText: {
          name: typeof o.name === "string" ? o.name : "Bill part",
          description: "Cut-out from the bill reference image",
        },
      }),
    ],
  });
}

function tableToDocx(o: TableObject): Table {
  const rows = o.rowHeights.map((_, r) => {
    const cells = o.colWidths.map((_, c) => {
      const cell = o.cells[r * o.colWidths.length + c] ?? {
        text: "",
        textAlign: "left" as const,
        fontSize: 12,
        fontWeight: "normal" as const,
      };
      const isHeader = o.headerRow && r === 0;
      const colour = (
        isHeader ? o.headerTextColor : o.cellTextColor
      ).replace("#", "").toUpperCase();
      const align =
        cell.textAlign === "center"
          ? AlignmentType.CENTER
          : cell.textAlign === "right"
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT;
      return new TableCell({
        width: { size: twips(o.colWidths[c] ?? 0), type: WidthType.DXA },
        margins: {
          top: twips(o.padding),
          bottom: twips(o.padding),
          left: twips(o.padding),
          right: twips(o.padding),
        },
        shading: (() => {
          const fill = isHeader ? o.headerFill : o.cellFill;
          return fill && fill !== "transparent"
            ? { fill: fill.replace("#", "").toUpperCase() }
            : undefined;
        })(),
        children: [
          new Paragraph({
            alignment: align,
            spacing: { before: 0, after: 0 },
            children: [
              new TextRun({
                text: clean(cell.text),
                font: o.fontFamily || "Arial",
                size: halfPoints(cell.fontSize),
                bold: cell.fontWeight === "bold" || isHeader,
                color: colour,
              }),
            ],
          }),
        ],
      });
    });
    return new TableRow({ children: cells, height: { value: twips(o.rowHeights[r] ?? 0), rule: "atLeast" as never } });
  });

  const edge = border(o.borderColor, o.borderWidth);
  return new Table({
    width: { size: twips(o.width), type: WidthType.DXA },
    rows,
    borders: {
      top: edge,
      bottom: edge,
      left: edge,
      right: edge,
      insideHorizontal: edge,
      insideVertical: edge,
    },
  });
}

function bandToTable(band: Placed[]): Table {
  const ordered = [...band].sort((a, b) => a.x - b.x);
  const cells = ordered.map((item) => {
    const children: Paragraph[] = [];
    const o = item.object;
    if (o.type === "text") {
      children.push(
        textParagraph(o as TextObject, {
          align:
            (o as TextObject).textAlign === "center"
              ? AlignmentType.CENTER
              : (o as TextObject).textAlign === "right"
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
        }),
      );
    } else if (o.type === "image-placeholder") {
      children.push(placeholderParagraph(o as ImagePlaceholderObject));
    } else if (o.type === "bill-part") {
      children.push(
        billPartParagraph(o as BillPartObject, item.width, item.height),
      );
    } else if (o.type === "line" || o.type === "hr" || o.type === "vr") {
      children.push(shapeParagraph(o as LineObject));
    } else {
      children.push(shapeParagraph(o as ShapeObject));
    }
    return new TableCell({
      width: { size: twips(item.width), type: WidthType.DXA },
      borders: {
        top: NO_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
      },
      children,
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cells })],
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
  });
}

export async function exportDocx(template: BillTemplate): Promise<void> {
  const { width, height } = template.document;
  const placed = template.objects
    .filter((o) => o.visible)
    .map(bounds);
  const bands = buildBands(placed);

  const body: (Paragraph | Table)[] = [];
  let cursorY = 0;

  for (const band of bands) {
    const bandTop = Math.min(...band.map((b) => b.y));
    const bandHeight = Math.max(...band.map((b) => b.y + b.height)) - bandTop;
    const gap = Math.max(0, bandTop - cursorY);
    if (gap > 0) {
      body.push(
        new Paragraph({
          spacing: { before: twips(gap), after: 0 },
          children: [new TextRun({ text: "", size: 2 })],
        }),
      );
    }

    const tableItems = band.filter((b) => b.object.type === "table");
    const others = band.filter((b) => b.object.type !== "table");

    if (others.length === 1) {
      const only = others[0]!;
      if (only.object.type === "text") {
        const t = only.object as TextObject;
        body.push(
          textParagraph(t, {
            align:
              t.textAlign === "center"
                ? AlignmentType.CENTER
                : t.textAlign === "right"
                  ? AlignmentType.RIGHT
                  : AlignmentType.LEFT,
            indent: t.x,
          }),
        );
      } else if (only.object.type === "image-placeholder") {
        body.push(placeholderParagraph(only.object as ImagePlaceholderObject, only.object.x));
      } else if (only.object.type === "bill-part") {
        body.push(
          billPartParagraph(
            only.object as BillPartObject,
            only.width,
            only.height,
            only.object.x,
          ),
        );
      } else {
        body.push(
          new Paragraph({
            spacing: { before: 0, after: 0 },
            indent: { left: twips(only.object.x) },
            children: [new TextRun({ text: "", size: 2 })],
          }),
        );
        body.push(
          shapeParagraph(only.object as ShapeObject | LineObject),
        );
      }
    } else if (others.length > 1) {
      body.push(bandToTable(others));
    }

    for (const item of tableItems) {
      const t = item.object as TableObject;
      const indentP = new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: twips(t.x) },
        children: [new TextRun({ text: "", size: 2 })],
      });
      body.push(indentP);
      body.push(tableToDocx(t));
    }

    cursorY = bandTop + bandHeight;
  }

  const doc = new Document({
    creator: "Bill Template Maker",
    title: template.meta.name,
    description:
      "Structural bill template generated from a traced layout.",
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(width), height: twips(height) },
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        children:
          body.length > 0
            ? body
            : [
                new Paragraph({
                  heading: HeadingLevel.HEADING_1,
                  children: [new TextRun({ text: template.meta.name })],
                }),
              ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${safeFilename(template.meta.name)}.docx`);
}

```

## lib/export/toPackage.ts

```ts
"use client";

import { downloadBlob } from "@/lib/export/download";
import { buildPackage, writePackage } from "@/lib/package/build";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { Issue } from "@/lib/package/format";
import { parsePackage } from "@/lib/package/parse";
import { validatePackage } from "@/lib/package/validate";
import type { BillTemplate } from "@/lib/template/types";

export interface PackageExportResult {
  filename: string;
  bytes: Uint8Array;
  issues: Issue[];
}

export function buildPackageBytes(template: BillTemplate): {
  bytes: Uint8Array;
  issues: Issue[];
} {
  const bytes = writePackage(
    buildPackage(template, { computed: computedSpecsFor(template) }),
  );

  const { issues } = validatePackage(parsePackage(bytes));
  return { bytes, issues };
}

export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function packageFilename(template: BillTemplate): string {
  const name = template.meta?.name ?? "";
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${cleaned || "bill"}.btpkg`;
}

export function exportPackage(template: BillTemplate): PackageExportResult {
  const { bytes, issues } = buildPackageBytes(template);
  const errors = blockingIssues(issues);
  if (errors.length > 0) {
    throw new Error(describeIssues(errors));
  }

  const filename = packageFilename(template);

  downloadBlob(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), filename);

  return { filename, bytes, issues };
}

export function describeIssues(issues: Issue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}
```

## lib/export/toPdf.ts

```ts
"use client";

import { jsPDF } from "jspdf";

import { downloadBlob, safeFilename } from "./download";
import { templateToSvgString } from "./renderTemplate";
import type { BillTemplate } from "@/lib/template/types";

export async function exportPdf(
  template: BillTemplate,
  page?: { width: number; height: number },
): Promise<void> {
  const width = page && page.width > 0 ? page.width : template.document.width;
  const height = page && page.height > 0 ? page.height : template.document.height;
  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
  });

  const svg = await templateToSvgString(template);

  try {

    pdf.addSvgAsImage(svg, 0, 0, width, height, "bill-template", true);
  } catch {

    const { renderTemplate } = await import("./renderTemplate");
    const sc = await renderTemplate(template, 3);
    try {
      const dataUrl = sc.toDataURL({ format: "png", multiplier: 1 });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
    } finally {
      sc.dispose();
    }
  }

  downloadBlob(
    pdf.output("blob"),
    `${safeFilename(template.meta.name)}.pdf`,
  );
}

```

## lib/export/toSvg.ts

```ts
"use client";

import { downloadJson, downloadText, safeFilename } from "./download";
import { renderTemplate, templateToSvgString } from "./renderTemplate";
import type { BillTemplate } from "@/lib/template/types";

export function exportJson(template: BillTemplate): void {
  downloadJson(template, `${safeFilename(template.meta.name)}.json`);
}

export async function exportSvg(template: BillTemplate): Promise<void> {
  const svg = await templateToSvgString(template, {
    includeXmlDeclaration: true,
  });
  downloadText(
    svg,
    `${safeFilename(template.meta.name)}.svg`,
    "image/svg+xml;charset=utf-8",
  );
}

export async function exportPng(
  template: BillTemplate,
  multiplier = 2,
): Promise<void> {
  const canvas = await renderTemplate(template, multiplier);
  try {
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${safeFilename(template.meta.name)}.png`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    canvas.dispose();
  }
}

```

## lib/package/build.ts

```ts
import type { ComputedSpec, Package, PackageManifest } from "./format";
import { PACKAGE_VERSION } from "./format";
import { sha256HexBytes } from "../render/sha256";
import { extractTemplateFields } from "../template/dataBinding";
import { extractVariables } from "../template/placeholders";
import type { BillTemplate, TableObject, TemplateObject } from "../template/types";

import { strToU8, zipSync } from "fflate";

export interface BuildOptions {
  computed?: ComputedSpec[];
  currencyScale?: number;
}

const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,/i;

function declaredMime(src: string): string | undefined {
  return DATA_IMAGE.exec(src)?.[1]?.toLowerCase();
}

function imageExtension(src: string): string {
  const subtype = declaredMime(src)?.split("/")[1] ?? "";
  const cleaned = subtype
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return cleaned.length > 0 ? cleaned : "img";
}

function decodeDataUri(src: string, what: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error(
      `cannot decode the inline image of ${what}: this runtime has no base64 decoder, ` +
        `so the image cannot be archived and the package would be unusable`,
    );
  }
  const b64 = src.slice(src.indexOf(",") + 1);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function safeName(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "asset";
}

function bandColumns(t: TableObject, startRow: number, endRow: number): string[] {
  const width = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const text = cells[r * width + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

export function buildPackage(template: BillTemplate, options: BuildOptions = {}): Package {
  const files = new Map<string, Uint8Array>();
  const assets: PackageManifest["assets"] = [];
  const bySrc = new Map<string, string>();

  const uniqueAssetName = (id: string, ext: string): string => {
    const base = `assets/${safeName(id)}.${ext}`;
    if (!files.has(base)) return base;
    let n = 2;
    while (files.has(`assets/${safeName(id)}-${n}.${ext}`)) n += 1;
    return `assets/${safeName(id)}-${n}.${ext}`;
  };

  const objects: TemplateObject[] = template.objects.map((o) => {
    const src = (o as { src?: unknown }).src;

    if (typeof src !== "string" || !DATA_IMAGE.test(src)) return { ...o };

    const known = bySrc.get(src);
    if (known) return { ...o, src: `pkg://${known}` } as TemplateObject;

    const role = o.type === "bill-part" ? "bill-part" : "image-placeholder";
    const name = uniqueAssetName(o.id, imageExtension(src));

    const bytes = decodeDataUri(src, `object "${o.id}" (${o.name})`);
    bySrc.set(src, name);
    files.set(name, bytes);
    assets.push({
      id: o.id,
      role,
      file: name,

      mime: declaredMime(src)!,
      width: Math.round(o.width),
      height: Math.round(o.height),
    });
    return { ...o, src: `pkg://${name}` } as TemplateObject;
  });

  const templateJson = JSON.stringify(
    { ...template, meta: { ...template.meta, modifiedAt: "" }, objects },
    null,
    2,
  );
  files.set("template.json", strToU8(templateJson));

  const fields: PackageManifest["fields"] = extractTemplateFields({ ...template, objects }).map(
    (f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      source: f.source,
      objectName: f.objectName,
      ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
      ...(f.min !== undefined ? { min: f.min } : {}),
      ...(f.max !== undefined ? { max: f.max } : {}),
    }),
  );

  for (const o of template.objects) {
    if (o.type !== "table" || !o.repeat) continue;

    const key = typeof o.repeat.key === "string" ? o.repeat.key.trim() : "";

    if (key.length === 0) continue;

    const at = fields.findIndex((f) => f.key === key);
    const repeat = {
      key,
      label: o.name || key,
      type: "repeating" as const,
      source: "table" as const,
      objectName: o.name,

      columns: bandColumns(o, o.repeat.startRow, o.repeat.endRow),
      maxItems: o.repeat.maxItems,
    };
    if (at < 0) fields.push(repeat);
    else fields[at] = { ...fields[at], ...repeat };
  }

  const checksums: Record<string, string> = {};
  for (const [name, bytes] of files) checksums[name] = sha256HexBytes(bytes);

  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    templateVersion: template.templateVersion,
    name: template.meta?.name ?? "Untitled bill",
    document: {
      width: template.document?.width ?? 794,
      height: template.document?.height ?? 1123,
      unit: "px",
      dpi: 96,
      paper:
        template.document?.width === 794 && template.document?.height === 1123 ? "A4" : "custom",
      currencyScale: options.currencyScale ?? 2,
    },
    template: "template.json",
    assets,
    fonts: [],
    fields,
    computed: options.computed ?? [],
    checksums,
  };

  return { manifest, files };
}

export function writePackage(pkg: Package): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of pkg.files) entries[name] = bytes;
  entries["manifest.json"] = strToU8(JSON.stringify(pkg.manifest, null, 2));
  entries["manifest.json.sha256"] = strToU8(sha256HexBytes(entries["manifest.json"]!));
  return zipSync(entries, { level: 6, mtime: 315532800000 });
}

```

## lib/package/computedSpecs.ts

```ts


import type { ComputedSpec } from "./format";
import type { BillTemplate, TableObject, TableRepeat, TemplateObject } from "../template/types";
import { extractTemplateFields } from "../template/dataBinding";
import { extractVariables } from "../template/placeholders";

type BandedTable = TableObject & { repeat: TableRepeat };

function isBandedTable(o: TemplateObject): o is BandedTable {

  return (
    o.type === "table" &&
    typeof (o as TableObject).repeat === "object" &&
    (o as TableObject).repeat !== null
  );
}

function bandColumns(t: BandedTable): string[] {
  const width = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = t.repeat.startRow; r <= t.repeat.endRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const text = cells[r * width + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

const MONEY_COLUMN_NAMES = [
  "amount",
  "line_total",
  "linetotal",
  "total",
  "price",
  "rate",
  "value",
  "cost",
  "sum",
];

function moneyColumnOf(table: BandedTable): string | null {
  const columns = bandColumns(table);
  if (columns.length === 0) return null;
  for (const candidate of MONEY_COLUMN_NAMES) {
    const found = columns.find((column) => column.toLowerCase() === candidate);
    if (found) return found;
  }
  for (const candidate of MONEY_COLUMN_NAMES) {
    const found = columns.find((column) => column.toLowerCase().includes(candidate));
    if (found) return found;
  }
  return columns[columns.length - 1]!;
}

export function computedSpecsFor(template: BillTemplate): ComputedSpec[] {
  const bands = template.objects.filter(isBandedTable);
  const declared = Array.isArray(template.meta?.computed) ? template.meta.computed : [];
  const declaredKeys = new Set(declared.map((spec) => spec.key));

  const taxOrDiscountKeys = new Set([
    "tax", "tax_amount", "tax_rate", "discount", "discount_amount", "discount_rate",
  ]);
  const hasTaxOrDiscount = extractTemplateFields(template).some((field) => taxOrDiscountKeys.has(field.key));

  const specs: ComputedSpec[] = [];
  if (bands.length > 0 && !declaredKeys.has("subtotal")) {

    const args = bands
      .map((table) => {
        const column = moneyColumnOf(table);
        return column ? `${table.repeat.key}.${column}` : null;
      })
      .filter((arg): arg is string => arg !== null);
    if (args.length > 0) {
      specs.push({ key: "subtotal", op: "sum", args });
    }
  }

  if (bands.length > 0 && !hasTaxOrDiscount && !declaredKeys.has("total")) {
    specs.push({ key: "total", op: "add", args: ["subtotal"] });
  }
  return [...specs, ...declared];
}

```

## lib/package/form.ts

```ts


import type { ComputedSpec, ManifestField, PackageManifest } from "./format";
import { extractVariables } from "../template/placeholders";
import type { BillTemplate, TableObject } from "../template/types";
import { DEFAULT_REPEAT_MAX_ITEMS } from "../template/types";

export interface FormField {
  key: string;
  label: string;
  type: ManifestField["type"];
  source: ManifestField["source"];
  objectName: string;
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface RepeatFieldSpec {
  key: string;
  objectName: string;

  columns: string[];
  maxItems: number;
}

export interface FormGroup {
  title: string;
  fields: FormField[];
}

export interface FormSchema {
  groups: FormGroup[];
  fields: FormField[];
  repeats: RepeatFieldSpec[];
  computed: ComputedSpec[];
}

const GROUP_TITLES: Record<ManifestField["source"], string> = {
  text: "Text fields",
  field: "Text fields",
  table: "Table cells",
  "image-placeholder": "Images & signatures",
};

function columnsOf(t: TableObject, startRow: number, endRow: number): string[] {
  const columns = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const text = cells[r * columns + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

function repeatsOf(template: BillTemplate | undefined): RepeatFieldSpec[] {
  const out: RepeatFieldSpec[] = [];
  const objects = template && Array.isArray(template.objects) ? template.objects : [];
  for (const o of objects) {
    if (o.type !== "table") continue;
    const band = o.repeat;
    if (!band || typeof band.key !== "string" || band.key.trim().length === 0) continue;
    out.push({
      key: band.key.trim(),
      objectName: o.name,
      columns: columnsOf(o, band.startRow, band.endRow),
      maxItems: typeof band.maxItems === "number" && band.maxItems > 0 ? band.maxItems : DEFAULT_REPEAT_MAX_ITEMS,
    });
  }
  return out;
}

export function deriveForm(manifest: PackageManifest, template?: BillTemplate): FormSchema {
  const declared: FormField[] = Array.isArray(manifest?.fields)
    ? manifest.fields
        .filter((f): f is ManifestField => Boolean(f) && typeof f.key === "string" && f.key.length > 0)
        .map((f) => ({
          key: f.key,
          label: typeof f.label === "string" && f.label.length > 0 ? f.label : f.key,
          type: f.type,
          source: f.source,
          objectName: typeof f.objectName === "string" ? f.objectName : "",
          ...(typeof f.maxLength === "number" ? { maxLength: f.maxLength } : {}),
          ...(f.required === true ? { required: true } : {}),
          ...(typeof f.defaultValue === "string" ? { defaultValue: f.defaultValue } : {}),
          ...(typeof f.pattern === "string" ? { pattern: f.pattern } : {}),
          ...(typeof f.min === "number" ? { min: f.min } : {}),
          ...(typeof f.max === "number" ? { max: f.max } : {}),
          ...(Array.isArray(f.options) ? { options: f.options } : {}),
        }))
    : [];

  const repeats = repeatsOf(template);

  const fields: FormField[] = [
    ...declared.filter((f) => !repeats.some((r) => r.key === f.key)),
    ...repeats.map((r) => ({
      key: r.key,
      label: r.objectName || r.key,
      type: "repeating" as const,
      source: "table" as const,
      objectName: r.objectName,
    })),
  ];

  const order: string[] = ["Text fields", "Table cells", "Images & signatures"];
  const byTitle = new Map<string, FormField[]>();
  for (const f of fields) {
    const title = GROUP_TITLES[f.source] ?? "Other fields";
    const bucket = byTitle.get(title);
    if (bucket) bucket.push(f);
    else byTitle.set(title, [f]);
  }

  const groups: FormGroup[] = [];
  for (const title of order) {
    const bucket = byTitle.get(title);
    if (bucket && bucket.length > 0) groups.push({ title, fields: bucket });
  }

  for (const [title, bucket] of byTitle) {
    if (!order.includes(title) && bucket.length > 0) groups.push({ title, fields: bucket });
  }

  return {
    groups,
    fields,
    repeats,
    computed: Array.isArray(manifest?.computed) ? manifest.computed : [],
  };
}

```

## lib/package/format.ts

```ts


export const PACKAGE_VERSION = 1 as const;

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;

  path: string;
  message: string;
}

export interface ManifestDocument {
  width: number;
  height: number;
  unit: "px";
  dpi: number;
  paper: string;

  currencyScale: number;
}

export interface ManifestAsset {
  id: string;
  role: "bill-part" | "image-placeholder";

  file: string;

  mime?: string;
  width: number;
  height: number;
}

export interface ManifestFont {
  family: string;
  file: string;
  sha256: string;
}

export type ManifestFieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image"
  | "repeating";

export interface ManifestField {
  key: string;
  label: string;
  type: ManifestFieldType;
  source: "text" | "table" | "image-placeholder" | "field";
  objectName: string;
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];

  columns?: string[];
  maxItems?: number;
}

export type ComputedOp =
  | "sum"
  | "sum-times"
  | "add"
  | "subtract"
  | "multiply"
  | "percent";

export interface ComputedSpec {
  key: string;
  op: ComputedOp;

  args: string[];

  rateKey?: string;
}

export interface PackageManifest {
  packageVersion: typeof PACKAGE_VERSION;
  templateVersion: number;
  name: string;
  document: ManifestDocument;

  template: string;
  assets: ManifestAsset[];
  fonts: ManifestFont[];
  fields: ManifestField[];
  computed: ComputedSpec[];

  checksums: Record<string, string>;
}

export interface PackageFile {
  name: string;
  bytes: Uint8Array;
}

export interface Package {
  manifest: PackageManifest;

  files: Map<string, Uint8Array>;

  manifestBytes?: Uint8Array;

  manifestSha256?: string;
}

```

## lib/package/index.ts

```ts
export { PACKAGE_VERSION } from "./format";
export type {
  ComputedOp,
  ComputedSpec,
  Issue,
  ManifestAsset,
  ManifestDocument,
  ManifestField,
  ManifestFieldType,
  ManifestFont,
  Package,
  PackageFile,
  PackageManifest,
  Severity,
} from "./format";
export { buildPackage, writePackage, type BuildOptions } from "./build";
export { parsePackage } from "./parse";
export { validateManifest, validatePackage } from "./validate";
export { validateLayout } from "./layout";
export { resolvePackage } from "./resolve";
export { deriveForm, type FormField, type FormGroup, type FormSchema, type RepeatFieldSpec } from "./form";
export { computedSpecsFor } from "./computedSpecs";

```

## lib/package/layout.ts

```ts
import { type Issue, type Severity } from "./format";
import type { BillTemplate } from "@/lib/template/types";

const EDGES = new Set(["left", "right", "top", "bottom"]);
const BEHAVIOURS = new Set(["move", "stretch"]);
const MODES = new Set(["fixed", "bounded", "unbounded"]);
const STRATEGIES = new Set(["wrap", "noWrap"]);
const GROWTH = new Set(["fixed", "expand"]);
const CONTAINER_GROWTH = new Set(["fixed", "content"]);
const ANCHORS = new Set(["start", "end", "stretch"]);
const COLLISIONS = new Set(["report", "allow"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function validateLayout(
  template: Pick<BillTemplate, "layout" | "objects">,
): Issue[] {
  const out: Issue[] = [];
  const objects = Array.isArray(template?.objects) ? template.objects : [];
  const layout = template?.layout;

  if (layout === undefined) return out;

  const add = (severity: Severity, path: string, message: string) =>
    out.push({ severity, path, message });

  if (!isRecord(layout)) {
    add("error", "layout", "layout is not an object");
    return out;
  }
  if (layout.mode !== "fixed" && layout.mode !== "variable") {
    add("error", "layout.mode", `mode must be "fixed" or "variable", got ${String(layout.mode)}`);
  }
  if (layout.collision !== undefined && !COLLISIONS.has(String(layout.collision))) {
    add(
      "error",
      "layout.collision",
      `collision must be "report" or "allow", got ${String(layout.collision)}`,
    );
  }

  const guideIds = new Set<string>();
  const guideOrientation = new Map<string, "horizontal" | "vertical">();
  if (layout.guides !== undefined) {
    if (!Array.isArray(layout.guides)) {
      add("error", "layout.guides", "guides must be an array");
    } else {
      layout.guides.forEach((g, i) => {
        const path = `layout.guides[${i}]`;
        if (!isRecord(g)) {
          add("error", path, "guide is not an object");
          return;
        }
        const id = g.id;
        if (typeof id !== "string" || id.length === 0) {
          add("error", `${path}.id`, "guide has no id");
        } else if (guideIds.has(id)) {

          add("error", `${path}.id`, `duplicate guide id "${id}"`);
        } else {
          guideIds.add(id);
        }

        if (g.orientation !== "horizontal" && g.orientation !== "vertical") {
          add(
            "error",
            `${path}.orientation`,
            `orientation must be "horizontal" or "vertical", got ${String(g.orientation)}`,
          );
        } else if (typeof id === "string") {
          guideOrientation.set(id, g.orientation);
        }

        if (!isFiniteNumber(g.position)) {
          add("error", `${path}.position`, "position must be a finite number");
        }
        if (g.maxDisplacement !== undefined) {
          if (!isFiniteNumber(g.maxDisplacement) || g.maxDisplacement < 0) {
            add(
              "error",
              `${path}.maxDisplacement`,
              "maxDisplacement must be a finite number of zero or more",
            );
          }
        }
      });
    }
  }

  const objectIds = new Set(objects.map((o) => o.id));
  const attachmentIds = new Set<string>();
  if (layout.attachments !== undefined) {
    if (!Array.isArray(layout.attachments)) {
      add("error", "layout.attachments", "attachments must be an array");
    } else {
      layout.attachments.forEach((a, i) => {
        const path = `layout.attachments[${i}]`;
        if (!isRecord(a)) {
          add("error", path, "attachment is not an object");
          return;
        }
        if (typeof a.id !== "string" || a.id.length === 0) {
          add("error", `${path}.id`, "attachment has no id");
        } else if (attachmentIds.has(a.id)) {
          add("error", `${path}.id`, `duplicate attachment id "${a.id}"`);
        } else {
          attachmentIds.add(a.id);
        }

        if (!EDGES.has(String(a.edge))) {
          add("error", `${path}.edge`, `edge must be one of ${[...EDGES].join(", ")}`);
        }
        if (!BEHAVIOURS.has(String(a.behavior))) {
          add(
            "error",
            `${path}.behavior`,
            `behavior must be "move" or "stretch", got ${String(a.behavior)}`,
          );
        }
        if (typeof a.guideId !== "string" || !guideIds.has(a.guideId)) {
          add(
            "error",
            `${path}.guideId`,
            `no guide with id "${String(a.guideId)}" is declared`,
          );
        } else if (EDGES.has(String(a.edge))) {

          const want = a.edge === "left" || a.edge === "right" ? "vertical" : "horizontal";
          const got = guideOrientation.get(a.guideId);
          if (got !== want) {
            add(
              "error",
              `${path}.edge`,
              `a ${got} guide cannot control the ${String(a.edge)} edge`,
            );
          }
        }
        if (typeof a.objectId !== "string") {
          add("error", `${path}.objectId`, "attachment names no object");
        } else if (!objectIds.has(a.objectId)) {
          add(
            "error",
            `${path}.objectId`,
            `no object with id "${a.objectId}" is in this template`,
          );
        }
      });
    }
  }

  if (layout.document !== undefined) {
    if (!isRecord(layout.document)) {
      add("error", "layout.document", "document policy is not an object");
    } else {
      for (const axis of ["growthX", "growthY"] as const) {
        if (!GROWTH.has(String(layout.document[axis]))) {
          add(
            "error",
            `layout.document.${axis}`,
            `${axis} must be "fixed" or "expand", got ${String(layout.document[axis])}`,
          );
        }
      }
      for (const side of ["maxWidth", "maxHeight"] as const) {
        const v = layout.document[side];
        if (v !== undefined && (!isFiniteNumber(v) || v <= 0)) {
          add(
            "error",
            `layout.document.${side}`,
            `${side} must be a positive finite number`,
          );
        }
      }
    }
  }

  objects.forEach((o, i) => {
    const parent = (o as { layoutParentId?: unknown }).layoutParentId;
    if (parent === undefined || parent === null) return;
    const path = `objects[${i}].layoutParentId`;
    if (typeof parent !== "string" || parent.length === 0) {
      add("error", path, "layoutParentId must be a non-empty id or null");
      return;
    }
    if (parent === (o as { id?: unknown }).id) {
      add("error", path, "an object cannot be its own layout parent");
      return;
    }
    if (!objectIds.has(parent)) {
      add("error", path, `no object with id "${parent}" is in this template`);
    }
  });

  const parentOf = new Map<string, string>();
  objects.forEach((o) => {
    const parent = (o as { layoutParentId?: unknown }).layoutParentId;
    if (typeof parent === "string" && parent.length > 0) parentOf.set(o.id, parent);
  });
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    let current = parentOf.get(start);
    while (current !== undefined) {
      if (seen.has(current)) {
        add("error", "layout", `layout parents contain a cycle involving "${current}"`);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }

  objects.forEach((o, i) => {
    const container = (o as { container?: unknown }).container;
    if (container === undefined) return;
    const path = `objects[${i}].container`;
    if (!isRecord(container)) {
      add("error", path, "container is not an object");
      return;
    }
    if (typeof container.enabled !== "boolean") {
      add("error", `${path}.enabled`, "enabled must be a boolean");
    }
    for (const axis of ["growthX", "growthY"] as const) {
      if (container[axis] !== undefined && !CONTAINER_GROWTH.has(String(container[axis]))) {
        add(
          "error",
          `${path}.${axis}`,
          `${axis} must be "fixed" or "content", got ${String(container[axis])}`,
        );
      }
    }
    if (container.padding !== undefined) {
      const padPath = `${path}.padding`;
      if (!isRecord(container.padding)) {
        add("error", padPath, "padding is not an object");
      } else {
        for (const side of ["top", "right", "bottom", "left"] as const) {
          const v = container.padding[side];
          if (!isFiniteNumber(v) || v < 0) {
            add("error", `${padPath}.${side}`, `${side} must be a finite number of zero or more`);
          }
        }
      }
    }
    for (const side of ["minWidth", "minHeight", "maxWidth", "maxHeight"] as const) {
      const v = container[side];
      if (v !== undefined && (!isFiniteNumber(v) || v < 0)) {
        add("error", `${path}.${side}`, `${side} must be a finite number of zero or more`);
      }
    }
    if (
      isFiniteNumber(container.minWidth) &&
      isFiniteNumber(container.maxWidth) &&
      container.minWidth > container.maxWidth
    ) {
      add("error", `${path}.maxWidth`, "maxWidth is smaller than minWidth");
    }
    if (
      isFiniteNumber(container.minHeight) &&
      isFiniteNumber(container.maxHeight) &&
      container.minHeight > container.maxHeight
    ) {
      add("error", `${path}.maxHeight`, "maxHeight is smaller than minHeight");
    }
    if (o.type !== "rect" && o.type !== "rounded-rect" && o.type !== "ellipse") {
      add("warning", path, `type "${o.type}" cannot be a layout container; only shapes can`);
    }
  });

  objects.forEach((o, i) => {
    const anchor = (o as { anchor?: unknown }).anchor;
    if (anchor === undefined) return;
    const path = `objects[${i}].anchor`;
    if (!isRecord(anchor)) {
      add("error", path, "anchor is not an object");
      return;
    }
    for (const axis of ["horizontal", "vertical"] as const) {
      if (anchor[axis] !== undefined && !ANCHORS.has(String(anchor[axis]))) {
        add(
          "error",
          `${path}.${axis}`,
          `${axis} must be "start", "end" or "stretch", got ${String(anchor[axis])}`,
        );
      }
    }
    for (const side of ["leftOffset", "rightOffset", "topOffset", "bottomOffset"] as const) {
      if (anchor[side] !== undefined && !isFiniteNumber(anchor[side])) {
        add("error", `${path}.${side}`, `${side} must be a finite number`);
      }
    }
    if ((o as { layoutParentId?: unknown }).layoutParentId == null) {
      add("warning", path, "anchor has no effect without a layoutParentId");
    }
  });

  objects.forEach((o, i) => {
    const growth = (o as { expansion?: unknown }).expansion;
    if (growth === undefined) return;
    const path = `objects[${i}].expansion`;
    if (!isRecord(growth)) {
      add("error", path, "expansion is not an object");
      return;
    }
    for (const axis of ["x", "y"] as const) {
      const a = growth[axis];
      const axisPath = `${path}.${axis}`;
      if (!isRecord(a)) {
        add("error", axisPath, `${axis} expansion is not an object`);
        continue;
      }
      if (!MODES.has(String(a.mode))) {
        add(
          "error",
          `${axisPath}.mode`,
          `mode must be "fixed", "bounded" or "unbounded", got ${String(a.mode)}`,
        );
      }
      if (a.maxGrowth !== undefined) {
        if (!isFiniteNumber(a.maxGrowth) || a.maxGrowth < 0) {
          add(
            "error",
            `${axisPath}.maxGrowth`,
            "maxGrowth must be a finite number of zero or more",
          );
        } else if (a.mode === "bounded" && !a.maxGrowth) {

          add(
            "warning",
            `${axisPath}.maxGrowth`,
            'mode "bounded" with maxGrowth 0 can never grow; use "fixed"',
          );
        }
      }
      if (a.strategy !== undefined && !STRATEGIES.has(String(a.strategy))) {
        add(
          "error",
          `${axisPath}.strategy`,
          `strategy must be "wrap" or "noWrap", got ${String(a.strategy)}`,
        );
      }
      if (a.growthGuideId !== undefined) {
        if (typeof a.growthGuideId !== "string" || !guideIds.has(a.growthGuideId)) {
          add(
            "error",
            `${axisPath}.growthGuideId`,
            `no guide with id "${String(a.growthGuideId)}" is declared`,
          );
        } else {

          const want = axis === "y" ? "horizontal" : "vertical";
          const got = guideOrientation.get(String(a.growthGuideId));
          if (got !== want) {
            add(
              "error",
              `${axisPath}.growthGuideId`,
              `${axis} growth needs a ${want} guide, but "${a.growthGuideId}" is ${got}`,
            );
          }
        }
      }
    }
  });

  return out;
}
```

## lib/package/parse.ts

```ts
import type { Package, PackageManifest } from "./format";

import { strFromU8, unzipSync } from "fflate";

export function parsePackage(bytes: Uint8Array): Package {
  const raw = unzipSync(bytes);
  const manifestBytes = raw["manifest.json"];
  if (!manifestBytes) throw new Error("package has no manifest.json");

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as PackageManifest;
  } catch {
    throw new Error("package manifest.json is not valid JSON");
  }

  const digestBytes = raw["manifest.json.sha256"];
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name === "manifest.json" || name === "manifest.json.sha256") continue;
    files.set(name, data);
  }

  return {
    manifest,
    files,

    manifestBytes,
    manifestSha256: digestBytes ? strFromU8(digestBytes) : undefined,
  };
}

```

## lib/package/resolve.ts

```ts
import type { Package } from "./format";
import type { BillTemplate, TemplateObject } from "../template/types";
import { TEMPLATE_VERSION } from "../template/types";

import { strFromU8 } from "fflate";

const SCHEME = "pkg://";

const FALLBACK_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function extensionOf(path: string): string {
  const at = path.lastIndexOf(".");
  return at < 0 ? "" : path.slice(at).toLowerCase();
}

function isTrustedMime(mime: unknown): mime is string {
  return typeof mime === "string" && /^image\/[a-z0-9.+-]+$/.test(mime);
}

function mimeFor(pkg: Package, path: string): string | undefined {
  const assets = pkg?.manifest?.assets;
  const declared = Array.isArray(assets)
    ? assets.find((a) => a?.file === path)?.mime
    : undefined;
  if (isTrustedMime(declared)) return declared;
  return FALLBACK_MIME[extensionOf(path)];
}

function toDataUri(bytes: Uint8Array, mime: string, path: string): string {
  if (typeof btoa !== "function") {
    throw new Error(
      `cannot encode the asset ${path}: this runtime has no base64 encoder, so the ` +
        `image cannot be inlined and the bill would print with a part missing`,
    );
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function resolvePackage(pkg: Package): { template: BillTemplate; unresolved: string[] } {
  const unresolved: string[] = [];
  const note = (path: string): void => {
    if (!unresolved.includes(path)) unresolved.push(path);
  };

  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();

  const empty: BillTemplate = {
    templateVersion: TEMPLATE_VERSION,
    document: { width: 0, height: 0 },
    meta: { name: "", modifiedAt: "" },
    objects: [],
  };

  let template = empty;
  const raw = files.get(pkg?.manifest?.template ?? "template.json");
  if (raw) {
    try {
      template = JSON.parse(strFromU8(raw)) as BillTemplate;
    } catch {
      template = empty;
    }
  }

  const objects: TemplateObject[] = (Array.isArray(template.objects) ? template.objects : []).map(
    (o) => {
      const src = (o as { src?: unknown }).src;
      if (typeof src !== "string" || !src.startsWith(SCHEME)) return { ...o };

      const path = src.slice(SCHEME.length);
      const bytes = files.get(path);
      if (!bytes) {
        note(path);
        return { ...o };
      }

      const mime = mimeFor(pkg, path);
      if (mime === undefined) {
        note(path);
        return { ...o };
      }

      return { ...o, src: toDataUri(bytes, mime, path) } as TemplateObject;
    },
  );

  return { template: { ...template, objects }, unresolved };
}

```

## lib/package/validate.ts

```ts


import type {
  ComputedSpec,
  Issue,
  ManifestField,
  Package,
} from "./format";
import { PACKAGE_VERSION } from "./format";
import { validateLayout } from "./layout";
import { sha256HexBytes } from "../render/sha256";
import { DEFAULT_REPEAT_MAX_ITEMS, TEMPLATE_VERSION } from "../template/types";

import { strToU8 } from "fflate";

const FIELD_TYPES = new Set([
  "text",
  "number",
  "date",
  "currency",
  "tickmark",
  "checkbox",
  "image",
  "repeating",
]);

const FIELD_SOURCES = new Set(["text", "table", "image-placeholder", "field"]);

const ASSET_ROLES = new Set(["bill-part", "image-placeholder"]);

const COMPUTED_OPS = new Set(["sum", "sum-times", "add", "subtract", "multiply", "percent"]);

const COLUMN_OPS = new Set(["sum", "sum-times"]);

type RepeatColumns = Map<ManifestField["key"], NonNullable<ManifestField["columns"]>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(path: string, message: string): Issue {
  return { severity: "error", path, message };
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return typeof v;
  }
}

function section(value: unknown, key: string, out: Issue[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    out.push(issue(key, `${key} must be an array, but it is ${typeName(value)}`));
    return [];
  }
  return value;
}

function splitPath(arg: string): { head: string; tail: string } | undefined {
  const at = arg.indexOf(".");
  if (at < 0) return undefined;
  return { head: arg.slice(0, at), tail: arg.slice(at + 1) };
}

function unresolved(
  name: string,
  fieldKeys: ReadonlySet<ManifestField["key"]>,
  computedKeys: ReadonlySet<ComputedSpec["key"]>,
  repeats: Readonly<RepeatColumns>,
): string | undefined {
  if (fieldKeys.has(name) || computedKeys.has(name)) return undefined;

  const path = splitPath(name);
  if (path) {
    const columns = repeats.get(path.head);
    if (columns === undefined) {
      return fieldKeys.has(path.head)
        ? `"${path.head}" is a declared field but not a repeating one, so it has no columns`
        : `it names no repeating field "${path.head}"`;
    }
    if (!columns.includes(path.tail)) {
      const have = columns.length > 0 ? columns.join(", ") : "none";
      return `repeat field "${path.head}" declares no column "${path.tail}" (columns: ${have})`;
    }
    return undefined;
  }

  return "it is neither a declared field key nor the key of another computed entry";
}

function columnHead(
  name: string,
  fieldKeys: ReadonlySet<ManifestField["key"]>,
  computedKeys: ReadonlySet<ComputedSpec["key"]>,
  repeats: Readonly<RepeatColumns>,
): string | undefined {
  if (fieldKeys.has(name) || computedKeys.has(name)) return undefined;
  const path = splitPath(name);
  if (!path) return undefined;
  return repeats.get(path.head)?.includes(path.tail) === true ? path.head : undefined;
}

function resolvesAsColumn(
  name: string,
  fieldKeys: ReadonlySet<ManifestField["key"]>,
  computedKeys: ReadonlySet<ComputedSpec["key"]>,
  repeats: Readonly<RepeatColumns>,
): boolean {
  return columnHead(name, fieldKeys, computedKeys, repeats) !== undefined;
}

function columnArgMessage(op: string, name: string, label: string): string {
  return (
    `${label} ${name}: op "${op}" has no meaning for a repeat column; ` +
    `only "sum" and "sum-times" read one. ` +
    `Sum the column into a key of its own and combine that instead`
  );
}

function pairableOperands(
  spec: Record<string, unknown>,
  fieldKeys: ReadonlySet<ManifestField["key"]>,
  computedKeys: ReadonlySet<ComputedSpec["key"]>,
  repeats: Readonly<RepeatColumns>,
): { at: number; bad: string; good: string; badHead: string; goodHead: string } | undefined {
  const args = Array.isArray(spec.args) ? spec.args : [];
  const operands: { at: number; name: string }[] = [];

  for (let j = 0; j < args.length && operands.length < 2; j += 1) {
    const a = args[j];
    if (typeof a === "string" && a.length > 0) operands.push({ at: j, name: a });
  }
  if (operands.length < 2) return undefined;
  const first = operands[0]!;
  const second = operands[1]!;
  const firstHead = columnHead(first.name, fieldKeys, computedKeys, repeats);
  const secondHead = columnHead(second.name, fieldKeys, computedKeys, repeats);
  if (firstHead === undefined || secondHead === undefined || firstHead === secondHead) {
    return undefined;
  }
  return { at: second.at, bad: second.name, good: first.name, badHead: secondHead, goodHead: firstHead };
}

type ComputedNode = {
  key: string;
  index: number;
  spec: Record<string, unknown>;
  deps: ComputedNode[];

  at: number;
};

const UNSEEN = 0;
const ON_STACK = 1;
const DONE = 2;

function reportComputedCycles(
  computed: unknown[],
  computedKeys: ReadonlySet<string>,
  out: Issue[],
): void {
  const nodes = new Map<string, ComputedNode>();
  computed.forEach((c, i) => {
    if (!isRecord(c)) return;
    const key = c.key;

    if (typeof key !== "string" || !computedKeys.has(key) || nodes.has(key)) return;
    nodes.set(key, { key, index: i, spec: c, deps: [], at: 0 });
  });

  for (const node of nodes.values()) {
    const args = Array.isArray(node.spec.args) ? node.spec.args : [];
    for (const name of [...args, node.spec.rateKey]) {
      if (typeof name !== "string" || name === node.key) continue;
      const target = nodes.get(name);
      if (target && !node.deps.includes(target)) node.deps.push(target);
    }
  }

  const state = new Map<string, number>();
  const stack: ComputedNode[] = [];

  for (const root of nodes.values()) {
    if ((state.get(root.key) ?? UNSEEN) !== UNSEEN) continue;
    state.set(root.key, ON_STACK);
    stack.push(root);
    while (stack.length > 0) {
      const node = stack[stack.length - 1];
      if (node.at >= node.deps.length) {
        state.set(node.key, DONE);
        stack.pop();
        continue;
      }
      const next = node.deps[node.at];
      node.at += 1;
      const seen = state.get(next.key) ?? UNSEEN;
      if (seen === DONE) continue;
      if (seen === ON_STACK) {

        const from = stack.indexOf(next);
        if (from < 0) continue;
        const cycle = stack.slice(from);
        const anchor = cycle.reduce((earliest, n) =>
          n.index < earliest.index ? n : earliest,
        );
        const chain = [...cycle.map((n) => n.key), cycle[0].key].join(" -> ");
        out.push(
          issue(
            `computed[${anchor.index}]`,
            `these computed entries form a cycle, so no order can evaluate them: ${chain}`,
          ),
        );

        for (const n of cycle) state.set(n.key, DONE);
        stack.length = from;
        continue;
      }
      state.set(next.key, ON_STACK);
      stack.push(next);
    }
  }
}

function manifestAsWritten(manifest: Record<string, unknown>, out: Issue[]): Uint8Array | undefined {
  try {
    return strToU8(JSON.stringify(manifest, null, 2));
  } catch {
    out.push(
      issue(
        "manifest",
        "manifest cannot be serialised, so it cannot be checked against the checksum stored beside it",
      ),
    );
    return undefined;
  }
}

export function validateManifest(
  manifest: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  manifestBytes?: Uint8Array,
  manifestSha256?: string,
): Issue[] {
  const out: Issue[] = [];
  if (!isRecord(manifest)) return [issue("", "manifest is not an object")];

  if (manifestSha256 !== undefined) {
    if (manifestBytes && sha256HexBytes(manifestBytes) !== manifestSha256) {
      out.push(issue("manifest", "manifest does not match the checksum stored beside it"));
    } else {
      const written = manifestAsWritten(manifest, out);
      if (written && sha256HexBytes(written) !== manifestSha256) {
        out.push(issue("manifest", "manifest was edited after it was read"));
      }
    }
  }

  if (manifest.packageVersion !== PACKAGE_VERSION) {
    out.push(
      issue(
        "packageVersion",
        `package version ${String(manifest.packageVersion)} is not supported; this build reads ${PACKAGE_VERSION}`,
      ),
    );
  }
  const tplVersion = manifest.templateVersion;
  if (typeof tplVersion !== "number" || !Number.isFinite(tplVersion)) {
    out.push(issue("templateVersion", "template version is not a number"));
  } else if (tplVersion > TEMPLATE_VERSION) {
    out.push(
      issue(
        "templateVersion",
        `template version ${tplVersion} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
      ),
    );
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    out.push(issue("name", "manifest has no name"));
  }

  const doc = manifest.document;
  if (!isRecord(doc)) {
    out.push(issue("document", "manifest has no document"));
  } else {
    for (const side of ["width", "height"] as const) {
      const v = doc[side];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        out.push(issue(`document.${side}`, `page ${side} must be a positive number`));
      }
    }
    const scale = doc.currencyScale;
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > 6) {
      out.push(issue("document.currencyScale", "currencyScale must be an integer from 0 to 6"));
    }
  }

  const templatePath = manifest.template;
  if (typeof templatePath !== "string" || templatePath.length === 0) {
    out.push(issue("template", "manifest names no template file"));
  } else if (!files.has(templatePath)) {
    out.push(issue("template", `template file ${templatePath} is not in the archive`));
  } else {

    const templateBytes = files.get(templatePath)!;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(templateBytes));
      for (const layoutIssue of validateLayout(parsed as never)) {
        out.push({
          severity: layoutIssue.severity,
          path: `${templatePath}.${layoutIssue.path}`,
          message: layoutIssue.message,
        });
      }
    } catch {

    }
  }

  const assets = section(manifest.assets, "assets", out);
  assets.forEach((a, i) => {
    if (!isRecord(a)) {
      out.push(issue(`assets[${i}]`, "asset entry is not an object"));
      return;
    }
    if (typeof a.role !== "string" || !ASSET_ROLES.has(a.role)) {
      out.push(issue(`assets[${i}].role`, `unknown asset role ${String(a.role)}`));
    }
    if (typeof a.file !== "string" || a.file.length === 0) {
      out.push(issue(`assets[${i}].file`, "asset has no file"));
    } else if (!files.has(a.file)) {
      out.push(issue(`assets[${i}].file`, `asset file ${a.file} is not in the archive`));
    }
  });

  const fonts = section(manifest.fonts, "fonts", out);
  fonts.forEach((f, i) => {
    if (!isRecord(f)) {
      out.push(issue(`fonts[${i}]`, "font entry is not an object"));
      return;
    }
    if (typeof f.file !== "string" || !files.has(f.file)) {
      out.push(issue(`fonts[${i}].file`, `font file ${String(f.file)} is not in the archive`));
    }
  });

  const fields = section(manifest.fields, "fields", out);
  const fieldKeys = new Set<ManifestField["key"]>();
  const repeats: RepeatColumns = new Map();
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!isRecord(f)) {
      out.push(issue(`fields[${i}]`, "field entry is not an object"));
      return;
    }
    const key = f.key;

    const usable = typeof key === "string" && key.trim().length > 0;
    const fresh = usable && !seen.has(key);
    if (!usable) {
      out.push(issue(`fields[${i}].key`, "field has no key"));
    } else if (!fresh) {
      out.push(issue(`fields[${i}].key`, `duplicate field key ${key}`));
    } else {
      seen.add(key);
      fieldKeys.add(key);
    }
    if (typeof f.type !== "string" || !FIELD_TYPES.has(f.type)) {
      out.push(issue(`fields[${i}].type`, `unknown field type ${String(f.type)}`));
    }
    if (typeof f.source !== "string" || !FIELD_SOURCES.has(f.source)) {
      out.push(issue(`fields[${i}].source`, `unknown field source ${String(f.source)}`));
    }
    if (f.type === "repeating" && (!Array.isArray(f.columns) || f.columns.length === 0)) {
      out.push(issue(`fields[${i}].columns`, "a repeating field must declare its columns"));
    }
    if (f.type === "repeating" && f.maxItems !== undefined &&
      (!Number.isInteger(f.maxItems) || (f.maxItems as number) < 1 || (f.maxItems as number) > DEFAULT_REPEAT_MAX_ITEMS)) {
      out.push(issue(`fields[${i}].maxItems`, `maximum row count must be between 1 and ${DEFAULT_REPEAT_MAX_ITEMS}`));
    }
    if (f.pattern !== undefined && typeof f.pattern !== "string") {
      out.push(issue(`fields[${i}].pattern`, "pattern must be a string"));
    }
    if (f.defaultValue !== undefined && typeof f.defaultValue !== "string") {
      out.push(issue(`fields[${i}].defaultValue`, "default value must be a string"));
    }
    if (f.required !== undefined && typeof f.required !== "boolean") {
      out.push(issue(`fields[${i}].required`, "required must be a boolean"));
    }
    if (f.min !== undefined && (typeof f.min !== "number" || !Number.isFinite(f.min))) {
      out.push(issue(`fields[${i}].min`, "minimum must be a finite number"));
    }
    if (f.max !== undefined && (typeof f.max !== "number" || !Number.isFinite(f.max))) {
      out.push(issue(`fields[${i}].max`, "maximum must be a finite number"));
    }
    if (typeof f.min === "number" && typeof f.max === "number" && f.min > f.max) {
      out.push(issue(`fields[${i}]`, "minimum cannot exceed maximum"));
    }

    if (f.type === "repeating" && typeof key === "string" && fresh) {
      const columns = Array.isArray(f.columns) ? f.columns : [];
      repeats.set(
        key,
        columns.filter((c): c is string => typeof c === "string"),
      );
    }
  });

  const computed = section(manifest.computed, "computed", out);
  const computedKeys = new Set<ComputedSpec["key"]>();
  const seenComputed = new Set<string>();
  computed.forEach((c, i) => {
    if (!isRecord(c)) {
      out.push(issue(`computed[${i}]`, "computed entry is not an object"));
      return;
    }

    if (typeof c.key !== "string" || c.key.trim().length === 0) {
      out.push(issue(`computed[${i}].key`, "a computed entry must declare a key"));
    } else if (seenComputed.has(c.key)) {
      out.push(issue(`computed[${i}].key`, `duplicate computed key ${c.key}`));
    } else {
      seenComputed.add(c.key);
      computedKeys.add(c.key);
    }
    if (typeof c.op !== "string" || !COMPUTED_OPS.has(c.op)) {
      out.push(issue(`computed[${i}].op`, `unknown computed op ${String(c.op)}`));
    }
    if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== "string")) {
      out.push(issue(`computed[${i}].args`, "computed args must all be strings"));
    }
    if (c.op === "percent" && (typeof c.rateKey !== "string" || c.rateKey.length === 0)) {
      out.push(issue(`computed[${i}].rateKey`, "a percent op must name the rate it applies"));
    }
  });

  computed.forEach((c, i) => {
    if (!isRecord(c)) return;
    const ownKey = typeof c.key === "string" && c.key.length > 0 ? c.key : undefined;
    const args = Array.isArray(c.args) ? c.args : [];
    args.forEach((a, j) => {
      if (typeof a !== "string" || a.length === 0) return;

      if (a === ownKey) {
        out.push(
          issue(
            `computed[${i}].args[${j}]`,
            `arg ${a}: a computed entry cannot read its own key; it names a value nothing produces`,
          ),
        );
        return;
      }
      const why = unresolved(a, fieldKeys, computedKeys, repeats);
      if (why) {
        out.push(issue(`computed[${i}].args[${j}]`, `arg ${why}`));
      } else if (
        typeof c.op === "string" &&
        !COLUMN_OPS.has(c.op) &&
        resolvesAsColumn(a, fieldKeys, computedKeys, repeats)
      ) {
        out.push(issue(`computed[${i}].args[${j}]`, columnArgMessage(c.op, a, "arg")));
      }
    });

    if (c.op === "sum-times") {
      const pair = pairableOperands(c, fieldKeys, computedKeys, repeats);
      if (pair) {
        out.push(
          issue(
            `computed[${i}].args[${pair.at}]`,
            `arg ${pair.bad}: op "sum-times" pairs its operands row by row, which only
 means anything inside one repeat field; "${pair.bad}" is a column of repeat
 "${pair.badHead}" and "${pair.good}" a column of repeat
 "${pair.goodHead}". Sum one column into a key of its own and multiply
 that instead`,
          ),
        );
      }
    }

    if (typeof c.rateKey !== "string" || c.rateKey.length === 0) return;
    if (c.rateKey === ownKey) {
      out.push(
        issue(
          `computed[${i}].rateKey`,
          `rateKey ${c.rateKey}: a computed entry cannot use its own key as its own rate`,
        ),
      );
      return;
    }
    const why = unresolved(c.rateKey, fieldKeys, computedKeys, repeats);
    if (why) {
      out.push(issue(`computed[${i}].rateKey`, `rateKey ${why}`));
    } else if (
      typeof c.op === "string" &&
      !COLUMN_OPS.has(c.op) &&
      resolvesAsColumn(c.rateKey, fieldKeys, computedKeys, repeats)
    ) {
      out.push(
        issue(`computed[${i}].rateKey`, columnArgMessage(c.op, c.rateKey, "rateKey")),
      );
    }
  });

  reportComputedCycles(computed, computedKeys, out);

  const checksums = manifest.checksums;
  if (checksums !== undefined) {
    if (!isRecord(checksums)) {
      out.push(issue("checksums", "checksums must be an object"));
    } else {
      for (const [path, expected] of Object.entries(checksums)) {
        const bytes = files.get(path);
        if (!bytes) {
          out.push(issue(`checksums.${path}`, "checksum given for a file not in the archive"));
          continue;
        }
        if (typeof expected !== "string" || sha256HexBytes(bytes) !== expected) {
          out.push(issue(`checksums.${path}`, `checksum does not match the archived ${path}`));
        }
      }
    }
  }

  return out;
}

export function validatePackage(pkg: Package): { ok: boolean; issues: Issue[] } {
  const files = pkg?.files instanceof Map ? pkg.files : new Map<string, Uint8Array>();

  const manifestBytes = pkg?.manifestBytes;
  const issues = validateManifest(
    pkg?.manifest,
    files,
    manifestBytes,
    pkg?.manifestSha256,
  );
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

```

## lib/render/canonical.ts

```ts


export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return "null";
}
```

## lib/render/computed.ts

```ts


import type { ComputedSpec } from "@/lib/package/format";

import type { Values } from "./values";

const RATE_SCALE = 6;

const safeScale = (scale: number): number =>
  Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

const NUMERIC = /^(-?)(\d*)(?:\.(\d*))?$/;

function trimToFigure(text: string): string {
  if (NUMERIC.test(text)) return text;
  for (let i = 0; i < text.length; i += 1) {
    if (!isDigit(text[i])) continue;
    const signed = i > 0 && text[i - 1] === "-";
    return text.slice(signed ? i - 1 : i);
  }
  return "";
}

export function parseMinorUnits(value: unknown, scale: number): number {
  const s = safeScale(scale);
  if (typeof value !== "string" && typeof value !== "number") return 0;

  const text = typeof value === "number" ? String(value) : value;
  const trimmed = trimToFigure(text.replace(/,/g, "").replace(/\s+/g, ""));
  const match = NUMERIC.exec(trimmed);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] && match[2].length > 0 ? match[2] : "0";
  const fracPart = match[3] ?? "";

  if (fracPart.length > s) {

    const kept = fracPart.slice(0, s).padEnd(s, "0");
    const next = Number(fracPart[s] ?? "0");
    const base = Number(s === 0 ? whole : `${whole}${kept}`) || 0;
    const rounded = next >= 5 ? base + 1 : base;

    return Number.isSafeInteger(rounded) ? sign * rounded : 0;
  }
  const digits = s === 0 ? whole : `${whole}${fracPart.padEnd(s, "0")}`;

  const n = Number(digits);
  return Number.isSafeInteger(n) ? sign * n : 0;
}

export function formatMinorUnits(minorUnits: number, scale: number): string {
  const s = safeScale(scale);
  const n = Math.abs(Math.round(minorUnits));
  const sign = minorUnits < 0 ? "-" : "";
  if (s === 0) return `${sign}${n}`;
  const divisor = 10 ** s;
  return `${sign}${Math.floor(n / divisor)}.${String(n % divisor).padStart(s, "0")}`;
}

export function itemsOf(values: Values, key: string): Record<string, unknown>[] {
  const raw = values[key];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && !Array.isArray(r),
    );
  } catch {
    return [];
  }
}

interface RowCache {
  rows: Record<string, Record<string, unknown>[]>;
}

const cache = new WeakMap<object, RowCache>();

function rowsFor(values: Values, repeatKey: string): Record<string, unknown>[] {
  let entry = cache.get(values as unknown as object);
  if (!entry) {
    entry = { rows: Object.create(null) };
    cache.set(values as unknown as object, entry);
  }
  if (!entry.rows[repeatKey]) entry.rows[repeatKey] = itemsOf(values, repeatKey);
  return entry.rows[repeatKey]!;
}

const has = (o: Record<string, number>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

function flat(arg: string, values: Values, numeric: Record<string, number>, s: number): number {
  if (has(numeric, arg)) return numeric[arg]!;
  return parseMinorUnits(values[arg], s);
}

const nameMatches = (name: string, values: Values, numeric: Record<string, number>): boolean =>
  has(numeric, name) || Object.prototype.hasOwnProperty.call(values, name);

function cell(
  arg: string,
  values: Values,
  numeric: Record<string, number>,
  s: number,
  row: Record<string, unknown> | undefined,
): number {
  if (row === undefined) return flat(arg, values, numeric, s);
  const dot = arg.indexOf(".");
  if (dot <= 0) return parseMinorUnits(row[arg], s);
  return parseMinorUnits(row[arg.slice(dot + 1)], s);
}

const split = (arg: string): [string, string] => {
  const dot = arg.indexOf(".");
  return dot > 0 ? [arg.slice(0, dot), arg.slice(dot + 1)] : ["", arg];
};

function scaledProduct(a: number, b: number, divisor: number): number {
  const raw = a * b;
  if (!Number.isSafeInteger(raw)) return 0;
  return Math.round(raw / divisor);
}

function rateOf(
  rateKey: string | undefined,
  values: Values,
  numeric: Record<string, number>,
  s: number,
): number {
  if (rateKey === undefined) return 0;
  if (has(numeric, rateKey)) return numeric[rateKey]! * 10 ** (RATE_SCALE - s);
  return parseMinorUnits(values[rateKey], RATE_SCALE);
}

export function computeAll(
  specs: readonly ComputedSpec[],
  values: Values,
  scale: number,
): Record<string, string> {
  const s = safeScale(scale);
  const numeric: Record<string, number> = Object.create(null);
  const out: Record<string, string> = Object.create(null);

  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string" || spec.key.length === 0) continue;
    const args = Array.isArray(spec.args) ? spec.args.filter((a) => typeof a === "string") : [];
    let result = 0;

    switch (spec.op) {
      case "sum": {
        for (const arg of args) {

          const [repeatKey] = split(arg);
          if (repeatKey && !nameMatches(arg, values, numeric)) {
            for (const row of rowsFor(values, repeatKey)) result += cell(arg, values, numeric, s, row);
          } else {
            result += flat(arg, values, numeric, s);
          }
        }
        break;
      }
      case "sum-times": {
        const [a, b] = args;
        if (a && b) {
          const [aKey] = split(a);
          const [bKey] = split(b);
          const aWhole = nameMatches(a, values, numeric);
          const bWhole = nameMatches(b, values, numeric);
          const aRows = !aWhole && aKey ? rowsFor(values, aKey) : [];
          const bRows = !bWhole && bKey ? rowsFor(values, bKey) : [];

          const count = Math.max(aRows.length, bRows.length, 1);
          for (let i = 0; i < count; i += 1) {
            const av = cell(a, values, numeric, s, aRows[i]);
            const bv = cell(b, values, numeric, s, bRows[i]);
            result += scaledProduct(av, bv, 10 ** s);
          }
        }
        break;
      }
      case "add":
      case "subtract":
      case "multiply": {
        const nums = args.map((a) => flat(a, values, numeric, s));
        if (nums.length > 0) result = nums[0]!;
        for (let i = 1; i < nums.length; i += 1) {

          if (spec.op === "multiply") result = scaledProduct(result, nums[i]!, 10 ** s);
          else if (spec.op === "add") result += nums[i]!;
          else result -= nums[i]!;
        }
        break;
      }
      case "percent": {
        const base = args.length > 0 ? flat(args[0]!, values, numeric, s) : 0;
        const rate = rateOf(spec.rateKey, values, numeric, s);
        result = scaledProduct(base, rate, 100 * 10 ** RATE_SCALE);
        break;
      }
      default:
        result = 0;
    }
    numeric[spec.key] = result;
    out[spec.key] = formatMinorUnits(result, s);
  }
  return out;
}

```

## lib/render/css.ts

```ts
export interface Refusal {
  field: string;
  value: string;
  reason: string;
}

export class Refusals {
  private readonly items: Refusal[] = [];
  private readonly seen = new Set<string>();
  add(field: string, value: string, reason: string): void {
    const key = `${field} ${value} ${reason}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ field, value, reason });
  }
  list(): Refusal[] {
    return this.items;
  }
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\.\d+)\s*)?\)$/i;
const HSL = /^hsla?\(\s*\d{1,3}(?:deg|rad|turn)?(?:\s*,\s*|\s+)[\d.]+%(?:\s*,\s*|\s+)[\d.]+%(?:\s*(?:,\s*|\s*\/\s*)(?:0|1|0?\.\d+|\.\d+|[\d.]+%))?\s*\)$/i;

const NAMED = new Set([
  "aliceblue","antiquewhite","aqua","aquamarine","azure",
  "beige","bisque","black","blanchedalmond","blue","blueviolet","brown","burlywood",
  "cadetblue","chartreuse","chocolate","coral","cornflowerblue","cornsilk","crimson","cyan",
  "darkblue","darkcyan","darkgoldenrod","darkgray","darkgreen","darkgrey","darkkhaki","darkmagenta","darkolivegreen","darkorange","darkorchid","darkred","darksalmon","darkseagreen","darkslateblue","darkslategray","darkslategrey","darkturquoise","darkviolet","deeppink","deepskyblue","dimgray","dimgrey","dodgerblue",
  "firebrick","floralwhite","forestgreen","fuchsia",
  "gainsboro","ghostwhite","gold","goldenrod","gray","green","greenyellow","grey",
  "honeydew","hotpink",
  "indianred","indigo","ivory","khaki",
  "lavender","lavenderblush","lawngreen","lemonchiffon","lightblue","lightcoral","lightcyan","lightgoldenrodyellow","lightgray","lightgreen","lightgrey","lightpink","lightsalmon","lightseagreen","lightskyblue","lightslategray","lightslategrey","lightsteelblue","lightyellow","lime","limegreen","linen",
  "magenta","maroon","mediumaquamarine","mediumblue","mediumorchid","mediumpurple","mediumseagreen","mediumslateblue","mediumspringgreen","mediumturquoise","mediumvioletred","midnightblue","mintcream","mistyrose","moccasin",
  "navajowhite","navy",
  "oldlace","olive","olivedrab","orange","orangered","orchid",
  "palegoldenrod","palegreen","paleturquoise","palevioletred","papayawhip","peachpuff","peru","pink","plum","powderblue","purple",
  "rebeccapurple","red","rosybrown","royalblue",
  "saddlebrown","salmon","sandybrown","seagreen","seashell","sienna","silver","skyblue","slateblue","slategray","slategrey","snow","springgreen","steelblue",
  "tan","teal","thistle","tomato","turquoise",
  "violet",
  "wheat","white","whitesmoke",
  "yellow","yellowgreen",
]);

export function safeColor(v: unknown, fallback: string, r: Refusals, field = "color"): string {
  if (typeof v !== "string") {
    r.add(field, String(v), "not a string");
    return fallback;
  }
  const t = v.trim();
  if (
    HEX.test(t) ||
    RGB.test(t) ||
    HSL.test(t) ||
    NAMED.has(t.toLowerCase()) ||
    t.toLowerCase() === "transparent" ||
    t.toLowerCase() === "none" ||
    t.toLowerCase() === "currentcolor"
  ) {
    return t;
  }
  r.add(field, v, "not a recognised colour");
  return fallback;
}

const FAMILIES: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  "helvetica neue": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "segoe ui": '"Segoe UI", system-ui, Arial, sans-serif',
  verdana: "Verdana, Geneva, sans-serif",
  calibri: "Calibri, Carlito, Arial, sans-serif",
  cambria: "Cambria, Georgia, serif",
  "times new roman": '"Times New Roman", Times, serif',
  georgia: "Georgia, 'Times New Roman', serif",
  palatino: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  "palatino linotype": '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  "book antiqua": '"Book Antiqua", Palatino, Georgia, serif',
  garamond: "Garamond, 'EB Garamond', Georgia, serif",
  "century gothic": '"Century Gothic", Futura, sans-serif',
  impact: "Impact, 'Arial Narrow Bold', sans-serif",
  "comic sans ms": '"Comic Sans MS", "Comic Sans", cursive',
  "courier new": '"Courier New", Courier, monospace',
  courier: '"Courier New", Courier, monospace',
  "lucida console": '"Lucida Console", Monaco, monospace',
  monospace: "ui-monospace, Menlo, Consolas, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "Helvetica, Arial, sans-serif",
};

export function fontStack(family: unknown): string {
  if (typeof family !== "string") return FAMILIES["sans-serif"]!;
  const key = family.trim().toLowerCase();
  if (Object.hasOwn(FAMILIES, key)) return FAMILIES[key]!;

  const cleaned = family.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 100);
  if (cleaned.length === 0) return FAMILIES["sans-serif"]!;

  const probe = cleaned.toLowerCase();
  const generic = probe.includes("mono") || probe.includes("courier") || probe.includes("consol")
    ? FAMILIES["monospace"]!
    : probe.includes("serif")
      ? FAMILIES["serif"]!
      : FAMILIES["sans-serif"]!;
  return `"${cleaned}", ${generic}`;
}

export function safeLength(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function safeAngle(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function safeOpacity(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}
```

## lib/render/escape.ts

```ts
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export function attr(s: string): string {
  return escapeHtml(s);
}
```

## lib/render/index.ts

```ts
import { collectDocumentVariables } from "@/lib/template/placeholders";
import type { ComputedSpec } from "@/lib/package/format";
import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type TemplateObject,
} from "@/lib/template/types";

import { canonicalJson } from "./canonical";
import { computeAll } from "./computed";
import { Refusals, safeLength, type Refusal } from "./css";
import { attr, escapeHtml } from "./escape";
import { calculateLayout } from "./layout";
import type { ContentMeasurement } from "./measure";
import { renderObject } from "./primitives";
import { expandRepeats } from "./repeat";
import { applyRowHeights, rowsWorthMeasuring } from "./rowHeights";
import { sha256Hex } from "./sha256";
import { stylesheet } from "./style";
import type { Values } from "./values";

export type { Refusal } from "./css";

export interface RenderOptions {
  title?: string;

  computed?: readonly ComputedSpec[];

  currencyScale?: number;

  placeholders?: "hide" | "show";

  measurements?: Readonly<Record<string, ContentMeasurement>>;

  remeasure?: (id: string, width: number) => ContentMeasurement | undefined;
}

export interface RenderResult {
  html: string;
  refusals: Refusal[];
  variables: string[];
  warnings: string[];

  objects: TemplateObject[];

  page: { width: number; height: number };
}

function pageLength(v: unknown, field: string, refusals: Refusals, fallback: number): number {
  const n = safeLength(v, 0);
  if (n > 0) return n;
  refusals.add(`page.${field}`, String(v), "not a positive length; the page falls back to A4");
  return fallback;
}

function sheetVersion(raw: unknown, refusals: Refusals): number {
  const v = safeLength(raw, Number.NaN);
  if (Number.isFinite(v) && v >= 0) return v;
  refusals.add(
    "templateVersion",
    String(raw),
    "not a version number; the supported version is emitted instead",
  );
  return TEMPLATE_VERSION;
}

function record(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function docName(meta: Record<string, unknown> | undefined, refusals: Refusals): string {
  const raw = meta?.name;
  if (typeof raw === "string") return raw;
  const substitute = raw === undefined || raw === null ? "Document" : String(raw);
  refusals.add("meta.name", String(raw), `not a string; the document is named ${substitute}`);
  return substitute;
}

export function renderHtml(
  template: BillTemplate,
  values: Readonly<Record<string, string>> = {},
  options: RenderOptions = {},
): RenderResult {
  const refusals = new Refusals();

  const claimed = safeLength(template.templateVersion, Number.NaN);
  if (claimed > TEMPLATE_VERSION) {
    throw new Error(
      `template version ${claimed} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
    );
  }
  const version = sheetVersion(template.templateVersion, refusals);

  const page = record(template.document);
  const width = pageLength(page?.width, "width", refusals, A4_WIDTH);
  const height = pageLength(page?.height, "height", refusals, A4_HEIGHT);

  const meta = record(template.meta);
  const name = docName(meta, refusals);

  let objects: readonly TemplateObject[];
  if (Array.isArray(template.objects)) {
    objects = template.objects;
  } else {
    refusals.add("objects", String(template.objects), "not an array; the page renders empty");
    objects = [];
  }

  const enriched: Values = {
    ...values,
    ...computeAll(options.computed ?? [], values, options.currencyScale ?? 2),
  };

  const { objects: expanded0, warnings: repeatWarnings } = expandRepeats(objects, enriched, height);

  const measurements = options.measurements ?? {};
  const expanded = expanded0.map((o) => {
    if (o.type !== "table") return o;
    const policy = rowsWorthMeasuring(o);
    if (!policy) return o;
    return applyRowHeights(o, measurements, {
      ...(policy.maxGrowth !== undefined ? { maxGrowth: policy.maxGrowth } : {}),
    });
  });

  const layoutRules = template.layout;
  const layoutMeasurements: Record<string, ContentMeasurement> = { ...measurements };
  for (const o of expanded) {
    if (o.type !== "table") continue;
    if (!rowsWorthMeasuring(o)) continue;
    layoutMeasurements[o.id] = {
      naturalWidth: o.width,
      height: o.height,
    };
  }

  const solve = (m: Readonly<Record<string, ContentMeasurement>>) =>
    calculateLayout({
      objects: expanded,
      measurements: m,
      guides: layoutRules?.guides ?? [],
      attachments: layoutRules?.attachments ?? [],
      documentPolicy: layoutRules?.document ?? { growthX: "fixed", growthY: "fixed" },
      document: { width, height },
      ...(layoutRules?.collision !== undefined ? { collision: layoutRules.collision } : {}),
    });

  let geometry = layoutRules && layoutRules.mode === "variable" ? solve(layoutMeasurements) : null;

  if (geometry && options.remeasure) {
    const widened = geometry.objects.filter((o) => {
      const authored = expanded.find((a) => a.id === o.id);
      return authored !== undefined && Math.abs(authored.width - o.width) > 1;
    });
    if (widened.length > 0) {
      const refined = { ...layoutMeasurements };
      let improved = false;
      for (const o of widened) {
        const better = options.remeasure(o.id, o.width);
        if (better && Number.isFinite(better.height) && Number.isFinite(better.naturalWidth)) {
          refined[o.id] = better;
          improved = true;
        }
      }
      if (improved) geometry = solve(refined);
    }
  }

  const placed = geometry ? geometry.objects : expanded;
  const pageWidth = geometry ? geometry.page.width : width;
  const pageHeight = geometry ? geometry.page.height : height;

  const ordered = placed
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.zIndex - b.o.zIndex || a.i - b.i);

  const placeholders = options.placeholders ?? "hide";
  const body = ordered
    .map(({ o, i }) => renderObject(o, i, enriched, refusals, placeholders))
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  const hashComputations = options.computed ?? meta?.computed;
  const hash = sha256Hex(canonicalJson({
    ...template,
    meta: {
      name: meta?.name,
      ...(Array.isArray(hashComputations) ? { computed: hashComputations } : {}),
    },
  }));
  const title = escapeHtml(options.title ?? name);

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n` +
    `<style>\n${stylesheet(pageWidth, pageHeight)}\n</style>\n</head>\n<body>\n` +
    `<div class="sheet" data-template-version="${attr(String(version))}" ` +
    `data-template-hash="${hash}">\n${body}\n</div>\n</body>\n</html>\n`;

const texts = objects.flatMap((o) =>
    o.type === "table"
      ? (Array.isArray(o.cells) ? o.cells : []).map((c) => c?.text)

      : o.type === "text" || o.type === "field"
      ? [o.text]
      : [],
  );
  const variables = collectDocumentVariables(
    texts.filter((t): t is string => typeof t === "string"),
  );

return {
      html,
      refusals: refusals.list(),
      variables,
      warnings: [...repeatWarnings, ...(geometry?.diagnostics ?? [])],
      objects: placed.map((o) => ({ ...o })),
      page: { width: pageWidth, height: pageHeight },
    };
}

```

## lib/render/layout.ts

```ts
import type { ContentMeasurement } from "./measure";
import type {
  AnchorRule,
  AxisExpansion,
  ChildAnchor,
  CollisionPolicy,
  ContainerPolicy,
  DocumentLayoutPolicy,
  GuideAttachment,
  LayoutGuide,
  TemplateDocument,
  TemplateObject,
} from "@/lib/template/types";

export interface LayoutInput {

  objects: readonly TemplateObject[];

  measurements: Readonly<Record<string, ContentMeasurement>>;
  guides: readonly LayoutGuide[];
  attachments: readonly GuideAttachment[];
  documentPolicy: DocumentLayoutPolicy;
  document: TemplateDocument;

  collision?: CollisionPolicy;
}

export interface LayoutOutput {

objects: TemplateObject[];

  page: TemplateDocument;

  guides: LayoutGuide[];

  diagnostics: string[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isShape(o: TemplateObject): boolean {
  return (
    o.type === "rect" ||
    o.type === "rounded-rect" ||
    o.type === "ellipse" ||
    o.type === "line" ||
    o.type === "hr" ||
    o.type === "vr" ||
    o.type === "polygon" ||
    o.type === "freehand"
  );
}

function policyOf(o: TemplateObject): { x: AxisExpansion; y: AxisExpansion } | undefined {
  const e = (o as { expansion?: unknown }).expansion;
  if (typeof e !== "object" || e === null) return undefined;
  const rec = e as { x?: unknown; y?: unknown };
  if (typeof rec.x !== "object" || rec.x === null) return undefined;
  if (typeof rec.y !== "object" || rec.y === null) return undefined;
  return rec as { x: AxisExpansion; y: AxisExpansion };
}

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface AxisResult {
  size: number;
  clipped: boolean;
}

function allocateAxis(
  policy: AxisExpansion,
  base: number,
  needed: number,
  limit: number,
): AxisResult {
  const want = Math.max(0, needed);
  if (policy.mode === "fixed") {
    return { size: base, clipped: want > base + TOLERANCE };
  }
  const cap =
    policy.mode === "bounded" ? base + Math.max(0, finite(policy.maxGrowth, 0)) : limit;
  const allowed = Math.min(Math.max(base, want), Math.max(base, cap));
  return { size: allowed, clipped: want > allowed + TOLERANCE };
}

interface GuideState {
  guide: LayoutGuide;
  base: number;
  cap: number;
}

const TOLERANCE = 0.5;

const CONTAINMENT_PASSES = 4;

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - TOLERANCE &&
    inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + TOLERANCE
  );
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - TOLERANCE &&
    b.x < a.x + a.width - TOLERANCE &&
    a.y < b.y + b.height - TOLERANCE &&
    b.y < a.y + a.height - TOLERANCE
  );
}

function containerOf(o: TemplateObject): ContainerPolicy | undefined {
  const c = (o as { container?: unknown }).container;
  if (typeof c !== "object" || c === null) return undefined;
  const rec = c as ContainerPolicy;
  if (rec.enabled !== true) return undefined;
  if (o.type !== "rect" && o.type !== "rounded-rect" && o.type !== "ellipse") return undefined;
  return rec;
}

function layoutParentOf(o: TemplateObject): string | null {
  const p = (o as { layoutParentId?: unknown }).layoutParentId;
  return typeof p === "string" && p.length > 0 ? p : null;
}

function anchorOf(o: TemplateObject): { horizontal: AnchorRule; vertical: AnchorRule; offsets: Required<Pick<ChildAnchor, "leftOffset" | "rightOffset" | "topOffset" | "bottomOffset">> } | undefined {
  const a = (o as { anchor?: unknown }).anchor;
  if (typeof a !== "object" || a === null) return undefined;
  const rec = a as ChildAnchor;
  return {
    horizontal: rec.horizontal ?? "start",
    vertical: rec.vertical ?? "start",
    offsets: {
      leftOffset: finite(rec.leftOffset, 0),
      rightOffset: finite(rec.rightOffset, 0),
      topOffset: finite(rec.topOffset, 0),
      bottomOffset: finite(rec.bottomOffset, 0),
    },
  };
}

function paddingOf(policy: ContainerPolicy | undefined): { top: number; right: number; bottom: number; left: number } {
  return {
    top: Math.max(0, finite(policy?.padding?.top, 0)),
    right: Math.max(0, finite(policy?.padding?.right, 0)),
    bottom: Math.max(0, finite(policy?.padding?.bottom, 0)),
    left: Math.max(0, finite(policy?.padding?.left, 0)),
  };
}

export function calculateLayout(input: LayoutInput): LayoutOutput {
  const diagnostics: string[] = [];
  const note = (text: string) => {
    if (!diagnostics.includes(text)) diagnostics.push(text);
  };

  const docW = finite(input.document?.width, 0);
  const docH = finite(input.document?.height, 0);
  const policy = input.documentPolicy ?? FIXED_POLICY;

  const guides = new Map<string, GuideState>();
  for (const g of input.guides) {
    if (!g || typeof g.id !== "string") continue;
    guides.set(g.id, {
      guide: g,
      base: finite(g.position, 0),
      cap: finite(g.maxDisplacement, Number.POSITIVE_INFINITY),
    });
  }

  const usable: GuideAttachment[] = [];
  for (const a of input.attachments) {
    if (!a || typeof a.id !== "string") continue;
    if (!guides.has(a.guideId)) {
      note(`attachment "${a.id}" names guide "${String(a.guideId)}", which is not declared`);
      continue;
    }
    usable.push(a);
  }

  const byObject = new Map<string, GuideAttachment[]>();
  for (const a of usable) {
    const list = byObject.get(a.objectId) ?? [];
    list.push(a);
    byObject.set(a.objectId, list);
  }

  const dependsOn = new Map<string, Set<string>>();
  const touches = new Map<string, Set<string>>();
  for (const id of guides.keys()) {
    dependsOn.set(id, new Set());
    touches.set(id, new Set());
  }
  for (const o of input.objects) {
    const p = policyOf(o);
    const ids = new Set<string>();
    if (p?.y.growthGuideId && guides.has(p.y.growthGuideId)) ids.add(p.y.growthGuideId);
    if (p?.x.growthGuideId && guides.has(p.x.growthGuideId)) ids.add(p.x.growthGuideId);
    const attached = new Set<string>();
    for (const a of byObject.get(o.id) ?? []) {
      if (attached.has(a.guideId)) continue;
      attached.add(a.guideId);

      for (const id of ids) {
        if (id !== a.guideId) touches.get(id)?.add(a.guideId);
      }
    }
    for (const id of ids) {
      for (const other of attached) {
        if (other !== id) dependsOn.get(id)?.add(other);
      }
    }
  }

  const ordered = topoOrder([...guides.keys()], dependsOn);
  let cyclic = false;
  if (ordered === null) {
    cyclic = true;
    note(
      "layout guide dependencies contain a cycle; those guides were left at their authored positions",
    );
  }
  const resolveOrder = ordered ?? [...guides.keys()];

  const base = new Map<string, Box>();
  const byId = new Map<string, TemplateObject>();
  for (const o of input.objects) {
    base.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height });
    byId.set(o.id, o);
  }

  const solved = new Map<string, Box>();
  const clipped = new Set<string>();

  for (const o of input.objects) {
    const p = policyOf(o);
    if (!p) continue;
    const m = input.measurements?.[o.id];
    if (!m) continue;

    const needW = finite(m.naturalWidth, Number.NaN);
    const needH = finite(m.height, Number.NaN);
    if (Number.isNaN(needW) || Number.isNaN(needH)) {
      note(`"${o.id}" has a measurement that is not a finite size; it keeps its authored box`);
      continue;
    }

    const b = base.get(o.id)!;

    const xLimit =
      policy.growthX === "expand"
        ? finite(policy.maxWidth, Number.MAX_SAFE_INTEGER)
        : Math.max(docW - b.x, b.width);
    const yLimit = Number.MAX_SAFE_INTEGER;
    const x = allocateAxis(p.x, b.width, needW, xLimit);
    const y = allocateAxis(p.y, b.height, needH, yLimit);

    solved.set(o.id, { x: b.x, y: b.y, width: x.size, height: y.size });
    if (x.clipped || y.clipped) clipped.add(o.id);
  }

  const pushers = new Map<string, Set<string>>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    if (!s) continue;
    const p = policyOf(o);
    const links = new Set<string>();
    if (p?.y.growthGuideId && guides.has(p.y.growthGuideId)) links.add(p.y.growthGuideId);
    if (p?.x.growthGuideId && guides.has(p.x.growthGuideId)) links.add(p.x.growthGuideId);
    for (const a of byObject.get(o.id) ?? []) {
      if (a.edge === "bottom" || a.edge === "right") links.add(a.guideId);
    }
    if (links.size > 0) pushers.set(o.id, links);
  }

  const demand = new Map<string, number>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    if (!s) continue;
    for (const gid of pushers.get(o.id) ?? []) {
      const g = guides.get(gid)!;
      const horizontal = g.guide.orientation === "horizontal";
      const want = horizontal ? s.y + s.height - g.base : s.x + s.width - g.base;
      demand.set(gid, Math.max(demand.get(gid) ?? 0, Math.max(0, want)));
    }
  }

  const position = new Map<string, number>();
  for (const id of resolveOrder) {
    const g = guides.get(id)!;
    const want = cyclic ? 0 : Math.max(0, demand.get(id) ?? 0);
    if (want > g.cap + TOLERANCE) {
      note(`guide "${id}" reached its maximum displacement of ${g.cap} and stopped there`);
    }
    position.set(id, g.base + Math.min(want, g.cap));
  }

  if (!cyclic) {
    for (const o of input.objects) {
      const s = solved.get(o.id);
      if (!s) continue;
      const b = base.get(o.id)!;
      for (const gid of pushers.get(o.id) ?? []) {
        const g = guides.get(gid)!;
        const at = position.get(gid)!;
        const horizontal = g.guide.orientation === "horizontal";
        const reachable = horizontal ? at - s.y : at - s.x;
        const floor = horizontal ? b.height : b.width;
        const wanted = horizontal ? s.height : s.width;
        if (wanted > reachable + TOLERANCE) {
          const allowed = Math.max(floor, reachable);
          if (horizontal) {
            s.height = allowed;
          } else {
            s.width = allowed;
          }
          clipped.add(o.id);
        }
      }
    }
  }

  const placed = new Map<string, Box>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    placed.set(o.id, s ? { ...s } : { ...base.get(o.id)! });
  }

  const placeEdge = (
    box: Box,
    axis: "x" | "y",
    at: number,
    travel: number,
    authoredEdge: number,
    contentEdge: number,
    cap: number,
  ) => {

    const guideBase = at - travel;
    const edgeOnGuide = Math.abs(authoredEdge - guideBase) <= TOLERANCE;
    const guideStartsBeyondEdge = authoredEdge < guideBase - TOLERANCE;
    const followed = edgeOnGuide
      ? at
      : guideStartsBeyondEdge
        ? authoredEdge + travel
        : Math.max(authoredEdge, at);
    const want = Math.min(Math.max(followed, contentEdge), cap);
    if (axis === "y") {
      box.height = Math.max(0, want - box.y);
    } else {
      box.width = Math.max(0, want - box.x);
    }
  };

  const carryTo = (
    box: Box,
    axis: "x" | "y",
    at: number,
    travel: number,
    authoredEdge: number,
    atFarEdge: boolean,
  ) => {
    const guideBase = at - travel;
    const drawnOnGuide =
      Math.abs(authoredEdge - guideBase) <= TOLERANCE ||
      Math.abs(authoredEdge - at) <= TOLERANCE;
    const want = drawnOnGuide ? at : authoredEdge + travel;
    if (axis === "y") {
      box.y = atFarEdge ? want - box.height : want;
    } else {
      box.x = atFarEdge ? want - box.width : want;
    }
  };

  const growthCap = (o: TemplateObject, axis: "x" | "y", box: Box): number => {
    const p = policyOf(o);
    const piece = p?.[axis];
    if (!piece || piece.mode !== "bounded") return Number.POSITIVE_INFINITY;
    const added = Math.max(0, finite(piece.maxGrowth, 0));
    return axis === "y" ? box.y + box.height + added : box.x + box.width + added;
  };

  for (const a of usable) {
    const box = placed.get(a.objectId);
    if (!box) continue;
    const g = guides.get(a.guideId)!;
    const at = position.get(a.guideId)!;
    const authored = base.get(a.objectId)!;
    const horizontal = g.guide.orientation === "horizontal";
    const axis = horizontal ? "y" : "x";

    if (horizontal !== (a.edge === "top" || a.edge === "bottom")) {
      note(
        `attachment "${a.id}" binds the ${a.edge} edge to the ${horizontal ? "horizontal" : "vertical"} guide "${a.guideId}", which cannot control it`,
      );
      continue;
    }

    if (pushers.get(a.objectId)?.has(a.guideId)) continue;

    const opposite =
      a.edge === "top" ? "bottom" : a.edge === "bottom" ? "top" : a.edge === "left" ? "right" : "left";
    const twin = (byObject.get(a.objectId) ?? []).find(
      (t) => t.guideId === a.guideId && t.edge === opposite,
    );
    const authoredEdge = horizontal
      ? a.edge === "bottom"
        ? authored.y + authored.height
        : authored.y
      : a.edge === "right"
        ? authored.x + authored.width
        : authored.x;
    const contentEdge = horizontal ? box.y + box.height : box.x + box.width;

    const cap = growthCap(byId.get(a.objectId)!, axis, box);
    const travel = Math.max(0, at - g.base);

    const atFarEdge = a.edge === "bottom" || a.edge === "right";

    if (twin) {

      if (twin.id < a.id) continue;
      note(
        `"${a.objectId}" has both ${opposite} and ${a.edge} attached to guide "${a.guideId}"; one box cannot have both edges on one boundary, so it follows the boundary instead`,
      );
      carryTo(box, axis, at, travel, authoredEdge, atFarEdge);
      continue;
    }

    if (a.behavior === "move") {
      carryTo(box, axis, at, travel, authoredEdge, atFarEdge);
      continue;
    }

    if (atFarEdge) {
      placeEdge(box, axis, at, travel, authoredEdge, contentEdge, cap);
    } else {

      carryTo(box, axis, at, travel, authoredEdge, atFarEdge);
    }
  }

  if (!cyclic) {
    for (const o of input.objects) {
      if (!isShape(o)) continue;
      const p = policyOf(o);
      if (!p) continue;
      const box = placed.get(o.id);
      if (!box) continue;
      const authored = base.get(o.id)!;
      for (const axis of ["y", "x"] as const) {
        const gid = p[axis].growthGuideId;
        if (!gid || !guides.has(gid)) continue;
        const g = guides.get(gid)!;
        const at = position.get(gid);
        if (at === undefined) continue;
        const horizontal = axis === "y";
        const authoredEdge = horizontal
          ? authored.y + authored.height
          : authored.x + authored.width;
        placeEdge(
          box,
          horizontal ? "y" : "x",
          at,
          Math.max(0, at - g.base),
          authoredEdge,
          Number.NEGATIVE_INFINITY,
          growthCap(o, axis, box),
        );
      }
    }
  }

  if (!cyclic) {

    const linked = new Map<string, { y: boolean; x: boolean }>();
    for (const o of input.objects) {
      const p = policyOf(o);
      linked.set(o.id, {
        y: p?.y.growthGuideId !== undefined && guides.has(p.y.growthGuideId),
        x: p?.x.growthGuideId !== undefined && guides.has(p.x.growthGuideId),
      });
    }

    const childrenOf = new Map<string, string[]>();
    for (const o of input.objects) {
      const parent = layoutParentOf(o);
      if (!parent || !byId.has(parent) || parent === o.id) continue;
      const list = childrenOf.get(parent) ?? [];
      list.push(o.id);
      childrenOf.set(parent, list);
    }

    const depthOf = (id: string): number => {
      let depth = 0;
      let current: string | undefined = id;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        const parent = layoutParentOf(byId.get(current)!);
        if (!parent || !byId.has(parent)) break;
        depth += 1;
        current = parent;
      }
      return depth;
    };
    const containers = input.objects
      .filter((o) => containerOf(o) !== undefined && (childrenOf.get(o.id) ?? []).length > 0)
      .sort((a, b) => depthOf(b.id) - depthOf(a.id));

    const containerCeiling = (policy: ContainerPolicy, axis: "y" | "x", box: Box): number => {
      const max = axis === "y" ? policy.maxHeight : policy.maxWidth;
      if (max === undefined) return Number.POSITIVE_INFINITY;
      const origin = axis === "y" ? box.y : box.x;
      return origin + Math.max(0, finite(max, 0));
    };

    for (let pass = 0; pass < CONTAINMENT_PASSES; pass += 1) {
      let changed = false;
      for (const o of containers) {
        const box = placed.get(o.id)!;
        const baseBox = base.get(o.id)!;
        const policy = containerOf(o)!;
        const pad = paddingOf(policy);
        const members = (childrenOf.get(o.id) ?? [])
          .map((id) => byId.get(id)!)
          .filter(Boolean);
        for (const axis of ["y", "x"] as const) {
          const growth = axis === "y" ? policy.growthY ?? "content" : policy.growthX ?? "content";
          if (growth !== "content") continue;
          if (linked.get(o.id)![axis]) continue;
          const horizontal = axis === "y";
          const origin = horizontal ? baseBox.y : baseBox.x;
          const baseFar = horizontal ? baseBox.y + baseBox.height : baseBox.x + baseBox.width;
          const minSize = Math.max(0, finite(horizontal ? policy.minHeight : policy.minWidth, 0));
          let need = Math.max(baseFar, origin + minSize);
          for (const c of members) {
            const cb = placed.get(c.id)!;
            const far = horizontal ? cb.y + cb.height : cb.x + cb.width;
            need = Math.max(need, far + (horizontal ? pad.bottom : pad.right));
          }
          const wanted = Math.min(need, containerCeiling(policy, axis, box));
          if (wanted > (horizontal ? box.y + box.height : box.x + box.width) + TOLERANCE) {
            if (horizontal) box.height = wanted - box.y;
            else box.width = wanted - box.x;
            changed = true;
          }
        }
      }
      if (!changed) break;

      for (const o of input.objects) {
        const parentId = layoutParentOf(o);
        if (!parentId || !byId.has(parentId)) continue;
        const anchor = anchorOf(o);
        if (!anchor) continue;
        const box = placed.get(o.id)!;
        const baseBox = base.get(o.id)!;
        const parentBox = placed.get(parentId)!;
        const parentBase = base.get(parentId)!;
        const grownY = parentBox.y + parentBox.height - (parentBase.y + parentBase.height);
        const grownX = parentBox.x + parentBox.width - (parentBase.x + parentBase.width);
        if (anchor.vertical === "end" && grownY > TOLERANCE) {
          const inset = Math.max(0, parentBase.y + parentBase.height - (baseBox.y + baseBox.height));
          box.y = parentBox.y + parentBox.height - inset - box.height;
        } else if (anchor.vertical === "stretch" && grownY > TOLERANCE) {
          const topInset = Math.max(0, baseBox.y - parentBase.y);
          const bottomInset = Math.max(0, parentBase.y + parentBase.height - (baseBox.y + baseBox.height));
          box.y = parentBox.y + topInset;
          box.height = Math.max(0, parentBox.y + parentBox.height - bottomInset - box.y);
        }
        if (anchor.horizontal === "end" && grownX > TOLERANCE) {
          const inset = Math.max(0, parentBase.x + parentBase.width - (baseBox.x + baseBox.width));
          box.x = parentBox.x + parentBox.width - inset - box.width;
        } else if (anchor.horizontal === "stretch" && grownX > TOLERANCE) {
          const leftInset = Math.max(0, baseBox.x - parentBase.x);
          const rightInset = Math.max(0, parentBase.x + parentBase.width - (baseBox.x + baseBox.width));
          box.x = parentBox.x + leftInset;
          box.width = Math.max(0, parentBox.x + parentBox.width - rightInset - box.x);
        }
      }
    }

    const legacyShapes = input.objects.filter(
      (o) => isShape(o) && policyOf(o) !== undefined && containerOf(o) === undefined,
    );
    for (let pass = 0; pass < CONTAINMENT_PASSES; pass += 1) {
      let changed = false;
      for (const o of legacyShapes) {
        const box = placed.get(o.id)!;
        const authored = base.get(o.id)!;
        const p = policyOf(o)!;
        for (const axis of ["y", "x"] as const) {
          if (p[axis].mode === "fixed") continue;
          if (linked.get(o.id)![axis]) continue;
          const horizontal = axis === "y";
          const inside = input.objects.filter((c) => c.id !== o.id && contains(authored, base.get(c.id)!));
          let need = horizontal ? box.y + box.height : box.x + box.width;
          for (const c of inside) {
            const cb = placed.get(c.id)!;
            const ca = base.get(c.id)!;
            const slack = horizontal
              ? Math.max(0, authored.y + authored.height - (ca.y + ca.height))
              : Math.max(0, authored.x + authored.width - (ca.x + ca.width));
            const edge = horizontal ? cb.y + cb.height : cb.x + cb.width;
            need = Math.max(need, edge + slack);
          }
          const cap = growthCap(o, axis, box);
          const wanted = Math.min(need, cap);
          if (wanted > (horizontal ? box.y + box.height : box.x + box.width) + TOLERANCE) {
            if (horizontal) box.height = wanted - box.y;
            else box.width = wanted - box.x;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    for (const o of input.objects) {
      const c = solved.get(o.id);
      if (!c) continue;
      const declared = layoutParentOf(o);
      if (declared && byId.has(declared)) {
        const holder = byId.get(declared)!;
        const policy = containerOf(holder);
        const hb = placed.get(holder.id)!;
        const overY = c.y + c.height > hb.y + hb.height + TOLERANCE;
        const overX = c.x + c.width > hb.x + hb.width + TOLERANCE;

        const growsY =
          policy !== undefined
            ? (policy.growthY ?? "content") === "content"
            : (policyOf(holder)?.y.mode ?? "fixed") !== "fixed";
        const growsX =
          policy !== undefined
            ? (policy.growthX ?? "content") === "content"
            : (policyOf(holder)?.x.mode ?? "fixed") !== "fixed";
        if ((overY && !growsY) || (overX && !growsX)) {
          note(
            `"${o.id}" grew past "${holder.id}", which is set to a fixed size; enlarge that box or let it expand`,
          );
          continue;
        }

        const cappedY = policy?.maxHeight !== undefined && overY;
        const cappedX = policy?.maxWidth !== undefined && overX;
        if (cappedY || cappedX) {
          const limit = cappedY ? policy!.maxHeight : policy!.maxWidth;
          note(
            `"${o.id}" needs more room than "${holder.id}" allows; that box is capped at ${limit}px on the ${cappedY ? "vertical" : "horizontal"} axis`,
          );
        }
        continue;
      }
      for (const holder of input.objects) {
        if (holder.id === o.id || !isShape(holder)) continue;
        const hp = policyOf(holder);
        if (hp && hp.y.mode !== "fixed") continue;
        if (!contains(base.get(holder.id)!, base.get(o.id)!)) continue;
        const hb = placed.get(holder.id)!;
        if (c.y + c.height > hb.y + hb.height + TOLERANCE || c.x + c.width > hb.x + hb.width + TOLERANCE) {
          note(
            `"${o.id}" grew past "${holder.id}", which is set to a fixed size; enlarge that box or let it expand`,
          );
        }
      }
    }

    const collisionMode: CollisionPolicy = input.collision ?? "report";
    if (collisionMode === "report") {
      for (const [parentId, members] of childrenOf) {
        for (let i = 0; i < members.length; i += 1) {
          for (let j = i + 1; j < members.length; j += 1) {
            const a = placed.get(members[i]!)!;
            const b = placed.get(members[j]!)!;
            if (overlaps(a, b)) {
              note(
                `"${members[i]}" overlaps "${members[j]}" inside "${parentId}"; move one of them or set collision to allow`,
              );
            }
          }
        }
      }
    }
  }

  for (const id of clipped) {
    note(`"${id}" could not be given the room its content needs; the text was not shrunk to fit`);
  }

  const objects = input.objects.map((o) => {
    const box = placed.get(o.id)!;
    return { ...o, x: box.x, y: box.y, width: box.width, height: box.height };
  });

  let lowest = 0;
  let rightmost = 0;
  for (const o of objects) {
    lowest = Math.max(lowest, o.y + o.height);
    rightmost = Math.max(rightmost, o.x + o.width);
  }

  let width = docW;
  let height = docH;

  if (policy.growthY === "expand") {
    const cap = finite(policy.maxHeight, Number.POSITIVE_INFINITY);
    height = Math.min(Math.max(height, lowest), cap);
    if (lowest > cap + TOLERANCE) {
      note(`the bill grew past the page height limit of ${cap} and was cut off there`);
    }
  } else if (lowest > height + TOLERANCE) {
    note(`content reaches ${Math.round(lowest)}px but the page is ${Math.round(height)}px tall`);
  }

  if (policy.growthX === "expand") {
    const cap = finite(policy.maxWidth, Number.POSITIVE_INFINITY);
    width = Math.min(Math.max(width, rightmost), cap);
  } else if (rightmost > width + TOLERANCE) {
    note(`content reaches ${Math.round(rightmost)}px but the page is ${Math.round(width)}px wide`);
  }

  return {
    objects,
    page: { width, height },
    guides: input.guides.map((g) => ({ ...g, position: position.get(g.id) ?? g.position })),
    diagnostics,
  };
}

function topoOrder(ids: string[], deps: Map<string, Set<string>>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return false;
    if (s === 2) return true;
    state.set(id, 1);
    for (const dep of deps.get(id) ?? []) {
      if (!visit(dep)) return false;
    }
    state.set(id, 2);
    order.push(id);
    return true;
  };
  for (const id of ids) if (!visit(id)) return null;
  return order;
}

const FIXED_POLICY: DocumentLayoutPolicy = { growthX: "fixed", growthY: "fixed" };

```

## lib/render/measure.ts

```ts


export interface ContentMeasurement {

  naturalWidth: number;

  height: number;
}

export type MeasurementSource = "measured" | "estimated";
```

## lib/render/primitives.ts

```ts
import type {
  BillPartObject,
  FreehandObject,
  ImagePlaceholderObject,
  LineObject,
  PolygonObject,
  ShapeObject,
  TableCell,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";

import { Refusals, fontStack, safeAngle, safeColor, safeLength, safeOpacity } from "./css";
import { attr, escapeHtml } from "./escape";
import { resolveText } from "./values";

export type PlaceholderMode = "hide" | "show";

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function css(parts: readonly string[]): string {
  return `${parts.join("; ")};`;
}

function anchor(index: number): string {
  return `id="o${index}"`;
}

function div(index: number, cls: string, style: string, inner = ""): string {
  return `<div class="${cls}" ${anchor(index)} style="${attr(style)}">${inner}</div>`;
}

function placed(o: TemplateObject, r: Refusals): string[] {
  const id = typeof o.id === "string" ? o.id : "?";
  return [
    "position: absolute",
    `left: ${num(o.x)}px`,
    `top: ${num(o.y)}px`,
    `width: ${num(length(o.width, r, `${id}.width`, 0))}px`,
    `height: ${num(length(o.height, r, `${id}.height`, 0))}px`,

    `z-index: ${num(Math.round(safeLength(o.zIndex, 0)))}`,
    `opacity: ${num(safeOpacity(o.opacity))}`,
  ];
}

function shell(
  o: TemplateObject,
  r: Refusals,
  extra: readonly string[] = [],
  scale?: { x: number; y: number },
): string {
  const rotation = safeAngle(o.rotation);
  const parts = placed(o, r);
  const sx = scale?.x ?? 1;
  const sy = scale?.y ?? 1;

  const stretched = Math.abs(sx - 1) >= 0.001 || Math.abs(sy - 1) >= 0.001;
  const scalePart = `scale(${num(sx)}, ${num(sy)})`;
  if (rotation !== 0 && stretched) {

    parts.push(
      `transform: rotate(${num(rotation)}deg) ${scalePart}`,
      "transform-origin: 50% 50%",
    );
  } else if (rotation !== 0) {
    parts.push(`transform: rotate(${num(rotation)}deg)`, "transform-origin: 50% 50%");
  } else if (stretched) {

    parts.push(`transform: ${scalePart}`, "transform-origin: 0 0");
  }
  return css([...parts, ...extra]);
}

const ALIGNMENTS = new Set(["left", "center", "right"]);

const UNRESOLVED_TOKEN = /\{\{[^}]*\}\}/g;

function stripUnresolvedTokens(text: string): string {
  return text.replace(UNRESOLVED_TOKEN, "");
}

function align(v: unknown, r: Refusals, field: string): "left" | "center" | "right" {
  if (typeof v === "string" && ALIGNMENTS.has(v)) return v as "left" | "center" | "right";
  r.add(field, String(v), "not an alignment; falling back to left");
  return "left";
}

function justify(v: unknown): "flex-start" | "center" | "flex-end" {
  if (v === "middle") return "center";
  if (v === "bottom") return "flex-end";
  return "flex-start";
}

function length(v: unknown, r: Refusals, field: string, fallback: number): number {
  const n = safeLength(v, fallback);
  if (n < 0) {
    r.add(field, String(v), "negative length; falling back to zero");
    return 0;
  }
  return n;
}

function safeScale(v: unknown, r: Refusals, field: string): number {
  if (v === undefined || v === null) return 1;
  const n = safeLength(v, 1);
  if (!Number.isFinite(n) || n <= 0) {
    r.add(field, String(v), "not a positive scale; falling back to 1");
    return 1;
  }
  return n;
}

function finiteBox(o: TemplateObject): boolean {
  return (
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    Number.isFinite(o.width) &&
    Number.isFinite(o.height)
  );
}

function renderShape(o: ShapeObject, index: number, r: Refusals): string {
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const fill = safeColor(o.fill, "transparent", r, `${o.id}.fill`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  const radius =
    o.type === "ellipse" ? "50%" : `${num(length(o.cornerRadius, r, `${o.id}.cornerRadius`, 0))}px`;
  return div(
    index,
    "o",
    shell(o, r, [
      `border: ${num(width)}px solid ${stroke}`,
      `background: ${fill}`,
      `border-radius: ${radius}`,
    ]),
  );
}

function renderLine(o: LineObject, index: number, r: Refusals): string | null {
  const dx = o.x2 - o.x;
  const dy = o.y2 - o.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len)) {
    r.add(`${o.id}.endpoint`, `x2=${o.x2},y2=${o.y2}`, "not a finite length");
    return null;
  }
  if (len === 0) return null;
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const thickness = Math.max(length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1), 0.75);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const turn = angle + safeAngle(o.rotation);
  return div(
    index,
    "o",
    css([
      "position: absolute",
      `left: ${num(o.x)}px`,
      `top: ${num(o.y - thickness / 2)}px`,
      `width: ${num(len)}px`,
      `height: ${num(thickness)}px`,
      `z-index: ${num(Math.round(safeLength(o.zIndex, 0)))}`,
      `opacity: ${num(safeOpacity(o.opacity))}`,
      `background: ${stroke}`,
      "transform-origin: 0 50%",
      `transform: rotate(${num(turn)}deg)`,
    ]),
  );
}

function renderPolygon(o: PolygonObject, index: number, r: Refusals): string | null {
  const points = (Array.isArray(o.points) ? o.points : []).filter(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  if (points.length < 2) {
    r.add(`${o.id}.points`, String(points.length), "fewer than two finite points");
    return null;
  }
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  const pointsAttr = attr(points.map((p) => `${num(p[0])},${num(p[1])}`).join(" "));
  return (
    `<svg class="o" ${anchor(index)} style="${attr(shell(o, r, ["overflow: visible"]))}">` +
    `<polygon points="${pointsAttr}" fill="${attr(safeColor(o.fill, "transparent", r, `${o.id}.fill`))}"` +
    ` stroke="${attr(stroke)}" stroke-width="${num(width)}" /></svg>`
  );
}

function renderFreehand(o: FreehandObject, index: number, r: Refusals): string | null {

  if (typeof o.path !== "string" || o.path.trim() === "") {
    r.add(`${o.id}.path`, String(o.path), "empty path data");
    return null;
  }
  const stroke = safeColor(o.stroke, "#000000", r, `${o.id}.stroke`);
  const width = length(o.strokeWidth, r, `${o.id}.strokeWidth`, 1);
  return (
    `<svg class="o" ${anchor(index)} style="${attr(shell(o, r, ["overflow: visible"]))}">` +
    `<path d="${attr(o.path)}" fill="none" stroke="${attr(stroke)}"` +
    ` stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round" /></svg>`
  );
}

function renderText(
  o: TextObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,

  extra: readonly string[] = [],
  placeholders: PlaceholderMode = "hide",
): string {
  const size = length(o.fontSize, r, `${o.id}.fontSize`, 12);

  const tracking = num(safeLength(o.charSpacing, 0) / 1000);
  const distribution = justify(o.textVerticalAlign);

  const ink = safeColor(o.fill, "#000000", r, `${o.id}.fill`);

  const sx = safeScale(o.scaleX, r, `${o.id}.scaleX`);
  const sy = safeScale(o.scaleY, r, `${o.id}.scaleY`);

  const rawWrap = (o as { wrapWidth?: unknown }).wrapWidth;
  const wrapWidth =
    typeof rawWrap === "number" && rawWrap > 0
      ? length(rawWrap, r, `${o.id}.wrapWidth`, 0)
      : 0;
  const decls: string[] = [
    wrapWidth ? "white-space: pre-wrap" : "white-space: pre",
    ...(wrapWidth ? ["overflow-wrap: break-word"] : []),
    `color: ${ink}`,
    `font-family: ${fontStack(o.fontFamily)}`,
    `font-size: ${num(size)}px`,
    `line-height: ${num(size * safeLength(o.lineHeight, 1.16))}px`,
    `font-weight: ${o.fontWeight === "bold" ? "bold" : "normal"}`,
    `font-style: ${o.fontStyle === "italic" ? "italic" : "normal"}`,
    `text-align: ${align(o.textAlign, r, `${o.id}.textAlign`)}`,
    `letter-spacing: ${tracking}em`,
  ];
  const resolved = resolveText(typeof o.text === "string" ? o.text : "", values);
  const body =
    `<div class="tx" style="${attr(css([
      "display: flex",
      "flex-direction: column",
      `justify-content: ${distribution}`,
    ]))}">${escapeHtml(
      placeholders === "hide" ? stripUnresolvedTokens(resolved) : resolved,
    )}</div>`;
  return div(
    index,
    "o t",
    shell(
      o,
      r,

      [...decls, ...(wrapWidth ? ["height: auto"] : []), ...extra],
      { x: sx, y: sy },
    ),
    body,
  );
}

interface TableStyle {
  border: string;
  padding: string;
  family: string;
  headerFill: string;
  headerInk: string;
  cellFill: string;
  cellInk: string;
}

function tableStyle(o: TableObject, r: Refusals): TableStyle {
  return {
    border: `${num(length(o.borderWidth, r, `${o.id}.borderWidth`, 1))}px solid ${safeColor(o.borderColor, "#000000", r, `${o.id}.borderColor`)}`,
    padding: `${num(length(o.padding, r, `${o.id}.padding`, 4))}px`,
    family: fontStack(o.fontFamily),
    headerFill: safeColor(o.headerFill, "transparent", r, `${o.id}.headerFill`),
    headerInk: safeColor(o.headerTextColor, "#000000", r, `${o.id}.headerTextColor`),
    cellFill: safeColor(o.cellFill, "transparent", r, `${o.id}.cellFill`),
    cellInk: safeColor(o.cellTextColor, "#000000", r, `${o.id}.cellTextColor`),
  };
}

function cellStyle(
  cell: TableCell | undefined,
  o: TableObject,
  t: TableStyle,
  r: Refusals,
  isHeader: boolean,
): string {
  const baseInk = isHeader ? t.headerInk : t.cellInk;
  const ink =
    typeof cell?.color === "string"
      ? safeColor(cell.color, baseInk, r, `${o.id}.cellColor`)
      : baseInk;
  return css([
    `border: ${t.border}`,
    `padding: ${t.padding}`,
    `font-family: ${t.family}`,
    `font-size: ${num(length(cell?.fontSize, r, `${o.id}.cellFontSize`, 12))}px`,
    `font-weight: ${cell?.fontWeight === "bold" ? "bold" : "normal"}`,
    `color: ${ink}`,
    `background: ${isHeader ? t.headerFill : t.cellFill}`,
    `text-align: ${align(cell?.textAlign, r, `${o.id}.cellTextAlign`)}`,
    "white-space: pre",

    "overflow: hidden",
  ]);
}

function renderTable(
  o: TableObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {
  const cols = (Array.isArray(o.colWidths) ? o.colWidths : []).map((w, i) =>
    length(w, r, `${o.id}.colWidths[${i}]`, 0),
  );
  const rows = (Array.isArray(o.rowHeights) ? o.rowHeights : []).map((h, i) =>
    length(h, r, `${o.id}.rowHeights[${i}]`, 0),
  );
  const width = cols.reduce((a, b) => a + b, 0);
  if (cols.length === 0 || !(width > 0)) {
    r.add(`${o.id}.colWidths`, String(width), "no usable column widths");
    return null;
  }
  const cells = Array.isArray(o.cells) ? o.cells : [];
  const shared = tableStyle(o, r);

  const row = (at: number, isHeader: boolean): string => {
    const body: string[] = [];
    for (let c = 0; c < cols.length; c++) {
      const cell = cells[at * cols.length + c];
      const tag = isHeader ? "th" : "td";
      const resolved = resolveText(typeof cell?.text === "string" ? cell.text : "", values);
      const text = escapeHtml(
        placeholders === "hide" ? stripUnresolvedTokens(resolved) : resolved,
      );
      body.push(`<${tag} style="${attr(cellStyle(cell, o, shared, r, isHeader))}">${text}</${tag}>`);
    }
    return `<tr style="height: ${num(rows[at] ?? 0)}px">${body.join("")}</tr>`;
  };

  let sections: string;
  if (o.headerRow && rows.length > 0) {
    sections = `<thead>${row(0, true)}</thead>`;
    if (rows.length > 1) {
      sections += `<tbody>${rows.slice(1).map((_, i) => row(i + 1, false)).join("")}</tbody>`;
    }
  } else {
    sections = `<tbody>${rows.map((_, i) => row(i, false)).join("")}</tbody>`;
  }

  const colgroup = cols.map((w) => `<col style="width: ${num(w)}px" />`).join("");
  const table = `<table class="tbl" style="width: ${num(width)}px"><colgroup>${colgroup}</colgroup>${sections}</table>`;

  const box: TableObject = {
    ...o,
    width,
    height: rows.reduce((a, b) => a + b, 0),
  };
  return div(index, "o", shell(box, r), table);
}

function isSafeImageSrc(src: unknown): src is string {
  return (
    typeof src === "string" &&
    (src.startsWith("data:image/") ||
      src.startsWith("blob:") ||
      src.startsWith("https://") ||
      src.startsWith("http://"))
  );
}

function renderPlaceholder(
  o: ImagePlaceholderObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {

  const fromValues = values[o.placeholderRole];
  const src = isSafeImageSrc(fromValues) ? fromValues : o.src;
  if (isSafeImageSrc(src)) {
    return `<img class="o" ${anchor(index)} style="${attr(
      shell(o, r, ["object-fit: contain"]),
    )}" src="${attr(src)}" alt="${attr(typeof o.label === "string" ? o.label : "")}" />`;
  }

  if (placeholders === "hide") return null;
  return div(
    index,
    "o ph",
    shell(o, r, [
      "border: 1px dashed #9ca3af",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "color: #6b7280",
    ]),
    escapeHtml(typeof o.label === "string" ? o.label : ""),
  );
}

function renderBillPart(o: BillPartObject, index: number, r: Refusals): string | null {
  if (!isSafeImageSrc(o.src)) {
    r.add(`${o.id}.src`, typeof o.src, "not a safe image source");
    return null;
  }
  return `<img class="o" ${anchor(index)} style="${attr(
    shell(o, r, ["object-fit: contain"]),
  )}" src="${attr(o.src)}" alt="${attr(typeof o.name === "string" ? o.name : "")}" />`;
}

export function renderObject(
  o: TemplateObject,
  index: number,
  values: Readonly<Record<string, string>>,
  r: Refusals,
  placeholders: PlaceholderMode = "hide",
): string | null {

  const id = typeof o.id === "string" ? o.id : "?";

  const kind = String(o.type);

  if (o.type === "group") return null;
  if (o.visible === false) return null;
  if (!finiteBox(o)) {
    r.add(`${id}.box`, `x=${o.x},y=${o.y},w=${o.width},h=${o.height}`, "not a finite box");
    return null;
  }
  switch (o.type) {
    case "rect":
    case "rounded-rect":
    case "ellipse":
      return renderShape(o, index, r);
    case "line":
    case "hr":
    case "vr":
      return renderLine(o, index, r);
    case "polygon":
      return renderPolygon(o, index, r);
    case "freehand":
      return renderFreehand(o, index, r);
    case "text":
      return renderText(o, index, values, r, [], placeholders);
    case "field": {

      const o2 = o as unknown as TextObject;
      return renderText(
        { ...o2, wrapWidth: o2.width },
        index,
        values,
        r,
        ["overflow: hidden"],
        placeholders,
      );
    }
    case "table":
      return renderTable(o, index, values, r, placeholders);
    case "image-placeholder":
      return renderPlaceholder(o, index, values, r, placeholders);
    case "bill-part":
      return renderBillPart(o, index, r);
    default:

      r.add(`${id}.type`, kind, "unknown object type");
      return null;
  }
}
```

## lib/render/repeat.ts

```ts


import { DEFAULT_REPEAT_MAX_ITEMS } from "@/lib/template/types";
import type { TableCell, TableObject, TableRepeat, TemplateObject } from "@/lib/template/types";

import { itemsOf } from "./computed";
import type { Values } from "./values";

const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

const tokenRegex = (): RegExp => new RegExp(TOKEN_SOURCE, "g");

export function resolveScoped(
  text: string,
  item: Record<string, unknown>,
  values: Values,
): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    const local = item[key];
    if (typeof local === "string") return local;
    if (typeof local === "number" && Number.isFinite(local)) return String(local);
    const global = values[key];
    return typeof global === "string" ? global : token;
  });
}

interface Band {
  startRow: number;
  endRow: number;
  key: string;
  maxItems: number;
}

function bandOf(o: TableObject): { band: Band; why: string | null } | null {
  const r = o.repeat;
  if (!r || typeof r !== "object") return null;

  const startRow: unknown = r.startRow;
  const endRow: unknown = r.endRow;
  const key: unknown = r.key;

  const heights = Array.isArray(o.rowHeights) ? o.rowHeights : [];
  const cells = Array.isArray(o.cells) ? o.cells : [];
  const columns =
    typeof o.columns === "number" && Number.isInteger(o.columns) && o.columns > 0 ? o.columns : 1;

  const rows = Math.max(
    typeof o.rows === "number" && Number.isInteger(o.rows) && o.rows > 0 ? o.rows : 0,
    heights.length,
    Math.ceil(cells.length / columns),
  );
  const problem = (why: string): { band: Band; why: string } => ({
    band: { startRow: 0, endRow: 0, key: "", maxItems: DEFAULT_REPEAT_MAX_ITEMS },
    why,
  });

  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) {
    return problem("first row is not a row index");
  }
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) {
    return problem("last row comes before the first");
  }
  if (rows <= 0 || endRow >= rows) return problem("last row is past the end of the table");
  if (typeof key !== "string" || key.trim().length === 0) return problem("no items key");

  const cap: unknown = r.maxItems;
  const maxItems =
    typeof cap === "number" && Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_REPEAT_MAX_ITEMS;
  return {
    band: { startRow, endRow, key: key.trim(), maxItems },
    why: null,
  };
}

function bandWarnings(o: TableObject, band: Band): string[] {
  const found: string[] = [];

  if ((o.repeat as TableRepeat | undefined)?.repeatHeader === true) {
    found.push(
      `table "${o.name}" has repeatHeader on, which asks for the header row to be drawn again when the table splits across pages; a document is a single page here, so the heading is drawn once`,
    );
  }

  if (o.headerRow === true && band.startRow === 0) {
    found.push(
      `table "${o.name}" starts its repeating band on the header row, so the header is drawn once per item; start the band below it to keep one heading`,
    );
  }

  return found;
}

function jsonArrayLength(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function expandTable(
  o: TableObject,
  values: Values,
  pageHeight: number,
): { table: TemplateObject; warnings: string[] } {
  const found = bandOf(o);
  if (!found) return { table: o, warnings: [] };
  const { band, why } = found;

  const warnings: string[] = [];
  if (why) {
    warnings.push(`table "${o.name}" has a repeat band that was ignored: ${why}`);
    return { table: o, warnings };
  }

  warnings.push(...bandWarnings(o, band));

  const columns = typeof o.columns === "number" && o.columns > 0 ? o.columns : 1;
  const raw = values[band.key];
  const items = itemsOf(values, band.key);

  if (typeof raw === "string" && raw.length > 0) {
    const entries = jsonArrayLength(raw);
    if (entries === null) {
      warnings.push(
        `table "${o.name}" could not read any items from ${band.key}; the repeating rows were dropped`,
      );
    } else if (entries > 0 && items.length === 0) {
      warnings.push(
        `table "${o.name}" read ${entries} entries from ${band.key} but none were usable rows; the repeating rows were dropped`,
      );
    }
  }

  let used = items;
  if (items.length > band.maxItems) {
    warnings.push(
      `table "${o.name}" received ${items.length} items but ${band.key} is capped at ${band.maxItems}; the extra rows were not drawn`,
    );
    used = items.slice(0, band.maxItems);
  }

  const cells = Array.isArray(o.cells) ? o.cells : [];
  const heights = Array.isArray(o.rowHeights) ? o.rowHeights : [];

  const rows = Math.max(
    typeof o.rows === "number" && o.rows > 0 ? o.rows : 0,
    heights.length,
    Math.ceil(cells.length / columns),
  );
  const at = (r: number, c: number): TableCell =>
    cells[r * columns + c] ?? { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" };

  const newCells: TableCell[] = [];
  const newHeights: number[] = [];

  for (let r = 0; r < band.startRow; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }
  for (const item of used) {
    for (let r = band.startRow; r <= band.endRow; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const src = at(r, c);
        newCells.push({ ...src, text: resolveScoped(src.text ?? "", item, values) });
      }
      newHeights.push(heights[r] ?? 0);
    }
  }
  for (let r = band.endRow + 1; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }

  const height = newHeights.reduce((a, b) => a + b, 0);
  const top = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : 0;
  if (Number.isFinite(pageHeight) && pageHeight > 0 && top + height > pageHeight) {
    warnings.push(
      `table "${o.name}" ends at ${Math.round(top + height)} but the page is ${Math.round(pageHeight)} tall; the last rows will print off the page`,
    );
  }

  return {
    table: {
      ...o,
      rows: newHeights.length,
      rowHeights: newHeights,
      cells: newCells,
      height,
      repeat: undefined,
    } as TableObject,
    warnings,
  };
}

export function expandRepeats(
  objects: readonly TemplateObject[],
  values: Values,
  pageHeight: number,
): { objects: TemplateObject[]; warnings: string[] } {
  const warnings: string[] = [];
  const out = objects.map((o) => {
    if (o.type !== "table") return o;
    const { table, warnings: w } = expandTable(o, values, pageHeight);
    warnings.push(...w);
    return table;
  });
  return { objects: out, warnings };
}

```

## lib/render/repeatForm.ts

```ts
import { itemsOf } from "./computed";
import type { Values } from "./values";

function blankRow(columns: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of columns) row[c] = "";
  return row;
}

export function repeatValue(rows: Record<string, string>[], columns: string[]): string {
  const filled = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = typeof row[c] === "string" ? row[c] : "";
    return out;
  });
  return JSON.stringify(filled);
}

export function rowsFromValue(value: string, columns: string[]): Record<string, string>[] {
  const parsed = itemsOf({ repeat: value } as Values, "repeat");
  if (parsed.length === 0) return [blankRow(columns)];
  return parsed.map((row) => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      const v = row[c];
      out[c] = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    }
    return out;
  });
}

```

## lib/render/rowHeights.ts

```ts
import type { ContentMeasurement } from "./measure";
import { expandRepeats } from "./repeat";
import { computeAll } from "./computed";
import type { Values } from "./values";
import type { ComputedSpec } from "@/lib/package/format";
import type { AxisExpansion, BillTemplate, TableObject } from "../template/types";

const TOLERANCE = 0.01;

export function cellKey(tableId: string, row: number, col: number): string {
  return `${tableId}|${row}|${col}`;
}

export interface RowHeightLimits {

  maxGrowth?: number;
}

export function rowsWithIdentity(table: TableObject): number[] {
  return Array.from({ length: Math.max(0, table.rows) }, (_, i) => i);
}

export function rowsWorthMeasuring(t: unknown): AxisExpansion | false {
  const e = (t as { expansion?: unknown }).expansion;
  if (typeof e !== "object" || e === null) return false;
  const y = (e as { y?: unknown }).y;
  if (typeof y !== "object" || y === null) return false;
  const mode = (y as { mode?: unknown }).mode;
  if (mode !== "bounded" && mode !== "unbounded") return false;
  const rec = y as { mode: "bounded" | "unbounded"; maxGrowth?: unknown };
  const out: AxisExpansion = { mode: rec.mode };
  if (typeof rec.maxGrowth === "number" && Number.isFinite(rec.maxGrowth)) {
    out.maxGrowth = rec.maxGrowth;
  }
  return out;
}

export interface CellRequest {

  id: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  textAlign: "left" | "center" | "right";

  width: number;
  wrap: boolean;
}

export function cellRequests(
  template: BillTemplate,
  values: Values,
  computed: readonly ComputedSpec[] = [],
  currencyScale = 2,
): CellRequest[] {

  const page: { height?: number } | undefined = template.document;
  const pageHeight = typeof page?.height === "number" ? page.height : 0;

  const { objects: expanded } = expandRepeats(
    Array.isArray(template.objects) ? template.objects : [],
    { ...values, ...computeAll(computed, values, currencyScale) },
    pageHeight,
  );

  const out: CellRequest[] = [];
  for (const o of expanded) {
    if (o.type !== "table") continue;
    const policy = rowsWorthMeasuring(o);
    if (!policy) continue;

    const table = o as TableObject;
    const columns = table.columns > 0 ? table.columns : 1;
    const colWidths = Array.isArray(table.colWidths) ? table.colWidths : [];
    const cells = Array.isArray(table.cells) ? table.cells : [];

    const rows = table.rows > 0 ? table.rows : Math.ceil(cells.length / columns);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const cell = cells[r * columns + c];
        if (!cell) continue;
        const colW = typeof colWidths[c] === "number" && Number.isFinite(colWidths[c])
          ? colWidths[c]
          : table.width / columns;
        out.push({
          id: cellKey(table.id, r, c),
          text: typeof cell.text === "string" ? cell.text : "",
          fontFamily: table.fontFamily,
          fontSize: typeof cell.fontSize === "number" ? cell.fontSize : 10,
          fontWeight: cell.fontWeight === "bold" ? "bold" : "normal",
          textAlign: cell.textAlign ?? "left",
          width: Math.max(0, colW - table.padding * 2),
          wrap: true,
        });
      }
    }
  }
  return out;
}

export function applyRowHeights(
  table: TableObject,
  measurements: Readonly<Record<string, ContentMeasurement>>,
  limits: RowHeightLimits = {},
): TableObject {
  const columns = table.columns > 0 ? table.columns : 1;
  const rows = table.rows > 0 ? table.rows : 0;
  const authored = Array.isArray(table.rowHeights) ? table.rowHeights : [];
  const rowHeights = new Array<number>(rows);
  let changed = false;

  for (let r = 0; r < rows; r += 1) {
    const base = typeof authored[r] === "number" && Number.isFinite(authored[r])
      ? authored[r]
      : 0;

    let tallest = 0;
    for (let c = 0; c < columns; c += 1) {
      const m = measurements[cellKey(table.id, r, c)];
      if (!m) continue;
      const h = m.height;

      if (!Number.isFinite(h) || h < 0) continue;
      if (!Number.isFinite(m.naturalWidth)) continue;
      if (h > tallest) tallest = h;
    }

    if (tallest <= 0) {
      rowHeights[r] = base;
      continue;
    }

    const needed = tallest + table.padding * 2;
    let next = Math.max(base, needed);
    if (typeof limits.maxGrowth === "number" && Number.isFinite(limits.maxGrowth)) {
      next = Math.min(next, base + Math.max(0, limits.maxGrowth));
    }
    if (Math.abs(next - base) < TOLERANCE) next = base;
    rowHeights[r] = next;
    if (next !== base) changed = true;
  }

  if (!changed) return table;

  const height = rowHeights.reduce((a, b) => a + b, 0);
  return { ...table, rowHeights, height };
}
```

## lib/render/sha256.ts

```ts


const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const H = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const low = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

function hex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

export function sha256Hex(input: string): string {
  return sha256HexFromBytes(utf8Bytes(input));
}

export function sha256HexBytes(bytes: Uint8Array): string {
  return sha256HexFromBytes(Array.from(bytes));
}

function sha256HexFromBytes(bytes: number[]): string {
  const message = bytes.slice();
  const bits = message.length * 8;
  const high = Math.floor(bits / 0x100000000);

  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0);
  message.push(
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (bits >>> 24) & 0xff,
    (bits >>> 16) & 0xff,
    (bits >>> 8) & 0xff,
    bits & 0xff,
  );

  const h = H.slice();
  const w = new Array<number>(64).fill(0);

  for (let block = 0; block < message.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const o = block + i * 4;
      w[i] =
        (message[o] << 24) |
        (message[o + 1] << 16) |
        (message[o + 2] << 8) |
        message[o + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let t = h[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (t + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      t = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + t) >>> 0;
  }

  return h.map(hex).join("");
}
```

## lib/render/style.ts

```ts


export function stylesheet(docW: number, docH: number): string {
  return [
    `@page { size: ${docW}px ${docH}px; margin: 0; }`,
    `html, body { margin: 0; padding: 0; background: #fff; }`,
    `body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`,
    `.sheet { position: relative; width: ${docW}px; height: ${docH}px; overflow: hidden; background: #fff; }`,
    `.o { position: absolute; }`,
    `.t { white-space: pre; }`,
    `.tx { display: flex; flex-direction: column; }`,
    `.tbl { border-collapse: collapse; table-layout: fixed; }`,
    `.ph { border: 1px dashed #9ca3af; display: flex; align-items: center; justify-content: center; color: #6b7280; }`,
    `* { box-sizing: border-box; }`,
    `* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`,
  ].join("\n");
}
```

## lib/render/values.ts

```ts
export type Values = Readonly<Record<string, string>>;

const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

function tokenRegex(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

export function resolveText(text: string, values: Values): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    const v = values[key];
    return typeof v === "string" ? v : token;
  });
}
```

## lib/render/words.ts

```ts


interface CurrencyWords {
  majorOne: string;
  majorMany: string;
  minorOne: string;
  minorMany: string;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const CURRENCY: Record<string, CurrencyWords> = {
  inr: { majorOne: "Rupee", majorMany: "Rupees", minorOne: "Paisa", minorMany: "Paise" },
  usd: { majorOne: "Dollar", majorMany: "Dollars", minorOne: "Cent", minorMany: "Cents" },
  eur: { majorOne: "Euro", majorMany: "Euros", minorOne: "Cent", minorMany: "Cents" },
  gbp: { majorOne: "Pound", majorMany: "Pounds", minorOne: "Penny", minorMany: "Pennies" },
};

const UNKNOWN: CurrencyWords = {
  majorOne: "Unit",
  majorMany: "Units",
  minorOne: "Cent",
  minorMany: "Cents",
};

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  return `${TENS[Math.floor(n / 10)] ?? ""}${n % 10 ? ` ${ONES[n % 10]}` : ""}`.trim();
}

function under1000(n: number): string {
  const head = Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : "";
  const tail = under100(n % 100);
  return [head, tail].filter(Boolean).join(" ");
}

const GROUPS: readonly (readonly [number, string])[] = [
  [100000000000, "Kharab"],
  [1000000000, "Arab"],
  [10000000, "Crore"],
  [100000, "Lakh"],
  [1000, "Thousand"],
];

function groupWords(n: number): string {
  if (n <= 0) return "";
  let rest = n;
  const parts: string[] = [];
  for (const [size, name] of GROUPS) {
    const count = Math.floor(rest / size);
    if (count <= 0) continue;
    parts.push(`${count >= 1000 ? String(count) : under1000(count)} ${name}`);
    rest %= size;
  }
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(" ");
}

export function spellMoney(minorUnits: number, scale: number, currency?: string): string {
  const safe = Number.isInteger(scale) && scale >= 0 && scale <= 6 ? scale : 2;
  const words = CURRENCY[(currency ?? "inr").toLowerCase()] ?? UNKNOWN;
  const n = Number.isFinite(minorUnits) ? Math.abs(Math.round(minorUnits)) : 0;

  let majorUnits = n;
  let minorPart = 0;
  if (safe > 0) {
    const divisor = 10 ** safe;
    majorUnits = Math.floor(n / divisor);
    minorPart = n % divisor;
  }

  const pieces: string[] = [];

  if (minorUnits < 0 && n > 0) pieces.push("Minus");
  if (majorUnits === 0 && minorPart === 0) {
    pieces.push(`Zero ${words.majorMany} Only`);
  } else {
    if (majorUnits > 0) {
      const unit = majorUnits === 1 ? words.majorOne : words.majorMany;
      pieces.push(`${groupWords(majorUnits)} ${unit}`);
    }
    if (minorPart > 0) {
      const unit = minorPart === 1 ? words.minorOne : words.minorMany;
      pieces.push(`${groupWords(minorPart)} ${unit}`);
    }
    pieces.push("Only");
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

```

## lib/share/document.ts

```ts
import { escapeHtml } from "@/lib/render/escape";
import type { BillTemplate } from "@/lib/template/types";

export function embedJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function safeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

export function buildShareDocument(template: BillTemplate, kitSource: string): string {
  const title = escapeHtml(template.meta?.name || "Document");
  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${title}</title>\n` +
    `<style>html,body{height:100%;margin:0}</style>\n` +
    `</head>\n<body>\n` +
    `<div id="share-app"></div>\n` +
    `<iframe id="share-preview" title="Preview"></iframe>\n` +
    `<script type="application/json" id="share-template">${embedJson(template)}</script>\n` +
    `<script>${safeScript(kitSource)}</script>\n` +
    `<script>\n` +
    `window.bootShareKit(\n` +
    `  document.getElementById("share-app"),\n` +
    `  JSON.parse(document.getElementById("share-template").textContent),\n` +
    `  document.getElementById("share-preview"),\n` +
    `);\n` +
    `</script>\n` +
    `</body>\n</html>\n`
  );
}
```

## lib/share/kit.ts

```ts
import {
  extractTemplateFields,
  extractFillableFields,
  fillTemplate,
  validateTemplateValues,
  validateRepeatingValues,
} from "@/lib/template/dataBinding";
import { renderHtml } from "@/lib/render";
import { measureBridge } from "@/lib/billkit/bridge";
import { measureDom } from "@/lib/billkit/measure-dom";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { BillTemplate } from "@/lib/template/types";
import { readImageFile } from "@/lib/client/readImageFile";

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

  { title: "Fields", source: "field" },
  { title: "Table cells", source: "table" },
  { title: "Images & signatures", source: "image-placeholder" },
];

export const TICKMARK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "—" },
  { value: "✓", label: "✓" },
  { value: "✗", label: "✗" },
];

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

function buildForm(
  fields: ReturnType<typeof extractTemplateFields>,
  onInput: () => void,
  imageValues: Record<string, string>,
  onError: (message: string) => void,
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
      section.append(buildField(field, onInput, imageValues, onError));
    }
    form.append(section);
  }
  return form;
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

export function bootShareKit(
  root: HTMLElement,
  template: BillTemplate,
  preview: HTMLIFrameElement,
): void {
  const style = el("style");
  style.textContent = STYLE;
  document.head.append(style);

  const computed = computedSpecsFor(template);
  const computedKeys = new Set(computed.map((spec) => spec.key));
  const allFields = extractTemplateFields(template);
  const fields = extractFillableFields(template, [...computedKeys]);
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
    const values: Record<string, string> = { ...imageValues };
    for (const element of Array.from(root.querySelectorAll("input,select"))) {
      const named = element as HTMLInputElement;
      if (!named.name) continue;

      if (named.type === "file") continue;

      const value =
        named.type === "checkbox"
          ? named.checked
            ? named.value
            : ""
          : named.value;

      if (value !== "") values[named.name] = value;
    }

    const filled = fillTemplate(template, values);
    validationErrors = [
      ...validateTemplateValues(fields, values),
      ...validateRepeatingValues(template, allFields, values),
    ];
    const plan = measureBridge(JSON.stringify(filled), JSON.stringify(values), JSON.stringify(computed));
    const measurements = measureDom(plan);

    const remeasure = (id: string, width: number) => {
      const request = plan.find((r) => r.id === id);
      if (!request) return undefined;
      return measureDom([{ ...request, width }])[id];
    };
    const rendered = renderHtml(filled, undefined, { computed, measurements, remeasure });
    preview.srcdoc = rendered.html;
    const missing = rendered.variables.filter((v) => !(v in values) || !values[v]);
    status.textContent = validationErrors.length
      ? validationErrors.join(" ")
      : missing.length
      ? `${missing.length} placeholder${missing.length === 1 ? "" : "s"} still empty: ${missing.join(", ")}`
      : "All placeholders filled.";
  };

  const form = buildForm(fields, refresh, imageValues, (message) => {
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

```

## lib/share/main.ts

```ts
import { bootShareKit } from "@/lib/share/kit";

declare global {
  interface Window {
    bootShareKit: typeof bootShareKit;
  }
}

if (typeof window !== "undefined") {
  window.bootShareKit = bootShareKit;
}
```

## lib/template/dataBinding.ts

```ts


import { extractVariables } from "./placeholders";
import { resolveText } from "../render/values";
import type {
  BillTemplate,
  PlaceholderSpec,
  TemplateObject,
} from "./types";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image";

export type FieldSource = "text" | "table" | "image-placeholder" | "field";

export interface TemplateField {

  key: string;

  label: string;
  type: FieldType;
  source: FieldSource;

  objectName: string;

  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
  min?: number;
  max?: number;
}

const DATE_RE = /date/i;

const CURRENCY_RE = /(total|amount|amt|subtotal|tax|charge|discount|balance|price|rate|fee)/i;

const NUMBER_RE = /(qty|quantity|count|_no$|^no$|hsn|pincode)/i;

const ACRONYMS: Record<string, string> = {
  qr: "QR Code",
  gstin: "GSTIN",
  id: "ID",
  no: "No.",
  sku: "SKU",
  hsn: "HSN",
  pan: "PAN",
  msme: "MSME",
  ifsc: "IFSC",
};

export function humanizeKey(key: string): string {
  return key
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      return ACRONYMS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function inferType(key: string, source: FieldSource): FieldType {
  if (source === "image-placeholder") return "image";
  if (DATE_RE.test(key)) return "date";
  if (CURRENCY_RE.test(key)) return "currency";
  if (NUMBER_RE.test(key)) return "number";
  return "text";
}

export function extractTemplateFields(template: BillTemplate): TemplateField[] {
  const out: TemplateField[] = [];
  const seen = new Set<string>();

  const specByKey = new Map<string, PlaceholderSpec>();
  for (const spec of Array.isArray(template.meta?.placeholders) ? template.meta.placeholders : []) {
    if (spec && typeof spec.key === "string") specByKey.set(spec.key, spec);
  }

  const add = (
    key: string,
    source: FieldSource,
    objectName: string,
    declaredType?: FieldType,
  ): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const spec = specByKey.get(key);
    out.push({
      key,
      label: spec?.label ? spec.label : humanizeKey(key),
      type: spec?.type ?? declaredType ?? declaredByKey.get(key) ?? inferType(key, source),
      source,
      objectName,
      maxLength: typeof spec?.maxLength === "number" && spec.maxLength > 0 ? spec.maxLength : undefined,
      required: spec?.required === true,
      defaultValue: typeof spec?.defaultValue === "string" ? spec.defaultValue : undefined,
      min: typeof spec?.min === "number" ? spec.min : undefined,
      max: typeof spec?.max === "number" ? spec.max : undefined,
    });
  };

  const declaredFieldType = (v: unknown): FieldType | undefined =>
    v === "text" ||
    v === "number" ||
    v === "date" ||
    v === "currency" ||
    v === "tickmark" ||
    v === "checkbox"
      ? v
      : undefined;

  const declaredByKey = new Map<string, FieldType>();
  for (const o of template.objects) {
    if (o.type !== "field") continue;
    const declared = declaredFieldType(o.fieldType);
    if (declared) declaredByKey.set(o.key, declared);
  }

  for (const o of template.objects) {
    if (o.type === "text") {
      for (const v of extractVariables(typeof o.text === "string" ? o.text : "")) {
        add(v, "text", o.name);
      }
    } else if (o.type === "table") {
      for (const cell of Array.isArray(o.cells) ? o.cells : []) {
        for (const v of extractVariables(
          cell && typeof cell.text === "string" ? cell.text : "",
        )) {
          add(v, "table", o.name);
        }
      }
    } else if (o.type === "image-placeholder") {
      add(o.placeholderRole, "image-placeholder", o.name);
    } else if (o.type === "field") {
      add(o.key, "field", o.name, declaredFieldType(o.fieldType));
    }
  }
  return out;
}

export function validateTemplateValues(
  fields: readonly TemplateField[],
  values: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const value = values[field.key]?.trim() ?? "";
    if (field.required && !value) {
      errors.push(`${field.label} is required.`);
      continue;
    }
    if (!value) continue;
    if (field.maxLength && value.length > field.maxLength) {
      errors.push(`${field.label} must be ${field.maxLength} characters or fewer.`);
    }
    if (field.type === "number" || field.type === "currency") {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        errors.push(`${field.label} must be a valid number.`);
      } else {
        if (field.min !== undefined && number < field.min) errors.push(`${field.label} must be at least ${field.min}.`);
        if (field.max !== undefined && number > field.max) errors.push(`${field.label} must be no more than ${field.max}.`);
      }
    }
    if (field.type === "date") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      const year = match ? Number(match[1]) : 0;
      const month = match ? Number(match[2]) : 0;
      const day = match ? Number(match[3]) : 0;
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
        errors.push(`${field.label} must be a valid date.`);
      }
    }
  }
  return errors;
}

export function extractFillableFields(
  template: BillTemplate,
  computedKeys: readonly string[] = [],
): TemplateField[] {
  const computed = new Set(computedKeys);
  const repeatColumns = new Set<string>();
  const outsideRepeat = new Set<string>();
  for (const object of template.objects) {
    if (object.type === "text" || object.type === "field") {
      for (const key of extractVariables(object.text)) outsideRepeat.add(key);
    } else if (object.type === "table") {
      for (let row = 0; row < object.rows; row += 1) {
        for (let col = 0; col < object.columns; col += 1) {
          const text = object.cells[row * object.columns + col]?.text ?? "";
          const inBand = object.repeat && row >= object.repeat.startRow && row <= object.repeat.endRow;
          for (const key of extractVariables(text)) (inBand ? repeatColumns : outsideRepeat).add(key);
        }
      }
    }
  }
  return extractTemplateFields(template).filter((field) =>
    !computed.has(field.key) && !(repeatColumns.has(field.key) && !outsideRepeat.has(field.key)),
  );
}

export function defaultValuesForTemplate(
  template: BillTemplate,
  computedKeys: readonly string[] = [],
): Record<string, string> {
  return Object.fromEntries(
    extractFillableFields(template, computedKeys)
      .filter((field) => field.type !== "image" && field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue!]),
  );
}

export function validateRepeatingValues(
  template: BillTemplate,
  fields: readonly TemplateField[],
  values: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  for (const table of template.objects) {
    if (table.type !== "table" || !table.repeat) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(values[table.repeat.key] ?? "[]") as unknown;
    } catch {
      errors.push(`${table.name} rows could not be read.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`${table.name} rows must be a list.`);
      continue;
    }
    const columns = new Set<string>();
    for (let row = table.repeat.startRow; row <= table.repeat.endRow; row += 1) {
      for (let col = 0; col < table.columns; col += 1) {
        for (const key of extractVariables(table.cells[row * table.columns + col]?.text ?? "")) columns.add(key);
      }
    }
    const rowFields = fields.filter((field) => columns.has(field.key));
    if (rows.length === 0 && rowFields.some((field) => field.required)) {
      errors.push(`${table.name}: add at least one item row.`);
    }
    rows.forEach((row, index) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return;
      const rowValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) if (typeof value === "string") rowValues[key] = value;
      for (const issue of validateTemplateValues(rowFields, rowValues)) {
        errors.push(`${table.name}, row ${index + 1}: ${issue}`);
      }
    });
  }
  return errors;
}

const PURE_TOKEN = /^\s*\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}\s*$/;

export function fillTemplate(
  template: BillTemplate,
  values: Readonly<Record<string, string>>,
): BillTemplate {
  const byKey = new Map<string, PlaceholderSpec>();
  for (const spec of Array.isArray(template.meta?.placeholders) ? template.meta.placeholders : []) {
    if (spec && typeof spec.key === "string") byKey.set(spec.key, spec);
  }

  const objects = template.objects.map((o): TemplateObject => {
    if (o.type === "text" || o.type === "field") {
      const pure = PURE_TOKEN.exec(typeof o.text === "string" ? o.text : "");
      const spec = pure ? byKey.get(pure[1]!) : undefined;
      return {
        ...o,
        fontFamily: spec?.fontFamily ?? o.fontFamily,
        fontSize: typeof spec?.fontSize === "number" && spec.fontSize > 0 ? spec.fontSize : o.fontSize,
        fontWeight: spec?.fontWeight ?? o.fontWeight,
        fontStyle: spec?.fontStyle ?? o.fontStyle,
        fill: spec?.color ?? o.fill,
        text: resolveText(o.text, values),
      };
    }
    if (o.type === "table") {
      return {
        ...o,
        cells: o.cells.map((c, index) => {
          const pure = PURE_TOKEN.exec(typeof c?.text === "string" ? c.text : "");
          const spec = pure ? byKey.get(pure[1]!) : undefined;
          const row = Math.floor(index / o.columns);
          const inRepeatBand = Boolean(
            o.repeat && row >= o.repeat.startRow && row <= o.repeat.endRow,
          );

          return {
            ...c,
            fontSize: typeof spec?.fontSize === "number" && spec.fontSize > 0 ? spec.fontSize : c.fontSize,
            fontWeight: spec?.fontWeight ?? c.fontWeight,
            ...(spec?.color ? { color: spec.color } : {}),

            text: inRepeatBand
              ? (typeof c?.text === "string" ? c.text : "")
              : resolveText(typeof c?.text === "string" ? c.text : "", values),
          };
        }),
      };
    }
    if (o.type === "image-placeholder") {
      const src = values[o.placeholderRole];
      return typeof src === "string" && src.length > 0
        ? { ...o, src }
        : { ...o };
    }
    return { ...o };
  });
  return { ...template, objects };
}

```

## lib/template/geometry.ts

```ts


export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  column: number;
}

export const MIN_COL_WIDTH = 8;
export const MIN_ROW_HEIGHT = 8;

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function offsets(sizes: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    out.push(acc);
    acc += s;
  }
  return out;
}

export function columnsCount(colWidths: readonly number[]): number {
  return colWidths.length;
}

export function rowsCount(rowHeights: readonly number[]): number {
  return rowHeights.length;
}

export function totalWidth(colWidths: readonly number[]): number {
  return sum(colWidths);
}

export function totalHeight(rowHeights: readonly number[]): number {
  return sum(rowHeights);
}

export function normaliseSizes(
  sizes: readonly number[],
  min: number,
  maxTotal?: number,
): number[] {
  const filtered = sizes.filter((n) => Number.isFinite(n) && n > 0);
  const list = (filtered.length ? filtered : [min]).map((n) =>
    Math.max(min, Math.round(n)),
  );
  if (maxTotal === undefined || list.length === 0) return list;

  const floor = min * list.length;
  const target = Math.max(floor, Math.round(maxTotal));
  const total = sum(list);
  if (total === target) return list;
  if (total < target) {
    return scaleSizesProportionally(list, target, min);
  }

  let excess = total - target;
  for (let i = list.length - 1; i >= 0 && excess > 0; i--) {
    const take = Math.min(list[i]! - min, excess);
    list[i]! -= take;
    excess -= take;
  }
  return list;
}

export function evenSizes(count: number, total: number, min: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const base = Math.max(min, Math.floor(total / n));
  const out = new Array<number>(n).fill(base);
  let used = base * n;
  let i = 0;
  while (used < total && i < n * 4) {
    out[i % n]! += 1;
    used += 1;
    i += 1;
  }
  return out;
}

export function distribute(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  width: number,
  height: number,
): { colWidths: number[]; rowHeights: number[] } {
  return {
    colWidths: evenSizes(
      colWidths.length,
      width,
      MIN_COL_WIDTH,
    ),
    rowHeights: evenSizes(rowHeights.length, height, MIN_ROW_HEIGHT),
  };
}

export function cellRect(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  row: number,
  column: number,
): CellRect {
  const x = sum(colWidths.slice(0, column));
  const y = sum(rowHeights.slice(0, row));
  return {
    x,
    y,
    width: colWidths[column] ?? 0,
    height: rowHeights[row] ?? 0,
    row,
    column,
  };
}

export function allCellRects(
  colWidths: readonly number[],
  rowHeights: readonly number[],
): CellRect[] {
  const out: CellRect[] = [];
  for (let r = 0; r < rowHeights.length; r++) {
    for (let c = 0; c < colWidths.length; c++) {
      out.push(cellRect(colWidths, rowHeights, r, c));
    }
  }
  return out;
}

export function hitTestCell(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  x: number,
  y: number,
  tolerance = 0,
): CellRect | null {
  const colStarts = offsets(colWidths);
  const rowStarts = offsets(rowHeights);

  const findIndex = (
    starts: readonly number[],
    sizes: readonly number[],
    v: number,
  ): number => {
    for (let i = 0; i < sizes.length; i++) {
      const start = starts[i]!;
      const end = start + sizes[i]!;
      if (v >= start - tolerance && v < end + tolerance) return i;
    }
    return -1;
  };

  const col = findIndex(colStarts, colWidths, x);
  const row = findIndex(rowStarts, rowHeights, y);
  if (col < 0 || row < 0) return null;
  return cellRect(colWidths, rowHeights, row, col);
}

export function cellIndex(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  row: number,
  column: number,
): number {
  return row * colWidths.length + column;
}

export function fromCellIndex(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  index: number,
): { row: number; column: number } | null {
  const cols = colWidths.length;
  if (index < 0 || index >= cols * rowHeights.length) return null;
  return { row: Math.floor(index / cols), column: index % cols };
}

export function scaleSizesProportionally(
  sizes: readonly number[],
  total: number,
  min: number,
): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const current = sum(sizes);
  if (current <= 0 || !Number.isFinite(total) || total <= 0) return [...sizes];

  const target = Math.max(min * n, Math.round(total));
  const exact = sizes.map((s) => (s / current) * target);
  const out = exact.map((v) => Math.max(min, Math.floor(v)));
  const fracs = exact.map((v) => v - Math.floor(v));
  const orderByFraction = (descending: boolean) =>
    exact
      .map((_, i) => i)
      .sort((a, b) => (descending ? fracs[b]! - fracs[a]! : fracs[a]! - fracs[b]!));

  let excess = sum(out) - target;
  if (excess > 0) {
    const order = orderByFraction(false);
    do {
      for (const i of order) {
        if (excess <= 0) break;
        if (out[i]! > min) {
          out[i]! -= 1;
          excess -= 1;
        }
      }

    } while (excess > 0 && out.some((v) => v > min));
    return out;
  }

  const order = orderByFraction(true);
  let remaining = target - sum(out);
  while (remaining > 0 && out.some((_, i) => out[i]! < Math.floor(exact[i]!) + 1)) {
    for (const i of order) {
      if (remaining <= 0) break;
      if (out[i]! < Math.floor(exact[i]!) + 1) {
        out[i]! += 1;
        remaining -= 1;
      }
    }
  }
  return out;
}

export function scaleColWidths(
  colWidths: readonly number[],
  newTotal: number,
  min = MIN_COL_WIDTH,
): number[] {
  if (totalWidth(colWidths) <= 0) return [...colWidths];
  return scaleSizesProportionally(colWidths, newTotal, min);
}

export function scaleRowHeights(
  rowHeights: readonly number[],
  newTotal: number,
  min = MIN_ROW_HEIGHT,
): number[] {
  if (totalHeight(rowHeights) <= 0) return [...rowHeights];
  return scaleSizesProportionally(rowHeights, newTotal, min);
}

export function columnLines(colWidths: readonly number[]): number[] {
  const starts = offsets(colWidths);
  return [...starts, totalWidth(colWidths)];
}

export function rowLines(rowHeights: readonly number[]): number[] {
  const starts = offsets(rowHeights);
  return [...starts, totalHeight(rowHeights)];
}

```

## lib/template/hydrate.ts

```ts


import {
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Textbox,
} from "fabric";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
import { FieldObject, DEFAULT_FIELD } from "@/lib/canvas/objects/BillField";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { evenSizes } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import type {
  BillTemplate,
  FieldObject as FieldObj,
  FreehandObject,
  GroupObject,
  ImagePlaceholderObject as PHObject,
  LineObject,
  PolygonObject,
  ShapeObject,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";
import type { BillPartObject as TemplateBillPart } from "@/lib/template/types";

registerAppProperties();

function applyCommon<T extends FabricObject>(
  obj: T,
  o: TemplateObject,
  zIndex: number,
): T {
  obj.set({
    left: o.x,
    top: o.y,
    originX: "left",
    originY: "top",
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  } as never);
  obj.set({
    id: o.id || createId(),
    name: o.name,
    role: o.role,
    zIndex,
    parentId: o.parentId,
    locked: o.locked,

    appType: o.type,
  } as never);

  const growth = (o as { expansion?: unknown }).expansion;
  if (growth !== undefined) {
    obj.set({ expansion: growth } as never);
  }

  const layoutParentId = (o as { layoutParentId?: unknown }).layoutParentId;
  if (typeof layoutParentId === "string" && layoutParentId.length > 0) {
    obj.set({ layoutParentId } as never);
  }
  const anchor = (o as { anchor?: unknown }).anchor;
  if (anchor !== undefined) {
    obj.set({ anchor } as never);
  }
  const container = (o as { container?: unknown }).container;
  if (container !== undefined) {
    obj.set({ container } as never);
  }
  if (o.locked) {
    (obj as { lockMovementX?: boolean }).lockMovementX = true;
    (obj as { lockMovementY?: boolean }).lockMovementY = true;
    (obj as { lockScalingX?: boolean }).lockScalingX = true;
    (obj as { lockScalingY?: boolean }).lockScalingY = true;
    (obj as { lockRotation?: boolean }).lockRotation = true;
  } else {
    obj.set({ selectable: true, evented: true } as never);
  }
  obj.setCoords();
  return obj;
}

function hydrateText(o: TextObject, zIndex: number): IText | Textbox {
  const info = analysePlaceholders(o.text);
  const common = {
    left: o.x,
    top: o.y,
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle,
    textAlign: o.textAlign,
    lineHeight: o.lineHeight,
    charSpacing: o.charSpacing,
    fill: o.fill === "transparent" ? "#000000" : o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,

    scaleX: typeof o.scaleX === "number" && Number.isFinite(o.scaleX) ? o.scaleX : 1,
    scaleY: typeof o.scaleY === "number" && Number.isFinite(o.scaleY) ? o.scaleY : 1,
  };

  const obj: IText | Textbox =
    typeof o.wrapWidth === "number" && o.wrapWidth > 0
      ? new Textbox(o.text, { ...common, width: o.wrapWidth })
      : new IText(o.text, common);
  (obj as unknown as Record<string, unknown>).roleKind =
    o.roleKind === "variable" ? "variable" : info.roleKind;
  if (o.roleKind === "variable" && info.role && !o.role) {
    (obj as unknown as Record<string, unknown>).role = info.role;
  }
  applyCommon(obj, o, zIndex);

  if (obj instanceof Textbox) {
    obj.set({ width: o.wrapWidth, height: o.height } as never);
    (obj as unknown as Record<string, unknown>).wrapWidth = o.wrapWidth;
  }
  obj.setCoords();
  return obj;
}

function hydrateShape(o: ShapeObject, zIndex: number): Rect | Ellipse {
  const base = {
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  };

  const obj =
    o.type === "ellipse"
      ? new Ellipse({
          ...base,

          rx: o.width / 2,
          ry: o.height / 2,
        })
      : new Rect({
          ...base,
          rx: o.type === "rounded-rect" ? o.cornerRadius || 8 : 0,
          ry: o.type === "rounded-rect" ? o.cornerRadius || 8 : 0,
        });
  return applyCommon(obj, o, zIndex);
}

function hydrateLine(o: LineObject, zIndex: number): Line {
  const obj = new Line([o.x, o.y, o.x2, o.y2], {
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    fill: "transparent",
    originX: "left",
    originY: "top",
  });
  obj.set({ x2: o.x2, y2: o.y2, ruleKind: o.type } as never);
  return applyCommon(obj, o, zIndex);
}

function hydratePolygon(o: PolygonObject, zIndex: number): Polygon | Polyline {
  const points = o.points.map(([px, py]) => ({ x: px, y: py }));
  const obj =
    o.type === "polygon" ? new Polygon(points, {}) : new Polyline(points, {});
  obj.set({
    fill: o.fill === "transparent" ? "rgba(0,0,0,0)" : o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateFreehand(o: FreehandObject, zIndex: number): Path | null {
  if (!o.path) return null;
  const path = new Path(o.path);
  applyCommon(path, o, zIndex);

  const br = path.getBoundingRect();
  const dx = o.x - br.left;
  const dy = o.y - br.top;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    path.set({ left: (path.left ?? 0) + dx, top: (path.top ?? 0) + dy } as never);
  }
  path.setCoords();
  return path;
}

function hydrateTable(o: TableObject, zIndex: number): BillTable {
  const colWidths = o.colWidths?.length
    ? o.colWidths
    : evenSizes(Math.max(1, o.columns), o.width, 8);
  const rowHeights = o.rowHeights?.length
    ? o.rowHeights
    : evenSizes(Math.max(1, o.rows), o.height, 8);
  const table = new BillTable({
    colWidths,
    rowHeights,
    cells: o.cells ?? [],
    borderColor: o.borderColor,
    borderWidth: o.borderWidth,
    cellFill: o.cellFill,
    headerRow: o.headerRow,
    headerFill: o.headerFill,
    headerTextColor: o.headerTextColor,
    cellTextColor: o.cellTextColor,
    padding: o.padding,
    fontFamily: o.fontFamily,
    repeat: o.repeat,
  });
  table.set({
    left: o.x,
    top: o.y,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(table, o, zIndex);
}

function hydrateImagePlaceholder(
  o: PHObject,
  zIndex: number,
  images?: Map<string, FabricImage>,
): FabricObject {

  const src = typeof o.src === "string" ? o.src : undefined;
  const loaded = src !== undefined ? images?.get(src) : undefined;
  if (loaded) {
    const obj = new FabricImage(loaded.getElement() as HTMLImageElement, {
      left: o.x,
      top: o.y,
      originX: "left",
      originY: "top",
      scaleX: o.width / (loaded.width || 1),
      scaleY: o.height / (loaded.height || 1),
    });

    const carried = obj as unknown as Record<string, unknown>;
    carried.placeholderRole = o.placeholderRole;
    carried.label = o.label;
    carried.src = src;
    return applyCommon(obj, o, zIndex);
  }
  const obj = new ImagePlaceholderObject({
    placeholderRole: o.placeholderRole,
    label: o.label,
    borderColor: o.stroke,
    borderWidth: o.strokeWidth,
    fill: o.fill,
  });
  obj.set({
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateField(o: FieldObj, zIndex: number): FieldObject {
  const obj = new FieldObject({
    key: o.key,
    fieldType: o.fieldType,

    label: o.text || `{{${o.key}}}`,
    borderColor: o.stroke,
    borderWidth: o.strokeWidth,

    textColor: o.fill === "transparent" ? DEFAULT_FIELD.textColor : o.fill,
    fill: DEFAULT_FIELD.fill,

    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle,
    textAlign: o.textAlign,
  });
  obj.set({
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateBillPart(
  o: TemplateBillPart,
  zIndex: number,
  images?: Map<string, FabricImage>,
): FabricObject {
  const src = typeof o.src === "string" ? o.src : undefined;
  const obj = new BillPartObject({
    src,
    normalized: o.normalized === true,
    sourceRect: o.sourceRect,

    image: src !== undefined ? (images?.get(src)?.getElement() as HTMLImageElement) : undefined,
  });
  obj.set({
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateGroup(o: GroupObject, zIndex: number): null {

  void o;
  void zIndex;
  return null;
}

export function hydrateObject(
  o: TemplateObject,
  zIndex: number,
  images?: Map<string, FabricImage>,
): FabricObject | null {
  switch (o.type) {
    case "text":
      return hydrateText(o, zIndex);
    case "rect":
    case "rounded-rect":
    case "ellipse":
      return hydrateShape(o, zIndex);
    case "line":
    case "hr":
    case "vr":
      return hydrateLine(o, zIndex);
    case "polygon":
      return hydratePolygon(o, zIndex);
    case "freehand":
      return hydrateFreehand(o, zIndex);
    case "table":
      return hydrateTable(o, zIndex);
    case "image-placeholder":
      return hydrateImagePlaceholder(o, zIndex, images);
    case "field":
      return hydrateField(o, zIndex);
    case "bill-part":
      return hydrateBillPart(o as TemplateBillPart, zIndex, images);
    case "group":
      return hydrateGroup(o, zIndex);
    default:
      return null;
  }
}

export function hydrateTemplate(
  template: BillTemplate,
  images?: Map<string, FabricImage>,
): FabricObject[] {
  const ordered = [...template.objects].sort((a, b) => a.zIndex - b.zIndex);
  const out: FabricObject[] = [];
  ordered.forEach((o, i) => {
    const obj = hydrateObject(o, i, images);
    if (obj) out.push(obj);
  });
  return out;
}

export function makeTextbox(text: string, left: number, top: number): IText {
  return new IText(text, {
    left,
    top,
    fontFamily: "Arial",
    fontSize: 14,
    fill: "#000000",
    stroke: "transparent",
    strokeWidth: 0,
  });
}

export { FabricImage, Textbox };

```

## lib/template/migrate.ts

```ts
import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type LayoutConfig,
  type PlaceholderSpec,
  type TemplateObject,
} from "@/lib/template/types";

export function migrateTemplate(raw: unknown): { template: BillTemplate; notes: string[] } {
  const notes: string[] = [];
  const root =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const claimed = root.templateVersion;
  if (typeof claimed === "number" && claimed > TEMPLATE_VERSION) {
    throw new Error(`template version ${claimed} exceeds the supported ${TEMPLATE_VERSION}`);
  }
  notes.push(
    typeof claimed === "number"
      ? `template read as version ${claimed}, migrated to ${TEMPLATE_VERSION}`
      : `template carried no version, treated as version 1 and migrated to ${TEMPLATE_VERSION}`,
  );

  const doc =
    typeof root.document === "object" && root.document !== null
      ? (root.document as Record<string, unknown>)
      : {};
  const width = typeof doc.width === "number" && doc.width > 0 ? doc.width : A4_WIDTH;
  const height = typeof doc.height === "number" && doc.height > 0 ? doc.height : A4_HEIGHT;
  if (width !== doc.width || height !== doc.height) {
    notes.push(`document size filled in to ${width}x${height}`);
  }

  const meta =
    typeof root.meta === "object" && root.meta !== null
      ? (root.meta as Record<string, unknown>)
      : {};
  const name =
    typeof meta.name === "string" && meta.name.length > 0 ? meta.name : "Untitled bill";
  const modifiedAt = typeof meta.modifiedAt === "string" ? meta.modifiedAt : "";

  const objects: TemplateObject[] = Array.isArray(root.objects)
    ? (root.objects as TemplateObject[])
    : [];

  const { placeholders: rawPlaceholders, ...metaRest } = meta;
  const placeholders = Array.isArray(rawPlaceholders)
    ? (rawPlaceholders as PlaceholderSpec[])
    : undefined;

  const layout =
    typeof root.layout === "object" && root.layout !== null
      ? (root.layout as LayoutConfig)
      : undefined;

  return {
    template: {
      templateVersion: TEMPLATE_VERSION,
      document: { width, height },

      meta: {
        ...metaRest,
        name,
        modifiedAt,
        ...(placeholders === undefined ? {} : { placeholders }),
      },
      objects,
      ...(layout === undefined ? {} : { layout }),
    },
    notes,
  };
}

```

## lib/template/parse.ts

```ts
import { migrateTemplate } from "./migrate";
import { TEMPLATE_VERSION, type BillTemplate } from "./types";

const OBJECT_TYPES = new Set([
  "line", "rect", "rounded-rect", "ellipse", "polygon", "freehand",
  "text", "hr", "vr", "table", "image-placeholder", "field", "group", "bill-part",
]);
const MAX_PAGE_PX = 20_000;
const MAX_OBJECT_COORDINATE = 100_000;
const MAX_OBJECTS = 5_000;

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

```

## lib/template/placeholders.ts

```ts


const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

function tokenRegex(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

export const SUGGESTED_VARIABLES = [
  "company_name",
  "company_address",
  "company_gstin",
  "invoice_number",
  "invoice_date",
  "due_date",
  "customer_name",
  "customer_address",
  "customer_gstin",
  "item_no",
  "item_name",
  "item_description",
  "quantity",
  "price",
  "amount",
  "subtotal",
  "discount",
  "tax",
  "tax_rate",
  "total",
  "amount_in_words",
  "bank_name",
  "account_number",
  "ifsc_code",
  "signature",
] as const;

export interface PlaceholderInfo {

  variables: string[];

  isPureVariable: boolean;

  role: string | null;
  roleKind: "static" | "variable";
}

export function extractVariables(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(tokenRegex())) {
    const name = m[1];
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

export function toToken(name: string): string {
  return `{{${name}}}`;
}

export function hasVariable(text: string): boolean {
  return new RegExp(TOKEN_SOURCE).test(text);
}

export function isDataFieldObject(obj: { appType?: string }): boolean {
  return obj.appType === "field";
}

export function analysePlaceholders(text: string): PlaceholderInfo {
  const variables = extractVariables(text);
  if (variables.length === 0) {
    return {
      variables: [],
      isPureVariable: false,
      role: null,
      roleKind: "static",
    };
  }
  const isPureVariable = variables.length === 1 && toToken(variables[0]) === text.trim();
  return {
    variables,
    isPureVariable,
    role: isPureVariable ? variables[0] : null,
    roleKind: "variable",
  };
}

export function collectDocumentVariables(
  texts: Iterable<string>,
): string[] {
  const all = new Set<string>();
  for (const t of texts) {
    for (const v of extractVariables(t)) all.add(v);
  }
  return [...all].sort();
}

```

## lib/template/preflight.ts

```ts
import { renderHtml, type RenderOptions } from "@/lib/render";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { parseTemplate } from "@/lib/template/parse";
import { collectDocumentVariables, extractVariables } from "@/lib/template/placeholders";
import type { BillTemplate } from "@/lib/template/types";
import { buildPackage } from "@/lib/package/build";
import { validateManifest } from "@/lib/package/validate";

export interface TemplatePreflightIssue {
  severity: "error" | "warning";
  message: string;
  objectId?: string;
  guideId?: string;
}

export interface PreflightOptions {

  sampleValues?: Readonly<Record<string, string>>;
  measurements?: RenderOptions["measurements"];
  remeasure?: RenderOptions["remeasure"];

  maxRepeatItems?: boolean;
}

export function sampleValuesForTemplate(
  template: BillTemplate,
  options: { maxRepeatItems?: boolean } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of extractTemplateFields(template)) {
    if (field.type === "image") continue;
    if (field.type === "date") values[field.key] = "2026-10-17";
    else if (field.type === "number") values[field.key] = String(field.max ?? Math.max(9876543, field.min ?? 0));
    else if (field.type === "currency") values[field.key] = String(field.max ?? Math.max(9876543.21, field.min ?? 0));
    else if (field.type === "tickmark") values[field.key] = "✓";
    else if (field.type === "checkbox") values[field.key] = "true";
    else values[field.key] = "Northwind Trading Company — Industrial Supplies and Distribution";

    const maxLength = template.meta?.placeholders?.find((spec) => spec.key === field.key)?.maxLength;
    if (field.type === "text" && typeof maxLength === "number" && maxLength > 0) {
      values[field.key] = "W".repeat(Math.min(maxLength, 120));
    }
  }

  for (const table of template.objects) {
    if (table.type !== "table" || !table.repeat) continue;
    const keys = new Set<string>();
    for (let row = table.repeat.startRow; row <= table.repeat.endRow; row += 1) {
      for (let col = 0; col < table.columns; col += 1) {
        for (const key of extractVariables(table.cells[row * table.columns + col]?.text ?? "")) keys.add(key);
      }
    }
    const maxItems = typeof table.repeat.maxItems === "number" ? table.repeat.maxItems : 20;
    const count = Math.max(0, Math.min(options.maxRepeatItems ? 200 : 3, maxItems));
    const rows = Array.from({ length: count }, (_, index) => Object.fromEntries(
      [...keys].map((key) => [key, /amount|price|rate|weight|qty|quantity|count/i.test(key)
        ? (index === 0 ? "9876543.21" : "123456.78")
        : `Industrial equipment and supplies — sample line ${index + 1}`]),
    ));
    values[table.repeat.key] = JSON.stringify(rows);
  }
  return values;
}

export function preflightTemplate(template: BillTemplate, options: PreflightOptions = {}): TemplatePreflightIssue[] {
  try {
    parseTemplate(template);
  } catch (error) {
    return [{
      severity: "error",
      message: error instanceof Error ? error.message : "The template is not valid.",
    }];
  }

  const issues: TemplatePreflightIssue[] = [];
  for (const object of template.objects) {
    const outside = object.x < 0 || object.y < 0 ||
      object.x + object.width > template.document.width ||
      object.y + object.height > template.document.height;
    if (outside) {
      issues.push({
        severity: "warning",
        objectId: object.id,
        message: `${object.name} extends beyond the page and may be clipped in print.`,
      });
    }
  }

  const fields = extractTemplateFields(template);
  const hasRepeatingTable = template.objects.some((object) => object.type === "table" && object.repeat);
  const hasTaxOrDiscount = fields.some((field) => /^(tax|discount)(_|$)/i.test(field.key));
  if (hasRepeatingTable && hasTaxOrDiscount && !computedSpecsFor(template).some((spec) => spec.key === "total")) {
    issues.push({
      severity: "warning",
      message: "This bill has tax or discount fields. Check the final total manually; those amounts are not included in the automatic subtotal.",
    });
  }
  const usedKeys = new Set(fields.map((field) => field.key));
  for (const spec of template.meta?.placeholders ?? []) {
    if (!usedKeys.has(spec.key)) {
      issues.push({ severity: "warning", message: `Field settings for “${spec.key}” are unused.` });
    }
  }

  const computed = computedSpecsFor(template);
  if (template.meta?.computed?.length) {
    try {
      const candidate = buildPackage(template, { computed });
      for (const problem of validateManifest(candidate.manifest, candidate.files).filter((item) => item.path.startsWith("computed"))) {
        const key = /^computed\[(\d+)\]/.exec(problem.path)?.[1];
        const outputKey = key === undefined ? undefined : computed[Number(key)]?.key;
        const object = outputKey ? template.objects.find((item) =>
          item.type === "text" || item.type === "field"
            ? extractVariables(item.text).includes(outputKey)
            : item.type === "table" && item.cells.some((cell) => extractVariables(cell.text).includes(outputKey)),
        ) : undefined;
        issues.push({
          severity: "error",
          ...(object ? { objectId: object.id } : {}),
          message: `Calculation setup: ${problem.path} — ${problem.message}`,
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        message: `Calculations could not be checked: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const rendered = renderHtml(template, {}, { placeholders: "show", computed });
  for (const refusal of rendered.refusals) {
    issues.push({
      severity: "warning",
      message: `${refusal.field}: ${refusal.reason} (value “${refusal.value}”).`,
    });
  }
  for (const warning of rendered.warnings) {
    issues.push({ severity: "warning", message: warning });
  }

  const unresolved = collectDocumentVariables(template.objects.flatMap((object) =>
    object.type === "text" || object.type === "field"
      ? [object.text]
      : object.type === "table"
        ? object.cells.map((cell) => cell.text)
        : [],
  ));
  for (const key of unresolved) {
    const object = template.objects.find((candidate) =>
      candidate.type === "text" || candidate.type === "field"
        ? extractVariables(candidate.text).includes(key)
        : candidate.type === "table" && candidate.cells.some((cell) => extractVariables(cell.text).includes(key)),
    );
    issues.push({
      severity: "warning",
      ...(object ? { objectId: object.id } : {}),
      message: `Dynamic field “${key}” needs a sample answer to confirm its final fit.`,
    });
  }

  if (options.sampleValues) {
    const sample = renderHtml(template, options.sampleValues, {
      placeholders: "hide",
      computed,
      measurements: options.measurements,
      remeasure: options.remeasure,
    });
    for (const warning of sample.warnings) {
      const quoted = [...warning.matchAll(/"([^\"]+)"/g)].map((match) => match[1]!);
      const guideId = /guide "([^\"]+)"/.exec(warning)?.[1];
      const objectId = quoted.find((candidate) => template.objects.some((object) => object.id === candidate))
        ?? (quoted[0] && template.layout?.attachments?.find((attachment) => attachment.id === quoted[0])?.objectId);
      issues.push({
        severity: "warning",
        ...(objectId ? { objectId } : {}),
        ...(guideId && template.layout?.guides?.some((guide) => guide.id === guideId) ? { guideId } : {}),
        message: `Sample values: ${warning}`,
      });
    }
    if (sample.page.width !== template.document.width || sample.page.height !== template.document.height) {
      issues.push({
        severity: "warning",
        message: `Sample values grow the printed page to ${Math.round(sample.page.width)} × ${Math.round(sample.page.height)} px. Check that size before printing.`,
      });
    }
  }
  return issues;
}

```

## lib/template/serialize.ts

```ts


import { cellIndex } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import {
  DEFAULT_REPEAT_MAX_ITEMS,
  TEMPLATE_VERSION,
} from "@/lib/template/types";
import type {
  AxisExpansion,
  BillPartObject,
  BillTemplate,
  ContainerPolicy,
  FieldObject,
  FreehandObject,
  GroupObject,
  ImagePlaceholderObject,
  LayoutConfig,
  LineObject,
  ObjectExpansion,
  PolygonObject,
  ShapeObject,
  SourceRect,
  TableCell,
  TableObject,
  TableRepeat,
  TemplateObject,
  TemplateObjectBase,
  TextObject,
} from "@/lib/template/types";

export interface SerialisableObject {
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  stroke?: string | null;
  strokeWidth?: number;
  fill?: string | null;
  selectable?: boolean;
  editable?: boolean;
  getScaledWidth?: () => number;
  getScaledHeight?: () => number;
  getCenterPoint?: () => { x: number; y: number };
  getPositionByOrigin?: (originX: string, originY: string) => { x: number; y: number };
  getPointByOrigin?: (originX: string, originY: string) => { x: number; y: number };
  getObjects?: () => SerialisableObject[];
  readonly [key: string]: unknown;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

function pathData(commands: unknown): string {
  if (!Array.isArray(commands)) return "";
  return commands
    .filter((c): c is unknown[] => Array.isArray(c) && typeof c[0] === "string")
    .map((c) => `${c[0]} ${c.slice(1).join(" ")}`)
    .join(" ");
}

export function objectBox(o: SerialisableObject): {
  x: number;
  y: number;
  width: number;
  height: number;
} {

  const w = num(o.width) * num(o.scaleX, 1);
  const h = num(o.height) * num(o.scaleY, 1);

  const corner = o.getPositionByOrigin?.("left", "top") ?? o.getPointByOrigin?.("left", "top");
  if (corner) {
    return {
      x: Math.round(corner.x * 100) / 100,
      y: Math.round(corner.y * 100) / 100,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
    };
  }
  const center = o.getCenterPoint?.();
  if (center) {
    return {
      x: Math.round((center.x - w / 2) * 100) / 100,
      y: Math.round((center.y - h / 2) * 100) / 100,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
    };
  }
  return {
    x: num(o.left),
    y: num(o.top),
    width: Math.round(w * 100) / 100,
    height: Math.round(h * 100) / 100,
  };
}

function baseFields(
  o: SerialisableObject,
  zIndex: number,
): Omit<TemplateObjectBase, "type"> {
  const box = objectBox(o);
  const id = str(o.id, `obj_${zIndex}`);
  const rawName = str(o.name, "");

  const layoutParentId =
    typeof o.layoutParentId === "string" && o.layoutParentId.length > 0
      ? o.layoutParentId
      : null;
  const anchor =
    typeof o.anchor === "object" && o.anchor !== null
      ? (o.anchor as TemplateObjectBase["anchor"])
      : undefined;
  return {
    id,
    name: rawName || defaultName(o.type, zIndex),
    role: typeof o.role === "string" ? o.role : null,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: num(o.angle),
    opacity: num(o.opacity, 1),
    visible: o.visible !== false,
    locked: o.locked === true || o.selectable === false,
    zIndex,
    parentId: typeof o.parentId === "string" ? o.parentId : null,
    layoutParentId,
    ...(anchor === undefined ? {} : { anchor }),
    stroke: str(o.stroke, "#000000") || "#000000",
    strokeWidth: num(o.strokeWidth, 1),
    fill: str(o.fill, "transparent") || "transparent",
  };
}

function readExpansion(v: unknown): ObjectExpansion | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as { x?: unknown; y?: unknown };
  const axis = (a: unknown): AxisExpansion | undefined => {
    if (typeof a !== "object" || a === null) return undefined;
    const rec = a as Record<string, unknown>;
    const mode = rec.mode;
    if (mode !== "fixed" && mode !== "bounded" && mode !== "unbounded") return undefined;
    const out: AxisExpansion = { mode };
    if (typeof rec.maxGrowth === "number" && Number.isFinite(rec.maxGrowth)) {
      out.maxGrowth = rec.maxGrowth;
    }
    if (typeof rec.growthGuideId === "string" && rec.growthGuideId.length > 0) {
      out.growthGuideId = rec.growthGuideId;
    }
    if (rec.strategy === "wrap" || rec.strategy === "noWrap") {
      out.strategy = rec.strategy;
    }
    return out;
  };
  const x = axis(raw.x);
  const y = axis(raw.y);
  if (!x || !y) return undefined;
  return { x, y };
}

function readContainer(v: unknown): ContainerPolicy | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as Record<string, unknown>;
  if (raw.enabled !== true) return undefined;
  const out: ContainerPolicy = { enabled: true };
  if (raw.growthX === "fixed" || raw.growthX === "content") out.growthX = raw.growthX;
  if (raw.growthY === "fixed" || raw.growthY === "content") out.growthY = raw.growthY;
  const pad = raw.padding;
  if (typeof pad === "object" && pad !== null) {
    const p = pad as Record<string, unknown>;
    const side = (k: string): number | undefined => {
      const n = p[k];
      return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const top = side("top");
    const right = side("right");
    const bottom = side("bottom");
    const left = side("left");
    if (top !== undefined || right !== undefined || bottom !== undefined || left !== undefined) {
      out.padding = {
        top: top ?? 0,
        right: right ?? 0,
        bottom: bottom ?? 0,
        left: left ?? 0,
      };
    }
  }
  for (const k of ["minWidth", "minHeight", "maxWidth", "maxHeight"] as const) {
    const n = raw[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function defaultName(type: string, index: number): string {
  const labels: Record<string, string> = {
    line: "Line",
    hr: "Horizontal Rule",
    vr: "Vertical Rule",
    rect: "Rectangle",
    "rounded-rect": "Rounded Rectangle",
    ellipse: "Ellipse",
    polygon: "Polygon",
    freehand: "Freehand",
    text: "Text",
    table: "Table",
    "image-placeholder": "Image Placeholder",
    "bill-part": "Bill Part",
    group: "Group",
    iText: "Text",
    textbox: "Text",
  };
  return `${labels[type] ?? "Object"} ${index + 1}`;
}

function readPoints(o: SerialisableObject): Array<[number, number]> {
  const raw = o.points;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        return [num(p[0]), num(p[1])] as [number, number];
      }
      if (p && typeof p === "object") {
        const q = p as { x?: unknown; y?: unknown };
        return [num(q.x), num(q.y)] as [number, number];
      }
      return null;
    })
    .filter((p): p is [number, number] => p !== null);
}

function serialiseRepeat(raw: unknown): TableRepeat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const key = r.key;
  if (typeof key !== "string" || key.trim().length === 0) return undefined;
  const startRow = r.startRow;
  const endRow = r.endRow;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return undefined;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return undefined;
  const maxItems =
    typeof r.maxItems === "number" && Number.isInteger(r.maxItems) && r.maxItems > 0
      ? r.maxItems
      : DEFAULT_REPEAT_MAX_ITEMS;
  return {
    startRow,
    endRow,
    key: key.trim(),
    ...(r.repeatHeader === true ? { repeatHeader: true } : {}),
    maxItems,
  };
}

function serialiseTable(
  o: SerialisableObject,
  zIndex: number,
): TableObject {
  const base = baseFields(o, zIndex);
  const colWidths = Array.isArray(o.colWidths)
    ? (o.colWidths as number[]).map((n) => num(n, 40))
    : [base.width / 2, base.width / 2];
  const rowHeights = Array.isArray(o.rowHeights)
    ? (o.rowHeights as number[]).map((n) => num(n, 24))
    : [base.height / 2, base.height / 2];
const rawCells = Array.isArray(o.cells) ? (o.cells as TableCell[]) : [];
    const repeat = serialiseRepeat((o as unknown as { repeat?: unknown }).repeat);

    const rawExpansion = readExpansion((o as unknown as { expansion?: unknown }).expansion);
    const rowPolicy = rawExpansion?.y ? { x: { mode: "fixed" as const }, y: rawExpansion.y } : undefined;
  const count = colWidths.length * rowHeights.length;
  const cells: TableCell[] = [];
  for (let i = 0; i < count; i++) {
    const c = rawCells[i];
    cells.push({
      text: str(c?.text, ""),
      textAlign: (c?.textAlign ?? "left") as TableCell["textAlign"],
      fontSize: num(c?.fontSize, 12),
      fontWeight: (c?.fontWeight ?? "normal") as TableCell["fontWeight"],
      ...(typeof c?.color === "string" && c.color.length > 0 ? { color: c.color } : {}),
    });
  }
  return {
    ...base,
    type: "table",
    rows: rowHeights.length,
    columns: colWidths.length,
    colWidths,
    rowHeights,
    cells,
    borderColor: str(o.borderColor, "#000000"),
    borderWidth: num(o.borderWidth, 1),
    cellFill: str(o.cellFill, "transparent"),
    headerRow: o.headerRow !== false,
    headerFill: str(o.headerFill, "transparent"),
    headerTextColor: str(o.headerTextColor, "#000000"),
    cellTextColor: str(o.cellTextColor, "#000000"),
padding: num(o.padding, 4),
      fontFamily: str(o.fontFamily, "Arial"),

      ...(rowPolicy ? { expansion: rowPolicy } : {}),
      ...(repeat ? { repeat } : {}),
    };
  }

function serialiseText(o: SerialisableObject, zIndex: number): TextObject {
  const base = baseFields(o, zIndex);
  const text = str(o.text, "");
  const info = analysePlaceholders(text);

  const scaleX = num(o.scaleX, 1);
  const scaleY = num(o.scaleY, 1);
  const growth = readExpansion(o.expansion);
  return {
    ...base,
    type: "text",
    text,
    width: Math.round(num(o.width) * 100) / 100,
    height: Math.round(num(o.height) * 100) / 100,
    scaleX,
    scaleY,
    fontFamily: str(o.fontFamily, "Arial"),
    fontSize: num(o.fontSize, 14),
    fontWeight:
      str(o.fontWeight, "normal") === "bold" ||
      num(o.fontWeight, 400) >= 600
        ? "bold"
        : "normal",
    fontStyle: str(o.fontStyle, "normal") === "italic" ? "italic" : "normal",
    textAlign: (str(o.textAlign, "left") as TextObject["textAlign"]),
    lineHeight: num(o.lineHeight, 1.16),
    charSpacing: num(o.charSpacing, 0),
    roleKind: str(o.roleKind) === "variable" ? "variable" : info.roleKind,
    textVerticalAlign: (str(
      o.textVerticalAlign,
      "top",
    ) as TextObject["textVerticalAlign"]),

    ...(num(o.wrapWidth) > 0 ? { wrapWidth: num(o.wrapWidth) } : {}),
    ...(growth === undefined ? {} : { expansion: growth }),
  };
}

function serialiseImagePlaceholder(
  o: SerialisableObject,
  zIndex: number,
): ImagePlaceholderObject {
  const out: ImagePlaceholderObject = {
    ...baseFields(o, zIndex),
    type: "image-placeholder",
    placeholderRole: str(
      o.placeholderRole,
      "image",
    ) as ImagePlaceholderObject["placeholderRole"],
    label: str(o.label, "IMAGE"),
  };

  if (typeof o.src === "string" && o.src.length > 0) out.src = o.src;
  return out;
}

function serialiseBillPart(
  o: SerialisableObject,
  zIndex: number,
): BillPartObject {
  const sourceRect =
    o.sourceRect &&
    typeof o.sourceRect === "object" &&
    typeof (o.sourceRect as SourceRect).x === "number" &&
    typeof (o.sourceRect as SourceRect).y === "number" &&
    typeof (o.sourceRect as SourceRect).width === "number" &&
    typeof (o.sourceRect as SourceRect).height === "number"
      ? (o.sourceRect as SourceRect)
      : undefined;
  return {
    ...baseFields(o, zIndex),
    type: "bill-part",
    ...(typeof o.src === "string" && o.src.length > 0 ? { src: o.src } : {}),
    normalized: o.normalized === true,
    ...(sourceRect ? { sourceRect } : {}),
  };
}

function serialiseField(o: SerialisableObject, zIndex: number): FieldObject {
  const key = str(o.key, "field");
  const growth = readExpansion(o.expansion);
  return {
    ...baseFields(o, zIndex),
    type: "field",

    fill: str(o.textColor, "#000000") || "#000000",
    key,
    fieldType: str(o.fieldType, "text") as FieldObject["fieldType"],
    text: `{{${key}}}`,
    fontFamily: str(o.fontFamily, "Arial"),
    fontSize: num(o.fontSize, 14),
    fontWeight: str(o.fontWeight, "normal") === "bold" ? "bold" : "normal",
    fontStyle: str(o.fontStyle, "normal") === "italic" ? "italic" : "normal",
    textAlign: (str(o.textAlign, "left") as FieldObject["textAlign"]),
    lineHeight: num(o.lineHeight, 1.16),
    charSpacing: num(o.charSpacing, 0),
    roleKind: "variable",
    textVerticalAlign: "top",
    ...(growth === undefined ? {} : { expansion: growth }),
  };
}

function serialiseLine(o: SerialisableObject, zIndex: number): LineObject {
  const base = baseFields(o, zIndex);

  const x1 = num(o.left);
  const y1 = num(o.top);
  const x2 = num(o.x2, x1 + base.width);
  const y2 = num(o.y2, y1 + base.height);

  const kind = str(o.ruleKind, "") || str(o.appType, "") || o.type;
  const type: LineObject["type"] =
    kind === "hr" ? "hr" : kind === "vr" ? "vr" : "line";

  const endX = type === "vr" ? x1 : x2;
  const endY = type === "hr" ? y1 : y2;
  return {
    ...base,
    x: x1,
    y: y1,
    width: Math.round((endX - x1) * 100) / 100,
    height: Math.round((endY - y1) * 100) / 100,
    type,
    x2: endX,
    y2: endY,
  };
}

function serialisePolygon(
  o: SerialisableObject,
  zIndex: number,
): PolygonObject {
  const base = baseFields(o, zIndex);
  return {
    ...base,
    type: "polygon",
    points: readPoints(o).map(([px, py]) => [
      Math.round((px - base.x) * 100) / 100,
      Math.round((py - base.y) * 100) / 100,
    ]),
  };
}

function serialiseFreehand(
  o: SerialisableObject,
  zIndex: number,
): FreehandObject {
  return {
    ...baseFields(o, zIndex),
    type: "freehand",
    path: pathData(o.path),
  };
}

function serialiseGroup(o: SerialisableObject, zIndex: number): GroupObject {
  return { ...baseFields(o, zIndex), type: "group" };
}

export function serialiseObject(
  o: SerialisableObject,
  zIndex: number,
): TemplateObject | null {

  const type = (str(o.appType, "") || o.type).toLowerCase();
  switch (type) {
    case "table":
      return serialiseTable(o, zIndex);
    case "image-placeholder":
      return serialiseImagePlaceholder(o, zIndex);
    case "bill-part":
      return serialiseBillPart(o, zIndex);
    case "field":
      return serialiseField(o, zIndex);
    case "itext":
    case "textbox":
    case "text":
      return serialiseText(o, zIndex);
    case "line":
    case "hr":
    case "vr":
      return serialiseLine(o, zIndex);
    case "polygon":
    case "polyline":
      return serialisePolygon(o, zIndex);
    case "path":
    case "freehand":
      return serialiseFreehand(o, zIndex);
    case "rect":
    case "rounded-rect":
    case "ellipse":
    case "circle": {
      const base = baseFields(o, zIndex);

      const growth = readExpansion(o.expansion);
      const container = readContainer(o.container);
      return {
        ...base,
        type:
          type === "circle"
            ? "ellipse"
            : type === "rounded-rect"
              ? "rounded-rect"
              : (type as ShapeObject["type"]),
        cornerRadius: num(o.rx, 0),
        ...(growth === undefined ? {} : { expansion: growth }),
        ...(container === undefined ? {} : { container }),
      };
    }
    case "group":
    case "activeselection":
      return serialiseGroup(o, zIndex);
    default:
      return null;
  }
}

export function serialiseObjects(
  objects: readonly SerialisableObject[],
  doc: { width: number; height: number },
  name: string,
  layout?: LayoutConfig,
): BillTemplate {
  const out: TemplateObject[] = [];
  for (const o of objects) {
    const serialised = serialiseObject(o, out.length);
    if (serialised) out.push(serialised);
  }
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width: doc.width, height: doc.height },
    meta: { name, modifiedAt: new Date().toISOString() },
    objects: out,

    ...(layout === undefined ? {} : { layout }),
  };
}

export { cellIndex };

```

## lib/template/types.ts

```ts


import type { ComputedSpec } from "@/lib/package/format";

export const TEMPLATE_VERSION = 2 as const;

export type ObjectType =
  | "line"
  | "rect"
  | "rounded-rect"
  | "ellipse"
  | "polygon"
  | "freehand"
  | "text"
  | "hr"
  | "vr"
  | "table"
  | "image-placeholder"
  | "field"
  | "group"
  | "bill-part";

export interface TemplateObjectBase {
  id: string;
  type: ObjectType;

  name: string;

  role: string | null;

  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;

  zIndex: number;

  parentId: string | null;

  layoutParentId?: string | null;

  anchor?: ChildAnchor;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export interface LineObject extends TemplateObjectBase {
  type: "line" | "hr" | "vr";

  x2: number;
  y2: number;
}

export interface ShapeObject extends TemplateObjectBase {
  type: "rect" | "rounded-rect" | "ellipse";

  cornerRadius: number;

  expansion?: ObjectExpansion;

  container?: ContainerPolicy;
}

export interface PolygonObject extends TemplateObjectBase {
  type: "polygon";

  points: Array<[number, number]>;
}

export interface FreehandObject extends TemplateObjectBase {
  type: "freehand";

  path: string;
}

export type TextAlign = "left" | "center" | "right";
export type TextRoleKind = "static" | "variable";

export interface TextObject extends TemplateObjectBase {
  type: "text";

  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: TextAlign;
  lineHeight: number;
  charSpacing: number;

  roleKind: TextRoleKind;

  textVerticalAlign: "top" | "middle" | "bottom";

  wrapWidth?: number;

  scaleX?: number;
  scaleY?: number;

  expansion?: ObjectExpansion;
}

export interface TableCell {
  text: string;
  textAlign: TextAlign;
  fontSize: number;
  fontWeight: "normal" | "bold";

  color?: string;
}

export interface TableRepeat {

  startRow: number;

  endRow: number;

  key: string;

  repeatHeader?: boolean;

  maxItems?: number;
}

export const DEFAULT_REPEAT_MAX_ITEMS = 200;

export interface TableObject extends TemplateObjectBase {
  type: "table";
  rows: number;
  columns: number;

  colWidths: number[];

  rowHeights: number[];

  cells: TableCell[];
  borderColor: string;
  borderWidth: number;

  cellFill: string;
  headerRow: boolean;
  headerFill: string;
  headerTextColor: string;
  cellTextColor: string;
  padding: number;
  fontFamily: string;

  expansion?: ObjectExpansion;
  repeat?: TableRepeat;
}

export type ImagePlaceholderRole =
  | "logo"
  | "qr"
  | "stamp"
  | "signature"
  | "product"
  | "image";

export interface ImagePlaceholderObject extends TemplateObjectBase {
  type: "image-placeholder";
  placeholderRole: ImagePlaceholderRole;
  label: string;

  src?: string;
}

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BillPartObject extends TemplateObjectBase {
  type: "bill-part";

  src?: string;
  normalized?: boolean;
  sourceRect?: SourceRect;
}

export interface GroupObject extends TemplateObjectBase {
  type: "group";
}

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox";

export interface FieldObject extends TemplateObjectBase {
  type: "field";

  key: string;

  fieldType: FieldType;

  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: TextAlign;
  lineHeight: number;
  charSpacing: number;
  roleKind: "variable";
  textVerticalAlign: "top";

  expansion?: ObjectExpansion;
}

export type TemplateObject =
  | LineObject
  | ShapeObject
  | PolygonObject
  | FreehandObject
  | TextObject
  | TableObject
  | ImagePlaceholderObject
  | BillPartObject
  | FieldObject
  | GroupObject;

export interface TemplateDocument {
  width: number;
  height: number;
}

export type PlaceholderType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox";

export interface PlaceholderSpec {

  key: string;

  label?: string;

  type?: PlaceholderType;

  required?: boolean;

  defaultValue?: string;

  maxLength?: number;

  min?: number;
  max?: number;

  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  color?: string;
}

export interface TemplateMeta {
  name: string;

  modifiedAt: string;

  placeholders?: PlaceholderSpec[];

  computed?: ComputedSpec[];
}

export type GrowthMode = "fixed" | "bounded" | "unbounded";

export type TextWrapPolicy = "wrap" | "noWrap";

export interface AxisExpansion {
  mode: GrowthMode;

  maxGrowth?: number;

  growthGuideId?: string;

  strategy?: TextWrapPolicy;
}

export interface ObjectExpansion {
  x: AxisExpansion;
  y: AxisExpansion;
}

export interface LayoutGuide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;

  maxDisplacement?: number;
}

export type AttachmentEdge = "left" | "right" | "top" | "bottom";

export type AttachmentBehavior = "move" | "stretch";

export interface GuideAttachment {
  id: string;
  objectId: string;

  edge: AttachmentEdge;
  guideId: string;
  behavior: AttachmentBehavior;
}

export type DocumentGrowth = "fixed" | "expand";

export interface DocumentLayoutPolicy {
  growthX: DocumentGrowth;
  growthY: DocumentGrowth;

  maxWidth?: number;
  maxHeight?: number;
}

export type AnchorRule = "start" | "end" | "stretch";

export interface ChildAnchor {
  horizontal?: AnchorRule;
  vertical?: AnchorRule;
  leftOffset?: number;
  rightOffset?: number;
  topOffset?: number;
  bottomOffset?: number;
}

export type ContainerGrowth = "fixed" | "content";

export interface ContainerPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ContainerPolicy {
  enabled: boolean;
  growthX?: ContainerGrowth;
  growthY?: ContainerGrowth;
  padding?: ContainerPadding;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export type CollisionPolicy = "report" | "allow";

export interface LayoutConfig {

  mode: "fixed" | "variable";
  document?: DocumentLayoutPolicy;
  guides?: LayoutGuide[];
  attachments?: GuideAttachment[];

  collision?: CollisionPolicy;
}

export interface BillTemplate {
  templateVersion: typeof TEMPLATE_VERSION;
  document: TemplateDocument;
  meta: TemplateMeta;

  objects: TemplateObject[];

  layout?: LayoutConfig;
}

export const A4_WIDTH = 794;
export const A4_HEIGHT = 1123;

export function isTextObject(o: TemplateObject): o is TextObject {
  return o.type === "text";
}

export function isTableObject(o: TemplateObject): o is TableObject {
  return o.type === "table";
}

export function isImagePlaceholder(
  o: TemplateObject,
): o is ImagePlaceholderObject {
  return o.type === "image-placeholder";
}

export function isFieldObject(o: TemplateObject): o is FieldObject {
  return o.type === "field";
}

export function isLineLike(
  o: TemplateObject,
): o is LineObject {
  return o.type === "line" || o.type === "hr" || o.type === "vr";
}

export function emptyTemplate(
  width = A4_WIDTH,
  height = A4_HEIGHT,
  name = "Untitled bill template",
): BillTemplate {
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width, height },
    meta: { name, modifiedAt: "" },
    objects: [],
  };
}

```

## public/billkit.js

```js
"use strict";(()=>{var Vt="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";function Ht(){return new RegExp(Vt,"g")}function Ie(e){let t=[];for(let n of e.matchAll(Ht())){let r=n[1];r&&!t.includes(r)&&t.push(r)}return t}function pt(e){let t=new Set;for(let n of e)for(let r of Ie(n))t.add(r);return[...t].sort()}var qt={text:"Text fields",field:"Text fields",table:"Table cells","image-placeholder":"Images & signatures"};function Dt(e,t,n){var c;let r=typeof e.columns=="number"&&e.columns>0?e.columns:1,o=Array.isArray(e.cells)?e.cells:[],s=[];for(let d=t;d<=n;d+=1)for(let m=0;m<r;m+=1){let i=(c=o[d*r+m])==null?void 0:c.text;if(typeof i=="string")for(let l of Ie(i))s.includes(l)||s.push(l)}return s}function Yt(e){let t=[],n=e&&Array.isArray(e.objects)?e.objects:[];for(let r of n){if(r.type!=="table")continue;let o=r.repeat;!o||typeof o.key!="string"||o.key.trim().length===0||t.push({key:o.key.trim(),objectName:r.name,columns:Dt(r,o.startRow,o.endRow),maxItems:typeof o.maxItems=="number"&&o.maxItems>0?o.maxItems:200})}return t}function ht(e,t){var m;let n=Array.isArray(e==null?void 0:e.fields)?e.fields.filter(i=>!!i&&typeof i.key=="string"&&i.key.length>0).map(i=>({key:i.key,label:typeof i.label=="string"&&i.label.length>0?i.label:i.key,type:i.type,source:i.source,objectName:typeof i.objectName=="string"?i.objectName:"",...typeof i.maxLength=="number"?{maxLength:i.maxLength}:{},...i.required===!0?{required:!0}:{},...typeof i.defaultValue=="string"?{defaultValue:i.defaultValue}:{},...typeof i.pattern=="string"?{pattern:i.pattern}:{},...typeof i.min=="number"?{min:i.min}:{},...typeof i.max=="number"?{max:i.max}:{},...Array.isArray(i.options)?{options:i.options}:{}})):[],r=Yt(t),o=[...n.filter(i=>!r.some(l=>l.key===i.key)),...r.map(i=>({key:i.key,label:i.objectName||i.key,type:"repeating",source:"table",objectName:i.objectName}))],s=["Text fields","Table cells","Images & signatures"],c=new Map;for(let i of o){let l=(m=qt[i.source])!=null?m:"Other fields",u=c.get(l);u?u.push(i):c.set(l,[i])}let d=[];for(let i of s){let l=c.get(i);l&&l.length>0&&d.push({title:i,fields:l})}for(let[i,l]of c)!s.includes(i)&&l.length>0&&d.push({title:i,fields:l});return{groups:d,fields:o,repeats:r,computed:Array.isArray(e==null?void 0:e.computed)?e.computed:[]}}function Ne(e){return e===null?"null":Array.isArray(e)?`[${e.map(Ne).join(",")}]`:typeof e=="number"?Number.isFinite(e)?String(e):"null":typeof e=="boolean"?e?"true":"false":typeof e=="string"?JSON.stringify(e):typeof e=="object"?`{${Object.entries(e).filter(([,n])=>n!==void 0).sort(([n],[r])=>n<r?-1:n>r?1:0).map(([n,r])=>`${JSON.stringify(n)}:${Ne(r)}`).join(",")}}`:"null"}var Xe=e=>Number.isInteger(e)&&e>=0&&e<=6?e:2,Xt=e=>e!==void 0&&e>="0"&&e<="9",xt=/^(-?)(\d*)(?:\.(\d*))?$/;function Ut(e){if(xt.test(e))return e;for(let t=0;t<e.length;t+=1){if(!Xt(e[t]))continue;let n=t>0&&e[t-1]==="-";return e.slice(n?t-1:t)}return""}function Ee(e,t){var u,$;let n=Xe(t);if(typeof e!="string"&&typeof e!="number")return 0;let r=typeof e=="number"?String(e):e,o=Ut(r.replace(/,/g,"").replace(/\s+/g,"")),s=xt.exec(o);if(!s)return 0;let c=s[1]==="-"?-1:1,d=s[2]&&s[2].length>0?s[2]:"0",m=(u=s[3])!=null?u:"";if(m.length>n){let T=m.slice(0,n).padEnd(n,"0"),R=Number(($=m[n])!=null?$:"0"),g=Number(n===0?d:`${d}${T}`)||0,h=R>=5?g+1:g;return Number.isSafeInteger(h)?c*h:0}let i=n===0?d:`${d}${m.padEnd(n,"0")}`,l=Number(i);return Number.isSafeInteger(l)?c*l:0}function Kt(e,t){let n=Xe(t),r=Math.abs(Math.round(e)),o=e<0?"-":"";if(n===0)return`${o}${r}`;let s=10**n;return`${o}${Math.floor(r/s)}.${String(r%s).padStart(n,"0")}`}function Ue(e,t){let n=e[t];if(typeof n!="string"||n.length===0)return[];try{let r=JSON.parse(n);return Array.isArray(r)?r.filter(o=>typeof o=="object"&&o!==null&&!Array.isArray(o)):[]}catch{return[]}}var bt=new WeakMap;function Ve(e,t){let n=bt.get(e);return n||(n={rows:Object.create(null)},bt.set(e,n)),n.rows[t]||(n.rows[t]=Ue(e,t)),n.rows[t]}var Ke=(e,t)=>Object.prototype.hasOwnProperty.call(e,t);function Ce(e,t,n,r){return Ke(n,e)?n[e]:Ee(t[e],r)}var He=(e,t,n)=>Ke(n,e)||Object.prototype.hasOwnProperty.call(t,e);function qe(e,t,n,r,o){if(o===void 0)return Ce(e,t,n,r);let s=e.indexOf(".");return s<=0?Ee(o[e],r):Ee(o[e.slice(s+1)],r)}var De=e=>{let t=e.indexOf(".");return t>0?[e.slice(0,t),e.slice(t+1)]:["",e]};function Ye(e,t,n){let r=e*t;return Number.isSafeInteger(r)?Math.round(r/n):0}function Jt(e,t,n,r){return e===void 0?0:Ke(n,e)?n[e]*10**(6-r):Ee(t[e],6)}function Pe(e,t,n){let r=Xe(n),o=Object.create(null),s=Object.create(null);for(let c of e){if(!c||typeof c.key!="string"||c.key.length===0)continue;let d=Array.isArray(c.args)?c.args.filter(i=>typeof i=="string"):[],m=0;switch(c.op){case"sum":{for(let i of d){let[l]=De(i);if(l&&!He(i,t,o))for(let u of Ve(t,l))m+=qe(i,t,o,r,u);else m+=Ce(i,t,o,r)}break}case"sum-times":{let[i,l]=d;if(i&&l){let[u]=De(i),[$]=De(l),T=He(i,t,o),R=He(l,t,o),g=!T&&u?Ve(t,u):[],h=!R&&$?Ve(t,$):[],S=Math.max(g.length,h.length,1);for(let F=0;F<S;F+=1){let _=qe(i,t,o,r,g[F]),C=qe(l,t,o,r,h[F]);m+=Ye(_,C,10**r)}}break}case"add":case"subtract":case"multiply":{let i=d.map(l=>Ce(l,t,o,r));i.length>0&&(m=i[0]);for(let l=1;l<i.length;l+=1)c.op==="multiply"?m=Ye(m,i[l],10**r):c.op==="add"?m+=i[l]:m-=i[l];break}case"percent":{let i=d.length>0?Ce(d[0],t,o,r):0,l=Jt(c.rateKey,t,o,r);m=Ye(i,l,100*10**6);break}default:m=0}o[c.key]=m,s[c.key]=Kt(m,r)}return s}var Be=class{constructor(){this.items=[];this.seen=new Set}add(t,n,r){let o=`${t} ${n} ${r}`;this.seen.has(o)||(this.seen.add(o),this.items.push({field:t,value:n,reason:r}))}list(){return this.items}},Zt=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,Qt=/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\.\d+)\s*)?\)$/i,en=/^hsla?\(\s*\d{1,3}(?:deg|rad|turn)?(?:\s*,\s*|\s+)[\d.]+%(?:\s*,\s*|\s+)[\d.]+%(?:\s*(?:,\s*|\s*\/\s*)(?:0|1|0?\.\d+|\.\d+|[\d.]+%))?\s*\)$/i,tn=new Set(["aliceblue","antiquewhite","aqua","aquamarine","azure","beige","bisque","black","blanchedalmond","blue","blueviolet","brown","burlywood","cadetblue","chartreuse","chocolate","coral","cornflowerblue","cornsilk","crimson","cyan","darkblue","darkcyan","darkgoldenrod","darkgray","darkgreen","darkgrey","darkkhaki","darkmagenta","darkolivegreen","darkorange","darkorchid","darkred","darksalmon","darkseagreen","darkslateblue","darkslategray","darkslategrey","darkturquoise","darkviolet","deeppink","deepskyblue","dimgray","dimgrey","dodgerblue","firebrick","floralwhite","forestgreen","fuchsia","gainsboro","ghostwhite","gold","goldenrod","gray","green","greenyellow","grey","honeydew","hotpink","indianred","indigo","ivory","khaki","lavender","lavenderblush","lawngreen","lemonchiffon","lightblue","lightcoral","lightcyan","lightgoldenrodyellow","lightgray","lightgreen","lightgrey","lightpink","lightsalmon","lightseagreen","lightskyblue","lightslategray","lightslategrey","lightsteelblue","lightyellow","lime","limegreen","linen","magenta","maroon","mediumaquamarine","mediumblue","mediumorchid","mediumpurple","mediumseagreen","mediumslateblue","mediumspringgreen","mediumturquoise","mediumvioletred","midnightblue","mintcream","mistyrose","moccasin","navajowhite","navy","oldlace","olive","olivedrab","orange","orangered","orchid","palegoldenrod","palegreen","paleturquoise","palevioletred","papayawhip","peachpuff","peru","pink","plum","powderblue","purple","rebeccapurple","red","rosybrown","royalblue","saddlebrown","salmon","sandybrown","seagreen","seashell","sienna","silver","skyblue","slateblue","slategray","slategrey","snow","springgreen","steelblue","tan","teal","thistle","tomato","turquoise","violet","wheat","white","whitesmoke","yellow","yellowgreen"]);function X(e,t,n,r="color"){if(typeof e!="string")return n.add(r,String(e),"not a string"),t;let o=e.trim();return Zt.test(o)||Qt.test(o)||en.test(o)||tn.has(o.toLowerCase())||o.toLowerCase()==="transparent"||o.toLowerCase()==="none"||o.toLowerCase()==="currentcolor"?o:(n.add(r,e,"not a recognised colour"),t)}var ue={arial:"Arial, Helvetica, sans-serif",helvetica:"Helvetica, Arial, sans-serif","helvetica neue":'"Helvetica Neue", Helvetica, Arial, sans-serif',"segoe ui":'"Segoe UI", system-ui, Arial, sans-serif',verdana:"Verdana, Geneva, sans-serif",calibri:"Calibri, Carlito, Arial, sans-serif",cambria:"Cambria, Georgia, serif","times new roman":'"Times New Roman", Times, serif',georgia:"Georgia, 'Times New Roman', serif",palatino:'"Palatino Linotype", "Book Antiqua", Palatino, serif',"palatino linotype":'"Palatino Linotype", "Book Antiqua", Palatino, serif',"book antiqua":'"Book Antiqua", Palatino, Georgia, serif',garamond:"Garamond, 'EB Garamond', Georgia, serif","century gothic":'"Century Gothic", Futura, sans-serif',impact:"Impact, 'Arial Narrow Bold', sans-serif","comic sans ms":'"Comic Sans MS", "Comic Sans", cursive',"courier new":'"Courier New", Courier, monospace',courier:'"Courier New", Courier, monospace',"lucida console":'"Lucida Console", Monaco, monospace',monospace:"ui-monospace, Menlo, Consolas, monospace",serif:"Georgia, 'Times New Roman', serif","sans-serif":"Helvetica, Arial, sans-serif"};function Je(e){if(typeof e!="string")return ue["sans-serif"];let t=e.trim().toLowerCase();if(Object.hasOwn(ue,t))return ue[t];let n=e.replace(/[^A-Za-z0-9 _-]/g,"").trim().slice(0,100);if(n.length===0)return ue["sans-serif"];let r=n.toLowerCase(),o=r.includes("mono")||r.includes("courier")||r.includes("consol")?ue.monospace:r.includes("serif")?ue.serif:ue["sans-serif"];return`"${n}", ${o}`}function ne(e,t=0){return typeof e=="number"&&Number.isFinite(e)?e:t}function Ze(e){return typeof e=="number"&&Number.isFinite(e)?e:0}function Qe(e){return typeof e!="number"||!Number.isFinite(e)?1:Math.min(1,Math.max(0,e))}var nn={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function fe(e){return e.replace(/[&<>"']/g,t=>{var n;return(n=nn[t])!=null?n:t})}function q(e){return fe(e)}function et(e){return e.type==="rect"||e.type==="rounded-rect"||e.type==="ellipse"||e.type==="line"||e.type==="hr"||e.type==="vr"||e.type==="polygon"||e.type==="freehand"}function re(e){let t=e.expansion;if(typeof t!="object"||t===null)return;let n=t;if(!(typeof n.x!="object"||n.x===null)&&!(typeof n.y!="object"||n.y===null))return n}function V(e,t){return typeof e=="number"&&Number.isFinite(e)?e:t}function yt(e,t,n,r){let o=Math.max(0,n);if(e.mode==="fixed")return{size:t,clipped:o>t+E};let s=e.mode==="bounded"?t+Math.max(0,V(e.maxGrowth,0)):r,c=Math.min(Math.max(t,o),Math.max(t,s));return{size:c,clipped:o>c+E}}var E=.5,wt=4;function kt(e,t){return t.x>=e.x-E&&t.y>=e.y-E&&t.x+t.width<=e.x+e.width+E&&t.y+t.height<=e.y+e.height+E}function rn(e,t){return e.x<t.x+t.width-E&&t.x<e.x+e.width-E&&e.y<t.y+t.height-E&&t.y<e.y+e.height-E}function We(e){let t=e.container;if(typeof t!="object"||t===null)return;let n=t;if(n.enabled===!0&&!(e.type!=="rect"&&e.type!=="rounded-rect"&&e.type!=="ellipse"))return n}function ve(e){let t=e.layoutParentId;return typeof t=="string"&&t.length>0?t:null}function on(e){var r,o;let t=e.anchor;if(typeof t!="object"||t===null)return;let n=t;return{horizontal:(r=n.horizontal)!=null?r:"start",vertical:(o=n.vertical)!=null?o:"start",offsets:{leftOffset:V(n.leftOffset,0),rightOffset:V(n.rightOffset,0),topOffset:V(n.topOffset,0),bottomOffset:V(n.bottomOffset,0)}}}function sn(e){var t,n,r,o;return{top:Math.max(0,V((t=e==null?void 0:e.padding)==null?void 0:t.top,0)),right:Math.max(0,V((n=e==null?void 0:e.padding)==null?void 0:n.right,0)),bottom:Math.max(0,V((r=e==null?void 0:e.padding)==null?void 0:r.bottom,0)),left:Math.max(0,V((o=e==null?void 0:e.padding)==null?void 0:o.left,0))}}function $t(e){var Se,Ae,Oe,he,be,xe,ye,we,ke,$e,O,W,ee,te,de,ot,it,st,at,ct,lt,dt,ut,ft,mt,gt;let t=[],n=a=>{t.includes(a)||t.push(a)},r=V((Se=e.document)==null?void 0:Se.width,0),o=V((Ae=e.document)==null?void 0:Ae.height,0),s=(Oe=e.documentPolicy)!=null?Oe:cn,c=new Map;for(let a of e.guides)!a||typeof a.id!="string"||c.set(a.id,{guide:a,base:V(a.position,0),cap:V(a.maxDisplacement,Number.POSITIVE_INFINITY)});let d=[];for(let a of e.attachments)if(!(!a||typeof a.id!="string")){if(!c.has(a.guideId)){n(`attachment "${a.id}" names guide "${String(a.guideId)}", which is not declared`);continue}d.push(a)}let m=new Map;for(let a of d){let f=(he=m.get(a.objectId))!=null?he:[];f.push(a),m.set(a.objectId,f)}let i=new Map,l=new Map;for(let a of c.keys())i.set(a,new Set),l.set(a,new Set);for(let a of e.objects){let f=re(a),x=new Set;f!=null&&f.y.growthGuideId&&c.has(f.y.growthGuideId)&&x.add(f.y.growthGuideId),f!=null&&f.x.growthGuideId&&c.has(f.x.growthGuideId)&&x.add(f.x.growthGuideId);let A=new Set;for(let j of(be=m.get(a.id))!=null?be:[])if(!A.has(j.guideId)){A.add(j.guideId);for(let M of x)M!==j.guideId&&((xe=l.get(M))==null||xe.add(j.guideId))}for(let j of x)for(let M of A)M!==j&&((ye=i.get(j))==null||ye.add(M))}let u=an([...c.keys()],i),$=!1;u===null&&($=!0,n("layout guide dependencies contain a cycle; those guides were left at their authored positions"));let T=u!=null?u:[...c.keys()],R=new Map,g=new Map;for(let a of e.objects)R.set(a.id,{x:a.x,y:a.y,width:a.width,height:a.height}),g.set(a.id,a);let h=new Map,S=new Set;for(let a of e.objects){let f=re(a);if(!f)continue;let x=(we=e.measurements)==null?void 0:we[a.id];if(!x)continue;let A=V(x.naturalWidth,Number.NaN),j=V(x.height,Number.NaN);if(Number.isNaN(A)||Number.isNaN(j)){n(`"${a.id}" has a measurement that is not a finite size; it keeps its authored box`);continue}let M=R.get(a.id),H=s.growthX==="expand"?V(s.maxWidth,Number.MAX_SAFE_INTEGER):Math.max(r-M.x,M.width),y=Number.MAX_SAFE_INTEGER,p=yt(f.x,M.width,A,H),w=yt(f.y,M.height,j,y);h.set(a.id,{x:M.x,y:M.y,width:p.size,height:w.size}),(p.clipped||w.clipped)&&S.add(a.id)}let F=new Map;for(let a of e.objects){if(!h.get(a.id))continue;let x=re(a),A=new Set;x!=null&&x.y.growthGuideId&&c.has(x.y.growthGuideId)&&A.add(x.y.growthGuideId),x!=null&&x.x.growthGuideId&&c.has(x.x.growthGuideId)&&A.add(x.x.growthGuideId);for(let j of(ke=m.get(a.id))!=null?ke:[])(j.edge==="bottom"||j.edge==="right")&&A.add(j.guideId);A.size>0&&F.set(a.id,A)}let _=new Map;for(let a of e.objects){let f=h.get(a.id);if(f)for(let x of($e=F.get(a.id))!=null?$e:[]){let A=c.get(x),M=A.guide.orientation==="horizontal"?f.y+f.height-A.base:f.x+f.width-A.base;_.set(x,Math.max((O=_.get(x))!=null?O:0,Math.max(0,M)))}}let C=new Map;for(let a of T){let f=c.get(a),x=$?0:Math.max(0,(W=_.get(a))!=null?W:0);x>f.cap+E&&n(`guide "${a}" reached its maximum displacement of ${f.cap} and stopped there`),C.set(a,f.base+Math.min(x,f.cap))}if(!$)for(let a of e.objects){let f=h.get(a.id);if(!f)continue;let x=R.get(a.id);for(let A of(ee=F.get(a.id))!=null?ee:[]){let j=c.get(A),M=C.get(A),H=j.guide.orientation==="horizontal",y=H?M-f.y:M-f.x,p=H?x.height:x.width;if((H?f.height:f.width)>y+E){let b=Math.max(p,y);H?f.height=b:f.width=b,S.add(a.id)}}}let z=new Map;for(let a of e.objects){let f=h.get(a.id);z.set(a.id,f?{...f}:{...R.get(a.id)})}let J=(a,f,x,A,j,M,H)=>{let y=x-A,p=Math.abs(j-y)<=E,w=j<y-E,b=p?x:w?j+A:Math.max(j,x),k=Math.min(Math.max(b,M),H);f==="y"?a.height=Math.max(0,k-a.y):a.width=Math.max(0,k-a.x)},P=(a,f,x,A,j,M)=>{let H=x-A,p=Math.abs(j-H)<=E||Math.abs(j-x)<=E?x:j+A;f==="y"?a.y=M?p-a.height:p:a.x=M?p-a.width:p},L=(a,f,x)=>{let A=re(a),j=A==null?void 0:A[f];if(!j||j.mode!=="bounded")return Number.POSITIVE_INFINITY;let M=Math.max(0,V(j.maxGrowth,0));return f==="y"?x.y+x.height+M:x.x+x.width+M};for(let a of d){let f=z.get(a.objectId);if(!f)continue;let x=c.get(a.guideId),A=C.get(a.guideId),j=R.get(a.objectId),M=x.guide.orientation==="horizontal",H=M?"y":"x";if(M!==(a.edge==="top"||a.edge==="bottom")){n(`attachment "${a.id}" binds the ${a.edge} edge to the ${M?"horizontal":"vertical"} guide "${a.guideId}", which cannot control it`);continue}if((te=F.get(a.objectId))!=null&&te.has(a.guideId))continue;let y=a.edge==="top"?"bottom":a.edge==="bottom"?"top":a.edge==="left"?"right":"left",p=((de=m.get(a.objectId))!=null?de:[]).find(B=>B.guideId===a.guideId&&B.edge===y),w=M?a.edge==="bottom"?j.y+j.height:j.y:a.edge==="right"?j.x+j.width:j.x,b=M?f.y+f.height:f.x+f.width,k=L(g.get(a.objectId),H,f),I=Math.max(0,A-x.base),v=a.edge==="bottom"||a.edge==="right";if(p){if(p.id<a.id)continue;n(`"${a.objectId}" has both ${y} and ${a.edge} attached to guide "${a.guideId}"; one box cannot have both edges on one boundary, so it follows the boundary instead`),P(f,H,A,I,w,v);continue}if(a.behavior==="move"){P(f,H,A,I,w,v);continue}v?J(f,H,A,I,w,b,k):P(f,H,A,I,w,v)}if(!$)for(let a of e.objects){if(!et(a))continue;let f=re(a);if(!f)continue;let x=z.get(a.id);if(!x)continue;let A=R.get(a.id);for(let j of["y","x"]){let M=f[j].growthGuideId;if(!M||!c.has(M))continue;let H=c.get(M),y=C.get(M);if(y===void 0)continue;let p=j==="y",w=p?A.y+A.height:A.x+A.width;J(x,p?"y":"x",y,Math.max(0,y-H.base),w,Number.NEGATIVE_INFINITY,L(a,j,x))}}if(!$){let a=new Map;for(let y of e.objects){let p=re(y);a.set(y.id,{y:(p==null?void 0:p.y.growthGuideId)!==void 0&&c.has(p.y.growthGuideId),x:(p==null?void 0:p.x.growthGuideId)!==void 0&&c.has(p.x.growthGuideId)})}let f=new Map;for(let y of e.objects){let p=ve(y);if(!p||!g.has(p)||p===y.id)continue;let w=(ot=f.get(p))!=null?ot:[];w.push(y.id),f.set(p,w)}let x=y=>{let p=0,w=y,b=new Set;for(;w&&!b.has(w);){b.add(w);let k=ve(g.get(w));if(!k||!g.has(k))break;p+=1,w=k}return p},A=e.objects.filter(y=>{var p;return We(y)!==void 0&&((p=f.get(y.id))!=null?p:[]).length>0}).sort((y,p)=>x(p.id)-x(y.id)),j=(y,p,w)=>{let b=p==="y"?y.maxHeight:y.maxWidth;return b===void 0?Number.POSITIVE_INFINITY:(p==="y"?w.y:w.x)+Math.max(0,V(b,0))};for(let y=0;y<wt;y+=1){let p=!1;for(let w of A){let b=z.get(w.id),k=R.get(w.id),I=We(w),v=sn(I),B=((it=f.get(w.id))!=null?it:[]).map(G=>g.get(G)).filter(Boolean);for(let G of["y","x"]){if((G==="y"?(st=I.growthY)!=null?st:"content":(at=I.growthX)!=null?at:"content")!=="content"||a.get(w.id)[G])continue;let D=G==="y",Y=D?k.y:k.x,K=D?k.y+k.height:k.x+k.width,ge=Math.max(0,V(D?I.minHeight:I.minWidth,0)),ae=Math.max(K,Y+ge);for(let _e of B){let Me=z.get(_e.id),_t=D?Me.y+Me.height:Me.x+Me.width;ae=Math.max(ae,_t+(D?v.bottom:v.right))}let Te=Math.min(ae,j(I,G,b));Te>(D?b.y+b.height:b.x+b.width)+E&&(D?b.height=Te-b.y:b.width=Te-b.x,p=!0)}}if(!p)break;for(let w of e.objects){let b=ve(w);if(!b||!g.has(b))continue;let k=on(w);if(!k)continue;let I=z.get(w.id),v=R.get(w.id),B=z.get(b),G=R.get(b),ie=B.y+B.height-(G.y+G.height),D=B.x+B.width-(G.x+G.width);if(k.vertical==="end"&&ie>E){let Y=Math.max(0,G.y+G.height-(v.y+v.height));I.y=B.y+B.height-Y-I.height}else if(k.vertical==="stretch"&&ie>E){let Y=Math.max(0,v.y-G.y),K=Math.max(0,G.y+G.height-(v.y+v.height));I.y=B.y+Y,I.height=Math.max(0,B.y+B.height-K-I.y)}if(k.horizontal==="end"&&D>E){let Y=Math.max(0,G.x+G.width-(v.x+v.width));I.x=B.x+B.width-Y-I.width}else if(k.horizontal==="stretch"&&D>E){let Y=Math.max(0,v.x-G.x),K=Math.max(0,G.x+G.width-(v.x+v.width));I.x=B.x+Y,I.width=Math.max(0,B.x+B.width-K-I.x)}}}let M=e.objects.filter(y=>et(y)&&re(y)!==void 0&&We(y)===void 0);for(let y=0;y<wt;y+=1){let p=!1;for(let w of M){let b=z.get(w.id),k=R.get(w.id),I=re(w);for(let v of["y","x"]){if(I[v].mode==="fixed"||a.get(w.id)[v])continue;let B=v==="y",G=e.objects.filter(K=>K.id!==w.id&&kt(k,R.get(K.id))),ie=B?b.y+b.height:b.x+b.width;for(let K of G){let ge=z.get(K.id),ae=R.get(K.id),Te=B?Math.max(0,k.y+k.height-(ae.y+ae.height)):Math.max(0,k.x+k.width-(ae.x+ae.width)),_e=B?ge.y+ge.height:ge.x+ge.width;ie=Math.max(ie,_e+Te)}let D=L(w,v,b),Y=Math.min(ie,D);Y>(B?b.y+b.height:b.x+b.width)+E&&(B?b.height=Y-b.y:b.width=Y-b.x,p=!0)}}if(!p)break}for(let y of e.objects){let p=h.get(y.id);if(!p)continue;let w=ve(y);if(w&&g.has(w)){let b=g.get(w),k=We(b),I=z.get(b.id),v=p.y+p.height>I.y+I.height+E,B=p.x+p.width>I.x+I.width+E,G=k!==void 0?((ct=k.growthY)!=null?ct:"content")==="content":((dt=(lt=re(b))==null?void 0:lt.y.mode)!=null?dt:"fixed")!=="fixed",ie=k!==void 0?((ut=k.growthX)!=null?ut:"content")==="content":((mt=(ft=re(b))==null?void 0:ft.x.mode)!=null?mt:"fixed")!=="fixed";if(v&&!G||B&&!ie){n(`"${y.id}" grew past "${b.id}", which is set to a fixed size; enlarge that box or let it expand`);continue}let D=(k==null?void 0:k.maxHeight)!==void 0&&v,Y=(k==null?void 0:k.maxWidth)!==void 0&&B;if(D||Y){let K=D?k.maxHeight:k.maxWidth;n(`"${y.id}" needs more room than "${b.id}" allows; that box is capped at ${K}px on the ${D?"vertical":"horizontal"} axis`)}continue}for(let b of e.objects){if(b.id===y.id||!et(b))continue;let k=re(b);if(k&&k.y.mode!=="fixed"||!kt(R.get(b.id),R.get(y.id)))continue;let I=z.get(b.id);(p.y+p.height>I.y+I.height+E||p.x+p.width>I.x+I.width+E)&&n(`"${y.id}" grew past "${b.id}", which is set to a fixed size; enlarge that box or let it expand`)}}if(((gt=e.collision)!=null?gt:"report")==="report")for(let[y,p]of f)for(let w=0;w<p.length;w+=1)for(let b=w+1;b<p.length;b+=1){let k=z.get(p[w]),I=z.get(p[b]);rn(k,I)&&n(`"${p[w]}" overlaps "${p[b]}" inside "${y}"; move one of them or set collision to allow`)}}for(let a of S)n(`"${a}" could not be given the room its content needs; the text was not shrunk to fit`);let Z=e.objects.map(a=>{let f=z.get(a.id);return{...a,x:f.x,y:f.y,width:f.width,height:f.height}}),Q=0,se=0;for(let a of Z)Q=Math.max(Q,a.y+a.height),se=Math.max(se,a.x+a.width);let le=r,me=o;if(s.growthY==="expand"){let a=V(s.maxHeight,Number.POSITIVE_INFINITY);me=Math.min(Math.max(me,Q),a),Q>a+E&&n(`the bill grew past the page height limit of ${a} and was cut off there`)}else Q>me+E&&n(`content reaches ${Math.round(Q)}px but the page is ${Math.round(me)}px tall`);if(s.growthX==="expand"){let a=V(s.maxWidth,Number.POSITIVE_INFINITY);le=Math.min(Math.max(le,se),a)}else se>le+E&&n(`content reaches ${Math.round(se)}px but the page is ${Math.round(le)}px wide`);return{objects:Z,page:{width:le,height:me},guides:e.guides.map(a=>{var f;return{...a,position:(f=C.get(a.id))!=null?f:a.position}}),diagnostics:t}}function an(e,t){let n=new Map,r=[],o=s=>{var d,m;let c=(d=n.get(s))!=null?d:0;if(c===1)return!1;if(c===2)return!0;n.set(s,1);for(let i of(m=t.get(s))!=null?m:[])if(!o(i))return!1;return n.set(s,2),r.push(s),!0};for(let s of e)if(!o(s))return null;return r}var cn={growthX:"fixed",growthY:"fixed"};var ln="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";function dn(){return new RegExp(ln,"g")}function pe(e,t){return e.replace(dn(),(n,r)=>{let o=t[r];return typeof o=="string"?o:n})}function N(e){return String(Math.round(e*100)/100)}function ze(e){return`${e.join("; ")};`}function je(e){return`id="o${e}"`}function Re(e,t,n,r=""){return`<div class="${t}" ${je(e)} style="${q(n)}">${r}</div>`}function un(e,t){let n=typeof e.id=="string"?e.id:"?";return["position: absolute",`left: ${N(e.x)}px`,`top: ${N(e.y)}px`,`width: ${N(U(e.width,t,`${n}.width`,0))}px`,`height: ${N(U(e.height,t,`${n}.height`,0))}px`,`z-index: ${N(Math.round(ne(e.zIndex,0)))}`,`opacity: ${N(Qe(e.opacity))}`]}function ce(e,t,n=[],r){var l,u;let o=Ze(e.rotation),s=un(e,t),c=(l=r==null?void 0:r.x)!=null?l:1,d=(u=r==null?void 0:r.y)!=null?u:1,m=Math.abs(c-1)>=.001||Math.abs(d-1)>=.001,i=`scale(${N(c)}, ${N(d)})`;return o!==0&&m?s.push(`transform: rotate(${N(o)}deg) ${i}`,"transform-origin: 50% 50%"):o!==0?s.push(`transform: rotate(${N(o)}deg)`,"transform-origin: 50% 50%"):m&&s.push(`transform: ${i}`,"transform-origin: 0 0"),ze([...s,...n])}var fn=new Set(["left","center","right"]),mn=/\{\{[^}]*\}\}/g;function Rt(e){return e.replace(mn,"")}function St(e,t,n){return typeof e=="string"&&fn.has(e)?e:(t.add(n,String(e),"not an alignment; falling back to left"),"left")}function gn(e){return e==="middle"?"center":e==="bottom"?"flex-end":"flex-start"}function U(e,t,n,r){let o=ne(e,r);return o<0?(t.add(n,String(e),"negative length; falling back to zero"),0):o}function Tt(e,t,n){if(e==null)return 1;let r=ne(e,1);return!Number.isFinite(r)||r<=0?(t.add(n,String(e),"not a positive scale; falling back to 1"),1):r}function pn(e){return Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.width)&&Number.isFinite(e.height)}function hn(e,t,n){let r=X(e.stroke,"#000000",n,`${e.id}.stroke`),o=X(e.fill,"transparent",n,`${e.id}.fill`),s=U(e.strokeWidth,n,`${e.id}.strokeWidth`,1),c=e.type==="ellipse"?"50%":`${N(U(e.cornerRadius,n,`${e.id}.cornerRadius`,0))}px`;return Re(t,"o",ce(e,n,[`border: ${N(s)}px solid ${r}`,`background: ${o}`,`border-radius: ${c}`]))}function bn(e,t,n){let r=e.x2-e.x,o=e.y2-e.y,s=Math.hypot(r,o);if(!Number.isFinite(s))return n.add(`${e.id}.endpoint`,`x2=${e.x2},y2=${e.y2}`,"not a finite length"),null;if(s===0)return null;let c=X(e.stroke,"#000000",n,`${e.id}.stroke`),d=Math.max(U(e.strokeWidth,n,`${e.id}.strokeWidth`,1),.75),i=Math.atan2(o,r)*180/Math.PI+Ze(e.rotation);return Re(t,"o",ze(["position: absolute",`left: ${N(e.x)}px`,`top: ${N(e.y-d/2)}px`,`width: ${N(s)}px`,`height: ${N(d)}px`,`z-index: ${N(Math.round(ne(e.zIndex,0)))}`,`opacity: ${N(Qe(e.opacity))}`,`background: ${c}`,"transform-origin: 0 50%",`transform: rotate(${N(i)}deg)`]))}function xn(e,t,n){let r=(Array.isArray(e.points)?e.points:[]).filter(d=>Array.isArray(d)&&d.length>=2&&Number.isFinite(d[0])&&Number.isFinite(d[1]));if(r.length<2)return n.add(`${e.id}.points`,String(r.length),"fewer than two finite points"),null;let o=X(e.stroke,"#000000",n,`${e.id}.stroke`),s=U(e.strokeWidth,n,`${e.id}.strokeWidth`,1),c=q(r.map(d=>`${N(d[0])},${N(d[1])}`).join(" "));return`<svg class="o" ${je(t)} style="${q(ce(e,n,["overflow: visible"]))}"><polygon points="${c}" fill="${q(X(e.fill,"transparent",n,`${e.id}.fill`))}" stroke="${q(o)}" stroke-width="${N(s)}" /></svg>`}function yn(e,t,n){if(typeof e.path!="string"||e.path.trim()==="")return n.add(`${e.id}.path`,String(e.path),"empty path data"),null;let r=X(e.stroke,"#000000",n,`${e.id}.stroke`),o=U(e.strokeWidth,n,`${e.id}.strokeWidth`,1);return`<svg class="o" ${je(t)} style="${q(ce(e,n,["overflow: visible"]))}"><path d="${q(e.path)}" fill="none" stroke="${q(r)}" stroke-width="${N(o)}" stroke-linecap="round" stroke-linejoin="round" /></svg>`}function jt(e,t,n,r,o=[],s="hide"){let c=U(e.fontSize,r,`${e.id}.fontSize`,12),d=N(ne(e.charSpacing,0)/1e3),m=gn(e.textVerticalAlign),i=X(e.fill,"#000000",r,`${e.id}.fill`),l=Tt(e.scaleX,r,`${e.id}.scaleX`),u=Tt(e.scaleY,r,`${e.id}.scaleY`),$=e.wrapWidth,T=typeof $=="number"&&$>0?U($,r,`${e.id}.wrapWidth`,0):0,R=[T?"white-space: pre-wrap":"white-space: pre",...T?["overflow-wrap: break-word"]:[],`color: ${i}`,`font-family: ${Je(e.fontFamily)}`,`font-size: ${N(c)}px`,`line-height: ${N(c*ne(e.lineHeight,1.16))}px`,`font-weight: ${e.fontWeight==="bold"?"bold":"normal"}`,`font-style: ${e.fontStyle==="italic"?"italic":"normal"}`,`text-align: ${St(e.textAlign,r,`${e.id}.textAlign`)}`,`letter-spacing: ${d}em`],g=pe(typeof e.text=="string"?e.text:"",n),h=`<div class="tx" style="${q(ze(["display: flex","flex-direction: column",`justify-content: ${m}`]))}">${fe(s==="hide"?Rt(g):g)}</div>`;return Re(t,"o t",ce(e,r,[...R,...T?["height: auto"]:[],...o],{x:l,y:u}),h)}function wn(e,t){return{border:`${N(U(e.borderWidth,t,`${e.id}.borderWidth`,1))}px solid ${X(e.borderColor,"#000000",t,`${e.id}.borderColor`)}`,padding:`${N(U(e.padding,t,`${e.id}.padding`,4))}px`,family:Je(e.fontFamily),headerFill:X(e.headerFill,"transparent",t,`${e.id}.headerFill`),headerInk:X(e.headerTextColor,"#000000",t,`${e.id}.headerTextColor`),cellFill:X(e.cellFill,"transparent",t,`${e.id}.cellFill`),cellInk:X(e.cellTextColor,"#000000",t,`${e.id}.cellTextColor`)}}function kn(e,t,n,r,o){let s=o?n.headerInk:n.cellInk,c=typeof(e==null?void 0:e.color)=="string"?X(e.color,s,r,`${t.id}.cellColor`):s;return ze([`border: ${n.border}`,`padding: ${n.padding}`,`font-family: ${n.family}`,`font-size: ${N(U(e==null?void 0:e.fontSize,r,`${t.id}.cellFontSize`,12))}px`,`font-weight: ${(e==null?void 0:e.fontWeight)==="bold"?"bold":"normal"}`,`color: ${c}`,`background: ${o?n.headerFill:n.cellFill}`,`text-align: ${St(e==null?void 0:e.textAlign,r,`${t.id}.cellTextAlign`)}`,"white-space: pre","overflow: hidden"])}function $n(e,t,n,r,o="hide"){let s=(Array.isArray(e.colWidths)?e.colWidths:[]).map((g,h)=>U(g,r,`${e.id}.colWidths[${h}]`,0)),c=(Array.isArray(e.rowHeights)?e.rowHeights:[]).map((g,h)=>U(g,r,`${e.id}.rowHeights[${h}]`,0)),d=s.reduce((g,h)=>g+h,0);if(s.length===0||!(d>0))return r.add(`${e.id}.colWidths`,String(d),"no usable column widths"),null;let m=Array.isArray(e.cells)?e.cells:[],i=wn(e,r),l=(g,h)=>{var F;let S=[];for(let _=0;_<s.length;_++){let C=m[g*s.length+_],z=h?"th":"td",J=pe(typeof(C==null?void 0:C.text)=="string"?C.text:"",n),P=fe(o==="hide"?Rt(J):J);S.push(`<${z} style="${q(kn(C,e,i,r,h))}">${P}</${z}>`)}return`<tr style="height: ${N((F=c[g])!=null?F:0)}px">${S.join("")}</tr>`},u;e.headerRow&&c.length>0?(u=`<thead>${l(0,!0)}</thead>`,c.length>1&&(u+=`<tbody>${c.slice(1).map((g,h)=>l(h+1,!1)).join("")}</tbody>`)):u=`<tbody>${c.map((g,h)=>l(h,!1)).join("")}</tbody>`;let $=s.map(g=>`<col style="width: ${N(g)}px" />`).join(""),T=`<table class="tbl" style="width: ${N(d)}px"><colgroup>${$}</colgroup>${u}</table>`,R={...e,width:d,height:c.reduce((g,h)=>g+h,0)};return Re(t,"o",ce(R,r),T)}function tt(e){return typeof e=="string"&&(e.startsWith("data:image/")||e.startsWith("blob:")||e.startsWith("https://")||e.startsWith("http://"))}function Tn(e,t,n,r,o="hide"){let s=n[e.placeholderRole],c=tt(s)?s:e.src;return tt(c)?`<img class="o" ${je(t)} style="${q(ce(e,r,["object-fit: contain"]))}" src="${q(c)}" alt="${q(typeof e.label=="string"?e.label:"")}" />`:o==="hide"?null:Re(t,"o ph",ce(e,r,["border: 1px dashed #9ca3af","display: flex","align-items: center","justify-content: center","color: #6b7280"]),fe(typeof e.label=="string"?e.label:""))}function jn(e,t,n){return tt(e.src)?`<img class="o" ${je(t)} style="${q(ce(e,n,["object-fit: contain"]))}" src="${q(e.src)}" alt="${q(typeof e.name=="string"?e.name:"")}" />`:(n.add(`${e.id}.src`,typeof e.src,"not a safe image source"),null)}function At(e,t,n,r,o="hide"){let s=typeof e.id=="string"?e.id:"?",c=String(e.type);if(e.type==="group"||e.visible===!1)return null;if(!pn(e))return r.add(`${s}.box`,`x=${e.x},y=${e.y},w=${e.width},h=${e.height}`,"not a finite box"),null;switch(e.type){case"rect":case"rounded-rect":case"ellipse":return hn(e,t,r);case"line":case"hr":case"vr":return bn(e,t,r);case"polygon":return xn(e,t,r);case"freehand":return yn(e,t,r);case"text":return jt(e,t,n,r,[],o);case"field":{let d=e;return jt({...d,wrapWidth:d.width},t,n,r,["overflow: hidden"],o)}case"table":return $n(e,t,n,r,o);case"image-placeholder":return Tn(e,t,n,r,o);case"bill-part":return jn(e,t,r);default:return r.add(`${s}.type`,c,"unknown object type"),null}}var Rn="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}",Sn=()=>new RegExp(Rn,"g");function An(e,t,n){return e.replace(Sn(),(r,o)=>{let s=t[o];if(typeof s=="string")return s;if(typeof s=="number"&&Number.isFinite(s))return String(s);let c=n[o];return typeof c=="string"?c:r})}function On(e){let t=e.repeat;if(!t||typeof t!="object")return null;let n=t.startRow,r=t.endRow,o=t.key,s=Array.isArray(e.rowHeights)?e.rowHeights:[],c=Array.isArray(e.cells)?e.cells:[],d=typeof e.columns=="number"&&Number.isInteger(e.columns)&&e.columns>0?e.columns:1,m=Math.max(typeof e.rows=="number"&&Number.isInteger(e.rows)&&e.rows>0?e.rows:0,s.length,Math.ceil(c.length/d)),i=$=>({band:{startRow:0,endRow:0,key:"",maxItems:200},why:$});if(typeof n!="number"||!Number.isInteger(n)||n<0)return i("first row is not a row index");if(typeof r!="number"||!Number.isInteger(r)||r<n)return i("last row comes before the first");if(m<=0||r>=m)return i("last row is past the end of the table");if(typeof o!="string"||o.trim().length===0)return i("no items key");let l=t.maxItems,u=typeof l=="number"&&Number.isInteger(l)&&l>0?l:200;return{band:{startRow:n,endRow:r,key:o.trim(),maxItems:u},why:null}}function Mn(e,t){var r;let n=[];return((r=e.repeat)==null?void 0:r.repeatHeader)===!0&&n.push(`table "${e.name}" has repeatHeader on, which asks for the header row to be drawn again when the table splits across pages; a document is a single page here, so the heading is drawn once`),e.headerRow===!0&&t.startRow===0&&n.push(`table "${e.name}" starts its repeating band on the header row, so the header is drawn once per item; start the band below it to keep one heading`),n}function In(e){try{let t=JSON.parse(e);return Array.isArray(t)?t.length:null}catch{return null}}function Fn(e,t,n){var _,C,z,J;let r=On(e);if(!r)return{table:e,warnings:[]};let{band:o,why:s}=r,c=[];if(s)return c.push(`table "${e.name}" has a repeat band that was ignored: ${s}`),{table:e,warnings:c};c.push(...Mn(e,o));let d=typeof e.columns=="number"&&e.columns>0?e.columns:1,m=t[o.key],i=Ue(t,o.key);if(typeof m=="string"&&m.length>0){let P=In(m);P===null?c.push(`table "${e.name}" could not read any items from ${o.key}; the repeating rows were dropped`):P>0&&i.length===0&&c.push(`table "${e.name}" read ${P} entries from ${o.key} but none were usable rows; the repeating rows were dropped`)}let l=i;i.length>o.maxItems&&(c.push(`table "${e.name}" received ${i.length} items but ${o.key} is capped at ${o.maxItems}; the extra rows were not drawn`),l=i.slice(0,o.maxItems));let u=Array.isArray(e.cells)?e.cells:[],$=Array.isArray(e.rowHeights)?e.rowHeights:[],T=Math.max(typeof e.rows=="number"&&e.rows>0?e.rows:0,$.length,Math.ceil(u.length/d)),R=(P,L)=>{var Z;return(Z=u[P*d+L])!=null?Z:{text:"",textAlign:"left",fontSize:10,fontWeight:"normal"}},g=[],h=[];for(let P=0;P<o.startRow;P+=1){for(let L=0;L<d;L+=1)g.push(R(P,L));h.push((_=$[P])!=null?_:0)}for(let P of l)for(let L=o.startRow;L<=o.endRow;L+=1){for(let Z=0;Z<d;Z+=1){let Q=R(L,Z);g.push({...Q,text:An((C=Q.text)!=null?C:"",P,t)})}h.push((z=$[L])!=null?z:0)}for(let P=o.endRow+1;P<T;P+=1){for(let L=0;L<d;L+=1)g.push(R(P,L));h.push((J=$[P])!=null?J:0)}let S=h.reduce((P,L)=>P+L,0),F=typeof e.y=="number"&&Number.isFinite(e.y)?e.y:0;return Number.isFinite(n)&&n>0&&F+S>n&&c.push(`table "${e.name}" ends at ${Math.round(F+S)} but the page is ${Math.round(n)} tall; the last rows will print off the page`),{table:{...e,rows:h.length,rowHeights:h,cells:g,height:S,repeat:void 0},warnings:c}}function Ge(e,t,n){let r=[];return{objects:e.map(s=>{if(s.type!=="table")return s;let{table:c,warnings:d}=Fn(s,t,n);return r.push(...d),c}),warnings:r}}var Nn=.01;function Ot(e,t,n){return`${e}|${t}|${n}`}function Le(e){let t=e.expansion;if(typeof t!="object"||t===null)return!1;let n=t.y;if(typeof n!="object"||n===null)return!1;let r=n.mode;if(r!=="bounded"&&r!=="unbounded")return!1;let o=n,s={mode:o.mode};return typeof o.maxGrowth=="number"&&Number.isFinite(o.maxGrowth)&&(s.maxGrowth=o.maxGrowth),s}function Mt(e,t,n=[],r=2){var m;let o=e.document,s=typeof(o==null?void 0:o.height)=="number"?o.height:0,{objects:c}=Ge(Array.isArray(e.objects)?e.objects:[],{...t,...Pe(n,t,r)},s),d=[];for(let i of c){if(i.type!=="table"||!Le(i))continue;let u=i,$=u.columns>0?u.columns:1,T=Array.isArray(u.colWidths)?u.colWidths:[],R=Array.isArray(u.cells)?u.cells:[],g=u.rows>0?u.rows:Math.ceil(R.length/$);for(let h=0;h<g;h+=1)for(let S=0;S<$;S+=1){let F=R[h*$+S];if(!F)continue;let _=typeof T[S]=="number"&&Number.isFinite(T[S])?T[S]:u.width/$;d.push({id:Ot(u.id,h,S),text:typeof F.text=="string"?F.text:"",fontFamily:u.fontFamily,fontSize:typeof F.fontSize=="number"?F.fontSize:10,fontWeight:F.fontWeight==="bold"?"bold":"normal",textAlign:(m=F.textAlign)!=null?m:"left",width:Math.max(0,_-u.padding*2),wrap:!0})}}return d}function It(e,t,n={}){let r=e.columns>0?e.columns:1,o=e.rows>0?e.rows:0,s=Array.isArray(e.rowHeights)?e.rowHeights:[],c=new Array(o),d=!1;for(let i=0;i<o;i+=1){let l=typeof s[i]=="number"&&Number.isFinite(s[i])?s[i]:0,u=0;for(let R=0;R<r;R+=1){let g=t[Ot(e.id,i,R)];if(!g)continue;let h=g.height;!Number.isFinite(h)||h<0||Number.isFinite(g.naturalWidth)&&h>u&&(u=h)}if(u<=0){c[i]=l;continue}let $=u+e.padding*2,T=Math.max(l,$);typeof n.maxGrowth=="number"&&Number.isFinite(n.maxGrowth)&&(T=Math.min(T,l+Math.max(0,n.maxGrowth))),Math.abs(T-l)<Nn&&(T=l),c[i]=T,T!==l&&(d=!0)}if(!d)return e;let m=c.reduce((i,l)=>i+l,0);return{...e,rowHeights:c,height:m}}var Cn=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],En=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];function oe(e,t){return e>>>t|e<<32-t}function Pn(e){let t=[];for(let n=0;n<e.length;n+=1){let r=e.charCodeAt(n);if(r>=55296&&r<=56319){let o=n+1<e.length?e.charCodeAt(n+1):0;o>=56320&&o<=57343?(r=65536+(r-55296<<10)+(o-56320),n+=1):r=65533}else r>=56320&&r<=57343&&(r=65533);r<128?t.push(r):r<2048?t.push(192|r>>6,128|r&63):r<65536?t.push(224|r>>12,128|r>>6&63,128|r&63):t.push(240|r>>18,128|r>>12&63,128|r>>6&63,128|r&63)}return t}function Bn(e){return(e>>>0).toString(16).padStart(8,"0")}function Ft(e){return Wn(Pn(e))}function Wn(e){let t=e.slice(),n=t.length*8,r=Math.floor(n/4294967296);for(t.push(128);t.length%64!==56;)t.push(0);t.push(r>>>24&255,r>>>16&255,r>>>8&255,r&255,n>>>24&255,n>>>16&255,n>>>8&255,n&255);let o=En.slice(),s=new Array(64).fill(0);for(let c=0;c<t.length;c+=64){for(let g=0;g<16;g+=1){let h=c+g*4;s[g]=t[h]<<24|t[h+1]<<16|t[h+2]<<8|t[h+3]}for(let g=16;g<64;g+=1){let h=s[g-15],S=s[g-2],F=oe(h,7)^oe(h,18)^h>>>3,_=oe(S,17)^oe(S,19)^S>>>10;s[g]=s[g-16]+F+s[g-7]+_>>>0}let d=o[0],m=o[1],i=o[2],l=o[3],u=o[4],$=o[5],T=o[6],R=o[7];for(let g=0;g<64;g+=1){let h=oe(u,6)^oe(u,11)^oe(u,25),S=u&$^~u&T,F=R+h+S+Cn[g]+s[g]>>>0,_=oe(d,2)^oe(d,13)^oe(d,22),C=d&m^d&i^m&i,z=_+C>>>0;R=T,T=$,$=u,u=l+F>>>0,l=i,i=m,m=d,d=F+z>>>0}o[0]=o[0]+d>>>0,o[1]=o[1]+m>>>0,o[2]=o[2]+i>>>0,o[3]=o[3]+l>>>0,o[4]=o[4]+u>>>0,o[5]=o[5]+$>>>0,o[6]=o[6]+T>>>0,o[7]=o[7]+R>>>0}return o.map(Bn).join("")}function Nt(e,t){return[`@page { size: ${e}px ${t}px; margin: 0; }`,"html, body { margin: 0; padding: 0; background: #fff; }","body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }",`.sheet { position: relative; width: ${e}px; height: ${t}px; overflow: hidden; background: #fff; }`,".o { position: absolute; }",".t { white-space: pre; }",".tx { display: flex; flex-direction: column; }",".tbl { border-collapse: collapse; table-layout: fixed; }",".ph { border: 1px dashed #9ca3af; display: flex; align-items: center; justify-content: center; color: #6b7280; }","* { box-sizing: border-box; }","* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }"].join(`
`)}function Ct(e,t,n,r){let o=ne(e,0);return o>0?o:(n.add(`page.${t}`,String(e),"not a positive length; the page falls back to A4"),r)}function Gn(e,t){let n=ne(e,Number.NaN);return Number.isFinite(n)&&n>=0?n:(t.add("templateVersion",String(e),"not a version number; the supported version is emitted instead"),2)}function Et(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)?e:void 0}function Ln(e,t){let n=e==null?void 0:e.name;if(typeof n=="string")return n;let r=n==null?"Document":String(n);return t.add("meta.name",String(n),`not a string; the document is named ${r}`),r}function Pt(e,t={},n={}){var he,be,xe,ye,we,ke,$e;let r=new Be,o=ne(e.templateVersion,Number.NaN);if(o>2)throw new Error(`template version ${o} exceeds the renderer's supported ${2}`);let s=Gn(e.templateVersion,r),c=Et(e.document),d=Ct(c==null?void 0:c.width,"width",r,794),m=Ct(c==null?void 0:c.height,"height",r,1123),i=Et(e.meta),l=Ln(i,r),u;Array.isArray(e.objects)?u=e.objects:(r.add("objects",String(e.objects),"not an array; the page renders empty"),u=[]);let $={...t,...Pe((he=n.computed)!=null?he:[],t,(be=n.currencyScale)!=null?be:2)},{objects:T,warnings:R}=Ge(u,$,m),g=(xe=n.measurements)!=null?xe:{},h=T.map(O=>{if(O.type!=="table")return O;let W=Le(O);return W?It(O,g,{...W.maxGrowth!==void 0?{maxGrowth:W.maxGrowth}:{}}):O}),S=e.layout,F={...g};for(let O of h)O.type==="table"&&Le(O)&&(F[O.id]={naturalWidth:O.width,height:O.height});let _=O=>{var W,ee,te;return $t({objects:h,measurements:O,guides:(W=S==null?void 0:S.guides)!=null?W:[],attachments:(ee=S==null?void 0:S.attachments)!=null?ee:[],documentPolicy:(te=S==null?void 0:S.document)!=null?te:{growthX:"fixed",growthY:"fixed"},document:{width:d,height:m},...(S==null?void 0:S.collision)!==void 0?{collision:S.collision}:{}})},C=S&&S.mode==="variable"?_(F):null;if(C&&n.remeasure){let O=C.objects.filter(W=>{let ee=h.find(te=>te.id===W.id);return ee!==void 0&&Math.abs(ee.width-W.width)>1});if(O.length>0){let W={...F},ee=!1;for(let te of O){let de=n.remeasure(te.id,te.width);de&&Number.isFinite(de.height)&&Number.isFinite(de.naturalWidth)&&(W[te.id]=de,ee=!0)}ee&&(C=_(W))}}let z=C?C.objects:h,J=C?C.page.width:d,P=C?C.page.height:m,L=z.map((O,W)=>({o:O,i:W})).sort((O,W)=>O.o.zIndex-W.o.zIndex||O.i-W.i),Z=(ye=n.placeholders)!=null?ye:"hide",Q=L.map(({o:O,i:W})=>At(O,W,$,r,Z)).filter(O=>typeof O=="string").join(`
`),se=(we=n.computed)!=null?we:i==null?void 0:i.computed,le=Ft(Ne({...e,meta:{name:i==null?void 0:i.name,...Array.isArray(se)?{computed:se}:{}}})),Se=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${fe((ke=n.title)!=null?ke:l)}</title>
<style>
${Nt(J,P)}
</style>
</head>
<body>
<div class="sheet" data-template-version="${q(String(s))}" data-template-hash="${le}">
${Q}
</div>
</body>
</html>
`,Ae=u.flatMap(O=>O.type==="table"?(Array.isArray(O.cells)?O.cells:[]).map(W=>W==null?void 0:W.text):O.type==="text"||O.type==="field"?[O.text]:[]),Oe=pt(Ae.filter(O=>typeof O=="string"));return{html:Se,refusals:r.list(),variables:Oe,warnings:[...R,...($e=C==null?void 0:C.diagnostics)!=null?$e:[]],objects:z.map(O=>({...O})),page:{width:J,height:P}}}var Bt=/^\s*\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}\s*$/;function rt(e,t){var o;let n=new Map;for(let s of Array.isArray((o=e.meta)==null?void 0:o.placeholders)?e.meta.placeholders:[])s&&typeof s.key=="string"&&n.set(s.key,s);let r=e.objects.map(s=>{var c,d,m,i;if(s.type==="text"||s.type==="field"){let l=Bt.exec(typeof s.text=="string"?s.text:""),u=l?n.get(l[1]):void 0;return{...s,fontFamily:(c=u==null?void 0:u.fontFamily)!=null?c:s.fontFamily,fontSize:typeof(u==null?void 0:u.fontSize)=="number"&&u.fontSize>0?u.fontSize:s.fontSize,fontWeight:(d=u==null?void 0:u.fontWeight)!=null?d:s.fontWeight,fontStyle:(m=u==null?void 0:u.fontStyle)!=null?m:s.fontStyle,fill:(i=u==null?void 0:u.color)!=null?i:s.fill,text:pe(s.text,t)}}if(s.type==="table")return{...s,cells:s.cells.map((l,u)=>{var h;let $=Bt.exec(typeof(l==null?void 0:l.text)=="string"?l.text:""),T=$?n.get($[1]):void 0,R=Math.floor(u/s.columns),g=!!(s.repeat&&R>=s.repeat.startRow&&R<=s.repeat.endRow);return{...l,fontSize:typeof(T==null?void 0:T.fontSize)=="number"&&T.fontSize>0?T.fontSize:l.fontSize,fontWeight:(h=T==null?void 0:T.fontWeight)!=null?h:l.fontWeight,...T!=null&&T.color?{color:T.color}:{},text:g?typeof(l==null?void 0:l.text)=="string"?l.text:"":pe(typeof(l==null?void 0:l.text)=="string"?l.text:"",t)}})};if(s.type==="image-placeholder"){let l=t[s.placeholderRole];return typeof l=="string"&&l.length>0?{...s,src:l}:{...s}}return{...s}});return{...e,objects:r}}function Wt(e,t){let n=JSON.parse(e),r=t?JSON.parse(t):void 0;return ht(n,r)}function vt(e,t,n){var m;let r=JSON.parse(e);if(!r||((m=r.layout)==null?void 0:m.mode)!=="variable")return[];let o=t?JSON.parse(t):{},s=n?JSON.parse(n):[],c=rt(r,o),d=[];for(let i of c.objects){if(i.type!=="text"&&i.type!=="field")continue;let l=i.expansion;if(typeof l!="object"||l===null)continue;let u=l.y,$=i.type==="field"||(u==null?void 0:u.strategy)==="wrap";d.push({id:i.id,kind:"box",text:typeof i.text=="string"?i.text:"",fontFamily:i.fontFamily,fontSize:i.fontSize,fontWeight:i.fontWeight,fontStyle:i.fontStyle,lineHeight:i.lineHeight,charSpacing:i.charSpacing,width:i.width,wrap:$})}for(let i of Mt(r,o,s))d.push({id:i.id,kind:"cell",textAlign:i.textAlign,text:i.text,fontFamily:i.fontFamily,fontSize:i.fontSize,fontWeight:i.fontWeight,fontStyle:"normal",lineHeight:1.2,charSpacing:0,width:i.width,wrap:i.wrap});return d}function zt(e,t,n,r){let o=JSON.parse(e),s=JSON.parse(t),c=n?JSON.parse(n):[],d;if(r)try{let l=JSON.parse(r);l&&typeof l=="object"&&(d=l)}catch{d=void 0}let m=rt(o,s),i=Pt(m,s,{computed:c,measurements:d});return{html:i.html,variables:i.variables,warnings:i.warnings,refusals:i.refusals.map(l=>({field:l.field,value:l.value,reason:l.reason})),page:{width:i.page.width,height:i.page.height}}}var _n="__billkit_measure";function Gt(e){let t=/[^a-zA-Z0-9\s-]/.test(e.fontFamily)?"Arial, sans-serif":`"${e.fontFamily}", Arial, sans-serif`,n=Math.round(e.fontSize*e.lineHeight*100)/100;return["position:absolute","left:-10000px","top:0","visibility:hidden","pointer-events:none","box-sizing:border-box","margin:0","padding:0","border:0",`font-family:${t}`,`font-size:${e.fontSize}px`,`line-height:${n}px`,`font-weight:${e.fontWeight}`,`font-style:${e.fontStyle}`,`letter-spacing:${e.charSpacing/1e3}em`,"word-spacing:normal","text-transform:none","text-indent:0"].join(";")}function Lt(e){let t={};if(!e.length||typeof document=="undefined")return t;let n=document.createElement("div");n.id=_n,n.style.cssText="position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;contain:strict",document.body.appendChild(n);try{for(let r of e){let o=Number.isFinite(r.width)&&r.width>0?r.width:0,s=document.createElement("div");s.setAttribute("style",`${Gt(r)};white-space:pre;width:auto`),s.textContent=r.text,n.appendChild(s);let c=s.getBoundingClientRect().width,d=document.createElement("div");d.setAttribute("style",`${Gt(r)};white-space:${r.wrap?"pre-wrap":"pre"};overflow-wrap:${r.wrap?"break-word":"normal"};width:${o}px`),d.textContent=r.text,r.kind==="cell"&&r.textAlign&&(d.style.textAlign=r.textAlign),n.appendChild(d);let m=d.getBoundingClientRect().height;s.remove(),d.remove(),!(!Number.isFinite(c)||!Number.isFinite(m))&&(t[r.id]={naturalWidth:Math.round(c*100)/100,height:Math.round(m*100)/100})}}finally{n.remove()}return t}if(typeof window!="undefined"){let e=window;e.billkit={deriveForm:Wt,measurePlan:vt,measure:Lt,render:zt}}})();

```

## public/sharekit.js

```js
"use strict";(()=>{var Yt="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";function Ut(){return new RegExp(Yt,"g")}function de(e){let t=[];for(let n of e.matchAll(Ut())){let r=n[1];r&&!t.includes(r)&&t.push(r)}return t}function wt(e){let t=new Set;for(let n of e)for(let r of de(n))t.add(r);return[...t].sort()}var Jt="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";function Zt(){return new RegExp(Jt,"g")}function be(e,t){return e.replace(Zt(),(n,r)=>{let o=t[r];return typeof o=="string"?o:n})}var Qt=/date/i,en=/(total|amount|amt|subtotal|tax|charge|discount|balance|price|rate|fee)/i,tn=/(qty|quantity|count|_no$|^no$|hsn|pincode)/i,nn={qr:"QR Code",gstin:"GSTIN",id:"ID",no:"No.",sku:"SKU",hsn:"HSN",pan:"PAN",msme:"MSME",ifsc:"IFSC"};function rn(e){return e.split(/[_\-.]+/).filter(Boolean).map(t=>{var r;let n=t.toLowerCase();return(r=nn[n])!=null?r:n.charAt(0).toUpperCase()+n.slice(1)}).join(" ")}function on(e,t){return t==="image-placeholder"?"image":Qt.test(e)?"date":en.test(e)?"currency":tn.test(e)?"number":"text"}function Se(e){var s;let t=[],n=new Set,r=new Map;for(let a of Array.isArray((s=e.meta)==null?void 0:s.placeholders)?e.meta.placeholders:[])a&&typeof a.key=="string"&&r.set(a.key,a);let o=(a,c,u,f)=>{var y,w,p;if(n.has(a))return;n.add(a);let m=r.get(a);t.push({key:a,label:m!=null&&m.label?m.label:rn(a),type:(p=(w=(y=m==null?void 0:m.type)!=null?y:f)!=null?w:l.get(a))!=null?p:on(a,c),source:c,objectName:u,maxLength:typeof(m==null?void 0:m.maxLength)=="number"&&m.maxLength>0?m.maxLength:void 0,required:(m==null?void 0:m.required)===!0,defaultValue:typeof(m==null?void 0:m.defaultValue)=="string"?m.defaultValue:void 0,min:typeof(m==null?void 0:m.min)=="number"?m.min:void 0,max:typeof(m==null?void 0:m.max)=="number"?m.max:void 0})},i=a=>a==="text"||a==="number"||a==="date"||a==="currency"||a==="tickmark"||a==="checkbox"?a:void 0,l=new Map;for(let a of e.objects){if(a.type!=="field")continue;let c=i(a.fieldType);c&&l.set(a.key,c)}for(let a of e.objects)if(a.type==="text")for(let c of de(typeof a.text=="string"?a.text:""))o(c,"text",a.name);else if(a.type==="table")for(let c of Array.isArray(a.cells)?a.cells:[])for(let u of de(c&&typeof c.text=="string"?c.text:""))o(u,"table",a.name);else a.type==="image-placeholder"?o(a.placeholderRole,"image-placeholder",a.name):a.type==="field"&&o(a.key,"field",a.name,i(a.fieldType));return t}function He(e,t){var r,o;let n=[];for(let i of e){let l=(o=(r=t[i.key])==null?void 0:r.trim())!=null?o:"";if(i.required&&!l){n.push(`${i.label} is required.`);continue}if(l){if(i.maxLength&&l.length>i.maxLength&&n.push(`${i.label} must be ${i.maxLength} characters or fewer.`),i.type==="number"||i.type==="currency"){let s=Number(l);Number.isFinite(s)?(i.min!==void 0&&s<i.min&&n.push(`${i.label} must be at least ${i.min}.`),i.max!==void 0&&s>i.max&&n.push(`${i.label} must be no more than ${i.max}.`)):n.push(`${i.label} must be a valid number.`)}if(i.type==="date"){let s=/^(\d{4})-(\d{2})-(\d{2})$/.exec(l),a=s?Number(s[1]):0,c=s?Number(s[2]):0,u=s?Number(s[3]):0,m=[31,a%4===0&&(a%100!==0||a%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];(!s||c<1||c>12||u<1||u>m[c-1])&&n.push(`${i.label} must be a valid date.`)}}}return n}function kt(e,t=[]){var i,l;let n=new Set(t),r=new Set,o=new Set;for(let s of e.objects)if(s.type==="text"||s.type==="field")for(let a of de(s.text))o.add(a);else if(s.type==="table")for(let a=0;a<s.rows;a+=1)for(let c=0;c<s.columns;c+=1){let u=(l=(i=s.cells[a*s.columns+c])==null?void 0:i.text)!=null?l:"",f=s.repeat&&a>=s.repeat.startRow&&a<=s.repeat.endRow;for(let m of de(u))(f?r:o).add(m)}return Se(e).filter(s=>!n.has(s.key)&&!(r.has(s.key)&&!o.has(s.key)))}function $t(e,t,n){var o,i,l;let r=[];for(let s of e.objects){if(s.type!=="table"||!s.repeat)continue;let a;try{a=JSON.parse((o=n[s.repeat.key])!=null?o:"[]")}catch{r.push(`${s.name} rows could not be read.`);continue}if(!Array.isArray(a)){r.push(`${s.name} rows must be a list.`);continue}let c=new Set;for(let f=s.repeat.startRow;f<=s.repeat.endRow;f+=1)for(let m=0;m<s.columns;m+=1)for(let y of de((l=(i=s.cells[f*s.columns+m])==null?void 0:i.text)!=null?l:""))c.add(y);let u=t.filter(f=>c.has(f.key));a.length===0&&u.some(f=>f.required)&&r.push(`${s.name}: add at least one item row.`),a.forEach((f,m)=>{if(typeof f!="object"||f===null||Array.isArray(f))return;let y={};for(let[w,p]of Object.entries(f))typeof p=="string"&&(y[w]=p);for(let w of He(u,y))r.push(`${s.name}, row ${m+1}: ${w}`)})}return r}var Tt=/^\s*\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}\s*$/;function Ee(e,t){var o;let n=new Map;for(let i of Array.isArray((o=e.meta)==null?void 0:o.placeholders)?e.meta.placeholders:[])i&&typeof i.key=="string"&&n.set(i.key,i);let r=e.objects.map(i=>{var l,s,a,c;if(i.type==="text"||i.type==="field"){let u=Tt.exec(typeof i.text=="string"?i.text:""),f=u?n.get(u[1]):void 0;return{...i,fontFamily:(l=f==null?void 0:f.fontFamily)!=null?l:i.fontFamily,fontSize:typeof(f==null?void 0:f.fontSize)=="number"&&f.fontSize>0?f.fontSize:i.fontSize,fontWeight:(s=f==null?void 0:f.fontWeight)!=null?s:i.fontWeight,fontStyle:(a=f==null?void 0:f.fontStyle)!=null?a:i.fontStyle,fill:(c=f==null?void 0:f.color)!=null?c:i.fill,text:be(i.text,t)}}if(i.type==="table")return{...i,cells:i.cells.map((u,f)=>{var h;let m=Tt.exec(typeof(u==null?void 0:u.text)=="string"?u.text:""),y=m?n.get(m[1]):void 0,w=Math.floor(f/i.columns),p=!!(i.repeat&&w>=i.repeat.startRow&&w<=i.repeat.endRow);return{...u,fontSize:typeof(y==null?void 0:y.fontSize)=="number"&&y.fontSize>0?y.fontSize:u.fontSize,fontWeight:(h=y==null?void 0:y.fontWeight)!=null?h:u.fontWeight,...y!=null&&y.color?{color:y.color}:{},text:p?typeof(u==null?void 0:u.text)=="string"?u.text:"":be(typeof(u==null?void 0:u.text)=="string"?u.text:"",t)}})};if(i.type==="image-placeholder"){let u=t[i.placeholderRole];return typeof u=="string"&&u.length>0?{...i,src:u}:{...i}}return{...i}});return{...e,objects:r}}function Fe(e){return e===null?"null":Array.isArray(e)?`[${e.map(Fe).join(",")}]`:typeof e=="number"?Number.isFinite(e)?String(e):"null":typeof e=="boolean"?e?"true":"false":typeof e=="string"?JSON.stringify(e):typeof e=="object"?`{${Object.entries(e).filter(([,n])=>n!==void 0).sort(([n],[r])=>n<r?-1:n>r?1:0).map(([n,r])=>`${JSON.stringify(n)}:${Fe(r)}`).join(",")}}`:"null"}var Ye=e=>Number.isInteger(e)&&e>=0&&e<=6?e:2,sn=e=>e!==void 0&&e>="0"&&e<="9",St=/^(-?)(\d*)(?:\.(\d*))?$/;function an(e){if(St.test(e))return e;for(let t=0;t<e.length;t+=1){if(!sn(e[t]))continue;let n=t>0&&e[t-1]==="-";return e.slice(n?t-1:t)}return""}function Ce(e,t){var f,m;let n=Ye(t);if(typeof e!="string"&&typeof e!="number")return 0;let r=typeof e=="number"?String(e):e,o=an(r.replace(/,/g,"").replace(/\s+/g,"")),i=St.exec(o);if(!i)return 0;let l=i[1]==="-"?-1:1,s=i[2]&&i[2].length>0?i[2]:"0",a=(f=i[3])!=null?f:"";if(a.length>n){let y=a.slice(0,n).padEnd(n,"0"),w=Number((m=a[n])!=null?m:"0"),p=Number(n===0?s:`${s}${y}`)||0,h=w>=5?p+1:p;return Number.isSafeInteger(h)?l*h:0}let c=n===0?s:`${s}${a.padEnd(n,"0")}`,u=Number(c);return Number.isSafeInteger(u)?l*u:0}function ln(e,t){let n=Ye(t),r=Math.abs(Math.round(e)),o=e<0?"-":"";if(n===0)return`${o}${r}`;let i=10**n;return`${o}${Math.floor(r/i)}.${String(r%i).padStart(n,"0")}`}function Ue(e,t){let n=e[t];if(typeof n!="string"||n.length===0)return[];try{let r=JSON.parse(n);return Array.isArray(r)?r.filter(o=>typeof o=="object"&&o!==null&&!Array.isArray(o)):[]}catch{return[]}}var jt=new WeakMap;function Ve(e,t){let n=jt.get(e);return n||(n={rows:Object.create(null)},jt.set(e,n)),n.rows[t]||(n.rows[t]=Ue(e,t)),n.rows[t]}var Je=(e,t)=>Object.prototype.hasOwnProperty.call(e,t);function Ne(e,t,n,r){return Je(n,e)?n[e]:Ce(t[e],r)}var qe=(e,t,n)=>Je(n,e)||Object.prototype.hasOwnProperty.call(t,e);function De(e,t,n,r,o){if(o===void 0)return Ne(e,t,n,r);let i=e.indexOf(".");return i<=0?Ce(o[e],r):Ce(o[e.slice(i+1)],r)}var Ke=e=>{let t=e.indexOf(".");return t>0?[e.slice(0,t),e.slice(t+1)]:["",e]};function Xe(e,t,n){let r=e*t;return Number.isSafeInteger(r)?Math.round(r/n):0}function cn(e,t,n,r){return e===void 0?0:Je(n,e)?n[e]*10**(6-r):Ce(t[e],6)}function ve(e,t,n){let r=Ye(n),o=Object.create(null),i=Object.create(null);for(let l of e){if(!l||typeof l.key!="string"||l.key.length===0)continue;let s=Array.isArray(l.args)?l.args.filter(c=>typeof c=="string"):[],a=0;switch(l.op){case"sum":{for(let c of s){let[u]=Ke(c);if(u&&!qe(c,t,o))for(let f of Ve(t,u))a+=De(c,t,o,r,f);else a+=Ne(c,t,o,r)}break}case"sum-times":{let[c,u]=s;if(c&&u){let[f]=Ke(c),[m]=Ke(u),y=qe(c,t,o),w=qe(u,t,o),p=!y&&f?Ve(t,f):[],h=!w&&m?Ve(t,m):[],R=Math.max(p.length,h.length,1);for(let j=0;j<R;j+=1){let L=De(c,t,o,r,p[j]),F=De(u,t,o,r,h[j]);a+=Xe(L,F,10**r)}}break}case"add":case"subtract":case"multiply":{let c=s.map(u=>Ne(u,t,o,r));c.length>0&&(a=c[0]);for(let u=1;u<c.length;u+=1)l.op==="multiply"?a=Xe(a,c[u],10**r):l.op==="add"?a+=c[u]:a-=c[u];break}case"percent":{let c=s.length>0?Ne(s[0],t,o,r):0,u=cn(l.rateKey,t,o,r);a=Xe(c,u,100*10**6);break}default:a=0}o[l.key]=a,i[l.key]=ln(a,r)}return i}var Pe=class{constructor(){this.items=[];this.seen=new Set}add(t,n,r){let o=`${t} ${n} ${r}`;this.seen.has(o)||(this.seen.add(o),this.items.push({field:t,value:n,reason:r}))}list(){return this.items}},dn=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,un=/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|\.\d+)\s*)?\)$/i,fn=/^hsla?\(\s*\d{1,3}(?:deg|rad|turn)?(?:\s*,\s*|\s+)[\d.]+%(?:\s*,\s*|\s+)[\d.]+%(?:\s*(?:,\s*|\s*\/\s*)(?:0|1|0?\.\d+|\.\d+|[\d.]+%))?\s*\)$/i,mn=new Set(["aliceblue","antiquewhite","aqua","aquamarine","azure","beige","bisque","black","blanchedalmond","blue","blueviolet","brown","burlywood","cadetblue","chartreuse","chocolate","coral","cornflowerblue","cornsilk","crimson","cyan","darkblue","darkcyan","darkgoldenrod","darkgray","darkgreen","darkgrey","darkkhaki","darkmagenta","darkolivegreen","darkorange","darkorchid","darkred","darksalmon","darkseagreen","darkslateblue","darkslategray","darkslategrey","darkturquoise","darkviolet","deeppink","deepskyblue","dimgray","dimgrey","dodgerblue","firebrick","floralwhite","forestgreen","fuchsia","gainsboro","ghostwhite","gold","goldenrod","gray","green","greenyellow","grey","honeydew","hotpink","indianred","indigo","ivory","khaki","lavender","lavenderblush","lawngreen","lemonchiffon","lightblue","lightcoral","lightcyan","lightgoldenrodyellow","lightgray","lightgreen","lightgrey","lightpink","lightsalmon","lightseagreen","lightskyblue","lightslategray","lightslategrey","lightsteelblue","lightyellow","lime","limegreen","linen","magenta","maroon","mediumaquamarine","mediumblue","mediumorchid","mediumpurple","mediumseagreen","mediumslateblue","mediumspringgreen","mediumturquoise","mediumvioletred","midnightblue","mintcream","mistyrose","moccasin","navajowhite","navy","oldlace","olive","olivedrab","orange","orangered","orchid","palegoldenrod","palegreen","paleturquoise","palevioletred","papayawhip","peachpuff","peru","pink","plum","powderblue","purple","rebeccapurple","red","rosybrown","royalblue","saddlebrown","salmon","sandybrown","seagreen","seashell","sienna","silver","skyblue","slateblue","slategray","slategrey","snow","springgreen","steelblue","tan","teal","thistle","tomato","turquoise","violet","wheat","white","whitesmoke","yellow","yellowgreen"]);function J(e,t,n,r="color"){if(typeof e!="string")return n.add(r,String(e),"not a string"),t;let o=e.trim();return dn.test(o)||un.test(o)||fn.test(o)||mn.has(o.toLowerCase())||o.toLowerCase()==="transparent"||o.toLowerCase()==="none"||o.toLowerCase()==="currentcolor"?o:(n.add(r,e,"not a recognised colour"),t)}var pe={arial:"Arial, Helvetica, sans-serif",helvetica:"Helvetica, Arial, sans-serif","helvetica neue":'"Helvetica Neue", Helvetica, Arial, sans-serif',"segoe ui":'"Segoe UI", system-ui, Arial, sans-serif',verdana:"Verdana, Geneva, sans-serif",calibri:"Calibri, Carlito, Arial, sans-serif",cambria:"Cambria, Georgia, serif","times new roman":'"Times New Roman", Times, serif',georgia:"Georgia, 'Times New Roman', serif",palatino:'"Palatino Linotype", "Book Antiqua", Palatino, serif',"palatino linotype":'"Palatino Linotype", "Book Antiqua", Palatino, serif',"book antiqua":'"Book Antiqua", Palatino, Georgia, serif',garamond:"Garamond, 'EB Garamond', Georgia, serif","century gothic":'"Century Gothic", Futura, sans-serif',impact:"Impact, 'Arial Narrow Bold', sans-serif","comic sans ms":'"Comic Sans MS", "Comic Sans", cursive',"courier new":'"Courier New", Courier, monospace',courier:'"Courier New", Courier, monospace',"lucida console":'"Lucida Console", Monaco, monospace',monospace:"ui-monospace, Menlo, Consolas, monospace",serif:"Georgia, 'Times New Roman', serif","sans-serif":"Helvetica, Arial, sans-serif"};function Ze(e){if(typeof e!="string")return pe["sans-serif"];let t=e.trim().toLowerCase();if(Object.hasOwn(pe,t))return pe[t];let n=e.replace(/[^A-Za-z0-9 _-]/g,"").trim().slice(0,100);if(n.length===0)return pe["sans-serif"];let r=n.toLowerCase(),o=r.includes("mono")||r.includes("courier")||r.includes("consol")?pe.monospace:r.includes("serif")?pe.serif:pe["sans-serif"];return`"${n}", ${o}`}function oe(e,t=0){return typeof e=="number"&&Number.isFinite(e)?e:t}function Qe(e){return typeof e=="number"&&Number.isFinite(e)?e:0}function et(e){return typeof e!="number"||!Number.isFinite(e)?1:Math.min(1,Math.max(0,e))}var pn={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function ge(e){return e.replace(/[&<>"']/g,t=>{var n;return(n=pn[t])!=null?n:t})}function X(e){return ge(e)}function tt(e){return e.type==="rect"||e.type==="rounded-rect"||e.type==="ellipse"||e.type==="line"||e.type==="hr"||e.type==="vr"||e.type==="polygon"||e.type==="freehand"}function ie(e){let t=e.expansion;if(typeof t!="object"||t===null)return;let n=t;if(!(typeof n.x!="object"||n.x===null)&&!(typeof n.y!="object"||n.y===null))return n}function q(e,t){return typeof e=="number"&&Number.isFinite(e)?e:t}function Rt(e,t,n,r){let o=Math.max(0,n);if(e.mode==="fixed")return{size:t,clipped:o>t+v};let i=e.mode==="bounded"?t+Math.max(0,q(e.maxGrowth,0)):r,l=Math.min(Math.max(t,o),Math.max(t,i));return{size:l,clipped:o>l+v}}var v=.5,At=4;function Ot(e,t){return t.x>=e.x-v&&t.y>=e.y-v&&t.x+t.width<=e.x+e.width+v&&t.y+t.height<=e.y+e.height+v}function gn(e,t){return e.x<t.x+t.width-v&&t.x<e.x+e.width-v&&e.y<t.y+t.height-v&&t.y<e.y+e.height-v}function Le(e){let t=e.container;if(typeof t!="object"||t===null)return;let n=t;if(n.enabled===!0&&!(e.type!=="rect"&&e.type!=="rounded-rect"&&e.type!=="ellipse"))return n}function Be(e){let t=e.layoutParentId;return typeof t=="string"&&t.length>0?t:null}function hn(e){var r,o;let t=e.anchor;if(typeof t!="object"||t===null)return;let n=t;return{horizontal:(r=n.horizontal)!=null?r:"start",vertical:(o=n.vertical)!=null?o:"start",offsets:{leftOffset:q(n.leftOffset,0),rightOffset:q(n.rightOffset,0),topOffset:q(n.topOffset,0),bottomOffset:q(n.bottomOffset,0)}}}function bn(e){var t,n,r,o;return{top:Math.max(0,q((t=e==null?void 0:e.padding)==null?void 0:t.top,0)),right:Math.max(0,q((n=e==null?void 0:e.padding)==null?void 0:n.right,0)),bottom:Math.max(0,q((r=e==null?void 0:e.padding)==null?void 0:r.bottom,0)),left:Math.max(0,q((o=e==null?void 0:e.padding)==null?void 0:o.left,0))}}function Mt(e){var Oe,Me,xe,ye,we,Te,ke,$e,M,_,ne,re,me,at,lt,ct,dt,ut,ft,mt,pt,gt,ht,bt,xt,yt;let t=[],n=d=>{t.includes(d)||t.push(d)},r=q((Oe=e.document)==null?void 0:Oe.width,0),o=q((Me=e.document)==null?void 0:Me.height,0),i=(xe=e.documentPolicy)!=null?xe:yn,l=new Map;for(let d of e.guides)!d||typeof d.id!="string"||l.set(d.id,{guide:d,base:q(d.position,0),cap:q(d.maxDisplacement,Number.POSITIVE_INFINITY)});let s=[];for(let d of e.attachments)if(!(!d||typeof d.id!="string")){if(!l.has(d.guideId)){n(`attachment "${d.id}" names guide "${String(d.guideId)}", which is not declared`);continue}s.push(d)}let a=new Map;for(let d of s){let g=(ye=a.get(d.objectId))!=null?ye:[];g.push(d),a.set(d.objectId,g)}let c=new Map,u=new Map;for(let d of l.keys())c.set(d,new Set),u.set(d,new Set);for(let d of e.objects){let g=ie(d),T=new Set;g!=null&&g.y.growthGuideId&&l.has(g.y.growthGuideId)&&T.add(g.y.growthGuideId),g!=null&&g.x.growthGuideId&&l.has(g.x.growthGuideId)&&T.add(g.x.growthGuideId);let O=new Set;for(let A of(we=a.get(d.id))!=null?we:[])if(!O.has(A.guideId)){O.add(A.guideId);for(let I of T)I!==A.guideId&&((Te=u.get(I))==null||Te.add(A.guideId))}for(let A of T)for(let I of O)I!==A&&((ke=c.get(A))==null||ke.add(I))}let f=xn([...l.keys()],c),m=!1;f===null&&(m=!0,n("layout guide dependencies contain a cycle; those guides were left at their authored positions"));let y=f!=null?f:[...l.keys()],w=new Map,p=new Map;for(let d of e.objects)w.set(d.id,{x:d.x,y:d.y,width:d.width,height:d.height}),p.set(d.id,d);let h=new Map,R=new Set;for(let d of e.objects){let g=ie(d);if(!g)continue;let T=($e=e.measurements)==null?void 0:$e[d.id];if(!T)continue;let O=q(T.naturalWidth,Number.NaN),A=q(T.height,Number.NaN);if(Number.isNaN(O)||Number.isNaN(A)){n(`"${d.id}" has a measurement that is not a finite size; it keeps its authored box`);continue}let I=w.get(d.id),K=i.growthX==="expand"?q(i.maxWidth,Number.MAX_SAFE_INTEGER):Math.max(r-I.x,I.width),k=Number.MAX_SAFE_INTEGER,b=Rt(g.x,I.width,O,K),$=Rt(g.y,I.height,A,k);h.set(d.id,{x:I.x,y:I.y,width:b.size,height:$.size}),(b.clipped||$.clipped)&&R.add(d.id)}let j=new Map;for(let d of e.objects){if(!h.get(d.id))continue;let T=ie(d),O=new Set;T!=null&&T.y.growthGuideId&&l.has(T.y.growthGuideId)&&O.add(T.y.growthGuideId),T!=null&&T.x.growthGuideId&&l.has(T.x.growthGuideId)&&O.add(T.x.growthGuideId);for(let A of(M=a.get(d.id))!=null?M:[])(A.edge==="bottom"||A.edge==="right")&&O.add(A.guideId);O.size>0&&j.set(d.id,O)}let L=new Map;for(let d of e.objects){let g=h.get(d.id);if(g)for(let T of(_=j.get(d.id))!=null?_:[]){let O=l.get(T),I=O.guide.orientation==="horizontal"?g.y+g.height-O.base:g.x+g.width-O.base;L.set(T,Math.max((ne=L.get(T))!=null?ne:0,Math.max(0,I)))}}let F=new Map;for(let d of y){let g=l.get(d),T=m?0:Math.max(0,(re=L.get(d))!=null?re:0);T>g.cap+v&&n(`guide "${d}" reached its maximum displacement of ${g.cap} and stopped there`),F.set(d,g.base+Math.min(T,g.cap))}if(!m)for(let d of e.objects){let g=h.get(d.id);if(!g)continue;let T=w.get(d.id);for(let O of(me=j.get(d.id))!=null?me:[]){let A=l.get(O),I=F.get(O),K=A.guide.orientation==="horizontal",k=K?I-g.y:I-g.x,b=K?T.height:T.width;if((K?g.height:g.width)>k+v){let x=Math.max(b,k);K?g.height=x:g.width=x,R.add(d.id)}}}let B=new Map;for(let d of e.objects){let g=h.get(d.id);B.set(d.id,g?{...g}:{...w.get(d.id)})}let te=(d,g,T,O,A,I,K)=>{let k=T-O,b=Math.abs(A-k)<=v,$=A<k-v,x=b?T:$?A+O:Math.max(A,T),S=Math.min(Math.max(x,I),K);g==="y"?d.height=Math.max(0,S-d.y):d.width=Math.max(0,S-d.x)},C=(d,g,T,O,A,I)=>{let K=T-O,b=Math.abs(A-K)<=v||Math.abs(A-T)<=v?T:A+O;g==="y"?d.y=I?b-d.height:b:d.x=I?b-d.width:b},z=(d,g,T)=>{let O=ie(d),A=O==null?void 0:O[g];if(!A||A.mode!=="bounded")return Number.POSITIVE_INFINITY;let I=Math.max(0,q(A.maxGrowth,0));return g==="y"?T.y+T.height+I:T.x+T.width+I};for(let d of s){let g=B.get(d.objectId);if(!g)continue;let T=l.get(d.guideId),O=F.get(d.guideId),A=w.get(d.objectId),I=T.guide.orientation==="horizontal",K=I?"y":"x";if(I!==(d.edge==="top"||d.edge==="bottom")){n(`attachment "${d.id}" binds the ${d.edge} edge to the ${I?"horizontal":"vertical"} guide "${d.guideId}", which cannot control it`);continue}if((at=j.get(d.objectId))!=null&&at.has(d.guideId))continue;let k=d.edge==="top"?"bottom":d.edge==="bottom"?"top":d.edge==="left"?"right":"left",b=((lt=a.get(d.objectId))!=null?lt:[]).find(P=>P.guideId===d.guideId&&P.edge===k),$=I?d.edge==="bottom"?A.y+A.height:A.y:d.edge==="right"?A.x+A.width:A.x,x=I?g.y+g.height:g.x+g.width,S=z(p.get(d.objectId),K,g),E=Math.max(0,O-T.base),G=d.edge==="bottom"||d.edge==="right";if(b){if(b.id<d.id)continue;n(`"${d.objectId}" has both ${k} and ${d.edge} attached to guide "${d.guideId}"; one box cannot have both edges on one boundary, so it follows the boundary instead`),C(g,K,O,E,$,G);continue}if(d.behavior==="move"){C(g,K,O,E,$,G);continue}G?te(g,K,O,E,$,x,S):C(g,K,O,E,$,G)}if(!m)for(let d of e.objects){if(!tt(d))continue;let g=ie(d);if(!g)continue;let T=B.get(d.id);if(!T)continue;let O=w.get(d.id);for(let A of["y","x"]){let I=g[A].growthGuideId;if(!I||!l.has(I))continue;let K=l.get(I),k=F.get(I);if(k===void 0)continue;let b=A==="y",$=b?O.y+O.height:O.x+O.width;te(T,b?"y":"x",k,Math.max(0,k-K.base),$,Number.NEGATIVE_INFINITY,z(d,A,T))}}if(!m){let d=new Map;for(let k of e.objects){let b=ie(k);d.set(k.id,{y:(b==null?void 0:b.y.growthGuideId)!==void 0&&l.has(b.y.growthGuideId),x:(b==null?void 0:b.x.growthGuideId)!==void 0&&l.has(b.x.growthGuideId)})}let g=new Map;for(let k of e.objects){let b=Be(k);if(!b||!p.has(b)||b===k.id)continue;let $=(ct=g.get(b))!=null?ct:[];$.push(k.id),g.set(b,$)}let T=k=>{let b=0,$=k,x=new Set;for(;$&&!x.has($);){x.add($);let S=Be(p.get($));if(!S||!p.has(S))break;b+=1,$=S}return b},O=e.objects.filter(k=>{var b;return Le(k)!==void 0&&((b=g.get(k.id))!=null?b:[]).length>0}).sort((k,b)=>T(b.id)-T(k.id)),A=(k,b,$)=>{let x=b==="y"?k.maxHeight:k.maxWidth;return x===void 0?Number.POSITIVE_INFINITY:(b==="y"?$.y:$.x)+Math.max(0,q(x,0))};for(let k=0;k<At;k+=1){let b=!1;for(let $ of O){let x=B.get($.id),S=w.get($.id),E=Le($),G=bn(E),P=((dt=g.get($.id))!=null?dt:[]).map(W=>p.get(W)).filter(Boolean);for(let W of["y","x"]){if((W==="y"?(ut=E.growthY)!=null?ut:"content":(ft=E.growthX)!=null?ft:"content")!=="content"||d.get($.id)[W])continue;let Y=W==="y",U=Y?S.y:S.x,ee=Y?S.y+S.height:S.x+S.width,he=Math.max(0,q(Y?E.minHeight:E.minWidth,0)),ce=Math.max(ee,U+he);for(let We of P){let Ie=B.get(We.id),Xt=Y?Ie.y+Ie.height:Ie.x+Ie.width;ce=Math.max(ce,Xt+(Y?G.bottom:G.right))}let je=Math.min(ce,A(E,W,x));je>(Y?x.y+x.height:x.x+x.width)+v&&(Y?x.height=je-x.y:x.width=je-x.x,b=!0)}}if(!b)break;for(let $ of e.objects){let x=Be($);if(!x||!p.has(x))continue;let S=hn($);if(!S)continue;let E=B.get($.id),G=w.get($.id),P=B.get(x),W=w.get(x),ae=P.y+P.height-(W.y+W.height),Y=P.x+P.width-(W.x+W.width);if(S.vertical==="end"&&ae>v){let U=Math.max(0,W.y+W.height-(G.y+G.height));E.y=P.y+P.height-U-E.height}else if(S.vertical==="stretch"&&ae>v){let U=Math.max(0,G.y-W.y),ee=Math.max(0,W.y+W.height-(G.y+G.height));E.y=P.y+U,E.height=Math.max(0,P.y+P.height-ee-E.y)}if(S.horizontal==="end"&&Y>v){let U=Math.max(0,W.x+W.width-(G.x+G.width));E.x=P.x+P.width-U-E.width}else if(S.horizontal==="stretch"&&Y>v){let U=Math.max(0,G.x-W.x),ee=Math.max(0,W.x+W.width-(G.x+G.width));E.x=P.x+U,E.width=Math.max(0,P.x+P.width-ee-E.x)}}}let I=e.objects.filter(k=>tt(k)&&ie(k)!==void 0&&Le(k)===void 0);for(let k=0;k<At;k+=1){let b=!1;for(let $ of I){let x=B.get($.id),S=w.get($.id),E=ie($);for(let G of["y","x"]){if(E[G].mode==="fixed"||d.get($.id)[G])continue;let P=G==="y",W=e.objects.filter(ee=>ee.id!==$.id&&Ot(S,w.get(ee.id))),ae=P?x.y+x.height:x.x+x.width;for(let ee of W){let he=B.get(ee.id),ce=w.get(ee.id),je=P?Math.max(0,S.y+S.height-(ce.y+ce.height)):Math.max(0,S.x+S.width-(ce.x+ce.width)),We=P?he.y+he.height:he.x+he.width;ae=Math.max(ae,We+je)}let Y=z($,G,x),U=Math.min(ae,Y);U>(P?x.y+x.height:x.x+x.width)+v&&(P?x.height=U-x.y:x.width=U-x.x,b=!0)}}if(!b)break}for(let k of e.objects){let b=h.get(k.id);if(!b)continue;let $=Be(k);if($&&p.has($)){let x=p.get($),S=Le(x),E=B.get(x.id),G=b.y+b.height>E.y+E.height+v,P=b.x+b.width>E.x+E.width+v,W=S!==void 0?((mt=S.growthY)!=null?mt:"content")==="content":((gt=(pt=ie(x))==null?void 0:pt.y.mode)!=null?gt:"fixed")!=="fixed",ae=S!==void 0?((ht=S.growthX)!=null?ht:"content")==="content":((xt=(bt=ie(x))==null?void 0:bt.x.mode)!=null?xt:"fixed")!=="fixed";if(G&&!W||P&&!ae){n(`"${k.id}" grew past "${x.id}", which is set to a fixed size; enlarge that box or let it expand`);continue}let Y=(S==null?void 0:S.maxHeight)!==void 0&&G,U=(S==null?void 0:S.maxWidth)!==void 0&&P;if(Y||U){let ee=Y?S.maxHeight:S.maxWidth;n(`"${k.id}" needs more room than "${x.id}" allows; that box is capped at ${ee}px on the ${Y?"vertical":"horizontal"} axis`)}continue}for(let x of e.objects){if(x.id===k.id||!tt(x))continue;let S=ie(x);if(S&&S.y.mode!=="fixed"||!Ot(w.get(x.id),w.get(k.id)))continue;let E=B.get(x.id);(b.y+b.height>E.y+E.height+v||b.x+b.width>E.x+E.width+v)&&n(`"${k.id}" grew past "${x.id}", which is set to a fixed size; enlarge that box or let it expand`)}}if(((yt=e.collision)!=null?yt:"report")==="report")for(let[k,b]of g)for(let $=0;$<b.length;$+=1)for(let x=$+1;x<b.length;x+=1){let S=B.get(b[$]),E=B.get(b[x]);gn(S,E)&&n(`"${b[$]}" overlaps "${b[x]}" inside "${k}"; move one of them or set collision to allow`)}}for(let d of R)n(`"${d}" could not be given the room its content needs; the text was not shrunk to fit`);let D=e.objects.map(d=>{let g=B.get(d.id);return{...d,x:g.x,y:g.y,width:g.width,height:g.height}}),V=0,Q=0;for(let d of D)V=Math.max(V,d.y+d.height),Q=Math.max(Q,d.x+d.width);let le=r,fe=o;if(i.growthY==="expand"){let d=q(i.maxHeight,Number.POSITIVE_INFINITY);fe=Math.min(Math.max(fe,V),d),V>d+v&&n(`the bill grew past the page height limit of ${d} and was cut off there`)}else V>fe+v&&n(`content reaches ${Math.round(V)}px but the page is ${Math.round(fe)}px tall`);if(i.growthX==="expand"){let d=q(i.maxWidth,Number.POSITIVE_INFINITY);le=Math.min(Math.max(le,Q),d)}else Q>le+v&&n(`content reaches ${Math.round(Q)}px but the page is ${Math.round(le)}px wide`);return{objects:D,page:{width:le,height:fe},guides:e.guides.map(d=>{var g;return{...d,position:(g=F.get(d.id))!=null?g:d.position}}),diagnostics:t}}function xn(e,t){let n=new Map,r=[],o=i=>{var s,a;let l=(s=n.get(i))!=null?s:0;if(l===1)return!1;if(l===2)return!0;n.set(i,1);for(let c of(a=t.get(i))!=null?a:[])if(!o(c))return!1;return n.set(i,2),r.push(i),!0};for(let i of e)if(!o(i))return null;return r}var yn={growthX:"fixed",growthY:"fixed"};function N(e){return String(Math.round(e*100)/100)}function ze(e){return`${e.join("; ")};`}function Re(e){return`id="o${e}"`}function Ae(e,t,n,r=""){return`<div class="${t}" ${Re(e)} style="${X(n)}">${r}</div>`}function wn(e,t){let n=typeof e.id=="string"?e.id:"?";return["position: absolute",`left: ${N(e.x)}px`,`top: ${N(e.y)}px`,`width: ${N(Z(e.width,t,`${n}.width`,0))}px`,`height: ${N(Z(e.height,t,`${n}.height`,0))}px`,`z-index: ${N(Math.round(oe(e.zIndex,0)))}`,`opacity: ${N(et(e.opacity))}`]}function ue(e,t,n=[],r){var u,f;let o=Qe(e.rotation),i=wn(e,t),l=(u=r==null?void 0:r.x)!=null?u:1,s=(f=r==null?void 0:r.y)!=null?f:1,a=Math.abs(l-1)>=.001||Math.abs(s-1)>=.001,c=`scale(${N(l)}, ${N(s)})`;return o!==0&&a?i.push(`transform: rotate(${N(o)}deg) ${c}`,"transform-origin: 50% 50%"):o!==0?i.push(`transform: rotate(${N(o)}deg)`,"transform-origin: 50% 50%"):a&&i.push(`transform: ${c}`,"transform-origin: 0 0"),ze([...i,...n])}var Tn=new Set(["left","center","right"]),kn=/\{\{[^}]*\}\}/g;function Ft(e){return e.replace(kn,"")}function Nt(e,t,n){return typeof e=="string"&&Tn.has(e)?e:(t.add(n,String(e),"not an alignment; falling back to left"),"left")}function $n(e){return e==="middle"?"center":e==="bottom"?"flex-end":"flex-start"}function Z(e,t,n,r){let o=oe(e,r);return o<0?(t.add(n,String(e),"negative length; falling back to zero"),0):o}function It(e,t,n){if(e==null)return 1;let r=oe(e,1);return!Number.isFinite(r)||r<=0?(t.add(n,String(e),"not a positive scale; falling back to 1"),1):r}function jn(e){return Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.width)&&Number.isFinite(e.height)}function Sn(e,t,n){let r=J(e.stroke,"#000000",n,`${e.id}.stroke`),o=J(e.fill,"transparent",n,`${e.id}.fill`),i=Z(e.strokeWidth,n,`${e.id}.strokeWidth`,1),l=e.type==="ellipse"?"50%":`${N(Z(e.cornerRadius,n,`${e.id}.cornerRadius`,0))}px`;return Ae(t,"o",ue(e,n,[`border: ${N(i)}px solid ${r}`,`background: ${o}`,`border-radius: ${l}`]))}function Rn(e,t,n){let r=e.x2-e.x,o=e.y2-e.y,i=Math.hypot(r,o);if(!Number.isFinite(i))return n.add(`${e.id}.endpoint`,`x2=${e.x2},y2=${e.y2}`,"not a finite length"),null;if(i===0)return null;let l=J(e.stroke,"#000000",n,`${e.id}.stroke`),s=Math.max(Z(e.strokeWidth,n,`${e.id}.strokeWidth`,1),.75),c=Math.atan2(o,r)*180/Math.PI+Qe(e.rotation);return Ae(t,"o",ze(["position: absolute",`left: ${N(e.x)}px`,`top: ${N(e.y-s/2)}px`,`width: ${N(i)}px`,`height: ${N(s)}px`,`z-index: ${N(Math.round(oe(e.zIndex,0)))}`,`opacity: ${N(et(e.opacity))}`,`background: ${l}`,"transform-origin: 0 50%",`transform: rotate(${N(c)}deg)`]))}function An(e,t,n){let r=(Array.isArray(e.points)?e.points:[]).filter(s=>Array.isArray(s)&&s.length>=2&&Number.isFinite(s[0])&&Number.isFinite(s[1]));if(r.length<2)return n.add(`${e.id}.points`,String(r.length),"fewer than two finite points"),null;let o=J(e.stroke,"#000000",n,`${e.id}.stroke`),i=Z(e.strokeWidth,n,`${e.id}.strokeWidth`,1),l=X(r.map(s=>`${N(s[0])},${N(s[1])}`).join(" "));return`<svg class="o" ${Re(t)} style="${X(ue(e,n,["overflow: visible"]))}"><polygon points="${l}" fill="${X(J(e.fill,"transparent",n,`${e.id}.fill`))}" stroke="${X(o)}" stroke-width="${N(i)}" /></svg>`}function On(e,t,n){if(typeof e.path!="string"||e.path.trim()==="")return n.add(`${e.id}.path`,String(e.path),"empty path data"),null;let r=J(e.stroke,"#000000",n,`${e.id}.stroke`),o=Z(e.strokeWidth,n,`${e.id}.strokeWidth`,1);return`<svg class="o" ${Re(t)} style="${X(ue(e,n,["overflow: visible"]))}"><path d="${X(e.path)}" fill="none" stroke="${X(r)}" stroke-width="${N(o)}" stroke-linecap="round" stroke-linejoin="round" /></svg>`}function Et(e,t,n,r,o=[],i="hide"){let l=Z(e.fontSize,r,`${e.id}.fontSize`,12),s=N(oe(e.charSpacing,0)/1e3),a=$n(e.textVerticalAlign),c=J(e.fill,"#000000",r,`${e.id}.fill`),u=It(e.scaleX,r,`${e.id}.scaleX`),f=It(e.scaleY,r,`${e.id}.scaleY`),m=e.wrapWidth,y=typeof m=="number"&&m>0?Z(m,r,`${e.id}.wrapWidth`,0):0,w=[y?"white-space: pre-wrap":"white-space: pre",...y?["overflow-wrap: break-word"]:[],`color: ${c}`,`font-family: ${Ze(e.fontFamily)}`,`font-size: ${N(l)}px`,`line-height: ${N(l*oe(e.lineHeight,1.16))}px`,`font-weight: ${e.fontWeight==="bold"?"bold":"normal"}`,`font-style: ${e.fontStyle==="italic"?"italic":"normal"}`,`text-align: ${Nt(e.textAlign,r,`${e.id}.textAlign`)}`,`letter-spacing: ${s}em`],p=be(typeof e.text=="string"?e.text:"",n),h=`<div class="tx" style="${X(ze(["display: flex","flex-direction: column",`justify-content: ${a}`]))}">${ge(i==="hide"?Ft(p):p)}</div>`;return Ae(t,"o t",ue(e,r,[...w,...y?["height: auto"]:[],...o],{x:u,y:f}),h)}function Mn(e,t){return{border:`${N(Z(e.borderWidth,t,`${e.id}.borderWidth`,1))}px solid ${J(e.borderColor,"#000000",t,`${e.id}.borderColor`)}`,padding:`${N(Z(e.padding,t,`${e.id}.padding`,4))}px`,family:Ze(e.fontFamily),headerFill:J(e.headerFill,"transparent",t,`${e.id}.headerFill`),headerInk:J(e.headerTextColor,"#000000",t,`${e.id}.headerTextColor`),cellFill:J(e.cellFill,"transparent",t,`${e.id}.cellFill`),cellInk:J(e.cellTextColor,"#000000",t,`${e.id}.cellTextColor`)}}function In(e,t,n,r,o){let i=o?n.headerInk:n.cellInk,l=typeof(e==null?void 0:e.color)=="string"?J(e.color,i,r,`${t.id}.cellColor`):i;return ze([`border: ${n.border}`,`padding: ${n.padding}`,`font-family: ${n.family}`,`font-size: ${N(Z(e==null?void 0:e.fontSize,r,`${t.id}.cellFontSize`,12))}px`,`font-weight: ${(e==null?void 0:e.fontWeight)==="bold"?"bold":"normal"}`,`color: ${l}`,`background: ${o?n.headerFill:n.cellFill}`,`text-align: ${Nt(e==null?void 0:e.textAlign,r,`${t.id}.cellTextAlign`)}`,"white-space: pre","overflow: hidden"])}function En(e,t,n,r,o="hide"){let i=(Array.isArray(e.colWidths)?e.colWidths:[]).map((p,h)=>Z(p,r,`${e.id}.colWidths[${h}]`,0)),l=(Array.isArray(e.rowHeights)?e.rowHeights:[]).map((p,h)=>Z(p,r,`${e.id}.rowHeights[${h}]`,0)),s=i.reduce((p,h)=>p+h,0);if(i.length===0||!(s>0))return r.add(`${e.id}.colWidths`,String(s),"no usable column widths"),null;let a=Array.isArray(e.cells)?e.cells:[],c=Mn(e,r),u=(p,h)=>{var j;let R=[];for(let L=0;L<i.length;L++){let F=a[p*i.length+L],B=h?"th":"td",te=be(typeof(F==null?void 0:F.text)=="string"?F.text:"",n),C=ge(o==="hide"?Ft(te):te);R.push(`<${B} style="${X(In(F,e,c,r,h))}">${C}</${B}>`)}return`<tr style="height: ${N((j=l[p])!=null?j:0)}px">${R.join("")}</tr>`},f;e.headerRow&&l.length>0?(f=`<thead>${u(0,!0)}</thead>`,l.length>1&&(f+=`<tbody>${l.slice(1).map((p,h)=>u(h+1,!1)).join("")}</tbody>`)):f=`<tbody>${l.map((p,h)=>u(h,!1)).join("")}</tbody>`;let m=i.map(p=>`<col style="width: ${N(p)}px" />`).join(""),y=`<table class="tbl" style="width: ${N(s)}px"><colgroup>${m}</colgroup>${f}</table>`,w={...e,width:s,height:l.reduce((p,h)=>p+h,0)};return Ae(t,"o",ue(w,r),y)}function nt(e){return typeof e=="string"&&(e.startsWith("data:image/")||e.startsWith("blob:")||e.startsWith("https://")||e.startsWith("http://"))}function Fn(e,t,n,r,o="hide"){let i=n[e.placeholderRole],l=nt(i)?i:e.src;return nt(l)?`<img class="o" ${Re(t)} style="${X(ue(e,r,["object-fit: contain"]))}" src="${X(l)}" alt="${X(typeof e.label=="string"?e.label:"")}" />`:o==="hide"?null:Ae(t,"o ph",ue(e,r,["border: 1px dashed #9ca3af","display: flex","align-items: center","justify-content: center","color: #6b7280"]),ge(typeof e.label=="string"?e.label:""))}function Nn(e,t,n){return nt(e.src)?`<img class="o" ${Re(t)} style="${X(ue(e,n,["object-fit: contain"]))}" src="${X(e.src)}" alt="${X(typeof e.name=="string"?e.name:"")}" />`:(n.add(`${e.id}.src`,typeof e.src,"not a safe image source"),null)}function Ct(e,t,n,r,o="hide"){let i=typeof e.id=="string"?e.id:"?",l=String(e.type);if(e.type==="group"||e.visible===!1)return null;if(!jn(e))return r.add(`${i}.box`,`x=${e.x},y=${e.y},w=${e.width},h=${e.height}`,"not a finite box"),null;switch(e.type){case"rect":case"rounded-rect":case"ellipse":return Sn(e,t,r);case"line":case"hr":case"vr":return Rn(e,t,r);case"polygon":return An(e,t,r);case"freehand":return On(e,t,r);case"text":return Et(e,t,n,r,[],o);case"field":{let s=e;return Et({...s,wrapWidth:s.width},t,n,r,["overflow: hidden"],o)}case"table":return En(e,t,n,r,o);case"image-placeholder":return Fn(e,t,n,r,o);case"bill-part":return Nn(e,t,r);default:return r.add(`${i}.type`,l,"unknown object type"),null}}var Cn="\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}",vn=()=>new RegExp(Cn,"g");function Pn(e,t,n){return e.replace(vn(),(r,o)=>{let i=t[o];if(typeof i=="string")return i;if(typeof i=="number"&&Number.isFinite(i))return String(i);let l=n[o];return typeof l=="string"?l:r})}function Ln(e){let t=e.repeat;if(!t||typeof t!="object")return null;let n=t.startRow,r=t.endRow,o=t.key,i=Array.isArray(e.rowHeights)?e.rowHeights:[],l=Array.isArray(e.cells)?e.cells:[],s=typeof e.columns=="number"&&Number.isInteger(e.columns)&&e.columns>0?e.columns:1,a=Math.max(typeof e.rows=="number"&&Number.isInteger(e.rows)&&e.rows>0?e.rows:0,i.length,Math.ceil(l.length/s)),c=m=>({band:{startRow:0,endRow:0,key:"",maxItems:200},why:m});if(typeof n!="number"||!Number.isInteger(n)||n<0)return c("first row is not a row index");if(typeof r!="number"||!Number.isInteger(r)||r<n)return c("last row comes before the first");if(a<=0||r>=a)return c("last row is past the end of the table");if(typeof o!="string"||o.trim().length===0)return c("no items key");let u=t.maxItems,f=typeof u=="number"&&Number.isInteger(u)&&u>0?u:200;return{band:{startRow:n,endRow:r,key:o.trim(),maxItems:f},why:null}}function Bn(e){try{let t=JSON.parse(e);return Array.isArray(t)?t.length:null}catch{return null}}function zn(e,t,n){var L,F,B,te;let r=Ln(e);if(!r)return{table:e,warnings:[]};let{band:o,why:i}=r,l=[];if(i)return l.push(`table "${e.name}" has a repeat band that was ignored: ${i}`),{table:e,warnings:l};let s=typeof e.columns=="number"&&e.columns>0?e.columns:1,a=t[o.key],c=Ue(t,o.key);if(typeof a=="string"&&a.length>0){let C=Bn(a);C===null?l.push(`table "${e.name}" could not read any items from ${o.key}; the repeating rows were dropped`):C>0&&c.length===0&&l.push(`table "${e.name}" read ${C} entries from ${o.key} but none were usable rows; the repeating rows were dropped`)}let u=c;c.length>o.maxItems&&(l.push(`table "${e.name}" received ${c.length} items but ${o.key} is capped at ${o.maxItems}; the extra rows were not drawn`),u=c.slice(0,o.maxItems));let f=Array.isArray(e.cells)?e.cells:[],m=Array.isArray(e.rowHeights)?e.rowHeights:[],y=Math.max(typeof e.rows=="number"&&e.rows>0?e.rows:0,m.length,Math.ceil(f.length/s)),w=(C,z)=>{var D;return(D=f[C*s+z])!=null?D:{text:"",textAlign:"left",fontSize:10,fontWeight:"normal"}},p=[],h=[];for(let C=0;C<o.startRow;C+=1){for(let z=0;z<s;z+=1)p.push(w(C,z));h.push((L=m[C])!=null?L:0)}for(let C of u)for(let z=o.startRow;z<=o.endRow;z+=1){for(let D=0;D<s;D+=1){let V=w(z,D);p.push({...V,text:Pn((F=V.text)!=null?F:"",C,t)})}h.push((B=m[z])!=null?B:0)}for(let C=o.endRow+1;C<y;C+=1){for(let z=0;z<s;z+=1)p.push(w(C,z));h.push((te=m[C])!=null?te:0)}let R=h.reduce((C,z)=>C+z,0),j=typeof e.y=="number"&&Number.isFinite(e.y)?e.y:0;return Number.isFinite(n)&&n>0&&j+R>n&&l.push(`table "${e.name}" ends at ${Math.round(j+R)} but the page is ${Math.round(n)} tall; the last rows will print off the page`),{table:{...e,rows:h.length,rowHeights:h,cells:p,height:R,repeat:void 0},warnings:l}}function _e(e,t,n){let r=[];return{objects:e.map(i=>{if(i.type!=="table")return i;let{table:l,warnings:s}=zn(i,t,n);return r.push(...s),l}),warnings:r}}var _n=.01;function vt(e,t,n){return`${e}|${t}|${n}`}function Ge(e){let t=e.expansion;if(typeof t!="object"||t===null)return!1;let n=t.y;if(typeof n!="object"||n===null)return!1;let r=n.mode;if(r!=="bounded"&&r!=="unbounded")return!1;let o=n,i={mode:o.mode};return typeof o.maxGrowth=="number"&&Number.isFinite(o.maxGrowth)&&(i.maxGrowth=o.maxGrowth),i}function Pt(e,t,n=[],r=2){var a;let o=e.document,i=typeof(o==null?void 0:o.height)=="number"?o.height:0,{objects:l}=_e(Array.isArray(e.objects)?e.objects:[],{...t,...ve(n,t,r)},i),s=[];for(let c of l){if(c.type!=="table"||!Ge(c))continue;let f=c,m=f.columns>0?f.columns:1,y=Array.isArray(f.colWidths)?f.colWidths:[],w=Array.isArray(f.cells)?f.cells:[],p=f.rows>0?f.rows:Math.ceil(w.length/m);for(let h=0;h<p;h+=1)for(let R=0;R<m;R+=1){let j=w[h*m+R];if(!j)continue;let L=typeof y[R]=="number"&&Number.isFinite(y[R])?y[R]:f.width/m;s.push({id:vt(f.id,h,R),text:typeof j.text=="string"?j.text:"",fontFamily:f.fontFamily,fontSize:typeof j.fontSize=="number"?j.fontSize:10,fontWeight:j.fontWeight==="bold"?"bold":"normal",textAlign:(a=j.textAlign)!=null?a:"left",width:Math.max(0,L-f.padding*2),wrap:!0})}}return s}function Lt(e,t,n={}){let r=e.columns>0?e.columns:1,o=e.rows>0?e.rows:0,i=Array.isArray(e.rowHeights)?e.rowHeights:[],l=new Array(o),s=!1;for(let c=0;c<o;c+=1){let u=typeof i[c]=="number"&&Number.isFinite(i[c])?i[c]:0,f=0;for(let w=0;w<r;w+=1){let p=t[vt(e.id,c,w)];if(!p)continue;let h=p.height;!Number.isFinite(h)||h<0||Number.isFinite(p.naturalWidth)&&h>f&&(f=h)}if(f<=0){l[c]=u;continue}let m=f+e.padding*2,y=Math.max(u,m);typeof n.maxGrowth=="number"&&Number.isFinite(n.maxGrowth)&&(y=Math.min(y,u+Math.max(0,n.maxGrowth))),Math.abs(y-u)<_n&&(y=u),l[c]=y,y!==u&&(s=!0)}if(!s)return e;let a=l.reduce((c,u)=>c+u,0);return{...e,rowHeights:l,height:a}}var Gn=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],Wn=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];function se(e,t){return e>>>t|e<<32-t}function Hn(e){let t=[];for(let n=0;n<e.length;n+=1){let r=e.charCodeAt(n);if(r>=55296&&r<=56319){let o=n+1<e.length?e.charCodeAt(n+1):0;o>=56320&&o<=57343?(r=65536+(r-55296<<10)+(o-56320),n+=1):r=65533}else r>=56320&&r<=57343&&(r=65533);r<128?t.push(r):r<2048?t.push(192|r>>6,128|r&63):r<65536?t.push(224|r>>12,128|r>>6&63,128|r&63):t.push(240|r>>18,128|r>>12&63,128|r>>6&63,128|r&63)}return t}function Vn(e){return(e>>>0).toString(16).padStart(8,"0")}function Bt(e){return qn(Hn(e))}function qn(e){let t=e.slice(),n=t.length*8,r=Math.floor(n/4294967296);for(t.push(128);t.length%64!==56;)t.push(0);t.push(r>>>24&255,r>>>16&255,r>>>8&255,r&255,n>>>24&255,n>>>16&255,n>>>8&255,n&255);let o=Wn.slice(),i=new Array(64).fill(0);for(let l=0;l<t.length;l+=64){for(let p=0;p<16;p+=1){let h=l+p*4;i[p]=t[h]<<24|t[h+1]<<16|t[h+2]<<8|t[h+3]}for(let p=16;p<64;p+=1){let h=i[p-15],R=i[p-2],j=se(h,7)^se(h,18)^h>>>3,L=se(R,17)^se(R,19)^R>>>10;i[p]=i[p-16]+j+i[p-7]+L>>>0}let s=o[0],a=o[1],c=o[2],u=o[3],f=o[4],m=o[5],y=o[6],w=o[7];for(let p=0;p<64;p+=1){let h=se(f,6)^se(f,11)^se(f,25),R=f&m^~f&y,j=w+h+R+Gn[p]+i[p]>>>0,L=se(s,2)^se(s,13)^se(s,22),F=s&a^s&c^a&c,B=L+F>>>0;w=y,y=m,m=f,f=u+j>>>0,u=c,c=a,a=s,s=j+B>>>0}o[0]=o[0]+s>>>0,o[1]=o[1]+a>>>0,o[2]=o[2]+c>>>0,o[3]=o[3]+u>>>0,o[4]=o[4]+f>>>0,o[5]=o[5]+m>>>0,o[6]=o[6]+y>>>0,o[7]=o[7]+w>>>0}return o.map(Vn).join("")}function zt(e,t){return[`@page { size: ${e}px ${t}px; margin: 0; }`,"html, body { margin: 0; padding: 0; background: #fff; }","body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }",`.sheet { position: relative; width: ${e}px; height: ${t}px; overflow: hidden; background: #fff; }`,".o { position: absolute; }",".t { white-space: pre; }",".tx { display: flex; flex-direction: column; }",".tbl { border-collapse: collapse; table-layout: fixed; }",".ph { border: 1px dashed #9ca3af; display: flex; align-items: center; justify-content: center; color: #6b7280; }","* { box-sizing: border-box; }","* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }"].join(`
`)}function _t(e,t,n,r){let o=oe(e,0);return o>0?o:(n.add(`page.${t}`,String(e),"not a positive length; the page falls back to A4"),r)}function Xn(e,t){let n=oe(e,Number.NaN);return Number.isFinite(n)&&n>=0?n:(t.add("templateVersion",String(e),"not a version number; the supported version is emitted instead"),2)}function Gt(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)?e:void 0}function Yn(e,t){let n=e==null?void 0:e.name;if(typeof n=="string")return n;let r=n==null?"Document":String(n);return t.add("meta.name",String(n),`not a string; the document is named ${r}`),r}function it(e,t={},n={}){var xe,ye,we,Te,ke,$e;let r=new Pe,o=oe(e.templateVersion,Number.NaN);if(o>2)throw new Error(`template version ${o} exceeds the renderer's supported ${2}`);let i=Xn(e.templateVersion,r),l=Gt(e.document),s=_t(l==null?void 0:l.width,"width",r,794),a=_t(l==null?void 0:l.height,"height",r,1123),c=Gt(e.meta),u=Yn(c,r),f;Array.isArray(e.objects)?f=e.objects:(r.add("objects",String(e.objects),"not an array; the page renders empty"),f=[]);let m={...t,...ve((xe=n.computed)!=null?xe:[],t,(ye=n.currencyScale)!=null?ye:2)},{objects:y,warnings:w}=_e(f,m,a),p=(we=n.measurements)!=null?we:{},h=y.map(M=>{if(M.type!=="table")return M;let _=Ge(M);return _?Lt(M,p,{..._.maxGrowth!==void 0?{maxGrowth:_.maxGrowth}:{}}):M}),R=e.layout,j={...p};for(let M of h)M.type==="table"&&Ge(M)&&(j[M.id]={naturalWidth:M.width,height:M.height});let L=M=>{var _,ne,re;return Mt({objects:h,measurements:M,guides:(_=R==null?void 0:R.guides)!=null?_:[],attachments:(ne=R==null?void 0:R.attachments)!=null?ne:[],documentPolicy:(re=R==null?void 0:R.document)!=null?re:{growthX:"fixed",growthY:"fixed"},document:{width:s,height:a},...(R==null?void 0:R.collision)!==void 0?{collision:R.collision}:{}})},F=R&&R.mode==="variable"?L(j):null;if(F&&n.remeasure){let M=F.objects.filter(_=>{let ne=h.find(re=>re.id===_.id);return ne!==void 0&&Math.abs(ne.width-_.width)>1});if(M.length>0){let _={...j},ne=!1;for(let re of M){let me=n.remeasure(re.id,re.width);me&&Number.isFinite(me.height)&&Number.isFinite(me.naturalWidth)&&(_[re.id]=me,ne=!0)}ne&&(F=L(_))}}let B=F?F.objects:h,te=F?F.page.width:s,C=F?F.page.height:a,z=B.map((M,_)=>({o:M,i:_})).sort((M,_)=>M.o.zIndex-_.o.zIndex||M.i-_.i),D=(Te=n.placeholders)!=null?Te:"hide",V=z.map(({o:M,i:_})=>Ct(M,_,m,r,D)).filter(M=>typeof M=="string").join(`
`),Q=Bt(Fe({...e,meta:{name:c==null?void 0:c.name}})),fe=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${ge((ke=n.title)!=null?ke:u)}</title>
<style>
${zt(te,C)}
</style>
</head>
<body>
<div class="sheet" data-template-version="${X(String(i))}" data-template-hash="${Q}">
${V}
</div>
</body>
</html>
`,Oe=f.flatMap(M=>M.type==="table"?(Array.isArray(M.cells)?M.cells:[]).map(_=>_==null?void 0:_.text):M.type==="text"||M.type==="field"?[M.text]:[]),Me=wt(Oe.filter(M=>typeof M=="string"));return{html:fe,refusals:r.list(),variables:Me,warnings:[...w,...($e=F==null?void 0:F.diagnostics)!=null?$e:[]],objects:B.map(M=>({...M})),page:{width:te,height:C}}}function Wt(e,t,n){var a;let r=JSON.parse(e);if(!r||((a=r.layout)==null?void 0:a.mode)!=="variable")return[];let o=t?JSON.parse(t):{},i=n?JSON.parse(n):[],l=Ee(r,o),s=[];for(let c of l.objects){if(c.type!=="text"&&c.type!=="field")continue;let u=c.expansion;if(typeof u!="object"||u===null)continue;let f=u.y,m=c.type==="field"||(f==null?void 0:f.strategy)==="wrap";s.push({id:c.id,kind:"box",text:typeof c.text=="string"?c.text:"",fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,fontStyle:c.fontStyle,lineHeight:c.lineHeight,charSpacing:c.charSpacing,width:c.width,wrap:m})}for(let c of Pt(r,o,i))s.push({id:c.id,kind:"cell",textAlign:c.textAlign,text:c.text,fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,fontStyle:"normal",lineHeight:1.2,charSpacing:0,width:c.width,wrap:c.wrap});return s}var Un="__billkit_measure";function Ht(e){let t=/[^a-zA-Z0-9\s-]/.test(e.fontFamily)?"Arial, sans-serif":`"${e.fontFamily}", Arial, sans-serif`,n=Math.round(e.fontSize*e.lineHeight*100)/100;return["position:absolute","left:-10000px","top:0","visibility:hidden","pointer-events:none","box-sizing:border-box","margin:0","padding:0","border:0",`font-family:${t}`,`font-size:${e.fontSize}px`,`line-height:${n}px`,`font-weight:${e.fontWeight}`,`font-style:${e.fontStyle}`,`letter-spacing:${e.charSpacing/1e3}em`,"word-spacing:normal","text-transform:none","text-indent:0"].join(";")}function st(e){let t={};if(!e.length||typeof document=="undefined")return t;let n=document.createElement("div");n.id=Un,n.style.cssText="position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;contain:strict",document.body.appendChild(n);try{for(let r of e){let o=Number.isFinite(r.width)&&r.width>0?r.width:0,i=document.createElement("div");i.setAttribute("style",`${Ht(r)};white-space:pre;width:auto`),i.textContent=r.text,n.appendChild(i);let l=i.getBoundingClientRect().width,s=document.createElement("div");s.setAttribute("style",`${Ht(r)};white-space:${r.wrap?"pre-wrap":"pre"};overflow-wrap:${r.wrap?"break-word":"normal"};width:${o}px`),s.textContent=r.text,r.kind==="cell"&&r.textAlign&&(s.style.textAlign=r.textAlign),n.appendChild(s);let a=s.getBoundingClientRect().height;i.remove(),s.remove(),!(!Number.isFinite(l)||!Number.isFinite(a))&&(t[r.id]={naturalWidth:Math.round(l*100)/100,height:Math.round(a*100)/100})}}finally{n.remove()}return t}function Jn(e){return e.type==="table"&&typeof e.repeat=="object"&&e.repeat!==null}function Vt(e){let t=e.objects.filter(Jn);if(t.length===0)return[];let n=new Set(["tax","tax_amount","tax_rate","discount","discount_amount","discount_rate"]),r=Se(e).some(i=>n.has(i.key)),o=[{key:"subtotal",op:"sum",args:t.map(i=>`${i.repeat.key}.amount`)}];return r||o.push({key:"total",op:"add",args:["subtotal"]}),o}var Zn=new Set(["image/png","image/jpeg","image/webp"]);async function qt(e){if(!Zn.has(e.type))throw new Error("Choose a PNG, JPG, or WebP image.");if(e.size<=0||e.size>20971520)throw new Error("The image must be smaller than 20 MB.");let t;try{t=await createImageBitmap(e)}catch{throw new Error("This image could not be decoded. Try exporting it as PNG or JPG.")}let n=t.width*t.height,r=t.width,o=t.height;if(t.close(),r>2e4||o>2e4)throw new Error("The image dimensions exceed the editor's 20,000 px page limit. Resize it first.");if(n>4e7)throw new Error("The image is too large to edit. Resize it to 40 megapixels or less first.");return new Promise((i,l)=>{let s=new FileReader;s.onload=()=>{typeof s.result=="string"?i(s.result):l(new Error("The image could not be read."))},s.onerror=()=>l(new Error("The image could not be read.")),s.onabort=()=>l(new Error("Image loading was cancelled.")),s.readAsDataURL(e)})}var Qn=`
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
`,er=[{title:"Text fields",source:"text"},{title:"Fields",source:"field"},{title:"Table cells",source:"table"},{title:"Images & signatures",source:"image-placeholder"}],tr=[{value:"",label:"\u2014"},{value:"\u2713",label:"\u2713"},{value:"\u2717",label:"\u2717"}],Dt="\u2713";function H(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}function nr(e,t,n,r){let o=H("form");o.addEventListener("submit",l=>l.preventDefault());let i=er.map(l=>({title:l.title,items:e.filter(s=>s.source===l.source)})).filter(l=>l.items.length>0);if(i.length===0)return o.append(H("p","empty","This template has no dynamic placeholders, so there is nothing to fill. Print it as it is.")),o;for(let l of i){let s=H("div","group");s.append(H("h2",void 0,l.title));for(let a of l.items)s.append(rr(a,t,n,r));o.append(s)}return o}function rr(e,t,n,r){let o=H("label","field"),i=H("span");if(i.append(document.createTextNode(e.label)),e.label!==e.key){let a=H("em");a.textContent=` ${e.key}`,i.append(a)}o.append(i);let l=H("div"),s;if(e.type==="image"){let a=H("input");a.type="file",a.accept="image/png,image/jpeg,image/webp",a.addEventListener("change",()=>{let c=a.files&&a.files[0];a.value="",c&&qt(c).then(u=>{let f=l.querySelector("img"),m=H("img","thumb");m.alt=e.label,m.src=u,f?f.replaceWith(m):l.append(m),n[e.key]=u,t()}).catch(u=>{r(u instanceof Error?u.message:"Could not read this image.")})}),s=a}else if(e.type==="tickmark"){let a=H("select");for(let c of tr){let u=H("option",void 0,c.label);u.value=c.value,a.append(u)}a.addEventListener("input",t),s=a}else if(e.type==="checkbox"){let a=H("input");a.type="checkbox",a.value=Dt,a.addEventListener("input",t),s=a}else e.type==="date"?(s=H("input"),s.type="date",s.addEventListener("input",t)):e.type==="number"||e.type==="currency"?(s=H("input"),s.type="number",s.step="any",e.min!==void 0&&(s.min=String(e.min)),e.max!==void 0&&(s.max=String(e.max)),s.addEventListener("input",t)):(s=H("input"),s.type="text",e.maxLength&&(s.maxLength=e.maxLength),s.addEventListener("input",t));return s.name=e.key,l.append(s),o.append(l),e.source==="image-placeholder"&&o.append(H("p","hint","image slot")),s.required=e.required===!0,e.defaultValue!==void 0&&(s instanceof HTMLInputElement&&s.type==="checkbox"?s.checked=e.defaultValue===Dt:s.value=e.defaultValue),s instanceof HTMLInputElement&&(e.type==="number"||e.type==="currency")&&(s.step="any",e.min!==void 0&&(s.min=String(e.min)),e.max!==void 0&&(s.max=String(e.max))),o}function Kt(e,t,n){var R;let r=H("style");r.textContent=Qn,document.head.append(r);let o=Vt(t),i=new Set(o.map(j=>j.key)),l=Se(t),s=kt(t,[...i]),a={},c=[],u=H("header"),f=H("h1",void 0,((R=t.meta)==null?void 0:R.name)||"Document"),m=H("button","primary","Print / Save as PDF");u.append(f,m);let y=H("div");y.id="status";let w=H("main"),p=()=>{let j={...a};for(let D of Array.from(e.querySelectorAll("input,select"))){let V=D;if(!V.name||V.type==="file")continue;let Q=V.type==="checkbox"?V.checked?V.value:"":V.value;Q!==""&&(j[V.name]=Q)}let L=Ee(t,j);c=[...He(s,j),...$t(t,l,j)];let F=Wt(JSON.stringify(L),JSON.stringify(j),JSON.stringify(o)),B=st(F),C=it(L,void 0,{computed:o,measurements:B,remeasure:(D,V)=>{let Q=F.find(le=>le.id===D);if(Q)return st([{...Q,width:V}])[D]}});n.srcdoc=C.html;let z=C.variables.filter(D=>!(D in j)||!j[D]);y.textContent=c.length?c.join(" "):z.length?`${z.length} placeholder${z.length===1?"":"s"} still empty: ${z.join(", ")}`:"All placeholders filled."},h=nr(s,p,a,j=>{y.textContent=j});e.replaceChildren(u,w),w.append(h,n),e.append(y),m.addEventListener("click",()=>{var j,L;p(),!c.length&&((j=n.contentWindow)==null||j.focus(),(L=n.contentWindow)==null||L.print())}),p()}typeof window!="undefined"&&(window.bootShareKit=Kt);})();

```
