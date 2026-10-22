# UI Redesign, Plan 1 — Design System & First Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens onto its new identity — "ink on paper" tokens and type, restyled form primitives, a real toast system, and a redesigned first screen — verified by the existing e2e suite plus new tests.

**Architecture:** Tokens live once in `app/globals.css` (`@theme`), mirrored in TypeScript (`components/ui/tokens.ts`) because canvas overlays cannot read CSS variables; a drift test keeps the two in step. `components/ui/Controls.tsx` keeps every existing export name and prop signature so the 14 consuming files do not churn — only its skin changes. Toasts are a pure queue (`lib/client/toastQueue.ts`, node-tested) plus a client provider mounted in the root layout.

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4 (`@theme`), `next/font/google` (Bitter, Archivo, IBM Plex Mono), `lucide-react`, vitest 3 (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-editor-ui-redesign-design.md` (sections 6, 7, 8, 10)

**Subsequent plans (not this one):** Plan 2 = app bar + step path + 4-column shell + stage bar + tool rail. Plan 3 = inspector rename/regroup + context panels. Plan 4 = remaining `window.alert` sweep + `/render` redesign + responsive + full a11y pass. Each is written after the previous lands so it describes real interfaces.

## Global Constraints

- **Colour semantics are load-bearing:** `ledger` (green) means *data / variable* and **never fills a button**; `stamp` is delete/errors only; `marker` is warnings only; actions are `ink`.
- **Accessibility floor:** no text below 12px; interactive targets ≥32px; visible focus ring (2px ink, 2px offset) on every control; icons `aria-hidden`, icon-only buttons carry `aria-label`.
- **No `window.alert` / `window.confirm`** anywhere touched by this plan; errors become toasts.
- **Export names in `components/ui/Controls.tsx` must not change** (`Panel`, `Field`, `TextInput`, `NumberInput`, `Select`, `ColorInput`, `Button`, `Checkbox`, `Dialog`). `NumberInput`'s draft-commit logic is preserved byte-for-byte — it fixes a real editing bug.
- **Preserve e2e hooks:** `input[type="file"][accept*="image/png"]` and `input[type="file"][accept*="json"]` must exist on the upload screen.
- **No new test infrastructure.** vitest runs `environment: "node"`, `include: ["tests/**/*.test.ts"]`. UI behaviour is verified with Playwright.
- **Commits are user-gated** in this session (system policy): do not run `git commit`. Each task lists the suggested commit message for when the user asks.
- **Shell notes (Windows):** `npm` is blocked by execution policy — use `npm.cmd`. Run binaries via `node node_modules/...` where possible.
- **Verification commands** (use exactly these):
  - unit: `node node_modules/vitest/vitest.mjs run`
  - single test: `node node_modules/vitest/vitest.mjs run tests/<file>.test.ts`
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - lint: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
  - e2e: `node node_modules/@playwright/test/cli.js test <spec>` (port 3000 must be free; config uses 3111)

---

### Task 1: Design tokens and typefaces

**Files:**
- Create: `components/ui/tokens.ts`
- Create: `tests/uiTokens.test.ts`
- Modify: `app/globals.css` (whole file)
- Modify: `app/layout.tsx` (whole file)
- Modify: `package.json` (via `npm.cmd install lucide-react`)

**Interfaces:**
- Consumes: nothing.
- Produces: `PALETTE` (const object) and type `PaletteToken` from `@/components/ui/tokens`; Tailwind colour utilities `ink`, `ink-soft`, `ink-faint`, `paper`, `desk`, `rule`, `ledger`, `stamp`, `marker`, `ledger-wash`, `stamp-wash`, `marker-wash`; font utilities `font-display` (Bitter), `font-sans` (Archivo), `font-mono` (IBM Plex Mono); `lucide-react` installed.

- [ ] **Step 1: Install the icon library**

Run: `npm.cmd install lucide-react`
Expected: exit 0, `lucide-react` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing drift test**

Create `tests/uiTokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PALETTE } from "@/components/ui/tokens";

const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

/** inkSoft -> ink-soft, so TS keys and CSS custom properties stay comparable. */
const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("design tokens", () => {
  it("declares every palette colour in globals.css with the same value", () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      const declaration = `--color-${kebab(name)}: ${hex};`;
      expect(css, `missing or mismatched: ${declaration}`).toContain(declaration);
    }
  });

  it("declares no colour token the palette does not know about", () => {
    const declared = [...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]);
    const known = new Set(Object.keys(PALETTE).map(kebab));
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(known.has(name), `unknown token --color-${name}`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/uiTokens.test.ts`
Expected: FAIL — cannot resolve `@/components/ui/tokens`.

- [ ] **Step 4: Create the token mirror**

Create `components/ui/tokens.ts`:

```ts
/**
 * The palette, mirrored in TypeScript.
 *
 * Canvas overlays and fabric objects cannot read CSS custom properties, so the
 * same values live here and in the `@theme` block of app/globals.css. The drift
 * test in tests/uiTokens.test.ts keeps the two in step.
 */
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

- [ ] **Step 5: Rewrite `app/globals.css`**

```css
@import "tailwindcss";

/*
 * Ink on paper. The palette is functional, not decorative: ink is the
 * structure you draw, ledger green is data (never a button fill), stamp red is
 * delete/errors only, marker amber is warnings only.
 */
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
  /* One focus ring for the whole product. */
  :focus-visible {
    outline: 2px solid var(--color-ink);
    outline-offset: 2px;
  }
  ::selection {
    background: var(--color-ledger-wash);
  }
}

/* Motion is a courtesy: honour the system setting everywhere at once. */
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

/* Dense editor chrome: keep scrollbars thin so the panes stay readable */
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

/* Numeric inputs in the properties panel: hide spinners, they are too wide */
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

- [ ] **Step 6: Rewrite `app/layout.tsx` with the three typefaces**

```tsx
import type { Metadata } from "next";
import { Archivo, Bitter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const bitter = Bitter({ variable: "--font-bitter", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Bill Template Maker",
  description: "Turn a photo of your paper bill into a fillable digital bill.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${bitter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-desk font-sans text-ink">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Run the new test and the whole unit suite**

Run: `node node_modules/vitest/vitest.mjs run tests/uiTokens.test.ts`
Expected: PASS (2 tests).

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 926 pre-existing tests + 2 new all pass.

- [ ] **Step 8: Typecheck and lint**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Expected: 0 errors (2 pre-existing warnings tolerated).

Suggested commit: `feat(ui): ink-on-paper design tokens and typefaces`

---

### Task 2: Restyle the form primitives

**Files:**
- Modify: `components/ui/Controls.tsx` (whole file replaced; same exports)
- Modify: `components/editor/BillEditor.tsx` (class-only edits: shell colours, 12px floor)

**Interfaces:**
- Consumes: Tailwind tokens from Task 1; `lucide-react`.
- Produces: `Button` gains optional `size?: "md" | "lg"` (default `"md"`); new export `IconButton` (`{ label, onClick?, disabled?, children, className? }`); every other export keeps its exact current signature. All later plans rely on these names.

- [ ] **Step 1: Check nothing depends on the `T` label of the transparent toggle**

Run: `node node_modules/eslint/bin/eslint.js --version` then grep:
`rg -n '"T"|>T<|getByRole\("button", \{ name: "T"' e2e tests components`
Expected: no matches. If a match exists, keep the current label text on that button and adjust the spec instead (it becomes `Solid` below).

- [ ] **Step 2: Replace `components/ui/Controls.tsx`**

Replace the whole file with the content below. `NumberInput`'s state logic is copied unchanged from the current file — only the class names differ.

```tsx
"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

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

/**
 * Numeric field that can actually be retyped.
 *
 * A controlled `type="number"` that rejects empty input makes it impossible to
 * clear a value: backspacing the last digit snaps the old number back and the
 * caret lands at the end, so typing "12" after "3" produces "312". This keeps a
 * text draft while focused, so the field can be emptied and rewritten, and only
 * commits a parsed number.
 */
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
      // Nothing usable: fall back to the current value.
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
        // Keep whatever the user typed, including an empty field.
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
        // Select the contents so typing replaces the value outright.
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
        // Arrow keys still work for nudging values.
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
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <select
      className={`${inputClass} ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
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
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "lg";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    default:
      "border-rule bg-paper text-ink hover:bg-desk disabled:opacity-40",
    primary:
      "border-ink bg-ink text-paper hover:border-ink-soft hover:bg-ink-soft disabled:opacity-40",
    ghost:
      "border-transparent text-ink-soft hover:bg-desk disabled:opacity-40",
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

/** Small modal dialog. Centred, Escape closes, backdrop click closes. */
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

Note: if `tsc` cannot find the `X` export in `lucide-react`, use the alias set (`XCircle`, `AlertTriangle`, `CheckCircle`) — 1.x renamed these; both spellings ship as aliases. Resolve at execution time, not by guessing.

- [ ] **Step 3: Recolour the editor shell in `components/editor/BillEditor.tsx`**

Class-only edits (no structure):

1. Line ~146 preview strip: `border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] text-neutral-500` → `border-b border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft`
2. Line ~156 left aside: `border-r border-neutral-200 bg-white` → `border-r border-rule bg-paper`
3. Lines ~160–162 status span: `text-[11px] text-neutral-500` → `text-[12px] text-ink-soft`
4. Line ~186 and ~338: `text-[10px] text-neutral-400` → `text-[12px] text-ink-faint`
5. Line ~221 right aside: `border-l border-neutral-200 bg-white` → `border-l border-rule bg-paper`
6. Line ~225: `border-t border-neutral-200` → `border-t border-rule`
7. StatusBar (line ~354): `border-t border-neutral-200 bg-white px-3 py-1.5 text-[11px] text-neutral-500` → `border-t border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft`; every inner `text-neutral-700` → `text-ink`; `text-neutral-400` (lines ~379, ~402) → `text-ink-faint`; swatch border `border-neutral-300` → `border-rule`.

- [ ] **Step 4: Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: no errors. If `lucide-react`'s `X` is not exported, switch to the alias name here and re-run.

- [ ] **Step 5: Prove the editor still behaves, with the existing specs**

Run: `node node_modules/@playwright/test/cli.js test e2e/tabledialog.spec.ts e2e/rows.spec.ts e2e/tablegrid.spec.ts`
Expected: all pass (they exercise dialogs, tables, panels, selects, number inputs).

- [ ] **Step 6: Lint**

Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Expected: 0 errors.

Suggested commit: `feat(ui): restyle form primitives in ink on paper`

---

### Task 3: Toast system, and no more alerts on the upload path

**Files:**
- Create: `lib/client/toastQueue.ts`
- Create: `tests/toastQueue.test.ts`
- Create: `components/ui/Toast.tsx`
- Create: `e2e/upload.spec.ts`
- Modify: `app/layout.tsx` (wrap children in `ToastProvider`)
- Modify: `components/editor/UploadScreen.tsx` (two `window.alert` → `toast`)
- Modify: `components/editor/BillEditor.tsx` (one `window.alert` → `toast`)

**Interfaces:**
- Consumes: `IconButton` from Task 2; `lucide-react`.
- Produces: `pushToast(list, item, id)`, `dismissToast(list, id)`, `autoDismissMs(kind)`, types `ToastItem`, `ToastKind`, const `MAX_TOASTS` from `@/lib/client/toastQueue`; `<ToastProvider>` (client) and `useToast(): { toast(input: Omit<ToastItem,"id">): void }` from `@/components/ui/Toast`. Later plans replace every remaining `window.alert` with `useToast`.

- [ ] **Step 1: Write the failing queue test**

Create `tests/toastQueue.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MAX_TOASTS,
  autoDismissMs,
  dismissToast,
  pushToast,
  type ToastItem,
} from "@/lib/client/toastQueue";

const item = (title: string): Omit<ToastItem, "id"> => ({
  kind: "info",
  title,
});

describe("toast queue", () => {
  it("appends with the supplied id", () => {
    const list = pushToast([], item("One"), 1);
    expect(list).toEqual([{ id: 1, kind: "info", title: "One" }]);
  });

  it("keeps only the newest toasts once the stack is full", () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i++) {
      list = pushToast(list, item(`T${i}`), i);
    }
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list.map((t) => t.title)).toEqual(["T3", "T4", "T5"]);
  });

  it("dismisses by id and ignores unknown ids", () => {
    const list = pushToast(pushToast([], item("A"), 1), item("B"), 2);
    expect(dismissToast(list, 1).map((t) => t.id)).toEqual([2]);
    expect(dismissToast(list, 99)).toHaveLength(2);
  });

  it("auto-dismisses info and success, but not warnings or errors", () => {
    expect(autoDismissMs("info")).toBe(6000);
    expect(autoDismissMs("success")).toBe(6000);
    expect(autoDismissMs("warning")).toBeNull();
    expect(autoDismissMs("error")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/toastQueue.test.ts`
Expected: FAIL — cannot resolve `@/lib/client/toastQueue`.

- [ ] **Step 3: Create the queue**

Create `lib/client/toastQueue.ts`:

```ts
/**
 * The toast queue is pure state so the rules — newest wins, cap the stack,
 * errors stay until dismissed — are unit-testable without a DOM.
 */
export type ToastKind = "info" | "success" | "warning" | "error";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  /** One sentence telling the person what to do next. */
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

/** Errors and warnings stay until dismissed; everything else fades. */
export function autoDismissMs(kind: ToastKind): number | null {
  return kind === "error" || kind === "warning" ? null : 6000;
}
```

- [ ] **Step 4: Run the test again**

Run: `node node_modules/vitest/vitest.mjs run tests/toastQueue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Build the toast provider**

Create `components/ui/Toast.tsx`:

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
  info: { bar: "border-l-ink", icon: <Info aria-hidden className="h-4 w-4 text-ink" /> },
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
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 6: Mount the provider in `app/layout.tsx`**

Import and wrap:

```tsx
import { ToastProvider } from "@/components/ui/Toast";
// ...
<body className="min-h-full flex flex-col bg-desk font-sans text-ink">
  <ToastProvider>{children}</ToastProvider>
</body>
```

- [ ] **Step 7: Replace the upload-path alerts**

In `components/editor/UploadScreen.tsx`: add `import { useToast } from "@/components/ui/Toast";`, call `const { toast } = useToast();` inside the component, and replace

- `window.alert("Please choose a PNG, JPG or WebP image.")` with:

```tsx
toast({
  kind: "warning",
  title: "That picture isn't a PNG, JPG or WebP",
  detail: "Choose a photo of your bill in one of those formats.",
});
```

- both `window.alert("That file is not a valid bill template JSON.")` with:

```tsx
toast({
  kind: "error",
  title: "That file isn't a bill template",
  detail: "Choose a .json file that was saved from this editor.",
});
```

In `components/editor/BillEditor.tsx`: same import, `const { toast } = useToast();`, and replace the `window.alert` in `handleImage`'s catch with:

```tsx
toast({
  kind: "error",
  title: "Could not load that picture",
  detail: e instanceof Error ? e.message : String(e),
});
```

- [ ] **Step 8: Write the e2e proof that alerts are gone**

Create `e2e/upload.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("first screen", () => {
  test("a non-picture file gets a toast and never an alert box", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a picture"),
      });

    await expect(
      page.getByText("That picture isn't a PNG, JPG or WebP"),
    ).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test("a broken template file gets an explaining toast", async ({ page }) => {
    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="json"]')
      .first()
      .setInputFiles({
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from("{ not json"),
      });

    await expect(page.getByText("That file isn't a bill template")).toBeVisible();
  });
});
```

- [ ] **Step 9: Run the new spec**

Run: `node node_modules/@playwright/test/cli.js test e2e/upload.spec.ts`
Expected: 2 passed. (If port 3000 is busy, kill it first — the config's webServer uses 3111.)

- [ ] **Step 10: Full unit suite, typecheck, lint**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: all pass (932 now).

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Expected: 0 errors.

Suggested commit: `feat(ui): toast notifications; upload path says goodbye to alert()`

---

### Task 4: The new first screen

**Files:**
- Create: `lib/client/sampleBill.ts`
- Modify: `components/editor/UploadScreen.tsx` (whole file replaced; same props)
- Modify: `e2e/upload.spec.ts` (add the sample-bill test)

**Interfaces:**
- Consumes: `Button` (`size="lg"`), tokens/utilities from Task 1, `useToast` from Task 3.
- Produces: `renderSampleBill(): string` (data URL) from `@/lib/client/sampleBill`. `UploadScreen` keeps its exact props: `{ onImage(dataUrl, name), onTemplate(t), onTemplateForRender(t) }`.

- [ ] **Step 1: Write the failing e2e for the sample bill**

Append to `e2e/upload.spec.ts`:

```ts
test("the sample bill opens the editor with a reference loaded", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample bill" }).click();
  // "Remove Reference" exists in both reference states; enabled proves the
  // editor opened *and* the picture loaded.
  await expect(
    page.getByRole("button", { name: "Remove Reference" }),
  ).toBeEnabled();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node node_modules/@playwright/test/cli.js test e2e/upload.spec.ts`
Expected: the new test FAILS — no button named "Try a sample bill".

- [ ] **Step 3: Create the sample bill drawing**

Create `lib/client/sampleBill.ts`:

```ts
/**
 * Draws a small, plausible paper bill so the app can be tried before the
 * person finds their own photo. Pure canvas, nothing leaves the browser.
 */
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

  // Shop header
  ctx.font = "bold 34px Georgia, serif";
  ctx.fillText("RIVERSTONE HARDWARE", 48, 88);
  ctx.font = "16px Georgia, serif";
  ctx.fillText("14 Mill Lane · Open 7 days", 48, 116);

  // Bill meta
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

  // Column headings
  ctx.font = "bold 15px Georgia, serif";
  ctx.fillText("Item", 48, 176);
  ctx.fillText("Qty", 440, 176);
  ctx.fillText("Price", 512, 176);
  ctx.fillText("Amount", 596, 176);

  // Line items
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

  // Totals block
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

  // Stamp box, bottom right
  ctx.lineWidth = 1.5;
  ctx.strokeRect(512, y + 120, 160, 96);
  ctx.font = "14px Georgia, serif";
  ctx.fillText("PAID", 566, y + 174);

  ctx.font = "13px Georgia, serif";
  ctx.fillText("Thank you — please keep this receipt.", 48, height - 48);

  return canvas.toDataURL("image/png");
}
```

- [ ] **Step 4: Replace `components/editor/UploadScreen.tsx`**

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";
import { renderSampleBill } from "@/lib/client/sampleBill";
import type { BillTemplate } from "@/lib/template/types";

/**
 * First screen: start from a bill photo, or open something made earlier.
 * Nothing is uploaded; files are read in the browser via FileReader.
 */
export default function UploadScreen({
  onImage,
  onTemplate,
  onTemplateForRender,
}: {
  onImage: (dataUrl: string, name: string) => void;
  onTemplate: (t: BillTemplate) => void;
  onTemplateForRender: (t: BillTemplate) => void;
}) {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const jsonInput = useRef<HTMLInputElement | null>(null);
  const renderInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();

  const readImage = useCallback(
    (file: File) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        toast({
          kind: "warning",
          title: "That picture isn't a PNG, JPG or WebP",
          detail: "Choose a photo of your bill in one of those formats.",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onImage(reader.result, file.name);
        }
      };
      reader.readAsDataURL(file);
    },
    [onImage, toast],
  );

  const readTemplate = useCallback(
    async (file: File, hand: (t: BillTemplate) => void) => {
      try {
        hand(JSON.parse(await file.text()) as BillTemplate);
      } catch {
        toast({
          kind: "error",
          title: "That file isn't a bill template",
          detail: "Choose a .json file that was saved from this editor.",
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
            <Button variant="primary" size="lg" onClick={() => imageInput.current?.click()}>
              Choose a photo
            </Button>
            <Button size="lg" onClick={useSample}>
              Try a sample bill
            </Button>
          </div>
        </div>

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

- [ ] **Step 5: Run the upload spec**

Run: `node node_modules/@playwright/test/cli.js test e2e/upload.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Run every spec that touches the first screen**

Run: `node node_modules/@playwright/test/cli.js test e2e/workflow.spec.ts e2e/render.spec.ts e2e/share.spec.ts e2e/billkit.spec.ts`
Expected: all pass. If any assertion referenced the old copy ("Choose File", "Open saved template instead", "Fill & Render a saved template"), update the assertion to the new accessible name (`Choose a photo`, `Open a saved template…`, `Fill & print a saved template…`) — never delete an assertion.

Suggested commit: `feat(ui): new first screen, plus a sample bill to try before your own`

---

### Task 5: Verification and a look for the human

**Files:**
- No source changes expected. Fix anything the suite uncovers, in the task that owns it.

- [ ] **Step 1: Everything at once**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Run: `node node_modules/eslint/bin/eslint.js app components hooks lib tests tools e2e`
Run: `node node_modules/vitest/vitest.mjs run`
Run: `node node_modules/@playwright/test/cli.js test`
Expected: tsc clean, eslint 0 errors, all unit tests pass (932), all 13 e2e specs pass (11 existing + upload.spec.ts + nothing else).

- [ ] **Step 2: Screenshots for the human**

With the dev server running on 3111 (Playwright's webServer can be started via `npm.cmd run dev -- -p 3111`), use the Playwright MCP browser to capture:
- the first screen at 1440×900, 1024×768 and 768×1024 (`.playwright-mcp/redesign-1-upload-<width>.png`)
- a toast visible on screen (`.playwright-mcp/redesign-1-toast.png`)
- the editor with the sample bill traced (`.playwright-mcp/redesign-1-editor.png`)

The model cannot read these; they exist for the user to open.

- [ ] **Step 3: Report**

Summarise: what changed, what the suite says, screenshot paths, and exactly what to look at. Then stop — Plan 2 (app bar, step path, 4-column shell, tool rail) is written only after the user has seen this.

Suggested commit: none (verification only).
