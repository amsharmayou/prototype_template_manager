# Grouping and Wrapping Text — Design

Two features that make a traced bill easier to build and keep faithful: merging
several shapes into one editable structure, and giving a text box a fixed width
that wraps and grows downward.

Both were requested as editor conveniences. Neither changes what the exported
bill contains.

## Scope decisions

Four questions were settled before design:

| Question | Decision | Consequence |
|---|---|---|
| What does a group mean in the exported bill? | **Authoring-only** | `serialize.ts`, `hydrate.ts` and `primitives.ts` are untouched. The rendered output is byte-identical grouped or not. |
| Are groups nestable? | **Yes** | A group holds objects *and* other groups. Needs a cycle guard. |
| A wrapped box gets a value longer than the traced text? | **Grows downward** | The box keeps its width; nothing is clipped. |
| Does a grown box push neighbours? | **No — floats** | Traced geometry stays exactly where the author put it. |

## Part 1 — Grouping

### Authoring-only, and why that is nearly free

`renderText` and every other renderer in `lib/render/primitives.ts` place objects
with `position: absolute` from the object's own `x`/`y`, and paint in `zIndex`
order. Nothing reads containment. A group therefore has **no** representation in
the rendered output and needs no renderer change.

Membership is not recorded on the template's objects either. `baseFields`
(`lib/template/serialize.ts:119`) writes `parentId: null` unconditionally, and
`TemplateObjectBase.parentId` (`lib/template/types.ts:45`) documents itself as
*"Set when this object is inside a group. Keeps the array flat."* — a contract
that has never been implemented. Membership lives only in `EditorState.groups`.

The one persisted trace is `TextObject.parentGroupIds?: string[]`, needed so a
placeholder's owning group can be found in the **/render** app, which is a
separate React app with no access to editor state. This is covered in
"Part 3 — shared model".

### The model

Groups live in editor state as a flat, self-referencing list. This keeps
membership out of Fabric objects entirely, which is what lets a Fabric
`ActiveSelection` hold mixed members without transform bookkeeping.

```ts
export interface GroupNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Object ids AND group ids. Nesting is just a tree. */
  members: string[];
}
```

`EditorState.groups: GroupNode[]`.

Objects stay flat on the canvas with absolute coordinates. A Fabric object has
**no** knowledge of its group; the controller resolves it.

### Undo/redo — the one real trap

History is `HistoryStack<string>` (`lib/canvas/history.ts:10`), and snapshots are
`JSON.stringify(serialiseObjects(...))` strings
(`lib/canvas/EditorController.ts:1321`). If groups lived only in `EditorState`,
then:

1. `commit()` would compare a before/after snapshot that ignores groups, decide
   nothing changed, and record **no history entry at all**;
2. undo would restore geometry but silently drop the grouping.

So the snapshot payload becomes `{ template, groups }` and `snapshot()` /
`restoreSnapshot()` are widened together. `HistoryStack<T>` is generic, so no
change is needed in `history.ts` itself. Group edits then undo and redo exactly
like any other edit, and a grouping change is always a detectable change.

### Invariants

Enforced by a `lib/canvas/groups.ts` helper module, kept free of Fabric imports
so it is unit-testable in the node test environment.

1. An object belongs to **at most one** group. Grouping a selection that contains
   grouped objects **absorbs** those groups: the child group is removed and its
   members are re-pointed at the new group, so no object ends up in two groups
   and no empty shells are left behind.
2. A group is listed in exactly one `members` array.
3. **No cycles.** A group can never become a descendant of itself.
   `canNest(parentId, groups)` walks the ancestor chain and refuses.
4. Removing a group **re-parents** its members to the removed group's own parent,
   so unwrapping never orphans an object into limbo.

### Behaviour

- **Group** (`groupSelection`) — requires ≥2 selected objects. Absorbs any groups
  already containing those objects (§1).
- **Ungroup** (`ungroupSelection`) — acts on the single selected group. Its
  members move up to its parent; the group is removed (§4).
- **Click selects the group.** Pointer-down on an object that belongs to a group
  selects the whole group. `Alt`+click selects just that object, so a single
  shape inside a group stays editable.
- **Delete removes the whole structure.** Selecting a group and pressing Delete
  removes the group node *and* its objects, the way Word does. **Ungroup** is the
  non-destructive way to dissolve a group and leave its objects loose, so the
  destructive case does not need a second, gentler gesture.
- Shortcuts: `Ctrl+G` / `Ctrl+Shift+G`.

### UI

- `MultiSelectPanel` (`components/editor/PropertiesPanel.tsx:859`) replaces the
  prose-only `<Panel title="Group">` — which today renders no control at all —
  with **Group** and **Ungroup** buttons.
- `LayersPanel` renders a nested group row with expand/collapse, so the tree is
  visible. Its existing dead `TYPE_GLYPH.group = "▣"` entry becomes live.

## Part 2 — Wrapping Text

### The model

One optional field on `TextObject`:

```ts
/** When present the box wraps at this width. Absent means auto-width, one line. */
wrapWidth?: number;
```

Absent is the default, so every existing text box is unaffected. Wrapping is
opt-in per box.

### Why the canvas object type must change

Fabric only treats `width` as a layout boundary on a `Textbox`. On an `IText`,
`width` is not in `textLayoutProperties`, so `set({width})` is discarded by the
next layout pass. An `IText` therefore *cannot* wrap, and today the **Width**
field in the properties panel is inert for text.

- The text tool keeps creating an `IText` — auto-width, unchanged.
- A **Wrap** toggle in `TextPanel` converts the object:
  `IText → Textbox` carrying the same text, position, fonts, scale and identity,
  starting at its current width so nothing reflows on the toggle. Drag the right
  handle narrower and it wraps. Toggling off converts back to `IText`.
- `hydrateText` builds a `Textbox` when `wrapWidth` is present, an `IText`
  otherwise, so an unwrapped box is untouched by this feature.

Conversion preserves `id`, `name`, `role`, `locked`, `visible`, `opacity`,
`angle`, `zIndex`, `scaleX`/`scaleY` and `roleKind`, and is undone as one step.

### Renderer

For a wrapped box, `renderText` emits instead of today's `white-space: pre` +
fixed height:

```
white-space: pre-wrap; overflow-wrap: break-word;
width: <wrapWidth>px; height: auto
```

`overflow-wrap: break-word` is required, not cosmetic: `pre-wrap` alone will not
break a single unbreakable token, so a 15-character GSTIN or a filled-in email
address would run straight past the box.

`height: auto` is what delivers "grow downward". Combined with the float
decision, a grown box paints over whatever is beneath it and nothing reflows.

### Interaction with the stretch fix

Unchanged. `width` in the template stays the **unscaled** `wrapWidth` and
`transform: scale()` scales the already-wrapped result, which is exactly what
Fabric does on canvas. A wrapped and stretched box therefore survives save and
reload with both behaviours intact.

## Part 3 — Shared model

`GroupNode` lives in its own module (`lib/canvas/groups.ts`) because the
controller needs it and so does `/render`. Group *membership of objects* is
editor state and is never serialised.

The one place a group id must survive into the template is
`TextObject.parentGroupIds?: string[]`, written from the object's own
`parentGroupIds` property in `serialiseText`. `/render` uses it to label a
placeholder with the group that owns it, since it has no access to editor state.
It is `undefined` for every object that is not in a group.

## Latent bugs fixed in passing

Both are prerequisites, not drive-by changes:

1. **`hydrateText` ignores `width` and `height`** (`lib/template/hydrate.ts:85`).
   Its options literal omits both. Any wrap boundary would be discarded on
   reload, so wrapping could not survive a save cycle. It also means the
   properties panel's Width field silently does nothing for text today.
2. **`serialiseText` hardcodes `textVerticalAlign: "top"`**
   (`lib/template/serialize.ts:240`), so the field has never reflected the object.
   Read it off the object. No new UI is added for it.

## Out of scope

- Groups in the exported bill (decided: authoring-only).
- Reflow of neighbours when a wrapped box grows (decided: float).
- Nested group scaling with transform math — a Fabric `ActiveSelection` moves and
  scales its members as a unit, and each member records the resulting transform
  on itself, exactly as it already does today for any multi-select. No group
  geometry is stored, so there is nothing to keep in sync.
- Vertical-alignment UI for text.

## Testing

**Unit** — `tests/groups.test.ts` (new): absorption, no-duplicate-membership,
cycle refusal, re-parenting on removal, ancestor walking.
`tests/serialize.test.ts`: `wrapWidth` written and omitted; `parentGroupIds`
written; `hydrateText` restores width/height and builds the right class.
`tests/render.test.ts`: wrapped box emits `pre-wrap` + `break-word` +
`height: auto`; unwrapped box is unchanged.

**E2E** — `e2e/workflow.spec.ts`: group four objects, assert the template is
unchanged by grouping (authoring-only), move the group, undo restores both
geometry and grouping; click selects the whole group, `Alt`+click selects one;
delete leaves the objects. Wrap: toggle a box, narrow it, type a long value,
assert the exported HTML carries the wrap CSS and no `{{token}}` clipping.

**Regression** — all 287 unit and 49 E2E tests must stay green, since neither
feature touches the serialiser's geometry path or any renderer branch for
unwrapped objects.
