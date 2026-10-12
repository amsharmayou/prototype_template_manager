"use client";

/**
 * Export the edited template as a `.btpkg` — the file a host application opens.
 *
 * This is the only path from the editor to the Android host. "JSON Template" is
 * not a substitute: it carries no manifest, no asset references and no field or
 * computed declarations, so a host reading it has nothing to build a form from.
 */

import { downloadBlob } from "@/lib/export/download";
import { buildPackage, writePackage } from "@/lib/package/build";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { Issue } from "@/lib/package/format";
import { parsePackage } from "@/lib/package/parse";
import { validatePackage } from "@/lib/package/validate";
import type { BillTemplate } from "@/lib/template/types";

/**
 * What the export produced.
 *
 * `issues` is returned even on success: a package can be written with a warning
 * the author should see, and swallowing it would make the button look infallible.
 */
export interface PackageExportResult {
  filename: string;
  bytes: Uint8Array;
  issues: Issue[];
}

/** Build the archive, or report every reason it would not be usable. */
export function buildPackageBytes(template: BillTemplate): {
  bytes: Uint8Array;
  issues: Issue[];
} {
  const bytes = writePackage(
    buildPackage(template, { computed: computedSpecsFor(template) }),
  );

  // Validated against the bytes that are about to ship, not against the object
  // that produced them. The round trip is what carries the manifest's digest
  // alongside it, which is the only way to check that pair actually agrees.
  const { issues } = validatePackage(parsePackage(bytes));
  return { bytes, issues };
}

/** Issues that should stop the download: an error makes the package unusable. */
export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function packageFilename(template: BillTemplate): string {
  const name = template.meta?.name ?? "";
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${cleaned || "bill"}.btpkg`;
}

/**
 * Build and download the package.
 *
 * Throws when validation found an error, rather than handing the user an archive
 * that will fail later, on another machine, with a message that names a symptom
 * instead of the cause.
 */
export function exportPackage(template: BillTemplate): PackageExportResult {
  const { bytes, issues } = buildPackageBytes(template);
  const errors = blockingIssues(issues);
  if (errors.length > 0) {
    throw new Error(describeIssues(errors));
  }

  const filename = packageFilename(template);
  // Copied to a fresh array: `Blob` will not take a view onto a shared buffer,
  // and the Uint8Array here is a view into the zip writer's output.
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), filename);

  return { filename, bytes, issues };
}

/** One line per issue, for the menu's error slot. */
export function describeIssues(issues: Issue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}