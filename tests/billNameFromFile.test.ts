import { describe, expect, it } from "vitest";

import { billNameFromFile } from "@/lib/client/billNameFromFile";

/**
 * The name chosen here becomes the package name everywhere: the `.btpkg`
 * filename, the admin catalog row and the Android "Browse templates" list. A
 * scanner's filename leaking through is what this guards against.
 */
describe("billNameFromFile", () => {
  it("keeps a name a person would recognise, without the extension", () => {
    expect(billNameFromFile("Lucky Cargo Movers.png")).toBe("Lucky Cargo Movers");
    expect(billNameFromFile("lorry-receipt.jpg")).toBe("lorry-receipt");
    expect(billNameFromFile("Tax invoice Feb.webp")).toBe("Tax invoice Feb");
  });

  it("replaces a screenshot name, with or without its timestamp", () => {
    expect(billNameFromFile("Screenshot 2025-11-19 041211.png")).toBe("Bill");
    expect(billNameFromFile("Screenshot_2025-11-19.png")).toBe("Bill");
    expect(billNameFromFile("screenshot.png")).toBe("Bill");
  });

  it("replaces a camera's bookkeeping name", () => {
    expect(billNameFromFile("IMG_4821.jpg")).toBe("Bill");
    expect(billNameFromFile("DSC00042.JPG")).toBe("Bill");
    expect(billNameFromFile("PXL_20260101_120000.png")).toBe("Bill");
  });

  it("replaces a bare date or number", () => {
    expect(billNameFromFile("2025-11-19 041211.png")).toBe("Bill");
    expect(billNameFromFile("20251119.png")).toBe("Bill");
    expect(billNameFromFile("12345.png")).toBe("Bill");
  });

  it("falls back to a neutral name when nothing is left", () => {
    expect(billNameFromFile("")).toBe("Bill");
    expect(billNameFromFile(".png")).toBe("Bill");
    expect(billNameFromFile("   .png")).toBe("Bill");
  });

  it("tidies separators and ignores any path the name carries", () => {
    expect(billNameFromFile("C:\\photos\\my_bill.png")).toBe("my bill");
    expect(billNameFromFile("folder/invoice final.png")).toBe("invoice final");
  });

  it("does not mistake a real name that merely starts with a camera prefix", () => {
    // `IMG_4821` is bookkeeping; `IMG Supplies receipt` is not.
    expect(billNameFromFile("IMG Supplies receipt.png")).toBe("IMG Supplies receipt");
    expect(billNameFromFile("Photos of damage.png")).toBe("Photos of damage");
  });
});
