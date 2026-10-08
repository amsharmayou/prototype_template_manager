/**
 * The `.btpkg` manifest: the contract a foreign frontend reads before it has
 * seen the template it describes.
 *
 * Deliberately separate from `lib/template/types.ts`. That file is the *in-memory
 * render format* and carries inline data URIs; this is the *distributable* format
 * and references assets by file. Keeping them apart is what lets the existing
 * pure renderer keep working unchanged.
 */

export const PACKAGE_VERSION = 1 as const;

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Dotted path into the package, e.g. `assets[2].file`. */
  path: string;
  message: string;
}

export interface ManifestDocument {
  width: number;
  height: number;
  unit: "px";
  dpi: number;
  paper: string;
  /** Decimal places money is held in; amounts are integers of this scale. */
  currencyScale: number;
}

export interface ManifestAsset {
  id: string;
  role: "bill-part" | "image-placeholder";
  /** Archive-relative path, e.g. `assets/obj_7.png`. */
  file: string;
  width: number;
  height: number;
}

export interface ManifestFont {
  family: string;
  file: string;
  sha256: string;
}

/**
 * `"repeating"` is a package-layer kind, not a renderer one: it is meaningful
 * only on a field whose `source` is `table` and whose table carries a
 * `TableRepeat`. It is intentionally absent from `FieldType` in
 * `lib/template/dataBinding.ts`, which the renderer reads.
 */
export type ManifestFieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image"
  | "repeating";

export interface ManifestField {
  key: string;
  label: string;
  type: ManifestFieldType;
  source: "text" | "table" | "image-placeholder" | "field";
  objectName: string;
  maxLength?: number;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
  /** Column keys of a repeating field, in band order. */
  columns?: string[];
  maxItems?: number;
}

export type ComputedOp =
  | "sum"
  | "sum-times"
  | "add"
  | "subtract"
  | "multiply"
  | "percent";

export interface ComputedSpec {
  key: string;
  op: ComputedOp;
  /**
   * A dotted arg such as `items.amount` means column `amount` of repeat `items`.
   * An undotted arg is a flat values key.
   *
   * Note that a dot is a legal character inside a key too, so `items.amount` is
   * resolved as a whole name first and only read as a path if no key matches it.
   */
  args: string[];
  /**
   * Read by `percent`; the percentage rate.
   *
   * Entries in this list may read each other in any order - a forward reference
   * is legal, so the graph is not required to be topologically sorted. It *is*
   * required to be acyclic: entries are evaluated in array order, so a cycle
   * would read a value that has not been produced, silently contribute zero, and
   * print a wrong total. `validateManifest` in `lib/package/validate.ts` proves
   * acyclicity and rejects a self-referencing entry.
   */
  rateKey?: string;
}

export interface PackageManifest {
  packageVersion: typeof PACKAGE_VERSION;
  templateVersion: number;
  name: string;
  document: ManifestDocument;
  /** Archive-relative path of the template document. */
  template: string;
  assets: ManifestAsset[];
  fonts: ManifestFont[];
  fields: ManifestField[];
  computed: ComputedSpec[];
  /** SHA-256 per archive file, keyed by that path. */
  checksums: Record<string, string>;
}

export interface PackageFile {
  name: string;
  bytes: Uint8Array;
}

export interface Package {
  manifest: PackageManifest;
  /** Every archive member except the manifest, keyed by its archive-relative path. */
  files: Map<string, Uint8Array>;
}
