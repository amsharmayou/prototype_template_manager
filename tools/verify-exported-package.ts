/**
 * Check an exported .btpkg with the same code a host would use.
 *
 * Run: npx tsx tools/verify-exported-package.ts <path>
 */
import { readFileSync } from "node:fs";

import { parsePackage } from "@/lib/package/parse";
import { resolvePackage } from "@/lib/package/resolve";
import { validatePackage } from "@/lib/package/validate";
import { deriveForm } from "@/lib/package/form";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx tools/verify-exported-package.ts <file.btpkg>");
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(path));
const pkg = parsePackage(bytes);
const { ok, issues } = validatePackage(pkg);

console.log(`file       ${path}`);
console.log(`name       ${pkg.manifest.name}`);
console.log(`page       ${pkg.manifest.document.width}x${pkg.manifest.document.height}`);
console.log(`fields     ${pkg.manifest.fields.length}`);
console.log(`assets     ${pkg.manifest.assets.length}`);
console.log(`computed   ${pkg.manifest.computed.map((c) => `${c.key}=${c.op}(${c.args.join(",")})`).join(" ") || "none"}`);
console.log(`checksums  ${Object.keys(pkg.manifest.checksums).length}`);
console.log(`valid      ${ok ? "yes" : "NO"}`);
for (const issue of issues) console.log(`  [${issue.severity}] ${issue.path}: ${issue.message}`);

const { template, unresolved } = resolvePackage(pkg);
const schema = deriveForm(pkg.manifest, template);
console.log(`unresolved ${unresolved.length === 0 ? "none" : unresolved.join(", ")}`);
console.log(`form       ${schema.fields.length} fields, ${schema.groups.length} groups, ${schema.repeats.length} bands`);

process.exit(ok ? 0 : 1);