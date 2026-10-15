"use client";

import { Field, NumberInput, Panel, Select } from "@/components/ui/Controls";
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

/**
 * The variable-layout authoring surface.
 *
 * Two things live here, and they are deliberately separate:
 *
 *  - **Growth** is a property of one object - "this text box may get taller".
 *  - **Attachments** are a fact about a pair - "this box's bottom edge follows
 *    that guide".
 *
 * Keeping them apart is what stops the panel from implying that a growing
 * object needs a guide at all: a text box set to expand on its own simply
 * reflows, and a guide is only involved when something else has to move with
 * it.
 */

const GROWTH_OPTIONS: { value: GrowthMode; label: string }[] = [
  { value: "fixed", label: "Fixed size" },
  { value: "unbounded", label: "Expand as needed" },
  { value: "bounded", label: "Expand, with a limit" },
];

const EDGE_OPTIONS: { value: AttachmentEdge; label: string }[] = [
  { value: "top", label: "Top edge" },
  { value: "bottom", label: "Bottom edge" },
  { value: "left", label: "Left edge" },
  { value: "right", label: "Right edge" },
];

const STRATEGY_OPTIONS: { value: TextWrapPolicy; label: string }[] = [
  { value: "wrap", label: "Wrap within width" },
  { value: "noWrap", label: "Keep on one line" },
];

const BEHAVIOR_OPTIONS: { value: AttachmentBehavior; label: string }[] = [
  { value: "move", label: "Move with guide" },
  { value: "stretch", label: "Stretch with guide" },
];

const DOCUMENT_GROWTH_OPTIONS: { value: DocumentGrowth; label: string }[] = [
  { value: "fixed", label: "Fixed page" },
  { value: "expand", label: "Let page grow" },
];

const ANCHOR_OPTIONS: { value: AnchorRule; label: string }[] = [
  { value: "start", label: "Keep top/left offset" },
  { value: "end", label: "Keep bottom/right inset" },
  { value: "stretch", label: "Stretch with parent" },
];

const CONTAINER_GROWTH_OPTIONS: { value: ContainerGrowth; label: string }[] = [
  { value: "content", label: "Grow around children" },
  { value: "fixed", label: "Fixed size" },
];

const COLLISION_OPTIONS: { value: CollisionPolicy; label: string }[] = [
  { value: "report", label: "Report overlap" },
  { value: "allow", label: "Allow overlap" },
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
  /**
   * A non-negative number, or "unset".
   *
   * These limits are optional, and an optional number the author has cleared
   * must go away rather than persist as a zero - a container capped at 0px is a
   * different, unprintable thing from one with no cap at all.
   */
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
    <Panel title="Variable layout — container">
      <p className="text-[11px] text-neutral-500">
        Membership is explicit: a child names its container. Proximity alone
        never joins them.
      </p>
      <Field label="Layout parent" hint="Distinct from editor groups.">
        <Select
          value={layoutParentId ?? ""}
          options={[
            { value: "", label: "No parent" },
            ...choices.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` })),
          ]}
          onChange={(v) => controller.setLayoutParent(objectId, v || null, "Layout parent")}
        />
      </Field>
      {layoutParentId ? (
        <>
          <Field label="Horizontal anchor">
            <Select
              value={anchor?.horizontal ?? "start"}
              options={ANCHOR_OPTIONS}
              onChange={(v) => setAnchorAxis("horizontal", v as AnchorRule)}
            />
          </Field>
          <Field label="Vertical anchor">
            <Select
              value={anchor?.vertical ?? "start"}
              options={ANCHOR_OPTIONS}
              onChange={(v) => setAnchorAxis("vertical", v as AnchorRule)}
            />
          </Field>
        </>
      ) : null}
      {isContainerShape(objectType) ? (
        <>
          <Field label="Container" hint="Only an enabled frame grows around its children.">
            <Select
              value={enabled ? "on" : "off"}
              options={[
                { value: "off", label: "Plain frame" },
                { value: "on", label: "Layout container" },
              ]}
              onChange={(v) =>
                v === "on"
                  ? controller.setContainer(objectId, withPolicy({}), "Container")
                  : controller.setContainer(objectId, undefined, "Container")
              }
            />
          </Field>
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
                  Inside padding (px)
                </p>
                <p className="text-[10px] text-neutral-400">
                  The gap the frame keeps around its children when it grows. With
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
                  Size limits (px)
                </p>
                <p className="text-[10px] text-neutral-400">
                  Blank means no limit. A frame that stops at its maximum reports
                  the child that no longer fits.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min width">
                    <NumberInput
                      value={container?.minWidth ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("minWidth", v, "Container minimum")}
                    />
                  </Field>
                  <Field label="Min height">
                    <NumberInput
                      value={container?.minHeight ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("minHeight", v, "Container minimum")}
                    />
                  </Field>
                  <Field label="Max width">
                    <NumberInput
                      value={container?.maxWidth ?? Number.NaN}
                      min={0}
                      onChange={(v) => setSize("maxWidth", v, "Container maximum")}
                    />
                  </Field>
                  <Field label="Max height">
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
    </Panel>
  );
}

/**
 * A vertical guide moves left/right edges; a horizontal one moves top/bottom.
 *
 * Offering the wrong pairing would let an author attach a box's left edge to a
 * horizontal guide and quietly get nothing, so the options are filtered rather
 * than disabled - a control that cannot be wrong is better than one that can.
 */
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
    // An axis that stops expanding has nothing left to cap, and a stale
    // `maxGrowth` on a fixed axis would be read as a limit that does nothing.
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
    // Y growth pushes a horizontal boundary down; X growth pushes a vertical
    // one right. Offering the cross pairing would silently do nothing, and a
    // dropped guide id would fail validation instead — filter here.
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
          <Field label="Maximum extra">
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
                  { value: "", label: "Default" },
                  ...STRATEGY_OPTIONS,
                ]}
                onChange={(v) =>
                  setStrategy(axis, (v || undefined) as TextWrapPolicy | undefined)
                }
              />
            </Field>
            {growthGuides.length > 0 ? (
              <Field
                label={`${label} pushes guide`}
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
    <Panel title="Variable layout — growth">
      <p className="text-[11px] text-neutral-500">
        Lets this object take more room when a value is longer than the space
        traced for it.
      </p>
      {axisRow("y", "Vertical")}
      {axisRow("x", "Horizontal")}
    </Panel>
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
    <Panel title="Variable layout — attachments">
      <p className="text-[11px] text-neutral-500">
        A moving guide drags the chosen edge with it. Move keeps the size;
        stretch holds the opposite edge and resizes.
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
    </Panel>
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
    <Panel title={`Variable layout — guides (${guides.length})`}>
      {guides.map((g) => (
        <div
          key={g.id}
          className="flex items-end gap-2 border-b border-neutral-100 py-1 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-neutral-700">
              {g.id} · {g.orientation === "horizontal" ? "horizontal" : "vertical"} @{" "}
              {Math.round(g.position)}px
            </p>
            <Field label="Max travel">
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
      <p className="text-[10px] text-neutral-400">
        Page is {Math.round(documentHeight)}px tall. Select a guide and press
        Delete to remove it.
      </p>
    </Panel>
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
  // Absent policy reads as "fixed page": it is what every legacy template
  // renders, so showing blank caps instead of zero keeps "never configured"
  // distinct from "capped at zero".
  const growthX = doc?.growthX ?? "fixed";
  const growthY = doc?.growthY ?? "fixed";

  const setDoc = (
    patch: Partial<{ growthX: DocumentGrowth; growthY: DocumentGrowth }>,
    label: string,
  ) => {
    controller.updateLayout((layout) => {
      // No guides and no document edits means no layout block: the template
      // stays fixed-layout rather than gaining an empty variable shell.
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

  // Only shown once the template has a layout block or the author has grown
  // something: a fixed bill needs no page policy UI getting in its way.
  const hasLayout = state.layout !== undefined;
  const hasGrowth =
    growthX !== "fixed" || growthY !== "fixed" || doc?.maxWidth !== undefined || doc?.maxHeight !== undefined;
  if (!hasLayout && !hasGrowth) return null;

  return (
    <Panel title="Variable layout — page">
      <p className="text-[11px] text-neutral-500">
        Fixed keeps the traced sheet and reports overflow; expand lets the page
        follow the content.
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
      <Field label="Max page width" hint="Blank means no explicit cap.">
        <NumberInput
          value={doc?.maxWidth ?? Number.NaN}
          onChange={(v) =>
            setCap("maxWidth", !Number.isFinite(v) || v <= 0 ? null : v)
          }
        />
      </Field>
      <Field label="Max page height" hint="Blank means no explicit cap.">
        <NumberInput
          value={doc?.maxHeight ?? Number.NaN}
          onChange={(v) =>
            setCap("maxHeight", !Number.isFinite(v) || v <= 0 ? null : v)
          }
        />
      </Field>
      <Field label="Sibling overlap" hint="Report keeps geometry and warns; allow stays silent.">
        <Select
          value={state.layout?.collision ?? "report"}
          options={COLLISION_OPTIONS}
          onChange={(v) => setCollision(v as CollisionPolicy)}
        />
      </Field>
    </Panel>
  );
}

/**
 * The layout panels for whatever is selected.
 *
 * Rendered beside the normal property panels rather than in place of them:
 * growth and attachment are additions to an object, not replacements for its
 * appearance settings, and an author who has set both should see both.
 */
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
  /** Empty string when nothing is selected, which hides the per-object panels. */
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