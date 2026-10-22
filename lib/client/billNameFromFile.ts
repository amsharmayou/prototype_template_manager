/**
 * A bill's starting name, taken from the file it was traced from.
 *
 * The name flows straight into the package: the editor writes it into
 * `template.meta.name`, `buildPackage` copies that into `manifest.name`, and
 * every host reads it back — the `.btpkg` filename, the admin catalog row, the
 * Android "Browse templates" list. So this is the one place a traced bill gets
 * a name, and the name it picks is the one the user will see forever.
 *
 * A raw filename is a poor name for a bill. Two kinds are common and neither
 * describes the bill:
 *
 *  - Camera and editor bookkeeping: `IMG_4821`, `DSC00042`, `PXL_20260101_…`.
 *  - Screenshots, often with a timestamp: `Screenshot 2025-11-19 041211`.
 *
 * Both are recognised and replaced with a neutral `Bill` rather than shipped as
 * the package name. Anything with real words in it is kept, tidied: separators
 * become spaces and the extension is dropped.
 *
 * The caller keeps this as a *default*: the editor's name field can rename the
 * bill afterwards, and that edit is what ends up in the package.
 */

/** Names a scanner or camera gives a file rather than a person. */
const CAMERA_NAME = /^(img|dsc|dscn|pxl|mvimg|gopr|photo|image|snap|capture)[-_ ]?\d+$/i;
/**
 * A camera name whose tail is a timestamp, e.g. `PXL 20260101 120000`.
 *
 * Runs against the tidied name, so the separators are already spaces. Kept
 * separate from `CAMERA_NAME` because the prefix is not enough on its own: a
 * date and time after it is what makes the whole thing bookkeeping.
 */
const CAMERA_TIMESTAMP_NAME =
  /^(img|dsc|dscn|pxl|mvimg|gopr|photo|image|snap|capture)[-_ ]+\d{8}([-_ ]\d{4,6})?$/i;
/** A screenshot, with or without a timestamp. */
const SCREENSHOT_NAME = /^(screen[-_ ]?shot|screenshot|screen capture|cleanshot)([-_ ].*)?$/i;
/** A pure timestamp or date, e.g. `2025-11-19 041211`. */
const TIMESTAMP_ONLY = /^\d{4}[-_.]?\d{2}[-_.]?\d{2}([-_ .]\d{2,6})?$/;

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

/** Drop anything a path may have carried: browsers send the bare name, but be safe. */
function baseName(name: string): string {
  const parts = stripExtension(name).split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function tidy(name: string): string {
  return name
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .trim();
}

/**
 * The default bill name for a traced image.
 *
 * Returns `"Bill"` when the filename carries nothing a person would recognise;
 * otherwise the tidied stem, capitalised as it was typed.
 */
export function billNameFromFile(filename: string): string {
  const stem = baseName(filename);
  const cleaned = tidy(stem);

  if (cleaned.length === 0) return "Bill";
  if (CAMERA_NAME.test(cleaned)) return "Bill";
  if (CAMERA_TIMESTAMP_NAME.test(cleaned)) return "Bill";
  if (SCREENSHOT_NAME.test(cleaned)) return "Bill";
  if (TIMESTAMP_ONLY.test(cleaned)) return "Bill";

  // A lone number is also bookkeeping, not a name.
  if (/^\d+$/.test(cleaned)) return "Bill";

  return cleaned;
}
