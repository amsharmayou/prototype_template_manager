import { describe, expect, it } from "vitest";

import { migrateTemplate } from "@/lib/template/migrate";
import {
  TEMPLATE_VERSION,
  type PlaceholderSpec,
} from "@/lib/template/types";

// Deliberately untyped, and deliberately NOT annotated as `BillTemplate`:
// `BillTemplate` describes a template at the *current* version, so a v1 document
// was never one. Passing it as untrusted `unknown` input is what migrateTemplate
// is specified to accept. Do not "restore" the annotation.
const v1 = {
  templateVersion: 1,
  document: { width: 794, height: 1123 },
  meta: { name: "Old bill", modifiedAt: "2026-01-01T00:00:00.000Z" },
  objects: [],
};

describe("migrateTemplate", () => {
  it("passes a v1 template through unchanged and reports the version it saw", () => {
    const { template, notes } = migrateTemplate(v1);
    expect(template.templateVersion).toBe(TEMPLATE_VERSION);
    expect(template.objects).toEqual([]);
    expect(template.document).toEqual({ width: 794, height: 1123 });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("refuses a template claiming a newer version than this build supports", () => {
    expect(() => migrateTemplate({ ...v1, templateVersion: TEMPLATE_VERSION + 1 })).toThrow(
      /exceeds/,
    );
  });

  it("stamps a missing version rather than leaving it undefined", () => {
    const { template } = migrateTemplate({
      document: { width: 794, height: 1123 },
      meta: { name: "No version", modifiedAt: "2026-01-01T00:00:00.000Z" },
      objects: [],
    });
    expect(template.templateVersion).toBe(TEMPLATE_VERSION);
  });

  it("supplies a default document and name for an empty object", () => {
    const { template } = migrateTemplate({});
    expect(template.document.width).toBeGreaterThan(0);
    expect(template.document.height).toBeGreaterThan(0);
    expect(template.meta.name.length).toBeGreaterThan(0);
    expect(template.objects).toEqual([]);
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42, "nope", [], { objects: "no" }]) {
      expect(() => migrateTemplate(bad)).not.toThrow();
    }
  });

  it("keeps an existing repeat band untouched", () => {
    const { template } = migrateTemplate({
      ...v1,
      templateVersion: TEMPLATE_VERSION,
      objects: [
        {
          id: "t1",
          type: "table",
          name: "Items",
          role: null,
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 0,
          parentId: null,
          stroke: "",
          strokeWidth: 0,
          fill: "",
          rows: 3,
          columns: 2,
          colWidths: [50, 50],
          rowHeights: [20, 20, 20],
          cells: [],
          borderColor: "#000",
          borderWidth: 1,
          cellFill: "",
          headerRow: true,
          headerFill: "",
          headerTextColor: "",
          cellTextColor: "",
          padding: 2,
          fontFamily: "Arial",
          repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 50 },
        },
      ],
    });
    expect((template.objects[0] as { repeat?: unknown }).repeat).toEqual({
      startRow: 1,
      endRow: 1,
      key: "items",
      maxItems: 50,
    });
  });

  it("carries the placeholder contracts through instead of dropping them", () => {
    // `extractTemplateFields` and `fillTemplate` both read `meta.placeholders`.
    // A migration that rebuilds `meta` from name and date alone silently turns
    // every typed slot back into a bare token, which is a lossy round trip.
    const placeholders: PlaceholderSpec[] = [
      { key: "customer_name", label: "Customer", type: "text", maxLength: 80 },
      { key: "total", label: "Total", type: "currency" },
    ];
    const { template } = migrateTemplate({
      ...v1,
      templateVersion: TEMPLATE_VERSION,
      meta: {
        name: "With specs",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        placeholders,
      },
    });
    expect(template.meta.placeholders).toEqual(placeholders);
  });

  it("omits a non-array placeholders rather than carrying garbage through", () => {
    // Absent and present-but-empty are different states in this codebase, so
    // the key is left off entirely rather than set to `undefined`.
    const { template } = migrateTemplate({
      ...v1,
      meta: {
        name: "Bad specs",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        placeholders: "nope",
      },
    });
    expect("placeholders" in template.meta).toBe(false);
  });

  it("keeps an unknown extra meta key instead of whitelisting meta away", () => {
    // Guards the bug class, not just today's bug: `meta` is rebuilt by
    // spreading, so a field added to `TemplateMeta` tomorrow survives without
    // needing a matching edit here. Whitelisting name/date/placeholders would
    // silently drop it. `name` is absent here, so it must still be normalised.
    const { template } = migrateTemplate({
      ...v1,
      meta: {
        modifiedAt: "2026-01-01T00:00:00.000Z",
        futureField: { deep: true },
      },
    });
    expect((template.meta as unknown as Record<string, unknown>).futureField).toEqual({
      deep: true,
    });
    expect(template.meta.name).toBe("Untitled bill");
  });
});