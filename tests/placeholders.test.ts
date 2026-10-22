import { describe, expect, it } from "vitest";

import {
  analysePlaceholders,
  collectDocumentVariables,
  extractVariables,
  hasVariable,
  isDataFieldObject,
  SUGGESTED_VARIABLES,
  toToken,
} from "@/lib/template/placeholders";

describe("extractVariables", () => {
  it("finds every distinct variable in first-appearance order", () => {
    expect(
      extractVariables("{{customer_name}} / {{amount}} / {{customer_name}}"),
    ).toEqual(["customer_name", "amount"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractVariables("{{  total  }}")).toEqual(["total"]);
  });

  it("returns nothing for static text", () => {
    expect(extractVariables("Invoice No:")).toEqual([]);
  });

  it("supports dots and dashes in names", () => {
    expect(extractVariables("{{a.b-c}}")).toEqual(["a.b-c"]);
  });
});

describe("analysePlaceholders", () => {
  it("classifies a pure placeholder as a variable with a role", () => {
    const info = analysePlaceholders("{{customer_name}}");
    expect(info.roleKind).toBe("variable");
    expect(info.isPureVariable).toBe(true);
    expect(info.role).toBe("customer_name");
  });

  it("classifies static text as static with no role", () => {
    const info = analysePlaceholders("INVOICE");
    expect(info.roleKind).toBe("static");
    expect(info.role).toBeNull();
    expect(info.isPureVariable).toBe(false);
  });

  it("treats mixed text as a variable but assigns no single role", () => {
    const info = analysePlaceholders("Total: {{total}}");
    expect(info.roleKind).toBe("variable");
    expect(info.isPureVariable).toBe(false);
    expect(info.role).toBeNull();
    expect(info.variables).toEqual(["total"]);
  });

  it("does not treat a partial brace as a placeholder", () => {
    expect(hasVariable("Total: {total}")).toBe(false);
    expect(analysePlaceholders("Total: {total}").roleKind).toBe("static");
  });

  it("is not confused by repeated calls (no stateful regex leak)", () => {
    for (let i = 0; i < 5; i++) {
      expect(extractVariables("{{a}}")).toEqual(["a"]);
      expect(hasVariable("{{a}}")).toBe(true);
    }
  });
});

describe("toToken", () => {
  it("round-trips through analysis", () => {
    for (const v of SUGGESTED_VARIABLES) {
      expect(analysePlaceholders(toToken(v)).role).toBe(v);
    }
  });
});

describe("collectDocumentVariables", () => {
  it("unions variables across the document, sorted", () => {
    expect(
      collectDocumentVariables([
        "{{total}}",
        "{{customer_name}}",
        "{{total}}",
        "static",
      ]),
    ).toEqual(["customer_name", "total"]);
  });
});

describe("isDataFieldObject", () => {
  it("counts a drawn data-field box", () => {
    expect(isDataFieldObject({ appType: "field" })).toBe(true);
  });

  it("ignores text, image slots, tables and empty objects", () => {
    expect(isDataFieldObject({ appType: "text" })).toBe(false);
    expect(isDataFieldObject({ appType: "image-placeholder" })).toBe(false);
    expect(isDataFieldObject({ appType: "table" })).toBe(false);
    expect(isDataFieldObject({})).toBe(false);
  });
});
