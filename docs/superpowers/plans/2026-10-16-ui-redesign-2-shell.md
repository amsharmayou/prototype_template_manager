# UI Redesign, Plan 2 — App Bar, Step Path, Shell & Tool Rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor gets its new skeleton — a 4-column shell (tool rail · context · stage · inspector), an app bar with 13 actions reduced to 4, and the five-step guide derived from real document state — with every existing control still reachable and every e2e spec re-pointed in the same task as the rename it follows.

**Architecture:** A pure, node-tested module (`lib/client/steps.ts`) derives step completion from editor facts; `BillEditor` owns the current step, auto-advancing only when the current step's own fact flips (manual selection sticks). The app bar becomes presentational (menus aside) with save/share/fill handlers lifted into `BillEditor`. Export items are re-labelled outcome-first in the same file (`ExportMenu.tsx`, default export unchanged).

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4 tokens from Plan 1, `lucide-react`, vitest 3 (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-editor-ui-redesign-design.md` (sections 2, 3, 4, 6, 9, 12)

**Subsequent plans (not this one):** Plan 3 = inspector rename/regroup + per-step context panel contents (ReferencePanel/PlaceholdersPanel/PropertiesPanel words and sections). Plan 4 = remaining `/render` redesign + responsive collapse (the rail's <1200px icon-only mode) + full a11y pass. Written after this lands.

## Global Constraints

- **Colour semantics are load-bearing:** `ledger` (green) means *data / variable / done* and **never fills a button**; `stamp` is delete/errors only; `marker` is warnings only; actions are `ink`.
- **Accessibility floor:** no text below 12px in anything this plan writes; interactive targets ≥32px; icons `aria-hidden`; icon-only buttons carry `aria-label`.
- **No `window.alert` / `window.confirm`.** This plan removes the last two (`TopBar.tsx:74`, `:105`), because it rewrites that file; Plan 4 then only has to verify the sweep.
- **Preserve e2e hooks absolutely:**
  - tool buttons keep `title={`${TOOL_LABELS[tool]} (${SHORT})`}` — specs use `getByTitle(/^Table/i)` etc.;
  - `[data-btm-stage="canvas"]` stays on the stage container (`CanvasStage.tsx`, untouched);
  - `input[type="file"][accept*="image/png"]` and `input[type="file"][accept*="json"]` keep existing on both screens;
  - **no existing assertion is ever deleted — it is re-pointed to the new accessible name in the same task as the rename.**
- **Renames in this plan, and their spec files:**
  | Old | New | Re-pointed in |
  |---|---|---|
  | `Save to My Templates` | `Save` | `e2e/render.spec.ts:74` |
  | `Fill & Render →` | `Fill & print` | `e2e/render.spec.ts:122,148` |
  | `Share as .html` | `Share` | `e2e/share.spec.ts:239,257` |
  | `Export ▾` | `Get a copy ▾` | `e2e/workflow.spec.ts:393,455,2644`, `e2e/tablegrid.spec.ts:275` |
  | `Preview PNG` (menu item) | `A picture` / `PNG image` | `e2e/workflow.spec.ts:444` (`"Preview PNG"` → `"PNG"`) |
  | menu error `span.border-red-200` | `[data-export-error]` | `e2e/workflow.spec.ts:399,2650` |
  Menu items `"SVG"`, `"PDF"`, `"DOCX"`, `"HTML Document"` stay matchable as substrings of their new outcome-first names — assertions unchanged. Menu item `"JSON Template"` → `grab("JSON")` (also `"JSON"` matches only that one item).
- **Do not rename** anything the specs reach by heading/title beyond the table above: panel headings `Appearance`, `Fields`, `Field`, `Group`, `2 objects`, `The selection does not agree on this`, `Grid Settings…`, `Remove Reference`, `Back to Editor` all stay in this plan (Plan 3 owns them).
- **No new test infrastructure.** vitest runs `environment: "node"`, `include: ["tests/**/*.test.ts"]`.
- **Commits are user-gated** in this session (system policy): do not run `git commit`. Each task lists the suggested commit message for when the user asks.
- **Shell notes (Windows):** `npm` is blocked — use `npm.cmd`. Run binaries via `node node_modules/...`.
- **Verification commands** (use exactly these):
  - unit: `node node_modules/vitest/vitest.mjs run`
  - single test: `node node_modules/vitest/vitest.mjs run tests/<file>.test.ts`
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - lint: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
  - e2e: `node node_modules/@playwright/test/cli.js test <spec>` (config uses port 3111)

---

### Task 1: The step model

**Files:**
- Create: `lib/client/steps.ts`
- Create: `tests/steps.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StepId` (`"bill" | "trace" | "mark" | "test" | "share"`), `STEP_ORDER: StepId[]`, `STEP_LABELS: Record<StepId, string>`, `StepFacts` interface, `STEP_COMPLETE: Record<StepId, (facts: StepFacts) => boolean>`, `stepDone(facts): Record<StepId, boolean>`, `firstIncomplete(done): StepId | null` — all from `@/lib/client/steps`. Tasks 3 and 5 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  STEP_COMPLETE,
  STEP_ORDER,
  firstIncomplete,
  stepDone,
  type StepFacts,
} from "@/lib/client/steps";

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  hasReference: false,
  objectCount: 0,
  dataFieldCount: 0,
  testedOnce: false,
  savedOnce: false,
  ...over,
});

describe("step completion", () => {
  it("starts with nothing done", () => {
    expect(stepDone(facts())).toEqual({
      bill: false,
      trace: false,
      mark: false,
      test: false,
      share: false,
    });
  });

  it("a bill photo completes only the first step", () => {
    const done = stepDone(facts({ hasReference: true }));
    expect(done).toEqual({
      bill: true,
      trace: false,
      mark: false,
      test: false,
      share: false,
    });
  });

  it("drawn objects complete trace but not mark", () => {
    const done = stepDone(facts({ hasReference: true, objectCount: 3 }));
    expect(done.bill).toBe(true);
    expect(done.trace).toBe(true);
    expect(done.mark).toBe(false);
  });

  it("a single data field is enough for mark", () => {
    expect(stepDone(facts({ dataFieldCount: 1 })).mark).toBe(true);
  });

  it("testing and saving are their own facts", () => {
    const done = stepDone(facts({ testedOnce: true, savedOnce: true }));
    expect(done.test).toBe(true);
    expect(done.share).toBe(true);
  });

  it("returns the first incomplete step in reading order", () => {
    expect(firstIncomplete(stepDone(facts()))).toBe("bill");
    expect(firstIncomplete(stepDone(facts({ hasReference: true })))).toBe("trace");
    // A fact out of order (a field with nothing traced) must not skip trace:
    // the path walks the order, not the facts.
    expect(
      firstIncomplete(stepDone(facts({ dataFieldCount: 2 }))),
    ).toBe("bill");
  });

  it("is null once everything is done", () => {
    expect(
      firstIncomplete(
        stepDone(
          facts({
            hasReference: true,
            objectCount: 1,
            dataFieldCount: 1,
            testedOnce: true,
            savedOnce: true,
          }),
        ),
      ),
    ).toBeNull();
  });

  it("every step in the order has a predicate and a label", () => {
    expect(STEP_ORDER).toEqual(["bill", "trace", "mark", "test", "share"]);
    for (const step of STEP_ORDER) {
      expect(typeof STEP_COMPLETE[step]).toBe("function");
      expect(STEP_LABELS[step].length).toBeGreaterThan(0);
    }
  });
});
```

Wait — `STEP_LABELS` must be imported too. Adjust the import block when writing:

```ts
import {
  STEP_COMPLETE,
  STEP_LABELS,
  STEP_ORDER,
  firstIncomplete,
  stepDone,
  type StepFacts,
} from "@/lib/client/steps";
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/steps.test.ts`
Expected: FAIL — cannot resolve `@/lib/client/steps`.

- [ ] **Step 3: Create the module**

Create `lib/client/steps.ts`:

```ts
/**
 * The five-step path, derived from real editor facts.
 *
 * Nothing here is stored state: a step is done because the document shows it, so
 * the guide cannot claim something the editor cannot.
 */
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
  /** A bill photo is loaded as the reference. */
  hasReference: boolean;
  /** At least one object has been drawn. */
  objectCount: number;
  /**
   * Something dynamic exists: a placeholder contract, a data-field object, or
   * a repeating table band on the selected table.
   */
  dataFieldCount: number;
  /** Fill & print was opened at least once since the editor opened. */
  testedOnce: boolean;
  /** Save was used at least once since the editor opened. */
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

/** The first step in reading order that is not complete, or null. */
export function firstIncomplete(done: Record<StepId, boolean>): StepId | null {
  for (const step of STEP_ORDER) if (!done[step]) return step;
  return null;
}
```

- [ ] **Step 4: Run the test again**

Run: `node node_modules/vitest/vitest.mjs run tests/steps.test.ts`
Expected: PASS (9 tests).

Suggested commit: `feat(editor): five-step model derived from real document facts`

---

### Task 2: The app bar — 13 actions to 4, and the last alerts

**Files:**
- Modify: `components/editor/TopBar.tsx` (whole file replaced; new props)
- Modify: `components/editor/ExportMenu.tsx` (whole file replaced; same default export)
- Create: `components/editor/OpenMenu.tsx`
- Create: `lib/client/shareOut.ts`
- Modify: `e2e/render.spec.ts:74,122,148`
- Modify: `e2e/share.spec.ts:239,257`
- Modify: `e2e/tablegrid.spec.ts:275`
- Modify: `e2e/workflow.spec.ts:393,399,413,444,455,2644,2650`

**Interfaces:**
- Consumes: `Button`, `IconButton`, `TextInput` from Plan 1's `Controls.tsx`; `useToast`; `listTemplates`, `loadTemplate` from `@/lib/client/templateStore`.
- Produces: `TopBar` new props — `onSave: () => void`, `onFillAndPrint: () => void`, `onShare: () => void` (plus the existing `controller, state, onOpenImage, onLoadTemplate, onTogglePreview, preview`); `shareTemplateAsHtml(name: string, template: BillTemplate): Promise<void>` from `@/lib/client/shareOut` (throws on failure). Task 5 consumes all three.

- [ ] **Step 1: Create the share helper**

Create `lib/client/shareOut.ts`:

```ts
import { downloadText, safeFilename } from "@/lib/export/download";
import { buildShareDocument } from "@/lib/share/document";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Fetch the built share kit and download one offline HTML file carrying both
 * the kit and the template. Throws when the kit is missing; the caller turns
 * that into a toast that says how to build it.
 */
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

- [ ] **Step 2: Replace `components/editor/ExportMenu.tsx`**

Replace the whole file with the outcome-first copy menu. The default export keeps its name; the file keeps its name so `TopBar`'s import path does not churn.

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

/**
 * Outcome first, format second: the person picking here is deciding what they
 * want to *do* with the bill, not which file extension they need.
 */
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
      // Surface the full stack in development; the UI only shows the message.
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

- [ ] **Step 3: Create `components/editor/OpenMenu.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls";
import { listTemplates, loadTemplate } from "@/lib/client/templateStore";
import type { BillTemplate } from "@/lib/template/types";

/**
 * "Open…" is one button doing two jobs: the templates saved on this device
 * (the same library the fill & print page lists), or any .json from disk.
 */
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

- [ ] **Step 4: Replace `components/editor/TopBar.tsx`**

```tsx
"use client";

import { useRef } from "react";

import { Redo2, Undo2 } from "lucide-react";

import CopyMenu from "./ExportMenu";
import OpenMenu from "./OpenMenu";
import { Button, IconButton, TextInput } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { BillTemplate } from "@/lib/template/types";

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
    <header className="flex items-center gap-2 border-b border-rule bg-paper px-3 py-1.5">
      <h1 className="mr-1 shrink-0 font-display text-[13px] font-semibold text-ink">
        Bill Template Maker
      </h1>
      <label className="sr-only" htmlFor="btm-doc-name">
        Bill name
      </label>
      <TextInput
        id="btm-doc-name"
        value={state.documentName}
        placeholder="Untitled bill"
        onChange={(e) => controller.setDocumentName(e.target.value)}
        className="h-8 w-44 shrink-0"
      />

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
            onLoadTemplate(JSON.parse(await file.text()) as BillTemplate);
          } catch {
            toast({
              kind: "error",
              title: "That file isn't a bill template",
              detail: "Choose a .json file that was saved from this editor.",
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

Notes:
- This deletes both `window.alert`s (the JSON parse error and the share failure) — share failures are now the caller's toast; the parse error toasts here.
- `Load Template` and the old `Export ▾` trigger are gone; the two `.json` inputs still exist (`TopBar`'s hidden one for files, `OpenMenu` reading the local library).
- The old `id="btm-image-input"` hidden input is deleted: the image input in `BillEditor` has always been the live one (`onOpenImage` clicks that ref), and the old one had `onChange={() => undefined}`.

- [ ] **Step 5: Re-point the e2e assertions (same task as the rename)**

- `e2e/render.spec.ts:74`: `{ name: "Save to My Templates" }` → `{ name: "Save", exact: true }`
- `e2e/render.spec.ts:122` and `:148`: `{ name: /Fill & Render/ }` → `{ name: "Fill & print" }`
- `e2e/share.spec.ts:239` and `:257`: `{ name: "Share as .html" }` → `{ name: "Share", exact: true }`
- `e2e/tablegrid.spec.ts:275`: `{ name: /Export/ }` → `{ name: /Get a copy/ }`
- `e2e/workflow.spec.ts:393`, `:455`, `:2644`: `{ name: /Export/ }` → `{ name: /Get a copy/ }`
- `e2e/workflow.spec.ts:399` and `:2650`: `page.locator("span.border-red-200")` → `page.locator("[data-export-error]")`
- `e2e/workflow.spec.ts:413`: `grab("JSON Template")` → `grab("JSON")`
- `e2e/workflow.spec.ts:444`: `grab("Preview PNG")` → `grab("PNG")`
- Leave `grab("SVG")`, `grab("PDF")`, `grab("DOCX")` and `{ name: /HTML Document/ }` untouched — the new accessible names still contain them.

- [ ] **Step 6: Typecheck, then run the four touched specs**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: clean. (If a lucide icon name is unknown, resolve via the shipped alias and re-run.)

Run: `node node_modules/@playwright/test/cli.js test e2e/render.spec.ts e2e/share.spec.ts e2e/tablegrid.spec.ts e2e/workflow.spec.ts`
Expected: all pass. `workflow.spec.ts` has one **pre-existing** failure at line 1817 (`groups objects…`) — grouping shifts exported coordinates; it fails identically on the untouched tree and is not this plan's to fix. Every other test must pass.

- [ ] **Step 7: Lint**

Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Expected: 0 errors.

Suggested commit: `feat(editor): app bar with four actions, outcome-first copy menu, no more alerts`

---

### Task 3: The step path

**Files:**
- Create: `components/editor/StepPath.tsx`

**Interfaces:**
- Consumes: `STEP_ORDER`, `STEP_LABELS`, `StepId` from Task 1; `lucide-react`.
- Produces: default export `StepPath({ done, current, onSelect })` — props exactly `{ done: Record<StepId, boolean>; current: StepId; onSelect: (step: StepId) => void }`. Task 5 renders it.

- [ ] **Step 1: Create the component**

Create `components/editor/StepPath.tsx`:

```tsx
"use client";

import { Fragment } from "react";

import { Check } from "lucide-react";

import { STEP_LABELS, STEP_ORDER, type StepId } from "@/lib/client/steps";

/**
 * A guide, never a gate: every step is always clickable, in any order, and a
 * step only shows as done when the document itself says so.
 */
export default function StepPath({
  done,
  current,
  onSelect,
}: {
  done: Record<StepId, boolean>;
  current: StepId;
  onSelect: (step: StepId) => void;
}) {
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
                // Keep focus on the selected step so arrows read like a tab strip.
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
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Run: `node node_modules/eslint/bin/eslint.js components/editor/StepPath.tsx`
Expected: clean. (Component is not mounted until Task 5; e2e still passes on the old shell.)

Suggested commit: `feat(editor): the five-step path component`

---

### Task 4: The tool rail — grouped, labelled, never off-screen

**Files:**
- Modify: `components/editor/ToolRail.tsx` (whole file replaced)

**Interfaces:**
- Consumes: `TOOL_LABELS`, `ToolId`; `lucide-react`; `Button`.
- Produces: same default export `ToolRail({ controller, activeTool })` with the same props — `BillEditor` mounts it unchanged in Task 5. **Titles must keep starting with the label word**: specs do `getByTitle(/^Table/i)`.

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import type { ReactNode } from "react";

import {
  Braces,
  Check,
  Circle,
  Image,
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
  "image-placeholder": <Image aria-hidden className={iconClass} />,
  "bill-part": <Scissors aria-hidden className={iconClass} />,
  field: <Braces aria-hidden className={iconClass} />,
  eyedropper: <Pipette aria-hidden className={iconClass} />,
};

/**
 * Grouped by what the owner is trying to do, not by what the tool draws.
 * Order within a group is frequency of use.
 */
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

Notes:
- 17 tools in 4 groups at 28px rows + 4 headings fit inside the 900px test viewport with room to spare; the rail scrolls its own overflow with `.editor-scroll` if a window is shorter — it can never push the stage off-screen.
- Icon-only collapse under 1200px is Plan 4.

- [ ] **Step 2: Typecheck, then prove the title hooks survive**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: clean.

Run: `node node_modules/@playwright/test/cli.js test e2e/tabledialog.spec.ts e2e/tableguides.spec.ts`
Expected: all pass (both pick tools by title).

Suggested commit: `feat(editor): grouped tool rail with labels, icons and shortcuts`

---

### Task 5: The shell — context column, stage bar, four columns

**Files:**
- Create: `components/editor/ContextPanel.tsx`
- Create: `components/editor/StageBar.tsx`
- Modify: `components/editor/BillEditor.tsx` (whole file replaced)

**Interfaces:**
- Consumes: `StepPath` (Task 3), `ToolRail` (Task 4), `TopBar` props (Task 2), `steps.ts` (Task 1), `shareTemplateAsHtml` (Task 2), `ReferencePanel`, `PlaceholdersPanel`, `PropertiesPanel`, `LayersPanel`, `CanvasStage` (existing), `GridSettingsDialog`-trigger via callback.
- Produces: the assembled editor shell. `ContextPanel` props — `{ step, controller, state, onOpenGridSettings, onFillAndPrint, onSave, onShare }`. `StageBar` props — `{ controller, state }`.

- [ ] **Step 1: Create `components/editor/ContextPanel.tsx`**

The Grid and Document panels move here verbatim from `BillEditor`; the rest is composition of what already exists.

```tsx
"use client";

import { Button, Panel } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";
import type { StepId } from "@/lib/client/steps";
import { emptyTemplate } from "@/lib/template/types";

import PlaceholdersPanel from "./PlaceholdersPanel";
import ReferencePanel from "./ReferencePanel";

const HINTS: Record<StepId, string> = {
  bill: "This is your bill photo. Next, trace over it.",
  trace: "Draw over the paper — the photo itself is never exported.",
  mark: "Mark what changes each time: fields, variables, repeating rows.",
  test: "Fill in example values and check the printed result.",
  share: "Keep a copy on this device, or hand someone a single file.",
};

/**
 * The column that follows the step. Every control it shows is owned by a step,
 * and the step path is always one click away — the guide opens doors, it does
 * not lock them.
 */
export default function ContextPanel({
  step,
  controller,
  state,
  onOpenGridSettings,
  onFillAndPrint,
  onSave,
  onShare,
}: {
  step: StepId;
  controller: EditorController;
  state: EditorState;
  onOpenGridSettings: () => void;
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
          <DocumentPanel controller={controller} state={state} />
        </>
      ) : null}

      {step === "mark" ? (
        <PlaceholdersPanel controller={controller} state={state} />
      ) : null}

      {step === "test" ? (
        <Panel title="Try it out">
          <p className="text-[12px] leading-relaxed text-ink-soft">
            Fill in example values and see what the printed bill looks like.
            Nothing is kept unless you save it.
          </p>
          <Button variant="primary" size="lg" className="w-full" onClick={onFillAndPrint}>
            Fill &amp; print
          </Button>
        </Panel>
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
}: {
  controller: EditorController;
  state: EditorState;
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

- [ ] **Step 2: Create `components/editor/StageBar.tsx`**

The old `StatusBar`, restyled and with live zoom. It keeps the same information inventory (zoom, page size, objects, selection, sampled colour) and the same control behaviour.

```tsx
"use client";

import { Minus, Plus } from "lucide-react";

import { Button, IconButton } from "@/components/ui/Controls";
import type { EditorController, EditorState } from "@/lib/canvas/EditorController";

/** Under the stage: where the sheet is, and how to look at it. */
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

- [ ] **Step 3: Replace `components/editor/BillEditor.tsx`**

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
import type { BillTemplate } from "@/lib/template/types";

type Stage = "upload" | "editor";

export default function BillEditor() {
  const { controller, state } = useEditorController();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [preview, setPreview] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const handleImage = useCallback(
    (dataUrl: string, name: string) => {
      setStage("editor");
      setPreview(false);
      void controller
        .whenReady()
        .then(() => controller.addReference(dataUrl))
        .then(() => {
          controller.setDocumentName(name.replace(/\.[^.]+$/, ""));
          controller.setGridVisible(true);
          controller.setGridSize(10);
        })
        .catch((e: unknown) => {
          toast({
            kind: "error",
            title: "Could not load that picture",
            detail: e instanceof Error ? e.message : String(e),
          });
        });
    },
    [controller, toast],
  );

  const handleTemplate = useCallback(
    (t: BillTemplate) => {
      setStage("editor");
      setPreview(false);
      void controller.whenReady().then(() => {
        controller.loadTemplate(t);
        const el = controller.getCanvas()?.upperCanvasEl?.parentElement;
        controller.fitToView(el?.clientWidth ?? 800, el?.clientHeight ?? 1000);
      });
    },
    [controller],
  );

  // The no-editor path: pick a template file, hand it straight to the
  // renderer, which derives its dynamic form from the placeholders inside.
  const handleTemplateForRender = useCallback(
    (t: BillTemplate) => {
      setPendingTemplate(t);
      router.push("/render");
    },
    [router],
  );

  const handleSave = useCallback(() => {
    saveTemplate(
      state.documentName || "Untitled bill template",
      controller.getTemplate(),
    );
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

  // ---- The step guide -------------------------------------------------
  const [step, setStep] = useState<StepId>("bill");
  const [testedOnce, setTestedOnce] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const facts: StepFacts = {
    hasReference: state.hasReference,
    objectCount: state.objectCount,
    dataFieldCount:
      state.placeholders.length +
      state.layers.filter((l) => l.type === "field").length +
      (state.selectedTable?.repeat ? 1 : 0),
    testedOnce,
    savedOnce,
  };
  const done = stepDone(facts);

  // Auto-advance only fires when the *current* step's own fact flips from
  // false to true. A click that selects an already-finished step must stick,
  // so selecting resets the remembered value.
  const completedBefore = useRef(done[step]);
  const selectStep = useCallback(
    (next: StepId) => {
      completedBefore.current = done[next];
      setStep(next);
    },
    [done],
  );
  useEffect(() => {
    const was = completedBefore.current;
    completedBefore.current = done[step];
    if (!was && done[step]) {
      const next = firstIncomplete(done);
      if (next && next !== step) setStep(next);
    }
  }, [done, step]);

  // Entering preview hides the reference image; leaving restores whatever the
  // user had chosen before. Declared before the early return so hook order is
  // stable across the upload and editor stages.
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

  if (stage === "upload") {
    return (
      <UploadScreen
        onImage={handleImage}
        onTemplate={handleTemplate}
        onTemplateForRender={handleTemplateForRender}
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
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              void controller.addReference(reader.result);
            }
          };
          reader.readAsDataURL(file);
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
    </div>
  );
}
```

Keep the existing `TablePrompt` and `GridSettingsDialog` functions in this file, byte-identical (they are below the default export today; carry them over unchanged). The old `StatusBar` function is deleted — `StageBar` replaces it.

- [ ] **Step 4: Verify `layers[].type` really says `"field"` for a data field**

`dataFieldCount` counts `l.type === "field"`. Confirm the value rather than trusting it:

Run: `node node_modules/@playwright/test/cli.js test e2e/workflow.spec.ts -g "Field" --reporter=line`
Or inspect live: open the editor, pick the Field tool, draw one, then in the page console:
`window.__btm.getSnapshot().layers.map(l => l.type)`
Expected: includes `"field"`. If it reports something else (e.g. `"Field"`), widen the filter in `facts` to match exactly what the app emits and note it in the commit message.

- [ ] **Step 5: Typecheck, lint, then run the shell-touching specs**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Expected: 0 errors (2 pre-existing warnings tolerated).

Run: `node node_modules/@playwright/test/cli.js test e2e/upload.spec.ts e2e/workflow.spec.ts e2e/tabledialog.spec.ts e2e/layout-guides.spec.ts`
Expected: all pass except the known pre-existing `workflow.spec.ts:1817` grouping failure. `upload.spec.ts`'s "Remove Reference" assertion passes because step ② keeps `ReferencePanel` visible.

Suggested commit: `feat(editor): four-column shell with step path, context column and stage bar`

---

### Task 6: e2e for the new skeleton

**Files:**
- Create: `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: the running editor; the `input[type="file"][accept*="image/png"]` hook; `window.__btm`.

- [ ] **Step 1: Write the spec**

Create `e2e/shell.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * The shell: step guide, app bar save, and the outcome-first copy menu.
 * These run against the same editor the other specs drive; they only assert
 * the new chrome, never the document.
 */
test.describe("editor shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: "bill.png",
        mimeType: "image/png",
        // 4×4 white PNG, so the editor opens with a real reference.
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqkL4KAdn0BNsAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await expect(
      page.getByRole("button", { name: "Remove Reference" }),
    ).toBeEnabled();
  });

  test("the step path marks the bill step done and stands on trace", async ({
    page,
  }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await expect(steps).toBeVisible();

    const bill = steps.getByRole("button", { name: /Your bill/ });
    await expect(bill).toContainText("done");

    const trace = steps.getByRole("button", { name: /Trace/ });
    await expect(trace).toHaveAttribute("aria-current", "step");
  });

  test("clicking a step opens its context and picks its tool", async ({
    page,
  }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await steps.getByRole("button", { name: /Mark data/ }).click();

    await expect(
      steps.getByRole("button", { name: /Mark data/ }),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Placeholders" })).toBeVisible();

    const tool = await page.evaluate(() => window.__btm!.getSnapshot().tool);
    expect(tool).toBe("field");
  });

  test("arrow keys move along the steps", async ({ page }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await steps.getByRole("button", { name: /Your bill/ }).click();
    await page.keyboard.press("ArrowRight");
    await expect(
      steps.getByRole("button", { name: /Trace/ }),
    ).toHaveAttribute("aria-current", "step");
  });

  test("Save keeps a copy on the device and says so", async ({ page }) => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved to this device")).toBeVisible();

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("btm:templates") ?? "[]") as Array<{
        name: string;
      }>,
    );
    expect(saved.length).toBeGreaterThan(0);
  });

  test("Get a copy groups by outcome, format second", async ({ page }) => {
    await page.getByRole("button", { name: /Get a copy/ }).click();

    await expect(page.getByRole("button", { name: "Print it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "A picture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open in Word" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Template for an app" }).first(),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Print it" })).toHaveCount(0);
  });
});
```

Note the type: `window.__btm` is declared in the existing specs via their own `declare global` blocks; if this file needs `window.__btm` typed, copy the same `declare global { interface Window { __btm?: … } }` pattern the specs use — check how `workflow.spec.ts` declares it and reuse it verbatim.

- [ ] **Step 2: Run the spec and fix what it finds**

Run: `node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts`
Expected: 5 passed. If "clicking a step opens its context and picks its tool" shows the tool is not `field`, add the tool selection to `selectStep` in `BillEditor` (map: `mark` → `field`; all other steps leave the tool alone) — that is the spec's "clicking a step selects the matching tool".

Hmm — wait. This test demands behaviour the plan has not built yet: `selectStep` currently only sets the step. Add this to Task 5 Step 3's code instead of discovering it here: **`selectStep` also calls `controller.setTool("field")` when `next === "mark"`**, and nothing else for the other steps. Revise Task 5's `selectStep`:

```tsx
  const selectStep = useCallback(
    (next: StepId) => {
      completedBefore.current = done[next];
      setStep(next);
      // Step ③'s job is marking data; hand the owner the right tool for it.
      if (next === "mark") controller.setTool("field");
    },
    [controller, done],
  );
```

- [ ] **Step 3: Lint**

Run: `node node_modules/eslint/bin/eslint.js e2e`
Expected: 0 errors.

Suggested commit: `test(editor): shell spec for steps, save and the copy menu`

---

### Task 7: Verification and a look for the human

**Files:**
- No source changes expected. Fix anything the suite uncovers, in the task that owns it.

- [ ] **Step 1: Everything at once**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Run: `node node_modules/vitest/vitest.mjs run`
Run: `node node_modules/@playwright/test/cli.js test`
Expected: tsc clean; eslint 0 errors; unit tests pass (932 + 9 new = 941); e2e passes everywhere **except the single pre-existing failure** at `workflow.spec.ts:1817` (grouping shifts exported coordinates — fails identically on the untouched tree; reported to the user, awaiting their call).

- [ ] **Step 2: Screenshots for the human**

With a dev server on 3111, use the Playwright MCP browser to capture, at 1600×900 (the test viewport) or 1440×900:
- the whole editor right after loading the sample bill (`.playwright-mcp/redesign-2-editor.png`)
- step ③ selected, context panel showing data fields (`.playwright-mcp/redesign-2-step-mark.png`)
- the Get a copy menu open (`.playwright-mcp/redesign-2-copy-menu.png`)
- the Save toast (`.playwright-mcp/redesign-2-save-toast.png`)

The model cannot read these; they exist for the user.

- [ ] **Step 3: Report**

Summarise: the four columns, the four actions, the step guide and its honest derivation, the pre-existing grouping failure (unchanged status), and exactly what to look at. Then stop — Plan 3 (inspector rename/regroup + step-context content) is written after the user has seen this.

Suggested commit: none (verification only).
