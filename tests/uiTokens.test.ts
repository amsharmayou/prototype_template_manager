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
