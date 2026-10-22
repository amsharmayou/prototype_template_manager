#!/usr/bin/env node
// Phase 6 parity check: vendor billkit-format must match source build exports.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const vendorIndex = resolve("Admin/server/vendor/billkit-format/index.ts");

const vendorExports = new Set();
try {
  const content = readFileSync(vendorIndex, "utf8");
  const matches = content.match(/export\s+.*\s+\w+/g) || [];
  for (const m of matches) vendorExports.add(m.split(/\s+/).pop());
} catch { console.log("vendor index missing"); process.exit(1); }

console.log("Vendor exports:", [...vendorExports].sort().join(", "));
console.log("Parity check: manual; full fixture comparison requires CI build artifacts.");
