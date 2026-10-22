# UI Redesign, Plan 3 — Inspector Regroup, Owner Vocabulary & Context Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The inspector starts speaking the owner's language. Every engineering word in the properties panels is replaced with plain words (spec §5), the panels are regrouped into named sections that collapse and jump via a sticky section index, and the per-step context panels (photo, data fields, picture slot) get the same treatment — with every existing control still reachable, and every e2e spec re-pointed in the same task as the rename it follows.

**Architecture:** Structure first, words second. Task 1 adds one new primitive (`Section`: heading + collapse with module-level memory) plus `IndexNav` and `Chip` to `components/ui/Controls.tsx`, converts every inspector `Panel` into a `Section` with a stable id **while keeping the old copy**, and wires the sticky index — so the whole existing suite proves the new skeleton before a single word changes. Tasks 2–4 then change copy file by file (`PropertiesPanel.tsx`, then `LayoutPanel.tsx`, then `ReferencePanel.tsx` + `PlaceholdersPanel.tsx`), each with its own `tests/renameSweep.test.ts` block asserting old words out / new words in, and its e2e re-points in the same task. Task 5 is the full final gate plus screenshots. `Panel` is not deleted: the context column (`ContextPanel`, `ReferencePanel`, `PlaceholdersPanel`) keeps it untouched — collapsible sections are inspector-only.

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4 tokens from Plan 1, `lucide-react` (`ChevronDown`), vitest 3 (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-editor-ui-redesign-design.md` (sections 2, 3, 5, 7, 9, 12)

**Subsequent plans (not this one):** Plan 4 = remaining `/render` redesign + responsive collapse (icon-only tool rail below 1200px) + the full keyboard/screen-reader pass. Explicitly deferred with no home yet: spec §6 (live overlay inside the canvas) and spec §2 ② (canvas coach marks). Neither is built by this plan; flag them when Plan 4 is written.

## Global Constraints

- **Colour semantics are load-bearing:** `ledger` (green) means *data / variable / done* and **never fills a button**; `stamp` is delete/errors only; `marker` is warnings only; actions are `ink`. The one new coloured element in this plan is the variable note in the text panel (`text-ledger` on the token name).
- **Accessibility floor:** no text below 12px in anything this plan writes; interactive targets ≥32px (nav pills and chips are `h-8`); icons `aria-hidden`; icon-only buttons carry `aria-label` (the new Bold/Italic buttons carry `aria-label="Bold"` / `"Italic"`).
- **Preserve e2e hooks absolutely:**
  - tool buttons keep `title={`${TOOL_LABELS[tool]} (${SHORT})`}` — the tool rail is untouched by this plan;
  - `[data-btm-stage="canvas"]` stays; both `input[type="file"]`s stay;
  - these strings **do not change**, and their tests keep passing untouched: `Remove Reference`, `Show reference`, `Whiten paper on new parts`, `Form label`, `Repeat these rows once per item`, `Locked`, `Visible`, `Font`, `Full-span rules`, `Grid Settings…`, `New blank document`, `The selection does not agree on this`, object default names `Bill Part 1` / `Bill Part 2` (unit `tests/packageRoundTrip.test.ts:100,275,414`; e2e `workflow.spec.ts:2624`);
  - **no existing assertion is ever deleted — it is re-pointed to the new accessible name in the same task as the rename.** Queries broken by Task 1's structure change (not by a rename) are re-pointed in Task 1.
- **Do not convert context-column panels to `Section`:** `ContextPanel.tsx`, `ReferencePanel.tsx`, `PlaceholdersPanel.tsx` keep `Panel`; only their copy changes (Tasks 2 and 4). `Panel`'s markup is left byte-identical so the context column renders exactly as before.
- **The color input's `aria-label="Colour"` stays** — `getByLabel("Colour")` counts in `workflow.spec.ts:3129,3192,3193,3286` do not change.
- **The variable-layout words are covered only by the sweep test** — no e2e spec reaches any LayoutPanel string (verified by grep across `e2e/*.spec.ts`); `e2e/layout-guides.spec.ts` drives the built bundle through `window.__btm`, not the UI. Sweep needles in Task 3 must therefore be precise.
- **No new test infrastructure.** vitest runs `environment: "node"`, `include: ["tests/**/*.test.ts"]`.
- **Commits are user-gated** in this session (system policy): do not run `git commit`. Each task lists the suggested commit message for when the user asks.
- **Shell notes (Windows):** `npm` is blocked — use `npm.cmd`. Run binaries via `node node_modules/...`.
- **Verification commands** (use exactly these):
  - unit: `node node_modules/vitest/vitest.mjs run`
  - single test: `node node_modules/vitest/vitest.mjs run tests/<file>.test.ts`
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - lint: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
  - e2e: `node node_modules/@playwright/test/cli.js test <spec>` (config uses port 3111, workers 1)
- **Known pre-existing noise** (do not "fix" here): eslint warnings at `app/render/RenderClient.tsx:143` and `lib/canvas/EditorController.ts:22`; the parked bug `e2e/workflow.spec.ts:1799` (group-local x/y) stays red — **1 failure expected in every full e2e run of this plan**, decision pending with the user.

---

### Task 1: Collapsible sections and the sticky index (structure only, old words)

**Files:**
- Modify: `components/ui/Controls.tsx`
- Modify: `components/editor/PropertiesPanel.tsx`
- Modify: `components/editor/LayoutPanel.tsx`
- Create: `e2e/inspector.spec.ts`
- Modify: `e2e/workflow.spec.ts` (one query re-pointed because the structure changed)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Section({ id, title, children })` — renders `<section id={"inspector-" + id}>` whose heading is a button with `aria-expanded`; collapse memory is a module-level `Set<string>` keyed by `id`, read once via a `useState` lazy initializer. **Exact names other tasks rely on.**
  - `IndexNav({ sections })` — sticky `<nav aria-label="Inspector">` of pill buttons; hidden when `sections.length < 2`; each button scrolls `#inspector-<id>` into view.
  - `Chip({ label, selected, onClick })` — `aria-pressed` toggle pill.
  - `Select` options gain an optional per-option `style`; `Button` gains `label` (→ `aria-label`) and `pressed` (→ `aria-pressed`).
  - Inspector section ids (stable across Tasks 2–4): `properties`, `object`, `size`, `ink`, `text`, `table`, `cell`, `slot`, `data-field`, `cut-out`, `lineup`, `objects`, `group`, `growth`, `follows`, `frame`, `page`, `guides`.

- [x] **Step 1: Add `Section`, `IndexNav`, `Chip` and the `Select`/`Button` extensions to `Controls.tsx`**

In `components/ui/Controls.tsx`, change the lucide import (line 3) to:

```tsx
import { ChevronDown, X } from "lucide-react";
```

Immediately **after** the existing `Panel` component (so `Panel` stays byte-identical for the context column), insert:

```tsx
/**
 * Collapsible inspector section.
 *
 * The heading is a real button inside the `h2`, so the accessible name of the
 * heading stays exactly the section title while also being a control:
 * `getByRole("heading", { name })` and `getByRole("button", { name })` both
 * find it.
 *
 * Collapse state outlives the component on purpose: `SinglePanel` is keyed by
 * object id, so every selection change remounts the sections, and a section the
 * author collapsed must stay collapsed. A module-level set is the smallest
 * thing that survives a remount without an effect.
 */
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
    <section id={`inspector-${id}`} className="scroll-mt-10 border-b border-rule">
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

/**
 * The inspector's sticky table of contents.
 *
 * Pure scroll-to: the sections are already in the DOM, so the index never has
 * to own the layout, and it disappears on its own when a selection has only
 * one section to show (a single-nav index is noise).
 */
export function IndexNav({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  if (sections.length < 2) return null;
  return (
    <nav
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

/** Pressable pill toggle, used for the "what this is" role choices. */
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
```

Change `Select`'s options type (line 154) and the option render (lines 163–167):

```tsx
  options: Array<{ value: string; label: string; style?: React.CSSProperties }>;
```

```tsx
      {options.map((o) => (
        <option key={o.value} value={o.value} style={o.style}>
          {o.label}
        </option>
      ))}
```

Add `label` and `pressed` to `Button` (both optional, so every existing call site is unchanged). The props type gains:

```tsx
  title?: string;
  label?: string;
  pressed?: boolean;
```

and the `<button>` gains:

```tsx
      title={title}
      aria-label={label}
      aria-pressed={pressed}
```

Do **not** touch `Panel`, `Field`, `TextInput`, `NumberInput`, `ColorInput`, `IconButton`, `Checkbox` or `Dialog`.

- [x] **Step 2: Convert every `Panel` in `PropertiesPanel.tsx` to `Section` (structure only)**

Update the import block (lines 7–16) — `Panel` out, `Chip`, `IndexNav`, `Section` in:

```tsx
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
```

Then apply this exact rename table (line numbers are pre-edit; match by text):

| Old opening tag | New opening tag |
|---|---|
| `<Panel title="Properties">` (line 98) | `<Section id="properties" title="Properties">` |
| `<Panel title="Object">` (line 145) | *(splitting — see Step 3)* |
| `<Panel title="Appearance">` (line 253) | `<Section id="ink" title="Appearance">` |
| `<Panel title="Bill Part">` (line 283) | `<Section id="cut-out" title="Bill Part">` |
| `<Panel title="Align">` (line 306) | `<Section id="lineup" title="Align">` |
| `<Panel title="Text">` (line 380) | `<Section id="text" title="Text">` |
| `<Panel title="Table">` (line 521) | `<Section id="table" title="Table">` |
| `return <Panel title="Cell">No active cell.</Panel>;` (line 791) | `return <Section id="cell" title="Cell">No active cell.</Section>;` |
| `<Panel title="Cell">` (line 797) | `<Section id="cell" title="Cell">` |
| `<Panel title="Image Placeholder">` (line 846) | `<Section id="slot" title="Image Placeholder">` |
| `<Panel title="Field">` (line 888) | `<Section id="data-field" title="Field">` |
| `<Panel title="Appearance">` (line 1045) | `<Section id="ink" title="Appearance">` |
| ``<Panel title={`${selected.length} objects`}>`` (line 1167) | ``<Section id="objects" title={`${selected.length} objects`}>`` |
| `<Panel title="Align">` (line 1181) | `<Section id="lineup" title="Align">` |
| `<Panel title="Group">` (line 1203) | `<Section id="group" title="Group">` |

Every `</Panel>` closing tag in the file becomes `</Section>` (15 closings, including the inline `Cell` one above). After this step `grep -c "<Panel" components/editor/PropertiesPanel.tsx` must be `0`.

- [x] **Step 3: Split the old `Object` panel into "Object" and "Size & position"**

The current object panel (lines 145–251) holds Name, Role, the X/Y/Width/Height grid, Rotation, Opacity, Locked, Visible in that order. Replace its opening tag and reorder its children so the panel becomes **two** sections: identity first, geometry second. Keep every control byte-identical; only the order and the wrappers change. The result:

```tsx
      <Section id="object" title="Object">
        <Field label="Name">
          …unchanged Name field (old lines 146–156)…
        </Field>
        <Field label="Role" hint="Semantic tag, e.g. header, title, items, footer">
          …unchanged Role field (old lines 157–168)…
        </Field>
        …unchanged Locked checkbox (old lines 239–245)…
        …unchanged Visible checkbox (old lines 246–250)…
      </Section>

      <Section id="size" title="Size & position">
        …unchanged X/Y/Width/Height grid (old lines 169–211)…
        …unchanged Rotation field (old lines 212–219)…
        …unchanged Opacity field (old lines 220–238)…
      </Section>
```

`Size & position` is a new section and its name is already the final one (spec §5); Tasks 2–4 never touch this title.

- [x] **Step 4: Wire `IndexNav` in `SinglePanel` and `MultiSelectPanel`**

In `SinglePanel`, after the `preview` helper (before `return (`), compute the section list — it must mirror exactly which sections render:

```tsx
  const guides = state.layout?.guides ?? [];
  const doc = state.layout?.document;
  const hasGrowth =
    (doc?.growthX ?? "fixed") !== "fixed" ||
    (doc?.growthY ?? "fixed") !== "fixed" ||
    doc?.maxWidth !== undefined ||
    doc?.maxHeight !== undefined;
  const sections = [
    { id: "object", label: "Object" },
    { id: "size", label: "Size & position" },
    { id: "ink", label: "Appearance" },
    ...(o.type === "text" ? [{ id: "text", label: "Text" }] : []),
    ...(o.type === "table" ? [{ id: "table", label: "Table" }] : []),
    ...(o.type === "image-placeholder"
      ? [{ id: "slot", label: "Image Placeholder" }]
      : []),
    ...(o.type === "field" ? [{ id: "data-field", label: "Field" }] : []),
    ...(o.type === "bill-part" ? [{ id: "cut-out", label: "Bill Part" }] : []),
    { id: "lineup", label: "Align" },
    { id: "growth", label: "Variable layout — growth" },
    ...(guides.length > 0
      ? [{ id: "follows", label: "Variable layout — attachments" }]
      : []),
    { id: "frame", label: "Variable layout — container" },
    ...(state.layout !== undefined || hasGrowth
      ? [{ id: "page", label: "Variable layout — page" }]
      : []),
    ...(guides.length > 0
      ? [
          {
            id: "guides",
            label: `Variable layout — guides (${guides.length})`,
          },
        ]
      : []),
  ];
```

Then render it as the first child of the fragment the function returns (line 143–144, immediately after `return (` and before `<Panel title="Object">` → now `<Section id="object" …>`):

```tsx
    <>
      <IndexNav sections={sections} />
```

Revision note on the conditions (they mirror the real render logic, do not "simplify" them):
- `follows` and `guides` render only when `guides.length > 0` (`AttachSection:447`, `GuidesSection:527` return `null` otherwise) — in `LayoutPanel.tsx`.
- `page` renders when `state.layout !== undefined || hasGrowth`, matching `DocumentSection:629–632`.

In `MultiSelectPanel`, insert the same component before its first panel (current line 1167):

```tsx
    <>
      <IndexNav
        sections={[
          { id: "objects", label: `${selected.length} objects` },
          { id: "ink", label: "Appearance" },
          { id: "lineup", label: "Align" },
          { id: "group", label: "Group" },
        ]}
      />
```

`TableCellPanel` and the empty-selection branch get no `IndexNav` — a single-section index renders `null` anyway. They keep the `Section` wrappers from Step 2 (ids `cell` / `properties`) so every inspector panel is a `Section` without exception.

- [x] **Step 5: Convert the five `Panel`s in `LayoutPanel.tsx` to `Section`**

Update the import (line 3):

```tsx
import { Checkbox, Field, NumberInput, Section, Select } from "@/components/ui/Controls";
```

(`Checkbox` is added now for Task 3; if you prefer a warning-free Task 1, add it in Task 3 instead — either is fine, lint does not flag unused named imports twice.)

Rename table (line numbers pre-edit):

| Old | New |
|---|---|
| `<Panel title="Variable layout — container">` (line 147) | `<Section id="frame" title="Variable layout — container">` |
| `<Panel title="Variable layout — growth">` (line 419) | `<Section id="growth" title="Variable layout — growth">` |
| `<Panel title="Variable layout — attachments">` (line 472) | `<Section id="follows" title="Variable layout — attachments">` |
| ``<Panel title={`Variable layout — guides (${guides.length})`}>`` (line 529) | ``<Section id="guides" title={`Variable layout — guides (${guides.length})`}>`` |
| `<Panel title="Variable layout — page">` (line 635) | `<Section id="page" title="Variable layout — page">` |

All five `</Panel>` closings become `</Section>`. After this step `grep -c "<Panel" components/editor/LayoutPanel.tsx` must be `0`.

- [x] **Step 6: Create `e2e/inspector.spec.ts`**

This spec is deliberately **label-agnostic** — it reads the nav button text at runtime and asserts the matching heading, so Tasks 2–4 never have to touch it. Full file:

```ts
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const FIXTURE = resolve(__dirname, "fixtures/test-bill.png");

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.evaluate(() => window.__btm.setZoom(0.5));
  await page.waitForTimeout(250);
}

async function pickTool(page: Page, name: string): Promise<void> {
  await page.getByTitle(new RegExp(`^${name}`, "i")).click();
  await page.waitForTimeout(80);
}

/** Convert document coordinates into page coordinates, re-read per call. */
async function docToPage(
  page: Page,
): Promise<(x: number, y: number) => Promise<{ x: number; y: number }>> {
  return async (x, y) =>
    page.evaluate(
      ([ax, ay]) => {
        const c = window.__btm;
        const canvas = c.getCanvas()!;
        const r = canvas.upperCanvasEl.getBoundingClientRect();
        const s = c.getSnapshot();
        return {
          x: r.left + s.tx + ax * canvas.getZoom(),
          y: r.top + s.ty + ay * canvas.getZoom(),
        };
      },
      [x, y] as [number, number],
    );
}

/** Draw a rectangle and leave it selected. */
async function drawAndSelectRect(page: Page): Promise<void> {
  await pickTool(page, "Rectangle");
  const P = await docToPage(page);
  const a = await P(120, 120);
  const b = await P(320, 260);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await pickTool(page, "Select");
  const center = await P(220, 190);
  await page.mouse.click(center.x, center.y);
}

declare global {
  interface Window {
    __btm: {
      getCanvas(): {
        upperCanvasEl: HTMLCanvasElement;
        getZoom(): number;
      } | null;
      getSnapshot(): { tx: number; ty: number };
      setZoom(z: number): void;
    };
  }
}

test.describe("Inspector sections", () => {
  test.beforeEach(({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("the index jumps to each section it names", async ({ page }) => {
    await openEditor(page);
    await drawAndSelectRect(page);

    const nav = page.getByRole("navigation", { name: "Inspector" });
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const name = (await buttons.nth(i).innerText()).trim();
      await buttons.nth(i).click();
      // The button's word must be the section's word, and the click must
      // actually bring that section into the viewport.
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeInViewport();
    }
  });

  test("a collapsed section stays collapsed after a detour", async ({ page }) => {
    await openEditor(page);
    await drawAndSelectRect(page);

    const nav = page.getByRole("navigation", { name: "Inspector" });
    await expect(nav).toBeVisible();
    const label = (await nav.getByRole("button").nth(1).innerText()).trim();
    const toggle = page
      .getByRole("heading", { name: label, exact: true })
      .locator("button");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Deselect by clicking empty paper: the single-object panel unmounts, so
    // its state dies with it — only the module-level memory can bring the
    // collapsed section back collapsed.
    const P = await docToPage(page);
    await pickTool(page, "Select");
    const empty = await P(620, 980);
    await page.mouse.click(empty.x, empty.y);
    await expect(nav).toBeHidden();
    const center = await P(220, 190);
    await page.mouse.click(center.x, center.y);

    await expect(
      page
        .getByRole("heading", { name: label, exact: true })
        .locator("button"),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
```

Notes for the implementer:
- **Deviation applied during execution:** the `declare global` block above does not compile — it merges with the richer `__btm` declaration in `e2e/workflow.spec.ts` and fails TS2717, poisoning every sibling spec. The shipped `e2e/inspector.spec.ts` instead uses a local `type Btm` plus inline `window as unknown as` casts — which is what "the pattern of `e2e/shell.spec.ts`" actually is. `workflow.spec.ts` is the only spec that owns the global `__btm` declaration.
- `window.__btm` is declared locally in this spec (same pattern as `e2e/shell.spec.ts:55` and `e2e/tableguides.spec.ts:46`) — do not import from `workflow.spec.ts`.
- `nth(1)` is `Size & position` for a rectangle (sections 0-based: `Object`, `Size & position`, …) — it exists for every object type, and Tasks 2–4 do not rename it.
- The first test doubles as a drift guard: if a nav label and its section title ever disagree, the `heading { name, exact: true }` lookup fails.

- [x] **Step 7: Re-point the one query the structure change breaks**

`e2e/workflow.spec.ts:1362` currently reads:

```ts
    await expect(page.getByText("Object", { exact: true })).toBeVisible();
```

The heading now contains a button and a span, so a text-precision dependency is unnecessary; re-point it in this task (the label itself does not change until Task 2):

```ts
    await expect(
      page.getByRole("heading", { name: "Object", exact: true }),
    ).toBeVisible();
```

No other existing query depends on panel-title text precision: `workflow.spec.ts:1364` (`getByText("Font", { exact: true })`) targets a `Field` label, and every other panel-title query already uses `getByRole("heading", …)`.

**Deviation applied during execution:** `workflow.spec.ts:1885` also needed a re-point — the new section toggle button is named after its title, so `getByRole("button", { name: "Group", exact: true })` inside the Group section hit two elements (strict-mode violation). The shipped query adds `description: "Ctrl+G"` to select the action button.

- [x] **Step 8: Run the gates**

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js components tests e2e
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test e2e/inspector.spec.ts
node node_modules/@playwright/test/cli.js test
```

Expected: typecheck clean; lint 0 errors (2 known warnings); unit 940 passed; `inspector.spec.ts` 2 passed; full e2e **114 passed, 1 failed** — the failure must be exactly the parked `workflow.spec.ts:1799` grouping test. If anything else fails, fix it in this task before moving on.

- [x] **Step 9: Suggested commit (do not run — commits are user-gated)**

```powershell
git add components/ui/Controls.tsx components/editor/PropertiesPanel.tsx components/editor/LayoutPanel.tsx e2e/inspector.spec.ts e2e/workflow.spec.ts
git commit -m "feat(inspector): collapsible sections, a sticky section index and a jump-to-section test"
```

---

### Task 2: Owner words in `PropertiesPanel.tsx`

**Files:**
- Modify: `components/editor/PropertiesPanel.tsx`
- Create: `tests/renameSweep.test.ts`
- Modify: `e2e/workflow.spec.ts` (re-points below)
- Modify: `e2e/billkit.spec.ts` (one re-point)

**Interfaces:**
- Consumes: `Section`, `Chip`, `IndexNav` (Task 1); `Select` per-option `style`, `Button` `label`/`pressed` (Task 1).
- Produces: `FONT_OPTIONS` (`FONTS` plus a per-option `style.fontFamily` for native previews) and `ROLE_CHIPS` (`["header","title","item","total","footer"]`) — module-level in `PropertiesPanel.tsx`; `tests/renameSweep.test.ts` with the `source()` helper Tasks 3–4 reuse.

- [x] **Step 1: Add the constants and the shared Bold/Italic control**

After the `FONTS` array (line 51) insert:

```tsx
/** `FONTS` plus a per-option style, so the native dropdown previews each face. */
const FONT_OPTIONS = FONTS.map((f) => ({
  ...f,
  style: { fontFamily: f.value },
}));

const ROLE_CHIPS = ["header", "title", "item", "total", "footer"] as const;

/**
 * Bold and italic as two pressable buttons.
 *
 * The old weight/style selects asked the author to think of CSS values; these
 * say what they do and show their state at a glance. The undo labels stay
 * "Weight" / "Font style" so existing history semantics are unchanged.
 */
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
```

- [x] **Step 2: Replace the `Role` field with the "What this is" chip row**

**Deviation applied during execution:** the `Chip` import deferred in Task 1 Step 2 was added here, when the chip row first used it.

Inside `Section id="object"`, replace the whole `Field label="Role"` block (old lines 157–168) with:

```tsx
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
```

(A plain `div` with a styled span, not a `Field` — `Field` renders a `<label>` and must not wrap the chip buttons.)

- [x] **Step 3: Empty state copy**

Replace the paragraph inside `Section id="properties"` (old line 99–102):

```tsx
        <p className="text-[12px] leading-relaxed text-ink-soft">
          Nothing selected yet. Click an object on the paper to change how it
          looks.
        </p>
```

- [x] **Step 4: Rewrite `TextPanel`'s return block**

Replace everything from `return (` (old line 379) to the panel close `</Panel>` (old line 491) with the following. The `text` state, `isWrapped`, `apply` helper and the preceding comment stay as they are.

```tsx
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
```

`roleKind` is `"static" | "variable"` and `role` is only set when the whole text is one `{{token}}` (`EditorController.ts:3125–3148`), so `o.role ?? "these values"` is the honest fallback for mixed text — never show `(mixed)`.

- [x] **Step 5: Edit `TablePanel` copy**

Apply these exact replacements (match by text; line numbers pre-edit):

| Old | New |
|---|---|
| `label="Border colour"` (:531) | `label="Line colour"` |
| `label="Border width"` (:541) | `label="Line thickness"` |
| `label="Cell fill"` (:555) | `label="Cell background"` |
| `label="Padding"` (:565) | `label="Cell padding"` |
| `label="Header fill"` (:586) | `label="Header background"` |
| raw label text `First row` (:620) | `From row` |
| raw label text `Last row` (:635) | `To row` |
| `Items key` (:650) | `Data name` |
| `Max items` (:663) | `Maximum` |
| `Repeat header when split` (:687) | `Repeat the header` |
| summary text `Cell contents` (:740) | `Cell text` |
| the five raw labels' `text-[11px]` classes | `text-[12px]` |
| the tip paragraph's `text-[10px]` (:769) | `text-[12px]` (wording unchanged) |

Keep **verbatim**: the heading `Repeating rows`, the checkbox label `Repeat these rows once per item` (`e2e/billkit.spec.ts:78` depends on it), `Rows`, `Columns`, `Header row`, `Column widths`, `Row heights`, `Col 1`/`Row 1`, and the inner `<details>` elements.

- [x] **Step 6: Edit `PlaceholderPanel` and the cut-out panel**

`PlaceholderPanel` (old lines 846–875): change `title="Image Placeholder"` → `title="Picture slot"` and `label="Role"` → `label="What goes here"`. Option list unchanged.

The cut-out block (old lines 283–303): replace with

```tsx
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
```

- [x] **Step 7: Edit `FieldPanel`**

- `title="Field"` → `title="Data field"` (:888).
- `<Field label="Key" hint="Form key, e.g. invoice_date">` → `<Field label="Name" hint="The name this answer is saved under, e.g. invoice_date">` (:889).
- `label="Type"` → `label="Type of answer"` (:903).
- `label="Ink colour"` → `label="Colour"` (hint unchanged) (:922).
- `options={FONTS}` → `options={FONT_OPTIONS}` (:947).
- Delete the `Field label="Weight"` block (:962–976) and the `Field label="Style"` block (:977–991); after the closing `</div>` of the Font/Size grid (:992) insert:

```tsx
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
```

- `label="Align"` → `label="Alignment"` (:993); `label="Custom family"` → `label="Custom font"` (:1009).

- [x] **Step 8: Rename the alignment (`lineup`) sections and the ink section**

**Deviation applied during execution:** the plan renames titles and the `MultiSelectPanel` nav labels, but never the `SinglePanel` `sections` nav array nor the `SinglePanel` `object`/`ink` titles. Both were fixed in this task so the drift guard in `e2e/inspector.spec.ts` stays green — nav labels and titles now agree: object → "This object", ink → "Ink & outline", slot → "Picture slot", data-field → "Data field", cut-out → "Cut-out picture", lineup → "Line up".

Add a module-level constant above `SinglePanel`:

```tsx
const ALIGN_BUTTONS = [
  ["left", "Align left", "⇤ Left"],
  ["center", "Align centre", "⇔ Centre"],
  ["right", "Align right", "⇥ Right"],
  ["top", "Align top", "⤒ Top"],
  ["middle", "Align middle", "⇕ Middle"],
  ["bottom", "Align bottom", "⤓ Bottom"],
] as const;
```

In `SinglePanel`, replace the whole `Section id="lineup"` body (old :306–339) with:

```tsx
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
```

The `title` attributes (`"Align left"`…) are kept deliberately — hover text and `getByTitle` remain stable.

In `MultiSelectPanel`, replace its `Section id="lineup"` body (old :1181–1202) with the same block, and change its `Section id="ink"` wrapper: `MultiAppearancePanel`'s `title="Appearance"` → `title="Ink & outline"` (:1045) with `label="Stroke"` → `label="Line colour"` (:1048), `label="Stroke width"` → `label="Line thickness"` (:1061), `label="Fill"` → `label="Fill colour"` (:1076). In `SinglePanel`'s `Section id="ink"` (:253) apply the same three label renames (:255, :261, :270). Do not touch the `Mixed` component or its title string.

- [x] **Step 9: Create `tests/renameSweep.test.ts` with the PropertiesPanel block**

**Deviation applied during execution:** the Step 1 snippet's comment said "existing history semantics are unchanged" — the `"semantic"` needle above is a substring match, so the shipped comment reads "existing undo entries keep their names" instead (reword the comment, never weaken the needle).

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Source of a repo-relative file, read fresh per call. */
const source = (rel: string): string =>
  readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("PropertiesPanel copy", () => {
  const src = source("components/editor/PropertiesPanel.tsx");

  it("no longer speaks in engineering vocabulary", () => {
    expect(src).not.toContain('title="Object"');
    expect(src).not.toContain('title="Appearance"');
    expect(src).not.toContain('title="Bill Part"');
    expect(src).not.toContain('title="Align"');
    expect(src).not.toContain('title="Image Placeholder"');
    expect(src).not.toContain('title="Field"');
    expect(src).not.toContain('label="Role"');
    expect(src).not.toContain('label="Stroke"');
    expect(src).not.toContain('label="Stroke width"');
    expect(src).not.toContain('label="Fill"');
    expect(src).not.toContain('label="Weight"');
    expect(src).not.toContain('label="Style"');
    expect(src).not.toContain('label="Align"');
    expect(src).not.toContain('label="Custom family"');
    expect(src).not.toContain('label="Insert variable"');
    expect(src).not.toContain('label="Wrap"');
    expect(src).not.toContain("Kind:");
    expect(src).not.toContain("(mixed)");
    expect(src).not.toContain("Recapture from current position");
    expect(src).not.toContain('label="Whiten paper"');
    expect(src).not.toContain('label="Border colour"');
    expect(src).not.toContain('label="Border width"');
    expect(src).not.toContain('label="Cell fill"');
    expect(src).not.toContain('label="Padding"');
    expect(src).not.toContain('label="Header fill"');
    expect(src).not.toContain("First row");
    expect(src).not.toContain("Last row");
    expect(src).not.toContain("Items key");
    expect(src).not.toContain("Max items");
    expect(src).not.toContain("Repeat header when split");
    expect(src).not.toContain("Cell contents");
    expect(src).not.toContain("Distribute H");
    expect(src).not.toContain("Distribute V");
    expect(src).not.toContain("semantic");
  });

  it("uses the owner's words instead", () => {
    expect(src).toContain('title="This object"');
    expect(src).toContain('title="Ink & outline"');
    expect(src).toContain('title="Cut-out picture"');
    expect(src).toContain('title="Line up"');
    expect(src).toContain('title="Picture slot"');
    expect(src).toContain('title="Data field"');
    expect(src).toContain('label="Line colour"');
    expect(src).toContain('label="Line thickness"');
    expect(src).toContain('label="Fill colour"');
    expect(src).toContain("What this is");
    expect(src).toContain("Bold &amp; italic");
    expect(src).toContain('label="Alignment"');
    expect(src).toContain('label="Custom font"');
    expect(src).toContain('label="Insert a variable"');
    expect(src).toContain("Let the text wrap onto more lines");
    expect(src).toContain("This fills from");
    expect(src).toContain('label="Clean the paper to white"');
    expect(src).toContain("Take it again from the photo");
    expect(src).toContain('label="What goes here"');
    expect(src).toContain("Space evenly (H)");
    expect(src).toContain("Space evenly (V)");
    expect(src).toContain("From row");
    expect(src).toContain("To row");
    expect(src).toContain("Data name");
    expect(src).toContain("Cell text");
    expect(src).toContain("Nothing selected yet");
  });

  it("keeps the strings the e2e suite and the round-trip test rely on", () => {
    expect(src).toContain("Repeat these rows once per item");
    expect(src).toContain('label="Locked"');
    expect(src).toContain('label="Visible"');
    expect(src).toContain('label="Font"');
    expect(src).toContain('label="Name"');
    expect(src).toContain("Fixed text");
  });
});
```

If any comment in the file legitimately contains a forbidden word, reword the comment (comments in this file are ours); never weaken the needle.

- [x] **Step 10: Re-point the e2e specs in the same task**

**Deviation applied during execution:** `workflow.spec.ts:1367` needed `{ exact: true }` — the re-pointed `getByText("Custom font")` also matched the hint text "Any installed face, e.g. My Custom Font" (substring match), a strict-mode violation. The stale `hasText` comment blocks above the two wrap-checkbox re-points were removed with the workaround they explained.

`e2e/workflow.spec.ts`:
1. `:1362` heading `"Object"` → `"This object"` (re-pointed once already in Task 1; only the name changes now).
2. `:1365` `page.getByText("Custom family")` → `page.getByText("Custom font")`.
3. `:1387` heading `{ name: "Field", exact: true }` → `{ name: "Data field", exact: true }` (inside the `fieldPanel = page.locator("section").filter(...)` construction).
4. `:1390`, `:1393` `fieldPanel.getByLabel("Align")` → `fieldPanel.getByLabel("Alignment")`.
5. Search `"Wrap at this width"` (≈:1948): replace the button click with the checkbox call
   ```ts
   await panel.getByLabel("Let the text wrap onto more lines").check();
   ```
   and update the adjacent comment (it explains a `hasText` button workaround that no longer exists).
6. Search `"click to unwrap"` (≈:2014, :2016): the first click is the same `.check()` as above; the second, which used to re-wrap, becomes
   ```ts
   await panel.getByLabel("Let the text wrap onto more lines").uncheck();
   ```
7. `:2280` `page.getByLabel("Whiten paper", { exact: true })` → `page.getByLabel("Clean the paper to white", { exact: true })`. (`setNewPartWhitening` at :2271–2272 stays — that is the ReferencePanel string.)
8. `:2439`, `:2561`, `:2770`, `:2795` button name `"Recapture from current position"` → `"Take it again from the photo"` (a `hasText`/`name` string each; `:2568`'s force-click is unaffected).
9. `:3100` heading `"Appearance"` → `"Ink & outline"`.
10. `:3102`, `:3185`, `:3187`, `:3194`, `:3200` `getByLabel("Stroke width")` → `getByLabel("Line thickness")`.

`e2e/billkit.spec.ts`:
11. `:83` `page.getByLabel("Last row")` → `page.getByLabel("To row")`.

Do **not** touch `e2e/inspector.spec.ts` — it is label-agnostic by design.

- [x] **Step 11: Run the gates**

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js components tests e2e
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test e2e/inspector.spec.ts e2e/billkit.spec.ts
node node_modules/@playwright/test/cli.js test
```

Expected: typecheck clean; lint 0 errors (2 known warnings); unit all pass (previous 940 + the 3 new sweep tests); `inspector` 2 passed; `billkit` spec fully green; full e2e **114 passed, 1 failed** — the parked `:1799` only.

- [x] **Step 12: Suggested commit (do not run — commits are user-gated)**

```powershell
git add components/editor/PropertiesPanel.tsx tests/renameSweep.test.ts e2e/workflow.spec.ts e2e/billkit.spec.ts
git commit -m "feat(inspector): plain-language object, text, table and field panels"
```

---

### Task 3: Owner words in `LayoutPanel.tsx`

**Files:**
- Modify: `components/editor/LayoutPanel.tsx`
- Modify: `tests/renameSweep.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `Section` (Task 1), `Checkbox` (already imported in Task 1 Step 5; if you left it out there, add it now).
- Produces: `anchorOptions(axis)` replacing the module-level `ANCHOR_OPTIONS`.

**No e2e re-points in this task.** No spec reaches any string renamed here — verified by grepping every old string across `e2e/*.spec.ts`; `e2e/layout-guides.spec.ts` drives the built bundle through `window.__btm`, never the UI. The sweep test is the only coverage, so its needles are the specification.

- [x] **Step 1: Rewrite the option constants and the axis-aware anchors**

Replace the constant block at lines 37–79 with:

```tsx
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

/**
 * Anchors read as sentences about the edge they hold, per axis: "start" is
 * the left edge horizontally and the top edge vertically, and saying so beats
 * making the author translate.
 */
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
```

Delete the old `ANCHOR_OPTIONS` entirely. In `HierarchySection`, the two anchor selects (:167, :174) change to `options={anchorOptions("horizontal")}` and `options={anchorOptions("vertical")}`.

- [x] **Step 2: `HierarchySection` copy and the container checkbox**

**Deviation applied during execution:** the step text never renames `HierarchySection`'s own title; the Step 7 sweep forbids `"Variable layout"`, so the title was renamed to `title="Inside its frame"` here.

- Intro paragraph (:148–151) becomes:
  ```tsx
      <p className="text-[12px] leading-relaxed text-ink-soft">
        A frame holds the objects you add to it &mdash; being near it is not
        enough.
      </p>
  ```
- Field `label="Layout parent"` → `label="Which frame holds it"`, `hint="Distinct from editor groups."` → `hint="This is separate from grouping."` (:152); the option `{ value: "", label: "No parent" }` → `{ value: "", label: "Not in a frame" }` (:156); the undo label `"Layout parent"` in `controller.setLayoutParent(...)` (:159) → `"Which frame holds it"`.
- Replace the whole container Field (old :182–195, the `Select` choosing `Plain frame` / `Layout container`) with:
  ```tsx
          <Checkbox
            label="Shrink-wrap the frame around its contents"
            checked={enabled}
            onChange={(v) =>
              v
                ? controller.setContainer(objectId, withPolicy({}), "Container")
                : controller.setContainer(objectId, undefined, "Container")
            }
          />
  ```
- `Inside padding (px)` heading → `Space kept inside the frame (px)` (:214); its paragraph (:216–219) → `The gap the frame keeps around its contents when it grows. At 0, a child can reach the frame&apos;s own edge.`; both `text-[10px]` spans in this block → `text-[12px]`.
- `Size limits (px)` heading (:234) → `Smallest / largest size (px)`; its paragraph (:236–239) → `Blank means no limit. A frame that stops at its largest size reports the child that no longer fits.`; `text-[10px]` → `text-[12px]`.
- Fields: `label="Min width"` → `label="Smallest width"` (:241); `label="Min height"` → `label="Smallest height"` (:248); `label="Max width"` → `label="Largest width"` (:255); `label="Max height"` → `label="Largest height"` (:262). Side fields (`Top`/`Right`/`Bottom`/`Left`) and `Horizontal container` / `Vertical container` keep their labels.

- [x] **Step 3: `ExpansionSection` copy**

- Title (:419) → `title="When data is longer"`.
- Intro paragraph (:420–423) → `Lets this object take more room when a value is longer than the space traced for it.` (`text-[12px]`).
- `label="Maximum extra"` → `label="Stop growing after (px)"` (:366).
- The strategy select's empty option `{ value: "", label: "Default" }` → `{ value: "", label: "Automatic" }` (:386).
- ``label={`${label} pushes guide`}`` → `label="Which line moves with it"` (:396); keep its hint and the `No guide — grow in place` option; `` `${label} growth` `` (`Vertical growth` / `Horizontal growth`) and `Text layout` keep their labels.

- [x] **Step 4: `AttachSection` copy**

- Title (:472) → `title="What moves with this"`.
- Intro paragraph (:473–476) → `Each edge can follow a line. Following along keeps the size; stretching holds the opposite edge where it is.` (`text-[12px]`).
- The edge field label is looked up from `EDGE_OPTIONS`, so Step 1 already renamed it to `What the … edge follows`; keep `How it follows`, `Not attached`, and the guide option labels (`id (123px)`) as they are.

- [x] **Step 5: `GuidesSection` copy**

- Title (:529) → ``title={`Guide lines (${guides.length})`}``.
- `label="Max travel"` → `label="How far this line can move"` (:540); the guide line's `text-[11px]` (:536) → `text-[12px]`; the closing paragraph (:557) `text-[10px]` → `text-[12px]` (wording unchanged: `Page is Xpx tall. Select a guide and press Delete to remove it.`).

- [x] **Step 6: `DocumentSection` copy**

**Deviation applied during execution:** renaming the five section titles without their nav labels would break the drift guard in `e2e/inspector.spec.ts` (it iterates every nav pill and requires the heading to carry the same word). `SinglePanel`'s `sections` array in `PropertiesPanel.tsx` was updated in this task: growth → "When data is longer", follows → "What moves with this", frame → "Inside its frame", page → "The page", guides → `Guide lines (${guides.length})`. The four intro paragraphs use `text-[12px] leading-relaxed text-ink-soft`, matching Step 2's exact snippet.

- Title (:635) → `title="The page"`.
- Intro paragraph (:636–639) → `Keeping the paper size keeps the traced sheet and reports anything that spills. Letting the page grow follows the content.` (`text-[12px]`).
- `label="Max page width"` → `label="Largest page width"` (:654) and `label="Max page height"` → `label="Largest page height"` (:662); both hints `Blank means no explicit cap.` → `Leave blank for no limit.`
- `label="Sibling overlap"` → `label="If objects overlap"` (:670); hint `Report keeps geometry and warns; allow stays silent.` → `Warn me keeps the layout and warns; Leave it stays quiet.`

- [x] **Step 7: Add the LayoutPanel block to `tests/renameSweep.test.ts`**

```ts
describe("LayoutPanel copy", () => {
  const src = source("components/editor/LayoutPanel.tsx");

  it("no longer speaks in engineering vocabulary", () => {
    expect(src).not.toContain("Variable layout");
    expect(src).not.toContain("Fixed size");
    expect(src).not.toContain("Expand as needed");
    expect(src).not.toContain("Expand, with a limit");
    expect(src).not.toContain("Maximum extra");
    expect(src).not.toContain("Wrap within width");
    expect(src).not.toContain("pushes guide");
    expect(src).not.toContain("Move with guide");
    expect(src).not.toContain("Stretch with guide");
    expect(src).not.toContain("Layout parent");
    expect(src).not.toContain("No parent");
    expect(src).not.toContain("Plain frame");
    expect(src).not.toContain("Layout container");
    expect(src).not.toContain("Grow around children");
    expect(src).not.toContain("Inside padding");
    expect(src).not.toContain("Size limits");
    expect(src).not.toContain("Min width");
    expect(src).not.toContain("Max width");
    expect(src).not.toContain("Min height");
    expect(src).not.toContain("Max height");
    expect(src).not.toContain("Fixed page");
    expect(src).not.toContain("Let page grow");
    expect(src).not.toContain("Max page");
    expect(src).not.toContain("Sibling overlap");
    expect(src).not.toContain("Report overlap");
    expect(src).not.toContain("Allow overlap");
    expect(src).not.toContain("Max travel");
  });

  it("uses the owner's words instead", () => {
    expect(src).toContain('title="When data is longer"');
    expect(src).toContain('title="What moves with this"');
    expect(src).toContain('title="Inside its frame"');
    expect(src).toContain('title="The page"');
    expect(src).toContain("Guide lines (");
    expect(src).toContain("Stop growing after (px)");
    expect(src).toContain("Which line moves with it");
    expect(src).toContain("Follow along without changing size");
    expect(src).toContain("Stretch to keep touching");
    expect(src).toContain("What the top edge follows");
    expect(src).toContain("Which frame holds it");
    expect(src).toContain("Not in a frame");
    expect(src).toContain("Shrink-wrap the frame around its contents");
    expect(src).toContain("Around its contents");
    expect(src).toContain("Keep the same size");
    expect(src).toContain("Smallest / largest size (px)");
    expect(src).toContain("Smallest width");
    expect(src).toContain("Largest height");
    expect(src).toContain("Keep the paper size");
    expect(src).toContain("Let the page grow");
    expect(src).toContain("Largest page width");
    expect(src).toContain("If objects overlap");
    expect(src).toContain("Warn me");
    expect(src).toContain("Leave it");
    expect(src).toContain("How far this line can move");
    expect(src).toContain("Keep the left edge");
    expect(src).toContain("Stretch with the frame");
  });
});
```

- [x] **Step 8: Run the gates (including the bundle-only guide spec)**

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js components tests e2e
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test e2e/layout-guides.spec.ts e2e/inspector.spec.ts
node node_modules/@playwright/test/cli.js test
```

Expected: typecheck clean; lint 0 errors; unit all pass (+2 sweep tests); `layout-guides` fully green (it never reads the UI words — its green run proves the section conversion broke no workbench behaviour); full e2e **114 passed, 1 failed** (parked `:1799`).

- [x] **Step 9: Suggested commit (do not run — commits are user-gated)**

```powershell
git add components/editor/LayoutPanel.tsx tests/renameSweep.test.ts
git commit -m "feat(inspector): plain-language layout sections"
```

---

### Task 4: Owner words in the context panels (`ReferencePanel`, `PlaceholdersPanel`)

**Files:**
- Modify: `components/editor/ReferencePanel.tsx`
- Modify: `components/editor/PlaceholdersPanel.tsx`
- Modify: `tests/renameSweep.test.ts` (add a describe block)
- Modify: `e2e/shell.spec.ts` (one re-point)

**Interfaces:**
- Consumes: nothing new. Both files keep using `Panel` — these live in the context column, which does **not** get collapsible sections.
- Produces: final context-panel copy; nothing downstream imports it.

- [x] **Step 1: `ReferencePanel.tsx`**

- Both `title="Reference Image"` (:15, :28) → `title="Your bill photo"`.
- The no-photo branch (:16–19) becomes:
  ```tsx
        <p className="text-[12px] leading-relaxed text-ink-soft">
          No photo loaded yet. The photo is a tracing aid only &mdash; it is
          never saved into the template and never appears in an export.
        </p>
  ```
  Keep the disabled `Remove Reference` button verbatim.
- The opacity row's two `text-[11px]` spans (:31, :34) → `text-[12px]`.
- The default-whitening paragraph (:62–66) becomes:
  ```tsx
      <p className="text-[12px] leading-relaxed text-ink-faint">
        Cut-out pictures can keep the paper&rsquo;s colour or clean it to white.
        This sets the default for new cut-outs; each one keeps its own choice
        and can be taken again from its Cut-out picture panel.
      </p>
  ```
- The closing paragraph (:76–79) becomes:
  ```tsx
      <p className="text-[12px] leading-relaxed text-ink-faint">
        The photo sits at the bottom layer and is left out of every export.
      </p>
  ```
- **Unchanged labels** (assertions depend on them): `Show reference`, `Whiten paper on new parts`, `Remove Reference`.

- [x] **Step 2: `PlaceholdersPanel.tsx`**

- `title="Placeholders"` → `title="Data fields"` (:88).
- Empty-state paragraph (:90–94) becomes (12px):
  ```tsx
        <p className="text-[12px] leading-relaxed text-ink-soft">
          Add a {"{{token}}"} to a text box, or drop in a picture slot, and it
          turns up here. Each one can get its own label, answer type and print
          style.
        </p>
  ```
- `label="Input type"` → `label="Type of answer"` (:188); `label="Max length"` → `label="Maximum length"` (:200); `label="Printed style"` → `label="How it prints"` (:213).
- The image note (:183–185) becomes (12px): `Picture slots always ask for a picture.`
- The `In: {objectName}` line (:281) `text-[10px]` → `text-[12px]`.
- **Unchanged**: `Form label`, `Bold`, `Italic`, `Clear style`, `From text box`, `Or any installed family`, the `Colour` span, and the row-toggle glyphs/`aria-expanded` button — `e2e/render.spec.ts:167,177` and `e2e/shell.spec.ts` depend on parts of this panel.

- [x] **Step 3: Add the context-panel block to `tests/renameSweep.test.ts`**

```ts
describe("context panel copy", () => {
  it("the reference panel talks about the photo", () => {
    const src = source("components/editor/ReferencePanel.tsx");
    expect(src).not.toContain('title="Reference Image"');
    expect(src).not.toContain("No reference loaded");
    expect(src).toContain('title="Your bill photo"');
    expect(src).toContain("No photo loaded yet");
    expect(src).toContain("Remove Reference");
    expect(src).toContain("Whiten paper on new parts");
    expect(src).toContain("Show reference");
  });

  it("the data fields panel talks about answers", () => {
    const src = source("components/editor/PlaceholdersPanel.tsx");
    expect(src).not.toContain('title="Placeholders"');
    expect(src).not.toContain('label="Input type"');
    expect(src).not.toContain('label="Max length"');
    expect(src).not.toContain('label="Printed style"');
    expect(src).toContain('title="Data fields"');
    expect(src).toContain('label="Type of answer"');
    expect(src).toContain('label="Maximum length"');
    expect(src).toContain('label="How it prints"');
    expect(src).toContain("Picture slots always ask for a picture.");
    expect(src).toContain("Form label");
  });
});
```

- [x] **Step 4: Re-point `e2e/shell.spec.ts:49`**

```ts
    await expect(page.getByRole("heading", { name: "Data fields" })).toBeVisible();
```

(`e2e/shell.spec.ts:23`'s `Remove Reference` and all other shell assertions stay untouched.)

- [x] **Step 5: Run the gates**

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js components tests e2e
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts e2e/render.spec.ts
node node_modules/@playwright/test/cli.js test
```

Expected: typecheck clean; lint 0 errors; unit all pass (+2 sweep tests); `shell` 5/5; `render` green; full e2e **114 passed, 1 failed** (parked `:1799`).

- [x] **Step 6: Suggested commit (do not run — commits are user-gated)**

```powershell
git add components/editor/ReferencePanel.tsx components/editor/PlaceholdersPanel.tsx tests/renameSweep.test.ts e2e/shell.spec.ts
git commit -m "feat(editor): plain-language photo, data fields and picture-slot panels"
```

---

### Task 5: Final gate, screenshots and completion report

**Files:**
- No source changes. If any gate fails, fix in the task that owns the file.

- [x] **Step 1: Run the full gate**

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test
```

Expected evidence, not aspirations:
- typecheck: exit 0;
- lint: 0 errors, exactly 2 warnings (`app/render/RenderClient.tsx:143`, `lib/canvas/EditorController.ts:22`);
- unit: **947 passed** (940 before this plan + 7 sweep tests: 3 PropertiesPanel, 2 LayoutPanel, 2 context);
- e2e: **114 passed, 1 failed** — the failure must be exactly `e2e/workflow.spec.ts:1799` (parked, pre-existing, user decision pending). 115 total = the 113 before this plan + the 2 new inspector tests.

- [x] **Step 2: Capture screenshots for the user**

Drive the dev server (port 3111) and capture at 1600×900:
1. Bill step — the context column showing **Your bill photo** with opacity and the three checkboxes;
2. Trace step, rectangle selected — the inspector showing the sticky **Inspector** index and the sections `This object` … `Inside its frame`;
3. Trace step, text object selected — the **Text** section with the `What this is` chips, B/I buttons, wrap checkbox and the "This fills from …" note;
4. Mark step — the context column showing **Data fields**;
5. Table selected — the **Table** section and the frame/page sections below it.

- [x] **Step 3: Manual QA checklist**

- Collapse two sections, switch objects, switch back — they stay collapsed; hard-reload the page — they open again (module state is per page load, by design).
- Click every index pill — the page scrolls so that section's title sits just under the sticky bar.
- `Cut-out picture` panel: check `Clean the paper to white`, then `Take it again from the photo` — geometry/cut-out behaviour identical to before (workflow spec also covers this).
- Font dropdowns in Text and Data field panels show faces rendered in their own font (Windows/Chromium); on other platforms the labels still list correctly (native `<option>` styling is best-effort — acceptable, harmless).
- No text in any rewritten panel renders below 12px.

**Deviation applied during execution:** the pill check failed at first — `Section`'s fixed `scroll-mt-10` (40px) is shorter than the sticky index once the pills wrap to two or three rows (81px / 117px measured), so a pill jump landed the target's title behind the bar. Fixed in `components/ui/Controls.tsx`: `IndexNav` publishes its own height as `--inspector-nav-h` on the nearest `.editor-scroll` (via `ResizeObserver`) and `Section` uses `scroll-mt-[calc(var(--inspector-nav-h,44px)_+_4px)]`. Re-measured after the fix: reachable pills land the title exactly 4px under the bar; the first section clamps at 0px; the last two sections clamp at max scroll with their titles visible. Re-verified: `e2e/inspector.spec.ts` 2/2 green, and the full gate re-run after the fix reproduced the identical evidence below (tsc 0, lint 0 errors + 2 warnings, unit 947, e2e 114/1). Documented exceptions to the 12px floor, all pre-existing lines this plan did not write and did not list for replacement: the opacity `100%` span (`PropertiesPanel.tsx:370`), the `N selected` footer (`PropertiesPanel.tsx:462`) and `LayersPanel` (not in scope).

- [x] **Step 4: Completion report**

Deliver: gate results (raw counts above), screenshot list, task-by-task summary, any deviation from this plan with why, the parked `:1799` reminder, and the explicit deferrals (spec §6 live overlay, §2 ② coach marks — unassigned; Plan 4 = `/render` + responsive rail + a11y).

No commit in this task. Do not fix the parked bug.

---

## Appendix A — every e2e re-point, one table

| Spec:line (pre-plan) | Old query text | New query text | Task |
|---|---|---|---|
| `workflow.spec.ts:1362` | `getByText("Object", { exact: true })` | `getByRole("heading", { name: "Object", exact: true })` (T1) → `name: "This object"` (T2) | 1, 2 |
| `workflow.spec.ts:1365` | `getByText("Custom family")` | `getByText("Custom font")` | 2 |
| `workflow.spec.ts:1387` | heading `"Field"` | heading `"Data field"` | 2 |
| `workflow.spec.ts:1390` | `fieldPanel.getByLabel("Align")` | `fieldPanel.getByLabel("Alignment")` | 2 |
| `workflow.spec.ts:1393` | `fieldPanel.getByLabel("Align").selectOption("right")` | `…getByLabel("Alignment")…` | 2 |
| `workflow.spec.ts:1948` | button `"Wrap at this width"` click | `getByLabel("Let the text wrap onto more lines").check()` | 2 |
| `workflow.spec.ts:2014` | button click (wrap on) | same `.check()` | 2 |
| `workflow.spec.ts:2016` | button `"click to unwrap"` | same checkbox `.uncheck()` | 2 |
| `workflow.spec.ts:2280` | `getByLabel("Whiten paper", { exact: true })` | `getByLabel("Clean the paper to white", { exact: true })` | 2 |
| `workflow.spec.ts:2439` | button `"Recapture from current position"` | `"Take it again from the photo"` | 2 |
| `workflow.spec.ts:2561` | same button name | same new name | 2 |
| `workflow.spec.ts:2770` | same button name | same new name | 2 |
| `workflow.spec.ts:2795` | same button name | same new name | 2 |
| `workflow.spec.ts:3100` | heading `"Appearance"` | heading `"Ink & outline"` | 2 |
| `workflow.spec.ts:3102` | `getByLabel("Stroke width")` | `getByLabel("Line thickness")` | 2 |
| `workflow.spec.ts:3185` | `getByLabel("Stroke width")` | `getByLabel("Line thickness")` | 2 |
| `workflow.spec.ts:3187` | `getByLabel("Stroke width")` | `getByLabel("Line thickness")` | 2 |
| `workflow.spec.ts:3194` | `getByLabel("Stroke width")` | `getByLabel("Line thickness")` | 2 |
| `workflow.spec.ts:3200` | `getByLabel("Stroke width")` | `getByLabel("Line thickness")` | 2 |
| `billkit.spec.ts:83` | `getByLabel("Last row")` | `getByLabel("To row")` | 2 |
| `shell.spec.ts:49` | heading `"Placeholders"` | heading `"Data fields"` | 4 |

Everything else in `e2e/` stays byte-identical. `e2e/inspector.spec.ts` is label-agnostic and must never appear in this table.

## Appendix B — final section ids (for Plan 4 and muscle memory)

| id | Title after this plan | Shown for |
|---|---|---|
| `properties` | Properties | nothing selected (`IndexNav` hidden) |
| `object` | This object | single selection |
| `size` | Size & position | single selection |
| `ink` | Ink & outline | single selection; also multi-select |
| `text` | Text | text objects |
| `table` | Table | tables |
| `slot` | Picture slot | image placeholders |
| `data-field` | Data field | fields |
| `cut-out` | Cut-out picture | bill parts |
| `lineup` | Line up | single and multi |
| `objects` | `N objects` | multi-selection |
| `group` | Group | multi-selection |
| `growth` | When data is longer | always (single) |
| `follows` | What moves with this | guides exist |
| `frame` | Inside its frame | always (single) |
| `page` | The page | layout block or grown page exists |
| `guides` | `Guide lines (N)` | guides exist |
