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
  /**
   * The image type the bytes were declared as, e.g. `image/webp`.
   *
   * Optional, because a package written before this field existed does not carry
   * one. It records what a member's *name* cannot: `buildPackage` sanitises a
   * declared subtype into a filename-safe token, so `image/svg+xml` is archived
   * as `.svg-xml` and that substitution is lossy. A reader that re-derived the
   * type from the extension would relabel the bytes as something they are not.
   */
  mime?: string;
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

/**
 * One derived value.
 *
 * Entries in a package's `computed` list may read each other in **any** order: a
 * forward reference is legal, so the reference graph is not required to be
 * topologically sorted and declaration order carries no meaning.
 *
 * The graph **is** required to be acyclic, and the reason is order-sensitivity:
 * whatever order an evaluator picks, some entry of a cycle will be evaluated
 * before a value it depends on has been produced. The entry then reads nothing,
 * contributes zero, and the bill prints a total that is quietly wrong rather than
 * visibly broken. `validateManifest` in `lib/package/validate.ts` walks the graph
 * and rejects any cycle, including an entry that reads its own key.
 */
export interface ComputedSpec {
  key: string;
  op: ComputedOp;
  /**
   * A dotted arg such as `items.amount` means column `amount` of repeat `items`.
   * An undotted arg is a flat values key.
   *
   * Note that a dot is a legal character inside a key too, so `items.amount` is
   * resolved as a whole name first and only read as a path if no key matches it.
   *
   * Every arg must resolve, to a declared field key, to the key of another
   * computed entry, or - when dotted - to a column of a declared repeating field.
   */
  args: string[];
  /** Read by `percent`; the percentage rate. Resolved the same way as an arg. */
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
  /**
   * The manifest member as read, carried beside the digest it is checked against.
   * The manifest cannot sit in `checksums`, because a file cannot hold its own hash.
   */
  manifestBytes?: Uint8Array;
  /** Digest of the manifest as read, verified by `validatePackage`. */
  manifestSha256?: string;
}
