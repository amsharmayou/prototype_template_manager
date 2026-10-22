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
