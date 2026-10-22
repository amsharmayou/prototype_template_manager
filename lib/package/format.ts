/**
 * The `.btpkg` manifest: the contract a foreign frontend reads before it has
 * seen the template it describes.
 *
 * Deliberately separate from `lib/template/types.ts`. That file is the *in-memory
 * render format* and carries inline data URIs; this is the *distributable* format
 * and references assets by file. Keeping them apart is what lets the existing
 * pure renderer keep working unchanged.
 */

export const PACKAGE_VERSION = 2 as const;
/** Engine release this manifest format targets. Hosts refuse newer bundles. */
export const ENGINE_VERSION = 1 as const;

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Dotted path into the package, e.g. `assets[2].file`. */
  path: string;
  message: string;
}

/**
 * How a computation rounds when it must drop precision: parsing an operand
 * with more decimals than its scale, or bringing a product back to one scale.
 * `"halfAwayFromZero"` is the bill-writing convention (-1.005 -> -1.01);
 * `"halfEven"` is banker's rounding. Declared so a credit note and an invoice
 * round by the same written rule instead of by whichever Math.* was nearest.
 */
export type RoundingMode = "halfAwayFromZero" | "halfEven";

export interface ManifestDocument {
  width: number;
  height: number;
  unit: "px";
  dpi: number;
  paper: string;
  /** Decimal places money is held in; amounts are integers of this scale. */
  currencyScale: number;
  /**
   * Decimal places quantities are read at. Quantities are not money: a GSM
   * weight or a 0.125 metre cut must survive to the product line intact, so
   * they parse at their own scale (default 6) instead of the currency's.
   */
  quantityScale?: number;
  /** The one rounding rule every computation follows. Default half-away. */
  rounding?: RoundingMode;
}

/**
 * How a field prints. Dates and numbers are stored as plain text and printed
 * as plain text unless the author asks for a shape; this is that ask.
 */
export interface FieldDisplay {
  /** Date output pattern with `DD`, `MM`, `YYYY` tokens. Default `DD/MM/YYYY`. */
  date?: string;
  /** Thousands grouping for numeric fields. Default `indian`. */
  grouping?: "off" | "indian" | "western";
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
  /** The licence the font ships under, e.g. `OFL-1.1`. Present on v2 bundles. */
  licence?: string;
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
  source: "text" | "table" | "image-placeholder" | "field" | "cell-field";
  objectName: string;
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
  /** Column keys of a repeating field, in band order. */
  columns?: string[];
  maxItems?: number;
  /** How the field prints (date pattern, number grouping). */
  display?: FieldDisplay;
}

export type ComputedOp =
  | "sum"
  | "sum-times"
  | "add"
  | "subtract"
  | "multiply"
  | "percent"
  /** Spelled-out words for the operand, in the Indian numbering system. */
  | "in-words"
  /** The gap between the operand and itself rounded to `roundTo` decimals. */
  | "round-off";

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
  /**
   * Read by `round-off`: the decimal places the operand is rounded to before
   * the difference is reported. `0` - the default - carries a whole-unit
   * round-off line; a scale cap of the document's own currency scale applies.
   */
  roundTo?: number;
}

/** The manifest's signature block: who signed it and with what. */
export interface PackageSignature {
  alg: "ed25519";
  /** Identifies the trusted key the host verified against. */
  keyId: string;
}

/** The archive member that carries the signature bytes of `manifest.json`. */
export const MANIFEST_SIGNATURE_MEMBER = "manifest.json.sig";

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
  /**
   * Engine release the bundle was written for. A host refuses a bundle that
   * needs a newer engine than it runs; absence (v1 packages) means the bundle
   * predates versioning and every field it uses must be one an engine of
   * record 1 understands anyway.
   */
  engineVersion?: number;
  /**
   * SHA-256 of the template member as archived: the template's identity.
   * Computed over the authored structure, never over a filled render, so a
   * host can bind "the document I ship" to one immutable digest and verify it
   * at open time. Required from packageVersion 2.
   */
  templateSha256?: string;
  /** Signature block, present when the bundle was signed at build or ship time. */
  signature?: PackageSignature;
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

/** An opened, verified bundle: manifest plus every archive member. */
export interface Bundle {
  manifest: PackageManifest;
  files: Map<string, Uint8Array>;
}

/** The one shape `openBundle` hands back, whichever way the door swung. */
export type PackageOpen =
  | { ok: true; bundle: Bundle; template: import("../template/types").BillTemplate; refusals: string[] }
  | { ok: false; refusals: string[] };
