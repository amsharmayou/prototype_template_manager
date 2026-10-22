import { type Issue, type Severity } from "./format";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Checks the optional variable-layout block of a template.
 *
 * Reported rather than thrown, for the same reason the rest of this package
 * reports: a malformed rule is something an author can be told about, and
 * refusing to open the bill at all would be a worse answer than opening it with
 * the fixed geometry and a list of what was ignored.
 *
 * Every error names the path it came from, because a template with nine fields
 * and two guides is not diagnosable from "invalid layout".
 */

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
  // Absent is the common case and the correct one: it is how a fixed-layout
  // template says so.
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

  /* ---------------------------------------------------------------- */
  /* Guides                                                             */
  /* ---------------------------------------------------------------- */

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
          // A duplicate id makes every reference to it ambiguous: the second
          // guide silently wins in whichever map is built first.
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

  /* ---------------------------------------------------------------- */
  /* Attachments                                                       */
  /* ---------------------------------------------------------------- */

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
          // A horizontal guide has a y coordinate; it cannot control a left or
          // right edge. Caught here rather than at layout time, where it would
          // be one silently ignored rule among many.
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

  /* ---------------------------------------------------------------- */
  /* Document policy                                                   */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /* Layout hierarchy: containers, parents, anchors                    */
  /* ---------------------------------------------------------------- */

  // Reuses `objectIds` from the attachments section above: every declared
  // object id, used here to check parent links.

  // A layout parent must be a declared object; a cycle would make inner→outer
  // propagation unsatisfiable, so it is refused up front rather than iterated.
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

  // Walk parent links; a revisit means the chain loops back on itself.
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

  /* ---------------------------------------------------------------- */
  /* Per-object expansion                                              */
  /* ---------------------------------------------------------------- */

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
          // `bounded` with no growth is not a bounded policy, it is a fixed one
          // spelled the long way, and it would silently never expand.
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
          // Growth downward pushes a horizontal boundary; growth rightward
          // pushes a vertical one. Getting this backwards moves the wrong part
          // of the bill, so it is refused rather than reinterpreted.
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