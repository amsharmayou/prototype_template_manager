# Editor & Web UI Redesign — Design

**Date:** 2026-10-16
**Status:** Approved (design presented and accepted in session)
**Surfaces:** `/` (editor), `/render` (fill & render)

## 1. Goal

Redesign both web surfaces so a **non-technical business owner** — someone who
wants to turn their paper bill into a digital template — can understand the
product, find every option, and complete the whole job without design-tool or
engineering vocabulary.

The app today is not short of capability. It is short of **legibility**: an
empty canvas with 17 ungrouped tools, 13 ungrouped top-bar actions, four
indistinguishable save/load concepts, ten stacked inspector panels named after
the data model rather than the task, and 9–11px text throughout.

### Non-goals

- The **exported bill document** (HTML/SVG/PDF/DOCX/PNG). It must stay faithful
  to the traced bill and is not ours to restyle.
- The layout engine's maths (`lib/render/layout.ts`), the billkit/sharekit
  bundles, and the template format.
- OCR or automatic interpretation. Manual tracing remains the product principle.
- Mobile *canvas editing*. Desktop-first; tablet pans/collapses; the render page
  is fully responsive.

## 2. Experience model — a guided path, not a wizard

A five-step path under the app bar. It is a **guide, never a gate**: nothing is
locked, nothing is hidden. Clicking a step selects the matching tool, opens the
matching context panel, and places hints on the canvas. Step completion is
derived from real state so the guide cannot lie.

| Step | Owner's job | App behaviour |
|---|---|---|
| ① Your bill | Add the bill photo | Page adopts photo size; photo opacity, grid, page size. Empty state: *"Drop your bill photo here — or try a sample bill"* |
| ② Trace | Draw over the paper | Tool rail grouped Draw / Structure / Content / Tools; canvas coach marks |
| ③ Mark data | Mark what changes each time | Live overlay on; context panel lists data fields |
| ④ Test | Fill example values | Opens `/render` (reused, not rebuilt) |
| ⑤ Save & share | Get it out | Save, Fill & print, Share, Get a copy |

Completion signals: photo loaded → objects drawn → ≥1 variable marked → values
tested → saved at least once.

## 3. Layout

Four columns. The inspector is **always complete** — all options visible at all
times, per the accepted decision to keep the layout engine in the main surface
rather than behind a mode.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Bill Template Maker   Shop Bill ✎     ↶ ↷  Preview [Save][Fill&print][Share ▾] │
├───────────────────────────────────────────────────────────────────────────┤
│ ① Your bill ✓ → ② Trace ● → ③ Mark data → ④ Test → ⑤ Save & share        │
├──────┬───────────────┬──────────────────────────────┬─────────────────────┤
│TOOLS │ CONTEXT       │          STAGE               │ INSPECTOR (indexed) │
│grouped│ per step     │   sheet on desk              │ all sections        │
└──────┴───────────────┴──────────────────────────────┴─────────────────────┘
```

- **Tool rail** — icon + word + shortcut, grouped, collapses to icons under
  1200px. Never scrolls off-screen.
- **Context panel** (~280px) — changes with the step: photo/grid/page, data
  fields, guides.
- **Stage** — paper sheet on a desk surface, zoom/fit/page-size in a stage bar.
- **Inspector** (~320px) — collapsible sections, sticky section index, all
  options present.

## 4. Actions: 13 buttons → 4

| Today | New |
|---|---|
| Open Bill · Load Template · Open saved template instead | **Add bill photo** · **Open…** (recent bills / open a file) |
| Save Template · Save to My Templates | **Save** (to this device) |
| Fill & Render → | **Fill & print** |
| Share as .html | **Share** |
| Export ▾ (JSON, SVG, PDF, DOCX, PNG, HTML, .btpkg) | **Get a copy ▾** grouped **by outcome**, format name second |

`Get a copy` groups: *Print it (PDF)* · *A picture (PNG)* · *Open in Word
(DOCX)* · *Edit elsewhere (SVG)* · *Template for an app (JSON / .btpkg)* ·
*Web page (HTML)*.

## 5. Rename map

Every option survives; only the words change.

### Object & appearance
| Today | New |
|---|---|
| Object → Name | This object → Name |
| Role (free text) | **What this is** — chip picker: Header, Title, Item, Total, Footer, + custom |
| X / Y / Width / Height / Rotation / Opacity | Size & position → X / Y / Width / Height / Rotation / Opacity |
| Locked / Visible | Locked / Visible (same words, clearer grouping) |
| Appearance → Stroke / Stroke width / Fill | **Ink & outline** → Line colour / Line thickness / Fill colour |
| Align left/centre/right, top/middle/bottom, Distribute H/V | **Line up** → same actions, icon + word |
| Text → Text, Insert variable, Font, Size, Weight, Style, Align, Custom family, Wrap | **Text** → *Text*, *Insert a variable*, *Font* (with previews), *Size*, **B**/**I** buttons, *Alignment*, *Custom font*, *"Let the text wrap onto more lines"* |
| Kind: roleKind / Variable: | Footer note: *"This fills from {variable}"* |
| Table → Rows/Columns/Border colour/Border width/Cell fill/Padding/Header row/Header fill | **Table** → *Rows*, *Columns*, *Line colour*, *Line thickness*, *Cell background*, *Cell padding*, *Header row*, *Header background* |
| Repeating rows → First row/Last row/Items key/Max items/Repeat header when split | **Repeat these rows** → *From row*, *To row*, *Data name*, *Maximum*, *Repeat the header* |
| Column widths / Row heights / Cell contents | *Column widths* / *Row heights* / *Cell text* (collapsible, unchanged behaviour) |
| Bill Part → Whiten paper, Recapture from current position | **Cut-out picture** → *"Clean the paper to white"*, *"Take it again from the photo"* |
| Image Placeholder → Role, Label | **Picture slot** → *What goes here* (Logo/QR/Stamp/Signature/Product/Image), *Label* |
| Field → Key, Type, Ink colour, Font… | **Data field** → *Name*, *Type of answer*, *Colour*, *Font…* |
| Placeholders → Form label, Input type, Max length, Printed style | **Data fields** → *Form label*, *Type of answer*, *Maximum length*, *How it prints* |

### Layout engine
| Today | New |
|---|---|
| Variable layout — growth | **When data is longer** |
| Growth: Fixed size / Expand as needed / Expand, with a limit | *Keep the size* / *Grow if needed* / *Grow, up to a limit* |
| Maximum extra | *Stop growing after ___ px* |
| Text layout (Default/Wrap/NoWrap) | *Let it wrap / Keep on one line* |
| "Vertical pushes guide" / "Horizontal pushes guide" | *Which line moves with it* |
| Variable layout — attachments | **What moves with this** |
| Top/Bottom/Left/Right edge + guide | *The top edge follows… / The bottom edge follows…* |
| How it follows: move / stretch | *Follow along without changing size* / *Stretch to keep touching* |
| Variable layout — container | **Inside its frame** |
| Layout parent | *Which frame holds it* |
| Horizontal/Vertical anchor: start/end/stretch | *Keep the top edge* / *Keep the bottom edge* / *Stretch with the frame* |
| Container: Plain frame / Layout container | *Shrink-wrap the frame around its contents* (on/off) |
| Horizontal/Vertical container: content/fixed | *Around its contents* / *Keep the same size* |
| Padding (4 sides) | *Space kept inside the frame (px)* |
| Size limits min/max W/H | *Smallest / Largest allowed size* |
| Variable layout — page | **The page** |
| Horizontal/Vertical page: fixed/expand | *Keep the paper size* / *Let the page grow* |
| Max page width/height | *Largest page size* |
| Sibling overlap: report/allow | *If objects overlap:* *Warn me* / *Leave it* |
| Variable layout — guides → Max travel | **Guide lines** → *How far this line can move* |
| Reference Image | **Your bill photo** |

## 6. Visual identity — *ink on paper*

The product's own subject supplies the palette: ink is the structure you draw,
paper is the sheet, ledger green is the data that fills it, stamp red is only
ever a warning or a delete.

| Token | Hex | Role |
|---|---|---|
| Ink | `#16203A` | Text, structure, primary buttons |
| Ink soft | `#4A5570` | Secondary text, hints |
| Ink faint | `#8891A8` | Disabled, metadata |
| Paper | `#FBFAF7` | Panels, the sheet |
| Desk | `#E7E6E1` | Work surface behind the sheet |
| Rule | `#D6D5CF` | Hairlines, dividers, borders |
| Ledger | `#0E7C5A` | Data & variables. **Never a button fill.** |
| Stamp | `#B3242B` | Delete & errors only |
| Marker | `#C77E0A` | Warnings only |

Washes for badges/toasts: ledger `#E6F4EE`, stamp `#FBEceb`, marker `#FDF3E3`.

**Colour is functional.** Green always means "this is data". A control that
looks green is not necessarily clickable; actions are ink.

**Type — three roles**
- **Bitter** (slab serif) — wordmark, step names, section headlines, big numbers.
- **Archivo** — all UI text, 12–14px.
- **IBM Plex Mono** — variables, guide ids, coordinates, money.

**Sizing:** body 13px, labels 12px, section titles 15px, screen title 20px.
Controls 32px min height, primary actions 40px, icon buttons 32×32. Radii
6 / 10 / 12px. Spacing 4·8·12·16·24·32. One shadow for the sheet, one for
popovers. Chrome stays flat with `rule` hairlines.

**Motion:** 120–200ms ease-out for hover/panel; step change slides 200ms; live
overlay cross-fades. `prefers-reduced-motion` respected everywhere.

**Signature — the live overlay.** In step ③ the traced bill keeps its ink and
every dynamic slot lifts into ledger green with its variable name in mono.
Hovering a name in the data list lights its box on the sheet.

## 7. Design system components

Rebuilt in `components/ui/`: `Button` (primary/secondary/ghost/danger/icon),
`TextInput`, `NumberInput`, `Select`, `ColorInput`, `Checkbox`, `Radio`,
`Field`, `Section` (collapsible + indexed), `Dialog`, `Toast` + `ToastProvider`,
`Tooltip`, `Chip`, `Icon` (lucide-react), `StepPath`, `ToolRail`, `StageBar`,
`IndexNav`, `EmptyState`, `Badge`.

Tokens live in `app/globals.css` under Tailwind v4 `@theme`. Fonts move to
Bitter + Archivo + IBM Plex Mono via `next/font/google` in `app/layout.tsx`.

## 8. Feedback & errors

- `window.alert` is removed everywhere. Errors become toasts carrying a cause
  and a next action ("That file isn't a bill template. Pick a .json saved from
  this editor.").
- Destructive actions (Remove photo, Ungroup, Delete object) confirm inline or
  are undoable; they never use `window.confirm`.
- Export failures surface in the popover that triggered them, not a global
  banner.
- Refusals/warnings from the layout engine keep their amber treatment and gain
  plain-language text.

## 9. Accessibility floor

- Minimum text 12px; AA contrast for all text on all surfaces.
- Visible focus: 2px ink ring at 2px offset, on paper and on desk.
- 32px minimum target; 40px for primary actions.
- Keyboard: steps, tool rail, inspector sections and layers are all reachable;
  arrow-key navigation in the step path; `Esc` closes overlays; tool shortcuts
  shown in the rail, not hidden in `title` attributes.
- Icon-only buttons carry `aria-label`s. Live regions announce toasts.
- No information conveyed by colour alone (data slots get a dashed border *and*
  green).

## 10. Testing & verification

- `vitest` — all 926 existing tests must stay green. New tests are pure node
  tests (the repo's vitest runs `environment: "node"` over `tests/**/*.test.ts`):
  design-token drift against `globals.css`, step-state derivation, rename-map
  completeness, and the toast queue reducer. No test infrastructure is added
  (no jsdom, no testing-library) — that would be a new dependency surface for
  no gain over the existing setup.
- `playwright` — existing 11 specs drive the live app and target accessible
  names the rename map changes, so they are updated in the same pass and must
  pass unmodified afterwards in behaviour. UploadScreen redesigns must preserve
  the `input[type="file"][accept*="image/png"]` hook every spec uses to enter
  the editor, and `input[type="file"][accept*="json"]` for the template paths.
- `tsc --noEmit`, `eslint` clean.
- Programmatic walkthrough of both surfaces at 1440/1024/768 widths asserting
  every one of the inventoried controls is present and reachable.
- Visual confirmation by the human at each milestone (the model cannot read
  images).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Renames break e2e specs silently | Update specs in the same commit as the component; never delete an assertion, re-point it |
| A control is lost in the reorganisation | Section 12's inventory is the checklist; a test asserts every documented control is rendered for a representative selection per object type |
| `lucide-react` adds a dependency | Tree-shaken, ~2KB per icon; alternative is a hand-authored SVG set |
| Green misread as "clickable" | Hard rule: green never fills a button |
| Dense inspector stays long | Sticky index + collapsible sections with remembered state |
| Fabric canvas chrome fights the new layout | Stage stays a plain container; only overlays and the stage bar change |

## 12. Complete control inventory (must all remain reachable)

**Editor chrome:** wordmark · document name (editable) · Undo · Redo · Preview
toggle · Add bill photo · Open recent / Open a file · Save · Fill & print ·
Share · Get a copy (7 formats) · step path (5) · stage zoom out / 100 / zoom in
/ Fit · page size · object count · selection count · sampled colour.

**Tools (17):** select, guide-h, guide-v, line, hr, vr, rect, rounded-rect,
ellipse, polygon, freehand, text, table, image-placeholder, bill-part, field,
eyedropper — plus Finish polygon.

**Photo:** opacity, show, whiten-on-new-cuts, remove, "never exported" note,
grid size, show grid, snap to grid, snap to objects, full-span rules.

**Document:** new blank document, lock/unlock structure, page size, page growth
X/Y, max page W/H, overlap policy.

**Data fields:** list, per-field form label, type of answer (auto/text/number/
date/currency/tickmark/checkbox), maximum length, printed style (family, size,
bold, italic, colour, clear).

**Object:** name, what-this-is chips, X, Y, W, H, rotation, opacity, locked,
visible, line colour, line thickness, fill, alignment (6), space evenly H/V,
group, ungroup.

**Text:** text, insert variable, font, size, weight, style, alignment, custom
font, wrap toggle, role kind.

**Table:** rows, columns, line colour, line thickness, cell background, cell
padding, header row, header background, repeat band (from/to/data name/maximum/
repeat header), column widths, row heights, cell text grid, in-place cell edit
+ cell alignment.

**Picture slot:** what goes here (6 roles), label.
**Cut-out picture:** whiten paper, take it again.
**Data field (canvas object):** name, type of answer, colour, font, size,
weight, style, alignment, custom font.

**Layout engine:** growth per axis (3 modes), growth limit, wrap policy, which
line moves with it; attachments per edge (guide + follow/stretch); which frame
holds it; anchors per axis; container on/off; container growth per axis; inside
padding (4); smallest/largest allowed size (4); guide lines list with how-far-it-
can-move; delete-guide hint.

**Layers:** reference row, object rows, role subtitle, select, show/hide, lock,
move up, move down, empty state, count.

**Render page:** saved-template list with delete, upload template JSON, open
editor; fill sample data, clear, export values, import values; download PDF,
download HTML, print; save template to device (+name); error banner; refusal
banner; preview; dynamic form (text fields, table cells, images & signatures),
repeating table fieldset with add/remove row, per-type inputs, source hints,
empty state.
